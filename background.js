importScripts("report-storage.js");

const TAB_PREPARE_DELAY_MS = 600;
const FULL_CAPTURE_SCROLL_SETTLE_MS = 250;
const FULL_CAPTURE_MAX_OUTPUT_HEIGHT_PX = 16384;
const CAPTURE_OPTIONS = { format: "jpeg", quality: 72 };
const CAPTURE_QUOTA_PER_SECOND =
  typeof chrome.tabs.MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND === "number"
    ? chrome.tabs.MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND
    : 2;
const FULL_CAPTURE_MIN_CAPTURE_INTERVAL_MS =
  Math.ceil(1000 / CAPTURE_QUOTA_PER_SECOND) + 50;

let lastVisibleTabCaptureAt = 0;

const SITE_ACCESS_HELP =
  'Enable "On all sites" for this extension: open chrome://extensions, find "Tab Screenshot Report", set Site access to "On all sites", then click Reload.';

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isProbablyRestrictedUrl(url = "") {
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

function tabResultFromTab(tab) {
  return {
    id: tab.id,
    windowId: tab.windowId,
    title: tab.title || "Untitled",
    url: tab.url || "",
    description: null,
    seo: null,
    screenshot: null,
    error: null,
  };
}

/** Runs inside the page — must be self-contained (no closure vars). */
function extractSeoDetails() {
  const readContent = (meta) => meta?.getAttribute("content")?.trim() || "";

  const findMeta = (matchFn) => {
    for (const meta of document.querySelectorAll("meta[content]")) {
      if (matchFn(meta)) return readContent(meta);
    }
    return "";
  };

  const readOg = (prop) =>
    findMeta((meta) => {
      const property = (meta.getAttribute("property") || "").toLowerCase();
      const name = (meta.getAttribute("name") || "").toLowerCase();
      return property === prop || name === prop;
    });

  const metaDescription = findMeta(
    (meta) => (meta.getAttribute("name") || "").toLowerCase() === "description"
  );
  const ogDescription = readOg("og:description");
  const twitterDescription = findMeta(
    (meta) => (meta.getAttribute("name") || "").toLowerCase() === "twitter:description"
  );

  const description = metaDescription || ogDescription || twitterDescription || null;

  const resolveUrl = (href) => {
    if (!href) return null;
    try {
      return new URL(href, document.baseURI).href;
    } catch {
      return href || null;
    }
  };

  const empty = (value) => (value && value.length > 0 ? value : null);

  const STOP_WORDS = new Set([
    "a", "an", "the", "and", "or", "but", "in", "on", "at", "to", "for", "of", "with", "by",
    "from", "is", "are", "was", "were", "be", "been", "being", "have", "has", "had", "do",
    "does", "did", "will", "would", "could", "should", "may", "might", "must", "shall", "can",
    "this", "that", "these", "those", "it", "its", "as", "not", "no", "nor", "so", "if", "then",
    "than", "too", "very", "just", "about", "into", "over", "after", "before", "between",
    "under", "again", "further", "once", "here", "there", "when", "where", "why", "how", "all",
    "each", "few", "more", "most", "other", "some", "such", "only", "own", "same", "both", "any",
    "your", "you", "we", "our", "they", "their", "he", "she", "his", "her", "what", "which",
    "who", "whom", "while", "during", "through", "above", "below", "up", "down", "out", "off",
    "also", "new", "get", "via", "per", "etc",
  ]);

  const normalizeHeading = (text) =>
    String(text || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");

  const tokenize = (text) =>
    String(text || "")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s'-]/gu, " ")
      .split(/\s+/)
      .filter((word) => word.length > 2 && !STOP_WORDS.has(word));

  const compareHeadings = (a, b) => {
    const left = normalizeHeading(a);
    const right = normalizeHeading(b);
    if (!left && !right) return "No title or H1";
    if (!left) return "No H1 on page";
    if (!right) return "No page title";
    if (left === right) return "Exact match";
    if (left.includes(right) || right.includes(left)) {
      return "Partial match (one contains the other)";
    }

    const wordsA = new Set(tokenize(a));
    const wordsB = new Set(tokenize(b));
    const shared = [...wordsA].filter((word) => wordsB.has(word));
    const union = new Set([...wordsA, ...wordsB]).size;
    const overlapPct = union ? Math.round((shared.length / union) * 100) : 0;

    if (overlapPct >= 50) return `Similar (${overlapPct}% word overlap)`;
    return `Different (${overlapPct}% word overlap)`;
  };

  const keywordStats = (text, limit = 8) => {
    const tokens = tokenize(text);
    if (!tokens.length) return [];

    const counts = new Map();
    for (const token of tokens) {
      counts.set(token, (counts.get(token) || 0) + 1);
    }

    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([word, count]) => ({
        word,
        count,
        density: Math.round((count / tokens.length) * 1000) / 10,
      }));
  };

  const overlapWords = (leftText, rightText) => {
    const left = new Set(tokenize(leftText));
    const right = new Set(tokenize(rightText));
    return [...left].filter((word) => right.has(word)).sort();
  };

  const getFirstParagraph = () => {
    const isSkipped = (el) =>
      el.closest('nav, header, footer, aside, [role="navigation"], [role="banner"], [role="contentinfo"]');

    for (const paragraph of document.querySelectorAll("p")) {
      if (isSkipped(paragraph)) continue;
      const text = paragraph.textContent?.trim().replace(/\s+/g, " ");
      if (text && text.length >= 15) return text;
    }

    for (const paragraph of document.querySelectorAll("p")) {
      const text = paragraph.textContent?.trim().replace(/\s+/g, " ");
      if (text) return text;
    }

    return "";
  };

  const pageTitle = document.title?.trim() || "";
  const h1Elements = [...document.querySelectorAll("h1")];
  const h1Count = h1Elements.length;
  const h1Texts = h1Elements
    .map((el) => el.textContent?.trim().replace(/\s+/g, " ") || "")
    .filter(Boolean);
  const h1 = h1Texts[0] || "";
  const singleH1 = h1Count === 1;
  const h1CountNote =
    h1Count === 0
      ? "None found"
      : h1Count === 1
        ? "1 (recommended)"
        : `${h1Count} (multiple H1s — usually use one)`;

  const firstParagraphRaw = getFirstParagraph();
  const firstParagraph =
    firstParagraphRaw.length > 500
      ? `${firstParagraphRaw.slice(0, 497)}…`
      : firstParagraphRaw;

  const titleKeywords = keywordStats(pageTitle);
  const h1Keywords = keywordStats(h1);
  const paragraphKeywords = keywordStats(firstParagraphRaw);

  const titleH1Overlap = overlapWords(pageTitle, h1);
  const titleParagraphOverlap = overlapWords(pageTitle, firstParagraphRaw);
  const h1ParagraphOverlap = overlapWords(h1, firstParagraphRaw);
  const allThreeOverlap = titleH1Overlap.filter((word) =>
    new Set(tokenize(firstParagraphRaw)).has(word)
  );

  const faviconLink =
    document.querySelector('link[rel="icon"]') ||
    document.querySelector('link[rel="shortcut icon"]') ||
    document.querySelector('link[rel="apple-touch-icon"]');

  const hreflangs = [];
  for (const link of document.querySelectorAll('link[rel="alternate"][hreflang]')) {
    const code = link.getAttribute("hreflang");
    const href = resolveUrl(link.getAttribute("href"));
    if (code && href) hreflangs.push(`${code}: ${href}`);
  }

  const articleTags = [];
  for (const meta of document.querySelectorAll("meta[content]")) {
    if ((meta.getAttribute("property") || "").toLowerCase() === "article:tag") {
      const tag = readContent(meta);
      if (tag) articleTags.push(tag);
    }
  }

  const jsonLdTypes = (() => {
    const types = new Set();
    const collect = (obj) => {
      if (!obj || typeof obj !== "object") return;
      if (Array.isArray(obj)) {
        obj.forEach(collect);
        return;
      }
      if (obj["@type"]) {
        const typeValue = obj["@type"];
        if (Array.isArray(typeValue)) {
          typeValue.forEach((entry) => types.add(String(entry)));
        } else {
          types.add(String(typeValue));
        }
      }
      if (obj["@graph"]) collect(obj["@graph"]);
    };

    for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        collect(JSON.parse(script.textContent));
      } catch {
        // ignore invalid JSON-LD
      }
    }

    return types.size > 0 ? [...types].join(", ") : null;
  })();

  return {
    description,
    pageTitle: empty(pageTitle),
    h1: empty(h1),
    h1Count,
    singleH1,
    h1CountNote,
    h1All: h1Texts.length > 1 ? h1Texts : null,
    h1VsPageTitle: compareHeadings(h1, pageTitle),
    firstParagraph: empty(firstParagraph),
    firstParagraphWordCount: tokenize(firstParagraphRaw).length || null,
    keywordAnalysis:
      titleKeywords.length || h1Keywords.length || paragraphKeywords.length
        ? {
            title: titleKeywords,
            h1: h1Keywords,
            firstParagraph: paragraphKeywords,
            inAllThree: allThreeOverlap.slice(0, 15),
            inTitleAndH1: titleH1Overlap
              .filter((word) => !allThreeOverlap.includes(word))
              .slice(0, 15),
            inTitleAndParagraph: titleParagraphOverlap
              .filter((word) => !allThreeOverlap.includes(word))
              .slice(0, 15),
            inH1AndParagraph: h1ParagraphOverlap
              .filter((word) => !allThreeOverlap.includes(word))
              .slice(0, 15),
          }
        : null,
    lang: empty(document.documentElement.lang?.trim()),
    favicon: resolveUrl(faviconLink?.getAttribute("href")),
    hreflang: hreflangs.length > 0 ? hreflangs.join("; ") : null,
    jsonLd: empty(jsonLdTypes),
    author: empty(
      findMeta((meta) => (meta.getAttribute("name") || "").toLowerCase() === "author")
    ),
    themeColor: empty(
      findMeta((meta) => (meta.getAttribute("name") || "").toLowerCase() === "theme-color")
    ),
    generator: empty(
      findMeta((meta) => (meta.getAttribute("name") || "").toLowerCase() === "generator")
    ),
    applicationName: empty(
      findMeta((meta) => (meta.getAttribute("name") || "").toLowerCase() === "application-name")
    ),
    ogTitle: empty(readOg("og:title")),
    ogDescription: empty(ogDescription),
    ogImage: resolveUrl(readOg("og:image")),
    ogImageAlt: empty(readOg("og:image:alt")),
    ogImageWidth: empty(readOg("og:image:width")),
    ogImageHeight: empty(readOg("og:image:height")),
    ogUrl: empty(resolveUrl(readOg("og:url"))),
    ogType: empty(readOg("og:type")),
    ogSiteName: empty(readOg("og:site_name")),
    ogLocale: empty(readOg("og:locale")),
    articlePublished: empty(readOg("article:published_time")),
    articleModified: empty(readOg("article:modified_time")),
    articleAuthor: empty(readOg("article:author")),
    articleSection: empty(readOg("article:section")),
    articleTags: articleTags.length > 0 ? articleTags.join(", ") : null,
    twitterCard: empty(readOg("twitter:card")),
    twitterSite: empty(readOg("twitter:site")),
    twitterCreator: empty(readOg("twitter:creator")),
    twitterTitle: empty(readOg("twitter:title")),
    twitterDescription: empty(twitterDescription),
    twitterImage: resolveUrl(readOg("twitter:image") || readOg("twitter:image:src")),
    twitterImageAlt: empty(readOg("twitter:image:alt")),
    canonical: empty(
      resolveUrl(document.querySelector('link[rel="canonical"]')?.getAttribute("href"))
    ),
    keywords: empty(
      findMeta((meta) => (meta.getAttribute("name") || "").toLowerCase() === "keywords")
    ),
    robots: empty(
      findMeta((meta) => (meta.getAttribute("name") || "").toLowerCase() === "robots")
    ),
    googlebot: empty(
      findMeta((meta) => (meta.getAttribute("name") || "").toLowerCase() === "googlebot")
    ),
  };
}

