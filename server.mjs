import http from 'node:http';
import {readFile, readdir} from 'node:fs/promises';
import {extname, join, normalize, relative} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT=fileURLToPath(new URL('.',import.meta.url));
const ARTICLES=join(ROOT,'articles');
const PUBLIC=join(ROOT,'public');
const PORT=Number(process.env.PORT||8080);
const BRAND=process.env.KB_BRAND||'iTELade Knowledge Base';
const DEFAULT_LANG=process.env.KB_DEFAULT_LANG||'en';

const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

async function walk(dir){
  const out=[];
  for(const entry of await readdir(dir,{withFileTypes:true}).catch(()=>[])){
    const path=join(dir,entry.name);
    if(entry.isDirectory()) out.push(...await walk(path));
    else if(entry.isFile()&&entry.name.endsWith('.md')) out.push(path);
  }
  return out;
}

function parseFrontMatter(raw){
  const text=String(raw);
  if(!text.startsWith('---\n')) return {meta:{},body:text};
  const end=text.indexOf('\n---\n',4);
  if(end<0) return {meta:{},body:text};
  const head=text.slice(4,end).split('\n');
  const meta={};let listKey=null;
  for(const line of head){
    const item=line.match(/^\s*-\s+(.+)$/);
    if(item&&listKey){meta[listKey].push(item[1].trim().replace(/^['"]|['"]$/g,''));continue;}
    const m=line.match(/^([A-Za-z0-9_.-]+):\s*(.*)$/);
    if(!m) continue;
    const [,key,valueRaw]=m;const value=valueRaw.trim();listKey=null;
    if(value===''){meta[key]=[];listKey=key;continue;}
    if(value==='null') meta[key]=null;
    else if(value==='true'||value==='false') meta[key]=value==='true';
    else meta[key]=value.replace(/^['"]|['"]$/g,'');
  }
  return {meta,body:text.slice(end+5).trim()};
}

function markdown(src){
  const lines=esc(src).split('\n');let inCode=false,inList=false;const out=[];
  for(const raw of lines){
    if(raw.startsWith('```')){if(inList){out.push('</ul>');inList=false;}inCode=!inCode;out.push(inCode?'<pre><code>':'</code></pre>');continue;}
    if(inCode){out.push(raw+'\n');continue;}
    const line=raw.replace(/`([^`]+)`/g,'<code>$1</code>').replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>').replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,'<a href="$2" rel="noreferrer">$1</a>');
    const h=line.match(/^(#{1,4})\s+(.+)$/);if(h){if(inList){out.push('</ul>');inList=false;}out.push(`<h${h[1].length}>${h[2]}</h${h[1].length}>`);continue;}
    const li=line.match(/^[-*]\s+(.+)$/);if(li){if(!inList){out.push('<ul>');inList=true;}out.push(`<li>${li[1]}</li>`);continue;}
    if(inList){out.push('</ul>');inList=false;}
    if(!line.trim()) out.push(''); else out.push(`<p>${line}</p>`);
  }
  if(inList)out.push('</ul>');if(inCode)out.push('</code></pre>');return out.join('\n');
}

async function loadArticles(){
  const files=await walk(ARTICLES);const articles=[];
  for(const file of files){
    const raw=await readFile(file,'utf8');const {meta,body}=parseFrontMatter(raw);if(meta.status&&meta.status!=='published')continue;
    const rel=relative(ARTICLES,file).replaceAll('\\','/');const parts=rel.split('/');const language=meta.language||parts[0]||DEFAULT_LANG;
    const slug=meta.slug||parts.at(-1).replace(/\.md$/,'');
    articles.push({id:meta.article_id||rel,language,category:meta.category||parts.at(-2)||'general',slug,title:meta.title||slug.replaceAll('-',' '),summary:meta.summary||'',visibility:meta.visibility||'public',tags:Array.isArray(meta.tags)?meta.tags:[],body,rel});
  }
  return articles.filter(a=>a.visibility==='public').sort((a,b)=>a.title.localeCompare(b.title));
}

function shell(title,body,{search=''}={}){return `<!doctype html><html lang="pl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#08111f"><title>${esc(title)} · ${esc(BRAND)}</title><link rel="stylesheet" href="/style.css"></head><body><header><a class="brand" href="/">${esc(BRAND)}</a><form action="/" method="get"><input name="q" value="${esc(search)}" placeholder="Szukaj w bazie wiedzy…" aria-label="Szukaj"><button>Szukaj</button></form></header><main>${body}</main><footer>iTELade · Service Desk Knowledge Base</footer></body></html>`}

function cards(items){if(!items.length)return '<div class="empty">Brak pasujących artykułów.</div>';return `<div class="grid">${items.map(a=>`<a class="card" href="/article/${encodeURIComponent(a.language)}/${encodeURIComponent(a.slug)}"><span class="pill">${esc(a.category)}</span><h2>${esc(a.title)}</h2><p>${esc(a.summary||'')}</p><small>${esc(a.language.toUpperCase())}</small></a>`).join('')}</div>`}

const server=http.createServer(async(req,res)=>{
  try{
    const url=new URL(req.url,'http://localhost');
    if(url.pathname==='/healthz'){res.writeHead(200,{'content-type':'application/json'});return res.end(JSON.stringify({ok:true,service:'knowledge-base'}));}
    if(url.pathname==='/style.css'){res.writeHead(200,{'content-type':'text/css; charset=utf-8','cache-control':'public,max-age=300'});return res.end(await readFile(join(PUBLIC,'style.css'),'utf8'));}
    const articles=await loadArticles();
    if(url.pathname==='/'){
      const q=(url.searchParams.get('q')||'').trim().toLowerCase();const lang=url.searchParams.get('lang')||'';
      const filtered=articles.filter(a=>(!lang||a.language===lang)&&(!q||`${a.title} ${a.summary} ${a.body} ${a.tags.join(' ')}`.toLowerCase().includes(q)));
      const langs=[...new Set(articles.map(a=>a.language))].sort();const nav=langs.map(l=>`<a class="chip" href="/?lang=${encodeURIComponent(l)}">${esc(l.toUpperCase())}</a>`).join('');
      res.writeHead(200,{'content-type':'text/html; charset=utf-8'});return res.end(shell(BRAND,`<section class="hero"><p class="eyebrow">iTELade Service Desk</p><h1>Baza wiedzy</h1><p>Instrukcje, rozwiązania problemów i dokumentacja usług.</p><div class="chips"><a class="chip" href="/">ALL</a>${nav}</div></section>${cards(filtered)}`,{search:q}));
    }
    const m=url.pathname.match(/^\/article\/([^/]+)\/([^/]+)$/);
    if(m){const language=decodeURIComponent(m[1]),slug=decodeURIComponent(m[2]);const a=articles.find(x=>x.language===language&&x.slug===slug);if(!a){res.writeHead(404);return res.end('Not found');}
      res.writeHead(200,{'content-type':'text/html; charset=utf-8'});return res.end(shell(a.title,`<article><a class="back" href="/">← Baza wiedzy</a><div class="article-head"><span class="pill">${esc(a.category)}</span><h1>${esc(a.title)}</h1><p>${esc(a.summary)}</p></div><div class="content">${markdown(a.body)}</div></article>`));}
    res.writeHead(404,{'content-type':'text/plain; charset=utf-8'});res.end('Not found');
  }catch(err){console.error(err);res.writeHead(500,{'content-type':'text/plain; charset=utf-8'});res.end('Internal server error');}
});

server.listen(PORT,'0.0.0.0',()=>console.log(`Knowledge Base listening on :${PORT}`));
