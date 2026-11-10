/* Next Toppers Study Kit — native light-DOM sections.
 *
 * This module is the "makeover" layer: instead of asking students to open a
 * separate overlay, it adds small native-feeling pieces to the real pages —
 * the private sidebar, the homepage, the course header and the player rail.
 * Everything is injected after React hydration and is safe to re-run. */
(() => {
  "use strict";

  const NT = globalThis.NT;
  if (NT.native) return;
  const store = NT.store;
  const api = NT.api;

  const SITE = /(^|\.)nexttoppers\.com$/i;
  const AUTO_SYNC_KEY = "nt-study-kit:auto-sync";
  const MAX_ATTEMPTS = 32;
  const RETRY_MS = 500;
  const AUTO_SYNC_AFTER = 1400;

  let mounted = false;
  let refreshTimer = 0;
  let retryTimer = 0;
  let autoSyncTimer = 0;
  let attempts = 0;
  let lastPath = "";

  const esc = NT.escape;
  const onSite = () => SITE.test(location.hostname);

  const isEnabled = () =>
    Boolean(store.settings?.enabled && store.settings?.showNativeSections);

  const make = (tag, className = "", html = "") => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (html) node.innerHTML = html;
    return node;
  };

  const nodeFor = (name) => document.querySelector(`[data-nt-native="${name}"]`);

  const remove = (name) => {
    document.querySelectorAll(`[data-nt-native="${name}"]`).forEach((node) => node.remove());
  };

  const removeAll = () => ["home", "course", "player", "sidebar"].forEach(remove);

  /* --------------------------------------------------------------- data bits */

  const profileName = () => {
    let cred = {};
    try {
      cred = NT.util.safeJSON(localStorage.getItem("cred"), {}) || {};
    } catch (_) {}
    const name =
      cred.name ||
      cred.full_name ||
      [cred.first_name, cred.last_name].filter(Boolean).join(" ") ||
      cred.username ||
      cred.user_name ||
      "";
    return String(name || "").trim();
  };

  const continueItem = () => {
    const progress = store.getContinueItem();
    if (!progress) return null;
    const lecture = store.getLecture(progress.contentId);
    if (!lecture) return null;
    return { progress, lecture, course: store.getCourse(lecture.courseId) };
  };

  const courseStats = (course) => {
    const ids = course?.lectureIds || [];
    const total = ids.length;
    let done = 0;
    let started = 0;
    let seconds = 0;
    ids.forEach((id) => {
      const progress = store.getProgress(id);
      if (progress?.completed || progress?.manualDone) done += 1;
      else if ((progress?.percent || 0) > 1) started += 1;
      if (progress?.duration) seconds += progress.duration;
    });
    return {
      total,
      done,
      started,
      percent: total ? Math.round((done / total) * 100) : 0,
      seconds
    };
  };

  const courseResume = (course) => {
    if (!course?.id) return null;
    const lectures = store.getCourseLectures(course.id);
    let latest = null;
    let firstOpen = null;
    lectures.forEach((lecture) => {
      const progress = store.getProgress(lecture.id);
      const done = store.isDone(lecture.id);
      if (done) return;
      if (!firstOpen) firstOpen = lecture;
      if (
        progress?.lastWatchedAt &&
        !done &&
        (!latest || progress.lastWatchedAt > latest.progress.lastWatchedAt)
      ) {
        latest = { lecture, progress };
      }
    });
    if (latest) return latest;
    if (firstOpen) return { lecture: firstOpen, progress: store.getProgress(firstOpen.id) || null };
    return null;
  };

  const playHref = (lecture, seconds = 0) =>
    NT.routes.playURL(lecture.playId || lecture.id, lecture.courseId, seconds);

  const syncStatus = () => {
    const state = NT.sync?.state;
    if (state?.syncing) {
      if (state.phase === "indexing" && state.total) {
        return `Indexing ${Math.min(state.current + 1, state.total)} of ${state.total} courses…`;
      }
      return state.stage || "Syncing your courses…";
    }
    if (state?.lastError) return state.lastError;
    const stats = store.stats();
    return stats.lastSync ? `Updated ${NT.util.formatRelative(stats.lastSync)}` : "";
  };

  /* --------------------------------------------------------------- actions */

  const openHub = (tab = "home") => {
    document.dispatchEvent(
      new CustomEvent("nt:open-hub", { detail: { tab, source: "native" } })
    );
  };

  const openSearch = () => {
    document.dispatchEvent(new CustomEvent("nt:open-search", { detail: { source: "native" } }));
  };

  const signIn = () => {
    const target = [...document.querySelectorAll("button, a")].find((node) => {
      const text = (node.textContent || "").replace(/\s+/g, " ").trim();
      return /^(login|log in|sign in)(\s*\/\s*register)?$/i.test(text);
    });
    if (target) {
      target.click();
      return;
    }
    NT.ui.toast("Sign in on Next Toppers to sync your courses.", { type: "info" });
  };

  const goPlay = (lecture, seconds = 0) => {
    if (!lecture) return;
    NT.ui.routeTo(playHref(lecture, seconds));
  };

  const goCourse = (courseId) => {
    const course = store.getCourse(courseId);
    if (course) {
      NT.ui.routeTo(NT.routes.courseURL(course));
      return;
    }
    const route = NT.routes.parseCourse();
    if (route) NT.ui.routeTo(route.path);
  };

  const runSyncAll = async (button) => {
    if (!api.session.loggedIn()) {
      signIn();
      return;
    }
    const previous = button?.innerHTML || "";
    if (button) {
      button.disabled = true;
      button.innerHTML = `<span class="nt-native-spinner" aria-hidden="true"></span>Syncing…`;
    }
    try {
      const result = await NT.sync.syncAll({ force: true, deep: true });
      if (result?.errors?.length) {
        NT.ui.toast(result.errors[0].message || "Some courses could not be indexed.", {
          type: "info"
        });
      } else if (result?.courses) {
        NT.ui.toast(
          `Synced ${result.courses} course${result.courses === 1 ? "" : "s"}${
            result.lectures ? ` · ${result.lectures} lectures` : ""
          }.`,
          { type: "done" }
        );
      } else {
        NT.ui.toast("No purchased courses found for this account.", { type: "info" });
      }
    } catch (error) {
      NT.ui.toast(error?.message || "Could not sync your courses.", { type: "error" });
    } finally {
      if (button) {
        button.disabled = false;
        button.innerHTML = previous;
      }
      scheduleRefresh(true);
    }
  };

  const runCourseSync = async (button, courseId) => {
    if (!courseId) return;
    if (!api.session.loggedIn()) {
      signIn();
      return;
    }
    const previous = button?.innerHTML || "";
    if (button) {
      button.disabled = true;
      button.innerHTML = `<span class="nt-native-spinner" aria-hidden="true"></span>Indexing…`;
    }
    try {
      const route = NT.routes.parseCourse();
      const course = store.getCourse(courseId);
      const onThisCourse = Boolean(route && String(route.courseId) === String(courseId));
      const parentId =
        String(course?.parentId || (onThisCourse ? route.parentId : "") || "0") || "0";
      const fallback = {
        id: String(courseId),
        title:
          course?.title || (onThisCourse ? NT.util.slugToTitle(route.slug) : `Course ${courseId}`),
        slug: course?.slug || (onThisCourse ? `${route.slug}-${courseId}` : ""),
        parentId
      };
      const result = await NT.sync.indexCourse(courseId, { force: true, parentId, fallback });
      if (result?.error) {
        NT.ui.toast(result.error, { type: "info" });
      } else if (result?.lectures) {
        NT.ui.toast(`Indexed ${result.lectures} lecture${result.lectures === 1 ? "" : "s"}.`, {
          type: "done"
        });
      } else {
        NT.ui.toast("No lectures were found in this course yet.", { type: "info" });
      }
    } catch (error) {
      NT.ui.toast(error?.message || "Could not index this course.", { type: "error" });
    } finally {
      if (button) {
        button.disabled = false;
        button.innerHTML = previous;
      }
      scheduleRefresh(true);
    }
  };

  const onClick = (event) => {
    const button = event.target?.closest?.("[data-nt-act]");
    if (!button) return;
    const act = button.dataset.ntAct;

    if (act === "hub") {
      event.preventDefault();
      openHub(button.dataset.tab || "home");
      return;
    }
    if (act === "search") {
      event.preventDefault();
      openSearch();
      return;
    }
    if (act === "signin") {
      event.preventDefault();
      signIn();
      return;
    }
    if (act === "resume") {
      event.preventDefault();
      const lecture = store.getLecture(button.dataset.lecture);
      goPlay(lecture, Number(button.dataset.seconds) || 0);
      return;
    }
    if (act === "open-course") {
      event.preventDefault();
      goCourse(button.dataset.course);
      return;
    }
    if (act === "sync-all") {
      event.preventDefault();
      void runSyncAll(button);
      return;
    }
    if (act === "sync-course") {
      event.preventDefault();
      void runCourseSync(button, button.dataset.course);
      return;
    }
    if (act === "player-bookmark") {
      event.preventDefault();
      if (NT.player?.openComposer) NT.player.openComposer();
      else NT.ui.toast("Start the lecture first, then save a timestamp.", { type: "info" });
      return;
    }
    if (act === "player-done") {
      event.preventDefault();
      const route = NT.routes.parsePlay();
      if (!route) return;
      if (NT.player?.toggleDone) NT.player.toggleDone();
      else {
        store.toggleDone(route.contentId);
        scheduleRefresh(true);
      }
      return;
    }
    if (act === "player-seek") {
      event.preventDefault();
      const seconds = Number(button.dataset.seconds) || 0;
      if (NT.player?.seeks?.seek) NT.player.seeks.seek(seconds, true);
      else NT.ui.toast("The player is still loading.", { type: "info" });
      return;
    }
    if (act === "player-panel") {
      event.preventDefault();
      if (NT.player?.openDock) NT.player.openDock("bookmarks");
      else openHub("bookmarks");
    }
  };

  const bind = (node) => {
    if (node.dataset.ntBound === "1") return node;
    node.dataset.ntBound = "1";
    node.addEventListener("click", onClick);
    return node;
  };

  /* -------------------------------------------------------------- home desk */

  const homeData = () => {
    const stats = store.stats();
    const item = continueItem();
    const loggedIn = api.session.loggedIn();
    const courses = store.allCourses();
    const sync = NT.sync?.state || {};

    if (item) {
      const percent = Math.round(item.progress?.percent || 0);
      return {
        mode: "continue",
        name: profileName(),
        stats,
        syncing: Boolean(sync.syncing),
        stage: syncStatus(),
        lecture: {
          id: item.lecture.id,
          title: item.lecture.title || "Lecture",
          courseTitle: item.course?.title || item.lecture.courseTitle || "",
          seconds: Math.floor(item.progress?.position || 0),
          percent,
          done: store.isDone(item.lecture.id)
        },
        course: null
      };
    }

    if (!loggedIn) {
      return {
        mode: "guest",
        name: profileName(),
        stats,
        syncing: Boolean(sync.syncing),
        stage: syncStatus(),
        lecture: null,
        course: null
      };
    }

    if (!courses.length) {
      return {
        mode: "empty",
        name: profileName(),
        stats,
        syncing: Boolean(sync.syncing),
        stage: syncStatus(),
        lecture: null,
        course: null
      };
    }

    // Has courses but nothing in progress. Surface the least-finished course
    // so "Start" is always one click away.
    const ranked = courses
      .map((course) => ({ course, stats: courseStats(course) }))
      .sort((a, b) => b.stats.percent - a.stats.percent || b.stats.total - a.stats.total);
    const pick = ranked.find((entry) => entry.stats.total && entry.stats.done < entry.stats.total) || ranked[0];
    return {
      mode: "ready",
      name: profileName(),
      stats,
      syncing: Boolean(sync.syncing),
      stage: syncStatus(),
      lecture: null,
      course: {
        id: pick.course.id,
        title: pick.course.title || "Your course",
        percent: pick.stats.percent,
        done: pick.stats.done,
        total: pick.stats.total
      }
    };
  };

  const renderHome = (node) => {
    const data = homeData();
    const signature = JSON.stringify(data);
    if (node.dataset.ntSig === signature) return;
    node.dataset.ntSig = signature;

    const firstName = data.name ? data.name.split(/\s+/)[0] : "";
    const greet = firstName ? `${NT.util.greeting()}, ${firstName}` : NT.util.greeting();

    let heading = "Your study desk";
    let body = "";
    let actions = "";

    if (data.mode === "continue") {
      const lecture = data.lecture;
      heading = "Continue where you left off";
      body = `
        <div class="nt-native-home-main">
          <div class="nt-native-now">
            <span class="nt-native-now-dot" aria-hidden="true"></span>
            <strong>${esc(lecture.title)}</strong>
          </div>
          ${
            lecture.courseTitle
              ? `<p class="nt-native-home-sub">${esc(lecture.courseTitle)}</p>`
              : ""
          }
          <div class="nt-native-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${
            lecture.percent
          }"><i style="width:${NT.util.clamp(lecture.percent, 0, 100)}%"></i></div>
          <p class="nt-native-home-meta">${NT.util.formatTime(lecture.seconds)} watched · ${
            lecture.percent
          }% complete</p>
        </div>`;
      actions = `
        <div class="nt-native-home-actions">
          <button class="nt-native-btn nt-native-btn-primary" type="button" data-nt-act="resume"
            data-lecture="${esc(lecture.id)}" data-seconds="${lecture.seconds}">
            ${NT.icon("play", 14)} Resume at ${NT.util.formatTime(lecture.seconds)}
          </button>
          <button class="nt-native-btn nt-native-btn-ghost" type="button" data-nt-act="search">
            ${NT.icon("search", 14)} Search lectures
          </button>
        </div>`;
    } else if (data.mode === "empty") {
      heading = `${greet} — let’s set up your desk`;
      body = `
        <div class="nt-native-home-main">
          <p class="nt-native-home-copy">Sync your purchased batches once. After that, every lecture becomes searchable and
          your progress, timestamps and resume point stay with you across the site.</p>
        </div>`;
      actions = `
        <div class="nt-native-home-actions">
          <button class="nt-native-btn nt-native-btn-primary" type="button" data-nt-act="sync-all" ${
            data.syncing ? "disabled" : ""
          }>
            ${data.syncing ? '<span class="nt-native-spinner" aria-hidden="true"></span>' : NT.icon("refresh", 14)}
            ${data.syncing ? "Syncing…" : "Sync my courses"}
          </button>
          <button class="nt-native-btn nt-native-btn-ghost" type="button" data-nt-act="hub" data-tab="courses">
            ${NT.icon("library", 14)} Open Study Kit
          </button>
        </div>`;
    } else if (data.mode === "ready") {
      const course = data.course;
      heading = course.total ? "Pick up a course" : "Your courses are ready";
      body = `
        <div class="nt-native-home-main">
          <div class="nt-native-now">
            <span class="nt-native-now-dot" aria-hidden="true"></span>
            <strong>${esc(course.title)}</strong>
          </div>
          <div class="nt-native-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${
            course.percent
          }"><i style="width:${NT.util.clamp(course.percent, 0, 100)}%"></i></div>
          <p class="nt-native-home-meta">${
            course.total
              ? `${course.done} of ${course.total} lectures complete · ${course.percent}%`
              : "Open the course once to index its lectures."
          }</p>
        </div>`;
      actions = `
        <div class="nt-native-home-actions">
          <button class="nt-native-btn nt-native-btn-primary" type="button" data-nt-act="open-course"
            data-course="${esc(course.id)}">
            ${NT.icon("arrowRight", 14)} Open course
          </button>
          <button class="nt-native-btn nt-native-btn-ghost" type="button" data-nt-act="search">
            ${NT.icon("search", 14)} Search lectures
          </button>
        </div>`;
    } else {
      heading = "Study Kit lives inside Next Toppers";
      body = `
        <div class="nt-native-home-main">
          <p class="nt-native-home-copy">Sign in to bring your batches here. You’ll get lecture search, one-click resume,
          timestamp bookmarks and progress that follows you from page to page.</p>
        </div>`;
      actions = `
        <div class="nt-native-home-actions">
          <button class="nt-native-btn nt-native-btn-primary" type="button" data-nt-act="signin">
            ${NT.icon("user", 14)} Sign in
          </button>
          <button class="nt-native-btn nt-native-btn-ghost" type="button" data-nt-act="hub" data-tab="home">
            ${NT.icon("sparkles", 14)} Preview Study Kit
          </button>
        </div>`;
    }

    const stats = data.stats;
    const chips = [];
    if (stats.done) chips.push(`${stats.done} lecture${stats.done === 1 ? "" : "s"} done`);
    if (stats.streak > 1) chips.push(`${stats.streak}-day streak`);
    if (stats.bookmarks) chips.push(`${stats.bookmarks} timestamp${stats.bookmarks === 1 ? "" : "s"}`);

    node.innerHTML = `
      <div class="nt-native-home-head">
        <div class="nt-native-brandline">
          <span class="nt-native-mark">${NT.mark(28)}</span>
          <div>
            <span class="nt-native-eyebrow">Study Kit · ${esc(greet)}</span>
            <h2 class="nt-native-home-heading">${esc(heading)}</h2>
          </div>
        </div>
        <button class="nt-native-textbtn" type="button" data-nt-act="hub" data-tab="home">
          Dashboard ${NT.icon("chevronRight", 13)}
        </button>
      </div>
      <div class="nt-native-home-body">
        ${body}
        ${actions}
      </div>
      <div class="nt-native-home-foot">
        <div class="nt-native-chips">
          ${
            chips.length
              ? chips.map((chip) => `<span class="nt-native-chip">${esc(chip)}</span>`).join("")
              : `<span class="nt-native-chip nt-native-chip-soft">Everything stays on this device</span>`
          }
        </div>
        <span class="nt-native-status">${
          data.syncing
            ? '<span class="nt-native-spinner" aria-hidden="true"></span>'
            : ""
        }${esc(data.stage || "")}</span>
      </div>`;
  };

  const injectHome = () => {
    const anchor = [...document.querySelectorAll("h1")].find((h1) =>
      /trending courses/i.test(h1.textContent || "")
    );
    const section = anchor?.parentElement;
    if (!section?.parentElement) return false;

    let node = nodeFor("home");
    if (node && !document.body.contains(node)) {
      node = null;
    }
    if (!node) {
      node = bind(make("section", "nt-native-home"));
      node.dataset.ntNative = "home";
      node.setAttribute("aria-label", "Next Toppers Study Kit");
      section.parentElement.insertBefore(node, section);
    }
    renderHome(node);
    return true;
  };

  /* ----------------------------------------------------------- private rail */

  const renderSidebar = (node) => {
    const stats = store.stats();
    const signature = JSON.stringify({ streak: stats.streak, done: stats.done });
    if (node.dataset.ntSig === signature) return;
    node.dataset.ntSig = signature;
    node.innerHTML = `
      <button class="nt-native-side-btn" type="button" data-nt-act="hub" data-tab="home">
        <span class="nt-native-side-icon">${NT.icon("sparkles", 13)}</span>
        <span class="nt-native-side-label">Study Desk</span>
        ${
          stats.streak > 1
            ? `<span class="nt-native-side-badge" title="${stats.streak}-day streak">${stats.streak}d</span>`
            : ""
        }
      </button>`;
  };

  const injectSidebar = () => {
    const anchors = [...document.querySelectorAll('a[href="/private/my-course"]')];
    // The site renders the same link in the desktop rail and the mobile sheet.
    // Prefer the one the student can actually see so the entry lands beside it.
    const anchor =
      anchors.find((node) => {
        const rect = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        return (
          rect.width > 0 &&
          rect.height > 0 &&
          style.display !== "none" &&
          style.visibility !== "hidden"
        );
      }) || anchors[0];
    if (!anchor) return false;

    let node = nodeFor("sidebar");
    if (node && !document.body.contains(node)) node = null;
    if (!node) {
      const host = anchor.closest("li") || anchor;
      const tag = host.tagName === "LI" ? "li" : "div";
      node = bind(make(tag, "nt-native-side-item"));
      node.dataset.ntNative = "sidebar";
      host.parentElement?.insertBefore(node, host.nextSibling);
    }
    if (!node.parentElement) return false;
    renderSidebar(node);
    return true;
  };

  /* ------------------------------------------------------------ course page */

  const renderCourse = (node) => {
    const route = NT.routes.parseCourse();
    if (!route) return;
    const course = store.getCourse(route.courseId);
    const stats = courseStats(course);
    const resume = courseResume(course);
    const sync = NT.sync?.state || {};
    const title = course?.title || NT.util.slugToTitle(route.slug) || "This course";
    const courseId = route.courseId;
    const activeIds = Array.isArray(sync.activeCourseIds) ? sync.activeCourseIds : [];
    const syncing =
      activeIds.includes(courseId) ||
      Boolean(sync.syncing && sync.currentCourseId === courseId);

    const data = {
      id: courseId,
      title,
      done: stats.done,
      total: stats.total,
      percent: stats.percent,
      resume: resume?.lecture?.id || "",
      resumeTitle: resume?.lecture?.title || "",
      resumeSeconds: Math.floor(resume?.progress?.position || 0),
      syncing: Boolean(sync.syncing),
      stage: syncStatus()
    };
    const signature = JSON.stringify(data);
    if (node.dataset.ntSig === signature) return;
    node.dataset.ntSig = signature;

    const hasLectures = stats.total > 0;
    const primary = resume
      ? `<button class="nt-native-btn nt-native-btn-primary" type="button" data-nt-act="resume"
           data-lecture="${esc(resume.lecture.id)}" data-seconds="${data.resumeSeconds}">
           ${NT.icon("play", 14)} ${
             data.resumeSeconds ? `Resume ${NT.util.formatTime(data.resumeSeconds)}` : "Start course"
           }
         </button>`
      : hasLectures
        ? `<button class="nt-native-btn nt-native-btn-primary" type="button" data-nt-act="open-course"
             data-course="${esc(courseId)}">${NT.icon("arrowRight", 14)} Open course</button>`
        : `<button class="nt-native-btn nt-native-btn-primary" type="button" data-nt-act="sync-course"
             data-course="${esc(courseId)}" ${syncing ? "disabled" : ""}>
             ${
               syncing
                 ? '<span class="nt-native-spinner" aria-hidden="true"></span>Indexing…'
                 : `${NT.icon("refresh", 14)} Index this course`
             }
           </button>`;

    node.innerHTML = `
      <div class="nt-native-course-lead">
        <span class="nt-native-mark nt-native-mark-sm">${NT.mark(26)}</span>
        <div class="nt-native-course-copy">
          <span class="nt-native-eyebrow">Study Kit · ${
            hasLectures ? `${stats.done}/${stats.total} lectures complete` : "Course tools"
          }</span>
          <h2 class="nt-native-course-title">${esc(title)}</h2>
          <p class="nt-native-course-sub">${
            hasLectures
              ? `${stats.percent}% complete${
                  resume?.lecture?.title ? ` · Next: ${esc(resume.lecture.title)}` : ""
                }`
              : "Index this course to unlock lecture search, resume and progress tracking."
          }</p>
        </div>
      </div>
      ${
        hasLectures
          ? `<div class="nt-native-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${
              stats.percent
            }"><i style="width:${NT.util.clamp(stats.percent, 0, 100)}%"></i></div>`
          : ""
      }
      <div class="nt-native-course-actions">
        ${primary}
        <button class="nt-native-btn nt-native-btn-ghost" type="button" data-nt-act="search">
          ${NT.icon("search", 14)} Search lectures
        </button>
        <button class="nt-native-btn nt-native-btn-ghost" type="button" data-nt-act="sync-course"
          data-course="${esc(courseId)}" ${syncing ? "disabled" : ""}>
          ${
            syncing
              ? '<span class="nt-native-spinner" aria-hidden="true"></span>Syncing…'
              : `${NT.icon("refresh", 14)} Sync course`
          }
        </button>
      </div>
      ${data.stage ? `<p class="nt-native-status">${esc(data.stage)}</p>` : ""}`;
  };

  const injectCourse = () => {
    const route = NT.routes.parseCourse();
    if (!route) return false;
    const wrapper =
      document.querySelector('div[class*="min-h-[calc(100vh-72px)]"]') ||
      document.querySelector("div.flex.px-0.pt-4")?.parentElement;
    if (!wrapper) return false;

    let node = nodeFor("course");
    if (node && (node.dataset.ntKey !== route.courseId || !document.body.contains(node))) {
      node.remove();
      node = null;
    }
    if (!node) {
      node = bind(make("section", "nt-native-course"));
      node.dataset.ntNative = "course";
      node.dataset.ntKey = route.courseId;
      node.setAttribute("aria-label", "Study Kit course tools");
      wrapper.insertBefore(node, wrapper.firstChild);
    }
    renderCourse(node);
    return true;
  };

  /* ------------------------------------------------------------ player rail */

  const renderPlayer = (node) => {
    const route = NT.routes.parsePlay();
    if (!route) return;
    const lecture = NT.ui.lectureForContent(route.contentId);
    const course = store.getCourse(route.courseId);
    const progress = store.getProgress(route.contentId);
    const done = store.isDone(route.contentId);
    const bookmarks = store.getLectureBookmarks(route.contentId);
    const percent = Math.round(progress?.percent || 0);
    const position = Math.floor(
      Number(NT.player?.state?.ready ? NT.player.state.time : progress?.position) || 0
    );

    const data = {
      id: route.contentId,
      title: lecture.title || "Lecture",
      courseTitle: course?.title || lecture.courseTitle || "",
      done,
      percent,
      position,
      bookmarks: bookmarks.slice(0, 3).map((bookmark) => ({
        id: bookmark.id,
        seconds: bookmark.seconds,
        note: bookmark.note || ""
      })),
      count: bookmarks.length
    };
    const signature = JSON.stringify(data);
    if (node.dataset.ntSig === signature) return;
    node.dataset.ntSig = signature;

    const bookmarkRows = data.bookmarks.length
      ? data.bookmarks
          .map(
            (bookmark) => `
            <li>
              <button class="nt-native-bm" type="button" data-nt-act="player-seek" data-seconds="${
                bookmark.seconds
              }">
                <span class="nt-native-bm-time">${NT.util.formatTime(bookmark.seconds)}</span>
                <span class="nt-native-bm-note">${esc(bookmark.note || "Timestamp")}</span>
              </button>
            </li>`
          )
          .join("")
      : "";

    node.innerHTML = `
      <div class="nt-native-player-top">
        <div class="nt-native-player-brand">
          <span class="nt-native-mark nt-native-mark-sm">${NT.mark(22)}</span>
          <span>Study Kit</span>
        </div>
        <span class="nt-native-chip ${done ? "is-done" : ""}">${
          done ? `${NT.icon("check", 11)} Completed` : percent ? `${percent}%` : "Not started"
        }</span>
      </div>
      <div class="nt-native-player-title">${esc(data.title)}</div>
      ${data.courseTitle ? `<div class="nt-native-player-meta">${esc(data.courseTitle)}</div>` : ""}
      <div class="nt-native-track nt-native-track-sm" role="progressbar" aria-valuemin="0" aria-valuemax="100"
        aria-valuenow="${percent}"><i style="width:${NT.util.clamp(percent, 0, 100)}%"></i></div>
      <div class="nt-native-player-actions">
        <button class="nt-native-btn nt-native-btn-primary" type="button" data-nt-act="player-bookmark">
          ${NT.icon("bookmark", 13)} Save time
        </button>
        <button class="nt-native-btn nt-native-btn-ghost ${done ? "is-on" : ""}" type="button"
          data-nt-act="player-done" aria-pressed="${done}">
          ${NT.icon("check", 13)} ${done ? "Completed" : "Mark done"}
        </button>
      </div>
      ${
        data.count
          ? `<div class="nt-native-player-sub">
               <span>Timestamps</span><span>${data.count}${data.count > 3 ? " · latest 3" : ""}</span>
             </div>
             <ul class="nt-native-bm-list">${bookmarkRows}</ul>`
          : `<p class="nt-native-player-empty">Press <kbd>B</kbd> while watching to save this moment.</p>`
      }
      <div class="nt-native-player-foot">
        <button class="nt-native-link" type="button" data-nt-act="player-panel">Open study panel</button>
        <button class="nt-native-link" type="button" data-nt-act="search">Search lectures</button>
      </div>`;
  };

  const injectPlayer = () => {
    const route = NT.routes.parsePlay();
    if (!route) return false;
    const rail = document.querySelector(".rgt_side") || document.querySelector("ul.tab_list")?.parentElement;
    const tabs = rail?.querySelector("ul.tab_list");
    if (!rail || !tabs) return false;

    let node = nodeFor("player");
    if (node && (node.dataset.ntKey !== route.contentId || !document.body.contains(node))) {
      node.remove();
      node = null;
    }
    if (!node) {
      node = bind(make("aside", "nt-native-player"));
      node.dataset.ntNative = "player";
      node.dataset.ntKey = route.contentId;
      node.setAttribute("aria-label", "Study Kit lecture tools");
      rail.insertBefore(node, tabs);
    }
    renderPlayer(node);
    return true;
  };

  /* --------------------------------------------------------------- lifecycle */

  const clearRetry = () => {
    clearTimeout(retryTimer);
    retryTimer = 0;
    attempts = 0;
  };

  const scheduleRetry = () => {
    if (retryTimer || attempts >= MAX_ATTEMPTS) return;
    attempts += 1;
    retryTimer = setTimeout(() => {
      retryTimer = 0;
      refresh(false);
    }, RETRY_MS);
  };

  const scheduleRefresh = (immediate = false) => {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      refreshTimer = 0;
      refresh(immediate);
    }, immediate ? 0 : 320);
  };

  const refresh = (force = false) => {
    if (!mounted) return;
    if (!onSite() || !isEnabled()) {
      removeAll();
      clearRetry();
      return;
    }
    if (location.pathname !== lastPath) {
      lastPath = location.pathname;
      clearRetry();
    }
    if (!NT.ui.siteReady()) {
      scheduleRetry();
      return;
    }

    const path = location.pathname || "/";
    const wantsHome = path === "/" || path === "/home";
    const wantsSidebar = path.startsWith("/private");
    const wantsCourse = Boolean(NT.routes.parseCourse());
    const wantsPlayer = Boolean(NT.routes.parsePlay());

    if (!wantsHome) remove("home");
    if (!wantsSidebar) remove("sidebar");
    if (!wantsCourse) remove("course");
    if (!wantsPlayer) remove("player");

    let missing = false;
    if (wantsHome) missing = !injectHome() || missing;
    if (wantsSidebar) missing = !injectSidebar() || missing;
    if (wantsCourse) missing = !injectCourse() || missing;
    if (wantsPlayer) missing = !injectPlayer() || missing;

    if (missing) scheduleRetry();
    else if (force) clearRetry();
  };

  const maybeAutoSync = () => {
    if (!isEnabled() || !onSite() || !api.session.loggedIn()) return;
    const path = location.pathname || "/";
    if (path !== "/" && !path.startsWith("/private")) return;

    const last = Number(sessionStorage.getItem(AUTO_SYNC_KEY)) || 0;
    if (Date.now() - last < 20 * 60 * 1000) return;

    const stats = store.stats();
    const courses = store.allCourses();
    const freshList = stats.lastSync && Date.now() - stats.lastSync < 30 * 60 * 1000;
    if (courses.length && freshList) {
      // The list is fresh. Only the "My Course" page asks for a deep pass.
      if (path !== "/private/my-course") return;
      const stale = courses.some(
        (course) =>
          !course.syncedAt ||
          Number(course.indexVersion) < (Number(NT.INDEX_VERSION) || 1) ||
          Date.now() - course.syncedAt > 6 * 60 * 60 * 1000
      );
      if (!stale) return;
    }

    try {
      sessionStorage.setItem(AUTO_SYNC_KEY, String(Date.now()));
    } catch (_) {}

    const deep = path === "/private/my-course";
    NT.sync.syncAll({ force: !freshList, deep }).catch((error) => {
      if (error instanceof api.AuthError) return;
      console.warn("[Study Kit] Background sync skipped", error);
    });
  };

  const mount = () => {
    if (mounted) return;
    if (!onSite()) return;
    mounted = true;

    store.on((event, payload) => {
      if (event === "settings") {
        scheduleRefresh(true);
        return;
      }
      if (
        event === "change" ||
        event === "done" ||
        event === "bookmark" ||
        event === "bookmark-removed" ||
        event === "bookmarks-sync" ||
        event === "watchtime" ||
        event === "external" ||
        event === "reload"
      ) {
        void payload;
        scheduleRefresh(false);
      }
    });

    NT.sync?.on((event) => {
      if (
        event === "state" ||
        event === "course" ||
        event === "courses" ||
        event === "lectures" ||
        event === "lecture" ||
        event === "lecture-completed"
      ) {
        scheduleRefresh(false);
      }
    });

    refresh(true);
    clearTimeout(autoSyncTimer);
    autoSyncTimer = setTimeout(maybeAutoSync, AUTO_SYNC_AFTER);
  };

  NT.native = {
    mount,
    refresh: (force) => refresh(force === true),
    get mounted() {
      return mounted;
    }
  };
})();
