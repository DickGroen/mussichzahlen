import { validateFile, formatFileSize, submitFree, submitPaid, initFaq, initModal, initStickyFooter, openModal, closeModal } from '../app.js';

// Expose to HTML onclick handlers
window.openModal  = openModal;
window.closeModal = closeModal;

const TYPE = 'mahnung';
let selectedFile = null;
let gratisFile   = null;

// ── GRATIS FLOW ───────────────────────────────────────────────────────────────

window.handleGratisFileSelect = function(input) {
  if (!input.files?.[0]) return;

  gratisFile = input.files[0];
  const err  = validateFile(gratisFile);

  const status = document.getElementById('gratis-status');

  if (err) {
    status.className   = 'optie-status optie-status--error';
    status.textContent = err;
    return;
  }

  const zone = document.getElementById('gratis-upload-zone');
  zone.innerHTML = `
    <div class="upload-label" style="color:var(--green);">
      ✔ ${esc(gratisFile.name)}
    </div>
    <div class="upload-hint">${formatFileSize(gratisFile.size)}</div>
  `;

  document.getElementById('gratis-contact-fields').style.display = 'flex';
  checkGratisReady();
};

function checkGratisReady() {
  const name  = document.getElementById('gratis-name').value.trim();
  const email = document.getElementById('gratis-email').value.trim();

  document.getElementById('gratis-btn').disabled =
    !(name && email.includes('@') && email.includes('.') && gratisFile);
}

document.getElementById('gratis-name')?.addEventListener('input', checkGratisReady);
document.getElementById('gratis-email')?.addEventListener('input', checkGratisReady);

// ── GRATIS SUBMIT ─────────────────────────────────────────────────────────────

window.startGratisUpload = async function() {
  const name   = document.getElementById('gratis-name').value.trim();
  const email  = document.getElementById('gratis-email').value.trim();
  const btn    = document.getElementById('gratis-btn');
  const status = document.getElementById('gratis-status');

  if (!gratisFile) return;

  btn.disabled    = true;
  btn.textContent = 'Wird geprüft…';

  try {
    const data = await submitFree({
      file: gratisFile,
      name,
      email,
      type: TYPE,
      onStatus: (t, msg) => {
        status.className   = `optie-status optie-status--${t}`;
        status.textContent = msg;
      }
    });

    renderConversionBlock(data.triage);

    status.className   = 'optie-status optie-status--success';
    status.textContent = 'Analyse abgeschlossen.';
    btn.textContent    = 'Fertig ✓';

  } catch (err) {
    status.className   = 'optie-status optie-status--error';
    status.textContent = 'Fehler: ' + err.message;
    btn.disabled       = false;
    btn.textContent    = 'Kostenlose Einschätzung starten';
  }
};

// ── CONVERSION BLOCK (BELANGRIJKSTE FIX) ─────────────────────────────────────

