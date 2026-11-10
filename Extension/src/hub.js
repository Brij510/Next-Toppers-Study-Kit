/* Next Toppers Study Kit — the Study Hub overlay. */
(() => {
  "use strict";

  const NT = globalThis.NT;
  if (NT.hub) return;
  const store = NT.store;
  const api = NT.api;

  const views = ["home", "courses", "lectures", "bookmarks", "activity", "settings"];
  const viewMeta = {
    home: { label: "Home", icon: "home" },
    courses: { label: "Courses", icon: "library" },
    lectures: { label: "Lectures", icon: "playCircle" },
    bookmarks: { label: "Timestamps", icon: "bookmark" },
    activity: { label: "Activity", icon: "chart" },
    settings: { label: "Settings", icon: "settings" }
  };

  let hubNode = null;
  let contentEl = null;
  let bannerEl = null;
  let isOpen = false;
  let syncState = { ...NT.sync.state };
  let renderTimer = 0;

  const state = {
    view: "home",
    courseId: null,
    lectureQuery: "",
    lectureFilter: "all",
    lectureCourse: "all",
    bookmarkQuery: "",
    bookmarkCourse: "all"
  };

  const esc = NT.escape;

  const profile = () => {
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
    const email = cred.email || "";
    return {
      name: String(name || "").trim(),
      email: String(email || ""),
      userId: api.session.userId()
    };
  };

  const firstName = () => {
    const { name, email } = profile();
    if (name) return name.split(/\s+/)[0];
    if (email) return email.split("@")[0];
    return "";
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
      percent: total ? (done / total) * 100 : 0,
      seconds
    };
  };

  const continueItem = () => {
    const progress = store.getContinueItem();
    if (!progress) return null;
    const lecture = store.getLecture(progress.contentId);
    if (!lecture) return null;
    return { progress, lecture, course: store.getCourse(lecture.courseId) };
  };

  const lectureLink = (lecture, seconds) =>
    NT.routes.playURL(lecture?.playId || lecture?.id, lecture?.courseId, seconds || 0);

  const thumb = (course, className = "") =>
    course?.thumbnail
      ? `<img class="nt-thumb ${className}" src="${esc(course.thumbnail)}" alt="" loading="lazy">`
      : `<span class="nt-thumb nt-thumb-fallback ${className}">${esc(
          NT.ui.initials(course?.title || "NT")
        )}</span>`;

  const statCard = (icon, value, label, tone = "") => `
    <div class="nt-stat ${tone}">
      <span class="nt-stat-icon">${NT.icon(icon, 18)}</span>
      <div><strong>${esc(value)}</strong><span>${esc(label)}</span></div>
    </div>`;

  const panelHead = (title, sub = "", action = "") => `
    <div class="nt-panel-head">
      <div><h2>${esc(title)}</h2>${sub ? `<p>${esc(sub)}</p>` : ""}</div>
      ${action}
    </div>`;

  const lectureRow = (lecture, options = {}) => {
    const progress = store.getProgress(lecture.id);
    const percent = Math.round(progress?.percent || 0);
    const done = Boolean(progress?.completed || progress?.manualDone);
    const resume = progress && !done && percent > 1 ? progress.position : 0;
    return `
      <div class="nt-lecture-row ${done ? "is-done" : ""}" data-lecture-row="${esc(lecture.id)}">
        <button class="nt-lecture-play" type="button" data-open-lecture="${esc(lecture.id)}" data-seconds="${resume}"
          aria-label="Open ${esc(lecture.title)}">
          ${NT.icon(done ? "check" : "play", 15)}
        </button>
        <button class="nt-lecture-copy" type="button" data-open-lecture="${esc(lecture.id)}" data-seconds="${resume}">
          <span class="nt-lecture-title">${esc(lecture.title || "Untitled lecture")}</span>
          <span class="nt-lecture-sub">${
            options.showCourse && lecture.courseTitle ? esc(lecture.courseTitle) : esc(lecture.folderTitle || "Lecture")
          }${progress?.lastWatchedAt ? ` · ${esc(NT.util.formatRelative(progress.lastWatchedAt))}` : ""}</span>
        </button>
        <span class="nt-lecture-progress">
          <span class="nt-bar"><i style="width:${NT.util.clamp(percent, 0, 100)}%"></i></span>
          <em>${done ? "Done" : percent ? `${percent}%` : "New"}</em>
        </span>
        <button class="nt-done-toggle ${done ? "is-done" : ""}" type="button" data-toggle-done="${esc(
          lecture.id
        )}" aria-pressed="${done}" aria-label="${done ? "Mark not done" : "Mark done"}" title="${
          done ? "Mark not done" : "Mark done"
        }">${NT.icon("check", 14)}</button>
      </div>`;
  };

  const courseCard = (course) => {
    const stats = courseStats(course);
    const synced = Boolean(course.syncedAt);
    return `
      <article class="nt-course-card">
        <div class="nt-course-cover">
          ${thumb(course)}
          <span class="nt-course-badge">${
            !synced ? "Not indexed" : stats.total ? `${stats.done}/${stats.total} done` : "No lectures"
          }</span>
          <span class="nt-course-ring">${NT.ui.progressRing(stats.percent, 44, 4)}<b>${Math.round(
            stats.percent
          )}%</b></span>
        </div>
        <div class="nt-course-body">
          <h3>${esc(course.title || `Course ${course.id}`)}</h3>
          <p>${synced ? `${stats.total} lectures indexed` : "Sync to pull in this course"}${
            course.educator ? ` · ${esc(course.educator)}` : ""
          }</p>
          <div class="nt-bar"><i style="width:${NT.util.clamp(stats.percent, 0, 100)}%"></i></div>
          <div class="nt-course-actions">
            ${
              stats.total
                ? `<button class="nt-btn nt-btn-primary nt-btn-sm" type="button" data-open-course="${esc(
                    course.id
                  )}">Study</button>`
                : `<button class="nt-btn nt-btn-primary nt-btn-sm" type="button" data-sync-course="${esc(
                    course.id
                  )}">Index course</button>`
            }
            <button class="nt-btn nt-btn-ghost nt-btn-sm" type="button" data-course-site="${esc(
              course.id
            )}">Site ${NT.icon("external", 13)}</button>
          </div>
        </div>
      </article>`;
  };

  /* --------------------------------------------------------------- banners */

  const renderBanner = () => {
    if (!bannerEl) return;
    if (syncState.syncing) {
      const percent =
        syncState.total > 0 ? Math.round((syncState.current / syncState.total) * 100) : 8;
      bannerEl.hidden = false;
      bannerEl.className = "nt-hub-banner is-syncing";
      bannerEl.innerHTML = `
        <span class="nt-spinner"></span>
        <span class="nt-hub-banner-copy">
          <strong>${esc(syncState.stage || "Syncing your courses…")}</strong>
          <small>${
            syncState.total > 1 ? `${syncState.current} of ${syncState.total} courses` : "Talking to nexttoppers.com"
          }</small>
        </span>
        <span class="nt-hub-banner-track"><i style="width:${NT.util.clamp(percent, 4, 100)}%"></i></span>
      `;
      return;
    }
    if (syncState.lastError) {
      bannerEl.hidden = false;
      bannerEl.className = "nt-hub-banner is-error";
      bannerEl.innerHTML = `
        ${NT.icon("alert", 16)}
        <span class="nt-hub-banner-copy"><strong>Sync needs attention</strong><small>${esc(
          syncState.lastError
        )}</small></span>
        <button class="nt-btn nt-btn-ghost nt-btn-sm" type="button" data-sync>Try again</button>
      `;
      return;
    }
    bannerEl.hidden = true;
    bannerEl.innerHTML = "";
  };

  /* ---------------------------------------------------------------- header */

  const topBar = (crumb) => `
    <div class="nt-hub-top">
      <div class="nt-hub-crumb"><span>Study Kit</span>${NT.icon("chevronRight", 12)}<strong>${esc(
        crumb
      )}</strong></div>
      <div class="nt-hub-top-actions">
        <button class="nt-hub-search" type="button" data-search-open>
          ${NT.icon("search", 15)}<span>Search</span><kbd>${NT.ui.keyHint()}</kbd>
        </button>
        <button class="nt-icon-btn nt-hub-tool" type="button" data-sync title="Sync courses" aria-label="Sync courses">
          ${NT.icon("refresh", 17)}
        </button>
        <button class="nt-icon-btn nt-hub-tool" type="button" data-close title="Close Study Hub" aria-label="Close Study Hub">
          ${NT.icon("x", 18)}
        </button>
      </div>
    </div>`;

  /* ------------------------------------------------------------------ home */

  const homeView = () => {
    const stats = store.stats();
    const next = continueItem();
    const user = firstName();
    const today = Number(store.db.activity[NT.util.dayKey()] || 0);
    const recent = store.getRecent(5);
    const bookmarks = store.getBookmarks().slice(0, 5);
    const courses = store.allCourses().slice(0, 3);
    const weekSeconds = Object.entries(store.db.activity)
      .filter(([day]) => {
        const time = new Date(`${day}T12:00:00`).getTime();
        return Date.now() - time < 7 * 86400000;
      })
      .reduce((sum, [, seconds]) => sum + Number(seconds || 0), 0);

    const hero = next
      ? `
        <section class="nt-hero">
          <div class="nt-hero-glow"></div>
          <div class="nt-hero-copy">
            <span class="nt-hero-kicker">${NT.icon("playCircle", 14)} Continue where you left off</span>
            <h1>${esc(next.lecture.title || "Your next lecture")}</h1>
            <p>${esc(next.course?.title || next.lecture.courseTitle || "Lecture")} · ${NT.util.formatTime(
        next.progress.position
      )} of ${NT.util.formatTime(next.progress.duration)}${
        next.progress.duration
          ? ` · ${NT.util.formatDuration(next.progress.duration - next.progress.position)} left`
          : ""
      }</p>
            <div class="nt-hero-progress"><span style="width:${NT.util.clamp(
              next.progress.percent,
              0,
              100
            )}%"></span></div>
            <div class="nt-hero-actions">
              <button class="nt-btn nt-btn-light" type="button" data-open-lecture="${esc(
                next.lecture.id
              )}" data-seconds="${next.progress.position}">
                ${NT.icon("play", 15)} Resume at ${NT.util.formatTime(next.progress.position)}
              </button>
              <button class="nt-btn nt-btn-hero-ghost" type="button" data-open-course="${esc(
                next.lecture.courseId
              )}">View course</button>
            </div>
          </div>
          <div class="nt-hero-art">
            <div class="nt-hero-ring">${NT.ui.progressRing(next.progress.percent, 128, 7)}</div>
            <strong>${Math.round(next.progress.percent || 0)}%</strong>
            <span>watched</span>
          </div>
        </section>`
      : `
        <section class="nt-hero nt-hero-empty">
          <div class="nt-hero-glow"></div>
          <div class="nt-hero-copy">
            <span class="nt-hero-kicker">${NT.icon("sparkles", 14)} ${NT.util.greeting()}${
          user ? `, ${esc(user)}` : ""
        }</span>
            <h1>Your study space, without the noise.</h1>
            <p>Search every lecture, keep your place, and save the moments that matter. Sync your Next Toppers courses to begin.</p>
            <div class="nt-hero-actions">
              <button class="nt-btn nt-btn-light" type="button" data-sync>
                ${NT.icon("refresh", 15)} Sync my courses
              </button>
              <button class="nt-btn nt-btn-hero-ghost" type="button" data-search-open>
                ${NT.icon("search", 15)} Search lectures
              </button>
            </div>
            <span class="nt-hero-note">${NT.icon("cloud", 13)} Uses your existing nexttoppers.com login. Nothing leaves this device.</span>
          </div>
          <div class="nt-hero-art nt-hero-art-mark">${NT.mark(132)}</div>
        </section>`;

    return `
      <div class="nt-view nt-view-home">
        <div class="nt-view-intro">
          <div>
            <span class="nt-eyebrow">${new Date().toLocaleDateString(undefined, {
              weekday: "long",
              day: "numeric",
              month: "long"
            })}</span>
            <h1>${NT.util.greeting()}${user ? `, ${esc(user)}` : ""}.</h1>
            <p>${
              today > 0
                ? `You've studied ${NT.ui.watchTimeText(today)} today. Keep the streak alive.`
                : stats.streak
                ? `${stats.streak}-day streak. A short session keeps it going.`
                : "A calm place for every lecture, timestamp and small win."
            }</p>
          </div>
          <div class="nt-week-chip">
            ${NT.icon("flame", 16)}
            <div><strong>${stats.streak}</strong><span>day streak</span></div>
            <em>${NT.ui.watchTimeText(weekSeconds)} this week</em>
          </div>
        </div>

        ${hero}

        <div class="nt-stat-grid">
          ${statCard("checkCircle", stats.done, "Lectures done", "is-mint")}
          ${statCard("playCircle", stats.inProgress, "In progress")}
          ${statCard("bookmark", stats.bookmarks, "Timestamps")}
          ${statCard("clock", NT.ui.watchTimeText(stats.watchTime), "Total watch time")}
        </div>

        <div class="nt-two-col">
          <section class="nt-panel">
            ${panelHead(
              "Recent lectures",
              "Pick up without hunting through the course tree.",
              `<button class="nt-link" type="button" data-view="lectures">View all ${NT.icon(
                "chevronRight",
                13
              )}</button>`
            )}
            <div class="nt-lecture-list">
              ${
                recent.length
                  ? recent.map(({ lecture }) => lectureRow(lecture, { showCourse: true })).join("")
                  : `<div class="nt-inline-empty">${NT.icon(
                      "playCircle",
                      22
                    )}<span>Open a lecture and it will show up here.</span></div>`
              }
            </div>
          </section>

          <section class="nt-panel">
            ${panelHead(
              "Saved timestamps",
              "The bits worth a second look.",
              `<button class="nt-link" type="button" data-view="bookmarks">All ${NT.icon(
                "chevronRight",
                13
              )}</button>`
            )}
            <div class="nt-mini-bookmarks">
              ${
                bookmarks.length
                  ? bookmarks
                      .map(
                        (bookmark) => `
                        <button class="nt-mini-bm" type="button" data-open-bookmark="${esc(
                          bookmark.id
                        )}">
                          <span class="nt-mini-bm-time">${NT.util.formatTime(bookmark.seconds)}</span>
                          <span class="nt-mini-bm-copy">
                            <strong>${esc(bookmark.note || "Timestamp")}</strong>
                            <small>${esc(bookmark.lectureTitle || "Lecture")}</small>
                          </span>
                          ${NT.icon("chevronRight", 13)}
                        </button>`
                      )
                      .join("")
                  : `<div class="nt-inline-empty">${NT.icon(
                      "bookmark",
                      22
                    )}<span>Press <kbd>B</kbd> while watching to save a moment.</span></div>`
              }
            </div>
            ${
              bookmarks.length
                ? `<div class="nt-panel-tip">${NT.icon(
                    "bookmark",
                    14
                  )}<span>Press <kbd>B</kbd> in the player to save another moment.</span></div>`
                : ""
            }
          </section>
        </div>

        <section class="nt-panel">
          ${panelHead(
            "Your courses",
            "Everything you own, in one quiet shelf.",
            `<button class="nt-link" type="button" data-view="courses">All courses ${NT.icon(
              "chevronRight",
              13
            )}</button>`
          )}
          ${
            courses.length
              ? `<div class="nt-course-strip">${courses.map(courseCard).join("")}</div>`
              : `<div class="nt-empty-row">
                  <div>${NT.icon("library", 26)}</div>
                  <div><strong>No courses indexed yet</strong><span>Sign in on nexttoppers.com, then sync to import your purchased courses.</span></div>
                  <button class="nt-btn nt-btn-primary nt-btn-sm" type="button" data-sync>Sync now</button>
                </div>`
          }
        </section>

        <p class="nt-hub-footnote">${NT.icon("cloud", 13)} Study Kit keeps your progress, notes and timestamps in this browser. Syncing only reads your courses and mirrors timestamps when you ask.</p>
      </div>`;
  };

  /* --------------------------------------------------------------- courses */

  const coursesView = () => {
    const courses = store.allCourses();
    const stats = courses.map((course) => ({ course, stats: courseStats(course) }));
    const totalDone = stats.reduce((sum, item) => sum + item.stats.done, 0);
    const totalLectures = stats.reduce((sum, item) => sum + item.stats.total, 0);
    return `
      <div class="nt-view">
        <div class="nt-view-head">
          <div>
            <span class="nt-eyebrow">Library</span>
            <h1>Your courses</h1>
            <p>${
              courses.length
                ? `${courses.length} course${courses.length === 1 ? "" : "s"} · ${totalDone} of ${totalLectures} lectures done.`
                : "Sync your Next Toppers account to pull in purchased courses."
            }</p>
          </div>
          <div class="nt-view-actions">
            <button class="nt-btn nt-btn-ghost" type="button" data-refresh-courses>
              ${NT.icon("refresh", 14)} Refresh list
            </button>
            <button class="nt-btn nt-btn-primary" type="button" data-sync>
              ${NT.icon("cloud", 15)} Sync all courses
            </button>
          </div>
        </div>
        ${
          courses.length
            ? `<div class="nt-course-grid">${courses.map(courseCard).join("")}</div>`
            : `<div class="nt-big-empty">
                <div class="nt-big-empty-art">${NT.icon("library", 34)}</div>
                <h2>No courses here yet</h2>
                <p>Sign in on nexttoppers.com in this browser, then sync. Your purchased courses and lectures will appear here — Study Kit never uploads your notes.</p>
                <div class="nt-big-empty-actions">
                  <button class="nt-btn nt-btn-primary" type="button" data-sync>Sync my courses</button>
                  <a class="nt-btn nt-btn-ghost" href="https://nexttoppers.com" target="_blank" rel="noreferrer">Open nexttoppers.com</a>
                </div>
              </div>`
        }
      </div>`;
  };

  const courseDetailView = () => {
    const course = store.getCourse(state.courseId);
    if (!course) {
      return `<div class="nt-view"><div class="nt-big-empty"><h2>Course not found</h2><p>It may have been removed from your library.</p><button class="nt-btn nt-btn-primary" data-view="courses">Back to courses</button></div></div>`;
    }
    const stats = courseStats(course);
    const lectures = store.getCourseLectures(course.id);
    const next = lectures.find((lecture) => {
      const progress = store.getProgress(lecture.id);
      return progress && !progress.completed && (progress.percent || 0) > 1;
    });
    return `
      <div class="nt-view">
        <button class="nt-back" type="button" data-view="courses">${NT.icon("arrowLeft", 14)} All courses</button>
        <section class="nt-course-hero">
          <div class="nt-course-hero-cover">${thumb(course)}</div>
          <div class="nt-course-hero-copy">
            <span class="nt-eyebrow">${course.educator ? esc(course.educator) : "Your course"}</span>
            <h1>${esc(course.title || `Course ${course.id}`)}</h1>
            <p>${stats.total} lectures${stats.done ? ` · ${stats.done} done` : ""}${
      course.syncedAt ? ` · Synced ${esc(NT.util.formatRelative(course.syncedAt))}` : ""
    }</p>
            <div class="nt-course-hero-progress">
              <span class="nt-bar"><i style="width:${NT.util.clamp(stats.percent, 0, 100)}%"></i></span>
              <b>${Math.round(stats.percent)}%</b>
            </div>
            <div class="nt-course-hero-actions">
              ${
                next
                  ? `<button class="nt-btn nt-btn-primary" type="button" data-open-lecture="${esc(
                      next.id
                    )}" data-seconds="${store.getProgress(next.id).position}">${NT.icon(
                      "play",
                      14
                    )} Continue</button>`
                  : ""
              }
              <button class="nt-btn nt-btn-ghost" type="button" data-sync-course="${esc(
                course.id
              )}">${NT.icon("refresh", 14)} Re-index</button>
              <button class="nt-btn nt-btn-ghost" type="button" data-course-site="${esc(
                course.id
              )}">Open on site ${NT.icon("external", 13)}</button>
            </div>
          </div>
          <div class="nt-course-hero-ring">${NT.ui.progressRing(stats.percent, 86, 6)}<strong>${Math.round(
            stats.percent
          )}%</strong></div>
        </section>
        <section class="nt-panel">
          ${panelHead(
            "Lectures",
            stats.total ? `${stats.total} indexed in this course` : "This course has not been indexed yet",
            stats.total
              ? `<button class="nt-link" type="button" data-course-site="${esc(
                  course.id
                )}">Course page ${NT.icon("external", 12)}</button>`
              : `<button class="nt-btn nt-btn-primary nt-btn-sm" data-sync-course="${esc(
                  course.id
                )}">Index now</button>`
          )}
          ${
            lectures.length
              ? `<div class="nt-lecture-list">${lectures.map((lecture) => lectureRow(lecture)).join("")}</div>`
              : `<div class="nt-inline-empty">${NT.icon(
                  "library",
                  22
                )}<span>No lectures indexed yet. Re-index this course, or open it on the site to capture content as you browse.</span></div>`
          }
        </section>
      </div>`;
  };

  /* -------------------------------------------------------------- lectures */

  const filteredLectures = () => {
    const q = NT.util.normalizeText(state.lectureQuery);
    return store
      .allLectures()
      .filter((lecture) => {
        if (state.lectureCourse !== "all" && String(lecture.courseId) !== String(state.lectureCourse)) return false;
        const progress = store.getProgress(lecture.id);
        const done = Boolean(progress?.completed || progress?.manualDone);
        if (state.lectureFilter === "done" && !done) return false;
        if (state.lectureFilter === "progress" && (!(progress?.percent > 1) || done)) return false;
        if (state.lectureFilter === "new" && progress?.lastWatchedAt) return false;
        if (!q) return true;
        return (
          NT.util.normalizeText(lecture.title).includes(q) ||
          NT.util.normalizeText(lecture.courseTitle).includes(q) ||
          NT.util.normalizeText(lecture.folderTitle).includes(q)
        );
      })
      .sort((a, b) => {
        const aCourse = store.getCourse(a.courseId);
        const bCourse = store.getCourse(b.courseId);
        const courseCompare = String(aCourse?.title || a.courseTitle || "").localeCompare(
          String(bCourse?.title || b.courseTitle || "")
        );
        return courseCompare || (a.order || 0) - (b.order || 0);
      });
  };

  const lectureResults = () => {
    const list = filteredLectures();
    let lastCourse = "";
    const rows = list
      .map((lecture) => {
        const course = store.getCourse(lecture.courseId);
        const courseTitle = course?.title || lecture.courseTitle || "";
        let heading = "";
        if (courseTitle !== lastCourse) {
          heading = `<div class="nt-lecture-group">${esc(courseTitle || "Other lectures")}<span>${
            (course?.lectureIds || []).length
          }</span></div>`;
          lastCourse = courseTitle;
        }
        return heading + lectureRow(lecture);
      })
      .join("");

    return {
      list,
      body: list.length
        ? rows
        : `<div class="nt-inline-empty nt-inline-empty-lg">${NT.icon(
            "search",
            26
          )}<span>No lectures match this view. Try another search or sync your courses.</span></div>`
    };
  };

  const lecturesView = () => {
    const courses = store.allCourses();
    const total = store.allLectures().length;
    const { list, body } = lectureResults();

    return `
      <div class="nt-view">
        <div class="nt-view-head">
          <div>
            <span class="nt-eyebrow">Every lecture</span>
            <h1>Find a lecture</h1>
            <p>${total ? `${total} lectures indexed across ${courses.length} courses.` : "Sync or browse a course to start indexing."}</p>
          </div>
          <button class="nt-btn nt-btn-primary" type="button" data-sync>${NT.icon(
            "refresh",
            15
          )} Sync courses</button>
        </div>
        <div class="nt-toolbar">
          <label class="nt-search-field">
            ${NT.icon("search", 16)}
            <input type="search" data-lecture-search value="${esc(
              state.lectureQuery
            )}" placeholder="Search lectures by name or chapter…" aria-label="Search lectures">
          </label>
          <select class="nt-select" data-filter-course aria-label="Filter by course">
            <option value="all">All courses</option>
            ${courses
              .map(
                (course) =>
                  `<option value="${esc(course.id)}" ${
                    state.lectureCourse === String(course.id) ? "selected" : ""
                  }>${esc(course.title)}</option>`
              )
              .join("")}
          </select>
          <div class="nt-seg" role="group" aria-label="Filter lectures">
            ${[
              ["all", "All"],
              ["progress", "In progress"],
              ["new", "Not started"],
              ["done", "Done"]
            ]
              .map(
                ([value, label]) =>
                  `<button type="button" data-lecture-filter="${value}" class="${
                    state.lectureFilter === value ? "is-active" : ""
                  }">${label}</button>`
              )
              .join("")}
          </div>
        </div>
        <section class="nt-panel nt-panel-list" data-lecture-results>
          ${body}
        </section>
        <p class="nt-result-count" data-lecture-count ${list.length ? "" : "hidden"}>${list.length} lecture${
      list.length === 1 ? "" : "s"
    }</p>
      </div>`;
  };

  const renderLectureResults = () => {
    const panel = contentEl.querySelector("[data-lecture-results]");
    if (!panel) return false;
    const { list, body } = lectureResults();
    panel.innerHTML = body;
    const count = contentEl.querySelector("[data-lecture-count]");
    if (count) {
      count.hidden = !list.length;
      count.textContent = `${list.length} lecture${list.length === 1 ? "" : "s"}`;
    }
    return true;
  };

  /* ------------------------------------------------------------- bookmarks */

  const filteredBookmarks = () => {
    const q = NT.util.normalizeText(state.bookmarkQuery);
    return store
      .getBookmarks()
      .filter((bookmark) => {
        if (
          state.bookmarkCourse !== "all" &&
          String(bookmark.courseId) !== String(state.bookmarkCourse)
        )
          return false;
        if (!q) return true;
        return (
          NT.util.normalizeText(bookmark.note).includes(q) ||
          NT.util.normalizeText(bookmark.lectureTitle).includes(q) ||
          NT.util.normalizeText(bookmark.courseTitle).includes(q)
        );
      })
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  };

  const bookmarkResults = () => {
    const list = filteredBookmarks();
    return {
      list,
      body: list.length
        ? `<div class="nt-bookmark-list">${list
            .map((bookmark) => {
              const lecture = store.getLecture(bookmark.lectureId);
              const course = store.getCourse(bookmark.courseId || lecture?.courseId);
              return `
                <article class="nt-bookmark-card">
                  <button class="nt-bookmark-time" type="button" data-open-bookmark="${esc(
                    bookmark.id
                  )}">
                    <span>${NT.util.formatTime(bookmark.seconds)}</span>
                    <small>Jump in</small>
                  </button>
                  <div class="nt-bookmark-copy">
                    <strong>${esc(bookmark.note || "Timestamp")}</strong>
                    <button class="nt-bookmark-lecture" type="button" data-open-lecture="${esc(
                      bookmark.lectureId
                    )}" data-seconds="${bookmark.seconds}">${esc(
                      bookmark.lectureTitle || lecture?.title || "Lecture"
                    )}</button>
                    <span>${esc(
                      course?.title || bookmark.courseTitle || lecture?.courseTitle || ""
                    )} · ${esc(NT.util.formatRelative(bookmark.createdAt))}</span>
                  </div>
                  <div class="nt-bookmark-actions">
                    <button class="nt-icon-btn" type="button" data-open-bookmark="${esc(
                      bookmark.id
                    )}" aria-label="Play timestamp" title="Play">${NT.icon("play", 15)}</button>
                    <button class="nt-icon-btn nt-danger" type="button" data-delete-bookmark="${esc(
                      bookmark.id
                    )}" aria-label="Delete timestamp" title="Delete">${NT.icon("trash", 15)}</button>
                  </div>
                </article>`;
            })
            .join("")}</div>`
        : `<div class="nt-big-empty">
            <div class="nt-big-empty-art">${NT.icon("bookmark", 34)}</div>
            <h2>No timestamps yet</h2>
            <p>While watching a lecture, press <kbd>B</kbd> or use the bookmark button in the player. Add a note so future-you knows why it mattered.</p>
            ${
              NT.routes.parsePlay()
                ? `<button class="nt-btn nt-btn-primary" type="button" data-player-bookmark>Save the current moment</button>`
                : `<button class="nt-btn nt-btn-primary" type="button" data-view="lectures">Find a lecture</button>`
            }
          </div>`
    };
  };

  const bookmarksView = () => {
    const courses = store.allCourses();
    const { body } = bookmarkResults();
    return `
      <div class="nt-view">
        <div class="nt-view-head">
          <div>
            <span class="nt-eyebrow">Second looks</span>
            <h1>Saved timestamps</h1>
            <p>${store.db.bookmarks.length} saved moment${store.db.bookmarks.length === 1 ? "" : "s"}. Press <kbd>B</kbd> in any lecture to add another.</p>
          </div>
          ${
            NT.routes.parsePlay()
              ? `<button class="nt-btn nt-btn-primary" type="button" data-player-bookmark>${NT.icon(
                  "bookmark",
                  15
                )} Save current moment</button>`
              : ""
          }
        </div>
        <div class="nt-toolbar">
          <label class="nt-search-field">
            ${NT.icon("search", 16)}
            <input type="search" data-bookmark-search value="${esc(
              state.bookmarkQuery
            )}" placeholder="Search notes and lectures…" aria-label="Search timestamps">
          </label>
          <select class="nt-select" data-filter-bookmark-course aria-label="Filter by course">
            <option value="all">All courses</option>
            ${courses
              .map(
                (course) =>
                  `<option value="${esc(course.id)}" ${
                    state.bookmarkCourse === String(course.id) ? "selected" : ""
                  }>${esc(course.title)}</option>`
              )
              .join("")}
          </select>
        </div>
        <div data-bookmark-results>${body}</div>
      </div>`;
  };

  const renderBookmarkResults = () => {
    const panel = contentEl.querySelector("[data-bookmark-results]");
    if (!panel) return false;
    panel.innerHTML = bookmarkResults().body;
    return true;
  };

  /* -------------------------------------------------------------- activity */

  const heatmap = () => {
    const days = [];
    const today = new Date();
    for (let i = 83; i >= 0; i -= 1) {
      const date = new Date(today);
      date.setHours(12, 0, 0, 0);
      date.setDate(today.getDate() - i);
      const key = NT.util.dayKey(date);
      const seconds = Number(store.db.activity[key] || 0);
      let level = 0;
      if (seconds > 0) level = 1;
      if (seconds >= 900) level = 2;
      if (seconds >= 1800) level = 3;
      if (seconds >= 3600) level = 4;
      days.push({ date, key, seconds, level });
    }
    const monthLabels = [];
    let lastMonth = "";
    days.forEach((day, index) => {
      if (index % 7 !== 0) return;
      const month = day.date.toLocaleDateString(undefined, { month: "short" });
      if (month !== lastMonth) {
        monthLabels.push({ month, index });
        lastMonth = month;
      }
    });
    const active = days.filter((day) => day.seconds > 0);
    const best = days.reduce((max, day) => Math.max(max, day.seconds), 0);
    const average = active.length
      ? active.reduce((sum, day) => sum + day.seconds, 0) / active.length
      : 0;
    const weekdayTotals = Array(7).fill(0);
    days.forEach((day) => {
      weekdayTotals[day.date.getDay()] += day.seconds;
    });
    const strongestIndex = weekdayTotals.indexOf(Math.max(...weekdayTotals));
    const strongestDay =
      weekdayTotals[strongestIndex] > 0
        ? new Date(2020, 0, 5 + strongestIndex).toLocaleDateString(undefined, { weekday: "long" })
        : "";
    return `
      <div class="nt-consistency-body">
        <div class="nt-heatmap-wrap">
          <div class="nt-heatmap-months">${monthLabels
            .map(
              (label) =>
                `<span style="grid-column:${Math.floor(label.index / 7) + 1} / span 2">${esc(
                  label.month
                )}</span>`
            )
            .join("")}</div>
          <div class="nt-heatmap" role="img" aria-label="Study activity over the last 12 weeks">
            ${days
              .map(
                (day) =>
                  `<span class="nt-heat l${day.level}" title="${esc(
                    day.date.toLocaleDateString(undefined, {
                      weekday: "short",
                      day: "numeric",
                      month: "short"
                    })
                  )}${day.seconds ? ` · ${NT.ui.watchTimeText(day.seconds)}` : " · no study"}"></span>`
              )
              .join("")}
          </div>
          <div class="nt-heatmap-foot">
            <span>${days[0].date.toLocaleDateString(undefined, { day: "numeric", month: "short" })} → today</span>
            <span class="nt-heat-legend">Less ${[0, 1, 2, 3, 4]
              .map((level) => `<i class="l${level}"></i>`)
              .join("")} More</span>
          </div>
        </div>
        <div class="nt-consistency-side">
          ${
            strongestDay
              ? `<div class="nt-consistency-note">
                  <span>${NT.icon("sparkles", 15)}</span>
                  <div><strong>${esc(strongestDay)}</strong><small>is your strongest day</small></div>
                </div>`
              : ""
          }
          <div class="nt-consistency-facts">
            <div><strong>${active.length}</strong><span>active days</span></div>
            <div><strong>${best ? NT.ui.watchTimeText(best) : "—"}</strong><span>best day</span></div>
            <div><strong>${average ? NT.ui.watchTimeText(average) : "—"}</strong><span>average session</span></div>
          </div>
        </div>
      </div>`;
  };

  const activityView = () => {
    const stats = store.stats();
    const days = [];
    for (let i = 6; i >= 0; i -= 1) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const key = NT.util.dayKey(date);
      days.push({
        label: date.toLocaleDateString(undefined, { weekday: "short" }).slice(0, 2),
        seconds: Number(store.db.activity[key] || 0)
      });
    }
    const max = Math.max(60, ...days.map((day) => day.seconds));
    const recent = store.getRecent(8);

    return `
      <div class="nt-view">
        <div class="nt-view-head">
          <div>
            <span class="nt-eyebrow">Momentum</span>
            <h1>Your activity</h1>
            <p>Quiet progress adds up. ${stats.streak ? `${stats.streak} day streak — keep it going.` : "Start a session today."}</p>
          </div>
          <div class="nt-activity-total">${NT.icon("clock", 18)}<div><strong>${NT.ui.watchTimeText(
            stats.watchTime
          )}</strong><span>total watch time</span></div></div>
        </div>
        <div class="nt-stat-grid nt-stat-grid-4">
          ${statCard("flame", `${stats.streak} days`, "Current streak", "is-warm")}
          ${statCard("checkCircle", stats.done, "Lectures completed", "is-mint")}
          ${statCard("bookmark", stats.bookmarks, "Timestamps saved")}
          ${statCard("book", Object.keys(store.db.lectures).length, "Lectures indexed")}
        </div>
        <section class="nt-panel">
          ${panelHead("Consistency", "Every square is a day you showed up.")}
          ${heatmap()}
        </section>
        <div class="nt-two-col">
          <section class="nt-panel">
            ${panelHead("This week", "Watch time over the last seven days.")}
            <div class="nt-week-bars">
              ${days
                .map(
                  (day) => `
                  <div class="nt-week-bar">
                    <span class="nt-week-bar-track"><i style="height:${Math.max(
                      3,
                      (day.seconds / max) * 100
                    )}%"></i></span>
                    <em>${esc(day.label)}</em>
                    <small>${day.seconds ? NT.ui.watchTimeText(day.seconds) : "—"}</small>
                  </div>`
                )
                .join("")}
            </div>
          </section>
          <section class="nt-panel">
            ${panelHead("Recent sessions", "The last lectures you opened.")}
            <div class="nt-lecture-list">
              ${
                recent.length
                  ? recent.map(({ lecture }) => lectureRow(lecture, { showCourse: true })).join("")
                  : `<div class="nt-inline-empty">${NT.icon(
                      "chart",
                      22
                    )}<span>No sessions yet. Open a lecture to start tracking.</span></div>`
              }
            </div>
          </section>
        </div>
      </div>`;
  };

  /* -------------------------------------------------------------- settings */

  const toggleRow = (key, label, description, disabled = false) => {
    const checked = Boolean(store.settings[key]);
    return `
      <label class="nt-setting-row ${disabled ? "is-disabled" : ""}">
        <span class="nt-setting-copy"><strong>${esc(label)}</strong><small>${esc(description)}</small></span>
        <span class="nt-switch">
          <input type="checkbox" data-setting="${key}" ${checked ? "checked" : ""} ${
      disabled ? "disabled" : ""
    }>
          <span class="nt-switch-track"><i></i></span>
        </span>
      </label>`;
  };

  const numberSetting = (key, label, description, options, suffix = "") => `
    <label class="nt-setting-row">
      <span class="nt-setting-copy"><strong>${esc(label)}</strong><small>${esc(description)}</small></span>
      <span class="nt-setting-control">
        <select class="nt-select nt-select-sm" data-setting="${key}">
          ${options
            .map(
              (value) =>
                `<option value="${value}" ${
                  Number(store.settings[key]) === Number(value) ? "selected" : ""
                }>${value}${suffix}</option>`
            )
            .join("")}
        </select>
      </span>
    </label>`;

  const settingsView = () => {
    const signedIn = api.session.loggedIn();
    const user = profile();
    return `
      <div class="nt-view">
        <div class="nt-view-head">
          <div>
            <span class="nt-eyebrow">Make it yours</span>
            <h1>Study Kit settings</h1>
            <p>Tune the player, manage your data, and control what syncs.</p>
          </div>
          <button class="nt-btn nt-btn-ghost" type="button" data-reset-settings>${NT.icon(
            "refresh",
            14
          )} Reset defaults</button>
        </div>

        <div class="nt-account-card ${signedIn ? "is-connected" : ""}">
          <div class="nt-account-avatar">${esc(
            NT.ui.initials(user.name || user.email || "NT")
          )}</div>
          <div class="nt-account-copy">
            <strong>${signedIn ? esc(user.name || "Next Toppers student") : "Not signed in"}</strong>
            <span>${
              signedIn
                ? `${esc(user.email || user.userId || "Connected")} · course sync available`
                : "Sign in on nexttoppers.com to sync courses and mirror timestamps."
            }</span>
          </div>
          ${
            signedIn
              ? `<span class="nt-account-status">${NT.icon("checkCircle", 14)} Connected</span>`
              : `<a class="nt-btn nt-btn-primary nt-btn-sm" href="https://nexttoppers.com/login" target="_blank" rel="noreferrer">Sign in</a>`
          }
        </div>

        <div class="nt-settings-grid">
          <section class="nt-panel">
            ${panelHead("Player", "How lectures behave while you study.")}
            ${toggleRow("shortcuts", "Keyboard shortcuts", "Arrow keys, K, J/L, B, D, M and F in the player.")}
            ${toggleRow("saveProgress", "Remember my place", "Save playback position for every lecture.")}
            ${toggleRow("autoResume", "Resume automatically", "Jump straight back to your last position.")}
            ${toggleRow(
              "showResumePrompt",
              "Ask before resuming",
              "Show a resume card instead of seeking automatically.",
              store.settings.autoResume
            )}
            ${numberSetting(
              "seekSeconds",
              "Skip step",
              "How far the arrow keys and skip buttons move.",
              [5, 10, 15, 20, 30],
              "s"
            )}
            ${numberSetting(
              "longSeekSeconds",
              "Long skip",
              "Shift + arrow jump distance.",
              [30, 45, 60, 90],
              "s"
            )}
          </section>

          <section class="nt-panel">
            ${panelHead("Completion", "When a lecture counts as done.")}
            ${toggleRow("autoComplete", "Auto-complete lectures", "Mark a lecture done after you pass the threshold.")}
            <div class="nt-setting-row nt-setting-row-slider">
              <span class="nt-setting-copy"><strong>Completion threshold</strong><small>Finish this much of the video to count it done.</small></span>
              <span class="nt-setting-control nt-slider-control">
                <input type="range" min="70" max="99" step="1" data-setting-range="autoCompleteAt"
                  value="${NT.util.clamp(store.settings.autoCompleteAt, 70, 99)}" ${store.settings.autoComplete ? "" : "disabled"}>
                <output data-range-output>${store.settings.autoCompleteAt}%</output>
              </span>
            </div>
            ${toggleRow("confirmDelete", "Confirm before deleting", "Ask before a timestamp is removed.")}
          </section>

          <section class="nt-panel">
            ${panelHead("Site sync", "Optional, read-mostly integration with nexttoppers.com.")}
            ${toggleRow(
              "autoIndexCourse",
              "Index courses automatically",
              "Quietly pull lecture lists when you open a course page.",
              !signedIn
            )}
            ${toggleRow(
              "syncBookmarks",
              "Mirror timestamps to the site",
              "Save timestamps to your Next Toppers account as well as locally.",
              !signedIn
            )}
            <div class="nt-setting-row">
              <span class="nt-setting-copy"><strong>Last sync</strong><small>${store.stats().lastSync ? esc(
                NT.util.formatRelative(store.stats().lastSync)
              ) : "Never synced"}</small></span>
              <button class="nt-btn nt-btn-ghost nt-btn-sm" type="button" data-sync>Sync now</button>
            </div>
          </section>

          <section class="nt-panel">
            ${panelHead("Interface", "Where Study Kit appears around the site.")}
            ${toggleRow("showHeaderButton", "Header button", "Add a Study Kit button to the site header.")}
            ${toggleRow("showFloatingTab", "Floating launcher", "Keep a soft launcher in the bottom-right corner.")}
            ${toggleRow("showPlayerButtons", "Player controls", "Add skip, timestamp and done buttons to the video player.")}
            ${toggleRow("compactHub", "Compact hub", "Use a slightly denser layout on smaller screens.")}
          </section>

          <section class="nt-panel">
            ${panelHead("Your data", "Everything is stored in this browser.")}
            <div class="nt-data-actions">
              <button class="nt-data-action" type="button" data-export>
                <span>${NT.icon("download", 18)}</span>
                <div><strong>Export a backup</strong><small>Download progress, notes and settings as JSON.</small></div>
                ${NT.icon("chevronRight", 14)}
              </button>
              <button class="nt-data-action" type="button" data-import>
                <span>${NT.icon("upload", 18)}</span>
                <div><strong>Import a backup</strong><small>Replace this device's Study Kit data.</small></div>
                ${NT.icon("chevronRight", 14)}
              </button>
              <button class="nt-data-action" type="button" data-clear-progress>
                <span>${NT.icon("refresh", 18)}</span>
                <div><strong>Clear progress</strong><small>Reset playback positions and completion.</small></div>
                ${NT.icon("chevronRight", 14)}
              </button>
              <button class="nt-data-action" type="button" data-clear-bookmarks>
                <span>${NT.icon("bookmark", 18)}</span>
                <div><strong>Clear timestamps</strong><small>Remove every local timestamp.</small></div>
                ${NT.icon("chevronRight", 14)}
              </button>
              <button class="nt-data-action nt-data-danger" type="button" data-clear-all>
                <span>${NT.icon("trash", 18)}</span>
                <div><strong>Erase Study Kit data</strong><small>Start completely fresh on this browser.</small></div>
                ${NT.icon("chevronRight", 14)}
              </button>
            </div>
          </section>
        </div>

        <section class="nt-panel nt-shortcut-panel">
          ${panelHead("Shortcuts", "Available while a lecture is open.")}
          <div class="nt-shortcut-grid">
            ${[
              ["← / →", "Seek 10 seconds"],
              ["Shift + ← / →", "Seek 30 seconds"],
              ["K", "Play / pause"],
              ["J / L", "Rewind / forward"],
              ["B", "Save timestamp"],
              ["D", "Mark done"],
              ["M", "Mute"],
              ["F", "Fullscreen"],
              ["Alt + Shift + S", "Open Study Hub"],
              ["Alt + Shift + F", "Quick search"]
            ]
              .map(
                ([key, label]) =>
                  `<div><kbd>${esc(key)}</kbd><span>${esc(label)}</span></div>`
              )
              .join("")}
          </div>
        </section>

        <p class="nt-hub-footnote">Next Toppers Study Kit v${esc(
          NT.VERSION
        )} · Local-first. Site sync uses your existing session and never sends your notes anywhere else.</p>
      </div>`;
  };

  /* ----------------------------------------------------------------- render */

  const viewFor = () => {
    if (state.view === "course") return courseDetailView();
    if (state.view === "courses") return coursesView();
    if (state.view === "lectures") return lecturesView();
    if (state.view === "bookmarks") return bookmarksView();
    if (state.view === "activity") return activityView();
    if (state.view === "settings") return settingsView();
    return homeView();
  };

  const crumbFor = () => {
    if (state.view === "course") return store.getCourse(state.courseId)?.title || "Course";
    return viewMeta[state.view]?.label || "Home";
  };

  const renderView = (options = {}) => {
    if (!hubNode) return;
    // The drawer lives in a shadow root, so document.activeElement is the
    // host — not the focused search field. Read the shadow root's own
    // activeElement or the focus guard below never sees the input.
    const active = hubNode.getRootNode()?.activeElement || document.activeElement;
    // Typing must never rebuild the drawer. Sync and store events fire often;
    // replacing innerHTML here was stealing focus mid-word. Update only the
    // result list so the input node and its caret stay untouched.
    const typingSearch = active?.matches?.("[data-lecture-search]")
      ? "lecture"
      : active?.matches?.("[data-bookmark-search]")
      ? "bookmark"
      : "";
    if (!options.reset && typingSearch) {
      if (typingSearch === "lecture") renderLectureResults();
      else renderBookmarkResults();
      renderBanner();
      return;
    }
    const scroll = hubNode.querySelector(".nt-hub-scroll");
    const scrollTop = options.reset ? 0 : scroll?.scrollTop || 0;
    let restore = null;
    if (!options.reset && active && contentEl.contains(active)) {
      if (active.matches("input, textarea")) {
        restore = {
          selector: active.getAttribute("data-lecture-search") !== null
            ? "[data-lecture-search]"
            : active.getAttribute("data-bookmark-search") !== null
            ? "[data-bookmark-search]"
            : null,
          start: active.selectionStart,
          end: active.selectionEnd
        };
      }
    }

    const main = hubNode.querySelector(".nt-hub-main");
    const top = main.querySelector(".nt-hub-top");
    if (top) top.outerHTML = topBar(crumbFor());
    const crumb = hubNode.querySelector(".nt-hub-crumb");
    void crumb;
    contentEl.innerHTML = viewFor();
    requestAnimationFrame(() => {
      const scroller = hubNode.querySelector(".nt-hub-scroll");
      if (scroller) scroller.scrollTop = scrollTop;
      if (restore?.selector) {
        const field = contentEl.querySelector(restore.selector);
        if (field) {
          field.focus({ preventScroll: true });
          try {
            field.setSelectionRange(restore.start ?? field.value.length, restore.end ?? field.value.length);
          } catch (_) {}
        }
      }
      contentEl.querySelectorAll("img.nt-thumb").forEach((image) => {
        image.addEventListener("error", () => image.classList.add("is-broken"), { once: true });
      });
    });
    hubNode.querySelectorAll("[data-nav]").forEach((button) => {
      button.classList.toggle("is-active", button.dataset.nav === state.view || (state.view === "course" && button.dataset.nav === "courses"));
    });
    renderBanner();
  };

  const scheduleRender = () => {
    if (!isOpen) return;
    clearTimeout(renderTimer);
    renderTimer = setTimeout(() => {
      if (isOpen) renderView();
    }, 120);
  };

  const setView = (view, options = {}) => {
    if (!views.includes(view) && view !== "course") return;
    state.view = view;
    if (view === "course") state.courseId = options.courseId || state.courseId;
    renderView({ reset: true });
  };

  /* ---------------------------------------------------------------- actions */

  const openLecture = (lectureId, seconds = 0) => {
    const lecture = store.getLecture(lectureId);
    if (!lecture) {
      NT.ui.toast("That lecture is no longer indexed.", { type: "error" });
      return;
    }
    const progress = store.getProgress(lecture.id);
    const position = Number(seconds) || (progress && !progress.completed ? progress.position : 0) || 0;
    close();
    setTimeout(() => NT.ui.routeTo(lectureLink(lecture, position)), 40);
  };

  const openBookmark = (bookmarkId) => {
    const bookmark = store.getBookmark(bookmarkId);
    if (!bookmark) return;
    const lecture = store.getLecture(bookmark.lectureId);
    close();
    setTimeout(
      () =>
        NT.ui.routeTo(
          lecture
            ? lectureLink(lecture, bookmark.seconds)
            : NT.routes.playURL(bookmark.lectureId, bookmark.courseId, bookmark.seconds)
        ),
      40
    );
  };

  const toggleDone = (lectureId) => {
    const lecture = store.getLecture(lectureId);
    const done = !store.isDone(lectureId);
    store.markDone(lectureId, done);
    NT.ui.toast(
      `${lecture?.title || "Lecture"} ${done ? "marked done" : "marked not done"}.`,
      { type: done ? "done" : "info", duration: 2200 }
    );
    scheduleRender();
  };

  const syncAll = async () => {
    if (!api.session.loggedIn()) {
      NT.ui.toast("Sign in on nexttoppers.com first, then try syncing.", { type: "error" });
      return;
    }
    try {
      NT.ui.toast("Syncing your courses from nexttoppers.com…", { type: "info" });
      const result = await NT.sync.syncAll({ force: true });
      NT.ui.toast(`Synced ${result.courses} courses · ${result.lectures} lectures.`, {
        type: "success"
      });
      scheduleRender();
    } catch (error) {
      NT.ui.toast(error.message || "Sync failed. Try again.", { type: "error" });
    }
  };

  const syncCourse = async (courseId) => {
    if (!api.session.loggedIn()) {
      NT.ui.toast("Sign in on nexttoppers.com first, then try syncing.", { type: "error" });
      return;
    }
    try {
      const course = store.getCourse(courseId);
      NT.ui.toast(`Indexing ${course?.title || "course"}…`, { type: "info" });
      const result = await NT.sync.indexCourse(courseId, { force: true });
      NT.ui.toast(
        result?.lectures
          ? `Indexed ${result.lectures} lectures.`
          : "No lectures found for this course yet.",
        { type: result?.lectures ? "success" : "info" }
      );
      scheduleRender();
    } catch (error) {
      NT.ui.toast(error.message || "Could not index this course.", { type: "error" });
    }
  };

  const refreshCourses = async () => {
    if (!api.session.loggedIn()) {
      NT.ui.toast("Sign in on nexttoppers.com first, then refresh.", { type: "error" });
      return;
    }
    try {
      const courses = await NT.sync.refreshCourses();
      NT.ui.toast(`Course list refreshed · ${courses.length} courses.`, { type: "success" });
      scheduleRender();
    } catch (error) {
      NT.ui.toast(error.message || "Could not refresh your courses.", { type: "error" });
    }
  };

  const deleteBookmark = async (bookmarkId) => {
    const bookmark = store.getBookmark(bookmarkId);
    if (!bookmark) return;
    const ok = await NT.ui.confirm({
      title: "Delete this timestamp?",
      message: bookmark.note
        ? `“${bookmark.note}” at ${NT.util.formatTime(bookmark.seconds)} will be removed.`
        : `The timestamp at ${NT.util.formatTime(bookmark.seconds)} will be removed.`,
      confirmLabel: "Delete",
      danger: true
    });
    if (!ok) return;
    if (bookmark.siteId && store.settings.syncBookmarks && api.session.loggedIn()) {
      try {
        await api.deleteBookmark(bookmark.siteId);
      } catch (error) {
        NT.ui.toast("Could not delete from nexttoppers.com. Try again.", { type: "error" });
        return;
      }
    }
    store.removeBookmark(bookmarkId);
    NT.ui.toast("Timestamp removed.", { type: "info" });
    scheduleRender();
  };

  const exportData = () => {
    const payload = store.exportData();
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `next-toppers-study-kit-${NT.util.dayKey()}.json`;
    document.documentElement.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    NT.ui.toast("Backup downloaded.", { type: "success" });
  };

  const importData = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json,.json";
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const payload = NT.util.safeJSON(text, null);
        if (!payload) throw new Error("That file is not valid JSON.");
        const ok = await NT.ui.confirm({
          title: "Replace Study Kit data?",
          message: "Your current progress, timestamps and settings will be replaced by this backup.",
          confirmLabel: "Import backup"
        });
        if (!ok) return;
        await store.importData(payload);
        NT.ui.toast("Backup imported.", { type: "success" });
        scheduleRender();
      } catch (error) {
        NT.ui.toast(error.message || "Could not import that backup.", { type: "error" });
      }
    });
    input.click();
  };

  const clearData = async (kind) => {
    const messages = {
      progress: {
        title: "Clear all progress?",
        message: "Playback positions, completion and watch time will be reset. Timestamps stay.",
        action: () => {
          store.clearProgress();
          store.db.meta.totalWatchTime = 0;
          store.db.activity = {};
          store.save();
        }
      },
      bookmarks: {
        title: "Clear every timestamp?",
        message: "All local timestamps and notes will be removed. Progress is not affected.",
        action: () => store.clearBookmarks()
      },
      all: {
        title: "Erase all Study Kit data?",
        message: "Courses, lectures, progress, timestamps and settings on this device will be erased. This cannot be undone.",
        action: () => store.clearAll()
      }
    };
    const config = messages[kind];
    if (!config) return;
    const ok = await NT.ui.confirm({
      title: config.title,
      message: config.message,
      confirmLabel: kind === "all" ? "Erase everything" : "Clear",
      danger: true
    });
    if (!ok) return;
    config.action();
    NT.ui.toast("Study Kit data cleared.", { type: "info" });
    scheduleRender();
  };

  /* ----------------------------------------------------------------- events */

  const onClick = (event) => {
    const target = event.target.closest("[data-close], [data-view], [data-nav], [data-sync], [data-sync-course], [data-refresh-courses], [data-open-course], [data-course-site], [data-open-lecture], [data-open-bookmark], [data-toggle-done], [data-delete-bookmark], [data-search-open], [data-export], [data-import], [data-clear-progress], [data-clear-bookmarks], [data-clear-all], [data-reset-settings], [data-player-bookmark], [data-lecture-filter]");
    if (!target || !hubNode.contains(target)) return;

    if (target.dataset.close !== undefined) {
      close();
    } else if (target.dataset.toggleDone) {
      event.preventDefault();
      event.stopPropagation();
      toggleDone(target.dataset.toggleDone);
    } else if (target.dataset.deleteBookmark) {
      deleteBookmark(target.dataset.deleteBookmark);
    } else if (target.dataset.openLecture) {
      openLecture(target.dataset.openLecture, Number(target.dataset.seconds) || 0);
    } else if (target.dataset.openBookmark) {
      openBookmark(target.dataset.openBookmark);
    } else if (target.dataset.openCourse) {
      setView("course", { courseId: target.dataset.openCourse });
    } else if (target.dataset.courseSite) {
      const course = store.getCourse(target.dataset.courseSite);
      close();
      setTimeout(
        () => NT.ui.routeTo(course ? NT.routes.courseURL(course) : `/courses/course-${target.dataset.courseSite}`),
        40
      );
    } else if (target.dataset.syncCourse) {
      syncCourse(target.dataset.syncCourse);
    } else if (target.dataset.sync !== undefined) {
      syncAll();
    } else if (target.dataset.refreshCourses !== undefined) {
      refreshCourses();
    } else if (target.dataset.searchOpen !== undefined) {
      NT.quickSearch.open();
    } else if (target.dataset.playerBookmark !== undefined) {
      close();
      setTimeout(() => NT.player?.openComposer?.(), 80);
    } else if (target.dataset.view || target.dataset.nav) {
      const view = target.dataset.view || target.dataset.nav;
      setView(view);
    } else if (target.dataset.lectureFilter) {
      state.lectureFilter = target.dataset.lectureFilter;
      renderView();
    } else if (target.dataset.export !== undefined) {
      exportData();
    } else if (target.dataset.import !== undefined) {
      importData();
    } else if (target.dataset.clearProgress !== undefined) {
      clearData("progress");
    } else if (target.dataset.clearBookmarks !== undefined) {
      clearData("bookmarks");
    } else if (target.dataset.clearAll !== undefined) {
      clearData("all");
    } else if (target.dataset.resetSettings !== undefined) {
      NT.ui.confirm({
        title: "Reset Study Kit settings?",
        message: "Your courses, progress and timestamps stay. Only preferences return to defaults.",
        confirmLabel: "Reset settings"
      }).then((ok) => {
        if (!ok) return;
        store.resetSettings();
        NT.ui.toast("Settings reset.", { type: "info" });
        scheduleRender();
      });
    }
  };

  const onChange = (event) => {
    const setting = event.target.closest("[data-setting]");
    if (setting) {
      const key = setting.dataset.setting;
      let value;
      if (setting.type === "checkbox") value = setting.checked;
      else if (setting.tagName === "SELECT") value = Number(setting.value);
      else value = setting.value;
      store.updateSettings({ [key]: value });
      NT.ui.refreshHeader();
      if (key === "autoResume" || key === "showHeaderButton" || key === "enabled") {
        renderView();
      }
      return;
    }
    if (event.target.matches("[data-filter-course]")) {
      state.lectureCourse = event.target.value;
      renderView();
    } else if (event.target.matches("[data-filter-bookmark-course]")) {
      state.bookmarkCourse = event.target.value;
      renderView();
    }
  };

  const onInput = (event) => {
    if (event.target.matches("[data-lecture-search]")) {
      state.lectureQuery = event.target.value;
      clearTimeout(renderTimer);
      renderTimer = setTimeout(() => {
        if (isOpen && !renderLectureResults()) renderView();
      }, 120);
    } else if (event.target.matches("[data-bookmark-search]")) {
      state.bookmarkQuery = event.target.value;
      clearTimeout(renderTimer);
      renderTimer = setTimeout(() => {
        if (isOpen && !renderBookmarkResults()) renderView();
      }, 120);
    } else if (event.target.matches("[data-setting-range]")) {
      const output = event.target.parentElement.querySelector("[data-range-output]");
      if (output) output.textContent = `${event.target.value}%`;
      clearTimeout(renderTimer);
      renderTimer = setTimeout(() => {
        store.updateSettings({ [event.target.dataset.settingRange]: Number(event.target.value) });
      }, 120);
    }
  };

  /* -------------------------------------------------------------- open/close */

  const shell = () => `
    <div class="nt-hub" role="dialog" aria-modal="true" aria-label="Next Toppers Study Hub">
      <aside class="nt-hub-side">
        <div class="nt-hub-brand">
          ${NT.mark(34)}
          <div><strong>next<span>toppers</span></strong><small>STUDY KIT</small></div>
        </div>
        <nav class="nt-hub-nav" aria-label="Study Hub sections">
          ${views
            .filter((view) => view !== "settings")
            .map(
              (view) => `
              <button type="button" data-nav="${view}" class="${state.view === view ? "is-active" : ""}" title="${
                viewMeta[view].label
              }">
                ${NT.icon(viewMeta[view].icon, 19)}
                <span>${viewMeta[view].label}</span>
              </button>`
            )
            .join("")}
        </nav>
        <div class="nt-hub-side-spacer"></div>
        <div class="nt-side-streak">
          <span>${NT.icon("flame", 18)}</span>
          <div><strong>${store.stats().streak} day${store.stats().streak === 1 ? "" : "s"}</strong><small>study streak</small></div>
        </div>
        <button class="nt-side-settings ${state.view === "settings" ? "is-active" : ""}" type="button" data-nav="settings">
          ${NT.icon("settings", 17)}<span>Settings</span>
        </button>
        <div class="nt-hub-profile">
          <span class="nt-hub-avatar">${esc(NT.ui.initials(profile().name || "NT"))}</span>
          <div><strong>${esc(profile().name || "Student")}</strong><small>${esc(
    api.session.loggedIn() ? "Synced account" : "Local account"
  )}</small></div>
        </div>
      </aside>
      <main class="nt-hub-main">
        ${topBar("Home")}
        <div class="nt-hub-banner" hidden></div>
        <div class="nt-hub-scroll"><div class="nt-hub-content"></div></div>
      </main>
    </div>`;

  const open = (options = {}) => {
    if (isOpen && hubNode) {
      if (options.tab) setView(options.tab);
      return;
    }
    isOpen = true;
    hubNode = NT.ui.el("div", "nt-hub-layer");
    hubNode.innerHTML = shell();
    contentEl = hubNode.querySelector(".nt-hub-content");
    bannerEl = hubNode.querySelector(".nt-hub-banner");

    NT.ui.openLayer("nt-study-hub", hubNode, {
      className: "nt-hub-host",
      onClose: () => {
        isOpen = false;
        hubNode = null;
        contentEl = null;
        bannerEl = null;
      }
    });

    hubNode.addEventListener("click", onClick);
    hubNode.addEventListener("click", (event) => {
      if (event.target === hubNode) close();
    });
    hubNode.addEventListener("change", onChange);
    hubNode.addEventListener("input", onInput);
    state.view = options.tab && views.includes(options.tab) ? options.tab : "home";
    renderView({ reset: true });
  };

  const close = () => {
    if (!isOpen) return;
    NT.ui.closeLayer("nt-study-hub");
  };

  // Opening is routed through content.js's lazy loader so the very first
  // click works before this module exists on the page. Keeping a second
  // listener here would open (and re-render) the drawer twice per event.

  NT.sync.on((event, sync) => {
    const wasSyncing = syncState.syncing;
    syncState = { ...sync };
    renderBanner();
    if (event === "course" || event === "courses" || event === "lectures") scheduleRender();
    if (wasSyncing && !sync.syncing && isOpen) scheduleRender();
  });

  store.on((event, payload) => {
    if (!isOpen) return;
    if (event === "settings" && state.view === "settings") {
      // Keep the settings form stable while it is being edited.
      return;
    }
    if (event === "progress" || event === "bookmark" || event === "done" || event === "change") {
      scheduleRender();
    }
  });

  NT.hub = {
    open,
    close,
    setView: (view, options = {}) => {
      if (!isOpen) open({ tab: views.includes(view) ? view : "courses" });
      setView(view, options);
    },
    get view() {
      return state.view;
    },
    get isOpen() {
      return isOpen;
    }
  };
})();
