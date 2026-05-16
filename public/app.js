// Gedeelde frontend helpers voor MussIchZahlen
// Werkt als normale browser-JS via: <script src="/app.js"></script>
// Geen ES modules. Geen export. Geen import.

const WORKER_URL = "/api";
const MAX_FILE_SIZE = 8 * 1024 * 1024; // 8 MB
const ALLOWED_EXT = [".pdf", ".jpg", ".jpeg", ".png"];

// Analytics
function track(eventName, payload = {}) {
  const event = {
    event: eventName,
    path: window.location.pathname,
    url: window.location.href,
    referrer: document.referrer || null,
    ts: new Date().toISOString(),
    ...payload,
  };

  try {
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push(event);
  } catch (_) {}

  try {
    const body = JSON.stringify(event);

    if (navigator.sendBeacon) {
      const blob = new Blob([body], { type: "application/json" });
      navigator.sendBeacon(`${WORKER_URL}/track`, blob);
      return;
    }

    fetch(`${WORKER_URL}/track`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => {});
  } catch (_) {}
}

const trackEvent = track;

// Bestandvalidatie
function validateFile(file) {
  if (!file) return "Keine Datei ausgewählt";

  if (file.size > MAX_FILE_SIZE) {
    return `Datei zu groß (max. 8 MB, Ihre Datei: ${(file.size / 1024 / 1024).toFixed(1)} MB)`;
  }

  const ext = "." + file.name.split(".").pop().toLowerCase();

  if (!ALLOWED_EXT.includes(ext)) {
    return "Dateityp nicht erlaubt. Bitte PDF, JPG oder PNG verwenden.";
  }

  return null;
}

function formatFileSize(bytes) {
  if (!Number.isFinite(bytes)) return "0 B";

  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// File reader helper
function readFileAsArrayBuffer(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => resolve(reader.result);

    reader.onerror = () => {
      reject(
        new Error(
          "Datei konnte nicht gelesen werden. Bitte erneut versuchen."
        )
      );
    };

    reader.readAsArrayBuffer(file);
  });
}

// Fetch helper met timeout
async function fetchWithTimeout(url, options = {}, timeoutMs = 60000) {
  const controller = new AbortController();

  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });

    clearTimeout(timer);

    return response;
  } catch (error) {
    clearTimeout(timer);

    if (error.name === "AbortError") {
      throw new Error(
        "Zeitüberschreitung — bitte Verbindung prüfen und erneut versuchen."
      );
    }

    throw new Error(
      "Netzwerkfehler — bitte Verbindung prüfen und erneut versuchen."
    );
  }
}

// Gratis analyse
async function submitFree({
  file,
  name,
  email,
  type,
  onStatus,
}) {
  onStatus?.("info", "Schreiben wird geprüft…");

  const validationError = validateFile(file);

  if (validationError) {
    throw new Error(validationError);
  }

  let buffer;

  try {
    buffer = await readFileAsArrayBuffer(file);
  } catch (_) {
    throw new Error(
      "Datei konnte nicht gelesen werden. Bitte erneut versuchen."
    );
  }

  const blob = new Blob([buffer], {
    type: file.type || "application/octet-stream",
  });

  const formData = new FormData();

  formData.append("file", blob, file.name);
  formData.append("name", name || "");
  formData.append("email", email || "");
  formData.append("type", type || "mahnung");

  const response = await fetchWithTimeout(
    `${WORKER_URL}/analyze-free`,
    {
      method: "POST",
      body: formData,
    }
  );

  let data;

  try {
    data = await response.json();
  } catch (_) {
    throw new Error(
      "Serverantwort konnte nicht gelesen werden."
    );
  }

  if (!response.ok || !data.ok) {
    throw new Error(data?.error || "Prüfung fehlgeschlagen");
  }

  track("upload_completed", {
    type,
    tier: data.tier || data?.triage?.tier || null,
    emailType: data.emailType || data?.triage?.emailType || null,
    fileType: file.type || null,
    fileSize: file.size || null,
  });

  return data;
}

// Paid analyse zonder tweede upload
async function submitAutoPaid({
  type,
  sessionId,
  onStatus,
}) {
  onStatus?.("info", "Zahlung wird geprüft…");

  const response = await fetchWithTimeout(
    `${WORKER_URL}/submit-auto`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        type,
        session_id: sessionId,
      }),
    }
  );

  const data = await response.json().catch(() => ({}));

  if (!response.ok || !data.ok) {
    const error = new Error(
      data?.error || `Fehler ${response.status}`
    );

    if (
      data?.need_upload ||
      data?.needUpload ||
      response.status === 404
    ) {
      error.needUpload = true;
    }

    throw error;
  }

  onStatus?.("success", "Analyse gestartet.");

  return data;
}

