const STORAGE_KEY = "tabReport";

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

function renderTabCard(tab, index) {
  const card = document.createElement("section");
  card.className = "tab-card";

  const screenshotBlock = tab.screenshot
    ? `<img class="tab-screenshot" src="${tab.screenshot}" alt="Screenshot of ${escapeAttr(tab.title)}">`
    : `<div class="screenshot-error">
         <strong>Screenshot unavailable</strong>
         <span>${escapeHtml(tab.error || "Unknown error")}</span>
       </div>`;

  card.innerHTML = `
    <h2>${index + 1}. ${escapeHtml(tab.title)}</h2>
    <p>
      <a href="${escapeAttr(tab.url)}" target="_blank" rel="noopener noreferrer">
        ${escapeHtml(tab.url || "(no URL)")}
      </a>
    </p>
    ${screenshotBlock}
  `;

  return card;
}

function formatGeneratedAt(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

async function loadReport() {
  const root = document.getElementById("report-root");
  const meta = document.getElementById("report-meta");
  const empty = document.getElementById("report-empty");

  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const report = stored[STORAGE_KEY];

  if (!report?.tabs?.length) {
    meta.textContent = "";
    root.replaceChildren();
    empty.hidden = false;
    return;
  }

  empty.hidden = true;
  const count = report.tabCount ?? report.tabs.length;
  const failed = report.tabs.filter((t) => !t.screenshot).length;
  meta.textContent = `${count} tab${count === 1 ? "" : "s"} · Generated ${formatGeneratedAt(report.generatedAt)}${failed ? ` · ${failed} without screenshot` : ""}`;

  root.replaceChildren();
  report.tabs.forEach((tab, index) => {
    root.appendChild(renderTabCard(tab, index));
  });
}

loadReport().catch((err) => {
  document.getElementById("report-meta").textContent = `Error loading report: ${err?.message || err}`;
});
