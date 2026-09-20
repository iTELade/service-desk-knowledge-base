import http from 'node:http';
import {readFile,writeFile,readdir,mkdir,rename,stat,unlink} from 'node:fs/promises';
import {join,extname,basename,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes,randomUUID,scryptSync,timingSafeEqual,createHash} from 'node:crypto';

export const VERSION='0.5.0';
export const SCHEMA_VERSION=1;
const ROOT=fileURLToPath(new URL('.',import.meta.url));
const PUBLIC=join(ROOT,'public');
const ARTICLES=join(ROOT,'articles');
const DATA_DIR=process.env.KB_DATA_DIR||'/data';
const STATE_FILE=join(DATA_DIR,'knowledge-base.json');
const UPLOAD_DIR=join(DATA_DIR,'uploads');
const PORT=Number(process.env.PORT||8080);
const MAX_BODY=7*1024*1024;
const MAX_ATTACHMENT=5*1024*1024;
const SESSION_TTL=24*60*60*1000;
const BRAND=process.env.KB_BRAND||'iTELade Knowledge Base';
const DEFAULT_LANG=process.env.KB_DEFAULT_LANG||'en';

const sessions=new Map();
let state;
let mutationQueue=Promise.resolve();

const now=()=>new Date().toISOString();
const id=prefix=>`${prefix}_${randomUUID()}`;
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const slugify=v=>String(v||'page').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,100)||'page';
const sha256=v=>createHash('sha256').update(String(v)).digest('hex');
const safeName=v=>basename(String(v||'file')).replace(/[^a-zA-Z0-9._ -]/g,'_').slice(0,180)||'file';

function blankState(){return {schemaVersion:SCHEMA_VERSION,createdAt:now(),settings:{brand:BRAND,defaultLanguage:DEFAULT_LANG},users:[],spaces:[],pages:[],revisions:[],comments:[],attachments:[],favorites:[],watches:[],recents:[],audit:[],tokens:[]};}

async function walk(dir){
  const out=[];
  for(const entry of await readdir(dir,{withFileTypes:true}).catch(()=>[])){
    const path=join(dir,entry.name);
    if(entry.isDirectory())out.push(...await walk(path));
    else if(entry.isFile()&&entry.name.endsWith('.md'))out.push(path);
  }
  return out;
}

