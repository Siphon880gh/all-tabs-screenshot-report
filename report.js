const VIEW_MODE_KEY = "reportViewMode";

function isNonNavigableUrl(url = "") {
  return (
    url.startsWith("chrome://") ||
    url.startsWith("chrome-extension://") ||
    url.startsWith("edge://") ||
    url.startsWith("about:") ||
    url.startsWith("devtools://") ||
    url.startsWith("file://") ||
    url.startsWith("view-source:") ||
    url.startsWith("chrome-untrusted://")
  );
}

function buildUrlBlock(tab) {
  if (tab.openExtensionSettings) {
    return `
        <p class="tab-card-url">
          <span class="tab-card-url-text">Extension settings</span>
          <button type="button" class="btn-open-settings">Open extension settings</button>
        </p>`;
  }

  const url = tab.url || "";
  if (!url || isNonNavigableUrl(url)) {
    return `<p class="tab-card-url"><span class="tab-card-url-text">${escapeHtml(url || "(no URL)")}</span></p>`;
  }

  return `
        <p class="tab-card-url">
          <a href="${escapeAttr(url)}" target="_blank" rel="noopener noreferrer">
            ${escapeHtml(url)}
          </a>
        </p>`;
}

/** @type {"full" | "thumbnail"} */
let viewMode = "full";

/** @type {{ generatedAt?: string, tabCount?: number, tabs: object[] } | null} */
let reportData = null;

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(text) {
  return escapeHtml(text).replace(/'/g, "&#39;");
}

function formatGeneratedAt(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function screenshotFilename(index, dataUrl = "") {
  const ext = dataUrl.includes("image/jpeg") ? "jpg" : "png";
  return `screenshot${String(index + 1).padStart(2, "0")}.${ext}`;
}

function dataUrlToBlob(dataUrl) {
  const [header, base64] = dataUrl.split(",");
  const mime = header.match(/:(.*?);/)?.[1] || "image/png";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mime });
}

const EXPORT_STYLES = `
:root {
  font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
  color: #1a1a1a;
  background: #f4f4f5;
}
body {
  margin: 0;
  padding: 24px;
  max-width: 960px;
  margin-inline: auto;
}
.report-header { margin-bottom: 24px; }
.report-header h1 { margin: 0 0 8px; font-size: 1.5rem; }
.report-meta { margin: 0; color: #555; font-size: 0.9rem; }
.report-root { display: flex; flex-direction: column; gap: 20px; }
.tab-card {
  background: #fff;
  border: 1px solid #ddd;
  border-radius: 8px;
  padding: 16px 20px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06);
}
.tab-card-info h2 {
  margin: 0 0 8px;
  font-size: 1.1rem;
  line-height: 1.35;
  word-break: break-word;
}
.tab-card-url a { color: #1a56db; word-break: break-all; }
.tab-description {
  margin: 0 0 12px;
  color: #444;
  font-size: 0.9rem;
  line-height: 1.45;
}
.tab-screenshot {
  display: block;
  max-width: 100%;
  height: auto;
  border: 1px solid #e5e5e5;
  border-radius: 4px;
}
.screenshot-error {
  min-height: 240px;
  border: 2px dashed #999;
  padding: 24px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  color: #555;
  background: #fafafa;
  border-radius: 4px;
  box-sizing: border-box;
}
.screenshot-error strong { color: #333; margin-bottom: 8px; }
`.trim();

function buildExportScreenshotBlock(tab, index) {
  if (tab.screenshot) {
    const filename = screenshotFilename(index, tab.screenshot || "");
    return `<img class="tab-screenshot" src="${escapeAttr(filename)}" alt="Screenshot of ${escapeAttr(tab.title)}">`;
  }
  return `<div class="screenshot-error">
    <strong>Screenshot unavailable</strong>
    <span>${escapeHtml(tab.error || "Unknown error")}</span>
  </div>`;
}