async function waitForTabComplete(tabId, timeoutMs = 4000) {
  const tab = await chrome.tabs.get(tabId);
  if (tab.status === "complete") return;

  await new Promise((resolve) => {
    const timeout = setTimeout(resolve, timeoutMs);

    const onUpdated = (updatedId, info) => {
      if (updatedId !== tabId) return;
      if (info.status === "complete") {
        clearTimeout(timeout);
        chrome.tabs.onUpdated.removeListener(onUpdated);
        resolve();
      }
    };

    chrome.tabs.onUpdated.addListener(onUpdated);
  });
}

async function prepareTab(tab) {
  await chrome.tabs.update(tab.id, { active: true });
  await chrome.windows.update(tab.windowId, { focused: true });
  await waitForTabComplete(tab.id);
  await delay(TAB_PREPARE_DELAY_MS);
}

async function fetchPageSeo(tab) {
  if (!tab?.id || isProbablyRestrictedUrl(tab.url || "")) {
    return null;
  }

  const worlds = ["ISOLATED", "MAIN"];

  for (const world of worlds) {
    try {
      const [injection] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        world,
        func: extractSeoDetails,
      });

      const value = injection?.result;
      if (value && typeof value === "object") {
        return value;
      }
    } catch {
      // try next execution world
    }
  }

  return null;
}

