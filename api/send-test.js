// api/send-test.js
// CommonJS — Vercel serverless function

const sendNewsletter = require('./send-newsletter');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { edition_num, edition_id } = req.body;

    // Importiamo lo stesso buildHtml del file principale
    const { createClient } = require('@supabase/supabase-js');
    const { Resend } = require('resend');

    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_KEY
    );

    const resend = new Resend(process.env.RESEND_KEY);

    let query = supabase
      .from('editions')
      .select('*');

    if (edition_id) {
      query = query.eq('id', edition_id);
    } else if (edition_num) {
      query = query.eq('num', String(edition_num).padStart(3, '0'));
    } else {
      return res.status(400).json({
        error: 'Parametro edition_num o edition_id obbligatorio'
      });
    }

    const { data: editions, error } = await query.limit(1);

    if (error) {
      throw new Error(error.message);
    }

    if (!editions || !editions.length) {
      throw new Error('Edizione non trovata');
    }

    const edition = editions[0];

    // IMPORTANTE:
    // recuperiamo la funzione buildHtml dal file originale
    const fs = require('fs');
    const path = require('path');

    const filePath = path.join(process.cwd(), 'api', 'send-newsletter.js');
    const fileContent = fs.readFileSync(filePath, 'utf8');

    const buildHtmlMatch = fileContent.match(
      /function buildHtml\(edition\) \{([\s\S]*?)return `<!DOCTYPE html>/
    );

    if (!buildHtmlMatch) {
      throw new Error('Impossibile leggere buildHtml');
    }

    // Metodo semplice: utilizziamo direttamente il file originale
    delete require.cache[require.resolve('./send-newsletter')];
    require('./send-newsletter');

    // Estraggo buildHtml dinamicamente
    const vm = require('vm');

    const sandbox = {
      module: {},
      exports: {},
      require,
      process,
      console,
    };

    vm.createContext(sandbox);
    vm.runInContext(fileContent, sandbox);

    const buildHtml = sandbox.buildHtml;

    if (!buildHtml) {
      throw new Error('buildHtml non disponibile');
    }

    const html = buildHtml(edition)
      .replace('{{EMAIL}}', encodeURIComponent('info@valoreatteso.com'))
      .replace(
        '{{WEBVIEW_URL}}',
        `https://valoreatteso.com/archivio#${edition.num}`
      );

    const subject = `[TEST] #${edition.num} - ${edition.title}`;

    const result = await resend.emails.send({
      from: 'Valore Atteso <info@valoreatteso.com>',
      to: 'info@valoreatteso.com',
      subject,
      html,
    });

    return res.status(200).json({
      ok: true,
      sent: true,
      id: result.data?.id || null,
    });

  } catch (err) {
    console.error('[send-test]', err);

    return res.status(500).json({
      error: err.message
    });
  }
};
