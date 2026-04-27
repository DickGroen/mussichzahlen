
import { validateFile, formatFileSize, submitFree, submitPaid, initFaq, initModal, initStickyFooter, openModal, closeModal } from '../app.js';

// Expose to HTML onclick handlers
window.openModal  = openModal;
window.closeModal = closeModal;
window.toggleFaq  = function(el) {
  const item    = el.closest('.faq-item');
  const answer  = item.querySelector('.faq-a');
  const chevron = item.querySelector('.faq-chevron');
  const isOpen  = item.classList.contains('faq-item--open');
  document.querySelectorAll('.faq-item--open').forEach(open => {
    open.classList.remove('faq-item--open');
    const a = open.querySelector('.faq-a');
    const c = open.querySelector('.faq-chevron');
    if (a) a.style.maxHeight = null;
    if (c) c.style.transform = '';
  });
  if (!isOpen) {
    item.classList.add('faq-item--open');
    if (answer)  answer.style.maxHeight = answer.scrollHeight + 'px';
    if (chevron) chevron.style.transform = 'rotate(180deg)';
  }
};

const TYPE = 'rechnung';
let selectedFile = null;
let gratisFile   = null;

// ── Kostenlose Einschätzung ───────────────────────────────────────────────────

window.handleGratisFileSelect = function(input) {
  if (!input.files?.[0]) return;
  gratisFile = input.files[0];
  const err  = validateFile(gratisFile);
  if (err) {
    const s = document.getElementById('gratis-status');
    s.className   = 'optie-status optie-status--error';
    s.textContent = err;
    return;
  }
  const zone = document.getElementById('gratis-upload-zone');
  zone.innerHTML = `<div class="upload-label" style="color:var(--green);">&#10003; ${esc(gratisFile.name)}</div><div class="upload-hint">${formatFileSize(gratisFile.size)}</div>`;
  document.getElementById('gratis-contact-fields').style.display = 'flex';
  checkGratisReady();
};

function checkGratisReady() {
  const name  = document.getElementById('gratis-name')?.value.trim();
  const email = document.getElementById('gratis-email')?.value.trim();
  const btn   = document.getElementById('gratis-btn');
  if (btn) btn.disabled = !(name && email?.includes('@') && email?.includes('.') && gratisFile);
}

// Null-guarded: gratis fields only exist on index.html, not on danke.html
document.getElementById('gratis-name')?.addEventListener('input', checkGratisReady);
document.getElementById('gratis-email')?.addEventListener('input', checkGratisReady);

window.startGratisUpload = async function() {
  const name   = document.getElementById('gratis-name').value.trim();
  const email  = document.getElementById('gratis-email').value.trim();
  const btn    = document.getElementById('gratis-btn');
  const status = document.getElementById('gratis-status');
  if (!gratisFile) return;

  btn.disabled    = true;
  btn.textContent = 'Wird gesendet\u2026';

  try {
    const data = await submitFree({
      file: gratisFile, name, email, type: TYPE,
      onStatus: (t, msg) => {
        status.className   = `optie-status optie-status--${t}`;
        status.textContent = msg;
      }
    });

    showTeaser(data.triage);
    status.className   = 'optie-status optie-status--success';
    status.textContent = 'Erledigt! Deine Einsch\u00e4tzung erh\u00e4ltst du bis zum n\u00e4chsten Werktag vor 16:00\u00a0Uhr per E-Mail.';
    btn.textContent    = 'Gesendet \u2713';
  } catch (err) {
    status.className   = 'optie-status optie-status--error';
    status.textContent = 'Fehler: ' + err.message;
    btn.disabled       = false;
    btn.textContent    = 'Kostenlose Einsch\u00e4tzung anfordern';
  }
};

// ── Teaser ────────────────────────────────────────────────────────────────────

