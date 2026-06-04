// scripts/setup-env.js — Aggiunge env var su Vercel via API
// Usato una tantum per configurare il progetto

const VERCEL_TOKEN = process.env.VERCEL_TOKEN;
const VERCEL_PROJECT = 'valore-atteso';

const ENV_VARS = [
  { key: 'GOOGLE_DRIVE_API_KEY',   value: process.env.GOOGLE_DRIVE_API_KEY,   target: ['production','preview','development'] },
  { key: 'GOOGLE_DRIVE_FOLDER_ID', value: process.env.GOOGLE_DRIVE_FOLDER_ID, target: ['production','preview','development'] },
  { key: 'GH_TOKEN',               value: process.env.GH_PAT,                 target: ['production','preview','development'] },
  { key: 'SITE_URL',               value: 'https://valoreatteso.com',          target: ['production','preview','development'] },
];

async function main() {
  // Trova project ID
  const projRes = await fetch(`https://api.vercel.com/v9/projects/${VERCEL_PROJECT}`, {
    headers: { 'Authorization': `Bearer ${VERCEL_TOKEN}` }
  });
  const proj = await projRes.json();
  if (!projRes.ok) throw new Error(`Progetto non trovato: ${JSON.stringify(proj)}`);
  const projectId = proj.id;
  console.log(`Progetto: ${proj.name} (${projectId})`);

  // Aggiungi ogni env var
  for (const env of ENV_VARS) {
    if (!env.value) { console.log(`Skip ${env.key} — valore mancante`); continue; }

    const r = await fetch(`https://api.vercel.com/v10/projects/${projectId}/env`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${VERCEL_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: env.key, value: env.value, type: 'encrypted', target: env.target })
    });
    const data = await r.json();
    if (r.ok) console.log(`✓ ${env.key} aggiunta`);
    else if (data.error?.code === 'ENV_ALREADY_EXISTS') console.log(`⚠ ${env.key} già esiste — skip`);
    else console.error(`✗ ${env.key}: ${JSON.stringify(data.error)}`);
  }

  // Triggera redeploy
  const deployRes = await fetch(`https://api.vercel.com/v13/deployments`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${VERCEL_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: VERCEL_PROJECT,
      gitSource: { type: 'github', repoId: '916543020', ref: 'main' }
    })
  });
  const deploy = await deployRes.json();
  if (deployRes.ok) console.log(`✓ Redeploy avviato: ${deploy.url}`);
  else console.log(`Deploy: ${JSON.stringify(deploy.error || deploy)}`);

  console.log('Setup completato.');
}

main().catch(e => { console.error('ERRORE:', e.message); process.exit(1); });
