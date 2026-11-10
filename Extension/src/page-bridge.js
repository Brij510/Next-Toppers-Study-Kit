/* Next Toppers Study Kit — page-world bridge.
 * Runs in the MAIN world so it can read the Video.js player instance and the
 * site's own API traffic, then relays both to the isolated content scripts. */
(() => {
  "use strict";

  const IN = "nt-kit";
  const OUT = "nt-page";
  const origin = location.origin;
  const watched = /\/api\/service-proxy\/course\/(content-details|mycourses|all-content|course-details|add-video-time-bookmark|delete-video-time-bookmark|v1\/watch\/(vod|live)\/heartbeat)/;
  const nativeFetch = window.fetch;
  const xhrOpen = XMLHttpRequest.prototype.open;
  const xhrSend = XMLHttpRequest.prototype.send;

  // Next.js App Router navigates with history.pushState. Patching both methods
  // lets the isolated world react immediately instead of polling the URL.
  let lastURL = location.href;
  const nudgeRoute = () => {
    if (location.href === lastURL) return;
    lastURL = location.href;
    try {
      window.dispatchEvent(new CustomEvent("nt:navigate", { detail: { url: lastURL } }));
    } catch (_) {}
  };
  ["pushState", "replaceState"].forEach((method) => {
    const original = history[method];
    if (typeof original !== "function") return;
    history[method] = function ntHistory(...args) {
      const result = Reflect.apply(original, this, args);
      nudgeRoute();
      return result;
    };
  });
  window.addEventListener("popstate", nudgeRoute);
  window.addEventListener("hashchange", nudgeRoute);

  // The content script runs in an isolated world and cannot see React's DOM
  // expandos. Publish a plain data attribute here, where they are visible, so
  // the header button is only injected after the server HTML is hydrated.
  try {
    document.documentElement.dataset.ntManaged = "nexttoppers";
  } catch (_) {
    document.addEventListener(
      "DOMContentLoaded",
      () => {
        document.documentElement.dataset.ntManaged = "nexttoppers";
      },
      { once: true }
    );
  }

  const findHeader = () =>
    [...document.querySelectorAll("div.fixed, header")].find((node) => {
      const rect = node.getBoundingClientRect();
      return (
        rect.top <= 20 &&
        rect.height > 0 &&
        rect.height < 220 &&
        rect.width >= window.innerWidth * 0.5
      );
    }) || document.querySelector("header");

  const markHydrated = () => {
    if (document.documentElement.dataset.ntHydrated === "1") return;
    document.documentElement.dataset.ntHydrated = "1";
  };

  const hydrationTimer = window.setInterval(() => {
    const header = findHeader();
    const hydrated =
      header &&
      Object.keys(header).some(
        (key) => key.startsWith("__reactFiber$") || key.startsWith("__reactProps$")
      );
    if (!hydrated) return;
    window.clearInterval(hydrationTimer);
    window.setTimeout(markHydrated, 150);
  }, 100);
  window.setTimeout(() => window.clearInterval(hydrationTimer), 20000);

  // Safety net: the expando probe can miss when React replaces the header on a
  // client route, which used to leave the native sections waiting forever.
  // Once the document has clearly settled, let them mount.
  const hydrationFallback = () => {
    if (document.readyState !== "interactive" && document.readyState !== "complete") return;
    markHydrated();
  };
  window.setTimeout(hydrationFallback, 8000);
  window.addEventListener("load", () => window.setTimeout(hydrationFallback, 2000), { once: true });

  const post = (kind, payload = {}) => {
    try {
      window.postMessage({ source: OUT, kind, ...payload }, origin);
    } catch (_) {
      /* the page may navigate mid-flight */
    }
  };

  const parse = (text) => {
    if (typeof text !== "string" || !text) return null;
    try {
      return JSON.parse(text);
    } catch (_) {
      return null;
    }
  };

  const trimBody = (body) => {
    if (typeof body !== "string") return null;
    if (body.length > 24000) return body.slice(0, 24000);
    return body;
  };

  const report = (meta, text) => {
    const url = String(meta.url || "");
    if (!watched.test(url)) return;
    post("api", {
      url,
      method: String(meta.method || "GET").toUpperCase(),
      requestBody: trimBody(meta.body),
      status: Number(meta.status) || 0,
      data: parse(text)
    });
  };

  /* ---------------------------------------------------------------- fetch */

  if (typeof nativeFetch === "function") {
    window.fetch = function ntFetch(input, init) {
      const request = typeof input === "string" ? null : input;
      const url = typeof input === "string" ? input : request?.url || "";
      const method = init?.method || request?.method || "GET";
      const body = init?.body;
      const promise = Reflect.apply(nativeFetch, this, arguments);

      if (!watched.test(String(url))) return promise;

      return promise.then((response) => {
        try {
          const clone = response.clone();
          clone
            .text()
            .then((text) => report({ url, method, body, status: response.status }, text))
            .catch(() => {});
        } catch (_) {}
        return response;
      });
    };
  }

  /* ------------------------------------------------------------------ XHR */

  XMLHttpRequest.prototype.open = function ntOpen(method, url) {
    this.__ntRequest = { method, url: String(url || "") };
    return Reflect.apply(xhrOpen, this, arguments);
  };

  XMLHttpRequest.prototype.send = function ntSend(body) {
    const meta = this.__ntRequest;
    if (meta && watched.test(meta.url)) {
      meta.body = body;
      this.addEventListener(
        "load",
        () => {
          try {
            const text =
              this.responseType && this.responseType !== "text" ? "" : this.responseText;
            report({ ...meta, status: this.status }, text);
          } catch (_) {}
        },
        { once: true }
      );
    }
    return Reflect.apply(xhrSend, this, arguments);
  };

  /* --------------------------------------------------------------- player */

  let current = null;
  let currentKind = "";
  let stateTimer = 0;
  let stateSignature = "";
  const bound = new WeakSet();

  const safe = (fn, fallback) => {
    try {
      return fn();
    } catch (_) {
      return fallback;
    }
  };

  const findPlayer = () => {
    const el = document.querySelector(".video-js");
    if (el) {
      const player = el.player || el.__player;
      if (player && typeof player.currentTime === "function" && !safe(() => player.isDisposed?.(), false)) {
        return { api: player, kind: "videojs", element: el };
      }
    }

    const registry = window.videojs?.getPlayers?.();
    if (registry && typeof registry === "object") {
      const player = Object.values(registry).find(
        (item) => item && typeof item.currentTime === "function" && !safe(() => item.isDisposed?.(), false)
      );
      if (player) return { api: player, kind: "videojs", element: player.el?.() || el || null };
    }

    const video = document.querySelector("video");
    if (video && video.readyState > 0) return { api: video, kind: "html5", element: video };

    return null;
  };

  const readState = () => {
    if (!current) return null;
    const api = current.api;
    const time = Number(safe(() => api.currentTime(), 0)) || 0;
    const duration = Number(safe(() => api.duration(), 0)) || 0;
    return {
      ready: true,
      kind: currentKind,
      time,
      duration,
      paused: Boolean(safe(() => api.paused(), true)),
      ended: Boolean(safe(() => api.ended(), false)),
      rate: Number(safe(() => api.playbackRate(), 1)) || 1,
      volume: Number(safe(() => api.volume(), 1)),
      muted: Boolean(safe(() => api.muted(), false)),
      seeking: Boolean(safe(() => api.seeking(), false)),
      isLive: !Number.isFinite(duration) || duration === 0,
      source: String(safe(() => api.currentSrc?.() || api.src || "", "")),
      contentId: (location.pathname.match(/^\/play\/(\d+)-/)?.[1]) || null,
      courseId: (location.pathname.match(/^\/play\/\d+-(\d+)/)?.[1]) || null
    };
  };

  const publish = (force = false) => {
    const state = readState();
    if (!state) return;
    const signature = [
      Math.floor(state.time * 2),
      Math.round(state.duration),
      state.paused,
      state.ended,
      state.rate,
      state.muted,
      Math.round(state.volume * 20),
      state.isLive
    ].join("|");
    if (!force && signature === stateSignature) return;
    stateSignature = signature;
    post("player-state", { state });
  };

  const bindPlayer = (found) => {
    current = found;
    currentKind = found.kind;
    stateSignature = "";
    post("player-ready", { kind: found.kind });
    publish(true);

    const api = found.api;
    if (bound.has(api)) return;
    bound.add(api);

    const events = [
      "play",
      "pause",
      "ended",
      "timeupdate",
      "seeked",
      "ratechange",
      "volumechange",
      "loadedmetadata",
      "waiting",
      "playing"
    ];

    events.forEach((name) => {
      const handler = () => {
        publish(name !== "timeupdate");
        if (name !== "timeupdate") post("player-event", { event: name, state: readState() });
      };
      if (found.kind === "videojs" && typeof api.on === "function") api.on(name, handler);
      else api.addEventListener?.(name, handler);
    });
  };

  const locate = () => {
    const found = findPlayer();
    if (!found) {
      if (current) {
        current = null;
        currentKind = "";
        post("player-gone");
      }
      return;
    }
    if (found.api !== current?.api) bindPlayer(found);
  };

  const isPlayPage = () => location.pathname.startsWith("/play/");

  const stopPolling = () => {
    if (!stateTimer) return;
    window.clearInterval(stateTimer);
    stateTimer = 0;
  };

  const startPolling = () => {
    if (stateTimer || !isPlayPage()) return;
    stateTimer = window.setInterval(() => {
      if (!isPlayPage()) {
        stopPolling();
        return;
      }
      if (document.visibilityState === "hidden") return;
      locate();
      if (!current) return;
      publish(false);
    }, 1000);
  };

  const syncPlayerLifecycle = () => {
    if (!isPlayPage()) {
      stopPolling();
      if (current) {
        current = null;
        currentKind = "";
        stateSignature = "";
        post("player-gone");
      }
      return;
    }
    startPolling();
    window.setTimeout(locate, 700);
  };

  const seekBounds = (api) => {
    const duration = Number(safe(() => api.duration(), 0)) || 0;
    const seekable = safe(() => api.seekable?.(), null);
    let start = 0;
    let end = duration > 0 && Number.isFinite(duration) ? duration : null;
    if (seekable && seekable.length) {
      const s = Number(safe(() => seekable.start(0), 0));
      const e = Number(safe(() => seekable.end(seekable.length - 1), 0));
      if (Number.isFinite(s) && Number.isFinite(e) && e > s) {
        start = Math.max(0, s);
        end = end === null ? e : Math.min(end, e);
      }
    }
    return { start, end };
  };

  const command = (action, args = {}) => {
    const found = findPlayer();
    if (!found) throw new Error("No player found on this page yet.");
    if (found.api !== current?.api) bindPlayer(found);
    const api = found.api;

    switch (action) {
      case "getState":
        return readState();
      case "play":
        return Promise.resolve(api.play?.());
      case "pause":
        return api.pause?.();
      case "toggle":
        return api.paused?.() ? Promise.resolve(api.play?.()) : api.pause?.();
      case "seek": {
        const desired = Math.max(0, Number(args.seconds) || 0);
        const { start, end } = seekBounds(api);
        if (end === null) throw new Error("This live stream can't be rewound yet.");
        const target = Math.min(Math.max(start, desired), Math.max(start, end - 0.25));
        api.currentTime(target);
        publish(true);
        return target;
      }
      case "seekBy": {
        const currentTime = Number(safe(() => api.currentTime?.(), 0)) || 0;
        const { start, end } = seekBounds(api);
        if (end === null) throw new Error("This live stream can't be rewound yet.");
        const target = Math.min(
          Math.max(start, currentTime + (Number(args.delta) || 0)),
          Math.max(start, end - 0.25)
        );
        api.currentTime(target);
        publish(true);
        return target;
      }
      case "setRate":
        api.playbackRate(Number(args.rate) || 1);
        return Number(args.rate) || 1;
      case "setVolume":
        api.volume(NTclamp(args.volume, 0, 1));
        if (args.volume > 0) api.muted?.(false);
        return api.volume();
      case "mute":
        api.muted?.(Boolean(args.muted));
        return Boolean(args.muted);
      case "toggleMute":
        api.muted?.(!safe(() => api.muted(), false));
        return safe(() => api.muted(), false);
      case "fullscreen": {
        const el = found.element?.closest?.(".video-js") || found.element || document.querySelector(".video-js");
        if (document.fullscreenElement) return document.exitFullscreen?.();
        return el?.requestFullscreen?.();
      }
      default:
        throw new Error(`Unknown player action: ${action}`);
    }
  };

  const NTclamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const msg = event.data;
    if (!msg || msg.source !== IN || msg.kind !== "command") return;
    const id = msg.id;
    try {
      Promise.resolve(command(msg.action, msg.args || {}))
        .then((result) => post("response", { id, ok: true, result }))
        .catch((error) => post("response", { id, ok: false, error: String(error?.message || error) }));
    } catch (error) {
      post("response", { id, ok: false, error: String(error?.message || error) });
    }
  });

  // The site's player is created well after document_start. Only watch player
  // pages; every other route should stay completely idle.
  document.addEventListener("DOMContentLoaded", syncPlayerLifecycle);
  window.addEventListener("popstate", () => setTimeout(syncPlayerLifecycle, 300));
  window.addEventListener("nt:navigate", () => syncPlayerLifecycle());
  document.addEventListener("nt:route-change", () => setTimeout(syncPlayerLifecycle, 300));
  syncPlayerLifecycle();
})();