async function hasHostAccessForCapture() {
  if (chrome.extension?.isAllowedHostAccess) {
    return chrome.extension.isAllowedHostAccess();
  }

  try {
    return await chrome.permissions.contains({ origins: ["<all_urls>"] });
  } catch {
    return false;
  }
}

async function ensureHostPermissions() {
  if (await hasHostAccessForCapture()) {
    return;
  }

  const granted = await chrome.permissions.request({
    origins: ["<all_urls>"],
  });

  if (!granted || !(await hasHostAccessForCapture())) {
    throw new Error(SITE_ACCESS_HELP);
  }
}

async function captureTabImage(tab) {
  if (typeof chrome.tabs.captureTab === "function") {
    try {
      return await chrome.tabs.captureTab(tab.id, CAPTURE_OPTIONS);
    } catch {
      // fall through to visible-tab capture
    }
  }

  return chrome.tabs.captureVisibleTab(tab.windowId, CAPTURE_OPTIONS);
}

function isCaptureQuotaError(err) {
  const msg = err?.message || String(err);
  return (
    msg.includes("MAX_CAPTURE_VISIBLE_TAB") ||
    msg.includes("quota")
  );
}

async function waitForCaptureQuotaSlot() {
  const elapsed = Date.now() - lastVisibleTabCaptureAt;
  if (elapsed < FULL_CAPTURE_MIN_CAPTURE_INTERVAL_MS) {
    await delay(FULL_CAPTURE_MIN_CAPTURE_INTERVAL_MS - elapsed);
  }
}

