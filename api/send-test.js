const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

const resend = new Resend(process.env.RESEND_KEY);

function esc(s=''){
  return String(s)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;');
}

function buildHtml(edition){

  const sections = edition.sections || [];

  const sectionsHtml = sections.map(section => {

    const kpis = (section.kpis || []).map(k => `
      <tr>
        <td style="padding:10px 0;border-bottom:1px solid #E7DFD2;color:#6E675F;font-family:Arial,sans-serif;font-size:13px;">
          ${esc(k.label)}
        </td>

        <td style="padding:10px 0;border-bottom:1px solid #E7DFD2;text-align:right;color:#1C1914;font-weight:700;font-family:Arial,sans-serif;font-size:13px;">
          ${esc(k.value)}
        </td>
      </tr>
    `).join('');

    const sources = (section.sources || []).map(s => `
      <div style="padding:4px 0;color:#6E675F;font-size:12px;">
        • ${esc(s)}
      </div>
    `).join('');

    return `
      <div style="margin-bottom:50px;">

        <div style="
          font-family:Arial,sans-serif;
          font-size:11px;
          letter-spacing:.14em;
          text-transform:uppercase;
          color:#B08A4A;
          margin-bottom:14px;
        ">
          ${esc(section.label)}
        </div>

        <h2 style="
          font-family:Georgia,serif;
          font-size:34px;
          line-height:1.15;
          color:#1C1914;
          margin:0 0 18px;
        ">
          ${esc(section.title)}
        </h2>

        <div style="
          font-family:Georgia,serif;
          font-size:18px;
          line-height:1.9;
          color:#3F3A35;
          margin-bottom:24px;
        ">
          ${String(section.body || '').replace(/\n/g,'<br><br>')}
        </div>

        ${kpis ? `
          <table width="100%" cellpadding="0" cellspacing="0" style="
            background:#F7F3EC;
            border:1px solid #E7DFD2;
            border-radius:16px;
            padding:20px;
            margin-bottom:20px;
          ">
            ${kpis}
          </table>
        ` : ''}

        ${section.verdict ? `
          <div style="
            background:#1C1914;
            color:#F0EBE1;
            padding:20px 22px;
            border-radius:16px;
            font-family:Georgia,serif;
            font-size:17px;
            line-height:1.7;
            margin-bottom:18px;
          ">
            ${esc(section.verdict)}
          </div>
        ` : ''}

        ${sources ? `
          <div style="
            background:#F7F3EC;
            border:1px solid #E7DFD2;
            border-radius:14px;
            padding:16px 18px;
          ">
            <div style="
              font-family:Arial,sans-serif;
              font-size:10px;
              letter-spacing:.12em;
              text-transform:uppercase;
              color:#8E6B33;
              margin-bottom:10px;
            ">
              Fonti
            </div>

            ${sources}
          </div>
        ` : ''}

      </div>
    `;

  }).join('');

  return `
  <!DOCTYPE html>
  <html lang="it">

  <head>
    <meta charset="UTF-8">
    <title>Valore Atteso</title>
  </head>

  <body style="
    margin:0;
    padding:0;
    background:#F0EBE1;
  ">

    <table width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td align="center">

          <table width="760" cellpadding="0" cellspacing="0" style="
            width:760px;
            max-width:760px;
            background:#F0EBE1;
            padding:50px 42px;
          ">

            <tr>
              <td>

                <div style="
                  font-family:Arial,sans-serif;
                  font-size:11px;
                  letter-spacing:.18em;
                  text-transform:uppercase;
                  color:#8E6B33;
                  margin-bottom:12px;
                ">
                  Valore Atteso
                </div>

                <h1 style="
                  font-family:Georgia,serif;
                  font-size:52px;
                  line-height:1.04;
                  color:#1C1914;
                  margin:0 0 20px;
                ">
                  ${esc(edition.title)}
                </h1>

                <div style="
                  font-family:Georgia,serif;
                  font-size:22px;
                  line-height:1.7;
                  color:#4C453D;
                  margin-bottom:50px;
                ">
                  ${esc(edition.subtitle || '')}
                </div>

                ${sectionsHtml}

                <div style="
                  border-top:1px solid #D8CFC1;
                  margin-top:50px;
                  padding-top:24px;
                  font-family:Arial,sans-serif;
                  font-size:12px;
                  color:#6E675F;
                  line-height:1.8;
                ">
                  Valore Atteso · Il calcio dei numeri, non dei goal.<br>
                  Newsletter settimanale sul business del calcio europeo.
                </div>

              </td>
            </tr>

          </table>

        </td>
      </tr>
    </table>

  </body>
  </html>
  `;
}

module.exports = async (req, res) => {

  if(req.method !== 'POST'){
    return res.status(405).json({
      error:'Method not allowed'
    });
  }

  try{

    const { edition_num, test_email } = req.body;

    if(!edition_num){
      return res.status(400).json({
        error:'edition_num mancante'
      });
    }

    const { data: edition } = await supabase
      .from('editions')
      .select('*')
      .eq('num', edition_num)
      .single();

    if(!edition){
      return res.status(404).json({
        error:'Edizione non trovata'
      });
    }

    const html = buildHtml(edition);

    await resend.emails.send({
      from:'Valore Atteso <info@valoreatteso.com>',
      to:test_email || 'info@valoreatteso.com',
      subject:`[TEST] Valore Atteso #${edition.num} — ${edition.title}`,
      html
    });

    return res.status(200).json({
      ok:true,
      sent_to:test_email || 'info@valoreatteso.com'
    });

  }catch(e){

    return res.status(500).json({
      error:e.message
    });

  }

};
