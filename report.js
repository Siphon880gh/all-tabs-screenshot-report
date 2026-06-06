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

function debounce(fn, delayMs) {
  let timeoutId = null;
  return (...args) => {
    if (timeoutId) clearTimeout(timeoutId);
    timeoutId = setTimeout(() => {
      timeoutId = null;
      fn(...args);
    }, delayMs);
  };
}

const saveReportDebounced = debounce(() => {
  saveReport().catch(() => {});
}, 400);

function buildNotesBlock(tab) {
  const value = tab.notes ? escapeHtml(tab.notes) : "";
  return `
    <label class="tab-notes-wrap">
      <span class="tab-notes-label">Notes</span>
      <textarea class="tab-notes" rows="2" placeholder="Add notes or comments…" aria-label="Notes for ${escapeAttr(tab.title)}">${value}</textarea>
    </label>`;
}

function buildExportNotesBlock(tab) {
  const notes = (tab.notes || "").trim();
  if (!notes) return "";
  return `
        <div class="tab-notes-export-wrap">
          <span class="tab-notes-label">Notes</span>
          <div class="tab-notes-rendered">${escapeHtml(notes)}</div>
        </div>`;
}

function syncNotesFromDom() {
  const root = document.getElementById("report-root");
  if (!root || !reportData?.tabs) return;
  root.querySelectorAll(".tab-card").forEach((card, i) => {
    const notesEl = card.querySelector(".tab-notes");
    if (notesEl && reportData.tabs[i]) {
      reportData.tabs[i].notes = notesEl.value;
    }
  });
}

const TOOLBAR_BTN_ICONS = {
  fullScreenshot: `<svg class="btn-icon-svg" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" d="M2.5 5.5V2.5h3M10.5 2.5h3v3M13.5 10.5v3h-3M5.5 13.5h-3v-3"/></svg>`,
  seo: `<svg class="btn-icon-svg" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M2 12.5V7.5h2.75v5H2zm4.375-3.75V4.5h2.75v8.25H6.375zm4.375-2.5V2.5h2.75v10H10.75z"/></svg>`,
  delete: `<svg class="btn-icon-svg" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M5.5 3.5 6 2.5h4l.5 1H14v1H2V3.5h3.5zM3.5 5.5H14l-.85 7.65a.75.75 0 0 1-.74.65H5.13a.75.75 0 0 1-.74-.65L3.5 5.5zm2.6 1.4v5.6h1.1V6.9H6.1zm3.7 0v5.6h1.1V6.9h-1.1z"/></svg>`,
};

function buildToolbarButton(className, iconKey, label, extraAttrs = "") {
  return `<button type="button" class="${className}" ${extraAttrs}><span class="btn-icon">${TOOLBAR_BTN_ICONS[iconKey]}</span><span class="btn-label">${label}</span></button>`;
}

function setToolbarButtonLabel(button, label) {
  const labelEl = button?.querySelector(".btn-label");
  if (labelEl) {
    labelEl.textContent = label;
  } else if (button) {
    button.textContent = label;
  }
}

function getToolbarButtonLabel(button) {
  return button?.querySelector(".btn-label")?.textContent?.trim() || button?.textContent?.trim() || "";
}

function normalizeForCompare(text) {
  return String(text || "").trim().toLowerCase();
}