async function captureTabImageThrottled(tab, { maxAttempts = 4 } = {}) {
  let lastError = null;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    await waitForCaptureQuotaSlot();

    try {
      const dataUrl = await captureTabImage(tab);
      lastVisibleTabCaptureAt = Date.now();
      return dataUrl;
    } catch (err) {
      lastError = err;
      if (!isCaptureQuotaError(err) || attempt === maxAttempts - 1) {
        throw err;
      }
      await delay(FULL_CAPTURE_MIN_CAPTURE_INTERVAL_MS * (attempt + 1));
    }
  }

  throw lastError || new Error("Screenshot failed");
}

/** Runs inside the page — must be self-contained (no closure vars). */
function getPageScrollMetrics() {
  const scrollHeight = Math.max(
    document.documentElement.scrollHeight || 0,
    document.body?.scrollHeight || 0
  );

  return {
    scrollHeight,
    viewportHeight: window.innerHeight,
    viewportWidth: window.innerWidth,
    originalScrollX: window.scrollX,
    originalScrollY: window.scrollY,
    devicePixelRatio: window.devicePixelRatio || 1,
  };
}

/** Runs inside the page — must be self-contained (no closure vars). */
function scrollPageTo(x, y) {
  window.scrollTo(x, y);
}

function computeScrollPositions(scrollHeight, viewportHeight) {
  if (scrollHeight <= viewportHeight) {
    return [0];
  }

  const positions = [];
  const maxY = scrollHeight - viewportHeight;
  let y = 0;

  while (y < maxY) {
    positions.push(y);
    y += viewportHeight;
  }

  if (positions[positions.length - 1] !== maxY) {
    positions.push(maxY);
  }

  return positions;
}