function showTeaser(triage) {
  const teaser = document.getElementById('teaser');
  if (!teaser || !triage) return;
  teaser.style.display = 'block';
  setTimeout(() => teaser.classList.add('teaser--visible'), 10);

  const amount = triage.amount_claimed ? `\u20AC${triage.amount_claimed}` : null;
  const sender = triage.sender || null;
  const risk   = triage.risk || 'medium';

  document.getElementById('teaser-company').textContent = amount
    ? `M\u00f6gliche Ansatzpunkte f\u00fcr deine Rechnung von ${amount} identifiziert`
    : sender
      ? `M\u00f6gliche Ansatzpunkte in der Rechnung von ${sender} identifiziert`
      : 'Wir haben m\u00f6gliche Ansatzpunkte in deiner Rechnung identifiziert';

  const riskMsg = {
    high:   '\uD83D\uDD34 Deutliche Ansatzpunkte erkannt \u2014 vollst\u00e4ndige Analyse empfohlen.',
    medium: '\uD83D\uDFE0 M\u00f6gliche Ansatzpunkte vorhanden \u2014 eine vollst\u00e4ndige Pr\u00fcfung gibt Gewissheit.',
    low:    '\uD83D\uDFE1 Begrenzte Ansatzpunkte \u2014 eine Pr\u00fcfung kann trotzdem lohnen.'
  };
  document.getElementById('teaser-sub').textContent = riskMsg[risk] || '';

  const locked = document.getElementById('teaser-locked-text');
  if (locked) {
    locked.innerHTML = `<strong>Vollst\u00e4ndige Analyse + Widerspruchsschreiben nach Zahlung</strong>
      Wir pr\u00fcfen alle Ansatzpunkte und erstellen ein fertiges Schreiben \u2014 innerhalb von 24\u00a0Stunden.`;
  }

  // Null-guarded: modal only exists on index.html
  const modalCopy = document.getElementById('modal-dynamic-copy');
  if (modalCopy) {
    modalCopy.textContent = amount
      ? `Wir haben m\u00f6gliche Ansatzpunkte f\u00fcr deine Rechnung von ${amount} identifiziert \u2014 vollst\u00e4ndige Analyse nach der Zahlung.`
      : 'Wir haben m\u00f6gliche Ansatzpunkte in deiner Rechnung identifiziert \u2014 vollst\u00e4ndige Analyse nach der Zahlung.';
  }

  teaser.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// ── Bezahlter Upload (danke.html) ─────────────────────────────────────────────

if (document.getElementById('submit-btn')) {
  const fileInput = document.getElementById('real-file-input');

  fileInput?.addEventListener('change', () => {
    if (fileInput.files?.[0]) updateSelectedFile(fileInput.files[0]);
  });

  const uploadPanel = document.getElementById('upload-panel');
  uploadPanel?.addEventListener('dragover',  e => { e.preventDefault(); uploadPanel.classList.add('drag-over'); });
  uploadPanel?.addEventListener('dragleave', () => uploadPanel.classList.remove('drag-over'));
  uploadPanel?.addEventListener('drop', e => {
    e.preventDefault(); uploadPanel.classList.remove('drag-over');
    if (e.dataTransfer.files?.[0]) { fileInput.files = e.dataTransfer.files; updateSelectedFile(e.dataTransfer.files[0]); }
  });

  document.getElementById('remove-file')?.addEventListener('click', e => { e.preventDefault(); clearFile(); });
  document.getElementById('submit-btn')?.addEventListener('click', doSubmit);

  validateSession();
}

function validateSession() {
  const params    = new URLSearchParams(window.location.search);
  const sessionId = params.get('session_id');
  if (sessionId?.startsWith('cs_')) {
    document.getElementById('thankyou-app').style.display = 'block';
    const emailEl = document.getElementById('customer-email');
    if (emailEl && params.get('email')) emailEl.value = params.get('email');
  } else {
    document.getElementById('locked-screen').style.display = 'block';
  }
}

function updateSelectedFile(file) {
  const err = validateFile(file);
  if (err) { showStatus(err, 'error'); return; }
  selectedFile = file;
  document.getElementById('selected-file').classList.add('show');
  document.getElementById('selected-file-name').textContent = file.name;
  document.getElementById('selected-file-meta').textContent = formatFileSize(file.size) + ' \u00b7 bereit';
  const btn = document.getElementById('submit-btn');
  btn.disabled    = false;
  btn.textContent = 'Jetzt hochladen und Analyse starten';
}

function clearFile() {
  selectedFile = null;
  document.getElementById('real-file-input').value = '';
  document.getElementById('selected-file').classList.remove('show');
  const btn = document.getElementById('submit-btn');
  btn.disabled    = true;
  btn.textContent = 'Zuerst eine Datei ausw\u00e4hlen';
}

function showStatus(msg, type) {
  const box = document.getElementById('status-box');
  box.className = 'status-box ' + type;
  box.innerHTML  = msg;
}

async function doSubmit() {
  const name   = document.getElementById('customer-name').value.trim();
  const email  = document.getElementById('customer-email').value.trim();
  const params = new URLSearchParams(window.location.search);
  const file   = document.getElementById('real-file-input').files[0] || selectedFile;

  if (!name || !email.includes('@') || !file) {
    showStatus('Bitte alle Felder ausf\u00fcllen und eine Datei ausw\u00e4hlen.', 'error');
    return;
  }

  const btn = document.getElementById('submit-btn');
  btn.disabled    = true;
  btn.textContent = 'Wird hochgeladen\u2026';

  try {
    await submitPaid({
      file, name, email, type: TYPE,
      sessionId: params.get('session_id'),
      onStatus:  showStatus
    });
    document.querySelector('.thankyou-card').innerHTML = `
      <div class="success-screen">
        <div class="success-screen__icon">&#10003;</div>
        <h2>Upload erfolgreich!</h2>
        <p>Wir analysieren deine Rechnung und senden dir die vollst\u00e4ndige Analyse sowie das fertige Widerspruchsschreiben an <strong>${esc(email)}</strong> innerhalb von 24\u00a0Stunden.</p>
        <p style="font-size:.82rem;color:var(--muted);">Bitte auch den Spam-Ordner pr\u00fcfen.</p>
      </div>`;
  } catch (err) {
    showStatus('Upload fehlgeschlagen: ' + err.message + '. Bitte erneut versuchen oder an support@mussichzahlen.de schreiben.', 'error');
    btn.disabled    = false;
    btn.textContent = 'Jetzt hochladen und Analyse starten';
  }
}

function esc(str) {
  return String(str || '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

// ── Init ──────────────────────────────────────────────────────────────────────

initFaq();
initModal();
initStickyFooter();

setTimeout(() => {
  const card = document.getElementById('free-card');
  if (card) { card.style.opacity = '0.85'; card.style.pointerEvents = 'auto'; }
}, 4000);