function compareHeadingsForDisplay(left, right) {
  const normalize = (text) =>
    String(text || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");

  const tokenize = (text) =>
    String(text || "")
      .toLowerCase()
      .replace(/[^\w\s'-]/g, " ")
      .split(/\s+/)
      .filter((word) => word.length > 2);

  const a = normalize(left);
  const b = normalize(right);
  if (!a && !b) return "No title or H1";
  if (!a) return "No H1 on page";
  if (!b) return "No title";
  if (a === b) return "Exact match";
  if (a.includes(b) || b.includes(a)) return "Partial match (one contains the other)";

  const wordsA = new Set(tokenize(left));
  const wordsB = new Set(tokenize(right));
  const shared = [...wordsA].filter((word) => wordsB.has(word));
  const union = new Set([...wordsA, ...wordsB]).size;
  const overlapPct = union ? Math.round((shared.length / union) * 100) : 0;

  if (overlapPct >= 50) return `Similar (${overlapPct}% word overlap)`;
  return `Different (${overlapPct}% word overlap)`;
}

function formatKeywordEntries(entries) {
  if (!entries?.length) return "—";
  return entries.map((entry) => `${entry.word} (${entry.density}%)`).join(", ");
}

function formatWordList(words) {
  return words?.length ? words.join(", ") : "—";
}

function buildHeadingAnalysisBlock(tab) {
  const seo = tab.seo;
  if (!seo) return "";

  const hasHeadingData =
    seo.h1Count !== undefined ||
    seo.h1 ||
    seo.h1All?.length ||
    seo.h1VsPageTitle ||
    seo.firstParagraph;

  if (!hasHeadingData) return "";

  const rows = [];
  const add = (label, value) => {
    if (value !== undefined && value !== null && value !== "") {
      rows.push(`<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(String(value))}</dd>`);
    }
  };

  add("H1 count", seo.h1CountNote);
  if (seo.h1Count > 0) {
    add("Single H1", seo.singleH1 ? "Yes" : "No");
  }
  add("H1", seo.h1);
  if (seo.h1All?.length) {
    add("All H1s", seo.h1All.join(" · "));
  }
  add("H1 vs HTML title", seo.h1VsPageTitle);
  if (tab.title && seo.h1) {
    add("H1 vs tab title", compareHeadingsForDisplay(seo.h1, tab.title));
  }
  if (
    seo.pageTitle &&
    tab.title &&
    normalizeForCompare(seo.pageTitle) !== normalizeForCompare(tab.title)
  ) {
    add("HTML title vs tab title", compareHeadingsForDisplay(seo.pageTitle, tab.title));
  }
  if (seo.firstParagraph) {
    const wordNote = seo.firstParagraphWordCount
      ? ` (${seo.firstParagraphWordCount} content words)`
      : "";
    add(`First paragraph${wordNote}`, seo.firstParagraph);
  }

  if (!rows.length) return "";
  return `
    <div class="tab-seo-section">
      <p class="tab-seo-subheading">Headings & content</p>
      <dl class="tab-seo-meta">${rows.join("")}</dl>
    </div>`;
}

function buildKeywordAnalysisBlock(tab) {
  const analysis = tab.seo?.keywordAnalysis;
  if (!analysis) return "";

  const overlapRows = [];
  const addOverlap = (label, words) => {
    overlapRows.push(
      `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(formatWordList(words))}</dd>`
    );
  };

  addOverlap("In title, H1 & first paragraph", analysis.inAllThree);
  addOverlap("In title & H1 only", analysis.inTitleAndH1);
  addOverlap("In title & first paragraph only", analysis.inTitleAndParagraph);
  addOverlap("In H1 & first paragraph only", analysis.inH1AndParagraph);

  return `
    <div class="tab-seo-section">
      <p class="tab-seo-subheading">Keyword density & overlap</p>
      <table class="tab-keyword-table">
        <thead>
          <tr>
            <th scope="col">Section</th>
            <th scope="col">Top keywords (density %)</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th scope="row">Title</th>
            <td>${escapeHtml(formatKeywordEntries(analysis.title))}</td>
          </tr>
          <tr>
            <th scope="row">H1</th>
            <td>${escapeHtml(formatKeywordEntries(analysis.h1))}</td>
          </tr>
          <tr>
            <th scope="row">First paragraph</th>
            <td>${escapeHtml(formatKeywordEntries(analysis.firstParagraph))}</td>
          </tr>
        </tbody>
      </table>
      <dl class="tab-seo-meta tab-seo-meta--overlap">${overlapRows.join("")}</dl>
    </div>`;
}

function buildOgPreviewBlock(tab) {
  const seo = tab.seo;
  if (!seo) return "";

  const imageUrl = seo.ogImage || seo.twitterImage;
  if (!imageUrl) return "";

  const previewTitle =
    seo.ogTitle && normalizeForCompare(seo.ogTitle) !== normalizeForCompare(tab.title)
      ? seo.ogTitle
      : "";

  let previewDesc = "";
  if (!tab.description) {
    previewDesc = seo.ogDescription || seo.description || seo.twitterDescription || "";
  } else if (
    seo.ogDescription &&
    normalizeForCompare(seo.ogDescription) !== normalizeForCompare(tab.description)
  ) {
    previewDesc = seo.ogDescription;
  }

  const textBlock =
    previewTitle || previewDesc
      ? `
        <div class="og-preview-text">
          ${previewTitle ? `<p class="og-preview-title">${escapeHtml(previewTitle)}</p>` : ""}
          ${previewDesc ? `<p class="og-preview-desc">${escapeHtml(previewDesc)}</p>` : ""}
        </div>`
      : "";

  return `
    <div class="og-preview">
      <img class="og-preview-image" src="${escapeAttr(imageUrl)}" alt="" loading="lazy" />
      ${textBlock}
    </div>`;
}

function buildSeoMetaRows(tab) {
  const seo = tab.seo;
  if (!seo) return "";

  const rows = [];
  const add = (label, value) => {
    if (value) {
      rows.push(`<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd>`);
    }
  };

  const previewImage = seo.ogImage || seo.twitterImage;
  const ogTitleDiffers =
    seo.ogTitle && normalizeForCompare(seo.ogTitle) !== normalizeForCompare(tab.title);
  const ogDescDiffers =
    seo.ogDescription &&
    normalizeForCompare(seo.ogDescription) !== normalizeForCompare(tab.description);
  const pageTitleDiffers =
    seo.pageTitle && normalizeForCompare(seo.pageTitle) !== normalizeForCompare(tab.title);

  if (pageTitleDiffers) add("HTML title", seo.pageTitle);
  add("Language", seo.lang);

  if (ogTitleDiffers && !previewImage) {
    add("OG title", seo.ogTitle);
  }

  if (!tab.description && !previewImage) {
    const desc = seo.ogDescription || seo.description || seo.twitterDescription;
    if (desc) add("Description", desc);
  } else if (ogDescDiffers && !previewImage) {
    add("OG description", seo.ogDescription);
  }

  add("OG URL", seo.ogUrl);
  add("OG type", seo.ogType);
  add("Site name", seo.ogSiteName);
  add("OG locale", seo.ogLocale);
  add("OG image alt", seo.ogImageAlt);
  if (seo.ogImageWidth || seo.ogImageHeight) {
    add("OG image size", [seo.ogImageWidth, seo.ogImageHeight].filter(Boolean).join(" × "));
  }

  add("Twitter card", seo.twitterCard);
  add("Twitter site", seo.twitterSite);
  add("Twitter creator", seo.twitterCreator);

  if (
    seo.twitterTitle &&
    normalizeForCompare(seo.twitterTitle) !== normalizeForCompare(tab.title)
  ) {
    add("Twitter title", seo.twitterTitle);
  }

  add("Twitter image alt", seo.twitterImageAlt);
  add("Published", seo.articlePublished);
  add("Modified", seo.articleModified);
  add("Article author", seo.articleAuthor);
  add("Article section", seo.articleSection);
  add("Article tags", seo.articleTags);
  add("Author", seo.author);
  add("Canonical", seo.canonical);
  add("Hreflang", seo.hreflang);
  add("JSON-LD types", seo.jsonLd);
  add("Keywords", seo.keywords);
  add("Robots", seo.robots);
  add("Googlebot", seo.googlebot);
  add("Theme color", seo.themeColor);
  add("Generator", seo.generator);
  add("Application", seo.applicationName);
  add("Favicon", seo.favicon);

  if (!rows.length) return "";
  return `<dl class="tab-seo-meta">${rows.join("")}</dl>`;
}

function buildSeoPanelInner(tab) {
  const preview = buildOgPreviewBlock(tab);
  const headings = buildHeadingAnalysisBlock(tab);
  const keywords = buildKeywordAnalysisBlock(tab);
  const meta = buildSeoMetaRows(tab);
  if (!preview && !headings && !keywords && !meta) return "";
  return `${preview}${headings}${keywords}${meta}`;
}

function seoHasContent(tab) {
  return Boolean(tab.seo && buildSeoPanelInner(tab));
}

function buildSeoToolbarButton(tab, index) {
  if (!seoHasContent(tab)) return "";
  const panelId = `tab-seo-panel-${index}`;
  return buildToolbarButton(
    "btn-seo",
    "seo",
    "SEO",
    `aria-expanded="false" aria-controls="${panelId}" title="Show page SEO and social preview"`
  );
}

function buildSeoPanel(tab, index, { forExport = false } = {}) {
  const inner = buildSeoPanelInner(tab);
  if (!inner) return "";

  const panelId = `tab-seo-panel-${index}`;
  if (forExport) {
    return `
    <div class="tab-seo-panel tab-seo-panel--export" id="${panelId}">
      <p class="tab-seo-heading">SEO details</p>
      <div class="tab-seo-content">${inner}</div>
    </div>`;
  }

  return `
    <div class="tab-seo-panel" id="${panelId}" hidden>
      <p class="tab-seo-heading">SEO details</p>
      <div class="tab-seo-content">${inner}</div>
    </div>`;
}

function setupSeoToggle(card) {
  const seoBtn = card.querySelector(".btn-seo");
  const seoPanel = card.querySelector(".tab-seo-panel");
  if (!seoBtn || !seoPanel) return;

  seoBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const opening = seoPanel.hidden;
    seoPanel.hidden = !opening;
    seoBtn.setAttribute("aria-expanded", opening ? "true" : "false");
    seoBtn.classList.toggle("is-active", opening);
  });
}

function updateTabCardSeo(card, tab, index) {
  const seoBtn = card.querySelector(".btn-seo");
  const wasOpen = seoBtn?.classList.contains("is-active") ?? false;
  const existingPanel = card.querySelector(".tab-seo-panel");
  const notesWrap = card.querySelector(".tab-notes-wrap");
  const seoHtml = buildSeoPanel(tab, index);
  const btnHtml = buildSeoToolbarButton(tab, index);

  if (seoBtn) {
    seoBtn.outerHTML = btnHtml || "";
  } else if (btnHtml) {
    const deleteBtn = card.querySelector(".btn-delete");
    deleteBtn?.insertAdjacentHTML("beforebegin", btnHtml);
  }

  if (seoHtml) {
    if (existingPanel) {
      existingPanel.outerHTML = seoHtml;
    } else if (notesWrap) {
      notesWrap.insertAdjacentHTML("beforebegin", seoHtml);
    }
  } else if (existingPanel) {
    existingPanel.remove();
  }

  const newBtn = card.querySelector(".btn-seo");
  const newPanel = card.querySelector(".tab-seo-panel");
  if (newBtn && newPanel) {
    if (wasOpen) {
      newPanel.hidden = false;
      newBtn.setAttribute("aria-expanded", "true");
      newBtn.classList.add("is-active");
    }
    setupSeoToggle(card);
  }
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

function getExportStyles() {
  const thumbnail = viewMode === "thumbnail" && !reportData?.screenshotsSkipped;
  return `
:root {
  font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
  color: #1a1a1a;
  background: #f4f4f5;
}
body {
  margin: 0;
  padding: 24px;
  max-width: ${thumbnail ? "none" : "960px"};
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
.tab-card-body { display: flex; flex-direction: column; gap: 12px; }
.tab-card-info { order: 1; }
.tab-card-media { order: 2; }
.tab-card-title {
  margin: 0 0 8px;
  font-size: 1.1rem;
  line-height: 1.35;
  word-break: break-word;
}
.report-root:not(.is-thumbnail-view) .tab-card-sticky-header {
  position: sticky;
  top: 0;
  z-index: 5;
  background: #fff;
  margin: -16px -20px 10px;
  padding: 16px 20px 10px;
  border-bottom: 1px solid #eee;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
}
.report-root:not(.is-thumbnail-view) .tab-card-toolbar {
  margin-bottom: 8px;
}
.report-root:not(.is-thumbnail-view) .tab-card-title {
  margin-bottom: 0;
}
.tab-card-info p { margin: 0 0 12px; }
.tab-card-info p:last-child { margin-bottom: 0; }
.tab-card-url a { color: #1a56db; word-break: break-all; }
.tab-description {
  margin: 0 0 12px;
  color: #444;
  font-size: 0.9rem;
  line-height: 1.45;
}
.tab-seo-panel {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid #eee;
}
.tab-seo-heading {
  margin: 0 0 8px;
  font-size: 0.75rem;
  font-weight: 600;
  color: #777;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.tab-seo-content {
  padding: 10px 12px;
  border: 1px solid #e8e8e8;
  border-radius: 6px;
  background: #fafafa;
}
.og-preview {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  margin-bottom: 10px;
}
.og-preview:last-child { margin-bottom: 0; }
.og-preview-image {
  flex: 0 0 120px;
  width: 120px;
  height: 63px;
  object-fit: cover;
  border-radius: 4px;
  border: 1px solid #e0e0e0;
  background: #eee;
}
.og-preview-text { flex: 1; min-width: 0; }
.og-preview-title {
  margin: 0 0 4px;
  font-weight: 600;
  font-size: 0.88rem;
  line-height: 1.35;
  color: #1a1a1a;
}
.og-preview-desc {
  margin: 0;
  font-size: 0.82rem;
  line-height: 1.4;
  color: #555;
}
.tab-seo-meta {
  margin: 0;
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 4px 12px;
  font-size: 0.8rem;
  line-height: 1.4;
}
.tab-seo-meta dt {
  margin: 0;
  color: #666;
  font-weight: 600;
}
.tab-seo-meta dd {
  margin: 0;
  color: #333;
  word-break: break-word;
}
.tab-seo-section {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid #ececec;
}
.tab-seo-section:first-child {
  margin-top: 0;
  padding-top: 0;
  border-top: none;
}
.tab-seo-subheading {
  margin: 0 0 8px;
  font-size: 0.72rem;
  font-weight: 600;
  color: #666;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.tab-keyword-table {
  width: 100%;
  border-collapse: collapse;
  margin-bottom: 10px;
  font-size: 0.78rem;
  line-height: 1.4;
}
.tab-keyword-table th,
.tab-keyword-table td {
  padding: 6px 8px;
  border: 1px solid #e4e4e4;
  text-align: left;
  vertical-align: top;
}
.tab-keyword-table thead th {
  background: #f0f0f0;
  color: #555;
  font-weight: 600;
}
.tab-keyword-table tbody th {
  width: 7.5rem;
  background: #f7f7f7;
  color: #666;
  font-weight: 600;
}
.tab-seo-meta--overlap {
  margin-top: 4px;
}
.tab-notes-export-wrap {
  display: block;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid #eee;
  width: 100%;
  box-sizing: border-box;
}
.tab-notes-label {
  display: block;
  margin-bottom: 4px;
  font-size: 0.75rem;
  font-weight: 600;
  color: #777;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.tab-notes-rendered {
  margin: 0;
  padding: 8px 10px;
  border: 1px solid #e8e8e8;
  border-radius: 6px;
  font-size: 0.88rem;
  line-height: 1.4;
  color: #1a1a1a;
  background: #fafafa;
  white-space: pre-wrap;
  word-break: break-word;
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
${
  thumbnail
    ? `
.report-root.is-thumbnail-view {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 12px;
  align-items: start;
}
.report-root.is-thumbnail-view .tab-card {
  display: grid;
  grid-template-columns: 112px minmax(0, 1fr);
  column-gap: 10px;
  row-gap: 8px;
  align-items: start;
  padding: 10px 12px;
  min-width: 0;
  overflow: hidden;
}
.report-root.is-thumbnail-view .tab-card-sticky-header,
.report-root.is-thumbnail-view .tab-card-body {
  display: contents;
}
.report-root.is-thumbnail-view .tab-card-toolbar {
  grid-column: 1 / -1;
}
.report-root.is-thumbnail-view .tab-card-title {
  grid-column: 2;
  grid-row: 2;
  margin: 0;
  font-size: 0.82rem;
  line-height: 1.3;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
  overflow: hidden;
}
.report-root.is-thumbnail-view .tab-card-media {
  grid-column: 1;
  grid-row: 2 / span 2;
  width: 112px;
  min-width: 112px;
}
.report-root.is-thumbnail-view .tab-card-info {
  grid-column: 2;
  grid-row: 3;
  min-width: 0;
}
.report-root.is-thumbnail-view .tab-seo-panel,
.report-root.is-thumbnail-view .tab-notes-wrap {
  grid-column: 1 / -1;
}
.report-root.is-thumbnail-view .tab-card-url {
  display: block;
  margin: 4px 0 0;
  font-size: 0.68rem;
  line-height: 1.25;
}
.report-root.is-thumbnail-view .tab-card-url a {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
  word-break: break-all;
}
.report-root.is-thumbnail-view .tab-description {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
  overflow: hidden;
  margin: 0;
  font-size: 0.72rem;
  line-height: 1.35;
  color: #555;
}
.report-root.is-thumbnail-view .tab-screenshot {
  width: 112px;
  height: 72px;
  max-width: none;
  object-fit: cover;
  object-position: top left;
}
.report-root.is-thumbnail-view .screenshot-error {
  width: 112px;
  height: 72px;
  min-height: 0;
  padding: 6px;
  font-size: 0.62rem;
  line-height: 1.2;
}
.report-root.is-thumbnail-view .screenshot-error strong {
  margin: 0;
  font-size: 0.62rem;
}
.report-root.is-thumbnail-view .tab-notes-export-wrap {
  margin-top: 8px;
  padding-top: 8px;
  flex-shrink: 0;
}
.report-root.is-thumbnail-view .tab-notes-label {
  margin-bottom: 2px;
  font-size: 0.62rem;
}
.report-root.is-thumbnail-view .tab-notes-rendered {
  padding: 5px 7px;
  font-size: 0.72rem;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 4;
  overflow: hidden;
  white-space: normal;
}
.report-root.is-thumbnail-view .tab-seo-panel,
.report-root.is-thumbnail-view .btn-seo {
  display: none;
}
`
    : ""
}`.trim();
}

function buildExportScreenshotBlock(tab, index) {
  if (reportData?.screenshotsSkipped) {
    return "";
  }

  if (tab.screenshot) {
    const filename = screenshotFilename(index, tab.screenshot || "");
    return `<img class="tab-screenshot" src="${escapeAttr(filename)}" alt="Screenshot of ${escapeAttr(tab.title)}">`;
  }
  return `<div class="screenshot-error">
    <strong>Screenshot unavailable</strong>
    <span>${escapeHtml(tab.error || "Unknown error")}</span>
  </div>`;
}

function getSeoExportVisibility() {
  const root = document.getElementById("report-root");
  if (!root || viewMode !== "full") return new Map();

  const visibility = new Map();
  root.querySelectorAll(".tab-card").forEach((card) => {
    const index = Number(card.dataset.index);
    if (!Number.isFinite(index)) return;
    const seoBtn = card.querySelector(".btn-seo");
    visibility.set(index, Boolean(seoBtn?.classList.contains("is-active")));
  });
  return visibility;
}

function buildExportHtml() {
  const count = reportData.tabs.length;
  const failed = reportData.screenshotsSkipped
    ? 0
    : reportData.tabs.filter((t) => !t.screenshot).length;
  const skippedNote = reportData.screenshotsSkipped
    ? " · Screenshots not taken (your choice)"
    : "";
  const layoutNote =
    viewMode === "thumbnail" && !reportData.screenshotsSkipped
      ? " · Thumbnail layout"
      : "";
  const seoVisibility = getSeoExportVisibility();
  const seoCount = [...seoVisibility.values()].filter(Boolean).length;
  const seoNote =
    viewMode === "full" && seoCount > 0
      ? ` · SEO details for ${seoCount} tab${seoCount === 1 ? "" : "s"}`
      : "";
  const meta = `${count} tab${count === 1 ? "" : "s"} · Generated ${formatGeneratedAt(reportData.generatedAt)}${skippedNote}${layoutNote}${seoNote}${failed ? ` · ${failed} without screenshot` : ""}`;

  const thumbnailExport =
    viewMode === "thumbnail" && !reportData.screenshotsSkipped;
  const rootClass = thumbnailExport ? ' class="report-root is-thumbnail-view"' : ' class="report-root"';

  const screenshotSection = (tab, index) => {
    const block = buildExportScreenshotBlock(tab, index);
    return block ? `<div class="tab-card-media">${block}</div>` : "";
  };

  const cards = reportData.tabs
    .map(
      (tab, index) => `
    <section class="tab-card">
      <div class="tab-card-body">
        <div class="tab-card-info">
          <h2>${escapeHtml(tab.title)}</h2>
          ${buildUrlBlock(tab)}
          ${tab.description ? `<p class="tab-description">${escapeHtml(tab.description)}</p>` : ""}
        </div>
        ${screenshotSection(tab, index)}
      </div>
      ${viewMode === "full" && seoVisibility.get(index) ? buildSeoPanel(tab, index, { forExport: true }) : ""}
      ${buildExportNotesBlock(tab)}
    </section>`
    )
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Tab Screenshot Report</title>
    <style>${getExportStyles()}</style>
  </head>
  <body>
    <header class="report-header">
      <h1>Tab Screenshot Report</h1>
      <p class="report-meta">${escapeHtml(meta)}</p>
    </header>
    <main${rootClass}>
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

  syncNotesFromDom();

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

function truncateProgressTitle(title) {
  const text = String(title || "").trim();
  if (!text) return "—";
  if (text.length <= 5) return text;
  return `${text.slice(0, 5)}…`;
}

function isScrollProgressVisible() {
  return (
    viewMode === "full" &&
    !isDragging &&
    !isDragHandleActive &&
    Boolean(reportData?.tabs?.length)
  );
}

function getCurrentCardIndex() {
  const root = document.getElementById("report-root");
  if (!root || !isScrollProgressVisible()) return -1;

  const cards = [...root.querySelectorAll(".tab-card")];
  if (!cards.length) return -1;

  const anchor = Math.min(window.innerHeight * 0.32, 200);
  let current = 0;

  for (let i = 0; i < cards.length; i += 1) {
    const { top } = cards[i].getBoundingClientRect();
    if (top <= anchor) {
      current = i;
    }
  }

  return current;
}

function scrollToCardIndex(index) {
  const root = document.getElementById("report-root");
  const card = root?.querySelector(`.tab-card[data-index="${index}"]`);
  if (!card) return;
  card.scrollIntoView({ behavior: "smooth", block: "start" });
}

function updateScrollSlot(slotEl, tab, { clickable = false } = {}) {
  if (!slotEl) return;

  const titleEl = slotEl.querySelector(".scroll-progress-title");
  if (!tab) {
    slotEl.hidden = true;
    if (titleEl) titleEl.textContent = "";
    slotEl.removeAttribute("title");
    return;
  }

  slotEl.hidden = false;
  const fullTitle = tab.title || "Untitled";
  if (titleEl) titleEl.textContent = truncateProgressTitle(fullTitle);
  slotEl.title = fullTitle;
  slotEl.disabled = !clickable;
}

function updateScrollProgress() {
  const rail = document.getElementById("report-scroll-progress");
  if (!rail) return;

  if (!isScrollProgressVisible()) {
    rail.hidden = true;
    return;
  }

  const tabs = reportData.tabs;
  const currentIndex = getCurrentCardIndex();
  if (currentIndex < 0) {
    rail.hidden = true;
    return;
  }

  rail.hidden = false;

  const currentTab = tabs[currentIndex];
  const prevTab = currentIndex > 0 ? tabs[currentIndex - 1] : null;
  const nextTab = currentIndex < tabs.length - 1 ? tabs[currentIndex + 1] : null;

  const currentTitle = document.getElementById("scroll-progress-current-title");
  const currentIndexEl = document.getElementById("scroll-progress-index");
  const prevBtn = document.getElementById("scroll-progress-prev");
  const nextBtn = document.getElementById("scroll-progress-next");

  if (currentTitle) {
    const fullTitle = currentTab?.title || "Untitled";
    currentTitle.textContent = truncateProgressTitle(fullTitle);
    currentTitle.title = fullTitle;
  }

  if (currentIndexEl) {
    currentIndexEl.textContent = `${currentIndex + 1} / ${tabs.length}`;
  }

  updateScrollSlot(prevBtn, prevTab, { clickable: true });
  updateScrollSlot(nextBtn, nextTab, { clickable: true });

  if (prevBtn) prevBtn.dataset.index = prevTab ? String(currentIndex - 1) : "";
  if (nextBtn) nextBtn.dataset.index = nextTab ? String(currentIndex + 1) : "";
}

let scrollProgressRaf = null;

function scheduleScrollProgressUpdate() {
  if (scrollProgressRaf) return;
  scrollProgressRaf = requestAnimationFrame(() => {
    scrollProgressRaf = null;
    updateScrollProgress();
  });
}

function setupScrollProgress() {
  const prevBtn = document.getElementById("scroll-progress-prev");
  const nextBtn = document.getElementById("scroll-progress-next");

  const onNavClick = (e) => {
    const index = Number(e.currentTarget?.dataset?.index);
    if (Number.isFinite(index)) {
      scrollToCardIndex(index);
    }
  };

  prevBtn?.addEventListener("click", onNavClick);
  nextBtn?.addEventListener("click", onNavClick);

  window.addEventListener("scroll", scheduleScrollProgressUpdate, { passive: true });
  window.addEventListener("resize", scheduleScrollProgressUpdate, { passive: true });
}

function applyViewLayout() {
  const root = document.getElementById("report-root");
  if (!root) return;
  const showThumbnail =
    viewMode === "thumbnail" || isDragging || isDragHandleActive;
  root.classList.toggle("is-thumbnail-view", showThumbnail);
  scheduleScrollProgressUpdate();
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
  const hasScreenshots = hasTabs && !reportData?.screenshotsSkipped;
  document.getElementById("btn-export").disabled = !hasTabs;
  document.getElementById("btn-print").disabled = !hasTabs;
  const viewBtn = document.getElementById("btn-view-toggle");
  if (viewBtn) viewBtn.disabled = !hasScreenshots;
}

function updateScreenshotStatus() {
  const el = document.getElementById("report-screenshot-status");
  if (!el) return;

  if (reportData?.screenshotsSkipped) {
    el.textContent =
      "You chose not to take screenshots for this report. Titles, URLs, and descriptions are included.";
    el.hidden = false;
    return;
  }

  el.hidden = true;
  el.textContent = "";
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
    updateScreenshotStatus();
    updateActionButtons();
    updateClearStorageButton();
    return;
  }

  empty.hidden = true;
  const count = reportData.tabs.length;
  const failed = reportData.screenshotsSkipped
    ? 0
    : reportData.tabs.filter((t) => !t.screenshot).length;
  meta.textContent = `${count} tab${count === 1 ? "" : "s"} · Generated ${formatGeneratedAt(reportData.generatedAt)}${failed ? ` · ${failed} without screenshot` : ""} · Drag to reorder`;
  updateScreenshotStatus();
  updateActionButtons();
  updateClearStorageButton();
}

function buildScreenshotBlock(tab) {
  if (reportData?.screenshotsSkipped) {
    return "";
  }

  const fullPageBadge = tab.screenshotFullPage
    ? `<span class="screenshot-mode-badge" title="Full-page screenshot">Full page</span>`
    : "";

  if (tab.screenshot) {
    return `${fullPageBadge}<img class="tab-screenshot" src="${tab.screenshot}" alt="Screenshot of ${escapeAttr(tab.title)}">`;
  }
  return `<div class="screenshot-error" title="${escapeAttr(tab.error || "Unknown error")}">
    <strong>Screenshot unavailable</strong>
    <span class="screenshot-error-detail">${escapeHtml(tab.error || "Unknown error")}</span>
  </div>`;
}

function updateTabCardMedia(card, tab) {
  const media = card.querySelector(".tab-card-media");
  if (!media) return;
  media.innerHTML = buildScreenshotBlock(tab);
}

function openLightbox(src, alt, caption) {
  const lightbox = document.getElementById("lightbox");
  const image = lightbox?.querySelector(".lightbox-image");
  const captionEl = lightbox?.querySelector(".lightbox-caption");
  if (!lightbox || !image) return;

  image.src = src;
  image.alt = alt || "Screenshot";
  if (captionEl) {
    captionEl.textContent = caption || "";
    captionEl.hidden = !caption;
  }

  lightbox.hidden = false;
  lightbox.setAttribute("aria-hidden", "false");
  document.body.classList.add("lightbox-open");
  lightbox.querySelector(".lightbox-close")?.focus();
}

function closeLightbox() {
  const lightbox = document.getElementById("lightbox");
  if (!lightbox || lightbox.hidden) return;

  lightbox.hidden = true;
  lightbox.setAttribute("aria-hidden", "true");
  document.body.classList.remove("lightbox-open");

  const image = lightbox.querySelector(".lightbox-image");
  if (image) {
    image.removeAttribute("src");
    image.alt = "";
  }
}

function openLightboxFromScreenshot(img) {
  const card = img.closest(".tab-card");
  const title = card?.querySelector(".tab-card-title")?.textContent?.trim() || "";
  openLightbox(img.src, img.alt, title);
}

function setupLightbox() {
  const lightbox = document.getElementById("lightbox");
  if (!lightbox) return;

  const root = document.getElementById("report-root");
  root?.addEventListener("click", (e) => {
    const img = e.target.closest(".tab-screenshot");
    if (!img || !root.contains(img)) return;
    e.preventDefault();
    e.stopPropagation();
    openLightboxFromScreenshot(img);
  });

  lightbox.querySelector(".lightbox-close")?.addEventListener("click", closeLightbox);

  lightbox.addEventListener("click", (e) => {
    if (e.target === lightbox) {
      closeLightbox();
    }
  });

  const content = lightbox.querySelector(".lightbox-content");
  content?.addEventListener("click", (e) => e.stopPropagation());

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !lightbox.hidden) {
      closeLightbox();
    }
  });
}

