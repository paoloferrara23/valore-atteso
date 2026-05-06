const https = require('https');

function httpRequest(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const options = {
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: opts.method || 'GET',
      headers: opts.headers || {}
    };
    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({
        ok: res.statusCode >= 200 && res.statusCode < 300,
        status: res.statusCode,
        json: () => JSON.parse(data),
        text: () => data
      }));
    });
    req.on('error', reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

async function logRun(url, key, agent, status, summary, data={}) {
  await httpRequest(url + '/rest/v1/agent_runs', {
    method: 'POST',
    headers: {'Content-Type':'application/json','apikey':key,'Authorization':'Bearer '+key,'Prefer':'return=minimal'},
    body: JSON.stringify({agent, status, summary, data})
  }).catch(e => console.error('Log error:', e.message));
}

async function main() {
  const ANTHROPIC_KEY = process.env.ANTHROPIC_KEY;
  const SUPA_URL = process.env.SUPABASE_URL || 'https://xxnmkiwnjpppfzrftvuv.supabase.co';
  const SUPA_KEY = process.env.SUPABASE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh4bm1raXduanBwcGZ6cmZ0dnV2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY0MTkwNTUsImV4cCI6MjA5MTk5NTA1NX0.2EePZNm_OCc9WscYSG7CL_mbFV6E8ifwV9sP2WxkUo4';
  const RESEND_KEY = process.env.RESEND_KEY;
  const APPROVAL_EMAIL = process.env.APPROVAL_EMAIL;
  const SOGLIA_ANTHROPIC = parseFloat(process.env.SOGLIA_ANTHROPIC || '10');
  const SOGLIA_RESEND = parseFloat(process.env.SOGLIA_RESEND || '10');

  console.log('Cost Guardian avviato...');

  let anthropicCost = 0;
  let resendCost = 0;
  let alerts = [];
  let status = [];

  // 1. Controlla costi Anthropic
  try {
    const now = new Date();
    const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
    const today = now.toISOString().split('T')[0];

    const r = await httpRequest(`https://api.anthropic.com/v1/usage?start_date=${firstOfMonth}&end_date=${today}`, {
      headers: {
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01'
      }
    });

    if (r.ok) {
      const data = r.json();
      // Calcola costo totale dal usage
      const usage = data.usage || data.data || [];
      let inputTokens = 0;
      let outputTokens = 0;
      if (Array.isArray(usage)) {
        usage.forEach(u => {
          inputTokens += u.input_tokens || 0;
          outputTokens += u.output_tokens || 0;
        });
      }
      // Claude Opus: $15/M input, $75/M output
      anthropicCost = (inputTokens / 1000000 * 15) + (outputTokens / 1000000 * 75);
      console.log(`Anthropic: $${anthropicCost.toFixed(2)} (${inputTokens} input, ${outputTokens} output tokens)`);
    } else {
      // Fallback: stima basata su edizioni generate
      anthropicCost = 0;
      console.log('Anthropic usage API non disponibile, stima: $0');
    }
  } catch(e) {
    console.log('Errore Anthropic API:', e.message);
    anthropicCost = 0;
  }

  // Calcola percentuale soglia Anthropic
  const anthropicPct = Math.round((anthropicCost / SOGLIA_ANTHROPIC) * 100);
  status.push({ service: 'Anthropic API', cost: anthropicCost, soglia: SOGLIA_ANTHROPIC, pct: anthropicPct });
  if (anthropicCost >= SOGLIA_ANTHROPIC) {
    alerts.push(`🚨 ANTHROPIC: €${anthropicCost.toFixed(2)} — SOGLIA SUPERATA (€${SOGLIA_ANTHROPIC})`);
  } else if (anthropicPct >= 80) {
    alerts.push(`⚠️ ANTHROPIC: €${anthropicCost.toFixed(2)} — ${anthropicPct}% della soglia (€${SOGLIA_ANTHROPIC})`);
  }

  // 2. Controlla costi Resend
  try {
    const r = await httpRequest('https://api.resend.com/emails?limit=100', {
      headers: { Authorization: 'Bearer ' + RESEND_KEY }
    });
    if (r.ok) {
      const data = r.json();
      const emails = data.data || [];
      // Filtra email del mese corrente
      const now = new Date();
      const thisMonth = emails.filter(e => {
        const d = new Date(e.created_at);
        return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
      });
      // Resend: gratuito fino a 3000/mese, poi $0.001/email
      const emailCount = thisMonth.length;
      resendCost = emailCount > 3000 ? (emailCount - 3000) * 0.001 : 0;
      console.log(`Resend: ${emailCount} email questo mese, costo: $${resendCost.toFixed(2)}`);
    }
  } catch(e) {
    console.log('Errore Resend API:', e.message);
  }

  const resendPct = resendCost > 0 ? Math.round((resendCost / SOGLIA_RESEND) * 100) : 0;
  status.push({ service: 'Resend', cost: resendCost, soglia: SOGLIA_RESEND, pct: resendPct });
  if (resendCost >= SOGLIA_RESEND) {
    alerts.push(`🚨 RESEND: €${resendCost.toFixed(2)} — SOGLIA SUPERATA (€${SOGLIA_RESEND})`);
  } else if (resendPct >= 80) {
    alerts.push(`⚠️ RESEND: €${resendCost.toFixed(2)} — ${resendPct}% della soglia (€${SOGLIA_RESEND})`);
  }

  // 3. Costruisci report
  const now = new Date();
  const mese = now.toLocaleDateString('it-IT', { month: 'long', year: 'numeric' });

  const statusRows = status.map(s => {
    const barWidth = Math.min(s.pct, 100);
    const barColor = s.pct >= 100 ? '#B5221A' : s.pct >= 80 ? '#F5A623' : '#1A3A2A';
    return `<tr>
      <td style="padding:12px 16px;font-family:'Courier New',monospace;font-size:11px;font-weight:600;color:#111010;border-bottom:1px solid #C8C4BB">${s.service}</td>
      <td style="padding:12px 16px;font-family:'Courier New',monospace;font-size:11px;color:#3D3C39;border-bottom:1px solid #C8C4BB">€${s.cost.toFixed(2)} / €${s.soglia}</td>
      <td style="padding:12px 16px;border-bottom:1px solid #C8C4BB;min-width:120px">
        <div style="background:#EDE9E0;height:8px;border-radius:4px;overflow:hidden">
          <div style="background:${barColor};height:8px;width:${barWidth}%;border-radius:4px"></div>
        </div>
        <div style="font-family:'Courier New',monospace;font-size:9px;color:#888480;margin-top:3px">${s.pct}%</div>
      </td>
    </tr>`;
  }).join('');

  const alertsHTML = alerts.length > 0
    ? `<tr><td colspan="3" style="padding:16px;background:rgba(181,34,26,.08);border-left:3px solid #B5221A">
        <p style="font-family:'Courier New',monospace;font-size:10px;color:#B5221A;font-weight:600;margin:0 0 6px">ALERT</p>
        ${alerts.map(a => `<p style="font-family:'Courier New',monospace;font-size:10px;color:#B5221A;margin:0">${a}</p>`).join('')}
      </td></tr>`
    : `<tr><td colspan="3" style="padding:12px 16px;background:#E8F0EB;border-left:3px solid #1A3A2A">
        <p style="font-family:'Courier New',monospace;font-size:10px;color:#1A3A2A;margin:0">✓ Tutto nella norma — nessuna soglia superata</p>
      </td></tr>`;

  const emailHTML = `<table width="560" style="max-width:560px;margin:0 auto;background:#F7F4EE;font-family:Georgia,serif">
    <tr><td style="padding:18px 24px;background:#111010;text-align:center">
      <h1 style="color:#F7F4EE;font-size:20px;font-weight:900;letter-spacing:-1px;margin:0">Valore Atteso</h1>
      <p style="font-family:'Courier New',monospace;font-size:9px;color:rgba(255,255,255,.5);letter-spacing:.12em;text-transform:uppercase;margin:4px 0 0">Cost Guardian · Report ${mese}</p>
    </td></tr>
    <tr><td style="padding:0">
      <table width="100%" style="border-collapse:collapse">
        <tr>
          <th style="padding:10px 16px;font-family:'Courier New',monospace;font-size:9px;letter-spacing:.1em;text-transform:uppercase;color:#888480;text-align:left;border-bottom:2px solid #111010;background:#EDE9E0">Servizio</th>
          <th style="padding:10px 16px;font-family:'Courier New',monospace;font-size:9px;letter-spacing:.1em;text-transform:uppercase;color:#888480;text-align:left;border-bottom:2px solid #111010;background:#EDE9E0">Costo / Soglia</th>
          <th style="padding:10px 16px;font-family:'Courier New',monospace;font-size:9px;letter-spacing:.1em;text-transform:uppercase;color:#888480;text-align:left;border-bottom:2px solid #111010;background:#EDE9E0">Utilizzo</th>
        </tr>
        ${statusRows}
        ${alertsHTML}
      </table>
    </td></tr>
    <tr><td style="padding:14px 24px;border-top:1px solid #C8C4BB">
      <p style="font-family:'Courier New',monospace;font-size:9px;color:#888480;margin:0">Report automatico · Valore Atteso Cost Guardian · ${now.toLocaleDateString('it-IT')}</p>
    </td></tr>
  </table>`;

  // 4. Invia email report
  console.log('Invio report a', APPROVAL_EMAIL);
  const subject = alerts.length > 0
    ? `🚨 Cost Guardian — Alert costi Valore Atteso`
    : `✓ Cost Guardian — Report costi ${mese}`;

  const emailRes = await httpRequest('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + RESEND_KEY
    },
    body: JSON.stringify({
      from: 'Valore Atteso <onboarding@resend.dev>',
      to: APPROVAL_EMAIL,
      subject,
      html: emailHTML
    })
  });

  console.log('Report inviato, status:', emailRes.status);
  if (alerts.length > 0) {
    console.log('ALERT:', alerts.join(' | '));
    process.exit(1); // Fa fallire il workflow e notifica GitHub
  }
  console.log('Cost Guardian completato — tutto OK');
}

main().catch(e => { console.error('ERRORE:', e.message); process.exit(1); });
