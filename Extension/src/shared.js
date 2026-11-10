/* Next Toppers Study Kit — shared helpers (content-script scope). */
(() => {
  "use strict";

  const NT = (globalThis.NT = globalThis.NT || {});

  NT.VERSION = "1.1.1";
  // Bump when the course crawler/index format changes. Courses indexed with an
  // older version are re-crawled automatically instead of waiting 6 hours.
  NT.INDEX_VERSION = 2;
  NT.APP_ID = "1770981347";
  NT.BRAND = "Next Toppers Study Kit";

  NT.DEFAULT_SETTINGS = {
    enabled: true,
    shortcuts: true,
    seekSeconds: 10,
    longSeekSeconds: 30,
    autoResume: true,
    showResumePrompt: true,
    saveProgress: true,
    autoComplete: true,
    autoCompleteAt: 92,
    showHeaderButton: true,
    showNativeSections: true,
    showFloatingTab: false,
    showPlayerButtons: true,
    autoIndexCourse: true,
    syncBookmarks: true,
    confirmDelete: true,
    compactHub: false,
    lastSeenVersion: null
  };

  const HTML_ESCAPES = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  };

  NT.util = {
    escapeHTML(value) {
      return String(value == null ? "" : value).replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch]);
    },

    uid(prefix = "nt") {
      try {
        if (crypto && crypto.randomUUID) return `${prefix}_${crypto.randomUUID()}`;
      } catch (_) {}
      return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
    },

    clamp(value, min, max) {
      return Math.min(max, Math.max(min, Number(value) || 0));
    },

    normalizeText(value) {
      return String(value == null ? "" : value)
        .toLowerCase()
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[’']/g, "")
        .replace(/\s+/g, " ")
        .trim();
    },

    formatTime(seconds, opts = {}) {
      const total = Math.max(0, Math.floor(Number(seconds) || 0));
      const h = Math.floor(total / 3600);
      const m = Math.floor((total % 3600) / 60);
      const s = total % 60;
      if (h > 0 || opts.forceHours) {
        return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
      }
      return `${m}:${String(s).padStart(2, "0")}`;
    },

    formatDuration(seconds) {
      const total = Math.max(0, Math.floor(Number(seconds) || 0));
      if (!total) return "—";
      if (total < 60) return `${total}s`;
      const m = Math.round(total / 60);
      if (m < 60) return `${m} min`;
      const h = Math.floor(m / 60);
      const rem = m % 60;
      return rem ? `${h}h ${rem}m` : `${h}h`;
    },

    formatNumber(value) {
      const n = Number(value) || 0;
      if (n >= 1000000) return `${(n / 1000000).toFixed(1).replace(/\.0$/, "")}M`;
      if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}K`;
      return String(n);
    },

    formatRelative(timestamp) {
      const ts = Number(timestamp) || 0;
      if (!ts) return "";
      const diff = Date.now() - ts;
      const mins = Math.floor(diff / 60000);
      if (mins < 1) return "just now";
      if (mins < 60) return `${mins}m ago`;
      const hours = Math.floor(mins / 60);
      if (hours < 24) return `${hours}h ago`;
      const days = Math.floor(hours / 24);
      if (days === 1) return "yesterday";
      if (days < 7) return `${days}d ago`;
      const date = new Date(ts);
      return date.toLocaleDateString(undefined, { day: "numeric", month: "short" });
    },

    formatDate(timestamp) {
      if (!timestamp) return "Never";
      return new Date(Number(timestamp)).toLocaleDateString(undefined, {
        day: "numeric",
        month: "short",
        year: "numeric"
      });
    },

    dayKey(date = new Date()) {
      const d = date instanceof Date ? date : new Date(date);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
        d.getDate()
      ).padStart(2, "0")}`;
    },

    greeting() {
      const hour = new Date().getHours();
      if (hour < 5) return "Late night grind";
      if (hour < 12) return "Good morning";
      if (hour < 17) return "Good afternoon";
      if (hour < 21) return "Good evening";
      return "Night owl mode";
    },

    debounce(fn, wait = 150) {
      let timer = 0;
      return function debounced(...args) {
        clearTimeout(timer);
        timer = setTimeout(() => fn.apply(this, args), wait);
      };
    },

    throttle(fn, wait = 200) {
      let last = 0;
      let timer = 0;
      let lastArgs = null;
      return function throttled(...args) {
        const now = Date.now();
        const remaining = wait - (now - last);
        lastArgs = args;
        if (remaining <= 0) {
          clearTimeout(timer);
          timer = 0;
          last = now;
          fn.apply(this, args);
        } else if (!timer) {
          timer = setTimeout(() => {
            timer = 0;
            last = Date.now();
            fn.apply(this, lastArgs);
          }, remaining);
        }
      };
    },

    sleep(ms) {
      return new Promise((resolve) => setTimeout(resolve, ms));
    },

    isTypingTarget(target) {
      if (!target || !(target instanceof Element)) return false;
      const tag = target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
      if (target.isContentEditable) return true;
      return Boolean(target.closest("[contenteditable='true'], [role='textbox'], [role='combobox']"));
    },

    isModifier(event) {
      return event.ctrlKey || event.metaKey || event.altKey;
    },

    safeJSON(value, fallback = null) {
      try {
        return JSON.parse(value);
      } catch (_) {
        return fallback;
      }
    },

    absoluteURL(path) {
      try {
        return new URL(path, location.origin).href;
      } catch (_) {
        return path;
      }
    },

    slugToTitle(slug) {
      return String(slug || "")
        .replace(/-\d+(?:-p\d+)?$/, "")
        .replace(/[-_]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    },

    scoreMatch(haystack, needle) {
      const h = NT.util.normalizeText(haystack);
      const n = NT.util.normalizeText(needle);
      if (!n) return 1;
      if (!h) return 0;
      if (h === n) return 100;
      if (h.startsWith(n)) return 80;
      const wordIndex = h.indexOf(` ${n}`);
      if (wordIndex >= 0) return 65;
      const index = h.indexOf(n);
      if (index >= 0) return Math.max(20, 55 - index);
      const words = n.split(" ").filter(Boolean);
      if (words.length > 1) {
        let hits = 0;
        words.forEach((word) => {
          if (h.includes(word)) hits += 1;
        });
        if (hits) return 10 + (hits / words.length) * 20;
      }
      return 0;
    },

    relativeLuminance(hex) {
      const value = String(hex || "").replace("#", "");
      if (value.length !== 6) return 0;
      const rgb = [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16) / 255);
      const mapped = rgb.map((c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
      return mapped[0] * 0.2126 + mapped[1] * 0.7152 + mapped[2] * 0.0722;
    }
  };

  NT.routes = {
    parseCourse(pathname = location.pathname) {
      const match = String(pathname).match(
        /^\/(?:private\/course|courses)\/(.+?)-(\d+)(?:-p(\d+))?\/?$/
      );
      if (!match) return null;
      const base = String(pathname).startsWith("/private/") ? "/private/course" : "/courses";
      const parentId = match[3] && match[3] !== "0" ? match[3] : "";
      return {
        slug: match[1],
        courseId: match[2],
        parentId,
        path: `${base}/${match[1]}-${match[2]}${parentId ? `-p${parentId}` : ""}`
      };
    },

    parsePlay(pathname = location.pathname) {
      const match = String(pathname).match(/^\/play\/(\d+)-(\d+)\/?$/);
      if (!match) return null;
      return { contentId: match[1], courseId: match[2], path: `/play/${match[1]}-${match[2]}` };
    },

    playURL(contentId, courseId, seconds) {
      const base = `/play/${encodeURIComponent(contentId)}-${encodeURIComponent(courseId)}`;
      const value = Number(seconds);
      return Number.isFinite(value) && value > 0 ? `${base}?nt_t=${Math.floor(value)}` : base;
    },

    courseURL(course) {
      if (!course) return "/";
      const base = location.pathname.startsWith("/private/") ? "/private/course" : "/courses";
      const parentId = String(course.parentId || "");
      if (course.slug) {
        let slug = String(course.slug).replace(/-p\d+$/, "");
        if (!/-\d+$/.test(slug)) slug = `${slug}-${course.id}`;
        if (parentId && !/-\d+-p\d+$/.test(slug)) slug = `${slug}-p${parentId}`;
        return `${base}/${slug}`;
      }
      if (course.path) return course.path;
      return `${base}/course-${course.id}${parentId ? `-p${parentId}` : ""}`;
    },

    prevCourse() {
      try {
        const prev = sessionStorage.getItem("prevPath");
        if (!prev) return null;
        return NT.routes.parseCourse(new URL(prev, location.origin).pathname);
      } catch (_) {
        return null;
      }
    }
  };

  const paths = {
    play: '<path d="M8 5.7v12.6c0 .9 1 1.5 1.8 1L19 13c.8-.5.8-1.6 0-2.1L9.8 4.8C9 4.3 8 4.8 8 5.7Z" fill="currentColor" stroke="none"/>',
    pause:
      '<rect x="7" y="5" width="3.4" height="14" rx="1.2" fill="currentColor" stroke="none"/><rect x="13.6" y="5" width="3.4" height="14" rx="1.2" fill="currentColor" stroke="none"/>',
    search:
      '<circle cx="11" cy="11" r="6.4"/><path d="m16 16 4.2 4.2"/>',
    bookmark:
      '<path d="M6.8 4.5h10.4a1.5 1.5 0 0 1 1.5 1.5v14l-6.7-4.1L5.3 20V6a1.5 1.5 0 0 1 1.5-1.5Z"/>',
    bookmarkFilled:
      '<path d="M6.8 4.5h10.4a1.5 1.5 0 0 1 1.5 1.5v14l-6.7-4.1L5.3 20V6a1.5 1.5 0 0 1 1.5-1.5Z" fill="currentColor"/>',
    check: '<path d="m5 12.5 4.3 4.2L19 6.8"/>',
    checkCircle:
      '<circle cx="12" cy="12" r="8.5"/><path d="m8.2 12.2 2.5 2.5 5.2-5.5"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.3V12l3.3 2"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    chevronDown: '<path d="m6 9 6 6 6-6"/>',
    chevronRight: '<path d="m9 6 6 6-6 6"/>',
    chevronLeft: '<path d="m15 6-6 6 6 6"/>',
    arrowLeft: '<path d="M19 12H5"/><path d="m11 6-6 6 6 6"/>',
    arrowRight: '<path d="M5 12h14"/><path d="m13 6 6 6-6 6"/>',
    home: '<path d="m4 10.5 8-6.2 8 6.2V20a1 1 0 0 1-1 1h-4.5v-6.5h-5V21H5a1 1 0 0 1-1-1v-9.5Z"/>',
    library:
      '<path d="M4.5 5.8c2.6-.8 5.1-.8 7.5.4 2.4-1.2 4.9-1.2 7.5-.4v12.4c-2.6-.8-5.1-.8-7.5.4-2.4-1.2-4.9-1.2-7.5-.4V5.8Z"/><path d="M12 6.2v12.4"/>',
    book: '<path d="M5 5.5A2.5 2.5 0 0 1 7.5 3H19v15H7.5A2.5 2.5 0 0 0 5 20.5v-15Z"/><path d="M5 20.5A2.5 2.5 0 0 1 7.5 18H19v3H7.5A2.5 2.5 0 0 1 5 20.5Z"/>',
    settings:
      '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>',
    sparkles:
      '<path d="M12 3.5 13.7 9l5.5 1.7-5.5 1.7L12 18l-1.7-5.6L4.8 10.7 10.3 9 12 3.5Z"/><path d="M19 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2Z"/>',
    flame:
      '<path d="M12.5 21c3.6 0 6.5-2.5 6.5-6.2 0-3.2-1.8-5.5-4.5-7.6-.6-.5-1.4 0-1.3.8.1 1.4-.3 2.6-1.2 3.3.2-3.8-2.4-6-4.5-7.4-.7-.4-1.5.2-1.3 1 .6 2.7-.8 4.2-2 5.7-1 1.3-1.7 2.5-1.7 4.2C3 18.5 5.9 21 9.5 21h3Z"/>',
    chart: '<path d="M4 20V4"/><path d="M4 20h16"/><path d="m7 15 3.5-4 3 2.5L20 7"/>',
    download: '<path d="M12 4v11"/><path d="m7.5 11 4.5 4.5 4.5-4.5"/><path d="M5 20h14"/>',
    upload: '<path d="M12 20V9"/><path d="m7.5 13 4.5-4.5 4.5 4.5"/><path d="M5 4h14"/>',
    trash: '<path d="M4 7h16"/><path d="M9 7V5h6v2"/><path d="M6.5 7 7.4 20h9.2L17.5 7"/><path d="M10 11v5M14 11v5"/>',
    edit: '<path d="M4 20h4.2L20 8.2 15.8 4 4 15.8V20Z"/><path d="m13.8 6 4.2 4.2"/>',
    external: '<path d="M14 4h6v6"/><path d="M20 4 10 14"/><path d="M18 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h6"/>',
    info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5"/><path d="M12 8h.01"/>',
    alert: '<path d="M12 4 3.5 19h17L12 4Z"/><path d="M12 9v4"/><path d="M12 16.5h.01"/>',
    refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    volume: '<path d="M4 10v4h3l4 3.5v-11L7 10H4Z"/><path d="M15 9.2a4 4 0 0 1 0 5.6"/><path d="M17.8 6.8a7.3 7.3 0 0 1 0 10.4"/>',
    mute: '<path d="M4 10v4h3l4 3.5v-11L7 10H4Z"/><path d="m15 10 5 5M20 10l-5 5"/>',
    fullscreen: '<path d="M8 4H4v4M16 4h4v4M8 20H4v-4M16 20h4v-4"/>',
    user: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20c.8-3.4 3.4-5 7-5s6.2 1.6 7 5"/>',
    playCircle: '<circle cx="12" cy="12" r="8.5"/><path d="m10.3 8.8 5 3.2-5 3.2V8.8Z" fill="currentColor" stroke="none"/>',
    time: '<path d="M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17Z"/><path d="M12 8v4.2l2.8 1.6"/>',
    keyboard:
      '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M7 10h.01M10 10h.01M13 10h.01M16 10h.01M8 14h8"/>',
    cloud: '<path d="M6.5 18a4 4 0 0 1-.4-8 5.6 5.6 0 0 1 10.8-1.9A4.5 4.5 0 0 1 18 18H6.5Z"/>',
    dot: '<circle cx="12" cy="12" r="3" fill="currentColor" stroke="none"/>'
  };

  NT.icon = (name, size = 18, className = "") => {
    const body = paths[name] || paths.info;
    return `<svg class="nt-icon ${className}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;
  };

  NT.mark = (size = 32) => `
    <svg width="${size}" height="${size}" viewBox="0 0 48 48" fill="none" aria-hidden="true" focusable="false">
      <defs><linearGradient id="ntmark${size}" x1="6" y1="2" x2="42" y2="46" gradientUnits="userSpaceOnUse"><stop stop-color="#42e3b9"/><stop offset="1" stop-color="#0fa870"/></linearGradient></defs>
      <rect x="2" y="2" width="44" height="44" rx="13" fill="url(#ntmark${size})"/>
      <path d="M19 14.5c0-1.7 1.9-2.7 3.3-1.8l12 7.6c1.3.8 1.3 2.7 0 3.5l-12 7.6c-1.4.9-3.3-.1-3.3-1.8V14.5Z" fill="#0c1f1a"/>
      <path d="M31 27.5h6.5v10L34.3 35l-3.3 2.5v-10Z" fill="#fff"/>
    </svg>`;

  NT.wordmark = (sub = true) => `
    <span class="nt-wordmark">
      <span class="nt-wordmark-text">next<span>toppers</span></span>
      ${sub ? '<span class="nt-wordmark-badge">STUDY KIT</span>' : ""}
    </span>`;

  NT.escape = NT.util.escapeHTML;
})();
