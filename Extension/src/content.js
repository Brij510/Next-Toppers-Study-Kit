/* Next Toppers Study Kit — content-script bootstrapper. */
(() => {
  "use strict";

  const NT = globalThis.NT;
  const store = NT.store;

  let lastHref = "";
  let routeTimer = 0;
  let fullscreen = false;
  let hubPromise = null;
  let playerPromise = null;

  const isPlay = () => Boolean(NT.routes.parsePlay());
  const isCourse = () => Boolean(NT.routes.parseCourse());

  /* --------------------------------------------------------- lazy modules */

  const ensureModules = (files) =>
    new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ type: "nt:ensure-modules", files }, (response) => {
          resolve(Boolean(response?.ok));
        });
      } catch (_) {
        resolve(false);
      }
    });

  const loadHub = () => {
    if (NT.hub && NT.quickSearch) return Promise.resolve(true);
    if (hubPromise) return hubPromise;
    hubPromise = (async () => {
      const ok = await ensureModules(["src/hub.js", "src/quick-search.js"]);
      if (!ok) {
        hubPromise = null;
        return false;
      }
      NT.ui.addStyles("src/ui.css");
      // executeScript resolves only after the file has run, so the module is
      // already attached to NT here. Waiting on requestAnimationFrame used to
      // dead-lock the first click in background/headless tabs, where frames do
      // not fire.
      return Boolean(NT.hub);
    })();
    return hubPromise;
  };

  const loadPlayer = () => {
    if (NT.player) return Promise.resolve(true);
    if (playerPromise) return playerPromise;
    playerPromise = (async () => {
      const ok = await ensureModules(["src/player.js"]);
      if (!ok) {
        playerPromise = null;
        return false;
      }
      NT.ui.addStyles(["src/ui.css", "src/player.css"]);
      return Boolean(NT.player);
    })();
    return playerPromise;
  };

  const openHub = async (tab) => {
    if (!store.settings.enabled) return false;
    const ok = await loadHub();
    if (!ok) {
      NT.ui.toast("Could not open the Study Kit. Reload the page and try again.", {
        type: "error"
      });
      return false;
    }
    NT.hub.open({ tab });
    return true;
  };

  const openSearch = async () => {
    if (!store.settings.enabled) return false;
    const ok = await loadHub();
    if (!ok) {
      NT.ui.toast("Could not open search. Reload the page and try again.", { type: "error" });
      return false;
    }
    NT.quickSearch.open();
    return true;
  };

  // Header buttons, keyboard shortcuts and the native page entries all fire
  // the same DOM event. Route it through the lazy loader so the first click
  // works even though hub.js is not on the page yet. When hub.js is already
  // loaded its own listener opens the drawer first; open() is idempotent, so
  // this second call only changes the tab.
  document.addEventListener("nt:open-hub", (event) => {
    void openHub(event.detail?.tab);
  });

  document.addEventListener("nt:open-search", () => {
    void openSearch();
  });

  /* --------------------------------------------------------------- routing */

  const applyChrome = () => {
    const settings = store.settings;
    const enabled = Boolean(settings.enabled);
    const host = NT.ui.root?.host;
    host?.classList.toggle("nt-disabled", !enabled);
    document.documentElement.classList.toggle(
      "nt-hide-player-buttons",
      !enabled || !settings.showPlayerButtons
    );

    if (!enabled) {
      NT.hub?.close();
      NT.quickSearch?.close();
      document
        .querySelectorAll(".nt-head-btn, [data-nt-native]")
        .forEach((node) => node.remove());
      NT.ui.setTabVisible(false);
      return;
    }

    NT.ui.setTabVisible(Boolean(settings.showFloatingTab) && !isPlay() && !fullscreen);
    NT.ui.refreshHeader();
    NT.native?.refresh();
  };

  const onRoute = async () => {
    const route = NT.routes.parsePlay();
    const course = NT.routes.parseCourse();
    document.documentElement.classList.toggle("nt-play-page", Boolean(route));
    applyChrome();

    if (route) {
      const loaded = await loadPlayer();
      const current = NT.routes.parsePlay();
      const alreadyActive =
        NT.player?.route?.contentId === route.contentId &&
        NT.player?.route?.courseId === route.courseId;
      // history.replaceState (used to clean ?nt_t after a deep link) fires the
      // same route event. Re-initialising an already-active player would wipe
      // the pending deep link and restart the resume decision.
      if (!alreadyActive && loaded && current?.contentId === route.contentId) {
        NT.player.init({ syncDelay: 2600 });
      }
    } else {
      NT.player?.cleanup();
    }

    if (course) {
      setTimeout(() => {
        NT.sync.autoIndexCourse(course.courseId).catch(() => {});
      }, 900);
    }

    if (NT.hub?.isOpen && !route) NT.hub.close();
    NT.native?.refresh();
    document.dispatchEvent(new CustomEvent("nt:route-change", { detail: { route, course } }));
  };

  const scheduleRoute = () => {
    clearTimeout(routeTimer);
    routeTimer = setTimeout(() => {
      if (location.href === lastHref) return;
      lastHref = location.href;
      onRoute();
    }, 80);
  };

  const checkRoute = () => {
    if (location.href === lastHref) return;
    lastHref = location.href;
    onRoute();
  };

  const boot = async () => {
    await store.init();

    NT.ui.watchHeader();
    NT.native?.mount();
    applyChrome();

    lastHref = location.href;
    onRoute();

    store.on((event) => {
      if (event === "settings" || event === "external" || event === "reload") {
        applyChrome();
      }
    });

    window.addEventListener("popstate", scheduleRoute);
    window.addEventListener("nt:navigate", scheduleRoute);
    window.addEventListener("pageshow", scheduleRoute);
    window.addEventListener("focus", checkRoute);
    if (window.navigation?.addEventListener) {
      window.navigation.addEventListener("navigatesuccess", scheduleRoute);
    }
  };

  /* --------------------------------------------------------------- shortcuts */

  document.addEventListener(
    "keydown",
    (event) => {
      if (!store.settings.enabled) return;
      if (NT.util.isTypingTarget(event.target)) return;

      if (
        (event.ctrlKey || event.metaKey) &&
        !event.altKey &&
        (event.key === "k" || event.key === "K")
      ) {
        event.preventDefault();
        event.stopPropagation();
        void openSearch();
        return;
      }

      if (
        (event.altKey && event.shiftKey && (event.code === "KeyS" || event.key === "S")) ||
        (event.altKey && event.shiftKey && (event.code === "KeyF" || event.key === "F"))
      ) {
        event.preventDefault();
        event.stopPropagation();
        if (event.code === "KeyF" || event.key === "F") void openSearch();
        else if (NT.hub?.isOpen) NT.hub.close();
        else void openHub();
        return;
      }

      if (NT.ui.runShortcuts(event)) {
        event.preventDefault();
        event.stopPropagation();
      }
    },
    true
  );

  document.addEventListener("fullscreenchange", () => {
    fullscreen = Boolean(document.fullscreenElement);
    if (fullscreen) NT.ui.setTabVisible(false);
    else applyChrome();
  });

  /* --------------------------------------------------------- runtime messages */

  const handleMessage = (message, sender, sendResponse) => {
    if (!message || typeof message !== "object") return false;
    // Only this extension (content scripts, popup, options) may drive the
    // page. A web page cannot reach chrome.runtime without externally
    // connectable, but reject spoofed senders defensively as well.
    if (sender?.id && sender.id !== chrome.runtime.id) return false;
    const type = String(message.type || message.command || "");

    if (type === "open-hub" || type === "nt:open-hub") {
      if (!store.settings.enabled) {
        sendResponse?.({ ok: false, reason: "disabled" });
        return false;
      }
      void openHub(message.tab).then((ok) => sendResponse?.({ ok }));
      return true;
    }

    if (type === "open-search" || type === "nt:open-search" || type === "quick-search") {
      if (!store.settings.enabled) {
        sendResponse?.({ ok: false, reason: "disabled" });
        return false;
      }
      void openSearch().then((ok) => sendResponse?.({ ok }));
      return true;
    }

    if (type === "context" || type === "nt:context") {
      sendResponse?.({
        ok: true,
        url: location.href,
        isPlay: isPlay(),
        isCourse: isCourse(),
        loggedIn: NT.api.session.loggedIn(),
        stats: store.stats(),
        settings: store.settings
      });
      return false;
    }

    if (type === "settings" || type === "nt:update-settings") {
      store.updateSettings(message.settings || {});
      applyChrome();
      sendResponse?.({ ok: true, settings: store.settings });
      return false;
    }

    if (type === "continue") {
      const wantedId = NT.sanitize.id(message.contentId || message.lectureId);
      const progress = wantedId ? store.getProgress(wantedId) : store.getContinueItem();
      const lecture = wantedId
        ? store.getLecture(wantedId)
        : progress
          ? store.getLecture(progress.contentId)
          : null;
      const courseId =
        NT.sanitize.id(message.courseId) ||
        lecture?.courseId ||
        progress?.courseId ||
        "";
      const playId =
        NT.sanitize.id(message.playId) ||
        lecture?.playId ||
        lecture?.id ||
        wantedId ||
        "";
      const requested = Number(message.seconds);
      const position =
        Number.isFinite(requested) && requested >= 0
          ? requested
          : Number(progress?.position) || 0;
      if (playId && courseId) {
        NT.ui.routeTo(NT.routes.playURL(playId, courseId, position));
        sendResponse?.({ ok: true });
      } else {
        sendResponse?.({ ok: false, reason: "No lecture in progress." });
      }
      return false;
    }

    return false;
  };

  chrome.runtime.onMessage.addListener(handleMessage);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
