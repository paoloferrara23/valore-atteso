const { supabaseRequest } = require('./sponsor-utils');

const SLOT_TYPES = {
  main: {
    label: 'Main slot',
    amount: 500,
    description: 'Posizione principale, con logo, headline, testo e call to action.'
  },
  secondary: {
    label: 'Slot secondario',
    amount: 250,
    description: 'Presenza compatta, con logo, testo breve e link.'
  }
};

function nextTuesdays(count = 8) {
  const dates = [];
  const cursor = new Date();
  cursor.setUTCHours(12, 0, 0, 0);
  const daysUntilTuesday = (2 - cursor.getUTCDay() + 7) % 7;
  cursor.setUTCDate(cursor.getUTCDate() + (daysUntilTuesday || 7));
  for (let index = 0; index < count; index += 1) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 7);
  }
  return dates;
}

async function ensureSponsorSlots() {
  const rows = [];
  for (const slotDate of nextTuesdays()) {
    for (const [slotType, config] of Object.entries(SLOT_TYPES)) {
      rows.push({
        slot_date: slotDate,
        slot_type: slotType,
        amount: config.amount,
        status: 'available'
      });
    }
  }
  await supabaseRequest('/rest/v1/sponsor_slots?on_conflict=slot_date,slot_type', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Prefer: 'resolution=ignore-duplicates,return=minimal'
    },
    body: JSON.stringify(rows)
  });
}

module.exports = {
  SLOT_TYPES,
  ensureSponsorSlots
};
