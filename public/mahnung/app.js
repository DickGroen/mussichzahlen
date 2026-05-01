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

// 🔥 TRACK PAGE VIEW
track('page_view', { type: TYPE });

// ── FREE TRIAGE FLOW ─────────────────────────────────────────────────────────

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

  btn.disabled = !(gratisFile && name && email.includes('@'));
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

    const triage = normalizeTriage(data.triage || {});
    stripeLink = data.stripeLink || triage.stripeLink || stripeLink;

    // 🔥 TRACK TRIAGE DONE
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

// ── TRIAGE NORMALIZATION ─────────────────────────────────────────────────────

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

  return 'Es gibt Hinweise darauf, dass diese Forderung nicht vollständig eindeutig ist. Ohne Prüfung könnten unnötige Kosten entstehen.';
}

// ── TEASER RENDER ────────────────────────────────────────────────────────────

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

  document.getElementById('teaser-company').textContent =
    'Erste Einschätzung abgeschlossen';

  document.getElementById('teaser-sub').textContent =
    `${riskLabel[risk]}${amount ? ` • Betrag: €${esc(amount)}` : ''}`;

  document.getElementById('modal-dynamic-copy').textContent =
    triage.teaser;

  document.getElementById('teaser-financial').innerHTML =
    amount
      ? `💸 Ohne weitere Prüfung riskierst du, bis zu <strong>€${esc(amount)}</strong> zu zahlen — möglicherweise unnötig.`
      : `💸 Ohne genauere Analyse könnten unnötige Kosten entstehen.`;

  document.getElementById('teaser-cta').innerHTML = `
    <h3>🔍 Vollständige Analyse + fertiger Widerspruch</h3>
    <ul>
      <li>✓ Konkrete Bewertung</li>
      <li>✓ Klare Handlung</li>
      <li>✓ Fertiger Widerspruch</li>
    </ul>

    <button class="offer-cta" onclick="goToStripe()">
      ${ctaText(risk)}
    </button>

    <div style="margin-top:8px;font-size:.85rem;color:var(--muted);">
      Einmalig €${PRICE} · kein Abo · sichere Zahlung
    </div>
  `;

  const modalLink = document.querySelector('.js-stripe-link');
  if (modalLink && stripeLink) modalLink.href = stripeLink;

  teaser.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// ── CTA VARIANTS (HIGH IMPACT) ──────────────────────────────────────────────

function ctaText(risk) {
  if (risk === 'high') return `Jetzt handeln und Kosten vermeiden — €${PRICE} →`;
  if (risk === 'low') return `Analyse im Detail prüfen — €${PRICE} →`;
  return `Jetzt vollständige Analyse erhalten — €${PRICE} →`;
}

// ── STRIPE ──────────────────────────────────────────────────────────────────

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

// ── HELPERS ─────────────────────────────────────────────────────────────────

function esc(str) {
  return String(str || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

// ── INIT ────────────────────────────────────────────────────────────────────

initFaq();
initModal();
initStickyFooter();
