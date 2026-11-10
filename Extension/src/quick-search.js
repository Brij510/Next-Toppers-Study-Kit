/* Next Toppers Study Kit — command palette / quick search. */
(() => {
  "use strict";

  const NT = globalThis.NT;
  if (NT.quickSearch) return;
  const store = NT.store;

  let node = null;
  let input = null;
  let listEl = null;
  let emptyEl = null;
  let items = [];
  let selected = 0;
  let query = "";
  let isOpen = false;

  const searchOrder = { bookmark: 0, lecture: 1, course: 2, action: 3 };

  const close = () => {
    if (!isOpen) return;
    isOpen = false;
    if (node) node.classList.add("is-closing");
    NT.ui.closeLayer("nt-quick-search");
  };

  const go = (url) => {
    close();
    setTimeout(() => NT.ui.routeTo(url), 40);
  };

  const actions = {
    hub: () => {
      close();
      setTimeout(() => document.dispatchEvent(new CustomEvent("nt:open-hub")), 50);
    },
    settings: () => {
      close();
      setTimeout(
        () => document.dispatchEvent(new CustomEvent("nt:open-hub", { detail: { tab: "settings" } })),
        50
      );
    },
    sync: async () => {
      close();
      try {
        NT.ui.toast("Syncing your courses from nexttoppers.com…", { type: "info" });
        const result = await NT.sync.syncAll({ force: true });
        NT.ui.toast(`Synced ${result.courses} courses · ${result.lectures} lectures.`, {
          type: "success"
        });
      } catch (error) {
        NT.ui.toast(error.message || "Could not sync right now.", { type: "error" });
      }
    },
    done: () => {
      const route = NT.routes.parsePlay();
      if (!route) return;
      const done = !store.isDone(route.contentId);
      store.markDone(route.contentId, done);
      NT.ui.toast(done ? "Lecture marked done." : "Lecture marked not done.", {
        type: done ? "done" : "info"
      });
      close();
    },
    bookmark: () => {
      close();
      setTimeout(() => NT.player?.openComposer?.(), 60);
    }
  };

  const commandList = () => {
    const onPlay = Boolean(NT.routes.parsePlay());
    return [
      {
        type: "action",
        id: "cmd-hub",
        title: "Open Study Hub",
        subtitle: "Your courses, lectures and progress",
        icon: "home",
        keys: "Alt ⇧ S",
        run: actions.hub
      },
      {
        type: "action",
        id: "cmd-sync",
        title: "Sync my courses",
        subtitle: NT.api.session.loggedIn()
          ? "Index the latest lectures from nexttoppers.com"
          : "Sign in on the site to use course sync",
        icon: "refresh",
        run: actions.sync
      },
      {
        type: "action",
        id: "cmd-settings",
        title: "Study Kit settings",
        subtitle: "Shortcuts, auto-resume and backups",
        icon: "settings",
        run: actions.settings
      },
      ...(onPlay
        ? [
            {
              type: "action",
              id: "cmd-bookmark",
              title: "Save a timestamp here",
              subtitle: "Capture the current moment in this lecture",
              icon: "bookmark",
              keys: "B",
              run: actions.bookmark
            },
            {
              type: "action",
              id: "cmd-done",
              title: store.isDone(NT.routes.parsePlay().contentId)
                ? "Mark this lecture not done"
                : "Mark this lecture done",
              subtitle: "Update your local progress",
              icon: "checkCircle",
              keys: "D",
              run: actions.done
            }
          ]
        : [])
    ];
  };

  const allResults = (q) => {
    const entries = [];
    const courses = store.allCourses();
    const lectures = store.allLectures();
    const bookmarks = store.db.bookmarks;

    const continueItem = store.getContinueItem();
    if (!q && continueItem) {
      const lecture = store.getLecture(continueItem.contentId);
      if (lecture) {
        entries.push({
          type: "continue",
          id: `continue-${lecture.id}`,
          title: lecture.title,
          subtitle: `${NT.util.formatTime(continueItem.position)} watched${
            lecture.courseTitle ? ` · ${lecture.courseTitle}` : ""
          }`,
          icon: "playCircle",
          meta: `${Math.round(continueItem.percent || 0)}%`,
          run: () => go(NT.routes.playURL(lecture.playId || lecture.id, lecture.courseId, continueItem.position))
        });
      }
    }

    courses.forEach((course) => {
      const count = (course.lectureIds || []).length;
      let done = 0;
      (course.lectureIds || []).forEach((id) => {
        if (store.isDone(id)) done += 1;
      });
      entries.push({
        type: "course",
        id: `course-${course.id}`,
        title: course.title || `Course ${course.id}`,
        subtitle: `${count ? `${count} lectures` : "Not indexed yet"}${
          done ? ` · ${done} done` : ""
        }`,
        icon: "library",
        keywords: course.description || "",
        meta: count ? `${Math.round((done / count) * 100)}%` : "",
        run: () => go(NT.routes.courseURL(course))
      });
    });

    lectures.forEach((lecture) => {
      const progress = store.getProgress(lecture.id);
      const done = Boolean(progress?.completed || progress?.manualDone);
      entries.push({
        type: "lecture",
        id: `lecture-${lecture.id}`,
        title: lecture.title || "Untitled lecture",
        subtitle: `${lecture.courseTitle || "Lecture"}${done ? " · Done" : ""}`,
        icon: "playCircle",
        keywords: lecture.description || "",
        meta: progress?.percent ? `${Math.round(progress.percent)}%` : "",
        run: () =>
          go(
            NT.routes.playURL(
              lecture.playId || lecture.id,
              lecture.courseId,
              progress && !done ? progress.position : 0
            )
          )
      });
    });

    bookmarks.forEach((bookmark) => {
      const lecture = store.getLecture(bookmark.lectureId);
      entries.push({
        type: "bookmark",
        id: `bookmark-${bookmark.id}`,
        title: bookmark.note || `Timestamp at ${NT.util.formatTime(bookmark.seconds)}`,
        subtitle: `${bookmark.lectureTitle || lecture?.title || "Lecture"} · ${NT.util.formatTime(
          bookmark.seconds
        )}`,
        icon: "bookmark",
        keywords: bookmark.courseTitle || "",
        meta: NT.util.formatTime(bookmark.seconds),
        run: () =>
          go(
            NT.routes.playURL(
              lecture?.playId || bookmark.lectureId,
              bookmark.courseId || lecture?.courseId,
              bookmark.seconds
            )
          )
      });
    });

    entries.push(...commandList());

    if (!q) {
      const priority = { continue: 0, action: 1, course: 2, lecture: 3, bookmark: 4 };
      return entries
        .filter((entry) => entry.type !== "lecture" || store.getProgress(entry.id.replace("lecture-", ""))?.lastWatchedAt)
        .sort((a, b) => (priority[a.type] ?? 9) - (priority[b.type] ?? 9))
        .slice(0, 22);
    }

    return entries
      .map((entry) => {
        const titleScore = NT.util.scoreMatch(entry.title, q);
        const subtitleScore = NT.util.scoreMatch(entry.subtitle, q) * 0.55;
        const keywordScore = NT.util.scoreMatch(entry.keywords || "", q) * 0.4;
        return { entry, score: Math.max(titleScore, subtitleScore, keywordScore) };
      })
      .filter((row) => row.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 40)
      .sort(
        (a, b) =>
          (searchOrder[a.entry.type] ?? 9) - (searchOrder[b.entry.type] ?? 9)
      )
      .map((row) => row.entry);
  };

  const groupLabel = (type) => {
    if (type === "continue") return "Pick up where you left off";
    if (type === "lecture") return "Lectures";
    if (type === "bookmark") return "Timestamps";
    if (type === "course") return "Courses";
    if (type === "action") return "Actions";
    return "Results";
  };

  const iconBox = (entry) =>
    `<span class="nt-palette-icon nt-palette-icon-${entry.type}">${NT.icon(entry.icon, 18)}</span>`;

  const render = () => {
    if (!listEl) return;
    const results = allResults(query);
    items = results;
    selected = Math.min(selected, Math.max(0, results.length - 1));

    if (!results.length) {
      listEl.innerHTML = "";
      emptyEl.hidden = false;
      emptyEl.innerHTML = `
        <div class="nt-palette-empty-icon">${NT.icon("search", 24)}</div>
        <strong>No matches for “${NT.escape(query)}”</strong>
        <span>Try a chapter name, a course, or a note you saved.</span>
        ${
          !store.allLectures().length
            ? `<button class="nt-btn nt-btn-primary" type="button" data-empty-sync>Sync my courses</button>`
            : ""
        }
      `;
      emptyEl.querySelector("[data-empty-sync]")?.addEventListener("click", actions.sync);
      return;
    }

    emptyEl.hidden = true;
    let html = "";
    let lastGroup = "";
    results.forEach((entry, index) => {
      const label = groupLabel(entry.type);
      if (label !== lastGroup) {
        html += `<div class="nt-palette-group">${NT.escape(label)}</div>`;
        lastGroup = label;
      }
      html += `
        <button type="button" class="nt-palette-row ${
          index === selected ? "is-selected" : ""
        }" data-index="${index}" role="option" aria-selected="${index === selected}">
          ${iconBox(entry)}
          <span class="nt-palette-copy">
            <span class="nt-palette-title">${NT.escape(entry.title)}</span>
            <span class="nt-palette-sub">${NT.escape(entry.subtitle || "")}</span>
          </span>
          ${entry.meta ? `<span class="nt-palette-meta">${NT.escape(entry.meta)}</span>` : ""}
          ${entry.keys ? `<kbd class="nt-palette-key">${NT.escape(entry.keys)}</kbd>` : ""}
          <span class="nt-palette-arrow">${NT.icon("chevronRight", 14)}</span>
        </button>
      `;
    });
    listEl.innerHTML = html;

    listEl.querySelectorAll("[data-index]").forEach((row) => {
      row.addEventListener("click", () => run(Number(row.dataset.index)));
      row.addEventListener("mousemove", () => {
        const index = Number(row.dataset.index);
        if (index === selected) return;
        selected = index;
        listEl.querySelectorAll(".nt-palette-row").forEach((item, i) => {
          item.classList.toggle("is-selected", i === selected);
          item.setAttribute("aria-selected", String(i === selected));
        });
      });
    });

    requestAnimationFrame(() => {
      listEl.querySelector(".is-selected")?.scrollIntoView({ block: "nearest" });
    });
  };

  const run = (index) => {
    const entry = items[index];
    if (!entry) return;
    try {
      entry.run?.();
    } catch (error) {
      NT.ui.toast(error.message || "That action failed.", { type: "error" });
    }
  };

  const move = (delta) => {
    if (!items.length) return;
    selected = (selected + delta + items.length) % items.length;
    listEl.querySelectorAll(".nt-palette-row").forEach((row, index) => {
      row.classList.toggle("is-selected", index === selected);
      row.setAttribute("aria-selected", String(index === selected));
    });
    listEl.querySelector(".is-selected")?.scrollIntoView({ block: "nearest" });
  };

  const open = () => {
    if (isOpen) return;
    isOpen = true;
    query = "";
    selected = 0;

    node = NT.ui.el("div", "nt-palette-layer");
    node.innerHTML = `
      <div class="nt-palette-scrim" data-close></div>
      <div class="nt-palette" role="dialog" aria-modal="true" aria-label="Search Study Kit">
        <div class="nt-palette-search">
          <span class="nt-palette-search-icon">${NT.icon("search", 20)}</span>
          <input type="text" autofocus spellcheck="false" autocomplete="off"
            placeholder="Search lectures, timestamps, courses…" aria-label="Search lectures, timestamps and courses">
          <button class="nt-key-chip" type="button" data-close aria-label="Close search">ESC</button>
        </div>
        <div class="nt-palette-body" role="listbox" aria-label="Search results"></div>
        <div class="nt-palette-empty" hidden></div>
        <div class="nt-palette-foot">
          <span><kbd>↑</kbd><kbd>↓</kbd> to move</span>
          <span><kbd>↵</kbd> to open</span>
          <span class="nt-palette-brand">${NT.mark(16)} Study Kit search</span>
        </div>
      </div>
    `;
    input = node.querySelector("input");
    listEl = node.querySelector(".nt-palette-body");
    emptyEl = node.querySelector(".nt-palette-empty");

    NT.ui.openLayer("nt-quick-search", node, {
      className: "nt-palette-host",
      onClose: () => {
        isOpen = false;
        node = null;
      }
    });

    node.querySelectorAll("[data-close]").forEach((btn) => btn.addEventListener("click", close));
    input.addEventListener("input", () => {
      query = input.value.trim();
      selected = 0;
      render();
    });
    node.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        move(1);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        move(-1);
      } else if (event.key === "Enter") {
        event.preventDefault();
        run(selected);
      }
    });

    render();
    setTimeout(() => input?.focus(), 60);
  };

  const toggle = () => {
    if (isOpen) close();
    else open();
  };

  store.on(() => {
    if (isOpen) render();
  });

  NT.quickSearch = { open, close, toggle, get isOpen() { return isOpen; } };
})();