// Fallback paid upload
async function submitPaid({
  file,
  name,
  email,
  type,
  sessionId,
  onStatus,
}) {
  onStatus?.("info", "Dokument wird sicher hochgeladen…");

  const validationError = validateFile(file);

  if (validationError) {
    throw new Error(validationError);
  }

  let buffer;

  try {
    buffer = await readFileAsArrayBuffer(file);
  } catch (_) {
    throw new Error(
      "Datei konnte nicht gelesen werden. Bitte erneut versuchen."
    );
  }

  const blob = new Blob([buffer], {
    type: file.type || "application/octet-stream",
  });

  const formData = new FormData();

  formData.append("file", blob, file.name);
  formData.append("name", name || "");
  formData.append("email", email || "");
  formData.append("type", type || "mahnung");

  if (sessionId) {
    formData.append("session_id", sessionId);
  }

  const response = await fetchWithTimeout(
    `${WORKER_URL}/submit`,
    {
      method: "POST",
      body: formData,
    }
  );

  let data;

  try {
    data = await response.json();
  } catch (_) {
    throw new Error(
      "Serverantwort konnte nicht gelesen werden."
    );
  }

  if (!response.ok || !data.ok) {
    throw new Error(
      data?.error || "Upload fehlgeschlagen"
    );
  }

  return data;
}

// FAQ accordion
function initFaq() {
  document.querySelectorAll(".faq-q").forEach((question) => {
    question.addEventListener("click", () => {
      const item = question.closest(".faq-item");

      if (!item) return;

      const answer = item.querySelector(".faq-a");
      const chevron = item.querySelector(".faq-chevron");

      const isOpen = item.classList.contains(
        "faq-item--open"
      );

      document
        .querySelectorAll(".faq-item--open")
        .forEach((openItem) => {
          openItem.classList.remove("faq-item--open");

          const openAnswer =
            openItem.querySelector(".faq-a");

          const openChevron =
            openItem.querySelector(".faq-chevron");

          if (openAnswer) {
            openAnswer.style.maxHeight = null;
          }

          if (openChevron) {
            openChevron.style.transform = "";
          }
        });

      if (!isOpen) {
        item.classList.add("faq-item--open");

        if (answer) {
          answer.style.maxHeight =
            answer.scrollHeight + "px";
        }

        if (chevron) {
          chevron.style.transform = "rotate(180deg)";
        }
      }
    });
  });
}

// Modal helpers
function initModal() {
  document
    .querySelectorAll("[data-open-modal]")
    .forEach((button) => {
      button.addEventListener("click", () => {
        openModal(button.dataset.openModal || "modal");
      });
    });

  document
    .querySelectorAll("[data-close-modal]")
    .forEach((button) => {
      button.addEventListener("click", () => {
        closeModal(button.dataset.closeModal || "modal");
      });
    });

  document
    .querySelectorAll(".modal-overlay")
    .forEach((modal) => {
      modal.addEventListener("click", (event) => {
        if (event.target === modal) {
          closeModal(modal.id || "modal");
        }
      });
    });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeModal();
    }
  });
}

function openModal(id = "modal") {
  const modal = document.getElementById(id);

  if (!modal) return;

  modal.classList.add("modal--open");
  modal.classList.add("open");

  document.body.style.overflow = "hidden";
}

function closeModal(id = "modal") {
  const modal = document.getElementById(id);

  if (!modal) return;

  modal.classList.remove("modal--open");
  modal.classList.remove("open");

  document.body.style.overflow = "";
}

// Sticky footer
function initStickyFooter() {
  const footer =
    document.getElementById("sticky-footer");

  if (!footer) return;

  let ticking = false;

  window.addEventListener(
    "scroll",
    () => {
      if (ticking) return;

      ticking = true;

      requestAnimationFrame(() => {
        const scrollY = window.scrollY;

        const nearBottom =
          scrollY + window.innerHeight >
          document.documentElement.scrollHeight - 200;

        const visible =
          scrollY > 400 && !nearBottom;

        footer.classList.toggle(
          "sticky-footer--visible",
          visible
        );

        footer.classList.toggle(
          "visible",
          visible
        );

        ticking = false;
      });
    },
    { passive: true }
  );
}

// Globale browser functies
window.track = track;
window.trackEvent = trackEvent;
window.validateFile = validateFile;
window.formatFileSize = formatFileSize;
window.submitFree = submitFree;
window.submitPaid = submitPaid;
window.submitAutoPaid = submitAutoPaid;
window.initFaq = initFaq;
window.initModal = initModal;
window.openModal = openModal;
window.closeModal = closeModal;
window.initStickyFooter = initStickyFooter;
