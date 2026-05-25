// ─────────────────────────────────────────────
// CONFERMA iscrizione
// ─────────────────────────────────────────────

if (action === 'conferma' && token) {

  const r = await fetch(`${process.env.SUPABASE_URL}/rest/v1/subscribers?token=eq.${token}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'apikey': process.env.SUPABASE_KEY,
      'Authorization': `Bearer ${process.env.SUPABASE_KEY}`,
      'Prefer': 'return=representation'
    },
    body: JSON.stringify({
      confirmed: true,
      token: null
    })
  });

  const rows = await r.json();

  if (!r.ok || !rows?.length) {
    return res.status(400).json({ error: 'Token non valido' });
  }

  const userEmail = rows[0].email;

  // ─────────────────────────────────────────────
  // EMAIL DI BENVENUTO
  // ─────────────────────────────────────────────

  const welcomeHtml = `
<!DOCTYPE html>
<html lang="it">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
</head>

<body style="margin:0;padding:0;background:#D8D0C4;">

<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#D8D0C4;">
<tr>
<td align="center" style="padding:0;">

<table width="640" cellpadding="0" cellspacing="0" border="0" style="max-width:640px;width:100%;background:#F0EBE1;">

  <!-- TOP BAR -->
  <tr>
    <td style="background:#1C1914;padding:7px 28px;">
      <table width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td style="font-family:'Courier New',monospace;font-size:9px;color:rgba(255,255,255,0.45);">
            Benvenuto in Valore Atteso
          </td>

          <td align="right" style="font-family:'Courier New',monospace;font-size:9px;color:rgba(255,255,255,0.4);text-transform:uppercase;letter-spacing:.08em;">
            Valore Atteso
          </td>
        </tr>
      </table>
    </td>
  </tr>

  <!-- LOGO -->
  <tr>
    <td style="background:#F0EBE1;padding:18px 28px 16px;border-bottom:3px solid #1C1914;">

      <table width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr>

          <td>
            <table cellpadding="0" cellspacing="0" border="0">
              <tr>

                <td style="width:34px;height:34px;border:2px solid #1C1914;text-align:center;vertical-align:middle;font-family:'Courier New',monospace;font-size:10px;font-weight:700;color:#1C1914;">
                  VA
                </td>

                <td style="padding-left:14px;">
                  <div style="font-family:Georgia,serif;font-size:22px;font-weight:900;letter-spacing:-1px;color:#1C1914;line-height:1;">
                    VALORE ATTESO
                  </div>

                  <div style="font-family:'Courier New',monospace;font-size:8px;letter-spacing:.16em;color:#777066;text-transform:uppercase;margin-top:2px;">
                    Il calcio dei numeri, non dei goal.
                  </div>
                </td>

              </tr>
            </table>
          </td>

        </tr>
      </table>

    </td>
  </tr>

  <!-- HERO -->
  <tr>
    <td style="background:#1C1914;padding:32px 28px 28px;">

      <div style="font-family:'Courier New',monospace;font-size:8px;letter-spacing:.16em;color:#8E6B33;text-transform:uppercase;margin-bottom:12px;">
        — Benvenuto
      </div>

      <h1 style="font-family:Georgia,serif;font-size:26px;font-weight:900;color:#FFFDF8;line-height:1.1;letter-spacing:-1px;margin:0 0 16px;">
        Analisi, non rumore.
      </h1>

      <p style="font-family:Georgia,serif;font-size:14px;color:rgba(240,235,225,0.75);font-weight:300;line-height:1.85;margin:0 0 14px;">
        Ogni martedì mattina trovi nella tua inbox un bilancio analizzato, un deal sezionato e una metrica spiegata.
        In 8 minuti, con il caffè, prima di una riunione.
      </p>

      <p style="font-family:Georgia,serif;font-size:14px;color:rgba(240,235,225,0.75);font-weight:300;line-height:1.85;margin:0 0 26px;">
        Nel frattempo puoi esplorare le analisi già pubblicate nell’archivio di Valore Atteso.
      </p>

      <a href="${SITE}/archivio.html"
         style="display:inline-block;background:#C8A97A;color:#1C1914;
         font-family:'Courier New',monospace;
         font-size:9px;
         font-weight:600;
         letter-spacing:.12em;
         text-transform:uppercase;
         padding:12px 28px;
         text-decoration:none;">

         Vai all’archivio →

      </a>

    </td>
  </tr>

  <!-- FOOTER -->
  <tr>
    <td style="background:#E7DFD2;border-top:3px solid #1C1914;padding:16px 28px;text-align:center;">

      <p style="font-family:'Courier New',monospace;font-size:8.5px;color:#9A9690;letter-spacing:.04em;margin:0;">
        Per cancellarti
        <a href="${SITE}/cancella.html?email=${encodeURIComponent(userEmail)}"
           style="color:#777066;text-decoration:underline;">
           clicca qui
        </a>.
      </p>

    </td>
  </tr>

</table>

</td>
</tr>
</table>

</body>
</html>
`;

  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${RESEND_KEY}`
    },
    body: JSON.stringify({
      from: FROM,
      to: userEmail,
      subject: 'Benvenuto in Valore Atteso',
      html: welcomeHtml
    })
  }).catch(e => console.error('Welcome email error:', e));

  return res.status(200).json({ ok: true });
}
