/* Minimal Chrome API shim so the extension UI can run in the demo harness.
 * In a real extension the existing chrome.storage API wins and this file is a
 * no-op, which also makes the popup/options preview pages work. */
(() => {
  "use strict";

  const chromeObj = (window.chrome = window.chrome || {});
  const hasStorage = Boolean(
    chromeObj.storage && chromeObj.storage.local && chromeObj.storage.local.get
  );
  if (hasStorage && chromeObj.runtime && chromeObj.runtime.getURL) return;

  const KEY = "ntdb";
  const storageListeners = [];

  const read = (key) => {
    try {
      return JSON.parse(localStorage.getItem(key));
    } catch (_) {
      return localStorage.getItem(key);
    }
  };

  const gather = (keys) => {
    const result = {};
    if (typeof keys === "string") {
      result[keys] = read(keys);
    } else if (Array.isArray(keys)) {
      keys.forEach((key) => {
        result[key] = read(key);
      });
    } else if (keys && typeof keys === "object") {
      Object.keys(keys).forEach((key) => {
        const value = read(key);
        result[key] = value === null || value === undefined ? keys[key] : value;
      });
    }
    return result;
  };

  const local = {
    get(keys, callback) {
      const result = gather(keys);
      if (typeof callback === "function") {
        setTimeout(() => callback(result), 0);
        return undefined;
      }
      return Promise.resolve(result);
    },
    set(values, callback) {
      const changes = {};
      Object.entries(values || {}).forEach(([key, value]) => {
        changes[key] = { oldValue: read(key), newValue: value };
        localStorage.setItem(key, JSON.stringify(value));
      });
      const done = () => {
        storageListeners.forEach((listener) => {
          try {
            listener(changes, "local");
          } catch (_) {}
        });
        callback?.();
      };
      if (typeof callback === "function") {
        setTimeout(done, 0);
        return undefined;
      }
      setTimeout(done, 0);
      return Promise.resolve();
    }
  };

  chromeObj.storage = chromeObj.storage || {};
  chromeObj.storage.local = local;
  chromeObj.storage.onChanged = chromeObj.storage.onChanged || {
    addListener(listener) {
      storageListeners.push(listener);
    }
  };

  chromeObj.runtime = chromeObj.runtime || {};
  chromeObj.runtime.getURL = (path) => {
    try {
      return new URL(`../${path}`, location.href).href;
    } catch (_) {
      return `../${path}`;
    }
  };
  chromeObj.runtime.getManifest = () => ({ version: "1.0.0", name: "Next Toppers Study Kit" });
  chromeObj.runtime.openOptionsPage = () => {
    location.href = "../options/options.html";
  };
  chromeObj.runtime.sendMessage = (message, callback) => {
    callback?.(null);
  };

  chromeObj.tabs = chromeObj.tabs || {};
  chromeObj.tabs.query = (query, callback) => {
    callback?.([{ id: 1, url: "https://nexttoppers.com/", active: true, currentWindow: true }]);
  };
  chromeObj.tabs.sendMessage = (tabId, message, options, callback) => {
    callback?.(null);
  };
  chromeObj.tabs.create = ({ url }) => {
    window.open(url, "_blank", "noopener");
  };
})();