async function runInPage(tabId, func, args = []) {
  const worlds = ["ISOLATED", "MAIN"];

  for (const world of worlds) {
    try {
      const [injection] = await chrome.scripting.executeScript({
        target: { tabId },
        world,
        func,
        args,
      });
      return injection?.result;
    } catch {
      // try next execution world
    }
  }

  return null;
}

async function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function loadCaptureImage(dataUrl) {
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  return createImageBitmap(blob);
}

function drawCaptureSlice(ctx, img, captureIndex, captures, metrics, scale, canvasHeight) {
  const { devicePixelRatio } = metrics;
  const yPx = Math.round(captures[captureIndex].y * devicePixelRatio * scale);
  const destWidth = Math.max(1, Math.round(img.width * scale));
  const destHeight = Math.max(1, Math.round(img.height * scale));

  if (captureIndex === captures.length - 1) {
    const usedHeight = canvasHeight - yPx;
    if (usedHeight > 0 && usedHeight < destHeight) {
      const srcUsedHeight = Math.max(1, Math.round(usedHeight / scale));
      const cropY = img.height - srcUsedHeight;
      ctx.drawImage(
        img,
        0,
        cropY,
        img.width,
        srcUsedHeight,
        0,
        yPx,
        destWidth,
        usedHeight
      );
      return;
    }
  }

  ctx.drawImage(img, 0, 0, img.width, img.height, 0, yPx, destWidth, destHeight);
}

async function stitchCaptureSlices(captures, metrics) {
  if (captures.length === 1) {
    return { dataUrl: captures[0].dataUrl, scaled: false };
  }

  const { scrollHeight, devicePixelRatio } = metrics;
  const naturalHeight = Math.round(scrollHeight * devicePixelRatio);
  const scale = Math.min(1, FULL_CAPTURE_MAX_OUTPUT_HEIGHT_PX / naturalHeight);
  const scaled = scale < 1;
  const canvasHeight = Math.max(1, Math.round(naturalHeight * scale));

  const firstImg = await loadCaptureImage(captures[0].dataUrl);
  const canvasWidth = Math.max(1, Math.round(firstImg.width * scale));
  const canvas = new OffscreenCanvas(canvasWidth, canvasHeight);
  const ctx = canvas.getContext("2d");

  drawCaptureSlice(ctx, firstImg, 0, captures, metrics, scale, canvasHeight);
  firstImg.close();

  for (let i = 1; i < captures.length; i += 1) {
    const img = await loadCaptureImage(captures[i].dataUrl);
    drawCaptureSlice(ctx, img, i, captures, metrics, scale, canvasHeight);
    img.close();
  }

  const blob = await canvas.convertToBlob({
    type: "image/jpeg",
    quality: CAPTURE_OPTIONS.quality / 100,
  });

  return { dataUrl: await blobToDataUrl(blob), scaled };
}

async function captureFullPageTabImage(tab) {
  const metrics = await runInPage(tab.id, getPageScrollMetrics);
  if (!metrics?.scrollHeight) {
    throw new Error("Could not read page dimensions for full screenshot");
  }

  const positions = computeScrollPositions(metrics.scrollHeight, metrics.viewportHeight);

  const captures = [];
  lastVisibleTabCaptureAt = 0;

  for (const y of positions) {
    await runInPage(tab.id, scrollPageTo, [0, y]);
    await delay(FULL_CAPTURE_SCROLL_SETTLE_MS);
    const dataUrl = await captureTabImageThrottled(tab);
    captures.push({ y, dataUrl });
  }

  await runInPage(tab.id, scrollPageTo, [
    metrics.originalScrollX,
    metrics.originalScrollY,
  ]);

  return stitchCaptureSlices(captures, metrics);
}

