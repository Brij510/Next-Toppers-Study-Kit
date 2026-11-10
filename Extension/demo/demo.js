/* Next Toppers Study Kit — demo harness bootstrap.
 *
 * This file only exists so the extension UI can be previewed and screenshotted
 * without a Next Toppers login. It seeds realistic local data, mocks the
 * page-world player bridge, and opens a requested view from the query string.
 *
 *   ?view=home|courses|course|lectures|bookmarks|activity|settings
 *   ?view=dock|composer|resume|search
 *   ?course=101  ?lecture=1004  ?q=lens
 *   ?seed=1  (reset demo data)  ?empty=1  (start from zero)  ?hub=0
 */
(() => {
  "use strict";

  const NT = globalThis.NT;
  const store = NT.store;
  const params = new URLSearchParams(location.search);
  const VIEW = String(params.get("view") || "home").toLowerCase();
  const DAY = 86400000;
  const HOUR = 3600000;
  const base = Date.now();

  /* ------------------------------------------------------------------ seed */

  const courses = [
    {
      id: "101",
      title: "Udaan 2026 — Complete Foundation",
      slug: "udaan-2026",
      educator: "Next Toppers Faculty",
      description:
        "A complete Class 10 foundation batch — Physics, Chemistry, Maths and Biology with mentored practice.",
      courseType: "batch",
      isPurchased: true,
      purchasedAt: base - 118 * DAY,
      validity: "2026-03-31"
    },
    {
      id: "201",
      title: "Prayas 2026 — Board + JEE",
      slug: "prayas-2026",
      educator: "Next Toppers Faculty",
      description: "Class 12 boards and JEE Main in one guided schedule.",
      courseType: "batch",
      isPurchased: true,
      purchasedAt: base - 96 * DAY,
      validity: "2026-04-15"
    },
    {
      id: "301",
      title: "Arjuna JEE 2026 — Crash Course",
      slug: "arjuna-jee-2026",
      educator: "Next Toppers Faculty",
      description: "High-yield revision, problem sets and mock tests for JEE Main.",
      courseType: "batch",
      isPurchased: true,
      purchasedAt: base - 41 * DAY,
      validity: "2026-01-31"
    }
  ];

  const lectureDefs = [
    ["1001", "101", "Light — Reflection and Refraction", "Physics · Light", 52, true],
    ["1002", "101", "Light — Spherical Mirrors & Sign Convention", "Physics · Light", 46, true],
    ["1003", "101", "Light — Refraction through a Prism", "Physics · Light", 38, false],
    ["1004", "101", "Light — Lenses and Power", "Physics · Light", 54, false],
    ["1005", "101", "Chemical Reactions — Balancing Equations", "Chemistry · Reactions", 44, false],
    ["1006", "101", "Acids, Bases and Salts", "Chemistry · Reactions", 49, false],
    ["1007", "101", "Real Numbers — Euclid's Lemma", "Maths · Real Numbers", 40, true],
    ["1008", "101", "Polynomials — Zeroes and Graphs", "Maths · Real Numbers", 43, false],
    ["1009", "101", "Life Processes — Nutrition", "Biology · Life Processes", 50, false],
    ["1010", "101", "Life Processes — Respiration", "Biology · Life Processes", 47, false],
    ["2001", "201", "Electrostatics — Coulomb's Law", "Physics · Electrostatics", 60, true],
    ["2002", "201", "Electrostatics — Gauss's Theorem", "Physics · Electrostatics", 57, true],
    ["2003", "201", "Current Electricity — Drift Velocity", "Physics · Current", 55, false],
    ["2004", "201", "Moving Charges — Biot–Savart Law", "Physics · Magnetism", 58, false],
    ["2005", "201", "Ray Optics — Mirror Formula", "Physics · Optics", 53, false],
    ["2006", "201", "Wave Optics — Young's Double Slit", "Physics · Optics", 51, false],
    ["2007", "201", "Thermodynamics — First Law", "Chemistry · Thermodynamics", 54, false],
    ["3001", "301", "Vectors — Resolution & Components", "Physics · Mechanics", 30, true],
    ["3002", "301", "Kinematics — Relative Motion", "Physics · Mechanics", 34, false],
    ["3003", "301", "Laws of Motion — Friction", "Physics · Mechanics", 36, false],
    ["3004", "301", "Work, Power & Energy", "Physics · Mechanics", 33, false],
    ["3005", "301", "Rotational Motion — Moment of Inertia", "Physics · Mechanics", 37, false]
  ];

  const seedDb = () => {
    const lectures = {};
    const lectureIds = { 101: [], 201: [], 301: [] };
    const courseById = Object.fromEntries(courses.map((course) => [course.id, course]));

    lectureDefs.forEach(([id, courseId, title, folderTitle, minutes, done], index) => {
      const duration = minutes * 60;
      lectures[id] = {
        id,
        playId: id,
        videoId: `video_${id}`,
        courseId,
        courseTitle: courseById[courseId].title,
        title,
        thumbnail: "",
        type: "file",
        fileType: 1,
        videoType: "3",
        isDrm: false,
        isFree: index < 2,
        isLive: false,
        duration,
        playable: true,
        folderId: `f_${folderTitle.replace(/[^a-z0-9]+/gi, "_").toLowerCase()}`,
        folderTitle,
        order: lectureIds[courseId].length + 1,
        description: "",
        siteDone: Boolean(done),
        updatedAt: base - 3 * DAY
      };
      lectureIds[courseId].push(id);
    });

    const progress = {};
    const addProgress = (lectureId, ratio, options = {}) => {
      const lecture = lectures[lectureId];
      if (!lecture) return;
      const done = Boolean(options.done);
      const position = done ? lecture.duration : Math.round(lecture.duration * ratio);
      const lastWatchedAt = base - (options.ago || 0);
      progress[lectureId] = {
        contentId: lectureId,
        position,
        duration: lecture.duration,
        percent: done ? 100 : Number(((position / lecture.duration) * 100).toFixed(1)),
        completed: done,
        manualDone: done,
        siteCompleted: done,
        watchTime: Math.round(position * 1.08),
        createdAt: base - 120 * DAY,
        updatedAt: lastWatchedAt,
        lastWatchedAt,
        lectureTitle: lecture.title,
        courseId: lecture.courseId,
        completedAt: done ? lastWatchedAt : 0
      };
    };

    addProgress("1001", 1, { done: true, ago: 3 * DAY });
    addProgress("1002", 1, { done: true, ago: 2 * DAY + 4 * HOUR });
    addProgress("1003", 0.45, { ago: 6 * HOUR });
    addProgress("1004", 0.568, { ago: 38 * 60000 });
    addProgress("1005", 0.12, { ago: DAY + 2 * HOUR });
    addProgress("1007", 1, { done: true, ago: 5 * DAY });
    addProgress("2001", 1, { done: true, ago: 4 * DAY });
    addProgress("2002", 1, { done: true, ago: 7 * DAY });
    addProgress("2003", 0.71, { ago: 2 * DAY + 6 * HOUR });
    addProgress("3001", 1, { done: true, ago: 9 * DAY });
    addProgress("3002", 0.23, { ago: 3 * DAY });

    const bookmarks = [
      {
        id: "bm_demo_1",
        lectureId: "1004",
        courseId: "101",
        lectureTitle: "Light — Lenses and Power",
        courseTitle: "Udaan 2026 — Complete Foundation",
        seconds: 312,
        note: "Mnemonic for mirror signs — write it on the first page",
        siteId: "site_bm_1",
        remote: true,
        createdAt: base - 34 * 60000,
        updatedAt: base - 34 * 60000
      },
      {
        id: "bm_demo_2",
        lectureId: "1004",
        courseId: "101",
        lectureTitle: "Light — Lenses and Power",
        courseTitle: "Udaan 2026 — Complete Foundation",
        seconds: 960,
        note: "Revise this ray diagram before the test",
        siteId: "site_bm_2",
        remote: true,
        createdAt: base - 2 * HOUR,
        updatedAt: base - 2 * HOUR
      },
      {
        id: "bm_demo_3",
        lectureId: "1004",
        courseId: "101",
        lectureTitle: "Light — Lenses and Power",
        courseTitle: "Udaan 2026 — Complete Foundation",
        seconds: 1780,
        note: "Lens formula: 1/v − 1/u = 1/f",
        siteId: "",
        remote: false,
        createdAt: base - 5 * HOUR,
        updatedAt: base - 5 * HOUR
      },
      {
        id: "bm_demo_4",
        lectureId: "1003",
        courseId: "101",
        lectureTitle: "Light — Refraction through a Prism",
        courseTitle: "Udaan 2026 — Complete Foundation",
        seconds: 540,
        note: "Prism derivation — draw once more from memory",
        siteId: "site_bm_3",
        remote: true,
        createdAt: base - DAY,
        updatedAt: base - DAY
      },
      {
        id: "bm_demo_5",
        lectureId: "1001",
        courseId: "101",
        lectureTitle: "Light — Reflection and Refraction",
        courseTitle: "Udaan 2026 — Complete Foundation",
        seconds: 1280,
        note: "Laws of reflection — quick recap",
        siteId: "",
        remote: false,
        createdAt: base - 2 * DAY,
        updatedAt: base - 2 * DAY
      },
      {
        id: "bm_demo_6",
        lectureId: "2003",
        courseId: "201",
        lectureTitle: "Current Electricity — Drift Velocity",
        courseTitle: "Prayas 2026 — Board + JEE",
        seconds: 420,
        note: "Drift velocity numerical — redo without looking",
        siteId: "site_bm_4",
        remote: true,
        createdAt: base - 3 * DAY,
        updatedAt: base - 3 * DAY
      },
      {
        id: "bm_demo_7",
        lectureId: "3002",
        courseId: "301",
        lectureTitle: "Kinematics — Relative Motion",
        courseTitle: "Arjuna JEE 2026 — Crash Course",
        seconds: 1560,
        note: "River-boat problem shortcut",
        siteId: "",
        remote: false,
        createdAt: base - 5 * DAY,
        updatedAt: base - 5 * DAY
      }
    ];

    const dayKey = (offset) => {
      const date = new Date();
      date.setHours(12, 0, 0, 0);
      date.setDate(date.getDate() + offset);
      return NT.util.dayKey(date);
    };

    const activity = {
      [dayKey(0)]: 2640,
      [dayKey(-1)]: 4320,
      [dayKey(-2)]: 3180,
      [dayKey(-3)]: 5460,
      [dayKey(-4)]: 1920,
      [dayKey(-5)]: 3780,
      [dayKey(-7)]: 2460,
      [dayKey(-8)]: 4080,
      [dayKey(-9)]: 1740,
      [dayKey(-11)]: 2940,
      [dayKey(-12)]: 3660,
      [dayKey(-14)]: 2280,
      [dayKey(-16)]: 4560,
      [dayKey(-18)]: 1980,
      [dayKey(-21)]: 3240,
      [dayKey(-24)]: 2820,
      [dayKey(-28)]: 3900,
      [dayKey(-31)]: 2160,
      [dayKey(-36)]: 3360,
      [dayKey(-40)]: 2520,
      [dayKey(-46)]: 4140,
      [dayKey(-52)]: 1860,
      [dayKey(-58)]: 3060
    };
    const totalWatchTime = Object.values(activity).reduce((sum, seconds) => sum + seconds, 0);

    return {
      _rev: NT.util.uid("rev"),
      _savedAt: 0,
      settings: { ...NT.DEFAULT_SETTINGS, lastSeenVersion: NT.VERSION },
      courses: Object.fromEntries(
        courses.map((course) => [
          course.id,
          {
            ...course,
            courseId: course.id,
            thumbnail: "",
            lectureIds: lectureIds[course.id],
            syncedAt: base - 2 * HOUR,
            updatedAt: base - 2 * HOUR
          }
        ])
      ),
      lectures,
      progress,
      bookmarks,
      activity,
      meta: {
        schema: 1,
        lastSync: base - 2 * HOUR,
        totalWatchTime,
        created: base - 120 * DAY,
        lastLectureId: "1004"
      }
    };
  };

  const seedKey = "ntdb";
  const wantsEmpty = params.get("empty") === "1";
  const wantsFresh = wantsEmpty || params.get("seed") === "1";
  if (wantsFresh || !localStorage.getItem(seedKey)) {
    const next = wantsEmpty
      ? {
          _rev: NT.util.uid("rev"),
          _savedAt: 0,
          settings: { ...NT.DEFAULT_SETTINGS, lastSeenVersion: NT.VERSION },
          courses: {},
          lectures: {},
          progress: {},
          bookmarks: [],
          activity: {},
          meta: {
            schema: 1,
            lastSync: 0,
            totalWatchTime: 0,
            created: base,
            lastLectureId: null
          }
        }
      : seedDb();
    localStorage.setItem(seedKey, JSON.stringify(next));
  }

  try {
    if (!localStorage.getItem("cred")) {
      localStorage.setItem(
        "cred",
        JSON.stringify({
          user_id: "demo-user-42",
          id: "demo-user-42",
          name: "Aarav Sharma",
          email: "aarav.sharma@example.com"
        })
      );
      localStorage.setItem("user_id", "demo-user-42");
    }
  } catch (_) {}

  /* --------------------------------------------------------- demo API stubs */

  NT.sync.syncLecture = async () => null;
  NT.sync.autoIndexCourse = async () => null;
  NT.sync.indexCourse = async (courseId) => store.getCourse(courseId);
  NT.sync.refreshCourses = async () => store.allCourses();
  NT.sync.syncAll = async () => {
    NT.ui.toast("Demo mode — your sample courses are already here.", { type: "info" });
    return { courses: courses.length, lectures: lectureDefs.length };
  };
  NT.api.addBookmark = async () => ({ id: `site_demo_${Date.now().toString(36)}` });
  NT.api.deleteBookmark = async () => ({ success: true });
  NT.api.heartbeat = async () => ({ success: true });

  /* ------------------------------------------------------------ player mock */

  const playerModes = ["dock", "composer", "resume"];
  const wantsPlayer = playerModes.includes(VIEW) || params.get("player") === "1";
  let demoRoute = { contentId: "1004", courseId: "101", path: "/play/1004-101" };
  const initialLectureId = String(params.get("lecture") || "1004");

  const mock = {
    time: 0,
    duration: 3240,
    paused: true,
    volume: 0.8,
    muted: false,
    rate: 1,
    isLive: false,
    ready: true,
    kind: "videojs"
  };

  const readMockState = () => ({
    ready: true,
    kind: "videojs",
    time: mock.time,
    duration: mock.duration,
    paused: mock.paused,
    ended: false,
    rate: mock.rate,
    volume: mock.volume,
    muted: mock.muted,
    seeking: false,
    isLive: mock.isLive,
    source: "",
    contentId: demoRoute.contentId,
    courseId: demoRoute.courseId
  });

  const publishState = (kind = "player-state") => {
    window.postMessage({ source: "nt-page", kind, state: readMockState() }, location.origin);
  };

  const formatTime = (seconds) => {
    const total = Math.max(0, Math.floor(Number(seconds) || 0));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return h
      ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
      : `${m}:${String(s).padStart(2, "0")}`;
  };

  const syncMockDom = () => {
    const lecture = store.getLecture(demoRoute.contentId);
    const course = store.getCourse(demoRoute.courseId);
    const title = document.querySelector(".mock-title");
    const sub = document.querySelector(".mock-sub");
    const time = document.querySelector(".vjs-time");
    const progress = document.querySelector(".vjs-progress-holder .vjs-play-progress");
    const play = document.querySelector(".vjs-play-control");
    const stage = document.querySelector(".mock-player");
    if (title && lecture) title.textContent = lecture.title;
    if (sub && lecture) {
      sub.textContent = `${course?.title || lecture.courseTitle || "Course"} · ${
        lecture.folderTitle || "Lecture"
      }`;
    }
    if (time) time.textContent = `${formatTime(mock.time)} / ${formatTime(mock.duration)}`;
    if (progress) {
      progress.style.width = `${Math.min(100, (mock.time / Math.max(1, mock.duration)) * 100)}%`;
    }
    if (play) play.textContent = mock.paused ? "▶" : "❚❚";
    if (stage) stage.classList.toggle("is-playing", !mock.paused);
  };

  const resetMock = (seconds = 0) => {
    const lecture = store.getLecture(demoRoute.contentId);
    const progress = store.getProgress(demoRoute.contentId);
    mock.duration = Number(lecture?.duration) || Number(progress?.duration) || 3000;
    mock.time = Math.max(0, Math.min(mock.duration, Number(seconds) || 0));
    mock.paused = true;
    syncMockDom();
  };

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const msg = event.data;
    if (!msg || msg.source !== "nt-kit" || msg.kind !== "command") return;
    const reply = (result) =>
      window.postMessage(
        { source: "nt-page", kind: "response", id: msg.id, ok: true, result },
        location.origin
      );

    switch (msg.action) {
      case "getState":
        reply(readMockState());
        break;
      case "seek": {
        const target = Math.max(0, Math.min(mock.duration, Number(msg.args?.seconds) || 0));
        mock.time = target;
        syncMockDom();
        publishState();
        reply(target);
        break;
      }
      case "seekBy": {
        const target = Math.max(
          0,
          Math.min(mock.duration, mock.time + (Number(msg.args?.delta) || 0))
        );
        mock.time = target;
        syncMockDom();
        publishState();
        reply(target);
        break;
      }
      case "toggle":
      case "play":
      case "pause": {
        mock.paused = msg.action === "play" ? false : msg.action === "pause" ? true : !mock.paused;
        syncMockDom();
        publishState();
        reply(mock.paused);
        break;
      }
      case "toggleMute": {
        mock.muted = !mock.muted;
        syncMockDom();
        publishState();
        reply(mock.muted);
        break;
      }
      case "setVolume": {
        mock.volume = Math.max(0, Math.min(1, Number(msg.args?.volume) || 0));
        mock.muted = mock.volume === 0;
        syncMockDom();
        publishState();
        reply(mock.volume);
        break;
      }
      case "fullscreen": {
        const node = document.querySelector(".mock-player");
        if (!document.fullscreenElement) node?.requestFullscreen?.().catch(() => {});
        else document.exitFullscreen?.().catch(() => {});
        reply(true);
        break;
      }
      default:
        reply(null);
    }
  });

  document.querySelector(".vjs-play-control")?.addEventListener("click", () => {
    mock.paused = !mock.paused;
    syncMockDom();
    publishState();
  });

  document.querySelector(".vjs-progress-holder")?.addEventListener("click", (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    mock.time = Math.round(mock.duration * ratio);
    syncMockDom();
    publishState();
  });

  setInterval(() => {
    if (mock.paused) return;
    mock.time = Math.min(mock.duration, mock.time + 1);
    syncMockDom();
    publishState();
  }, 1000);

  /* ---------------------------------------------------------- demo navigation */

  let started = false;

  const startPlayer = (options = {}) => {
    if (!NT.player) return;
    started = true;
    document.documentElement.classList.add("demo-player-mode");
    NT.ui.addStyles(["src/ui.css", "src/player.css"]);
    NT.routes.parsePlay = () => demoRoute;
    NT.ui.setTabVisible(false);
    resetMock(options.seconds ?? store.getProgress(demoRoute.contentId)?.position ?? 0);
    NT.player.init({ syncDelay: 999999 });
    setTimeout(() => publishState("player-ready"), 90);
    setTimeout(() => {
      if (options.dock) NT.player.openDock(options.dockTab || "bookmarks");
      if (options.composer) {
        NT.player.openComposer({ seconds: options.composerSeconds ?? Math.min(960, mock.time) });
      }
    }, 520);
  };

  const openLecture = (contentId, seconds = 0) => {
    const lecture = store.getLecture(contentId);
    if (!lecture) {
      NT.ui.toast("That lecture is not in the demo library.", { type: "info" });
      return;
    }
    demoRoute = {
      contentId: lecture.id,
      courseId: lecture.courseId,
      path: `/play/${lecture.id}-${lecture.courseId}`
    };
    if (!started) {
      startPlayer({ seconds });
    } else {
      resetMock(seconds || store.getProgress(lecture.id)?.position || 0);
      NT.player.init({ syncDelay: 999999 });
      setTimeout(() => publishState("player-ready"), 90);
    }
    NT.ui.toast(`Demo player · ${lecture.title}`, { type: "info" });
  };

  const nativeRouteTo = NT.ui.routeTo;
  void nativeRouteTo;
  NT.ui.routeTo = (path) => {
    const play = String(path || "").match(/\/play\/(\d+)-(\d+)/);
    if (play) {
      let seconds = 0;
      try {
        seconds = Number(new URL(path, location.origin).searchParams.get("nt_t")) || 0;
      } catch (_) {}
      openLecture(play[1], seconds);
      return;
    }
    const course = String(path || "").match(/\/courses\/(?:[^/?#]*-)?(\d+)/);
    if (course) {
      NT.hub.open({ tab: "courses" });
      setTimeout(() => NT.hub.setView("course", { courseId: course[1] }), 60);
      return;
    }
    NT.ui.toast("Demo mode keeps you on this page.", { type: "info" });
  };

  /* -------------------------------------------------------------------- boot */

  const openInitialView = () => {
    if (VIEW === "dock") {
      startPlayer({ dock: true });
      return;
    }
    if (VIEW === "composer") {
      startPlayer({ composer: true, composerSeconds: 960 });
      return;
    }
    if (VIEW === "resume") {
      if (store.settings.autoResume) {
        store.updateSettings({ autoResume: false, showResumePrompt: true });
      }
      startPlayer({ seconds: 0 });
      return;
    }
    if (VIEW === "player" || params.get("player") === "1") {
      startPlayer({ dock: params.get("dock") === "1" });
      return;
    }
    if (VIEW === "search") {
      NT.quickSearch.open();
      setTimeout(() => {
        const input = NT.ui.root?.querySelector(".nt-palette input");
        if (!input) return;
        input.value = params.get("q") || "light";
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.focus();
      }, 260);
      return;
    }
    if (params.get("hub") === "0") return;
    if (VIEW === "course") {
      NT.hub.open({ tab: "courses" });
      setTimeout(
        () => NT.hub.setView("course", { courseId: params.get("course") || "101" }),
        80
      );
      return;
    }
    if (["home", "courses", "lectures", "bookmarks", "activity", "settings"].includes(VIEW)) {
      NT.hub.open({ tab: VIEW });
      if (VIEW === "home" && params.get("q")) {
        setTimeout(() => {
          NT.quickSearch.open();
          const input = NT.ui.root?.querySelector(".nt-palette input");
          if (input) {
            input.value = params.get("q");
            input.dispatchEvent(new Event("input", { bubbles: true }));
          }
        }, 220);
      }
      return;
    }
    NT.hub.open({ tab: "home" });
  };

  const boot = async () => {
    await store.init();
    const first =
      store.getLecture(initialLectureId) || store.getLecture("1004") || store.allLectures()[0];
    if (first) {
      demoRoute = {
        contentId: first.id,
        courseId: first.courseId,
        path: `/play/${first.id}-${first.courseId}`
      };
      const progress = store.getProgress(first.id);
      resetMock(VIEW === "resume" ? 0 : progress?.position || 0);
    }
    NT.ui.mount();
    NT.ui.watchHeader();
    NT.ui.refreshHeader();
    syncMockDom();
    if (wantsPlayer) {
      document.documentElement.classList.add("demo-player-mode");
      NT.routes.parsePlay = () => demoRoute;
    }
    setTimeout(openInitialView, 120);
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
