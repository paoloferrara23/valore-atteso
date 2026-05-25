const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

const resend = new Resend(process.env.RESEND_KEY);

module.exports = async (req, res) => {

  if(req.method !== 'POST'){
    return res.status(405).json({
      error:'Method not allowed'
    });
  }

  try{

    const { edition_num, test_email } = req.body;

    const { data:edition } = await supabase
      .from('editions')
      .select('*')
      .eq('num', edition_num)
      .single();

    if(!edition){
      return res.status(404).json({
        error:'Edizione non trovata'
      });
    }

    const html = `
      <div style="font-family:Georgia;padding:40px;background:#F5F2EB;color:#1A1A1A">
        <h1>${edition.title}</h1>
        <p>${edition.subtitle || ''}</p>
      </div>
    `;

    await resend.emails.send({
      from:'Valore Atteso <info@valoreatteso.com>',
      to:test_email,
      subject:`[TEST] Valore Atteso #${edition.num}`,
      html
    });

    return res.status(200).json({
      ok:true,
      sent_to:test_email
    });

  }catch(e){

    return res.status(500).json({
      error:e.message
    });

  }

};
