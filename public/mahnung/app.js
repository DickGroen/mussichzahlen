import {
  validateFile,
  formatFileSize,
  submitFree,
  submitPaid,
  initFaq,
  initModal,
  initStickyFooter,
  openModal,
  closeModal,
  track
} from '../app.js';

window.openModal = openModal;
window.closeModal = closeModal;

const TYPE = 'mahnung';
const PRICE = 49;

let gratisFile = null;
let selectedFile = null;
let stripeLink = null;

track('page_view', { type: TYPE });

// ── Free triage flow ─────────────────────────────────────────────────────────

window.handleGratisFileSelect = function(input) {
  if (!input.files?.[0]) return;

  gratisFile = input.files[0];

  track('free_upload_started', { type: TYPE });

  const err = validateFile(gratisFile);
  const status = document.getElementById('gratis-status');

  if (err) {
    if (status) {
      status.className = 'optie-status optie-status--error';
      status.textContent = err;
    }
    return;
  }

  const zone = document.getElementById('gratis-upload-zone');
  if (zone) {
    zone.innerHTML = `
      <div class="upload-label" style="color:var(--green);">✓ ${esc(gratisFile.name)}</div>
      <div class="upload-hint">${formatFileSize(gratisFile.size)}</div>
    `;
  }

  const fields = document.getElementById('gratis-contact-fields');
  if (fields) fields.style.display = 'flex';

  checkGratisReady();
};

function checkGratisReady() {
  const name = document.getElementById('gratis-name')?.value.trim();
  const email = document.getElementById('gratis-email')?.value.trim();
  const btn = document.getElementById('gratis-btn');

  if (!btn) return;
  btn.disabled = !(gratisFile && name && email.includes('@') && email.includes('.'));
}

document.getElementById('gratis-name')?.addEventListener('input', checkGratisReady);
document.getElementById('gratis-email')?.addEventListener('input', checkGratisReady);

window.startGratisUpload = async function() {
  const name = document.getElementById('gratis-name')?.value.trim();
  const email = document.getElementById('gratis-email')?.value.trim();
  const btn = document.getElementById('gratis-btn');
  const status = document.getElementById('gratis-status');

  if (!gratisFile || !name || !email) return;

  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Wird geprüft…';
  }

  try {
    const data = await submitFree({
      file: gratisFile,
      name,
      email,
      type: TYPE,
      onStatus: (kind, msg) => {
        if (!status) return;
        status.className = `optie-status optie-status--${kind}`;
        status.textContent = msg;
      }
    });

    const triage = data.triage || {};
    stripeLink = triage.stripeLink || data.teaser?.stripeLink || stripeLink;

    track('free_triage_completed', { type: TYPE });

    renderTeaser(triage);

    if (status) {
      status.className = 'optie-status optie-status--success';
      status.textContent = 'Erste Einschätzung abgeschlossen.';
    }

    if (btn) {
      btn.textContent = 'Fertig ✓';
    }
  } catch (err) {
    if (status) {
      status.className = 'optie-status optie-status--error';
      status.textContent = 'Fehler: ' + err.message;
    }

    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Kostenlose Einschätzung starten';
    }
  }
};

