importScripts("report-storage.js");

const TAB_PREPARE_DELAY_MS = 600;
const FULL_CAPTURE_SCROLL_SETTLE_MS = 250;
const FULL_CAPTURE_MAX_SLICES = 40;
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
    screenshot: null,
    error: null,
  };
}

/** Runs inside the page — must be self-contained (no closure vars). */
function extractMetaDescription() {
  const read = (meta) => meta?.getAttribute("content")?.trim() || "";

  for (const meta of document.querySelectorAll("meta[content]")) {
    if ((meta.getAttribute("name") || "").toLowerCase() === "description") {
      const text = read(meta);
      if (text) return text;
    }
  }

  for (const meta of document.querySelectorAll("meta[content]")) {
    const prop = (meta.getAttribute("property") || "").toLowerCase();
    const name = (meta.getAttribute("name") || "").toLowerCase();
    if (prop === "og:description" || name === "og:description") {
      const text = read(meta);
      if (text) return text;
    }
  }

  for (const meta of document.querySelectorAll("meta[content]")) {
    if ((meta.getAttribute("name") || "").toLowerCase() === "twitter:description") {
      const text = read(meta);
      if (text) return text;
    }
  }

  return null;
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

async function fetchPageDescription(tab) {
  if (!tab?.id || isProbablyRestrictedUrl(tab.url || "")) {
    return null;
  }

  const worlds = ["ISOLATED", "MAIN"];

  for (const world of worlds) {
    try {
      const [injection] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        world,
        func: extractMetaDescription,
      });

      const value = injection?.result;
      if (typeof value === "string" && value.length > 0) {
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

async function stitchCaptureSlices(captures, metrics) {
  if (captures.length === 1) {
    return captures[0].dataUrl;
  }

  const { scrollHeight, devicePixelRatio } = metrics;
  const images = await Promise.all(
    captures.map(async ({ dataUrl }) => {
      const response = await fetch(dataUrl);
      const blob = await response.blob();
      return createImageBitmap(blob);
    })
  );

  const sliceWidth = images[0].width;
  const totalHeight = Math.round(scrollHeight * devicePixelRatio);
  const canvas = new OffscreenCanvas(sliceWidth, totalHeight);
  const ctx = canvas.getContext("2d");

  for (let i = 0; i < images.length; i += 1) {
    const yPx = Math.round(captures[i].y * devicePixelRatio);
    const img = images[i];

    if (i === images.length - 1) {
      const usedHeight = totalHeight - yPx;
      if (usedHeight > 0 && usedHeight < img.height) {
        const cropY = img.height - usedHeight;
        ctx.drawImage(img, 0, cropY, img.width, usedHeight, 0, yPx, img.width, usedHeight);
      } else {
        ctx.drawImage(img, 0, yPx);
      }
    } else {
      ctx.drawImage(img, 0, yPx);
    }
  }

  const blob = await canvas.convertToBlob({
    type: "image/jpeg",
    quality: CAPTURE_OPTIONS.quality / 100,
  });

  return blobToDataUrl(blob);
}

async function captureFullPageTabImage(tab) {
  const metrics = await runInPage(tab.id, getPageScrollMetrics);
  if (!metrics?.scrollHeight) {
    throw new Error("Could not read page dimensions for full screenshot");
  }

  const positions = computeScrollPositions(metrics.scrollHeight, metrics.viewportHeight);
  if (positions.length > FULL_CAPTURE_MAX_SLICES) {
    throw new Error(
      `Page is too long (${positions.length} screens). Maximum is ${FULL_CAPTURE_MAX_SLICES}.`
    );
  }

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

    const screenshot = fullPage
      ? await captureFullPageTabImage(freshTab)
      : await captureTabImage(freshTab);

    result.screenshot = screenshot;
    result.screenshotFullPage = fullPage;
    result.error = null;
    result.description = await fetchPageDescription(freshTab);
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

    const [screenshot, description] = await Promise.all([
      captureTabImage(freshTab).catch((err) => ({ error: err })),
      fetchPageDescription(freshTab),
    ]);

    if (screenshot?.error) {
      throw screenshot.error;
    }
    result.screenshot = screenshot;
    result.description = description;
  } catch (err) {
    const message = err?.message || "Screenshot failed";
    if (message.includes("activeTab") || message.includes("all_urls")) {
      result.error = `${message}. ${SITE_ACCESS_HELP}`;
    } else if (!result.error) {
      result.error = message;
    }

    if (!result.description) {
      try {
        result.description = await fetchPageDescription(tab);
      } catch {
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
      result.description = await fetchPageDescription(tab);
    } catch {
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

  const originalTab = includeScreenshots ? await getOriginalActiveTab() : null;
  const allTabs = await chrome.tabs.query({});
  const results = [];

  for (const tab of allTabs) {
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
