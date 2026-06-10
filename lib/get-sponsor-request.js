const { supabaseRequest } = require('./sponsor-utils');
const { SLOT_TYPES, ensureSponsorSlots } = require('./sponsor-catalog');
const { authenticateSponsor } = require('./sponsor-auth');

const ALLOWED_STATUSES = [
  'approved',
  'pending_materials',
  'materials_uploaded',
  'materials_changes_requested',
  'materials_approved',
  'paid',
  'scheduled'
];

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  try {
    const requestId = await authenticateSponsor(req, res, req.query && req.query.token);
    if (!requestId) {
      return res.status(401).json({ ok: false, error: 'Link scaduto, già utilizzato o non valido' });
    }

    const statusFilter = ALLOWED_STATUSES.map(encodeURIComponent).join(',');
    await ensureSponsorSlots();
    const rows = await supabaseRequest(
      `/rest/v1/sponsor_requests?id=eq.${encodeURIComponent(requestId)}&status=in.(${statusFilter})&select=id,company,contact_name,format,status,scheduled_date,amount,slot_type,selected_slot_id,materials_status,payment_status,edition_id,preview_status,preview_sent_at,preview_approved_at,terms_version,terms_accepted_at,publication_authorized_at,editions(num,title,date),sponsor_assets(logo_url,headline,body,cta_url)`,
      { headers: { Accept: 'application/json' } }
    );
    const request = rows && rows[0];
    if (!request) return res.status(404).json({ ok: false, error: 'Link non valido o richiesta non disponibile' });

    const today = new Date().toISOString().slice(0, 10);
    const slots = await supabaseRequest(
      `/rest/v1/sponsor_slots?slot_date=gte.${today}&slot_type=in.(main,secondary)&select=id,slot_date,slot_type,status,request_id,amount&order=slot_date.asc,slot_type.asc&limit=40`,
      { headers: { Accept: 'application/json' } }
    );
    const publicSlots = (slots || []).map((slot) => ({
      id: slot.id,
      slot_date: slot.slot_date,
      slot_type: slot.slot_type,
      amount: Number(slot.amount || (SLOT_TYPES[slot.slot_type] || {}).amount || 0),
      available: slot.status === 'available' || slot.id === request.selected_slot_id,
      selected: slot.id === request.selected_slot_id
    }));

    const asset = Array.isArray(request.sponsor_assets)
      ? request.sponsor_assets[0]
      : request.sponsor_assets;
    if (asset && asset.logo_url) {
      const signed = await supabaseRequest(
        `/storage/v1/object/sign/sponsor-assets/${asset.logo_url}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ expiresIn: 3600 })
        }
      );
      asset.logo_signed_url = signed && signed.signedURL
        ? `${String(process.env.SUPABASE_URL || '').replace(/\/$/, '')}/storage/v1${signed.signedURL}`
        : null;
    }
    request.asset = asset || null;
    delete request.sponsor_assets;

    return res.status(200).json({
      ok: true,
      request,
      catalog: SLOT_TYPES,
      slots: publicSlots,
      payment: request.selected_slot_id ? {
        bank_transfer: process.env.SPONSOR_IBAN ? {
          account_holder: process.env.SPONSOR_ACCOUNT_HOLDER || 'Valore Atteso',
          iban: process.env.SPONSOR_IBAN,
          reference: `SPONSOR-${request.id.slice(0, 8).toUpperCase()}`
        } : null,
        paypal_url: process.env.SPONSOR_PAYPAL_URL || null
      } : null
    });
  } catch (error) {
    console.error('[get-sponsor-request]', error);
    return res.status(500).json({ ok: false, error: 'Errore durante il recupero della richiesta' });
  }
};