function buildExportHtml() {
  const count = reportData.tabs.length;
  const failed = reportData.tabs.filter((t) => !t.screenshot).length;
  const meta = `${count} tab${count === 1 ? "" : "s"} · Generated ${formatGeneratedAt(reportData.generatedAt)}${failed ? ` · ${failed} without screenshot` : ""}`;

  const cards = reportData.tabs
    .map(
      (tab, index) => `
    <section class="tab-card">
      <div class="tab-card-info">
        <h2>${escapeHtml(tab.title)}</h2>
        ${buildUrlBlock(tab)}
        ${tab.description ? `<p class="tab-description">${escapeHtml(tab.description)}</p>` : ""}
      </div>
      ${buildExportScreenshotBlock(tab, index)}
    </section>`
    )
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Tab Screenshot Report</title>
    <style>${EXPORT_STYLES}</style>
  </head>
  <body>
    <header class="report-header">
      <h1>Tab Screenshot Report</h1>
      <p class="report-meta">${escapeHtml(meta)}</p>
    </header>
    <main class="report-root">
${cards}
    </main>
  </body>
</html>
`;
}

async function writeFileToDirectory(dirHandle, filename, blob) {
  const fileHandle = await dirHandle.getFileHandle(filename, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(blob);
  await writable.close();
}

async function exportReport() {
  if (!reportData?.tabs?.length) return;

  if (typeof window.showDirectoryPicker !== "function") {
    alert("Export requires a browser that supports folder selection (Chrome or Edge).");
    return;
  }

  const btn = document.getElementById("btn-export");
  btn.disabled = true;
  const originalLabel = btn.textContent;
  btn.textContent = "Exporting…";

  try {
    const dirHandle = await window.showDirectoryPicker({
      mode: "readwrite",
      startIn: "downloads",
    });

    await writeFileToDirectory(dirHandle, "index.html", new Blob([buildExportHtml()], { type: "text/html" }));

    for (let i = 0; i < reportData.tabs.length; i += 1) {
      const tab = reportData.tabs[i];
      if (tab.screenshot) {
        await writeFileToDirectory(
          dirHandle,
          screenshotFilename(i, tab.screenshot),
          dataUrlToBlob(tab.screenshot)
        );
      }
    }

    btn.textContent = "Exported";
    setTimeout(() => {
      btn.textContent = originalLabel;
    }, 2000);
  } catch (err) {
    if (err?.name !== "AbortError") {
      alert(`Export failed: ${err?.message || err}`);
    }
    btn.textContent = originalLabel;
  } finally {
    btn.disabled = !reportData?.tabs?.length;
  }
}

function printReport() {
  if (!reportData?.tabs?.length) return;
  window.print();
}

function updateViewToggleButton() {
  const btn = document.getElementById("btn-view-toggle");
  if (!btn) return;
  const thumbnail = viewMode === "thumbnail";
  btn.textContent = thumbnail ? "Full view" : "Thumbnails";
  btn.setAttribute(
    "aria-pressed",
    thumbnail ? "true" : "false"
  );
  btn.title = thumbnail
    ? "Show full-size screenshots"
    : "Show compact thumbnail grid";
}

function applyViewLayout() {
  const root = document.getElementById("report-root");
  if (!root) return;
  const showThumbnail =
    viewMode === "thumbnail" || isDragging || isDragHandleActive;
  root.classList.toggle("is-thumbnail-view", showThumbnail);
}

function setViewMode(mode) {
  viewMode = mode === "thumbnail" ? "thumbnail" : "full";
  applyViewLayout();
  updateViewToggleButton();
  chrome.storage.local.set({ [VIEW_MODE_KEY]: viewMode }).catch(() => {});
}

function toggleViewMode() {
  setViewMode(viewMode === "thumbnail" ? "full" : "thumbnail");
}

function updateActionButtons() {
  const hasTabs = Boolean(reportData?.tabs?.length);
  document.getElementById("btn-export").disabled = !hasTabs;
  document.getElementById("btn-print").disabled = !hasTabs;
  const viewBtn = document.getElementById("btn-view-toggle");
  if (viewBtn) viewBtn.disabled = !hasTabs;
}

async function saveReport() {
  if (!reportData) return;
  reportData.tabCount = reportData.tabs.length;
  await saveTabReport(reportData);
}

async function clearStoredReport() {
  const ok = window.confirm(
    "Clear the stored report from this extension? You can generate a new report anytime."
  );
  if (!ok) return;

  await clearTabReport();
  reportData = null;
  renderReport();
  updateClearStorageButton();
}

function updateClearStorageButton() {
  const btn = document.getElementById("btn-clear-storage");
  if (!btn) return;
  const hasStored = Boolean(reportData?.tabs?.length || reportData?.generatedAt);
  btn.disabled = !hasStored;
}

function updateMeta() {
  const meta = document.getElementById("report-meta");
  const empty = document.getElementById("report-empty");
  const root = document.getElementById("report-root");

  if (!reportData?.tabs?.length) {
    meta.textContent = reportData?.generatedAt
      ? `Generated ${formatGeneratedAt(reportData.generatedAt)} · no items`
      : "";
    root.replaceChildren();
    empty.hidden = false;
    updateActionButtons();
    updateClearStorageButton();
    return;
  }

  empty.hidden = true;
  const count = reportData.tabs.length;
  const failed = reportData.tabs.filter((t) => !t.screenshot).length;
  meta.textContent = `${count} tab${count === 1 ? "" : "s"} · Generated ${formatGeneratedAt(reportData.generatedAt)}${failed ? ` · ${failed} without screenshot` : ""} · Drag to reorder`;
  updateActionButtons();
  updateClearStorageButton();
}

function buildScreenshotBlock(tab) {
  if (tab.screenshot) {
    return `<img class="tab-screenshot" src="${tab.screenshot}" alt="Screenshot of ${escapeAttr(tab.title)}">`;
  }
  return `<div class="screenshot-error" title="${escapeAttr(tab.error || "Unknown error")}">
    <strong>Screenshot unavailable</strong>
    <span class="screenshot-error-detail">${escapeHtml(tab.error || "Unknown error")}</span>
  </div>`;
}

function createTabCard(tab, index) {
  const card = document.createElement("section");
  card.className = "tab-card";
  card.draggable = false;
  card.dataset.index = String(index);

  card.innerHTML = `
    <div class="tab-card-toolbar">
      <button type="button" class="drag-handle" aria-label="Drag to reorder" title="Drag to reorder">⠿</button>
      <span class="tab-card-index">${index + 1}</span>
      <button type="button" class="btn-delete" aria-label="Remove from report" title="Remove from report">Delete</button>
    </div>
    <div class="tab-card-body">
      <div class="tab-card-info">
        <h2>${escapeHtml(tab.title)}</h2>
        ${buildUrlBlock(tab)}
        ${
          tab.description
            ? `<p class="tab-description">${escapeHtml(tab.description)}</p>`
            : ""
        }
      </div>
      <div class="tab-card-media">${buildScreenshotBlock(tab)}</div>
    </div>
  `;

  const settingsBtn = card.querySelector(".btn-open-settings");
  if (settingsBtn) {
    settingsBtn.addEventListener("click", () => {
      chrome.tabs.create({
        url: `chrome://extensions/?id=${chrome.runtime.id}`,
      });
    });
  }

  card.querySelector(".btn-delete").addEventListener("click", (e) => {
    e.stopPropagation();
    const idx = Number(card.dataset.index);
    reportData.tabs.splice(idx, 1);
    saveReport();
    renderReport();
  });

  const handle = card.querySelector(".drag-handle");
  handle.addEventListener("mousedown", () => {
    card.draggable = true;
    isDragHandleActive = true;
    applyViewLayout();
  });
  handle.addEventListener("mouseup", () => {
    requestAnimationFrame(() => {
      isDragHandleActive = false;
      if (!isDragging) {
        applyViewLayout();
      }
      card.draggable = false;
    });
  });
  card.addEventListener("dragend", () => {
    card.draggable = false;
  });

  return card;
}