function renderTeaser(triage) {
  const teaser = document.getElementById('teaser');
  if (!teaser) return;

  const risk = triage.risk || 'medium';
  const amount = triage.amount_claimed || null;

  teaser.style.display = 'block';
  setTimeout(() => teaser.classList.add('teaser--visible'), 10);

  track('teaser_shown', {
    type: TYPE,
    risk,
    amount
  });

  const riskLabel = {
    high: '🔴 Hohe Auffälligkeit erkannt',
    medium: '🟠 Mögliche Auffälligkeiten erkannt',
    low: '🟡 Geringe Auffälligkeit'
  };

  const title = document.getElementById('teaser-company');
  if (title) title.textContent = 'Erste Einschätzung abgeschlossen';

  const sub = document.getElementById('teaser-sub');
  if (sub) {
    sub.textContent = `${riskLabel[risk] || riskLabel.medium}${amount ? ` • Betrag: €${amount}` : ''}`;
  }

  const copy = document.getElementById('modal-dynamic-copy');
  if (copy) {
    copy.textContent =
      triage.teaser ||
      'Es könnten mögliche Ansatzpunkte vorliegen. Eine vollständige Prüfung kann helfen, unnötige Kosten zu vermeiden.';
  }

  const financial = document.getElementById('teaser-financial');
  if (financial) {
    financial.innerHTML = amount
      ? `💸 <strong>Möglicher finanzieller Einfluss:</strong><br>Ohne weitere Prüfung riskierst du, bis zu <strong>€${esc(amount)}</strong> zu zahlen — möglicherweise unnötig.`
      : `💸 <strong>Mögliche Kosten:</strong><br>Ohne genauere Analyse könnten unnötige Kosten entstehen.`;
  }

  const cta = document.getElementById('teaser-cta');
  if (cta) {
    cta.innerHTML = `
      <h3>🔍 Vollständige Analyse + fertiger Widerspruch</h3>
      <ul>
        <li>✓ Konkrete Bewertung deiner Situation</li>
        <li>✓ Klare Handlungsempfehlung</li>
        <li>✓ Fertiger Widerspruch zum direkten Versand</li>
      </ul>
      <button class="offer-cta" onclick="goToStripe()">
        ${ctaText(risk)}
      </button>
      <div style="margin-top:8px;font-size:.85rem;color:var(--muted);">
        Einmalig €${PRICE} · kein Abo · sichere Zahlung
      </div>
    `;
  }

  const modalLink = document.querySelector('.js-stripe-link, .modal__cta');
  if (modalLink && stripeLink) {
    modalLink.href = stripeLink;
  }

  teaser.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function ctaText(risk) {
  if (risk === 'high') return `Jetzt handeln und Kosten vermeiden — €${PRICE} →`;
  if (risk === 'low') return `Analyse im Detail prüfen — €${PRICE} →`;
  return `Jetzt vollständige Analyse erhalten — €${PRICE} →`;
}

window.goToStripe = function() {
  track('stripe_clicked', {
    type: TYPE,
    price: PRICE
  });

  if (stripeLink) {
    window.location.href = stripeLink;
    return;
  }

  openModal('modal');
};

// ── Paid upload flow for danke.html ──────────────────────────────────────────

if (document.getElementById('submit-btn')) {
  const fileInput = document.getElementById('real-file-input');

  fileInput?.addEventListener('change', () => {
    if (fileInput.files?.[0]) updateSelectedFile(fileInput.files[0]);
  });

  const uploadPanel = document.getElementById('upload-panel');

  uploadPanel?.addEventListener('dragover', e => {
    e.preventDefault();
    uploadPanel.classList.add('drag-over');
  });

  uploadPanel?.addEventListener('dragleave', () => {
    uploadPanel.classList.remove('drag-over');
  });

  uploadPanel?.addEventListener('drop', e => {
    e.preventDefault();
    uploadPanel.classList.remove('drag-over');

    if (e.dataTransfer.files?.[0]) {
      fileInput.files = e.dataTransfer.files;
      updateSelectedFile(e.dataTransfer.files[0]);
    }
  });

  document.getElementById('remove-file')?.addEventListener('click', e => {
    e.preventDefault();
    clearFile();
  });

  document.getElementById('submit-btn')?.addEventListener('click', doSubmit);

  validateSession();
}

function validateSession() {
  const params = new URLSearchParams(window.location.search);
  const sessionId = params.get('session_id');

  if (sessionId?.startsWith('cs_')) {
    const app = document.getElementById('thankyou-app');
    if (app) app.style.display = 'block';

    const emailEl = document.getElementById('customer-email');
    if (emailEl && params.get('email')) emailEl.value = params.get('email');
  } else {
    const locked = document.getElementById('locked-screen');
    if (locked) locked.style.display = 'block';
  }
}

function updateSelectedFile(file) {
  const err = validateFile(file);
  if (err) {
    showStatus(err, 'error');
    return;
  }

  selectedFile = file;

  document.getElementById('selected-file')?.classList.add('show');

  const name = document.getElementById('selected-file-name');
  if (name) name.textContent = file.name;

  const meta = document.getElementById('selected-file-meta');
  if (meta) meta.textContent = formatFileSize(file.size) + ' · bereit';

  const btn = document.getElementById('submit-btn');
  if (btn) {
    btn.disabled = false;
    btn.textContent = 'Hochladen und Analyse starten';
  }
}

function clearFile() {
  selectedFile = null;

  const input = document.getElementById('real-file-input');
  if (input) input.value = '';

  document.getElementById('selected-file')?.classList.remove('show');

  const btn = document.getElementById('submit-btn');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Zuerst eine Datei wählen';
  }
}

function showStatus(msg, type) {
  const box = document.getElementById('status-box');
  if (!box) return;

  box.className = 'status-box ' + type;
  box.innerHTML = esc(msg);
}

async function doSubmit() {
  const name = document.getElementById('customer-name')?.value.trim();
  const email = document.getElementById('customer-email')?.value.trim();
  const params = new URLSearchParams(window.location.search);
  const file = document.getElementById('real-file-input')?.files?.[0] || selectedFile;

  if (!name || !email?.includes('@') || !file) {
    showStatus('Bitte alle Felder ausfüllen und eine Datei auswählen.', 'error');
    return;
  }

  const btn = document.getElementById('submit-btn');

  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Wird hochgeladen…';
  }

  try {
    await submitPaid({
      file,
      name,
      email,
      type: TYPE,
      sessionId: params.get('session_id'),
      onStatus: showStatus
    });

    const card = document.querySelector('.thankyou-card');
    if (card) {
      card.innerHTML = `
        <div class="success-screen">
          <div class="success-screen__icon">✓</div>
          <h2>Upload erfolgreich!</h2>
          <p>Wir analysieren dein Schreiben und senden dir die vollständige Analyse sowie den fertigen Widerspruch per E-Mail an <strong>${esc(email)}</strong>.</p>
          <p style="font-size:.82rem;color:var(--muted);">Bitte auch den Spam-Ordner prüfen.</p>
        </div>`;
    }
  } catch (err) {
    showStatus('Upload fehlgeschlagen: ' + err.message, 'error');

    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Hochladen und Analyse starten';
    }
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function esc(str) {
  return String(str || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

// ── Init ────────────────────────────────────────────────────────────────────

initFaq();
initModal();
initStickyFooter();
