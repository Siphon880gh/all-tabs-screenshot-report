import { MessageAction } from "../lib/messages.js";

const $ = (id) => document.getElementById(id);

function setStatus(text, isError = false) {
  const el = $("status");
  el.textContent = text;
  el.classList.toggle("error", isError);
}

function send(action, payload = {}) {
  return chrome.runtime.sendMessage({ action, payload });
}

async function refreshTabList() {
  const { ok, tabs, error } = await send(MessageAction.LIST_TABS, {
    query: { currentWindow: true },
  });
  if (!ok) {
    setStatus(error ?? "Failed to list tabs", true);
    return;
  }

  const select = $("tab-select");
  select.replaceChildren();

  for (const tab of tabs) {
    const opt = document.createElement("option");
    opt.value = String(tab.id);
    opt.textContent = tab.title || tab.url || `Tab ${tab.id}`;
    if (tab.active) opt.textContent += " (active)";
    select.appendChild(opt);
  }
}

function showPreview(dataUrl) {
  const preview = $("preview");
  const img = $("preview-img");
  img.src = dataUrl;
  preview.hidden = false;
}

$("btn-create-tab").addEventListener("click", async () => {
  const url = $("new-tab-url").value.trim();
  if (!url) {
    setStatus("Enter a URL", true);
    return;
  }

  const { ok, tab, error } = await send(MessageAction.CREATE_TAB, { url });
  if (!ok) {
    setStatus(error ?? "Failed to create tab", true);
    return;
  }

  setStatus(`Opened: ${tab.url}`);
  await refreshTabList();
});

$("btn-switch-tab").addEventListener("click", async () => {
  const tabId = Number($("tab-select").value);
  const { ok, tab, error } = await send(MessageAction.SWITCH_TAB, { tabId });
  if (!ok) {
    setStatus(error ?? "Failed to switch tab", true);
    return;
  }

  setStatus(`Active: ${tab.title || tab.url}`);
  await refreshTabList();
});

$("btn-screenshot-active").addEventListener("click", async () => {
  const { ok, dataUrl, error } = await send(MessageAction.CAPTURE_ACTIVE, {});
  if (!ok) {
    setStatus(error ?? "Screenshot failed", true);
    return;
  }

  showPreview(dataUrl);
  setStatus("Captured active tab");
});

$("btn-screenshot-selected").addEventListener("click", async () => {
  const tabId = Number($("tab-select").value);
  const { ok, dataUrl, error } = await send(MessageAction.CAPTURE_TAB, {
    tabId,
    options: { restorePrevious: true },
  });
  if (!ok) {
    setStatus(error ?? "Screenshot failed", true);
    return;
  }

  showPreview(dataUrl);
  setStatus(`Captured tab ${tabId}`);
});

refreshTabList().catch((err) => setStatus(String(err), true));