let draggedIndex = null;
let isDragging = false;
let isDragHandleActive = false;
let dropHandled = false;
/** @type {object[] | null} */
let dragStartTabs = null;
/** @type {number | null} */
let dragoverRaf = null;

const TRANSPARENT_DRAG_IMAGE = new Image();
TRANSPARENT_DRAG_IMAGE.src =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

function syncCardIndices(root) {
  root.querySelectorAll(".tab-card").forEach((card, i) => {
    card.dataset.index = String(i);
    const label = card.querySelector(".tab-card-index");
    if (label) label.textContent = String(i + 1);
  });
}

/** Inset on card midlines so pointer near an edge does not flip-flop slots. */
const INSERT_HYSTERESIS = 0.2;

function syncTabsFromDomOrder(root) {
  if (!reportData?.tabs) return;
  const tabs = reportData.tabs;
  reportData.tabs = [...root.querySelectorAll(".tab-card")].map(
    (card) => tabs[Number(card.dataset.index)]
  );
  syncCardIndices(root);
}

function animateCardReflow(root) {
  const cards = [...root.querySelectorAll(".tab-card")];
  const before = new Map(cards.map((card) => [card, card.getBoundingClientRect()]));

  return () => {
    for (const card of cards) {
      const prev = before.get(card);
      const next = card.getBoundingClientRect();
      const dx = prev.left - next.left;
      const dy = prev.top - next.top;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;

      card.style.transition = "none";
      card.style.transform = `translate(${dx}px, ${dy}px)`;
      card.offsetHeight;
      card.style.transition = "transform 0.22s ease";
      card.style.transform = "";

      const onEnd = () => {
        card.style.transition = "";
        card.removeEventListener("transitionend", onEnd);
      };
      card.addEventListener("transitionend", onEnd);
    }
  };
}

