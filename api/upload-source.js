// api/upload-source.js
// CommonJS — Vercel serverless function

const formidable = require('formidable');
const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

module.exports.config = {
  api: {
    bodyParser: false,
  },
};

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const form = formidable.formidable
      ? formidable.formidable({ multiples: false })
      : formidable({ multiples: false });

    form.parse(req, async (err, fields, files) => {
      try {
        if (err) {
          return res.status(500).json({ error: err.message });
        }

        const file = Array.isArray(files.file) ? files.file[0] : files.file;

        if (!file) {
          return res.status(400).json({ error: 'File obbligatorio' });
        }

        const originalFilename =
          file.originalFilename ||
          file.name ||
          'documento';

        const cleanFileName = originalFilename.replace(/\.[^/.]+$/, '');

        const nome =
          (Array.isArray(fields.nome) ? fields.nome[0] : fields.nome) ||
          cleanFileName;

        const tipo =
          (Array.isArray(fields.tipo) ? fields.tipo[0] : fields.tipo) ||
          'report';

        const soggetto =
          (Array.isArray(fields.soggetto) ? fields.soggetto[0] : fields.soggetto) ||
          null;

        const anno =
          (Array.isArray(fields.anno) ? fields.anno[0] : fields.anno) ||
          null;

        const stagione =
          (Array.isArray(fields.stagione) ? fields.stagione[0] : fields.stagione) ||
          null;

        const filepath = file.filepath || file.path;

        if (!filepath) {
          return res.status(400).json({ error: 'Percorso file non trovato' });
        }

        const buffer = fs.readFileSync(filepath);

        const safeFilename = originalFilename.replace(/[^a-zA-Z0-9._-]/g, '_');
        const storagePath = `${Date.now()}-${safeFilename}`;

        const { error: uploadErr } = await supabase.storage
          .from('sources')
          .upload(storagePath, buffer, {
            contentType: file.mimetype || 'application/octet-stream',
            upsert: false,
          });

        if (uploadErr) {
          return res.status(500).json({ error: uploadErr.message });
        }

        const { data: publicData } = supabase.storage
          .from('sources')
          .getPublicUrl(storagePath);

        const { error: dbErr } = await supabase
          .from('sources_library')
          .insert({
            nome,
            tipo,
            soggetto,
            anno,
            stagione,
            url: publicData.publicUrl,
            created_at: new Date().toISOString(),
          });

        if (dbErr) {
          return res.status(500).json({ error: dbErr.message });
        }

        return res.status(200).json({
          ok: true,
          nome,
          url: publicData.publicUrl,
        });

      } catch (e) {
        return res.status(500).json({ error: e.message });
      }
    });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
