/* Next Toppers Study Kit — service worker. */
"use strict";

const SITE = "https://nexttoppers.com/";

// Only these modules may be injected on demand. Keeping the heavy views out
// of the always-on content script is what makes page loads feel instant.
const MODULES = new Set([
  "src/hub.js",
  "src/quick-search.js",
  "src/player.js"
]);

const activeTab = async () => {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0] || null;
};

const isExtensionSender = (sender) =>
  !sender?.id || sender.id === chrome.runtime.id;
const isSiteSender = (sender) =>
  isExtensionSender(sender) &&
  /^https:\/\/([a-z0-9-]+\.)*nexttoppers\.com\//i.test(String(sender?.url || sender?.origin || ""));

const sendToTab = async (tabId, payload) => {
  try {
    await chrome.tabs.sendMessage(tabId, payload, { frameId: 0 });
    return true;
  } catch (_) {
    return false;
  }
};

const openOnSite = async (payload) => {
  const tab = await activeTab();
  if (tab?.id && (await sendToTab(tab.id, payload))) {
    if (tab.windowId) chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
    return true;
  }
  const created = await chrome.tabs.create({ url: SITE });
  // Let the content script boot before asking it to open the overlay.
  if (created?.id) {
    const listener = (tabId, info) => {
      if (tabId !== created.id || info.status !== "complete") return;
      chrome.tabs.onUpdated.removeListener(listener);
      setTimeout(() => sendToTab(created.id, payload), 800);
    };
    chrome.tabs.onUpdated.addListener(listener);
  }
  return false;
};

chrome.commands.onCommand.addListener((command) => {
  if (command === "open-study-hub") openOnSite({ type: "open-hub" });
  else if (command === "quick-search") openOnSite({ type: "open-search" });
});

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") {
    chrome.runtime.openOptionsPage().catch(() => {});
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== "object") return false;
  if (!isExtensionSender(sender)) return false;

  if (message.type === "nt:ensure-modules") {
    if (!isSiteSender(sender)) {
      sendResponse({ ok: false, error: "Modules can only be loaded on nexttoppers.com." });
      return false;
    }
    const tabId = sender.tab?.id;
    const files = Array.isArray(message.files)
      ? message.files.filter((file) => MODULES.has(file))
      : [];
    if (!tabId || !files.length) {
      sendResponse({ ok: false, error: "Nothing to load." });
      return false;
    }
    chrome.scripting.executeScript(
      { target: { tabId, frameIds: [0] }, files },
      () => {
        if (chrome.runtime.lastError) {
          sendResponse({ ok: false, error: chrome.runtime.lastError.message });
        } else {
          sendResponse({ ok: true });
        }
      }
    );
    return true;
  }

  if (message.type === "nt:open-site" || message.type === "open-site") {
    openOnSite({
      type: message.open === "open-search" ? "open-search" : "open-hub",
      tab: message.tab
    });
    sendResponse({ ok: true });
    return false;
  }
  if (message.type === "nt:get-active-tab") {
    activeTab()
      .then((tab) => sendResponse({ ok: true, tab: tab ? { id: tab.id, url: tab.url, title: tab.title } : null }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }
  return false;
});
