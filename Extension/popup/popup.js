/* Next Toppers Study Kit — toolbar popup. */
(() => {
  "use strict";

  const STORAGE_KEY = "ntdb";
  const SITE_RE = /^https:\/\/([a-z0-9-]+\.)*nexttoppers\.com\//i;
  const DEFAULTS = {
    enabled: true,
    shortcuts: true,
    showNativeSections: true,
    showFloatingTab: false,
    showPlayerButtons: true,
    showHeaderButton: true
  };

  const $ = (selector) => document.querySelector(selector);

  const formatTime = (seconds) => {
    const total = Math.max(0, Math.floor(Number(seconds) || 0));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    if (h) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    return `${m}:${String(s).padStart(2, "0")}`;
  };

  const initials = (value) =>
    String(value || "NT")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0])
      .join("")
      .toUpperCase() || "NT";

  const getDb = () =>
    new Promise((resolve) => {
      chrome.storage.local.get(STORAGE_KEY, (result) => {
        const stored = result?.[STORAGE_KEY];
        const base = {
          settings: { ...DEFAULTS },
          lectures: {},
          courses: {},
          progress: {},
          bookmarks: [],
          activity: {},
          meta: {}
        };
        if (!stored || typeof stored !== "object") return resolve(base);
        const clean = NT.sanitize ? NT.sanitize.db(stored) : stored;
        resolve({
          ...base,
          ...clean,
          settings: { ...DEFAULTS, ...(clean.settings || {}) }
        });
      });
    });

  const activeTab = () =>
    new Promise((resolve) => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => resolve(tabs[0] || null));
    });

  const sendTab = (tabId, message) =>
    new Promise((resolve) => {
      if (!tabId) return resolve(null);
      try {
        chrome.tabs.sendMessage(tabId, message, { frameId: 0 }, (response) => {
          void chrome.runtime.lastError;
          resolve(response || null);
        });
      } catch (_) {
        resolve(null);
      }
    });

  const openSiteAction = (open, tab) => {
    chrome.runtime.sendMessage({ type: "nt:open-site", open, tab });
    window.close();
  };

  const isSite = (tab) => Boolean(tab?.url && SITE_RE.test(tab.url));

  /* ------------------------------------------------------------------ data */

  const continueItem = (db) => {
    const progress = Object.values(db.progress || {})
      .filter(
        (item) =>
          item &&
          item.lastWatchedAt &&
          !item.completed &&
          !item.manualDone &&
          !item.manualUndone &&
          (Number(item.percent) || 0) > 1 &&
          (Number(item.duration) || 0) > 0
      )
      .sort((a, b) => (b.lastWatchedAt || 0) - (a.lastWatchedAt || 0));
    const item = progress[0];
    if (!item) return null;
    const lecture = (db.lectures || {})[item.contentId] || {};
    return {
      progress: item,
      lecture,
      title: lecture.title || item.lectureTitle || "Continue your lecture",
      course: lecture.courseTitle || ""
    };
  };

  const render = async () => {
    const db = await getDb();
    const settings = { ...DEFAULTS, ...(db.settings || {}) };
    const progressItems = Object.values(db.progress || {});
    const done = progressItems.filter((item) => item.completed || item.manualDone).length;
    const inProgress = progressItems.filter(
      (item) =>
        !item.completed &&
        !item.manualDone &&
        !item.manualUndone &&
        (Number(item.percent) || 0) > 1
    ).length;
    const bookmarks = Array.isArray(db.bookmarks) ? db.bookmarks : [];

    const streak = (() => {
      const days = new Set(
        Object.entries(db.activity || {})
          .filter(([, seconds]) => Number(seconds) >= 60)
          .map(([day]) => day)
      );
      if (!days.size) return 0;
      const cursor = new Date();
      const key = (date) =>
        `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
          date.getDate()
        ).padStart(2, "0")}`;
      if (!days.has(key(cursor))) cursor.setDate(cursor.getDate() - 1);
      let count = 0;
      while (days.has(key(cursor))) {
        count += 1;
        cursor.setDate(cursor.getDate() - 1);
      }
      return count;
    })();

    $("#stat-done").textContent = String(done);
    $("#stat-progress").textContent = String(inProgress);
    $("#stat-streak").textContent = String(streak);
    $("#timestamp-count").textContent = bookmarks.length
      ? `${bookmarks.length} moment${bookmarks.length === 1 ? "" : "s"} saved`
      : "No moments saved";

    document.querySelectorAll("[data-setting]").forEach((input) => {
      input.checked = Boolean(settings[input.dataset.setting]);
    });

    const next = continueItem(db);
    const card = $("#continue-card");
    if (next) {
      card.hidden = false;
      $("#continue-art").textContent = initials(next.title);
      $("#continue-title").textContent = next.title;
      const percent = Math.max(0, Math.min(100, Math.round(Number(next.progress.percent) || 0)));
      $("#continue-meta").textContent = `${formatTime(next.progress.position)} watched${
        next.course ? ` · ${next.course}` : ""
      } · ${percent}%`;
      $("#continue-fill").style.width = `${percent}%`;
      card.dataset.lecture = next.lecture.id || next.progress.contentId;
      card.dataset.course = next.lecture.courseId || next.progress.courseId || "";
      card.dataset.playId = next.lecture.playId || next.lecture.id || next.progress.contentId;
      card.dataset.seconds = String(next.progress.position || 0);
    } else {
      card.hidden = true;
    }

    return { db, settings, next };
  };

  /* --------------------------------------------------------------- actions */

  const openHub = async (tab) => {
    const active = await activeTab();
    if (isSite(active)) {
      const response = await sendTab(active.id, { type: "open-hub", tab });
      if (response?.ok) {
        window.close();
        return;
      }
    }
    openSiteAction("open-hub", tab);
  };

  const openSearch = async () => {
    const active = await activeTab();
    if (isSite(active)) {
      const response = await sendTab(active.id, { type: "open-search" });
      if (response?.ok) {
        window.close();
        return;
      }
    }
    openSiteAction("open-search");
  };

  const resume = async (card) => {
    const active = await activeTab();
    const seconds = Number(card.dataset.seconds) || 0;
    const contentId = card.dataset.lecture || card.dataset.playId;
    const playId = card.dataset.playId || contentId;
    const courseId = card.dataset.course;
    if (isSite(active)) {
      const response = await sendTab(active.id, {
        type: "continue",
        contentId,
        playId,
        courseId,
        seconds
      });
      if (response?.ok) {
        window.close();
        return;
      }
    }
    if (!playId || !courseId) return;
    const url = `https://nexttoppers.com/play/${encodeURIComponent(playId)}-${encodeURIComponent(
      courseId
    )}${seconds > 0 ? `?nt_t=${Math.floor(seconds)}` : ""}`;
    chrome.tabs.create({ url });
    window.close();
  };

  /* --------------------------------------------------------------- toggles */

  const updateSetting = async (key, value) => {
    const active = await activeTab();
    if (isSite(active)) {
      const response = await sendTab(active.id, { type: "settings", settings: { [key]: value } });
      if (response?.ok) return;
    }
    const db = await getDb();
    db.settings = NT.sanitize
      ? NT.sanitize.settings({ ...(db.settings || {}), [key]: value })
      : { ...DEFAULTS, ...(db.settings || {}), [key]: value };
    await chrome.storage.local.set({ [STORAGE_KEY]: db });
  };

  /* ------------------------------------------------------------------ wire */

  document.addEventListener("DOMContentLoaded", async () => {
    const { next } = await render();
    void next;

    const active = await activeTab();
    const state = $("#site-state");
    const text = $("#site-text");
    if (isSite(active)) {
      state.classList.add("is-live");
      text.textContent = "Connected to nexttoppers.com";
    } else {
      state.classList.remove("is-live");
      text.textContent = "Open nexttoppers.com to use Study Kit";
    }

    $("#open-hub").addEventListener("click", () => openHub());
    $("#quick-search").addEventListener("click", openSearch);
    $("#open-timestamps").addEventListener("click", () => openHub("bookmarks"));
    $("#continue-card").addEventListener("click", (event) => resume(event.currentTarget));
    $("#open-settings").addEventListener("click", () => {
      chrome.runtime.openOptionsPage();
      window.close();
    });
    $("#open-options").addEventListener("click", () => {
      chrome.runtime.openOptionsPage();
      window.close();
    });

    document.querySelectorAll("[data-setting]").forEach((input) => {
      input.addEventListener("change", () => updateSetting(input.dataset.setting, input.checked));
    });
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[STORAGE_KEY]) render();
  });
})();
