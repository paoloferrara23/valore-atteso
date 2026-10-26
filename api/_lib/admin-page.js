// api/_lib/admin-page.js — Serve la Control Room su /admin solo a chi ha la sessione.
// Senza sessione risponde con la sola pagina di login: l'interfaccia interna
// (api/_admin/control-room.html) non esce mai dal server.

const fs = require('fs');
const path = require('path');
const { adminSecret, isAdmin } = require('./admin-auth');

const ADMIN_HEADERS = {
  'Cache-Control': 'no-store',
  'X-Robots-Tag': 'noindex, nofollow',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Content-Type': 'text/html; charset=utf-8',
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: https:",
    "connect-src 'self'",
    "frame-src 'self' blob: about:",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'self'"
  ].join('; ')
};

function loginPage(message) {
  return `<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Accesso riservato</title>
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#F4EFE6;font-family:Georgia,serif;color:#1C1914}form{width:100%;max-width:340px;background:#FFFDF8;border:1px solid #D8D0C4;border-radius:20px;padding:32px;margin:16px}h1{font-size:1.6rem;margin:0 0 20px;text-align:center}input{width:100%;box-sizing:border-box;height:44px;border:1px solid #D8D0C4;border-radius:999px;padding:0 16px;font-size:14px;margin-bottom:10px}button{width:100%;height:44px;border:0;border-radius:999px;background:#1C1914;color:#F4EFE6;font-size:12px;letter-spacing:.12em;text-transform:uppercase;cursor:pointer}p{font-family:monospace;font-size:11px;color:#B93A2F;text-align:center;min-height:14px;margin:12px 0 0}</style></head>
<body><form id="f"><h1>Accesso riservato</h1><input type="password" id="pw" autocomplete="current-password" placeholder="Password" required autofocus><button type="submit">Entra</button><p id="msg">${message || ''}</p></form>
<script>
document.getElementById('f').addEventListener('submit',async function(e){
  e.preventDefault();var msg=document.getElementById('msg');msg.textContent='';
  try{var r=await fetch('/api/admin-login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:document.getElementById('pw').value})});
  var d=await r.json().catch(function(){return {};});
  if(r.ok&&d.ok){location.reload();return;}
  msg.textContent=d.error||'Accesso non riuscito';document.getElementById('pw').value='';}
  catch(err){msg.textContent='Errore di rete';}
});
</script></body></html>`;
}

module.exports = function adminPage(req, res) {
  Object.entries(ADMIN_HEADERS).forEach(([k, v]) => res.setHeader(k, v));
  if (!adminSecret()) return res.status(503).send(loginPage('Accesso admin non ancora configurato.'));
  if (!isAdmin(req)) return res.status(200).send(loginPage(''));
  const html = fs.readFileSync(path.join(__dirname, '..', '_admin', 'control-room.html'), 'utf8');
  return res.status(200).send(html);
};