/** DOM-order insert slot from pointer (grid read order: row, then column). */
function findInsertBeforeCard(root, dragged, clientX, clientY) {
  const cards = [...root.querySelectorAll(".tab-card")];

  for (let i = 0; i < cards.length; i += 1) {
    const card = cards[i];
    if (card === dragged) continue;

    const rect = card.getBoundingClientRect();
    const rowBand = rect.height * INSERT_HYSTERESIS;
    const colBand = rect.width * INSERT_HYSTERESIS;
    const midY = rect.top + rect.height / 2;
    const midX = rect.left + rect.width / 2;
    const onRow = clientY >= rect.top + rowBand && clientY <= rect.bottom - rowBand;

    if (clientY < midY - rowBand) {
      return card;
    }
    if (onRow && clientX < midX - colBand) {
      return card;
    }
    if (onRow && clientX > midX + colBand) {
      const next = cards.slice(i + 1).find((c) => c !== dragged);
      if (next) return next;
    }
  }
  return null;
}

function isDraggedInSlot(dragged, insertBefore) {
  if (insertBefore) {
    return dragged.nextElementSibling === insertBefore;
  }
  return dragged.nextElementSibling === null;
}

function applyDragInsertion(root, dragged, insertBefore) {
  if (isDraggedInSlot(dragged, insertBefore)) return false;

  const playFlip = animateCardReflow(root);
  if (insertBefore) {
    root.insertBefore(dragged, insertBefore);
  } else {
    root.appendChild(dragged);
  }
  syncTabsFromDomOrder(root);
  playFlip();
  return true;
}

function setDropIndicator(root, insertBefore) {
  root.querySelectorAll(".tab-card.is-drop-target").forEach((el) => {
    el.classList.remove("is-drop-target");
  });
  if (insertBefore && !insertBefore.classList.contains("is-dragging")) {
    insertBefore.classList.add("is-drop-target");
  }
}

function getDraggedCard(root) {
  return root.querySelector(".tab-card.is-dragging");
}

