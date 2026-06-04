/**
 * Tab helpers — extend here for query filters, groups, etc.
 */

/**
 * Focus a window and activate a tab by id.
 * @param {number} tabId
 * @returns {Promise<chrome.tabs.Tab>}
 */
export async function switchToTab(tabId) {
  const tab = await chrome.tabs.get(tabId);
  await chrome.windows.update(tab.windowId, { focused: true });
  await chrome.tabs.update(tabId, { active: true });
  return chrome.tabs.get(tabId);
}

/**
 * Open a URL in a new tab.
 * @param {string} url
 * @param {{ active?: boolean, pinned?: boolean, index?: number }} [options]
 * @returns {Promise<chrome.tabs.Tab>}
 */
export async function createTab(url, options = {}) {
  const { active = true, pinned, index } = options;
  return chrome.tabs.create({
    url,
    active,
    pinned,
    index,
  });
}

/**
 * List tabs in the current window (or all windows).
 * @param {{ currentWindow?: boolean }} [query]
 * @returns {Promise<chrome.tabs.Tab[]>}
 */
export async function listTabs(query = { currentWindow: true }) {
  return chrome.tabs.query(query);
}