function parseFrontMatter(raw){
  const text=String(raw);if(!text.startsWith('---\n'))return {meta:{},body:text};
  const end=text.indexOf('\n---\n',4);if(end<0)return {meta:{},body:text};
  const meta={};let listKey=null;
  for(const line of text.slice(4,end).split('\n')){
    const item=line.match(/^\s*-\s+(.+)$/);if(item&&listKey){meta[listKey].push(item[1].trim().replace(/^['"]|['"]$/g,''));continue;}
    const m=line.match(/^([A-Za-z0-9_.-]+):\s*(.*)$/);if(!m)continue;
    const key=m[1],rawValue=m[2].trim();listKey=null;
    if(rawValue===''){meta[key]=[];listKey=key;}else if(rawValue==='null')meta[key]=null;else if(rawValue==='true'||rawValue==='false')meta[key]=rawValue==='true';else meta[key]=rawValue.replace(/^['"]|['"]$/g,'');
  }
  return {meta,body:text.slice(end+5).trim()};
}

async function importLegacyArticles(target){
  const files=await walk(ARTICLES);if(!files.length)return;
  const space={id:id('spc'),key:'DOCS',name:'Documentation',description:'Imported documentation and knowledge articles.',icon:'📚',visibility:'public',archived:false,permissions:{view:[],edit:[],admin:[]},createdAt:now(),updatedAt:now()};
  target.spaces.push(space);let order=0;
  for(const file of files){
    const raw=await readFile(file,'utf8'),{meta,body}=parseFrontMatter(raw);if(meta.status&&meta.status!=='published')continue;
    const rel=relative(ARTICLES,file).replaceAll('\\','/'),parts=rel.split('/'),language=meta.language||parts[0]||DEFAULT_LANG,title=meta.title||basename(file,'.md').replaceAll('-',' '),pageId=id('pg');
    const page={id:pageId,spaceId:space.id,parentId:null,title,slug:meta.slug||slugify(title),summary:meta.summary||'',language,translationGroup:meta.article_id||null,status:'published',visibility:meta.visibility||'public',labels:Array.isArray(meta.tags)?meta.tags:[],content:body,draftContent:body,draftTitle:title,draftSummary:meta.summary||'',draftLabels:Array.isArray(meta.tags)?meta.tags:[],authorId:null,editorId:null,createdAt:now(),updatedAt:now(),publishedAt:meta.updated_at||now(),archivedAt:null,order:order++,version:1,revisionNumber:1,restrictions:{view:[],edit:[]}};
    target.pages.push(page);target.revisions.push({id:id('rev'),pageId,number:1,title:page.title,summary:page.summary,content:body,language,labels:page.labels,authorId:null,note:'Imported from Git repository',createdAt:page.publishedAt});
  }
}

async function loadState(){
  await mkdir(UPLOAD_DIR,{recursive:true});
  try{const parsed=JSON.parse(await readFile(STATE_FILE,'utf8'));state={...blankState(),...parsed};for(const key of ['users','spaces','pages','revisions','comments','attachments','favorites','watches','recents','audit','tokens'])if(!Array.isArray(state[key]))state[key]=[];state.schemaVersion=SCHEMA_VERSION;}
  catch{state=blankState();await importLegacyArticles(state);await persist();}
}

async function persist(){
  await mkdir(DATA_DIR,{recursive:true});const tmp=STATE_FILE+'.tmp';await writeFile(tmp,JSON.stringify(state,null,2),'utf8');await rename(tmp,STATE_FILE);
}

async function mutate(fn){
  let result,error;mutationQueue=mutationQueue.then(async()=>{try{result=await fn();await persist();}catch(err){error=err;}});await mutationQueue;if(error)throw error;return result;
}

function audit(action,actorId,details={}){state.audit.unshift({id:id('aud'),action,actorId:actorId||null,details,createdAt:now()});state.audit=state.audit.slice(0,5000);}
function hashPassword(password,salt=randomBytes(16).toString('hex')){return `scrypt:${salt}:${scryptSync(String(password),salt,64).toString('hex')}`;}
function verifyPassword(password,stored){try{const [,salt,hex]=String(stored).split(':'),expected=Buffer.from(hex,'hex'),actual=scryptSync(String(password),salt,expected.length);return timingSafeEqual(expected,actual);}catch{return false;}}
function validatePassword(password){return typeof password==='string'&&password.length>=10&&password.length<=256;}

function parseCookies(req){const out={};for(const part of String(req.headers.cookie||'').split(';')){const idx=part.indexOf('=');if(idx>0)out[part.slice(0,idx).trim()]=decodeURIComponent(part.slice(idx+1).trim());}return out;}
function sessionContext(req){const token=parseCookies(req).kb_session,s=token&&sessions.get(token);if(!s||s.expiresAt<Date.now()){if(token)sessions.delete(token);return {session:null,user:null};}const user=state.users.find(u=>u.id===s.userId&&u.active!==false)||null;if(!user)return {session:null,user:null};s.expiresAt=Date.now()+SESSION_TTL;return {session:s,user};}
function newSession(user){const token=randomBytes(32).toString('hex'),session={userId:user.id,csrf:randomBytes(24).toString('hex'),expiresAt:Date.now()+SESSION_TTL};sessions.set(token,session);return {token,session};}
function cookie(token,maxAge=86400){return `kb_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${process.env.KB_SECURE_COOKIE==='false'?'':'; Secure'}`;}

function sendJson(res,status,data,headers={}){res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff',...headers});res.end(JSON.stringify(data));}
function sendText(res,status,text,headers={}){res.writeHead(status,{'content-type':'text/plain; charset=utf-8','x-content-type-options':'nosniff',...headers});res.end(text);}
async function bodyJson(req,limit=MAX_BODY){let size=0,chunks=[];for await(const chunk of req){size+=chunk.length;if(size>limit)throw Object.assign(new Error('Payload too large'),{status:413});chunks.push(chunk);}if(!chunks.length)return {};try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw Object.assign(new Error('Invalid JSON'),{status:400});}}
function ensureCsrf(req,ctx){if(!ctx.session||req.headers['x-csrf-token']!==ctx.session.csrf)throw Object.assign(new Error('Invalid CSRF token'),{status:403});}
function requireUser(ctx,roles=[]){if(!ctx.user)throw Object.assign(new Error('Authentication required'),{status:401});if(roles.length&&!roles.includes(ctx.user.role))throw Object.assign(new Error('Forbidden'),{status:403});return ctx.user;}
function publicUser(user){return user?{id:user.id,email:user.email,name:user.name,role:user.role,language:user.language||DEFAULT_LANG,active:user.active!==false}:null;}

function roleAtLeast(user,role){const order={viewer:1,editor:2,admin:3};return !!user&&order[user.role]>=order[role];}
function includesUser(list,user){return !!user&&Array.isArray(list)&&list.includes(user.id);}
function canViewSpace(user,space){if(!space||space.archived)return false;if(space.visibility==='public')return true;if(!user)return false;if(user.role==='admin')return true;if(space.visibility==='internal')return true;return includesUser(space.permissions?.view,user)||includesUser(space.permissions?.edit,user)||includesUser(space.permissions?.admin,user);}
function canEditSpace(user,space){if(!user||!space||space.archived)return false;if(user.role==='admin')return true;if(!roleAtLeast(user,'editor'))return false;if(space.visibility!=='restricted')return true;return includesUser(space.permissions?.edit,user)||includesUser(space.permissions?.admin,user);}
function canAdminSpace(user,space){return !!user&&(user.role==='admin'||includesUser(space?.permissions?.admin,user));}
function canViewPage(user,page){const space=state.spaces.find(s=>s.id===page?.spaceId);if(!page||!canViewSpace(user,space))return false;if(page.archivedAt&&!(user&&canEditSpace(user,space)))return false;if(page.status!=='published'&&!canEditPage(user,page))return false;if(page.visibility==='restricted'&&!user)return false;if(Array.isArray(page.restrictions?.view)&&page.restrictions.view.length&&user?.role!=='admin'&&!includesUser(page.restrictions.view,user)&&!canEditPage(user,page))return false;return true;}
function canEditPage(user,page){const space=state.spaces.find(s=>s.id===page?.spaceId);if(!page||!canEditSpace(user,space))return false;if(Array.isArray(page.restrictions?.edit)&&page.restrictions.edit.length&&user?.role!=='admin'&&!includesUser(page.restrictions.edit,user))return false;return true;}
function effectivePages(user,spaceId=null){return state.pages.filter(p=>(!spaceId||p.spaceId===spaceId)&&canViewPage(user,p));}
function uniqueSlug(spaceId,title,excludeId=null){const base=slugify(title);let slug=base,n=2;while(state.pages.some(p=>p.id!==excludeId&&p.spaceId===spaceId&&p.slug===slug&&!p.archivedAt))slug=`${base}-${n++}`;return slug;}
function userName(userId){return state.users.find(u=>u.id===userId)?.name||'System';}

function inlineMarkdown(text){return esc(text).replace(/`([^`]+)`/g,'<code>$1</code>').replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>').replace(/\*([^*]+)\*/g,'<em>$1</em>').replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,'<a href="$2" target="_blank" rel="noreferrer">$1</a>');}
function markdown(src){
  const lines=String(src||'').split('\n');let inCode=false,code=[],list=null;const out=[];const closeList=()=>{if(list){out.push(`</${list}>`);list=null;}};
  for(const raw of lines){
    if(raw.startsWith('```')){closeList();if(inCode){out.push(`<pre><code>${esc(code.join('\n'))}</code></pre>`);code=[];inCode=false;}else inCode=true;continue;}if(inCode){code.push(raw);continue;}
    const h=raw.match(/^(#{1,4})\s+(.+)$/);if(h){closeList();out.push(`<h${h[1].length}>${inlineMarkdown(h[2])}</h${h[1].length}>`);continue;}
    const quote=raw.match(/^>\s?(.*)$/);if(quote){closeList();out.push(`<blockquote>${inlineMarkdown(quote[1])}</blockquote>`);continue;}
    const ol=raw.match(/^\d+\.\s+(.+)$/),ul=raw.match(/^[-*]\s+(.+)$/);if(ol||ul){const next=ol?'ol':'ul';if(list!==next){closeList();list=next;out.push(`<${list}>`);}out.push(`<li>${inlineMarkdown((ol||ul)[1])}</li>`);continue;}
    if(/^---+$/.test(raw.trim())){closeList();out.push('<hr>');continue;}closeList();if(raw.trim())out.push(`<p>${inlineMarkdown(raw)}</p>`);
  }
  closeList();if(inCode)out.push(`<pre><code>${esc(code.join('\n'))}</code></pre>`);return out.join('\n');
}

function pageSummary(page,user){return {id:page.id,spaceId:page.spaceId,parentId:page.parentId,title:page.title,slug:page.slug,summary:page.summary,language:page.language,status:page.status,visibility:page.visibility,labels:page.labels||[],updatedAt:page.updatedAt,publishedAt:page.publishedAt,order:page.order||0,version:page.version||1,revisionNumber:page.revisionNumber||0,canEdit:canEditPage(user,page),archived:!!page.archivedAt};}
function pageDetail(page,user){return {...pageSummary(page,user),content:page.content||'',html:markdown(page.content||''),draft:canEditPage(user,page)?{title:page.draftTitle??page.title,summary:page.draftSummary??page.summary,content:page.draftContent??page.content,labels:page.draftLabels??page.labels}:null,author:userName(page.authorId),editor:userName(page.editorId),restrictions:canEditPage(user,page)?page.restrictions:undefined};}
function buildTree(pages,parentId=null){return pages.filter(p=>(p.parentId||null)===(parentId||null)).sort((a,b)=>(a.order||0)-(b.order||0)||a.title.localeCompare(b.title)).map(p=>({...p,children:buildTree(pages,p.id)}));}

function searchPages(user,q,{spaceId=null,language=null,status=null,label=null}={}){
  const terms=String(q||'').trim().toLowerCase().split(/\s+/).filter(Boolean);if(!terms.length)return [];
  return effectivePages(user,spaceId).filter(p=>(!language||p.language===language)&&(!status||p.status===status)&&(!label||(p.labels||[]).includes(label))).map(p=>{
    const title=p.title.toLowerCase(),summary=String(p.summary||'').toLowerCase(),content=String(p.content||'').toLowerCase(),labels=(p.labels||[]).join(' ').toLowerCase();let score=0;
    for(const t of terms){if(title===t)score+=20;else if(title.startsWith(t))score+=12;else if(title.includes(t))score+=8;if(summary.includes(t))score+=4;if(labels.includes(t))score+=5;if(content.includes(t))score+=1;}
    return {page:p,score};
  }).filter(x=>x.score>0).sort((a,b)=>b.score-a.score||String(b.page.updatedAt).localeCompare(String(a.page.updatedAt))).slice(0,100);
}

function recordRecent(user,page){if(!user)return;state.recents=state.recents.filter(r=>!(r.userId===user.id&&r.pageId===page.id));state.recents.unshift({userId:user.id,pageId:page.id,viewedAt:now()});state.recents=state.recents.filter((r,i)=>i<500);void persist();}
function toggleRecord(collection,userId,pageId){const idx=collection.findIndex(r=>r.userId===userId&&r.pageId===pageId);if(idx>=0){collection.splice(idx,1);return false;}collection.push({userId,pageId,createdAt:now()});return true;}
function descendants(pageId){const out=[];const visit=id0=>{for(const p of state.pages.filter(x=>x.parentId===id0)){out.push(p.id);visit(p.id);}};visit(pageId);return out;}
function wouldCycle(pageId,parentId){return parentId===pageId||descendants(pageId).includes(parentId);}

function bearer(req){const raw=String(req.headers.authorization||'');if(!raw.startsWith('Bearer '))return null;const hash=sha256(raw.slice(7).trim());return state.tokens.find(t=>!t.revokedAt&&t.hash===hash)||null;}
function tokenCan(token,scope){return !!token&&Array.isArray(token.scopes)&&token.scopes.includes(scope);}
function tokenPageAllowed(token,page){return ['public',...(token.visibilities||[])].includes(page.visibility||'public')&&page.status==='published'&&!page.archivedAt;}

async function directoryBytes(dir){let total=0;for(const entry of await readdir(dir,{withFileTypes:true}).catch(()=>[])){const path=join(dir,entry.name);if(entry.isDirectory())total+=await directoryBytes(path);else if(entry.isFile())total+=(await stat(path)).size;}return total;}

function mimeFor(path){return ({'.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.html':'text/html; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.ico':'image/x-icon'}[extname(path).toLowerCase()]||'application/octet-stream');}
async function serveStatic(pathname,res){const mapped=pathname==='/'?'index.html':pathname.slice(1);if(!['index.html','app.js','style.css','favicon.svg'].includes(mapped))return false;try{const data=await readFile(join(PUBLIC,mapped));res.writeHead(200,{'content-type':mimeFor(mapped),'cache-control':mapped==='index.html'?'no-cache':'public,max-age=300','x-content-type-options':'nosniff'});res.end(data);return true;}catch{return false;}}

async function api(req,res,url){
  const ctx=sessionContext(req),method=req.method||'GET',path=url.pathname;
  if(path==='/api/bootstrap'&&method==='GET')return sendJson(res,200,{version:VERSION,schemaVersion:SCHEMA_VERSION,setupRequired:state.users.length===0,user:publicUser(ctx.user),csrf:ctx.session?.csrf||null,settings:{brand:state.settings.brand||BRAND,defaultLanguage:state.settings.defaultLanguage||DEFAULT_LANG},spaces:state.spaces.filter(s=>canViewSpace(ctx.user,s)).map(s=>({...s,permissions:undefined}))});

  if(path==='/api/setup'&&method==='POST'){
    if(state.users.length)throw Object.assign(new Error('Setup already completed'),{status:409});const b=await bodyJson(req);if(!validatePassword(b.password)||!String(b.email||'').includes('@'))throw Object.assign(new Error('Use a valid email and a password with at least 10 characters'),{status:400});
    const user=await mutate(()=>{const u={id:id('usr'),email:String(b.email).trim().toLowerCase(),name:String(b.name||'Administrator').trim().slice(0,120),role:'admin',language:b.language||DEFAULT_LANG,passwordHash:hashPassword(b.password),active:true,createdAt:now(),updatedAt:now()};state.users.push(u);audit('system.setup',u.id,{email:u.email});return u;});const {token,session}=newSession(user);return sendJson(res,201,{user:publicUser(user),csrf:session.csrf},{'set-cookie':cookie(token)});
  }
  if(path==='/api/login'&&method==='POST'){
    const b=await bodyJson(req),email=String(b.email||'').trim().toLowerCase(),user=state.users.find(u=>u.email===email&&u.active!==false);if(!user||!verifyPassword(b.password,user.passwordHash))return sendJson(res,401,{error:'Invalid email or password'});const {token,session}=newSession(user);audit('auth.login',user.id,{});void persist();return sendJson(res,200,{user:publicUser(user),csrf:session.csrf},{'set-cookie':cookie(token)});
  }
  if(path==='/api/logout'&&method==='POST'){if(ctx.session)ensureCsrf(req,ctx);const token=parseCookies(req).kb_session;if(token)sessions.delete(token);return sendJson(res,200,{ok:true},{'set-cookie':cookie('',0)});}

  if(path==='/api/spaces'&&method==='GET')return sendJson(res,200,{spaces:state.spaces.filter(s=>canViewSpace(ctx.user,s)).map(s=>({...s,permissions:canAdminSpace(ctx.user,s)?s.permissions:undefined,canEdit:canEditSpace(ctx.user,s),canAdmin:canAdminSpace(ctx.user,s)}))});
  if(path==='/api/spaces'&&method==='POST'){
    const user=requireUser(ctx,['editor','admin']);ensureCsrf(req,ctx);const b=await bodyJson(req),key=String(b.key||'').trim().toUpperCase().replace(/[^A-Z0-9_-]/g,'').slice(0,20);if(!key||!b.name)throw Object.assign(new Error('Space key and name are required'),{status:400});if(state.spaces.some(s=>s.key===key&&!s.archived))throw Object.assign(new Error('Space key already exists'),{status:409});
    const space=await mutate(()=>{const s={id:id('spc'),key,name:String(b.name).trim().slice(0,120),description:String(b.description||'').slice(0,1000),icon:String(b.icon||'📚').slice(0,8),visibility:['public','internal','restricted'].includes(b.visibility)?b.visibility:'internal',archived:false,permissions:{view:[],edit:[user.id],admin:[user.id]},createdAt:now(),updatedAt:now()};state.spaces.push(s);audit('space.created',user.id,{spaceId:s.id,key:s.key});return s;});return sendJson(res,201,{space});
  }
  let m=path.match(/^\/api\/spaces\/([^/]+)$/);if(m&&method==='PATCH'){
    const user=requireUser(ctx);ensureCsrf(req,ctx);const space=state.spaces.find(s=>s.id===m[1]);if(!space||!canAdminSpace(user,space))throw Object.assign(new Error('Forbidden'),{status:403});const b=await bodyJson(req);await mutate(()=>{for(const field of ['name','description','icon'])if(field in b)space[field]=String(b[field]).slice(0,field==='description'?1000:120);if(['public','internal','restricted'].includes(b.visibility))space.visibility=b.visibility;if(typeof b.archived==='boolean')space.archived=b.archived;if(b.permissions&&user.role==='admin')space.permissions={view:Array.isArray(b.permissions.view)?b.permissions.view:[],edit:Array.isArray(b.permissions.edit)?b.permissions.edit:[],admin:Array.isArray(b.permissions.admin)?b.permissions.admin:[]};space.updatedAt=now();audit('space.updated',user.id,{spaceId:space.id});});return sendJson(res,200,{space});
  }
  m=path.match(/^\/api\/spaces\/([^/]+)\/tree$/);if(m&&method==='GET'){const space=state.spaces.find(s=>s.id===m[1]);if(!space||!canViewSpace(ctx.user,space))throw Object.assign(new Error('Not found'),{status:404});const pages=effectivePages(ctx.user,space.id).map(p=>pageSummary(p,ctx.user));return sendJson(res,200,{space:{...space,permissions:undefined},tree:buildTree(pages)});}

  if(path==='/api/pages'&&method==='POST'){
    const user=requireUser(ctx,['editor','admin']);ensureCsrf(req,ctx);const b=await bodyJson(req),space=state.spaces.find(s=>s.id===b.spaceId);if(!space||!canEditSpace(user,space))throw Object.assign(new Error('Forbidden'),{status:403});if(b.parentId&&(!state.pages.some(p=>p.id===b.parentId&&p.spaceId===space.id)||!canEditPage(user,state.pages.find(p=>p.id===b.parentId))))throw Object.assign(new Error('Invalid parent page'),{status:400});const title=String(b.title||'Untitled').trim().slice(0,180)||'Untitled';
    const page=await mutate(()=>{const p={id:id('pg'),spaceId:space.id,parentId:b.parentId||null,title,slug:uniqueSlug(space.id,title),summary:String(b.summary||'').slice(0,500),language:String(b.language||state.settings.defaultLanguage||DEFAULT_LANG).slice(0,12),translationGroup:b.translationGroup||null,status:'draft',visibility:['public','internal','restricted'].includes(b.visibility)?b.visibility:space.visibility,labels:Array.isArray(b.labels)?b.labels.map(String).slice(0,30):[],content:'',draftContent:String(b.content||''),draftTitle:title,draftSummary:String(b.summary||'').slice(0,500),draftLabels:Array.isArray(b.labels)?b.labels.map(String).slice(0,30):[],authorId:user.id,editorId:user.id,createdAt:now(),updatedAt:now(),publishedAt:null,archivedAt:null,order:state.pages.filter(x=>x.spaceId===space.id&&x.parentId===(b.parentId||null)).length,version:1,revisionNumber:0,restrictions:{view:[],edit:[]}};state.pages.push(p);audit('page.created',user.id,{pageId:p.id,spaceId:space.id});return p;});return sendJson(res,201,{page:pageDetail(page,user)});
  }

  m=path.match(/^\/api\/pages\/([^/]+)$/);if(m&&method==='GET'){
    const page=state.pages.find(p=>p.id===m[1]);if(!page||!canViewPage(ctx.user,page))throw Object.assign(new Error('Not found'),{status:404});recordRecent(ctx.user,page);const attachments=state.attachments.filter(a=>a.pageId===page.id).map(a=>({...a,path:undefined}));return sendJson(res,200,{page:pageDetail(page,ctx.user),favorite:!!ctx.user&&state.favorites.some(r=>r.userId===ctx.user.id&&r.pageId===page.id),watched:!!ctx.user&&state.watches.some(r=>r.userId===ctx.user.id&&r.pageId===page.id),attachments,revisionCount:state.revisions.filter(r=>r.pageId===page.id).length});
  }
  m=path.match(/^\/api\/pages\/([^/]+)\/draft$/);if(m&&method==='PATCH'){
    const user=requireUser(ctx,['editor','admin']);ensureCsrf(req,ctx);const page=state.pages.find(p=>p.id===m[1]);if(!page||!canEditPage(user,page))throw Object.assign(new Error('Forbidden'),{status:403});const b=await bodyJson(req);if(b.version&&Number(b.version)!==Number(page.version))return sendJson(res,409,{error:'Page changed since it was opened',currentVersion:page.version});
    await mutate(()=>{if('title'in b)page.draftTitle=String(b.title||'Untitled').trim().slice(0,180)||'Untitled';if('summary'in b)page.draftSummary=String(b.summary||'').slice(0,500);if('content'in b)page.draftContent=String(b.content||'').slice(0,1000000);if(Array.isArray(b.labels))page.draftLabels=b.labels.map(String).map(x=>x.trim()).filter(Boolean).slice(0,30);if('language'in b)page.language=String(b.language||DEFAULT_LANG).slice(0,12);if('visibility'in b&&['public','internal','restricted'].includes(b.visibility))page.visibility=b.visibility;if(b.restrictions&&user.role==='admin')page.restrictions={view:Array.isArray(b.restrictions.view)?b.restrictions.view:[],edit:Array.isArray(b.restrictions.edit)?b.restrictions.edit:[]};page.editorId=user.id;page.updatedAt=now();page.version=(page.version||1)+1;});return sendJson(res,200,{page:pageDetail(page,user)});
  }
  m=path.match(/^\/api\/pages\/([^/]+)\/publish$/);if(m&&method==='POST'){
    const user=requireUser(ctx,['editor','admin']);ensureCsrf(req,ctx);const page=state.pages.find(p=>p.id===m[1]);if(!page||!canEditPage(user,page))throw Object.assign(new Error('Forbidden'),{status:403});const b=await bodyJson(req);await mutate(()=>{page.title=page.draftTitle||page.title;page.summary=page.draftSummary??page.summary;page.content=page.draftContent??page.content;page.labels=page.draftLabels??page.labels;page.slug=uniqueSlug(page.spaceId,page.title,page.id);page.status='published';page.publishedAt=now();page.updatedAt=page.publishedAt;page.editorId=user.id;page.version=(page.version||1)+1;page.revisionNumber=(page.revisionNumber||0)+1;state.revisions.push({id:id('rev'),pageId:page.id,number:page.revisionNumber,title:page.title,summary:page.summary,content:page.content,language:page.language,labels:page.labels,authorId:user.id,note:String(b.note||'').slice(0,300),createdAt:now()});audit('page.published',user.id,{pageId:page.id,revision:page.revisionNumber});});return sendJson(res,200,{page:pageDetail(page,user)});
  }
  m=path.match(/^\/api\/pages\/([^/]+)\/(archive|restore)$/);if(m&&method==='POST'){
    const user=requireUser(ctx,['editor','admin']);ensureCsrf(req,ctx);const page=state.pages.find(p=>p.id===m[1]);if(!page||!canEditPage(user,page))throw Object.assign(new Error('Forbidden'),{status:403});await mutate(()=>{if(m[2]==='archive'){page.archivedAt=now();page.status='archived';}else{page.archivedAt=null;page.status=page.revisionNumber?'published':'draft';}page.updatedAt=now();audit(`page.${m[2]}d`,user.id,{pageId:page.id});});return sendJson(res,200,{page:pageDetail(page,user)});
  }
  m=path.match(/^\/api\/pages\/([^/]+)\/move$/);if(m&&method==='POST'){
    const user=requireUser(ctx,['editor','admin']);ensureCsrf(req,ctx);const page=state.pages.find(p=>p.id===m[1]);if(!page||!canEditPage(user,page))throw Object.assign(new Error('Forbidden'),{status:403});const b=await bodyJson(req),parentId=b.parentId||null;if(parentId&&(!state.pages.some(p=>p.id===parentId&&p.spaceId===page.spaceId)||wouldCycle(page.id,parentId)))throw Object.assign(new Error('Invalid parent page'),{status:400});await mutate(()=>{page.parentId=parentId;page.order=Number.isFinite(Number(b.order))?Number(b.order):0;page.updatedAt=now();audit('page.moved',user.id,{pageId:page.id,parentId});});return sendJson(res,200,{ok:true});
  }
  m=path.match(/^\/api\/pages\/([^/]+)\/revisions$/);if(m&&method==='GET'){
    const page=state.pages.find(p=>p.id===m[1]);if(!page||!canViewPage(ctx.user,page))throw Object.assign(new Error('Not found'),{status:404});const revisions=state.revisions.filter(r=>r.pageId===page.id).sort((a,b)=>b.number-a.number).map(r=>({...r,author:userName(r.authorId),content:canEditPage(ctx.user,page)?r.content:undefined}));return sendJson(res,200,{revisions});
  }
  m=path.match(/^\/api\/pages\/([^/]+)\/revisions\/(\d+)\/restore$/);if(m&&method==='POST'){
    const user=requireUser(ctx,['editor','admin']);ensureCsrf(req,ctx);const page=state.pages.find(p=>p.id===m[1]);if(!page||!canEditPage(user,page))throw Object.assign(new Error('Forbidden'),{status:403});const rev=state.revisions.find(r=>r.pageId===page.id&&r.number===Number(m[2]));if(!rev)throw Object.assign(new Error('Revision not found'),{status:404});await mutate(()=>{page.draftTitle=rev.title;page.draftSummary=rev.summary;page.draftContent=rev.content;page.draftLabels=rev.labels;page.editorId=user.id;page.updatedAt=now();page.version=(page.version||1)+1;audit('page.revision_restored',user.id,{pageId:page.id,revision:rev.number});});return sendJson(res,200,{page:pageDetail(page,user)});
  }

  m=path.match(/^\/api\/pages\/([^/]+)\/comments$/);if(m&&method==='GET'){const page=state.pages.find(p=>p.id===m[1]);if(!page||!canViewPage(ctx.user,page))throw Object.assign(new Error('Not found'),{status:404});return sendJson(res,200,{comments:state.comments.filter(c=>c.pageId===page.id).map(c=>({...c,author:userName(c.userId)}))});}
  if(m&&method==='POST'){const user=requireUser(ctx);ensureCsrf(req,ctx);const page=state.pages.find(p=>p.id===m[1]);if(!page||!canViewPage(user,page))throw Object.assign(new Error('Not found'),{status:404});const b=await bodyJson(req),text=String(b.body||'').trim();if(!text)throw Object.assign(new Error('Comment cannot be empty'),{status:400});const comment=await mutate(()=>{const c={id:id('cmt'),pageId:page.id,parentId:b.parentId||null,userId:user.id,body:text.slice(0,20000),createdAt:now(),updatedAt:now(),resolvedAt:null};state.comments.push(c);audit('comment.created',user.id,{pageId:page.id,commentId:c.id});return c;});return sendJson(res,201,{comment:{...comment,author:user.name}});}
  m=path.match(/^\/api\/comments\/([^/]+)\/resolve$/);if(m&&method==='POST'){const user=requireUser(ctx);ensureCsrf(req,ctx);const c=state.comments.find(x=>x.id===m[1]),page=state.pages.find(p=>p.id===c?.pageId);if(!c||!(c.userId===user.id||canEditPage(user,page)))throw Object.assign(new Error('Forbidden'),{status:403});await mutate(()=>{c.resolvedAt=c.resolvedAt?null:now();c.updatedAt=now();audit('comment.resolved',user.id,{commentId:c.id,resolved:!!c.resolvedAt});});return sendJson(res,200,{comment:{...c,author:userName(c.userId)}});}

  m=path.match(/^\/api\/pages\/([^/]+)\/(favorite|watch)$/);if(m&&method==='POST'){const user=requireUser(ctx);ensureCsrf(req,ctx);const page=state.pages.find(p=>p.id===m[1]);if(!page||!canViewPage(user,page))throw Object.assign(new Error('Not found'),{status:404});let enabled;await mutate(()=>{enabled=toggleRecord(m[2]==='favorite'?state.favorites:state.watches,user.id,page.id);});return sendJson(res,200,{enabled});}
  if(path==='/api/me/recent'&&method==='GET'){const user=requireUser(ctx);const items=state.recents.filter(r=>r.userId===user.id).sort((a,b)=>b.viewedAt.localeCompare(a.viewedAt)).slice(0,30).map(r=>state.pages.find(p=>p.id===r.pageId)).filter(p=>p&&canViewPage(user,p)).map(p=>pageSummary(p,user));return sendJson(res,200,{pages:items});}
  if(path==='/api/me/favorites'&&method==='GET'){const user=requireUser(ctx);const items=state.favorites.filter(r=>r.userId===user.id).map(r=>state.pages.find(p=>p.id===r.pageId)).filter(p=>p&&canViewPage(user,p)).map(p=>pageSummary(p,user));return sendJson(res,200,{pages:items});}

  if(path==='/api/search'&&method==='GET'){const results=searchPages(ctx.user,url.searchParams.get('q')||'',{spaceId:url.searchParams.get('spaceId')||null,language:url.searchParams.get('language')||null,label:url.searchParams.get('label')||null}).map(x=>({...pageSummary(x.page,ctx.user),score:x.score,snippet:String(x.page.summary||x.page.content||'').replace(/[#*`>]/g,'').slice(0,220)}));return sendJson(res,200,{results});}

  if(path==='/api/attachments'&&method==='POST'){
    const user=requireUser(ctx,['editor','admin']);ensureCsrf(req,ctx);const b=await bodyJson(req),page=state.pages.find(p=>p.id===b.pageId);if(!page||!canEditPage(user,page))throw Object.assign(new Error('Forbidden'),{status:403});const buffer=Buffer.from(String(b.data||''),'base64');if(!buffer.length||buffer.length>MAX_ATTACHMENT)throw Object.assign(new Error('Attachment must be between 1 byte and 5 MB'),{status:400});const attachmentId=id('att'),name=safeName(b.name),diskName=`${attachmentId}${extname(name).slice(0,12)}`;await writeFile(join(UPLOAD_DIR,diskName),buffer);const attachment=await mutate(()=>{const a={id:attachmentId,pageId:page.id,name,mime:String(b.mime||'application/octet-stream').slice(0,120),size:buffer.length,path:diskName,userId:user.id,createdAt:now(),version:1};state.attachments.push(a);audit('attachment.created',user.id,{pageId:page.id,attachmentId:a.id,name});return a;});return sendJson(res,201,{attachment:{...attachment,path:undefined}});
  }
  m=path.match(/^\/api\/attachments\/([^/]+)$/);if(m&&method==='GET'){const a=state.attachments.find(x=>x.id===m[1]),page=state.pages.find(p=>p.id===a?.pageId);if(!a||!page||!canViewPage(ctx.user,page))throw Object.assign(new Error('Not found'),{status:404});const data=await readFile(join(UPLOAD_DIR,a.path));res.writeHead(200,{'content-type':a.mime||'application/octet-stream','content-length':data.length,'content-disposition':`inline; filename="${safeName(a.name).replaceAll('"','')}"`,'x-content-type-options':'nosniff'});return res.end(data);}
  if(m&&method==='DELETE'){const user=requireUser(ctx,['editor','admin']);ensureCsrf(req,ctx);const a=state.attachments.find(x=>x.id===m[1]),page=state.pages.find(p=>p.id===a?.pageId);if(!a||!page||!canEditPage(user,page))throw Object.assign(new Error('Forbidden'),{status:403});await unlink(join(UPLOAD_DIR,a.path)).catch(()=>{});await mutate(()=>{state.attachments=state.attachments.filter(x=>x.id!==a.id);audit('attachment.deleted',user.id,{attachmentId:a.id,pageId:page.id});});return sendJson(res,200,{ok:true});}

  if(path==='/api/admin/users'&&method==='GET'){requireUser(ctx,['admin']);return sendJson(res,200,{users:state.users.map(publicUser)});}
  if(path==='/api/admin/users'&&method==='POST'){const actor=requireUser(ctx,['admin']);ensureCsrf(req,ctx);const b=await bodyJson(req),email=String(b.email||'').trim().toLowerCase();if(!email.includes('@')||state.users.some(u=>u.email===email))throw Object.assign(new Error('Invalid or duplicate email'),{status:400});if(!validatePassword(b.password))throw Object.assign(new Error('Password must contain at least 10 characters'),{status:400});const user=await mutate(()=>{const u={id:id('usr'),email,name:String(b.name||email).slice(0,120),role:['viewer','editor','admin'].includes(b.role)?b.role:'viewer',language:b.language||DEFAULT_LANG,passwordHash:hashPassword(b.password),active:true,createdAt:now(),updatedAt:now()};state.users.push(u);audit('user.created',actor.id,{userId:u.id,email});return u;});return sendJson(res,201,{user:publicUser(user)});}
  m=path.match(/^\/api\/admin\/users\/([^/]+)$/);if(m&&method==='PATCH'){const actor=requireUser(ctx,['admin']);ensureCsrf(req,ctx);const user=state.users.find(u=>u.id===m[1]);if(!user)throw Object.assign(new Error('User not found'),{status:404});const b=await bodyJson(req);await mutate(()=>{if('name'in b)user.name=String(b.name).slice(0,120);if(['viewer','editor','admin'].includes(b.role))user.role=b.role;if(typeof b.active==='boolean'&&user.id!==actor.id)user.active=b.active;if(validatePassword(b.password))user.passwordHash=hashPassword(b.password);user.updatedAt=now();audit('user.updated',actor.id,{userId:user.id});});return sendJson(res,200,{user:publicUser(user)});}
  if(path==='/api/admin/audit'&&method==='GET'){requireUser(ctx,['admin']);return sendJson(res,200,{events:state.audit.slice(0,500).map(e=>({...e,actor:userName(e.actorId)}))});}
  if(path==='/api/admin/health'&&method==='GET'){requireUser(ctx,['admin']);return sendJson(res,200,{version:VERSION,schemaVersion:SCHEMA_VERSION,spaces:state.spaces.length,pages:state.pages.length,users:state.users.length,revisions:state.revisions.length,comments:state.comments.length,attachments:state.attachments.length,storageBytes:await directoryBytes(DATA_DIR),uptimeSeconds:Math.round(process.uptime())});}
  if(path==='/api/admin/backup'&&method==='GET'){requireUser(ctx,['admin']);const snapshot={...state,tokens:state.tokens.map(t=>({...t,hash:'[redacted]'}))};res.writeHead(200,{'content-type':'application/json; charset=utf-8','content-disposition':`attachment; filename="knowledge-base-backup-${new Date().toISOString().slice(0,10)}.json"`});return res.end(JSON.stringify(snapshot,null,2));}
  if(path==='/api/admin/tokens'&&method==='GET'){requireUser(ctx,['admin']);return sendJson(res,200,{tokens:state.tokens.map(({hash,...t})=>t)});}
  if(path==='/api/admin/tokens'&&method==='POST'){const actor=requireUser(ctx,['admin']);ensureCsrf(req,ctx);const b=await bodyJson(req),secret='kb_'+randomBytes(32).toString('base64url'),token=await mutate(()=>{const t={id:id('tok'),name:String(b.name||'Service integration').slice(0,120),hash:sha256(secret),scopes:Array.isArray(b.scopes)?b.scopes.filter(x=>['search','read','health'].includes(x)):['search','read','health'],visibilities:Array.isArray(b.visibilities)?b.visibilities.filter(x=>['internal','restricted'].includes(x)):['internal'],createdAt:now(),createdBy:actor.id,revokedAt:null};state.tokens.push(t);audit('token.created',actor.id,{tokenId:t.id,name:t.name});return t;});const {hash,...safe}=token;return sendJson(res,201,{token:safe,secret});}
  m=path.match(/^\/api\/admin\/tokens\/([^/]+)\/revoke$/);if(m&&method==='POST'){const actor=requireUser(ctx,['admin']);ensureCsrf(req,ctx);const token=state.tokens.find(t=>t.id===m[1]);if(!token)throw Object.assign(new Error('Token not found'),{status:404});await mutate(()=>{token.revokedAt=now();audit('token.revoked',actor.id,{tokenId:token.id});});return sendJson(res,200,{ok:true});}

  if(path==='/api/v1/health'&&method==='GET'){const token=bearer(req);if(!tokenCan(token,'health'))return sendJson(res,401,{error:'Invalid token'});return sendJson(res,200,{ok:true,service:'iTELade Knowledge Base',version:VERSION,schemaVersion:SCHEMA_VERSION});}
  if(path==='/api/v1/search'&&method==='GET'){const token=bearer(req);if(!tokenCan(token,'search'))return sendJson(res,401,{error:'Invalid token'});const q=url.searchParams.get('q')||'',language=url.searchParams.get('language')||null,results=state.pages.filter(p=>tokenPageAllowed(token,p)&&(!language||p.language===language)).map(p=>{const hay=`${p.title} ${p.summary} ${(p.labels||[]).join(' ')} ${p.content}`.toLowerCase(),terms=q.toLowerCase().split(/\s+/).filter(Boolean);let score=0;for(const t of terms){if(p.title.toLowerCase().includes(t))score+=8;if(hay.includes(t))score+=1;}return {p,score};}).filter(x=>x.score>0).sort((a,b)=>b.score-a.score).slice(0,50).map(({p,score})=>({id:p.id,title:p.title,summary:p.summary,spaceId:p.spaceId,labels:p.labels,language:p.language,status:p.status,visibility:p.visibility,updatedAt:p.updatedAt,score}));return sendJson(res,200,{results});}
  m=path.match(/^\/api\/v1\/pages\/([^/]+)$/);if(m&&method==='GET'){const token=bearer(req);if(!tokenCan(token,'read'))return sendJson(res,401,{error:'Invalid token'});const p=state.pages.find(x=>x.id===m[1]);if(!p||!tokenPageAllowed(token,p))throw Object.assign(new Error('Not found'),{status:404});const space=state.spaces.find(s=>s.id===p.spaceId);return sendJson(res,200,{id:p.id,title:p.title,summary:p.summary,content:p.content,html:markdown(p.content),space:space?{id:space.id,key:space.key,name:space.name}:null,labels:p.labels,language:p.language,status:p.status,visibility:p.visibility,updatedAt:p.updatedAt,publishedAt:p.publishedAt});}

  throw Object.assign(new Error('Not found'),{status:404});
}

export const server=http.createServer(async(req,res)=>{
  try{
    const url=new URL(req.url,'http://localhost');
    if(url.pathname==='/healthz')return sendJson(res,200,{ok:true,service:'knowledge-base',version:VERSION,schemaVersion:SCHEMA_VERSION});
    if(url.pathname.startsWith('/api/'))return await api(req,res,url);
    if(await serveStatic(url.pathname,res))return;
    return sendText(res,404,'Not found');
  }catch(err){const status=Number(err.status)||500;if(status>=500)console.error(err);return sendJson(res,status,{error:status>=500?'Internal server error':err.message});}
});

await loadState();
if(import.meta.url===`file://${process.argv[1]}`||fileURLToPath(import.meta.url)===process.argv[1])server.listen(PORT,'0.0.0.0',()=>console.log(`iTELade Knowledge Base ${VERSION} listening on :${PORT}`));