function setupDragAndDrop(root) {
  root.addEventListener("dragstart", (e) => {
    const card = e.target.closest(".tab-card");
    if (!card || !root.contains(card)) return;

    isDragging = true;
    dropHandled = false;
    dragStartTabs = reportData?.tabs ? [...reportData.tabs] : null;
    draggedIndex = Number(card.dataset.index);
    card.classList.add("is-dragging");
    applyViewLayout();
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", card.dataset.index);
    e.dataTransfer.setDragImage(TRANSPARENT_DRAG_IMAGE, 0, 0);
  });

  root.addEventListener("dragend", (e) => {
    if (dragoverRaf) {
      cancelAnimationFrame(dragoverRaf);
      dragoverRaf = null;
    }

    const card = e.target.closest(".tab-card");
    if (card) card.classList.remove("is-dragging");
    root.querySelectorAll(".tab-card.is-drop-target").forEach((el) => {
      el.classList.remove("is-drop-target");
    });

    if (!dropHandled && dragStartTabs && reportData) {
      reportData.tabs = dragStartTabs;
      renderReport();
    }

    isDragging = false;
    isDragHandleActive = false;
    draggedIndex = null;
    dragStartTabs = null;
    dropHandled = false;
    applyViewLayout();
  });

  root.addEventListener("dragover", (e) => {
    if (draggedIndex === null) return;

    e.preventDefault();
    e.dataTransfer.dropEffect = "move";

    if (dragoverRaf) return;

    const clientX = e.clientX;
    const clientY = e.clientY;
    dragoverRaf = requestAnimationFrame(() => {
      dragoverRaf = null;

      const dragged = getDraggedCard(root);
      if (!dragged) return;

      const insertBefore = findInsertBeforeCard(root, dragged, clientX, clientY);
      setDropIndicator(root, insertBefore);
      applyDragInsertion(root, dragged, insertBefore);
      draggedIndex = Number(dragged.dataset.index);
    });
  });

  root.addEventListener("dragleave", (e) => {
    const card = e.target.closest(".tab-card");
    if (card && !card.contains(e.relatedTarget)) {
      card.classList.remove("is-drop-target");
    }
  });

  root.addEventListener("drop", (e) => {
    e.preventDefault();
    dropHandled = true;

    const dragged = getDraggedCard(root);
    if (dragged) {
      dragged.classList.remove("is-dragging");
    }
    root.querySelectorAll(".tab-card.is-drop-target").forEach((el) => {
      el.classList.remove("is-drop-target");
    });

    if (draggedIndex !== null && reportData?.tabs) {
      saveReport();
    }
  });
}

function renderReport() {
  const root = document.getElementById("report-root");
  root.replaceChildren();

  if (!reportData?.tabs?.length) {
    updateMeta();
    return;
  }

  reportData.tabs.forEach((tab, index) => {
    root.appendChild(createTabCard(tab, index));
  });

  updateMeta();
  applyViewLayout();
}

async function loadReport() {
  const stored = await chrome.storage.local.get([VIEW_MODE_KEY]);
  reportData = await loadTabReport();
  if (stored[VIEW_MODE_KEY] === "thumbnail" || stored[VIEW_MODE_KEY] === "full") {
    viewMode = stored[VIEW_MODE_KEY];
  }

  const root = document.getElementById("report-root");
  setupDragAndDrop(root);

  document.getElementById("btn-view-toggle").addEventListener("click", toggleViewMode);
  updateViewToggleButton();
  applyViewLayout();

  document.getElementById("btn-export").addEventListener("click", () => {
    exportReport().catch((err) => {
      alert(`Export failed: ${err?.message || err}`);
    });
  });
  document.getElementById("btn-print").addEventListener("click", printReport);
  document.getElementById("btn-clear-storage").addEventListener("click", () => {
    clearStoredReport().catch((err) => {
      alert(`Could not clear stored report: ${err?.message || err}`);
    });
  });
  updateClearStorageButton();

  if (!reportData?.tabs?.length) {
    updateMeta();
    return;
  }

  renderReport();
}

loadReport().catch((err) => {
  document.getElementById("report-meta").textContent = `Error loading report: ${err?.message || err}`;
});
