// va.js: comportamento condiviso dei form di iscrizione (restyling fase 1).
// Payload, endpoint e source invariati: POST /api/subscribe {email, source}.
// Il bottone resta sempre attivo: consenso ed email si controllano al click, con messaggi
// accanto al campo (aria-invalid + aria-describedby) e focus sul campo da correggere.

var VA_MSG = {
  consent: 'Per iscriverti accetta la Privacy Policy.', // da approvare
  email: 'Inserisci un indirizzo email valido.'         // da approvare
};

// Canale dell'iscrizione: utm dalla URL, 'direct' se assenti. Formato utm_source[:utm_medium[:utm_campaign]].
var VA_SOURCE = (function () {
  try {
    var p = new URLSearchParams(window.location.search);
    var parts = [(p.get('utm_source') || '').trim() || 'direct'];
    var m = (p.get('utm_medium') || '').trim(); if (m) parts.push(m);
    var c = (p.get('utm_campaign') || '').trim(); if (c) parts.push(c);
    return parts.join(':').slice(0, 100);
  } catch (e) { return 'direct'; }
})();

function vaValidEmail(v) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v); }

// Messaggio d'errore legato a un campo: crea (una volta) l'elemento dopo `anchor`.
function vaFieldMsg(field, anchor, text) {
  var id = field.id ? field.id + '-err' : '';
  var msg = id && document.getElementById(id);
  if (!msg) {
    msg = document.createElement('div');
    msg.className = 'va-err-msg';
    if (!field.id) field.id = 'va-f' + Math.random().toString(36).slice(2, 8);
    msg.id = field.id + '-err';
    anchor.parentNode.insertBefore(msg, anchor.nextSibling);
  }
  var desc = (field.getAttribute('aria-describedby') || '').split(' ').filter(function (x) { return x && x !== msg.id; });
  if (text) {
    msg.textContent = text;
    msg.classList.add('on');
    field.setAttribute('aria-invalid', 'true');
    desc.unshift(msg.id);
  } else {
    msg.textContent = '';
    msg.classList.remove('on');
    field.removeAttribute('aria-invalid');
  }
  if (desc.length) field.setAttribute('aria-describedby', desc.join(' ')); else field.removeAttribute('aria-describedby');
  return msg;
}

// Controllo al click: consenso (se c'è la casella) poi email. Ritorna true se si può inviare.
function vaCheckSignup(emailEl, checkEl, emailAnchor) {
  if (checkEl) {
    var label = checkEl.closest('label') || checkEl;
    if (!checkEl.checked) { vaFieldMsg(checkEl, label, VA_MSG.consent); checkEl.focus(); return false; }
    vaFieldMsg(checkEl, label, '');
  }
  var email = (emailEl.value || '').trim();
  if (!vaValidEmail(email)) { vaFieldMsg(emailEl, emailAnchor || emailEl, VA_MSG.email); emailEl.focus(); return false; }
  vaFieldMsg(emailEl, emailAnchor || emailEl, '');
  return true;
}

// Toglie l'errore del consenso appena la casella viene spuntata.
document.addEventListener('change', function (ev) {
  var t = ev.target;
  if (t && t.type === 'checkbox' && t.checked && t.getAttribute('aria-invalid') === 'true') vaFieldMsg(t, t.closest('label') || t, '');
});

// Form della home, di /about e della 404 (id espliciti, casella del consenso).
function doSignup(emailId, btnId, okId, checkId, pos) {
  var emailEl = document.getElementById(emailId);
  var btn = document.getElementById(btnId);
  var ok = document.getElementById(okId);
  var check = document.getElementById(checkId);
  if (btn.getAttribute('aria-busy') === 'true') return;
  var row = emailEl.closest('.signup-row') || emailEl;
  if (!vaCheckSignup(emailEl, check, row)) return;
  var email = emailEl.value.trim();
  var old = btn.textContent;
  btn.setAttribute('aria-busy', 'true');
  btn.textContent = 'Iscrizione...';
  ok.className = 'success';
  var formPos = pos || ((emailId === 'cta-email') ? 'cta' : 'hero');
  var source = VA_SOURCE + '__' + formPos;
  fetch('/api/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: email, source: source }) })
    .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { return { r: r, d: d }; }); })
    .then(function (x) {
      var r = x.r, d = x.d;
      btn.removeAttribute('aria-busy');
      if (r.status === 429) {
        ok.className = 'success info';
        ok.textContent = 'Troppi tentativi ravvicinati. Riprova tra qualche minuto: il link di conferma è in arrivo.';
        ok.style.display = 'block'; btn.textContent = old; return;
      }
      if (!r.ok || !d.ok) throw new Error(d.error || 'Errore iscrizione');
      if (d.already) {
        ok.className = 'success';
        ok.textContent = '✓ Sei già iscritto e confermato. Sei a posto, niente da fare.';
        ok.style.display = 'block'; emailEl.value = ''; btn.textContent = 'Fatto ✓'; return;
      }
      ok.className = 'success';
      ok.textContent = '✓ Controlla la tua inbox: ti abbiamo inviato un link di conferma. Se non lo vedi, guarda in spam o promozioni.';
      ok.style.display = 'block';
      emailEl.value = '';
      btn.textContent = 'Fatto ✓';
    })
    .catch(function () {
      btn.removeAttribute('aria-busy');
      btn.textContent = old;
      ok.className = 'success err';
      ok.textContent = 'Iscrizione non riuscita. Controlla l\'email e riprova, oppure scrivici a info@valoreatteso.com';
      ok.style.display = 'block';
    });
}

