import { MessageAction } from "../lib/messages.js";
import { switchToTab, createTab, listTabs } from "../lib/tabs.js";
import { captureActiveTab, captureTab } from "../lib/screenshot.js";

/**
 * Central message router — wire new features through this listener.
 */
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handleMessage(message)
    .then(sendResponse)
    .catch((err) => {
      sendResponse({ ok: false, error: err?.message ?? String(err) });
    });
  return true;
});

async function handleMessage({ action, payload }) {
  switch (action) {
    case MessageAction.SWITCH_TAB: {
      const tab = await switchToTab(payload.tabId);
      return { ok: true, tab };
    }

    case MessageAction.CREATE_TAB: {
      const tab = await createTab(payload.url, payload.options);
      return { ok: true, tab };
    }

    case MessageAction.LIST_TABS: {
      const tabs = await listTabs(payload?.query);
      return { ok: true, tabs };
    }

    case MessageAction.CAPTURE_ACTIVE: {
      const dataUrl = await captureActiveTab(payload?.windowId, payload?.options);
      return { ok: true, dataUrl };
    }

    case MessageAction.CAPTURE_TAB: {
      const result = await captureTab(payload.tabId, payload?.options);
      return { ok: true, ...result };
    }

    default:
      throw new Error(`Unknown action: ${action}`);
  }
}
