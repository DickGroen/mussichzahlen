import {
  validateFile,
  formatFileSize,
  submitFree,
  submitPaid,
  initFaq,
  initModal,
  initStickyFooter,
  openModal,
  closeModal
} from '../app.js';

// Expose to HTML onclick handlers
window.openModal = openModal;
window.closeModal = closeModal;

const TYPE = 'quote';

let selectedFile = null;
let gratisFile = null;

// ── Kostenlose Einschätzung ─────────────────────────────────────────────────

window.handleGratisFileSelect = function(input) {
  if (!input.files?.[0]) return;

  gratisFile = input.files[0];

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
      <div class="upload-label" style="color:var(--green);">&#10003; ${esc(gratisFile.name)}</div>
      <div class="upload-hint">${formatFileSize(gratisFile.size)}</div>
    `;
  }

  const fields = document.getElementById('gratis-contact-fields');
  if (fields) fields.style.display = 'flex';

  checkGratisReady();
};

function checkGratisReady() {
  const name = document.getElementById('gratis-name')?.value.trim() || '';
  const email = document.getElementById('gratis-email')?.value.trim() || '';
  const btn = document.getElementById('gratis-btn');

  if (btn) {
    btn.disabled = !(name && email.includes('@') && email.includes('.') && gratisFile);
  }
}

document.getElementById('gratis-name')?.addEventListener('input', checkGratisReady);
document.getElementById('gratis-email')?.addEventListener('input', checkGratisReady);

window.startGratisUpload = async function() {
  const name = document.getElementById('gratis-name')?.value.trim() || '';
  const email = document.getElementById('gratis-email')?.value.trim() || '';
  const btn = document.getElementById('gratis-btn');
  const status = document.getElementById('gratis-status');

  if (!gratisFile || !btn || !status) return;

  btn.disabled = true;
  btn.textContent = 'Wird geprüft…';

  try {
    const data = await submitFree({
      file: gratisFile,
      name,
      email,
      type: TYPE,
      onStatus: (t, msg) => {
        status.className = `optie-status optie-status--${t}`;
        status.textContent = msg;
      }
    });

    showTeaser(data.triage);

    status.className = 'optie-status optie-status--success';
    status.textContent =
      'Erledigt! Deine kostenlose Einschätzung ist fertig. Du kannst jetzt die vollständige Analyse freischalten.';

    btn.textContent = 'Geprüft ✓';
  } catch (err) {
    status.className = 'optie-status optie-status--error';
    status.textContent = 'Fehler: ' + err.message;

    btn.disabled = false;
    btn.textContent = 'Kostenlose Einschätzung anfordern';
  }
};

// ── Teaser ─────────────────────────────────────────────────────────────────

function showTeaser(triage) {
  const teaser = document.getElementById('teaser');
  if (!teaser || !triage) return;

  teaser.style.display = 'block';

  setTimeout(() => {
    teaser.classList.add('teaser--visible');
  }, 10);

  const estimatedOverpayment =
    triage.estimated_overpayment ||
    triage.estimatedOverpayment ||
    triage.overpayment ||
    null;

  const overpricePercentage =
    triage.overprice_percentage ||
    triage.overpricePercentage ||
    null;

  const status = triage.status || triage.risk || 'medium';

  const teaserCompany = document.getElementById('teaser-company');
  const teaserSub = document.getElementById('teaser-sub');

  if (teaserCompany) {
    if (estimatedOverpayment) {
      teaserCompany.textContent =
        `Mögliche Überzahlung von ca. €${estimatedOverpayment} erkannt`;
    } else if (overpricePercentage) {
      teaserCompany.textContent =
        `Dieses Angebot wirkt ca. ${overpricePercentage}% höher als erwartet`;
    } else {
      teaserCompany.textContent =
        'Mögliche Auffälligkeiten im Angebot erkannt';
    }
  }

  const statusMsg = {
    overpriced:
      '🔴 Das Angebot wirkt auffällig hoch — eine vollständige Analyse kann sich lohnen.',
    high:
      '🔴 Deutliche Auffälligkeiten erkannt — vollständige Analyse empfohlen.',
    medium:
      '🟠 Mögliche Auffälligkeiten vorhanden — eine vollständige Prüfung gibt mehr Sicherheit.',
    fair:
      '🟡 Das Angebot wirkt teilweise plausibel — einzelne Positionen sollten geprüft werden.',
    low:
      '🟡 Eingeschränkte Auffälligkeiten — eine Prüfung kann trotzdem helfen.'
  };

  if (teaserSub) {
    teaserSub.textContent =
      triage.teaser ||
      triage.summary ||
      statusMsg[status] ||
      statusMsg.medium;
  }

  const modalCopy = document.getElementById('modal-dynamic-copy');

  if (modalCopy) {
    modalCopy.textContent = estimatedOverpayment
      ? `Wir haben eine mögliche Überzahlung von ca. €${estimatedOverpayment} erkannt. In der vollständigen Analyse siehst du, welche Positionen auffällig sind und wie du besser verhandeln kannst.`
      : 'Wir haben mögliche Auffälligkeiten im Angebot erkannt. In der vollständigen Analyse siehst du, welche Positionen du hinterfragen kannst und wie du besser verhandelst.';
  }

  teaser.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// ── Bezahlter Upload (danke.html / bedankt.html) ───────────────────────────

if (document.getElementById('submit-btn')) {
  const fileInput = document.getElementById('real-file-input');

  fileInput?.addEventListener('change', () => {
    if (fileInput.files?.[0]) updateSelectedFile(fileInput.files[0]);
  });

  const uploadPanel = document.getElementById('upload-panel');

  uploadPanel?.addEventListener('dragover', (event) => {
    event.preventDefault();
    uploadPanel.classList.add('drag-over');
  });

  uploadPanel?.addEventListener('dragleave', () => {
    uploadPanel.classList.remove('drag-over');
  });

  uploadPanel?.addEventListener('drop', (event) => {
    event.preventDefault();
    uploadPanel.classList.remove('drag-over');

    if (event.dataTransfer.files?.[0]) {
      fileInput.files = event.dataTransfer.files;
      updateSelectedFile(event.dataTransfer.files[0]);
    }
  });

  document.getElementById('remove-file')?.addEventListener('click', (event) => {
    event.preventDefault();
    clearFile();
  });

  document.getElementById('submit-btn')?.addEventListener('click', doSubmit);

  validateSession();
}

function validateSession() {
  const params = new URLSearchParams(window.location.search);
  const sessionId = params.get('session_id') || params.get('payment_intent');

  const isValid =
    sessionId &&
    (
      sessionId.startsWith('cs_') ||
      sessionId.startsWith('pi_') ||
      sessionId.startsWith('cs_test_') ||
      sessionId.startsWith('cs_live_')
    );

  if (isValid) {
    document.getElementById('thankyou-app').style.display = 'block';

    const emailEl = document.getElementById('customer-email');
    if (emailEl && params.get('email')) emailEl.value = params.get('email');
  } else {
    document.getElementById('locked-screen').style.display = 'block';
  }
}

function updateSelectedFile(file) {
  const err = validateFile(file);

  if (err) {
    showStatus(err, 'error');
    return;
  }

  selectedFile = file;

  document.getElementById('selected-file').classList.add('show');
  document.getElementById('selected-file-name').textContent = file.name;
  document.getElementById('selected-file-meta').textContent =
    formatFileSize(file.size) + ' · bereit';

  const btn = document.getElementById('submit-btn');

  btn.disabled = false;
  btn.textContent = 'Hochladen und Analyse starten';
}

function clearFile() {
  selectedFile = null;

  document.getElementById('real-file-input').value = '';
  document.getElementById('selected-file').classList.remove('show');

  const btn = document.getElementById('submit-btn');

  btn.disabled = true;
  btn.textContent = 'Zuerst eine Datei wählen';
}

function showStatus(msg, type) {
  const box = document.getElementById('status-box');
  if (!box) return;

  box.className = 'status-box ' + type;
  box.innerHTML = msg;
}

async function doSubmit() {
  const name = document.getElementById('customer-name')?.value.trim() || '';
  const email = document.getElementById('customer-email')?.value.trim() || '';
  const params = new URLSearchParams(window.location.search);
  const file =
    document.getElementById('real-file-input')?.files?.[0] ||
    selectedFile;

  if (!name || !email.includes('@') || !file) {
    showStatus('Bitte alle Felder ausfüllen und eine Datei auswählen.', 'error');
    return;
  }

  const btn = document.getElementById('submit-btn');

  btn.disabled = true;
  btn.textContent = 'Wird hochgeladen…';

  try {
    await submitPaid({
      file,
      name,
      email,
      type: TYPE,
      tier: params.get('tier') || 'pro',
      sessionId: params.get('session_id'),
      onStatus: showStatus
    });

    document.querySelector('.thankyou-card').innerHTML = `
      <div class="success-screen">
        <div class="success-screen__icon">&#10003;</div>
        <h2>Upload erfolgreich!</h2>
        <p>Wir analysieren dein Angebot und senden dir die vollständige Einschätzung innerhalb von 24 Stunden an <strong>${esc(email)}</strong>.</p>
        <p style="font-size:.82rem;color:var(--muted);">Bitte auch den Spam-Ordner prüfen.</p>
      </div>
    `;
  } catch (err) {
    showStatus(
      'Upload fehlgeschlagen: ' + err.message + '. Bitte erneut versuchen oder an support@mussichzahlen.de schreiben.',
      'error'
    );

    btn.disabled = false;
    btn.textContent = 'Hochladen und Analyse starten';
  }
}

function esc(str) {
  return String(str || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

// ── Init ────────────────────────────────────────────────────────────────────

initFaq();
initModal();
initStickyFooter();

setTimeout(() => {
  const card = document.getElementById('free-card');

  if (card) {
    card.style.opacity = '0.85';
    card.style.pointerEvents = 'auto';
  }
}, 4000);
