/* Next Toppers Study Kit — shared shadow-DOM UI shell. */
(() => {
  "use strict";

  const NT = globalThis.NT;
  const HOST_ID = "nt-study-kit-host";
  const store = NT.store;

  let shadow = null;
  let tabEl = null;
  let tabSuppressed = false;
  let toastRoot = null;
  let layerRoot = null;
  let headerObserver = null;
  let headerTimer = 0;
  let headerRetry = 0;
  let headerWatchTimer = 0;
  let styleLinks = new Set();
  let headerAttempts = 0;
  let zCounter = 40;
  const layers = [];
  const shortcuts = new Set();
  let previousFocus = null;

  const asset = (path) => {
    try {
      return chrome.runtime.getURL(path);
    } catch (_) {
      return `../${path}`;
    }
  };

  const el = (tag, className = "", html = "") => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (html) node.innerHTML = html;
    return node;
  };

  const addStyles = (paths) => {
    if (!shadow) mount();
    (Array.isArray(paths) ? paths : [paths]).forEach((path) => {
      if (!path || styleLinks.has(path)) return;
      styleLinks.add(path);
      const link = el("link");
      link.rel = "stylesheet";
      link.href = asset(path);
      shadow.appendChild(link);
    });
  };

  const mount = () => {
    if (shadow) return shadow;
    const host = el("div");
    host.id = HOST_ID;
    document.documentElement.appendChild(host);
    shadow = host.attachShadow({ mode: "open" });

    // The site already ships Poppins. Reusing it removes four font files from
    // the extension and avoids a second font download on every page.
    addStyles("src/ui.css");

    const root = el("div", "nt-root");
    root.innerHTML = `
      <div class="nt-toasts" role="status" aria-live="polite"></div>
      <div class="nt-layers"></div>
      <div class="nt-tab-slot"></div>
    `;
    shadow.appendChild(root);
    toastRoot = root.querySelector(".nt-toasts");
    layerRoot = root.querySelector(".nt-layers");

    createTab(root.querySelector(".nt-tab-slot"));
    return shadow;
  };

  /* ------------------------------------------------------------------ toast */

  const dismissToast = (node) => {
    if (!node || node.classList.contains("is-leaving")) return;
    node.classList.add("is-leaving");
    setTimeout(() => node.remove(), 220);
  };

  const toast = (message, options = {}) => {
    mount();
    const type = options.type || "success";
    const node = el("div", `nt-toast nt-toast-${type}`);
    const icons = {
      success: "checkCircle",
      error: "alert",
      info: "info",
      bookmark: "bookmarkFilled",
      done: "checkCircle",
      time: "clock"
    };
    node.innerHTML = `
      <span class="nt-toast-icon">${NT.icon(icons[type] || "info", 18)}</span>
      <span class="nt-toast-copy">${NT.escape(message)}</span>
      ${
        options.action
          ? `<button class="nt-toast-action" type="button">${NT.escape(options.action.label)}</button>`
          : ""
      }
      <button class="nt-toast-close" type="button" aria-label="Dismiss notification">${NT.icon(
        "x",
        14
      )}</button>
    `;
    toastRoot.appendChild(node);
    requestAnimationFrame(() => node.classList.add("is-in"));

    const close = () => dismissToast(node);
    node.querySelector(".nt-toast-close")?.addEventListener("click", close);
    if (options.action) {
      node.querySelector(".nt-toast-action")?.addEventListener("click", () => {
        try {
          options.action.onClick?.();
        } finally {
          close();
        }
      });
    }
    const timeout = options.duration ?? (options.action ? 6500 : 3400);
    if (timeout > 0) setTimeout(close, timeout);
    while (toastRoot.children.length > 3) dismissToast(toastRoot.firstElementChild);
    return { close };
  };

  const osd = (text, options = {}) => {
    mount();
    let node = shadow.querySelector(".nt-osd");
    if (!node) {
      node = el("div", "nt-osd");
      shadow.querySelector(".nt-root").appendChild(node);
    }
    node.innerHTML = `${options.icon ? NT.icon(options.icon, 16) : ""}<span>${NT.escape(text)}</span>`;
    node.classList.remove("is-in");
    void node.offsetWidth;
    node.classList.add("is-in");
    clearTimeout(node.__timer);
    node.__timer = setTimeout(() => node.classList.remove("is-in"), options.duration || 1300);
  };

  /* ----------------------------------------------------------------- layers */

  const lockScroll = (locked) => {
    document.documentElement.classList.toggle("nt-sheet-open", locked);
  };

  const activateLayer = (layer) => {
    if (layer.activated || !layers.includes(layer)) return;
    layer.activated = true;
    layer.node.classList.add("is-open");
    previousFocus = document.activeElement;
    const target =
      layer.node.querySelector("[autofocus]") ||
      layer.node.querySelector("[data-autofocus]") ||
      layer.node;
    setTimeout(() => {
      if (!target.isConnected) return;
      target.focus({ preventScroll: true });
    }, 40);
  };

  const openLayer = (id, node, options = {}) => {
    mount();
    const existing = layers.find((layer) => layer.id === id);
    if (existing) return existing;
    node.classList.add("nt-layer");
    if (!node.hasAttribute("tabindex")) node.setAttribute("tabindex", "-1");
    if (options.className) node.classList.add(...options.className.split(" "));
    node.style.zIndex = String(zCounter++);
    layerRoot.appendChild(node);
    const layer = {
      id,
      node,
      onClose: options.onClose || null,
      escape: options.escape !== false,
      lock: options.lockScroll !== false,
      activated: false
    };
    layers.push(layer);
    if (layers.some((item) => item.lock)) lockScroll(true);
    updateTab();
    // rAF is the nice path (it lets the entry transition run). The timeout
    // fallback keeps overlays usable in background or throttled tabs.
    requestAnimationFrame(() => activateLayer(layer));
    setTimeout(() => activateLayer(layer), 90);
    return layer;
  };

  const closeLayer = (id, payload) => {
    const index = layers.findIndex((layer) => layer.id === id);
    if (index < 0) return;
    const [layer] = layers.splice(index, 1);
    layer.node.classList.remove("is-open");
    setTimeout(() => layer.node.remove(), 180);
    if (!layers.length || !layers.some((item) => item.lock)) {
      lockScroll(false);
    }
    updateTab();
    if (!layers.length) {
      if (previousFocus && typeof previousFocus.focus === "function") {
        previousFocus.focus({ preventScroll: true });
      }
      previousFocus = null;
    }
    layer.onClose?.(payload);
  };

  const closeTopLayer = () => {
    const layer = layers[layers.length - 1];
    if (!layer) return false;
    closeLayer(layer.id);
    return true;
  };

  const toggleLayer = (id) => {
    if (layers.some((layer) => layer.id === id)) closeLayer(id);
    else document.dispatchEvent(new CustomEvent("nt:open-layer", { detail: { id } }));
  };

  const trapFocus = (container, event) => {
    if (event.key !== "Tab") return;
    const focusable = Array.from(
      container.querySelectorAll(
        "a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex='-1'])"
      )
    ).filter((node) => node.offsetParent !== null || node.getClientRects().length);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  document.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "Escape" && layers.length) {
        const top = layers[layers.length - 1];
        if (top.escape) {
          event.preventDefault();
          event.stopPropagation();
          closeLayer(top.id);
        }
        return;
      }
      if (layers.length) trapFocus(layers[layers.length - 1].node, event);
    },
    true
  );

  /* ---------------------------------------------------------------- confirm */

  const confirm = (options = {}) =>
    new Promise((resolve) => {
      mount();
      const node = el("div", "nt-confirm-host");
      node.innerHTML = `
        <div class="nt-scrim"></div>
        <div class="nt-confirm" role="dialog" aria-modal="true" aria-labelledby="nt-confirm-title">
          <div class="nt-confirm-icon ${options.danger ? "is-danger" : ""}">
            ${NT.icon(options.danger ? "alert" : "info", 22)}
          </div>
          <div class="nt-confirm-body">
            <h3 id="nt-confirm-title">${NT.escape(options.title || "Are you sure?")}</h3>
            <p>${NT.escape(options.message || "")}</p>
          </div>
          <div class="nt-confirm-actions">
            <button class="nt-btn nt-btn-ghost" data-no type="button">${
              NT.escape(options.cancelLabel || "Cancel")
            }</button>
            <button class="nt-btn ${options.danger ? "nt-btn-danger" : "nt-btn-primary"}" data-yes type="button" autofocus>${
              NT.escape(options.confirmLabel || "Confirm")
            }</button>
          </div>
        </div>
      `;
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        resolve(value);
        closeLayer("nt-confirm");
      };
      openLayer("nt-confirm", node, {
        className: "nt-confirm-host",
        onClose: () => {
          if (!settled) {
            settled = true;
            resolve(false);
          }
        }
      });
      node.querySelector("[data-no]").addEventListener("click", () => finish(false));
      node.querySelector("[data-yes]").addEventListener("click", () => finish(true));
      node.querySelector(".nt-scrim").addEventListener("click", () => finish(false));
      setTimeout(() => node.querySelector("[data-yes]")?.focus(), 60);
    });

  /* ----------------------------------------------------------- floating tab */

  const createTab = (slot) => {
    tabEl = el("button", "nt-tab");
    tabEl.type = "button";
    tabEl.setAttribute("aria-label", "Open Next Toppers Study Kit");
    tabEl.innerHTML = `
      <span class="nt-tab-mark">${NT.mark(28)}</span>
      <span class="nt-tab-text">
        <span class="nt-tab-title">Study Kit</span>
        <span class="nt-tab-sub">Press Alt+Shift+S</span>
      </span>
      <span class="nt-tab-chevron">${NT.icon("chevronRight", 14)}</span>
      <span class="nt-tab-pulse" aria-hidden="true"></span>
    `;
    tabEl.addEventListener("click", () => {
      if (tabEl.classList.contains("is-dragging")) return;
      document.dispatchEvent(new CustomEvent("nt:open-hub", { detail: { source: "tab" } }));
    });
    slot.appendChild(tabEl);
    updateTab();
    return tabEl;
  };

  const updateTab = () => {
    if (!tabEl) return;
    const settings = store.settings || NT.DEFAULT_SETTINGS;
    const continueItem = store.getContinueItem?.();
    const lecture = continueItem ? store.getLecture(continueItem.contentId) : null;
    const sub = lecture?.title
      ? `${NT.util.formatTime(continueItem.position)} · ${lecture.title}`.slice(0, 42)
      : "Search lectures · Ctrl K";
    const subNode = tabEl.querySelector(".nt-tab-sub");
    if (subNode) subNode.textContent = sub;
    const blocked = tabSuppressed || layers.length > 0;
    tabEl.classList.toggle("is-hidden", blocked || !settings.showFloatingTab || !settings.enabled);
  };

  const setTabVisible = (visible) => {
    tabSuppressed = !visible;
    updateTab();
  };

  /* ------------------------------------------------------------ header entry */

  const findHeaderInsertPoint = (header) => {
    const candidates = Array.from(
      header.querySelectorAll(
        "a[href*='login'], a[href*='signin'], a, button, [role='button'], [class*='profile'], [class*='Profile'], [class*='user'], [class*='User']"
      )
    ).filter((node) => {
      if (node.closest(".nt-head-btn") || node.classList.contains("nt-head-btn")) return false;
      const rect = node.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    });
    const login = candidates.find((node) => /login|log in|sign in|sign up|profile|account|dashboard/i.test(node.textContent || ""));
    if (login) {
      const parent = login.parentElement;
      if (parent && parent !== header) return { parent, before: login };
    }
    const nav = header.querySelector("nav");
    if (nav) return { parent: nav, before: null };
    return { parent: header, before: null };
  };

  // The site header is a plain fixed div rather than a <header> element, so
  // look for a few structural anchors before giving up.
  const findSiteHeader = () => {
    const explicit = document.querySelector(
      "header, [class*='header'], [class*='Header'], [class*='navbar'], [class*='Navbar']"
    );
    if (explicit) return explicit;

    const anchor =
      document.querySelector("input[placeholder*='looking for' i]") ||
      Array.from(document.querySelectorAll("button, a")).find(
        (node) =>
          /login|log in|register|sign in/i.test(node.textContent || "") &&
          node.getBoundingClientRect().width > 0
      );
    let node = anchor;
    for (let depth = 0; node && depth < 10; depth += 1) {
      if (
        node.matches?.("div.fixed, [class*='fixed'], [class*='top-0']") &&
        node.getBoundingClientRect().height < 220
      ) {
        return node;
      }
      node = node.parentElement;
    }
    return anchor ? anchor.closest("div") : null;
  };

  const headerIsDark = (header) => {
    const bounds = header.getBoundingClientRect();
    const candidates = [header, ...header.querySelectorAll("div, nav, section")].slice(0, 40);
    for (const node of candidates) {
      const rect = node.getBoundingClientRect();
      if (
        node !== header &&
        (rect.width < bounds.width * 0.5 || rect.height < Math.max(24, bounds.height * 0.4))
      ) {
        continue;
      }
      const bg = getComputedStyle(node).backgroundColor;
      const match = bg.match(/rgba?\(([^)]+)\)/);
      if (!match) continue;
      const [r, g, b, a = 1] = match[1].split(",").map(Number);
      if (a > 0.4) return (r * 299 + g * 587 + b * 114) / 1000 < 120;
    }
    return false;
  };

  // Appending to a server-rendered React header before hydration causes a
  // hydration mismatch (and React then throws away the server tree). The page
  // bridge marks the document once React has hydrated; wait for it. Pages
  // without the bridge (the demo harness) are not React and inject immediately.
  const headerCanMount = () =>
    document.documentElement.dataset.ntManaged !== "nexttoppers" ||
    document.documentElement.dataset.ntHydrated === "1";

  const injectHeaderButton = () => {
    clearTimeout(headerRetry);
    headerRetry = 0;
    if (!store.settings.showHeaderButton || !store.settings.enabled) {
      document.querySelectorAll(".nt-head-btn").forEach((node) => node.remove());
      return;
    }
    const existing = document.querySelector(".nt-head-btn");
    if (existing) {
      const rect = existing.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) return;
      existing.remove();
    }
    const header = findSiteHeader();
    if (!header) return;
    const point = findHeaderInsertPoint(header);
    if (!point?.parent) return;

    // On the live Next.js site, hold until the page bridge confirms hydration.
    // Retry at a gentle rate and give up rather than polling forever.
    if (!headerCanMount()) {
      if (headerAttempts < 100) {
        headerAttempts += 1;
        headerRetry = setTimeout(injectHeaderButton, 200);
      }
      return;
    }
    headerAttempts = 0;

    const button = el("button", "nt-head-btn");
    button.type = "button";
    button.title = "Open Study Kit (Alt+Shift+S)";
    button.classList.toggle("is-on-dark", headerIsDark(header));
    button.innerHTML = `
      <span class="nt-head-mark">${NT.mark(20)}</span>
      <span class="nt-head-label">Study Kit</span>
      <kbd>Alt ⇧ S</kbd>
    `;
    button.addEventListener("click", () => {
      document.dispatchEvent(new CustomEvent("nt:open-hub", { detail: { source: "header" } }));
    });
    if (point.before && point.before.parentElement === point.parent) {
      point.parent.insertBefore(button, point.before);
    } else {
      point.parent.appendChild(button);
    }
  };

  const stopHeaderWatch = () => {
    headerObserver?.disconnect();
    headerObserver = null;
    clearTimeout(headerWatchTimer);
    headerWatchTimer = 0;
  };

  // Watch only until the entry point exists. A permanent document-wide
  // observer was one of the biggest idle costs in the first version.
  const watchHeader = () => {
    injectHeaderButton();
    if (document.querySelector(".nt-head-btn") || headerObserver) return;
    let checks = 0;
    const schedule = NT.util.debounce(() => {
      checks += 1;
      injectHeaderButton();
      if (document.querySelector(".nt-head-btn") || checks > 60) stopHeaderWatch();
    }, 180);
    headerObserver = new MutationObserver(schedule);
    headerObserver.observe(document.body || document.documentElement, {
      childList: true,
      subtree: true
    });
    headerWatchTimer = setTimeout(stopHeaderWatch, 18000);
  };

  const refreshHeader = () => {
    clearTimeout(headerTimer);
    headerTimer = setTimeout(() => {
      injectHeaderButton();
      if (!document.querySelector(".nt-head-btn")) watchHeader();
    }, 60);
  };

  /* ----------------------------------------------------------------- helpers */

  const progressRing = (percent, size = 40, stroke = 4, className = "") => {
    const value = NT.util.clamp(percent, 0, 100);
    const radius = (size - stroke) / 2;
    const circumference = 2 * Math.PI * radius;
    const dash = (value / 100) * circumference;
    return `
      <svg class="nt-ring ${className}" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true">
        <circle cx="${size / 2}" cy="${size / 2}" r="${radius}" fill="none" stroke="currentColor" stroke-opacity=".13" stroke-width="${stroke}"/>
        <circle cx="${size / 2}" cy="${size / 2}" r="${radius}" fill="none" stroke="currentColor" stroke-width="${stroke}"
          stroke-linecap="round" stroke-dasharray="${dash} ${circumference}" transform="rotate(-90 ${
      size / 2
    } ${size / 2})"/>
      </svg>`;
  };

  const initials = (name) =>
    String(name || "")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0])
      .join("")
      .toUpperCase() || "NT";

  const watchTimeText = (seconds) => {
    const total = Math.max(0, Math.round(Number(seconds) || 0));
    if (total < 60) return `${total}s`;
    const hours = Math.floor(total / 3600);
    const minutes = Math.round((total % 3600) / 60);
    if (!hours) return `${minutes}m`;
    return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
  };

  const relativeDay = (timestamp) => {
    if (!timestamp) return "";
    const today = NT.util.dayKey();
    const yesterday = NT.util.dayKey(new Date(Date.now() - 86400000));
    const key = NT.util.dayKey(new Date(timestamp));
    if (key === today) return "Today";
    if (key === yesterday) return "Yesterday";
    return new Date(timestamp).toLocaleDateString(undefined, { day: "numeric", month: "short" });
  };

  const courseForLecture = (lecture) =>
    lecture?.courseId ? store.getCourse(lecture.courseId) : null;

  const lectureForContent = (contentId) => {
    const id = String(contentId || "");
    return (
      store.getLecture(id) || {
        id,
        title: store.getProgress(id)?.lectureTitle || "Lecture",
        courseId: store.getProgress(id)?.courseId || "",
        courseTitle: ""
      }
    );
  };

  const routeTo = (path, options = {}) => {
    const url = NT.util.absoluteURL(path);
    if (options.replace) location.assign(url);
    else location.assign(url);
  };

  const keyHint = () => {
    const platform = navigator.platform || "";
    return /mac/i.test(platform) ? "⌘K" : "Ctrl K";
  };

  NT.ui = {
    mount,
    get root() {
      return shadow;
    },
    asset,
    el,
    addStyles,
    siteReady: headerCanMount,
    toast,
    osd,
    confirm,
    openLayer,
    closeLayer,
    closeTopLayer,
    hasLayer: (id) => layers.some((layer) => layer.id === id),
    layerCount: () => layers.length,
    updateTab,
    setTabVisible,
    injectHeaderButton,
    refreshHeader,
    watchHeader,
    progressRing,
    initials,
    watchTimeText,
    relativeDay,
    courseForLecture,
    lectureForContent,
    routeTo,
    keyHint,
    registerShortcut(handler) {
      shortcuts.add(handler);
      return () => shortcuts.delete(handler);
    },
    runShortcuts(event) {
      for (const handler of shortcuts) {
        try {
          if (handler(event) === true) return true;
        } catch (error) {
          console.warn("[Study Kit] shortcut failed", error);
        }
      }
      return false;
    },
    toggleLayer,
    updateZ: () => zCounter++
  };

  store.on((event) => {
    if (["ready", "change", "external", "reload", "settings"].includes(event)) updateTab();
  });

  // The shadow host lives outside the player, so fullscreen needs it moved
  // inside the fullscreen element to keep overlays visible.
  document.addEventListener("fullscreenchange", () => {
    const host = shadow?.host;
    if (!host) return;
    const fullscreen = document.fullscreenElement;
    if (fullscreen && !fullscreen.contains(host)) fullscreen.appendChild(host);
    else if (!fullscreen && host.parentElement !== document.documentElement) {
      document.documentElement.appendChild(host);
    }
  });
})();
