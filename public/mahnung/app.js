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
  const name  = document.getElementById('gratis-name')?.value.trim();
  const email = document.getElementById('gratis-email')?.value.trim();
  const btn   = document.getElementById('gratis-btn');
  const hint  = document.getElementById('gratis-email-hint');

  if (!btn) return;

  const emailOk = email.includes('@') && email.includes('.');
  const ready   = !!(gratisFile && name && emailOk);

  btn.disabled = !ready;

  if (hint) {
    if (email.length > 3 && !emailOk) {
      hint.textContent = 'Bitte eine gültige E-Mail-Adresse eingeben.';
      hint.style.display = 'block';
    } else {
      hint.style.display = 'none';
    }
  }
}

document.getElementById('gratis-name')?.addEventListener('input', checkGratisReady);
document.getElementById('gratis-email')?.addEventListener('input', checkGratisReady);

window.startGratisUpload = async function() {
  const name   = document.getElementById('gratis-name')?.value.trim();
  const email  = document.getElementById('gratis-email')?.value.trim();
  const btn    = document.getElementById('gratis-btn');
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

    const triage = normalizeTriage(data.triage || {});
    stripeLink =
      data.stripeLink ||
      data.teaser?.stripeLink ||
      triage.stripeLink ||
      stripeLink;

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

function normalizeTriage(triage) {
  const risk = ['low', 'medium', 'high'].includes(triage.risk)
    ? triage.risk
    : 'medium';

  return {
    ...triage,
    risk,
    teaser: triage.teaser || getFallbackTeaser(risk)
  };
}

function getFallbackTeaser(risk) {
  if (risk === 'high') {
    return 'Es deutet einiges darauf hin, dass hier mögliche Unstimmigkeiten bestehen. Wenn du nicht reagierst, kann sich die Situation finanziell deutlich verschlechtern.';
  }

  if (risk === 'medium') {
    return 'In diesem Schreiben könnten Ansatzpunkte vorliegen, die ohne rechtzeitige Reaktion zu unnötigen Mehrkosten führen können.';
  }

  return 'Es gibt Hinweise darauf, dass diese Forderung nicht vollständig eindeutig ist. Ohne Reaktion könnten jedoch zusätzliche Kosten entstehen.';
}

function renderTeaser(triage) {
  const teaser = document.getElementById('teaser');
  if (!teaser) return;

  track('teaser_shown', {
    type: TYPE,
    risk: triage.risk || 'medium',
    amount: triage.amount_claimed || null
  });

  teaser.style.display = 'block';

  setTimeout(() => {
    teaser.classList.add('teaser--visible');
  }, 10);

  teaser.innerHTML = `
    <div class="offer-card teaser-card" style="border-color:var(--green);background:#f0fdf4;max-width:620px;margin:0 auto;">
      <div style="font-size:1.1rem;font-weight:700;color:#14532d;margin-bottom:12px;">
        ✓ Ihr Schreiben ist eingegangen.
      </div>
      <p style="color:#166534;margin-bottom:12px;line-height:1.7;">
        Wir werden Ihr Dokument sorgfältig prüfen und Ihnen spätestens am nächsten Werktag bis 16:00 Uhr eine erste Einschätzung per E-Mail zukommen lassen.
      </p>
      <div style="background:#fff;border:1px solid #bbf7d0;border-radius:8px;padding:14px;margin-bottom:14px;">
        <strong style="color:#14532d;">Warum das wichtig ist:</strong>
        <p style="color:#166534;margin-top:6px;margin-bottom:0;line-height:1.65;">
          Bei Zahlungserinnerungen und Mahnschreiben können Fristen und zusätzliche Kosten entstehen, wenn Sie nicht rechtzeitig reagieren. Unsere Einschätzung klärt, ob Handlungsbedarf besteht.
        </p>
      </div>
      <p style="font-size:.85rem;color:#166534;">
        → Bitte prüfen Sie auch Ihren Spam-Ordner, falls Sie keine E-Mail erhalten.
      </p>
      <p style="font-size:.85rem;color:#166534;margin-top:8px;">Vielen Dank für Ihr Vertrauen.</p>
    </div>
  `;

  teaser.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function ctaText(risk) {
  if (risk === 'high') return `Jetzt prüfen und unnötige Kosten vermeiden — €${PRICE} →`;
  if (risk === 'low')  return `Klarheit schaffen mit vollständiger Analyse — €${PRICE} →`;
  return `Vollständige Analyse + Widerspruch erhalten — €${PRICE} →`;
}

window.goToStripe = function() {
  track('stripe_clicked', {
    type:  TYPE,
    price: PRICE
  });

  if (stripeLink) {
    window.location.href = stripeLink;
    return;
  }

  openModal('modal');
};

// ── Paid upload fallback flow for danke.html ─────────────────────────────────

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
  const params    = new URLSearchParams(window.location.search);
  const sessionId = params.get('session_id');
  const autoCard  = document.getElementById('auto-card');

  // Hybride B-flow: danke.html beheert auto/fallback state.
  // app.js mag hier niet zelf thankyou-app tonen, anders ontstaat race condition.
  if (autoCard) return;

  if (sessionId?.startsWith('cs_')) {
    const app = document.getElementById('thankyou-app');
    if (app) app.style.display = 'block';

    const emailEl = document.getElementById('customer-email');
    if (emailEl && params.get('email')) {
      emailEl.value = params.get('email');
    }
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

  box.classList.remove('hidden');
  box.className = 'status-box ' + type;
  box.innerHTML = esc(msg);
}

async function doSubmit() {
  const name   = document.getElementById('customer-name')?.value.trim();
  const email  = document.getElementById('customer-email')?.value.trim();
  const params = new URLSearchParams(window.location.search);
  const file   = document.getElementById('real-file-input')?.files?.[0] || selectedFile;

  const emailOk =
    email &&
    email.includes('@') &&
    email.includes('.') &&
    email.length > 5;

  if (!name || !emailOk || !file) {
    showStatus('Bitte alle Felder korrekt ausfüllen.', 'error');
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
      onStatus:  showStatus
    });

    const fallback = document.getElementById('thankyou-app');
    if (fallback) fallback.classList.add('hidden');

    const success = document.getElementById('success-screen');
    if (success) {
      success.classList.remove('hidden');
      return;
    }

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
