/* Next Toppers Study Kit — local data store. */
(() => {
  "use strict";

  const NT = globalThis.NT;
  const STORAGE_KEY = "ntdb";
  const SCHEMA = 1;

  const emptyDb = () => ({
    _rev: NT.util.uid("rev"),
    _savedAt: 0,
    settings: { ...NT.DEFAULT_SETTINGS },
    lectures: {},
    courses: {},
    progress: {},
    bookmarks: [],
    activity: {},
    meta: {
      schema: SCHEMA,
      lastSync: 0,
      totalWatchTime: 0,
      created: Date.now(),
      lastLectureId: null
    }
  });

  const normalizeDb = (raw) => {
    const base = emptyDb();
    if (!raw || typeof raw !== "object") return base;
    return {
      ...base,
      ...raw,
      settings: { ...NT.DEFAULT_SETTINGS, ...(raw.settings || {}) },
      lectures: raw.lectures && typeof raw.lectures === "object" ? raw.lectures : {},
      courses: raw.courses && typeof raw.courses === "object" ? raw.courses : {},
      progress: raw.progress && typeof raw.progress === "object" ? raw.progress : {},
      bookmarks: Array.isArray(raw.bookmarks) ? raw.bookmarks : [],
      activity: raw.activity && typeof raw.activity === "object" ? raw.activity : {},
      meta: { ...base.meta, ...(raw.meta || {}) }
    };
  };

  const listeners = new Set();
  let loadPromise = null;
  let saveTimer = 0;
  let suppressStorageEvent = false;
  let pendingResolvers = [];

  const store = {
    db: normalizeDb(null),
    ready: false,

    async init() {
      if (loadPromise) return loadPromise;
      loadPromise = (async () => {
        try {
          const result = await chrome.storage.local.get(STORAGE_KEY);
          this.db = normalizeDb(result[STORAGE_KEY]);
          this.db.settings = this.applySettingsDefaults(this.db.settings);
        } catch (error) {
          console.warn("[Study Kit] Could not load local data", error);
          this.db = emptyDb();
        }
        this.ready = true;
        this.emit("ready", this.db);
        return this.db;
      })();
      return loadPromise;
    },

    applySettingsDefaults(settings) {
      return { ...NT.DEFAULT_SETTINGS, ...(settings || {}) };
    },

    on(event, handler) {
      if (typeof event === "function") {
        handler = event;
        event = "*";
      }
      if (typeof handler !== "function") {
        console.warn("[Study Kit] Ignored non-function store listener", event, handler);
        return () => {};
      }
      const entry = { event: event || "*", handler };
      listeners.add(entry);
      return () => listeners.delete(entry);
    },

    emit(event, payload) {
      listeners.forEach(({ event: wanted, handler }) => {
        if (wanted !== "*" && wanted !== event) return;
        try {
          handler(event, payload, this.db);
        } catch (error) {
          console.warn("[Study Kit] store listener failed", error);
        }
      });
    },

    get settings() {
      return this.db.settings;
    },

    updateSettings(partial) {
      this.db.settings = this.applySettingsDefaults({ ...this.db.settings, ...partial });
      this.save();
      this.emit("settings", this.db.settings);
      return this.db.settings;
    },

    resetSettings() {
      this.db.settings = { ...NT.DEFAULT_SETTINGS };
      this.save();
      this.emit("settings", this.db.settings);
      return this.db.settings;
    },

    save() {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => this.flush(), 320);
    },

    async flush() {
      clearTimeout(saveTimer);
      saveTimer = 0;
      if (!this.ready) return;
      this.db._savedAt = Date.now();
      this.db._rev = NT.util.uid("rev");
      const snapshot = JSON.parse(JSON.stringify(this.db));
      suppressStorageEvent = true;
      try {
        await chrome.storage.local.set({ [STORAGE_KEY]: snapshot });
      } catch (error) {
        console.warn("[Study Kit] Could not save data", error);
      } finally {
        setTimeout(() => {
          suppressStorageEvent = false;
        }, 80);
      }
      const resolvers = pendingResolvers;
      pendingResolvers = [];
      resolvers.forEach((resolve) => resolve());
    },

    async flushNow() {
      const result = this.flush();
      if (saveTimer) {
        return new Promise((resolve) => {
          pendingResolvers.push(resolve);
          result;
        });
      }
      return result;
    },

    async replaceDb(next) {
      this.db = normalizeDb(next);
      await this.flush();
      this.emit("reload", this.db);
    },

    emitChange(type, payload) {
      this.save();
      this.emit("change", { type, payload, db: this.db });
    },

    /* ---------------- courses + lectures ---------------- */

    upsertCourse(course) {
      if (!course || !course.id) return null;
      const id = String(course.id);
      const previous = this.db.courses[id] || {};
      const next = {
        ...previous,
        ...course,
        id,
        updatedAt: Date.now(),
        lectureIds: course.lectureIds || previous.lectureIds || []
      };
      this.db.courses[id] = next;
      this.emitChange("course", next);
      return next;
    },

    upsertLecture(lecture) {
      if (!lecture || !lecture.id) return null;
      const id = String(lecture.id);
      const previous = this.db.lectures[id] || {};
      const next = {
        ...previous,
        ...lecture,
        id,
        courseId: String(lecture.courseId || previous.courseId || ""),
        updatedAt: Date.now()
      };
      this.db.lectures[id] = next;
      this.emitChange("lecture", next);
      return next;
    },

    indexCourse(course, lectures) {
      if (!course || !course.id) return { course: null, lectures: [] };
      const id = String(course.id);
      const lectureIds = [];
      (lectures || []).forEach((lecture) => {
        if (!lecture || !lecture.id) return;
        const lectureId = String(lecture.id);
        this.db.lectures[lectureId] = {
          ...(this.db.lectures[lectureId] || {}),
          ...lecture,
          id: lectureId,
          courseId: id,
          courseTitle: lecture.courseTitle || course.title || "",
          updatedAt: Date.now()
        };
        lectureIds.push(lectureId);
      });
      const previous = this.db.courses[id] || {};
      this.db.courses[id] = {
        ...previous,
        ...course,
        id,
        lectureIds: Array.from(new Set(lectureIds)),
        updatedAt: Date.now(),
        syncedAt: course.syncedAt || Date.now()
      };
      this.emitChange("index", { course: this.db.courses[id], lectures });
      return { course: this.db.courses[id], lectures };
    },

    getCourse(courseId) {
      return this.db.courses[String(courseId)] || null;
    },

    getLecture(contentId) {
      return this.db.lectures[String(contentId)] || null;
    },

    getCourseLectures(courseId) {
      const course = this.getCourse(courseId);
      if (!course) return [];
      return (course.lectureIds || [])
        .map((id) => this.db.lectures[id])
        .filter(Boolean)
        .sort((a, b) => (a.order || 0) - (b.order || 0));
    },

    allLectures() {
      return Object.values(this.db.lectures);
    },

    allCourses() {
      return Object.values(this.db.courses).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    },

    findLectureByTitle(title, courseId) {
      const normalized = NT.util.normalizeText(title);
      if (!normalized) return null;
      const list = courseId ? this.getCourseLectures(courseId) : this.allLectures();
      return (
        list.find((lecture) => NT.util.normalizeText(lecture.title) === normalized) || null
      );
    },

    /* ---------------- progress ---------------- */

    getProgress(contentId) {
      return this.db.progress[String(contentId)] || null;
    },

    setProgress(contentId, patch, opts = {}) {
      if (!contentId) return null;
      const id = String(contentId);
      const lecture = this.getLecture(id) || {};
      const previous = this.db.progress[id] || {
        contentId: id,
        position: 0,
        duration: 0,
        percent: 0,
        completed: false,
        manualDone: false,
        watchTime: 0,
        createdAt: Date.now()
      };
      const next = {
        ...previous,
        ...patch,
        contentId: id,
        lectureTitle: lecture.title || previous.lectureTitle || "",
        courseId: lecture.courseId || previous.courseId || "",
        updatedAt: Date.now(),
        lastWatchedAt: patch.lastWatchedAt || previous.lastWatchedAt || 0
      };
      const duration = Number(next.duration) || 0;
      const position = Math.max(0, Number(next.position) || 0);
      if (duration > 0) {
        next.percent = NT.util.clamp((position / duration) * 100, 0, 100);
      } else {
        next.percent = NT.util.clamp(next.percent || 0, 0, 100);
      }
      if (next.completed || next.manualDone) {
        next.completed = true;
      }
      this.db.progress[id] = next;
      this.db.meta.lastLectureId = id;
      if (opts.silent !== true) this.emitChange("progress", next);
      else this.save();
      return next;
    },

    touchProgress(contentId, position, duration, opts = {}) {
      const id = String(contentId);
      if (!id) return null;
      const settings = this.db.settings;
      const previous = this.db.progress[id] || {};
      const percent = duration > 0 ? (position / duration) * 100 : previous.percent || 0;
      const threshold = Number(settings.autoCompleteAt) || 92;
      const autoDone =
        settings.autoComplete && duration > 30 && percent >= threshold ? true : previous.completed;
      return this.setProgress(
        id,
        {
          position,
          duration,
          completed: autoDone,
          lastWatchedAt: Date.now(),
          completedAt: autoDone && !previous.completed ? Date.now() : previous.completedAt || 0
        },
        opts
      );
    },

    toggleDone(contentId) {
      const id = String(contentId);
      const previous = this.db.progress[id] || { position: 0, duration: 0, percent: 0 };
      const done = !(previous.completed || previous.manualDone);
      const next = this.setProgress(id, {
        completed: done,
        manualDone: done,
        completedAt: done ? Date.now() : 0,
        lastWatchedAt: previous.lastWatchedAt || Date.now()
      });
      this.emit("done", { contentId: id, done, progress: next });
      return next;
    },

    markDone(contentId, done = true) {
      const id = String(contentId);
      return this.setProgress(id, {
        completed: Boolean(done),
        manualDone: Boolean(done),
        completedAt: done ? Date.now() : 0
      });
    },

    isDone(contentId) {
      const progress = this.getProgress(contentId);
      return Boolean(progress && (progress.completed || progress.manualDone));
    },

    getInProgress(limit = 20) {
      return Object.values(this.db.progress)
        .filter((item) => item.lastWatchedAt && !item.completed && (item.percent || 0) > 1)
        .sort((a, b) => (b.lastWatchedAt || 0) - (a.lastWatchedAt || 0))
        .slice(0, limit);
    },

    getContinueItem() {
      const items = this.getInProgress(30);
      return items[0] || null;
    },

    addWatchTime(seconds) {
      const value = Math.max(0, Math.min(300, Number(seconds) || 0));
      if (!value) return;
      const key = NT.util.dayKey();
      this.db.activity[key] = (Number(this.db.activity[key]) || 0) + value;
      this.db.meta.totalWatchTime = (Number(this.db.meta.totalWatchTime) || 0) + value;
      this.save();
      this.emit("watchtime", { key, seconds: value });
    },

    getWatchTotal() {
      return Number(this.db.meta.totalWatchTime) || 0;
    },

    getStreak() {
      const days = new Set(
        Object.entries(this.db.activity)
          .filter(([, seconds]) => Number(seconds) >= 60)
          .map(([day]) => day)
      );
      if (!days.size) return 0;
      const cursor = new Date();
      let streak = 0;
      // A streak may still be alive if today has not been studied yet.
      if (!days.has(NT.util.dayKey(cursor))) cursor.setDate(cursor.getDate() - 1);
      while (days.has(NT.util.dayKey(cursor))) {
        streak += 1;
        cursor.setDate(cursor.getDate() - 1);
      }
      return streak;
    },

    /* ---------------- bookmarks ---------------- */

    getBookmarks(lectureId) {
      const all = this.db.bookmarks
        .filter((bookmark) => !lectureId || String(bookmark.lectureId) === String(lectureId))
        .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      return all;
    },

    getLectureBookmarks(lectureId) {
      return this.db.bookmarks
        .filter((bookmark) => String(bookmark.lectureId) === String(lectureId))
        .sort((a, b) => (Number(a.seconds) || 0) - (Number(b.seconds) || 0));
    },

    getBookmark(id) {
      return this.db.bookmarks.find((bookmark) => bookmark.id === id) || null;
    },

    upsertBookmark(bookmark) {
      if (!bookmark) return null;
      const lectureId = String(bookmark.lectureId || "");
      const siteId = bookmark.siteId ? String(bookmark.siteId) : "";
      let index = -1;
      if (bookmark.id) index = this.db.bookmarks.findIndex((item) => item.id === bookmark.id);
      if (index < 0 && siteId) {
        index = this.db.bookmarks.findIndex(
          (item) => String(item.siteId || "") === siteId && String(item.lectureId) === lectureId
        );
      }
      const lecture = this.getLecture(lectureId) || {};
      const course = this.getCourse(bookmark.courseId || lecture.courseId) || {};
      const next = {
        id: bookmark.id || NT.util.uid("bm"),
        lectureId,
        courseId: String(bookmark.courseId || lecture.courseId || ""),
        lectureTitle: bookmark.lectureTitle || lecture.title || "",
        courseTitle: bookmark.courseTitle || course.title || lecture.courseTitle || "",
        seconds: Math.max(0, Math.floor(Number(bookmark.seconds) || 0)),
        note: String(bookmark.note || "").trim(),
        siteId,
        remote: Boolean(bookmark.remote),
        createdAt: bookmark.createdAt || Date.now(),
        updatedAt: Date.now()
      };
      if (index >= 0) this.db.bookmarks[index] = { ...this.db.bookmarks[index], ...next };
      else this.db.bookmarks.push(next);
      this.emitChange("bookmark", next);
      return next;
    },

    removeBookmark(id) {
      const index = this.db.bookmarks.findIndex((item) => item.id === id);
      if (index < 0) return null;
      const [removed] = this.db.bookmarks.splice(index, 1);
      this.emitChange("bookmark-removed", removed);
      return removed;
    },

    syncSiteBookmarks(lectureId, siteBookmarks, meta = {}) {
      const id = String(lectureId);
      const remoteItems = (siteBookmarks || []).map((item) => {
        const seconds = Number(item.at_seconds || item.seconds || item.time || 0);
        return {
          siteId: String(item.id || item.bookmark_id || ""),
          lectureId: id,
          courseId: String(meta.courseId || ""),
          lectureTitle: meta.lectureTitle || "",
          courseTitle: meta.courseTitle || "",
          seconds: Number.isFinite(seconds) ? seconds : 0,
          note: String(item.info || item.title || item.note || "").trim(),
          remote: true,
          createdAt: Number(item.created_at || 0) * (String(item.created_at || "").length <= 10 ? 1000 : 1) || Date.now()
        };
      });
      const remoteIds = new Set(remoteItems.map((item) => item.siteId).filter(Boolean));
      // Remove mirrored remote bookmarks that no longer exist on the site.
      this.db.bookmarks = this.db.bookmarks.filter((bookmark) => {
        if (String(bookmark.lectureId) !== id) return true;
        if (!bookmark.remote || !bookmark.siteId) return true;
        return remoteIds.has(String(bookmark.siteId));
      });
      remoteItems.forEach((item) => {
        if (item.siteId) this.upsertBookmark(item);
      });
      this.emitChange("bookmarks-sync", { lectureId: id, count: remoteItems.length });
    },

    bookmarkCount(lectureId) {
      return this.getLectureBookmarks(lectureId).length;
    },

    /* ---------------- stats ---------------- */

    stats() {
      const progress = Object.values(this.db.progress);
      const done = progress.filter((item) => item.completed || item.manualDone).length;
      const inProgress = progress.filter(
        (item) => !item.completed && (item.percent || 0) > 1
      ).length;
      const watchTotal = this.getWatchTotal();
      return {
        lectures: Object.keys(this.db.lectures).length,
        courses: Object.keys(this.db.courses).length,
        done,
        inProgress,
        bookmarks: this.db.bookmarks.length,
        watchTime: watchTotal,
        streak: this.getStreak(),
        lastSync: Number(this.db.meta.lastSync) || 0
      };
    },

    getRecent(limit = 8) {
      return Object.values(this.db.progress)
        .filter((item) => item.lastWatchedAt)
        .sort((a, b) => (b.lastWatchedAt || 0) - (a.lastWatchedAt || 0))
        .slice(0, limit)
        .map((progress) => ({
          progress,
          lecture: this.getLecture(progress.contentId) || {
            id: progress.contentId,
            title: progress.lectureTitle || "Lecture",
            courseId: progress.courseId || "",
            courseTitle: ""
          }
        }));
    },

    clearProgress() {
      this.db.progress = {};
      this.db.meta.lastLectureId = null;
      this.save();
      this.emit("reload", this.db);
    },

    clearBookmarks() {
      this.db.bookmarks = [];
      this.save();
      this.emit("reload", this.db);
    },

    clearAll() {
      this.db = emptyDb();
      this.save();
      this.emit("reload", this.db);
    },

    exportData() {
      return {
        app: "Next Toppers Study Kit",
        version: NT.VERSION,
        exportedAt: new Date().toISOString(),
        data: this.db
      };
    },

    async importData(payload) {
      const raw = payload && payload.data ? payload.data : payload;
      if (!raw || typeof raw !== "object") throw new Error("This file does not look like a Study Kit backup.");
      this.db = normalizeDb(raw);
      this.db.settings = this.applySettingsDefaults(this.db.settings);
      await this.flush();
      this.emit("reload", this.db);
      return this.db;
    }
  };

  NT.store = store;

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes[STORAGE_KEY] || suppressStorageEvent) return;
    const next = changes[STORAGE_KEY].newValue;
    if (!next) return;
    store.db = normalizeDb(next);
    store.emit("external", store.db);
  });

  window.addEventListener("pagehide", () => {
    if (store.ready) store.flush();
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden" && store.ready) store.flush();
  });
})();
