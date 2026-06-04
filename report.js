const STORAGE_KEY = "tabReport";

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

async function saveReport() {
  if (!reportData) return;
  reportData.tabCount = reportData.tabs.length;
  await chrome.storage.local.set({ [STORAGE_KEY]: reportData });
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
    return;
  }

  empty.hidden = true;
  const count = reportData.tabs.length;
  const failed = reportData.tabs.filter((t) => !t.screenshot).length;
  meta.textContent = `${count} tab${count === 1 ? "" : "s"} · Generated ${formatGeneratedAt(reportData.generatedAt)}${failed ? ` · ${failed} without screenshot` : ""} · Drag to reorder`;
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
        <p class="tab-card-url">
          <a href="${escapeAttr(tab.url)}" target="_blank" rel="noopener noreferrer">
            ${escapeHtml(tab.url || "(no URL)")}
          </a>
        </p>
        ${
          tab.description
            ? `<p class="tab-description">${escapeHtml(tab.description)}</p>`
            : ""
        }
      </div>
      <div class="tab-card-media">${buildScreenshotBlock(tab)}</div>
    </div>
  `;

  card.querySelector(".btn-delete").addEventListener("click", (e) => {
    e.stopPropagation();
    reportData.tabs.splice(index, 1);
    saveReport();
    renderReport();
  });

  const handle = card.querySelector(".drag-handle");
  handle.addEventListener("mousedown", () => {
    card.draggable = true;
    setRearrangeMode(true);
  });
  handle.addEventListener("mouseup", () => {
    requestAnimationFrame(() => {
      if (!isDragging) {
        setRearrangeMode(false);
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

function setRearrangeMode(on) {
  document.getElementById("report-root")?.classList.toggle("is-rearranging", on);
}

function setupDragAndDrop(root) {
  root.addEventListener("dragstart", (e) => {
    const card = e.target.closest(".tab-card");
    if (!card || !root.contains(card)) return;

    isDragging = true;
    draggedIndex = Number(card.dataset.index);
    card.classList.add("is-dragging");
    setRearrangeMode(true);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", card.dataset.index);

    const ghost = card.cloneNode(true);
    ghost.classList.add("tab-card-drag-ghost");
    ghost.classList.remove("is-dragging");
    ghost.setAttribute("aria-hidden", "true");
    document.body.appendChild(ghost);
    const rect = ghost.getBoundingClientRect();
    e.dataTransfer.setDragImage(ghost, rect.width / 2, rect.height / 2);
    requestAnimationFrame(() => ghost.remove());
  });

  root.addEventListener("dragend", (e) => {
    const card = e.target.closest(".tab-card");
    if (card) card.classList.remove("is-dragging");
    root.querySelectorAll(".tab-card.is-drop-target").forEach((el) => {
      el.classList.remove("is-drop-target");
    });
    isDragging = false;
    draggedIndex = null;
    setRearrangeMode(false);
  });

  root.addEventListener("dragover", (e) => {
    const card = e.target.closest(".tab-card");
    if (!card || !root.contains(card) || draggedIndex === null) return;

    e.preventDefault();
    e.dataTransfer.dropEffect = "move";

    root.querySelectorAll(".tab-card.is-drop-target").forEach((el) => {
      el.classList.remove("is-drop-target");
    });
    card.classList.add("is-drop-target");
  });

  root.addEventListener("dragleave", (e) => {
    const card = e.target.closest(".tab-card");
    if (card && !card.contains(e.relatedTarget)) {
      card.classList.remove("is-drop-target");
    }
  });

  root.addEventListener("drop", (e) => {
    e.preventDefault();
    const card = e.target.closest(".tab-card");
    if (!card || draggedIndex === null) return;

    const dropIndex = Number(card.dataset.index);
    if (draggedIndex === dropIndex) return;

    const [moved] = reportData.tabs.splice(draggedIndex, 1);
    reportData.tabs.splice(dropIndex, 0, moved);

    setRearrangeMode(false);
    saveReport();
    renderReport();
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
}

async function loadReport() {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  reportData = stored[STORAGE_KEY] ?? null;

  const root = document.getElementById("report-root");
  setupDragAndDrop(root);

  if (!reportData?.tabs?.length) {
    updateMeta();
    return;
  }

  renderReport();
}

loadReport().catch((err) => {
  document.getElementById("report-meta").textContent = `Error loading report: ${err?.message || err}`;
});
