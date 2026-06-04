const STORAGE_KEY = "tabReport";
const CAPTURE_DELAY_MS = 500;
const HOST_ORIGINS = ["<all_urls>", "*://*/*", "http://*/*", "https://*/*"];

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
    url.startsWith("file://")
  );
}

function tabResultFromTab(tab) {
  return {
    id: tab.id,
    windowId: tab.windowId,
    title: tab.title || "Untitled",
    url: tab.url || "",
    screenshot: null,
    error: null,
  };
}

async function hasHostAccessForCapture() {
  if (chrome.extension?.isAllowedHostAccess) {
    return chrome.extension.isAllowedHostAccess();
  }

  for (const origins of [
    ["<all_urls>"],
    ["*://*/*"],
    ["http://*/*", "https://*/*"],
  ]) {
    try {
      if (await chrome.permissions.contains({ origins })) {
        return true;
      }
    } catch {
      // try next pattern
    }
  }

  return false;
}

/**
 * Request broad host access while the toolbar click user gesture is still valid.
 */
async function ensureHostPermissions() {
  if (await hasHostAccessForCapture()) {
    return;
  }

  let granted = false;
  for (const origins of [
    ["<all_urls>"],
    ["*://*/*"],
    ["http://*/*", "https://*/*"],
  ]) {
    try {
      granted = await chrome.permissions.request({ origins });
      if (granted) break;
    } catch {
      // try next pattern
    }
  }

  if (!granted || !(await hasHostAccessForCapture())) {
    throw new Error(SITE_ACCESS_HELP);
  }
}

async function captureTabImage(tab) {
  const options = { format: "png" };

  if (typeof chrome.tabs.captureTab === "function") {
    return chrome.tabs.captureTab(tab.id, options);
  }

  await chrome.tabs.update(tab.id, { active: true });
  await chrome.windows.update(tab.windowId, { focused: true });
  await delay(CAPTURE_DELAY_MS);

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

  try {
    result.screenshot = await captureTabImage(tab);
  } catch (err) {
    const message = err?.message || "Screenshot failed";
    if (message.includes("activeTab") || message.includes("all_urls")) {
      result.error = `${message}. ${SITE_ACCESS_HELP}`;
    } else {
      result.error = message;
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
            error: err?.message || SITE_ACCESS_HELP,
          },
        ],
      },
    });

    await chrome.tabs.create({ url: chrome.runtime.getURL("report.html") });
  });
});
