// scripts/qa-serve.js — server statico per la QA che imita Vercel (cleanUrls, 404.html con 404, CSP): node scripts/qa-serve.js <root> <port>
const http=require('http'),fs=require('fs'),path=require('path');
const root=path.resolve(process.argv[2]),port=+process.argv[3];
const v=JSON.parse(fs.readFileSync(path.join(root,'vercel.json')));const CSP=v.headers[0].headers.find(h=>h.key==='Content-Security-Policy').value;
const T={'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon','.webmanifest':'application/manifest+json','.woff2':'font/woff2','.txt':'text/plain','.xml':'application/xml'};
http.createServer((q,r)=>{const p=decodeURIComponent(new URL(q.url,'http://x').pathname);if(p.startsWith('/api/')){r.writeHead(404);return r.end();}
const c=p==='/'?['index.html']:[p.slice(1),p.slice(1)+'.html'];const f=c.map(x=>path.join(root,x)).find(x=>fs.existsSync(x)&&fs.statSync(x).isFile());
const h={'Content-Security-Policy':CSP,'X-Content-Type-Options':'nosniff','Cache-Control':'public, max-age=0, must-revalidate'};
if(f){r.writeHead(200,{...h,'Content-Type':T[path.extname(f)]||'application/octet-stream'});return r.end(fs.readFileSync(f));}
const nf=path.join(root,'404.html');r.writeHead(404,{...h,'Content-Type':'text/html; charset=utf-8'});r.end(fs.existsSync(nf)?fs.readFileSync(nf):'Not found');}).listen(port);