function waitForRetakeScreenshotResult(requestId, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      chrome.runtime.onMessage.removeListener(listener);
      reject(new Error("Screenshot timed out. The page may be too long or the tab closed."));
    }, timeoutMs);

    function listener(message) {
      if (
        message?.action !== "retakeScreenshotResult" ||
        message.requestId !== requestId
      ) {
        return;
      }

      chrome.runtime.onMessage.removeListener(listener);
      clearTimeout(timeout);
      resolve(message);
    }

    chrome.runtime.onMessage.addListener(listener);
  });
}

async function retakeFullScreenshot(card, index) {
  const tab = reportData?.tabs?.[index];
  if (!tab || reportData?.screenshotsSkipped || tab.openExtensionSettings) return;

  const btn = card.querySelector(".btn-full-screenshot");
  if (!btn || btn.disabled) return;

  const originalLabel = getToolbarButtonLabel(btn);
  btn.disabled = true;
  setToolbarButtonLabel(btn, "Capturing…");

  try {
    const reportTab = await chrome.tabs.getCurrent();
    const requestId = crypto.randomUUID();

    const ack = await chrome.runtime.sendMessage({
      action: "retakeScreenshot",
      requestId,
      tabId: tab.id,
      url: tab.url,
      title: tab.title,
      fullPage: true,
      returnToTabId: reportTab?.id ?? null,
    });

    if (chrome.runtime.lastError) {
      throw new Error(chrome.runtime.lastError.message);
    }

    if (!ack?.ok || !ack?.started) {
      throw new Error("Could not start screenshot. Reload the extension and try again.");
    }

    const response = await waitForRetakeScreenshotResult(requestId);
    const result = response?.result;

    if (!response?.ok) {
      throw new Error(result?.error || "Screenshot failed");
    }

    if (!result) {
      throw new Error("Screenshot returned no data");
    }

    if (result.error && !result.screenshot) {
      tab.error = result.error;
      tab.screenshot = null;
      tab.screenshotFullPage = false;
    } else {
      tab.error = result.error || null;
      tab.screenshot = result.screenshot;
      tab.screenshotFullPage = Boolean(result.screenshotFullPage);
      tab.seo = result.seo ?? null;
      tab.description = result.description ?? null;
      if (result.title) tab.title = result.title;
      if (result.url) tab.url = result.url;
      if (result.id) tab.id = result.id;
      if (result.windowId) tab.windowId = result.windowId;
    }

    updateTabCardMedia(card, tab);

    const info = card.querySelector(".tab-card-info");
    const titleEl = card.querySelector(".tab-card-title");
    if (titleEl && tab.title) {
      titleEl.textContent = tab.title;
    }

    updateTabCardSeo(card, tab, index);

    const descEl = card.querySelector(".tab-description");
    if (tab.description) {
      if (descEl) {
        descEl.textContent = tab.description;
      } else if (info) {
        const urlBlock = card.querySelector(".tab-card-url");
        const p = document.createElement("p");
        p.className = "tab-description";
        p.textContent = tab.description;
        if (urlBlock?.nextSibling) {
          info.insertBefore(p, urlBlock.nextSibling);
        } else {
          info.appendChild(p);
        }
      }
    } else if (descEl) {
      descEl.remove();
    }

    await saveReport();
    updateMeta();
  } catch (err) {
    alert(`Full screenshot failed: ${err?.message || err}`);
  } finally {
    btn.disabled = false;
    setToolbarButtonLabel(btn, originalLabel);
  }
}

