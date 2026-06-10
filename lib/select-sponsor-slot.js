const { parseJsonBody, supabaseRequest } = require('./sponsor-utils');
const { ensureSponsorSlots } = require('./sponsor-catalog');

const SELECTABLE_STATUSES = [
  'approved',
  'pending_materials',
  'materials_uploaded',
  'materials_changes_requested',
  'materials_approved'
];

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  try {
    const body = parseJsonBody(req);
    const token = String(body.token || '').trim();
    const slotId = String(body.slot_id || '').trim();
    if (!token || !slotId) {
      return res.status(400).json({ ok: false, error: 'Token e slot sono obbligatori' });
    }

    await ensureSponsorSlots();
    const requestRows = await supabaseRequest(
      `/rest/v1/sponsor_requests?token=eq.${encodeURIComponent(token)}&select=id,status,selected_slot_id,terms_accepted_at`,
      { headers: { Accept: 'application/json' } }
    );
    const request = requestRows && requestRows[0];
    if (!request || !SELECTABLE_STATUSES.includes(request.status)) {
      return res.status(404).json({ ok: false, error: 'Richiesta non disponibile' });
    }
    if (!request.terms_accepted_at) {
      return res.status(409).json({ ok: false, error: 'Accetta prima le condizioni di sponsorizzazione' });
    }

    const slotRows = await supabaseRequest(
      `/rest/v1/sponsor_slots?id=eq.${encodeURIComponent(slotId)}&select=id,slot_date,slot_type,amount,status,request_id`,
      { headers: { Accept: 'application/json' } }
    );
    const slot = slotRows && slotRows[0];
    if (!slot || (slot.status !== 'available' && slot.request_id !== request.id)) {
      return res.status(409).json({ ok: false, error: 'Lo slot non è più disponibile' });
    }

    if (slot.request_id !== request.id) {
      const reserved = await supabaseRequest(
        `/rest/v1/sponsor_slots?id=eq.${encodeURIComponent(slot.id)}&status=eq.available`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Prefer: 'return=representation'
          },
          body: JSON.stringify({ status: 'reserved', request_id: request.id })
        }
      );
      if (!reserved || !reserved.length) {
        return res.status(409).json({ ok: false, error: 'Lo slot è appena stato prenotato' });
      }
    }

    if (request.selected_slot_id && request.selected_slot_id !== slot.id) {
      await supabaseRequest(
        `/rest/v1/sponsor_slots?id=eq.${encodeURIComponent(request.selected_slot_id)}&request_id=eq.${encodeURIComponent(request.id)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
          body: JSON.stringify({ status: 'available', request_id: null })
        }
      );
    }

    const nextStatus = request.status === 'approved' ? 'pending_materials' : request.status;
    await supabaseRequest(`/rest/v1/sponsor_requests?id=eq.${encodeURIComponent(request.id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({
        selected_slot_id: slot.id,
        slot_type: slot.slot_type,
        scheduled_date: slot.slot_date,
        amount: slot.amount,
        status: nextStatus
      })
    });

    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error('[select-sponsor-slot]', error);
    return res.status(500).json({ ok: false, error: 'Errore durante la selezione dello slot' });
  }
};