// Form compatti di archivio e pagine edizione (<form data-source>): stessi testi di prima.
function vaSub(form) {
  var input = form.querySelector('input[type=email]');
  var btn = form.querySelector('button[type=submit]') || form.querySelector('button');
  var st = form.querySelector('.vaform-status, .va-cap-status');
  var cls = st.classList.contains('va-cap-status') ? 'va-cap-status' : 'vaform-status';
  if (btn.getAttribute('aria-busy') === 'true') return false;
  var email = (input.value || '').trim();
  if (!st.id) st.id = 'va-st' + Math.random().toString(36).slice(2, 8);
  input.setAttribute('aria-describedby', st.id);
  if (!vaValidEmail(email)) {
    st.textContent = VA_MSG.email; st.className = cls + ' err';
    input.setAttribute('aria-invalid', 'true'); input.focus(); return false;
  }
  input.removeAttribute('aria-invalid');
  var source = form.getAttribute('data-source') || 'archivio';
  var old = btn.textContent;
  btn.setAttribute('aria-busy', 'true'); btn.textContent = '...'; st.textContent = ''; st.className = cls;
  var done = function () { btn.removeAttribute('aria-busy'); };
  fetch('/api/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: email, source: source }) })
    .then(function (r) { return r.json().then(function (d) { return { s: r.status, d: d }; }).catch(function () { return { s: r.status, d: {} }; }); })
    .then(function (res) {
      done();
      if (res.s === 429) { st.textContent = 'Troppi tentativi ravvicinati. Riprova tra qualche minuto.'; st.className = cls + ' err'; btn.textContent = old; return; }
      if (res.d && res.d.already) { st.textContent = '✓ Sei già iscritto. Sei a posto.'; st.className = cls + ' ok'; input.value = ''; btn.textContent = 'Fatto ✓'; return; }
      if (res.d && res.d.ok) { st.textContent = "✓ Controlla la tua inbox e conferma l'iscrizione (guarda anche in spam)."; st.className = cls + ' ok'; input.value = ''; btn.textContent = 'Fatto ✓'; return; }
      st.textContent = (res.d && res.d.error) || 'Iscrizione non riuscita. Riprova.'; st.className = cls + ' err'; btn.textContent = old;
    })
    .catch(function () { done(); st.textContent = 'Errore di rete. Riprova.'; st.className = cls + ' err'; btn.textContent = old; });
  return false;
}

// Date in italiano: "27 ott 2026" dentro <time datetime="2026-10-27">.
// Accetta ISO (2026-10-27) e le date già scritte per esteso nelle prime edizioni ("19 maggio 2026").
var VA_MESI = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
function vaIsoDate(v) {
  var s = String(v || '').trim();
  var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return m[1] + '-' + m[2] + '-' + m[3];
  m = /^(\d{1,2})\s+([a-zà]+)\s+(\d{4})$/i.exec(s);
  if (m) { var i = VA_MESI.indexOf(m[2].toLowerCase()); if (i >= 0) return m[3] + '-' + String(i + 1).padStart(2, '0') + '-' + String(m[1]).padStart(2, '0'); }
  return null;
}
function vaFormatDate(v) {
  var iso = vaIsoDate(v);
  if (!iso) return String(v || '');
  var d = new Date(iso + 'T00:00:00Z');
  return new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(d).replace(/\./g, '');
}
// Riempie `el` con <time datetime="..."> (o il testo così com'è se la data non è leggibile).
function vaSetDate(el, v) {
  var iso = vaIsoDate(v);
  el.textContent = '';
  if (!iso) { el.textContent = String(v || ''); return; }
  var t = document.createElement('time');
  t.setAttribute('datetime', iso);
  t.textContent = vaFormatDate(v);
  el.appendChild(t);
}
