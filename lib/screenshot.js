/**
 * Screenshot helpers — extend here for cropping, PDF, element capture, etc.
 */

import { switchToTab } from "./tabs.js";

/**
 * Capture the visible area of the active tab in a window.
 * The target tab must be active in that window.
 *
 * @param {number} [windowId] — defaults to current window
 * @param {{ format?: 'jpeg' | 'png', quality?: number }} [options]
 * @returns {Promise<string>} data URL
 */
export async function captureActiveTab(windowId, options = {}) {
  const { format = "png", quality } = options;
  const captureOptions = { format };
  if (format === "jpeg" && quality != null) {
    captureOptions.quality = quality;
  }
  return chrome.tabs.captureVisibleTab(windowId, captureOptions);
}

/**
 * Activate a tab, capture it, then optionally restore the previous active tab.
 *
 * @param {number} tabId
 * @param {{ format?: 'jpeg' | 'png', quality?: number, restorePrevious?: boolean }} [options]
 * @returns {Promise<{ dataUrl: string, tab: chrome.tabs.Tab }>}
 */
export async function captureTab(tabId, options = {}) {
  const { format = "png", quality, restorePrevious = false } = options;

  const targetTab = await chrome.tabs.get(tabId);
  const windowId = targetTab.windowId;

  let previousTabId = null;
  if (restorePrevious) {
    const tabs = await chrome.tabs.query({ windowId, active: true });
    const current = tabs[0];
    if (current && current.id !== tabId) {
      previousTabId = current.id;
    }
  }

  await switchToTab(tabId);
  const dataUrl = await captureActiveTab(windowId, { format, quality });

  if (restorePrevious && previousTabId != null) {
    await switchToTab(previousTabId);
  }

  return { dataUrl, tab: await chrome.tabs.get(tabId) };
}
