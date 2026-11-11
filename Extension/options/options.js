/* Next Toppers Study Kit — options page. */
(() => {
  "use strict";

  const STORAGE_KEY = "ntdb";
  const DEFAULTS = globalThis.NT?.DEFAULT_SETTINGS || {
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

  const $ = (selector) => document.querySelector(selector);
  let db = null;
  let writeTimer = 0;
  let flashTimer = 0;
  let toastTimer = 0;
  let writeChain = Promise.resolve();

  const sanitizeSettings = (settings) =>
    NT.sanitize ? NT.sanitize.settings(settings) : { ...DEFAULTS, ...(settings || {}) };

  const freshDb = (settings) => ({
    _rev: NT.util.uid("rev"),
    _savedAt: 0,
    settings: sanitizeSettings(settings),
    lectures: {},
    courses: {},
    progress: {},
    bookmarks: [],
    activity: {},
    meta: {
      schema: 1,
      lastSync: 0,
      totalWatchTime: 0,
      created: Date.now(),
      lastLectureId: null
    }
  });

  const normaliseStored = (stored) => {
    const base = freshDb();
    if (!stored || typeof stored !== "object") return base;
    const clean = NT.sanitize ? NT.sanitize.db(stored) : stored;
    return {
      ...base,
      ...clean,
      _rev: clean._rev || base._rev,
      settings: { ...base.settings, ...(clean.settings || {}) },
      meta: {
        ...base.meta,
        ...(clean.meta || {}),
        created: clean.meta?.created || base.meta.created
      }
    };
  };

  const readStored = () =>
    new Promise((resolve) => {
      chrome.storage.local.get(STORAGE_KEY, (result) => {
        resolve(normaliseStored(result?.[STORAGE_KEY]));
      });
    });

  const persist = (next) =>
    new Promise((resolve, reject) => {
      next._savedAt = Date.now();
      next._rev = NT.util.uid("rev");
      chrome.storage.local.set({ [STORAGE_KEY]: next }, () => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve();
      });
    });

  // Serialise writes and always start from the latest stored snapshot. The
  // old page wrote its entire page-load snapshot back, so leaving Settings
  // open while watching a lecture could erase progress saved by the site tab.
  const queueWrite = (task) => {
    const run = writeChain.then(task, task);
    writeChain = run.catch(() => {});
    return run;
  };

  const writeSettings = () =>
    queueWrite(async () => {
      const latest = await readStored();
      latest.settings = sanitizeSettings({ ...latest.settings, ...(db?.settings || {}) });
      const sent = latest.settings;
      await persist(latest);
      // A change can arrive while chrome.storage is writing. Keep it instead
      // of replacing it with the snapshot that was just persisted.
      const pending = sanitizeSettings(db?.settings || sent);
      const changed = JSON.stringify(pending) !== JSON.stringify(sent);
      db = latest;
      renderSummary();
      if (changed) {
        db.settings = pending;
        save();
      }
    });

  const writeData = (mutate) =>
    queueWrite(async () => {
      const latest = await readStored();
      latest.settings = sanitizeSettings({ ...latest.settings, ...(db?.settings || {}) });
      mutate(latest);
      await persist(latest);
      const pending = sanitizeSettings(db?.settings || latest.settings);
      const changed = JSON.stringify(pending) !== JSON.stringify(latest.settings);
      db = latest;
      if (changed) {
        db.settings = pending;
        save();
      }
      fillForm();
    });

  const toast = (message) => {
    const node = $("#toast");
    node.textContent = message;
    node.classList.add("is-in");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => node.classList.remove("is-in"), 2600);
  };

  const flashSaving = () => {
    const node = $("#save-state");
    node.textContent = "Saving…";
    node.classList.add("is-saving");
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => {
      node.textContent = "All changes saved";
      node.classList.remove("is-saving");
    }, 720);
  };

  const save = () => {
    flashSaving();
    clearTimeout(writeTimer);
    writeTimer = setTimeout(() => {
      writeTimer = 0;
      writeSettings().catch(() => toast("Could not save those settings."));
    }, 140);
  };

  const saveNow = async () => {
    flashSaving();
    clearTimeout(writeTimer);
    writeTimer = 0;
    try {
      await writeSettings();
    } catch (_) {
      toast("Could not save those settings.");
    }
  };

  const renderSummary = () => {
    if (!db) return;
    const progress = Object.values(db.progress || {});
    const done = progress.filter((item) => item.completed || item.manualDone).length;
    $("#sum-courses").textContent = String(Object.keys(db.courses || {}).length);
    $("#sum-lectures").textContent = String(Object.keys(db.lectures || {}).length);
    $("#sum-done").textContent = String(done);
    $("#sum-bookmarks").textContent = String((db.bookmarks || []).length);
  };

  const fillForm = () => {
    document.querySelectorAll("[data-setting]").forEach((input) => {
      const key = input.dataset.setting;
      const value = db.settings[key];
      if (input.type === "checkbox") input.checked = Boolean(value);
      else input.value = String(value ?? "");
    });
    const range = $('[data-setting="autoCompleteAt"]');
    $("#range-output").textContent = `${range.value}%`;
    const thresholdRow = range.closest(".range-row");
    thresholdRow.style.opacity = db.settings.autoComplete ? "1" : ".55";
    range.disabled = !db.settings.autoComplete;
    renderSummary();
  };

  const settingValue = (input) => {
    if (input.type === "checkbox") return input.checked;
    if (input.type === "range") return Number(input.value);
    if (input.tagName === "SELECT") {
      const numeric = ["seekSeconds", "longSeekSeconds", "autoCompleteAt"];
      return numeric.includes(input.dataset.setting) ? Number(input.value) : input.value;
    }
    return input.value;
  };

  const onSettingChange = (input) => {
    if (!input?.dataset?.setting) return;
    if (input.type === "range") {
      $("#range-output").textContent = `${input.value}%`;
      db.settings[input.dataset.setting] = Number(input.value);
      save();
      return;
    }
    db.settings[input.dataset.setting] = settingValue(input);
    if (input.dataset.setting === "autoComplete") fillForm();
    save();
  };

  /* ------------------------------------------------------------------ data */

  const exportData = () => {
    const blob = new Blob(
      [
        JSON.stringify(
          {
            app: "Next Toppers Study Kit",
            version: chrome.runtime.getManifest().version,
            exportedAt: new Date().toISOString(),
            data: db
          },
          null,
          2
        )
      ],
      { type: "application/json" }
    );
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `next-toppers-study-kit-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    toast("Backup downloaded.");
  };

  const MAX_IMPORT_BYTES = 8 * 1024 * 1024;

  const importData = async (file) => {
    if (!file) return;
    try {
      if (file.size > MAX_IMPORT_BYTES) {
        throw new Error("That backup is too large to import.");
      }
      const text = await file.text();
      const payload = JSON.parse(text);
      const raw = payload?.data && typeof payload.data === "object" ? payload.data : payload;
      if (!raw || typeof raw !== "object") throw new Error("That file does not contain Study Kit data.");
      if (!window.confirm("Replace this device's Study Kit data with this backup?")) return;
      const clean = normaliseStored(raw);
      clean.meta.created = clean.meta.created || Date.now();
      clearTimeout(writeTimer);
      writeTimer = 0;
      await queueWrite(async () => {
        await persist(clean);
        db = clean;
      });
      fillForm();
      toast("Backup imported.");
    } catch (error) {
      toast(error.message || "Could not import that backup.");
    }
  };

  const clearProgress = async () => {
    if (!window.confirm("Reset playback positions, completion and watch time? Timestamps stay.")) return;
    clearTimeout(writeTimer);
    writeTimer = 0;
    await writeData((latest) => {
      latest.progress = {};
      latest.activity = {};
      latest.meta.totalWatchTime = 0;
      latest.meta.lastLectureId = null;
    });
    toast("Progress cleared.");
  };

  const clearBookmarks = async () => {
    if (!window.confirm("Remove every local timestamp and note?")) return;
    clearTimeout(writeTimer);
    writeTimer = 0;
    await writeData((latest) => {
      latest.bookmarks = [];
    });
    toast("Timestamps cleared.");
  };

  const clearAll = async () => {
    if (!window.confirm("Erase all Study Kit data on this device? This cannot be undone.")) return;
    const clear = freshDb(db.settings);
    clearTimeout(writeTimer);
    writeTimer = 0;
    await queueWrite(async () => {
      await persist(clear);
      db = clear;
    });
    fillForm();
    toast("Study Kit data erased.");
  };

  const resetSettings = async () => {
    if (!window.confirm("Reset preferences to defaults? Your data stays.")) return;
    db.settings = sanitizeSettings({});
    await saveNow();
    fillForm();
    toast("Settings reset.");
  };

  /* ------------------------------------------------------------------ wire */

  document.addEventListener("DOMContentLoaded", async () => {
    db = await readStored();
    $("#version").textContent = `v${chrome.runtime.getManifest().version}`;
    fillForm();

    document.querySelectorAll("[data-setting]").forEach((input) => {
      if (input.type === "range") {
        input.addEventListener("input", () => onSettingChange(input));
        input.addEventListener("change", () => onSettingChange(input));
      } else {
        input.addEventListener("change", () => onSettingChange(input));
      }
    });

    $("#export-btn").addEventListener("click", exportData);
    $("#import-btn").addEventListener("click", () => $("#import-file").click());
    $("#import-file").addEventListener("change", (event) => {
      const file = event.target.files?.[0];
      event.target.value = "";
      importData(file);
    });
    $("#clear-progress").addEventListener("click", clearProgress);
    $("#clear-bookmarks").addEventListener("click", clearBookmarks);
    $("#clear-all").addEventListener("click", clearAll);
    $("#reset-settings").addEventListener("click", resetSettings);
  });

  // Keep the summary and data actions current when a site tab saves progress.
  // Local settings stay untouched so an in-progress edit is not overwritten.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes[STORAGE_KEY] || !db) return;
    const next = normaliseStored(changes[STORAGE_KEY].newValue);
    db.lectures = next.lectures;
    db.courses = next.courses;
    db.progress = next.progress;
    db.bookmarks = next.bookmarks;
    db.activity = next.activity;
    db.meta = next.meta;
    renderSummary();
  });
})();
