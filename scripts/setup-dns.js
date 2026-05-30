// scripts/setup-dns.js — Aggiunge record DNS su Vercel per deliverability email
const VERCEL_TOKEN = process.env.VERCEL_TOKEN;
const DOMAIN = 'valoreatteso.com';

async function vercelAPI(path, method = 'GET', body = null) {
  const opts = {
    method,
    headers: { 'Authorization': `Bearer ${VERCEL_TOKEN}`, 'Content-Type': 'application/json' }
  };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(`https://api.vercel.com${path}`, opts);
  const text = await r.text();
  try { return { ok: r.ok, status: r.status, data: JSON.parse(text) }; }
  catch { return { ok: r.ok, status: r.status, data: text }; }
}

async function addDnsRecord(type, name, value, ttl = 300) {
  const res = await vercelAPI(`/v2/domains/${DOMAIN}/records`, 'POST', { type, name, value, ttl });
  if (res.ok) {
    console.log(`✓ ${type} ${name} aggiunto`);
  } else if (JSON.stringify(res.data).includes('already exists') || JSON.stringify(res.data).includes('conflict')) {
    console.log(`⚠ ${type} ${name} già esiste — skip`);
  } else {
    console.error(`✗ ${type} ${name}: ${JSON.stringify(res.data)}`);
  }
}

async function main() {
  console.log('Setup DNS deliverability per', DOMAIN);

  // 1. DMARC — fondamentale per inbox placement
  await addDnsRecord('TXT', '_dmarc', 'v=DMARC1; p=none; rua=mailto:info@valoreatteso.com; ruf=mailto:info@valoreatteso.com; fo=1');

  // 2. Verifica record Resend già configurati
  const records = await vercelAPI(`/v2/domains/${DOMAIN}/records`);
  if (records.ok) {
    const existing = records.data.records || [];
    console.log('\nRecord DNS esistenti:');
    existing.forEach(r => console.log(`  ${r.type} ${r.name} → ${r.value?.slice(0,60)}`));

    const hasSPF = existing.some(r => r.type === 'TXT' && r.value?.includes('v=spf'));
    const hasDKIM = existing.some(r => r.name?.includes('_domainkey'));
    console.log(`\nSPF: ${hasSPF ? '✓' : '✗ MANCANTE'}`);
    console.log(`DKIM: ${hasDKIM ? '✓' : '✗ MANCANTE — configurare su Resend'}`);
  }

  console.log('\nSetup DNS completato.');
}

main().catch(e => { console.error('ERRORE:', e.message); process.exit(1); });
