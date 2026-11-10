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

  const freshDb = (settings) => ({
    _rev: `rev_${Date.now().toString(36)}`,
    _savedAt: 0,
    settings: { ...DEFAULTS, ...(settings || {}) },
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

  const readDb = () =>
    new Promise((resolve) => {
      chrome.storage.local.get(STORAGE_KEY, (result) => {
        const stored = result?.[STORAGE_KEY];
        db = stored && typeof stored === "object" ? stored : freshDb();
        db.settings = { ...DEFAULTS, ...(db.settings || {}) };
        resolve(db);
      });
    });

  const writeDb = () =>
    new Promise((resolve, reject) => {
      if (!db) return resolve();
      db._savedAt = Date.now();
      chrome.storage.local.set({ [STORAGE_KEY]: db }, () => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve();
      });
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
      writeDb().catch(() => toast("Could not save those settings."));
    }, 140);
  };

  const saveNow = async () => {
    flashSaving();
    clearTimeout(writeTimer);
    try {
      await writeDb();
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

  const importData = async (file) => {
    if (!file) return;
    try {
      const text = await file.text();
      const payload = JSON.parse(text);
      const raw = payload?.data && typeof payload.data === "object" ? payload.data : payload;
      if (!raw || typeof raw !== "object") throw new Error("That file does not contain Study Kit data.");
      if (!window.confirm("Replace this device's Study Kit data with this backup?")) return;
      db = freshDb({ ...(raw.settings || {}) });
      if (raw.lectures && typeof raw.lectures === "object") db.lectures = raw.lectures;
      if (raw.courses && typeof raw.courses === "object") db.courses = raw.courses;
      if (raw.progress && typeof raw.progress === "object") db.progress = raw.progress;
      if (Array.isArray(raw.bookmarks)) db.bookmarks = raw.bookmarks;
      if (raw.activity && typeof raw.activity === "object") db.activity = raw.activity;
      if (raw.meta && typeof raw.meta === "object") db.meta = { ...db.meta, ...raw.meta };
      await writeDb();
      fillForm();
      toast("Backup imported.");
    } catch (error) {
      toast(error.message || "Could not import that backup.");
    }
  };

  const clearProgress = async () => {
    if (!window.confirm("Reset playback positions, completion and watch time? Timestamps stay.")) return;
    db.progress = {};
    db.activity = {};
    db.meta.totalWatchTime = 0;
    db.meta.lastLectureId = null;
    await writeDb();
    fillForm();
    toast("Progress cleared.");
  };

  const clearBookmarks = async () => {
    if (!window.confirm("Remove every local timestamp and note?")) return;
    db.bookmarks = [];
    await writeDb();
    fillForm();
    toast("Timestamps cleared.");
  };

  const clearAll = async () => {
    if (!window.confirm("Erase all Study Kit data on this device? This cannot be undone.")) return;
    const settings = { ...db.settings };
    db = freshDb(settings);
    await writeDb();
    fillForm();
    toast("Study Kit data erased.");
  };

  const resetSettings = async () => {
    if (!window.confirm("Reset preferences to defaults? Your data stays.")) return;
    db.settings = { ...DEFAULTS };
    await writeDb();
    fillForm();
    toast("Settings reset.");
  };

  /* ------------------------------------------------------------------ wire */

  document.addEventListener("DOMContentLoaded", async () => {
    await readDb();
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
})();