function createTabCard(tab, index) {
  const card = document.createElement("section");
  card.className = "tab-card";
  card.draggable = false;
  card.dataset.index = String(index);

  const showFullScreenshotBtn =
    !reportData?.screenshotsSkipped && !tab.openExtensionSettings;

  card.innerHTML = `
    <div class="tab-card-sticky-header">
      <div class="tab-card-toolbar">
        <button type="button" class="drag-handle" aria-label="Drag to reorder" title="Drag to reorder">⠿</button>
        <span class="tab-card-index">${index + 1}</span>
        ${
          showFullScreenshotBtn
            ? buildToolbarButton(
                "btn-full-screenshot",
                "fullScreenshot",
                "Full screenshot",
                'aria-label="Retake full-page screenshot" title="Retake screenshot by scrolling the full page"'
              )
            : ""
        }
        ${buildSeoToolbarButton(tab, index)}
        ${buildToolbarButton(
          "btn-delete",
          "delete",
          "Delete",
          'aria-label="Remove from report" title="Remove from report"'
        )}
      </div>
      <h2 class="tab-card-title">${escapeHtml(tab.title)}</h2>
    </div>
    <div class="tab-card-body">
      <div class="tab-card-info">
        ${buildUrlBlock(tab)}
        ${
          tab.description
            ? `<p class="tab-description">${escapeHtml(tab.description)}</p>`
            : ""
        }
      </div>
      ${
        reportData?.screenshotsSkipped
          ? ""
          : `<div class="tab-card-media">${buildScreenshotBlock(tab)}</div>`
      }
    </div>
    ${buildSeoPanel(tab, index)}
    ${buildNotesBlock(tab)}
  `;

  setupSeoToggle(card);

  const notesEl = card.querySelector(".tab-notes");
  if (notesEl) {
    notesEl.addEventListener("input", () => {
      reportData.tabs[index].notes = notesEl.value;
      saveReportDebounced();
    });
    notesEl.addEventListener("mousedown", (e) => e.stopPropagation());
    notesEl.addEventListener("click", (e) => e.stopPropagation());
  }

  const settingsBtn = card.querySelector(".btn-open-settings");
  if (settingsBtn) {
    settingsBtn.addEventListener("click", () => {
      chrome.tabs.create({
        url: `chrome://extensions/?id=${chrome.runtime.id}`,
      });
    });
  }

  const fullScreenshotBtn = card.querySelector(".btn-full-screenshot");
  if (fullScreenshotBtn) {
    fullScreenshotBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const idx = Number(card.dataset.index);
      retakeFullScreenshot(card, idx).catch((err) => {
        alert(`Full screenshot failed: ${err?.message || err}`);
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
    scheduleScrollProgressUpdate();
    return;
  }

  reportData.tabs.forEach((tab, index) => {
    root.appendChild(createTabCard(tab, index));
  });

  updateMeta();
  applyViewLayout();
  scheduleScrollProgressUpdate();
}

async function loadReport() {
  const stored = await chrome.storage.local.get([VIEW_MODE_KEY]);
  reportData = await loadTabReport();
  if (stored[VIEW_MODE_KEY] === "thumbnail" || stored[VIEW_MODE_KEY] === "full") {
    viewMode = stored[VIEW_MODE_KEY];
  }
  if (reportData?.screenshotsSkipped) {
    viewMode = "full";
  }

  const root = document.getElementById("report-root");
  setupDragAndDrop(root);
  setupLightbox();
  setupScrollProgress();

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