async function resolveLiveTab({ tabId, url, title } = {}) {
  if (tabId) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab) return tab;
    } catch {
      // tab id no longer valid
    }
  }

  if (url) {
    let matches = await chrome.tabs.query({ url });
    if (matches.length > 0) {
      return matches[0];
    }

    try {
      const base = url.split("#")[0].split("?")[0];
      if (base) {
        matches = await chrome.tabs.query({ url: `${base}*` });
        if (matches.length > 0) {
          return matches[0];
        }
      }
    } catch {
      // invalid url pattern
    }
  }

  if (title) {
    const allTabs = await chrome.tabs.query({});
    const exact = allTabs.find((tab) => tab.title === title);
    if (exact) return exact;
    const partial = allTabs.find(
      (tab) => tab.title && title && tab.title.includes(title)
    );
    if (partial) return partial;
  }

  return null;
}

async function retakeTabScreenshot({
  tabId,
  url,
  title,
  fullPage = false,
  returnToTabId = null,
} = {}) {
  await ensureHostPermissions();

  const tab = await resolveLiveTab({ tabId, url, title });
  if (!tab) {
    return { error: "Tab is no longer open. Open the page and try again." };
  }

  const result = tabResultFromTab(tab);

  if (isProbablyRestrictedUrl(result.url)) {
    result.error =
      "Screenshot unavailable: restricted pages (chrome://, extension, etc.) cannot be captured";
    return result;
  }

  if (!result.url) {
    result.error = "Page still loading (no URL yet)";
    return result;
  }

  let returnTab = null;
  if (returnToTabId) {
    try {
      returnTab = await chrome.tabs.get(returnToTabId);
    } catch {
      returnTab = null;
    }
  }
  const originalTab = returnTab ?? (await getOriginalActiveTab());

  try {
    await prepareTab(tab);
    const freshTab = await chrome.tabs.get(tab.id);

    if (fullPage) {
      const stitched = await captureFullPageTabImage(freshTab);
      result.screenshot = stitched.dataUrl;
      result.screenshotScaled = stitched.scaled;
    } else {
      result.screenshot = await captureTabImage(freshTab);
      result.screenshotScaled = false;
    }

    result.screenshotFullPage = fullPage;
    result.error = null;
    result.seo = await fetchPageSeo(freshTab);
    result.description = result.seo?.description || null;
    result.title = freshTab.title || result.title;
    result.url = freshTab.url || result.url;
    result.id = freshTab.id;
    result.windowId = freshTab.windowId;
  } catch (err) {
    const message = err?.message || "Screenshot failed";
    if (message.includes("activeTab") || message.includes("all_urls")) {
      result.error = `${message}. ${SITE_ACCESS_HELP}`;
    } else {
      result.error = message;
    }
    result.screenshot = null;
    result.screenshotFullPage = false;
    result.screenshotScaled = false;
  } finally {
    await restoreActiveTab(originalTab);
  }

  return result;
}

async function captureTabSafely(tab) {
  const result = tabResultFromTab(tab);

  if (isProbablyRestrictedUrl(result.url)) {
    result.error =
      "Screenshot unavailable: restricted pages (chrome://, extension, etc.) cannot be captured";
    return result;
  }

  if (!(await hasHostAccessForCapture())) {
    result.error = SITE_ACCESS_HELP;
    return result;
  }

  if (!result.url) {
    result.error = "Page still loading (no URL yet)";
    return result;
  }

  try {
    await prepareTab(tab);
    const freshTab = await chrome.tabs.get(tab.id);

    const [screenshot, seo] = await Promise.all([
      captureTabImage(freshTab).catch((err) => ({ error: err })),
      fetchPageSeo(freshTab),
    ]);

    if (screenshot?.error) {
      throw screenshot.error;
    }
    result.screenshot = screenshot;
    result.seo = seo;
    result.description = seo?.description || null;
  } catch (err) {
    const message = err?.message || "Screenshot failed";
    if (message.includes("activeTab") || message.includes("all_urls")) {
      result.error = `${message}. ${SITE_ACCESS_HELP}`;
    } else if (!result.error) {
      result.error = message;
    }

    if (!result.seo) {
      try {
        result.seo = await fetchPageSeo(tab);
        result.description = result.seo?.description || null;
      } catch {
        result.seo = null;
        result.description = null;
      }
    }
  }

  return result;
}

