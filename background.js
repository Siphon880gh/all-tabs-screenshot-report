const STORAGE_KEY = "tabReport";
const TAB_PREPARE_DELAY_MS = 600;

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
  const options = { format: "png" };

  if (typeof chrome.tabs.captureTab === "function") {
    try {
      return await chrome.tabs.captureTab(tab.id, options);
    } catch {
      // fall through to visible-tab capture
    }
  }

  return chrome.tabs.captureVisibleTab(tab.windowId, options);
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

async function buildTabReport() {
  await ensureHostPermissions();

  const originalTab = await getOriginalActiveTab();
  const allTabs = await chrome.tabs.query({});
  const results = [];

  for (const tab of allTabs) {
    if (tab.url?.startsWith(chrome.runtime.getURL(""))) {
      continue;
    }

    try {
      const result = await captureTabSafely(tab);
      results.push(result);
    } catch (err) {
      results.push({
        ...tabResultFromTab(tab),
        error: err?.message || "Failed to process tab",
      });
    }
  }

  await restoreActiveTab(originalTab);

  const report = {
    generatedAt: new Date().toISOString(),
    tabCount: results.length,
    tabs: results,
  };

  await chrome.storage.local.set({ [STORAGE_KEY]: report });

  const reportUrl = chrome.runtime.getURL("report.html");
  await chrome.tabs.create({ url: reportUrl });
}

chrome.action.onClicked.addListener(() => {
  buildTabReport().catch(async (err) => {
    console.error("Tab report failed:", err);

    await chrome.storage.local.set({
      [STORAGE_KEY]: {
        generatedAt: new Date().toISOString(),
        tabCount: 1,
        tabs: [
          {
            id: 0,
            windowId: 0,
            title: "Permission required",
            url: `chrome://extensions/?id=${chrome.runtime.id}`,
            screenshot: null,
            description: null,
            error: err?.message || SITE_ACCESS_HELP,
          },
        ],
      },
    });

    await chrome.tabs.create({ url: chrome.runtime.getURL("report.html") });
  });
});