function renderConversionBlock(triage) {
  const teaser = document.getElementById('teaser');
  if (!teaser || !triage) return;

  teaser.style.display = 'block';
  setTimeout(() => teaser.classList.add('teaser--visible'), 10);

  const amount = triage.amount_claimed || null;
  const sender = triage.sender || 'unbekannt';
  const risk   = triage.risk || 'medium';

  // ── HEADER ─────────────────────────────────

  document.getElementById('teaser-company').textContent = `
Erste Einschätzung abgeschlossen
`;

  // ── SUB RESULT ─────────────────────────────

  const riskLabel = {
    high:   '🔴 Hohe Auffälligkeit erkannt',
    medium: '🟠 Mögliche Auffälligkeiten erkannt',
    low:    '🟡 Geringe Auffälligkeit'
  };

  document.getElementById('teaser-sub').textContent =
    `${riskLabel[risk]}${amount ? ` • Betrag: €${amount}` : ''}`;

  // ── TEASER TEXT (AI) ───────────────────────

  const modalCopy = document.getElementById('modal-dynamic-copy');
  if (modalCopy) {
    modalCopy.textContent = triage.teaser;
  }

  // ── FINANCIAL TRIGGER ──────────────────────

  const financial = document.getElementById('teaser-financial');
  if (financial) {
    financial.innerHTML = amount
      ? `💸 <strong>Möglicher finanzieller Einfluss:</strong><br>
         Ohne Prüfung riskierst du, bis zu <strong>€${amount}</strong> zu zahlen — möglicherweise unnötig.`
      : `💸 <strong>Mögliche Kosten:</strong><br>
         Ohne genauere Analyse könnten unnötige Kosten entstehen.`;
  }

  // ── CTA BLOCK ─────────────────────────────

  const cta = document.getElementById('teaser-cta');
  if (cta) {
    cta.innerHTML = `
      <div style="margin-top:20px;">
        <h3>🔍 Vollständige Analyse + fertiger Widerspruch</h3>
        <ul style="line-height:1.8;margin:10px 0;">
          <li>✔ Klare Bewertung deiner Situation</li>
          <li>✔ Konkrete Handlungsempfehlung</li>
          <li>✔ Fertiges Schreiben zum direkten Versand</li>
        </ul>

        <button class="primary-btn" onclick="openModal('modal')">
          ${getCtaText(risk)}
        </button>

        <div style="margin-top:8px;font-size:.85rem;color:var(--muted);">
          Einmalig €29 • Ergebnis per E-Mail innerhalb von 24h
        </div>

        <div style="margin-top:12px;font-size:.85rem;color:#b45309;">
          ⏳ In vielen Fällen gelten Fristen — ohne Reaktion können zusätzliche Kosten entstehen.
        </div>
      </div>
    `;
  }

  teaser.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// ── DYNAMIC CTA ──────────────────────────────────────────────────────────────

function getCtaText(risk) {
  if (risk === 'high')   return 'Jetzt handeln und Kosten vermeiden →';
  if (risk === 'low')    return 'Analyse im Detail prüfen →';
  return 'Jetzt vollständige Analyse erhalten →';
}

// ── PAID FLOW (ongewijzigd, maar cleaner UX) ─────────────────────────────────

if (document.getElementById('submit-btn')) {
  const fileInput = document.getElementById('real-file-input');

  fileInput?.addEventListener('change', () => {
    if (fileInput.files?.[0]) updateSelectedFile(fileInput.files[0]);
  });

  document.getElementById('submit-btn')?.addEventListener('click', doSubmit);
  validateSession();
}

function validateSession() {
  const params    = new URLSearchParams(window.location.search);
  const sessionId = params.get('session_id');

  if (sessionId?.startsWith('cs_')) {
    document.getElementById('thankyou-app').style.display = 'block';
  } else {
    document.getElementById('locked-screen').style.display = 'block';
  }
}

function updateSelectedFile(file) {
  const err = validateFile(file);
  if (err) return;

  selectedFile = file;

  const btn = document.getElementById('submit-btn');
  btn.disabled    = false;
  btn.textContent = 'Analyse starten';
}

async function doSubmit() {
  const name  = document.getElementById('customer-name').value.trim();
  const email = document.getElementById('customer-email').value.trim();
  const file  = document.getElementById('real-file-input').files[0] || selectedFile;

  if (!name || !email.includes('@') || !file) return;

  const btn = document.getElementById('submit-btn');
  btn.disabled    = true;
  btn.textContent = 'Wird hochgeladen…';

  try {
    await submitPaid({
      file,
      name,
      email,
      type: TYPE,
      sessionId: new URLSearchParams(window.location.search).get('session_id')
    });

    document.querySelector('.thankyou-card').innerHTML = `
      <div class="success-screen">
        <div class="success-screen__icon">✔</div>
        <h2>Analyse gestartet</h2>
        <p>Du erhältst dein Ergebnis per E-Mail innerhalb von 24h.</p>
      </div>`;
  } catch (err) {
    btn.disabled = false;
    btn.textContent = 'Erneut versuchen';
  }
}

// ── HELPERS ──────────────────────────────────────────────────────────────────

function esc(str) {
  return String(str || '')
    .replaceAll('&','&amp;')
    .replaceAll('<','&lt;')
    .replaceAll('>','&gt;');
}

// ── INIT ─────────────────────────────────────────────────────────────────────

initFaq();
initModal();
initStickyFooter();
