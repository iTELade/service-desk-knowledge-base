import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

async function startApp(){
  const dataDir=await mkdtemp(join(tmpdir(),'itelade-kb-'));
  const port=19000+Math.floor(Math.random()*1000);
  const child=spawn(process.execPath,['server.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,PORT:String(port),KB_DATA_DIR:dataDir,KB_SECURE_COOKIE:'false'},stdio:['ignore','pipe','pipe']});
  const base=`http://127.0.0.1:${port}`;
  let error='';child.stderr.on('data',d=>error+=d);
  for(let i=0;i<60;i++){
    try{const r=await fetch(base+'/healthz');if(r.ok)return {base,child,dataDir};}catch{}
    if(child.exitCode!==null)throw new Error(`server exited early: ${error}`);
    await new Promise(r=>setTimeout(r,100));
  }
  child.kill('SIGKILL');throw new Error(`server did not become healthy: ${error}`);
}

async function request(base,path,{method='GET',cookie,csrf,body,headers={}}={}){
  const h={...headers};if(cookie)h.cookie=cookie;if(csrf)h['x-csrf-token']=csrf;if(body!==undefined)h['content-type']='application/json';
  const res=await fetch(base+path,{method,headers:h,body:body===undefined?undefined:JSON.stringify(body)});const text=await res.text();let json={};try{json=JSON.parse(text);}catch{}
  return {res,json,text,cookie:res.headers.get('set-cookie')?.split(';')[0]||cookie};
}

let app;
test.before(async()=>{app=await startApp();});
test.after(async()=>{app.child.kill('SIGTERM');await rm(app.dataDir,{recursive:true,force:true});});

test('first-run setup creates a local administrator and protected session',async()=>{
  const bootstrap=await request(app.base,'/api/bootstrap');assert.equal(bootstrap.res.status,200);assert.equal(bootstrap.json.setupRequired,true);assert.equal(bootstrap.json.version,'0.5.0');
  const setup=await request(app.base,'/api/setup',{method:'POST',body:{name:'Admin User',email:'admin@example.test',password:'correct-horse-battery-staple'}});assert.equal(setup.res.status,201);assert.equal(setup.json.user.role,'admin');assert.ok(setup.json.csrf);assert.match(setup.cookie,/kb_session=/);
  app.cookie=setup.cookie;app.csrf=setup.json.csrf;
});

test('space, draft, publish, revisions and permission-aware search work end to end',async()=>{
  const space=await request(app.base,'/api/spaces',{method:'POST',cookie:app.cookie,csrf:app.csrf,body:{name:'IT Operations',key:'ITOPS',description:'Runbooks and support procedures',visibility:'internal'}});assert.equal(space.res.status,201);app.spaceId=space.json.space.id;
  const page=await request(app.base,'/api/pages',{method:'POST',cookie:app.cookie,csrf:app.csrf,body:{spaceId:app.spaceId,title:'Reset a locked account',language:'en',labels:['identity','runbook']}});assert.equal(page.res.status,201);assert.equal(page.json.page.status,'draft');app.pageId=page.json.page.id;
  const draft=await request(app.base,`/api/pages/${app.pageId}/draft`,{method:'PATCH',cookie:app.cookie,csrf:app.csrf,body:{version:page.json.page.version,title:'Reset a locked account',summary:'Procedure for locked accounts',content:'# Reset account\n\nUse the approved identity workflow.',labels:['identity','runbook']}});assert.equal(draft.res.status,200);
  const publish=await request(app.base,`/api/pages/${app.pageId}/publish`,{method:'POST',cookie:app.cookie,csrf:app.csrf,body:{note:'Initial publication'}});assert.equal(publish.res.status,200);assert.equal(publish.json.page.status,'published');assert.equal(publish.json.page.revisionNumber,1);
  const search=await request(app.base,'/api/search?q=locked',{cookie:app.cookie});assert.equal(search.res.status,200);assert.equal(search.json.results[0].id,app.pageId);
  const revisions=await request(app.base,`/api/pages/${app.pageId}/revisions`,{cookie:app.cookie});assert.equal(revisions.res.status,200);assert.equal(revisions.json.revisions.length,1);assert.equal(revisions.json.revisions[0].note,'Initial publication');
});

test('comments, favorites and attachments persist on a page',async()=>{
  const comment=await request(app.base,`/api/pages/${app.pageId}/comments`,{method:'POST',cookie:app.cookie,csrf:app.csrf,body:{body:'Validated by the service team.'}});assert.equal(comment.res.status,201);
  const favorite=await request(app.base,`/api/pages/${app.pageId}/favorite`,{method:'POST',cookie:app.cookie,csrf:app.csrf});assert.equal(favorite.json.enabled,true);
  const upload=await request(app.base,'/api/attachments',{method:'POST',cookie:app.cookie,csrf:app.csrf,body:{pageId:app.pageId,name:'example.txt',mime:'text/plain',data:Buffer.from('hello knowledge').toString('base64')}});assert.equal(upload.res.status,201);assert.equal(upload.json.attachment.name,'example.txt');
  const file=await fetch(app.base+`/api/attachments/${upload.json.attachment.id}`,{headers:{cookie:app.cookie}});assert.equal(file.status,200);assert.equal(await file.text(),'hello knowledge');
});

test('Service Desk API tokens expose scoped search and stable page details',async()=>{
  const token=await request(app.base,'/api/admin/tokens',{method:'POST',cookie:app.cookie,csrf:app.csrf,body:{name:'Service Desk',scopes:['search','read','health'],visibilities:['internal']}});assert.equal(token.res.status,201);assert.match(token.json.secret,/^kb_/);
  const headers={authorization:`Bearer ${token.json.secret}`};const health=await request(app.base,'/api/v1/health',{headers});assert.equal(health.json.ok,true);
  const search=await request(app.base,'/api/v1/search?q=locked',{headers});assert.equal(search.res.status,200);assert.equal(search.json.results[0].id,app.pageId);
  const page=await request(app.base,`/api/v1/pages/${app.pageId}`,{headers});assert.equal(page.res.status,200);assert.equal(page.json.title,'Reset a locked account');assert.match(page.json.html,/Reset account/);
});