async function processTabWithoutScreenshot(tab) {
  const result = tabResultFromTab(tab);

  if (!isProbablyRestrictedUrl(result.url)) {
    try {
      result.seo = await fetchPageSeo(tab);
      result.description = result.seo?.description || null;
    } catch {
      result.seo = null;
      result.description = null;
    }
  }

  return result;
}

async function getOriginalActiveTab() {
  const tabs = await chrome.tabs.query({
    active: true,
    lastFocusedWindow: true,
  });
  return tabs[0] ?? null;
}

async function restoreActiveTab(tab) {
  if (!tab?.id) return;
  try {
    await chrome.windows.update(tab.windowId, { focused: true });
    await chrome.tabs.update(tab.id, { active: true });
  } catch {
    // Best-effort restore; do not throw
  }
}

async function buildTabReport({ includeScreenshots = true } = {}) {
  if (includeScreenshots) {
    await ensureHostPermissions();
  }

  const focusTab = await getOriginalActiveTab();
  const originalTab = includeScreenshots ? focusTab : null;
  const windowId = focusTab?.windowId;

  if (windowId == null) {
    throw new Error("Could not determine the current window");
  }

  const windowTabs = await chrome.tabs.query({ windowId });
  const results = [];

  for (const tab of windowTabs) {
    if (tab.url?.startsWith(chrome.runtime.getURL(""))) {
      continue;
    }

    try {
      const result = includeScreenshots
        ? await captureTabSafely(tab)
        : await processTabWithoutScreenshot(tab);
      results.push(result);
    } catch (err) {
      results.push({
        ...tabResultFromTab(tab),
        error: err?.message || "Failed to process tab",
      });
    }
  }

  if (includeScreenshots) {
    await restoreActiveTab(originalTab);
  }

  const report = {
    generatedAt: new Date().toISOString(),
    tabCount: results.length,
    tabs: results,
    screenshotsSkipped: !includeScreenshots,
  };

  await saveTabReport(report);

  const reportUrl = chrome.runtime.getURL("report.html");
  await chrome.tabs.create({ url: reportUrl });
}

async function handleReportFailure(err) {
  console.error("Tab report failed:", err);

  await saveTabReport({
    generatedAt: new Date().toISOString(),
    tabCount: 1,
    tabs: [
      {
        id: 0,
        windowId: 0,
        title: "Permission required",
        url: "",
        openExtensionSettings: true,
        screenshot: null,
        description: null,
        seo: null,
        error: err?.message || SITE_ACCESS_HELP,
      },
    ],
    screenshotsSkipped: false,
  });

  await chrome.tabs.create({ url: chrome.runtime.getURL("report.html") });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.action === "buildReport") {
    const includeScreenshots = message.includeScreenshots !== false;

    buildTabReport({ includeScreenshots })
      .then(() => sendResponse({ ok: true }))
      .catch(async (err) => {
        await handleReportFailure(err);
        sendResponse({ ok: true });
      });

    return true;
  }

  if (message?.action === "retakeScreenshot") {
    const requestId = message.requestId;

    sendResponse({ ok: true, started: true });

    (async () => {
      try {
        const result = await retakeTabScreenshot({
          tabId: message.tabId,
          url: message.url,
          title: message.title,
          fullPage: message.fullPage === true,
          returnToTabId: message.returnToTabId,
        });

        if (requestId) {
          chrome.runtime.sendMessage({
            action: "retakeScreenshotResult",
            requestId,
            ok: true,
            result,
          });
        }
      } catch (err) {
        if (requestId) {
          chrome.runtime.sendMessage({
            action: "retakeScreenshotResult",
            requestId,
            ok: false,
            result: { error: err?.message || "Screenshot failed" },
          });
        }
      }
    })();

    return true;
  }

  return undefined;
});
