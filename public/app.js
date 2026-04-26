
// ── Gedeelde frontend helpers voor MussIchZahlen ─────────────────────────────

const WORKER_URL      = '/api';
const MAX_FILE_SIZE   = 8 * 1024 * 1024; // 8 MB
const ALLOWED_EXT     = ['.pdf', '.jpg', '.jpeg', '.png'];

// ── Bestand validatie ─────────────────────────────────────────────────────────

export function validateFile(file) {
  if (!file) return 'Keine Datei ausgew\u00e4hlt';
  if (file.size > MAX_FILE_SIZE)
    return `Datei zu gro\u00df (max. 8\u00a0MB, deine Datei: ${(file.size / 1024 / 1024).toFixed(1)}\u00a0MB)`;
  const ext = '.' + file.name.split('.').pop().toLowerCase();
  if (!ALLOWED_EXT.includes(ext))
    return `Dateityp nicht erlaubt. Bitte PDF, JPG oder PNG verwenden.`;
  return null;
}

export function formatFileSize(bytes) {
  if (bytes < 1024)             return bytes + '\u00a0B';
  if (bytes < 1024 * 1024)      return (bytes / 1024).toFixed(1) + '\u00a0KB';
  return (bytes / (1024 * 1024)).toFixed(1) + '\u00a0MB';
}

// ── Kostenlose Triage ─────────────────────────────────────────────────────────

export async function submitFree({ file, name, email, type, onStatus }) {
  onStatus('info', 'Schreiben wird gepr\u00fcft\u2026');

  const formData = new FormData();
  formData.append('file',  file);
  formData.append('name',  name);
  formData.append('email', email);
  formData.append('type',  type);

  const res  = await fetch(`${WORKER_URL}/analyze-free`, { method: 'POST', body: formData });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Pr\u00fcfung fehlgeschlagen');
  return data;
}

// ── Bezahlter Upload ──────────────────────────────────────────────────────────

export async function submitPaid({ file, name, email, type, sessionId, onStatus }) {
  onStatus('info', 'Dokument wird sicher hochgeladen\u2026');

  const formData = new FormData();
  formData.append('file',  file);
  formData.append('name',  name);
  formData.append('email', email);
  formData.append('type',  type);
  if (sessionId) formData.append('session_id', sessionId);

  const res  = await fetch(`${WORKER_URL}/submit`, { method: 'POST', body: formData });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Upload fehlgeschlagen');
  return data;
}

// ── FAQ Accordion ─────────────────────────────────────────────────────────────

export function initFaq() {
  document.querySelectorAll('.faq-q').forEach(q => {
    q.addEventListener('click', () => {
      const item    = q.closest('.faq-item');
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
    });
  });
}

// ── Modal ─────────────────────────────────────────────────────────────────────

export function initModal() {
  document.querySelectorAll('[data-open-modal]').forEach(btn => {
    btn.addEventListener('click', () => openModal(btn.dataset.openModal || 'modal'));
  });
  document.querySelectorAll('[data-close-modal]').forEach(btn => {
    btn.addEventListener('click', () => closeModal());
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });
}

export function openModal(id = 'modal') {
  const modal = document.getElementById(id);
  if (modal) { modal.classList.add('modal--open'); document.body.style.overflow = 'hidden'; }
}

export function closeModal(id = 'modal') {
  const modal = document.getElementById(id);
  if (modal) { modal.classList.remove('modal--open'); document.body.style.overflow = ''; }
}

// ── Sticky Footer ─────────────────────────────────────────────────────────────

export function initStickyFooter() {
  const footer = document.getElementById('sticky-footer');
  if (!footer) return;
  let ticking = false;

  window.addEventListener('scroll', () => {
    if (!ticking) {
      requestAnimationFrame(() => {
        const scrollY    = window.scrollY;
        const nearBottom = scrollY + window.innerHeight > document.documentElement.scrollHeight - 200;
        footer.classList.toggle('sticky-footer--visible', scrollY > 400 && !nearBottom);
        ticking = false;
      });
      ticking = true;
    }
  }, { passive: true });
}
