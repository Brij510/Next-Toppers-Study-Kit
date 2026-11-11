/* Next Toppers Study Kit — native-feeling player controls + study tools. */
(() => {
  "use strict";

  const NT = globalThis.NT;
  if (NT.player) return;
  const store = NT.store;

  let route = null;
  let state = null;
  let lastState = null;
  let controlsTimer = 0;
  let controlsGroup = null;
  let markers = null;
  let dockOpen = false;
  let dockTab = "bookmarks";
  let composer = null;
  let resumeCard = null;
  let resumeCleanup = null;
  let resumeChecked = false;
  let resumeDone = false;
  let deepLink = null;
  let lastProgressSave = 0;
  let lastPosition = 0;
  let lastWall = 0;
  let watchBuffer = 0;
  let lastBookmarkCount = -1;
  let lastDone = false;
  let completionAnnounced = false;
  let syncTimer = 0;
  let active = false;
  let boundStore = false;
  const msgQueue = new Map();
  let msgId = 0;

  const clamp = NT.util.clamp;

  /* ------------------------------------------------------------ bridge I/O */

  const bridge = (action, args = {}, timeout = 4000) =>
    new Promise((resolve, reject) => {
      const id = `nt_${Date.now()}_${(msgId += 1)}`;
      const timer = setTimeout(() => {
        msgQueue.delete(id);
        reject(new Error("The player did not respond."));
      }, timeout);
      msgQueue.set(id, { resolve, reject, timer });
      window.postMessage({ source: "nt-kit", kind: "command", id, action, args }, location.origin);
    });

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    if (event.origin && event.origin !== location.origin) return;
    const msg = event.data;
    if (!msg || msg.source !== "nt-page") return;

    if (msg.kind === "response") {
      const pending = msgQueue.get(msg.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      msgQueue.delete(msg.id);
      if (msg.ok) pending.resolve(msg.result);
      else pending.reject(new Error(msg.error || "Player command failed."));
      return;
    }

    if (msg.kind === "player-state" || msg.kind === "player-ready") {
      if (msg.state) applyState(msg.state);
      if (msg.kind === "player-ready") {
        setTimeout(ensureControls, 100);
        setTimeout(ensureControls, 900);
      }
      return;
    }

    if (msg.kind === "player-gone") {
      state = null;
      controlsGroup?.remove();
      controlsGroup = null;
      markers?.remove();
      markers = null;
    }
  });

  const announceCompletion = (duration) => {
    if (completionAnnounced) return;
    completionAnnounced = true;
    const minutes = Math.round(duration / 60);
    NT.ui.toast(`Lecture complete — ${minutes || "few"} min in the books.`, {
      type: "done",
      action: { label: "View progress", onClick: () => openDock("bookmarks") }
    });
  };

  const applyState = (next) => {
    lastState = state;
    state = next;
    if (!active || !route) return;
    if (next.reading || next.duration == null) return;

    const contentId = route.contentId;
    const lecture = store.getLecture(contentId);
    const courseId = route.courseId || lecture?.courseId || "";

    // Persist the exact pause point instead of waiting for the next 2.2s tick.
    // Only a real playing→paused transition counts: the initial placeholder
    // state (or a missing state) must not overwrite a saved position with 0:00.
    if (next.paused && lastState?.paused === false) flushWatch();

    if (lecture?.title) {
      const progress = store.getProgress(contentId);
      if (progress?.lectureTitle !== lecture.title) {
        store.setProgress(contentId, { lectureTitle: lecture.title }, { silent: true });
      }
    }

    updateControlState();
    updateMarkers();

    const position = Number(next.time) || 0;
    const duration = Number(next.duration) || 0;
    const now = Date.now();
    const existing = store.getProgress(contentId);
    // A freshly opened player reports 0:00 before the resume decision. Writing
    // that over a saved position would erase the very place we want to resume.
    const protectingSavedPosition =
      position < 1 && existing && existing.position > 15 && !existing.completed;

    // A timestamp deep link is more specific than a saved resume point, so it
    // must get the first chance to move the playhead.
    const deepSeeked = maybeDeepLink(next);
    if (!deepSeeked) maybeResume(next);

    if (
      !protectingSavedPosition &&
      store.settings.saveProgress &&
      !next.isLive &&
      duration > 30 &&
      (now - lastProgressSave > 2200 || Math.abs(position - lastPosition) > 12)
    ) {
      const previousDone = store.isDone(contentId);
      store.touchProgress(contentId, position, duration, { silent: true });
      lastProgressSave = now;
      const done = store.isDone(contentId);
      if (done && !previousDone) announceCompletion(duration);
    } else if (
      // "Remember my place" only controls resume positions. Completion is a
      // separate setting, so the threshold must still work when position
      // saving is off.
      store.settings.autoComplete &&
      !next.isLive &&
      duration > 30 &&
      !store.isDone(contentId) &&
      (position / duration) * 100 >= (Number(store.settings.autoCompleteAt) || 92)
    ) {
      store.markDone(contentId, true, { automatic: true });
      if (store.isDone(contentId)) announceCompletion(duration);
    }

    const moved =
      lastState && Number(lastState.time) >= 0
        ? Math.max(0, position - Number(lastState.time))
        : 0;
    if (!next.paused && moved > 0 && moved < 4 && lastWall) {
      watchBuffer += moved;
      if (watchBuffer >= 10) {
        store.addWatchTime(watchBuffer);
        watchBuffer = 0;
      }
    }
    lastWall = now;
    lastPosition = position;

    if ((next.ended || (duration > 0 && position >= duration - 0.5)) && store.settings.autoComplete) {
      if (!store.isDone(contentId)) {
        store.markDone(contentId, true, { automatic: true });
        if (store.isDone(contentId)) {
          completionAnnounced = true;
          NT.ui.toast("Lecture marked done.", { type: "done" });
        }
      }
    }
  };

  const flushWatch = () => {
    if (watchBuffer > 1) {
      store.addWatchTime(watchBuffer);
      watchBuffer = 0;
    }
    if (
      route &&
      state?.ready &&
      store.settings.saveProgress &&
      !state.isLive &&
      Number(state.duration) > 30
    ) {
      store.touchProgress(route.contentId, state.time, state.duration, { silent: true });
    }
  };

  /* --------------------------------------------------------------- controls */

  const SWAP = (direction) => `
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="${direction < 0 ? "M9 6 3.5 12 9 18" : "M15 6 20.5 12 15 18"}"/>
      <text x="${direction < 0 ? 17 : 7}" y="14.6" text-anchor="middle" font-size="7.5" font-family="Poppins,sans-serif" font-weight="600" fill="currentColor" stroke="none">10</text>
    </svg>`;

  const makeButton = (action, label, tip, html, extra = "") => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `nt-vjs-btn ${extra}`.trim();
    button.dataset.ntAction = action;
    button.setAttribute("aria-label", label);
    button.innerHTML = `${html}<span class="nt-vjs-tip">${NT.escape(tip)}</span>`;
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      handleAction(action);
    });
    return button;
  };

  const ensureControls = () => {
    if (!active || !route) return;
    const bar = document.querySelector(".vjs-control-bar");
    if (!bar) return;
    if (controlsGroup && controlsGroup.isConnected && controlsGroup.parentElement === bar) {
      updateControlState();
      ensureMarkers();
      return;
    }
    controlsGroup?.remove();
    markers?.remove();
    markers = null;

    const group = document.createElement("div");
    group.className = "nt-vjs-group";
    group.setAttribute("role", "group");
    group.setAttribute("aria-label", "Study Kit");
    group.appendChild(
      makeButton("back", "Rewind 10 seconds", "Back 10s  ←", SWAP(-1))
    );
    group.appendChild(
      makeButton("forward", "Forward 10 seconds", "Forward 10s  →", SWAP(1))
    );
    group.appendChild(
      makeButton(
        "bookmark",
        "Save this timestamp",
        "Save timestamp  B",
        NT.icon("bookmark", 20),
        "nt-vjs-bookmark"
      )
    );
    group.appendChild(
      makeButton(
        "done",
        "Mark lecture done",
        "Mark done  D",
        NT.icon("checkCircle", 20),
        "nt-vjs-done"
      )
    );
    group.appendChild(
      makeButton(
        "dock",
        "Open Study Kit",
        "Study Kit",
        `<span class="nt-vjs-mark">${NT.mark(19)}</span>`,
        "nt-vjs-panel"
      )
    );

    const anchor =
      bar.querySelector(".vjs-fullscreen-control") ||
      bar.querySelector(".vjs-picture-in-picture-control") ||
      null;
    if (anchor && anchor.parentElement === bar) bar.insertBefore(group, anchor);
    else bar.appendChild(group);

    controlsGroup = group;
    updateControlState();
    ensureMarkers();
  };

  const ensureMarkers = () => {
    if (!active || !route) return;
    const holder =
      document.querySelector(".vjs-progress-holder") ||
      document.querySelector(".vjs-progress-control");
    if (!holder) return;
    if (markers && markers.isConnected && markers.parentElement === holder) return;
    markers?.remove();
    markers = document.createElement("div");
    markers.className = "nt-progress-markers";
    markers.setAttribute("aria-hidden", "true");
    holder.appendChild(markers);
    updateMarkers();
  };

  const updateMarkers = () => {
    if (!markers || !route) return;
    const duration = Number(state?.duration) || 0;
    if (!duration) {
      markers.innerHTML = "";
      return;
    }
    const bookmarks = store.getLectureBookmarks(route.contentId);
    if (bookmarks.length === lastBookmarkCount) {
      markers.querySelectorAll("[data-marker]").forEach((dot) => {
        const bookmark = store.getBookmark(dot.dataset.marker);
        if (bookmark) dot.style.left = `${clamp((bookmark.seconds / duration) * 100, 0, 100)}%`;
      });
      return;
    }
    lastBookmarkCount = bookmarks.length;
    markers.innerHTML = bookmarks
      .map((bookmark) => {
        const percent = clamp((bookmark.seconds / duration) * 100, 0, 100);
        return `<button type="button" class="nt-progress-dot" data-marker="${NT.escape(
          bookmark.id
        )}" style="left:${percent}%" title="${NT.escape(
          `${NT.util.formatTime(bookmark.seconds)}${bookmark.note ? ` · ${bookmark.note}` : ""}`
        )}" aria-label="${NT.escape(`Jump to ${NT.util.formatTime(bookmark.seconds)}`)}"></button>`;
      })
      .join("");
    markers.querySelectorAll("[data-marker]").forEach((dot) => {
      dot.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const bookmark = store.getBookmark(dot.dataset.marker);
        if (bookmark) seek(bookmark.seconds, true);
      });
    });
  };

  const updateControlState = () => {
    if (!controlsGroup || !route) return;
    const done = store.isDone(route.contentId);
    const doneButton = controlsGroup.querySelector(".nt-vjs-done");
    doneButton?.classList.toggle("is-active", done);
    if (doneButton) {
      doneButton.setAttribute("aria-label", done ? "Mark lecture not done" : "Mark lecture done");
      doneButton.querySelector(".nt-vjs-tip").textContent = done ? "Done ✓  D" : "Mark done  D";
    }
    const count = store.bookmarkCount(route.contentId);
    const bookmarkButton = controlsGroup.querySelector(".nt-vjs-bookmark");
    if (bookmarkButton) {
      bookmarkButton.classList.toggle("has-bookmarks", count > 0);
      bookmarkButton.setAttribute(
        "aria-label",
        count ? `Save timestamp (${count} saved)` : "Save this timestamp"
      );
      const tip = bookmarkButton.querySelector(".nt-vjs-tip");
      if (tip) tip.textContent = count ? `${count} timestamp${count > 1 ? "s" : ""}  B` : "Save timestamp  B";
    }
    if (done !== lastDone) lastDone = done;
  };

  const handleAction = (action) => {
    if (action === "back") seekBy(-(store.settings.seekSeconds || 10));
    else if (action === "forward") seekBy(store.settings.seekSeconds || 10);
    else if (action === "bookmark") openComposer();
    else if (action === "done") toggleDone();
    else if (action === "dock") openDock(dockTab);
  };

  const seekBy = async (delta) => {
    if (!state?.ready) return;
    try {
      const target = await bridge("seekBy", { delta });
      const label = delta < 0 ? "Back" : "Forward";
      NT.ui.osd(`${label} ${Math.abs(delta)}s · ${NT.util.formatTime(target)}`, {
        icon: delta < 0 ? "chevronLeft" : "chevronRight"
      });
    } catch (error) {
      NT.ui.toast(error.message, { type: "error" });
    }
  };

  const seek = async (seconds, announce = false) => {
    try {
      const target = await bridge("seek", { seconds });
      if (announce) {
        NT.ui.osd(`Jumped to ${NT.util.formatTime(target)}`, { icon: "clock" });
      }
      return target;
    } catch (error) {
      NT.ui.toast(error.message, { type: "error" });
      return null;
    }
  };

  const togglePlay = async () => {
    try {
      await bridge("toggle");
    } catch (error) {
      NT.ui.toast(error.message, { type: "error" });
    }
  };

  const toggleMute = async () => {
    try {
      const muted = await bridge("toggleMute");
      NT.ui.osd(muted ? "Muted" : "Sound on", { icon: muted ? "mute" : "volume" });
    } catch (_) {}
  };

  const toggleFullscreen = async () => {
    try {
      await bridge("fullscreen");
    } catch (_) {}
  };

  const toggleDone = () => {
    if (!route) return;
    const wasDone = store.isDone(route.contentId);
    store.toggleDone(route.contentId);
    const done = !wasDone;
    NT.ui.toast(done ? "Lecture marked done." : "Lecture marked not done.", {
      type: done ? "done" : "info",
      action: done ? { label: "Undo", onClick: () => store.toggleDone(route.contentId) } : null
    });
    updateControlState();
    updateDock();
    updateMarkers();
  };

  /* ------------------------------------------------------------- keyboard */

  const onKeyDown = (event) => {
    if (!active || !state?.ready) return;
    if (!store.settings.enabled) return;
    if (!store.settings.shortcuts) return;
    if (NT.util.isTypingTarget(event.target)) return;
    if (NT.ui.layerCount() > 0) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.target?.closest?.("button, a, [role='button']") && event.key === " ") return;

    const step = Number(store.settings.seekSeconds) || 10;
    const longStep = Number(store.settings.longSeekSeconds) || 30;
    let handled = true;

    switch (event.key) {
      case "ArrowLeft":
        seekBy(event.shiftKey ? -longStep : -step);
        break;
      case "ArrowRight":
        seekBy(event.shiftKey ? longStep : step);
        break;
      case "ArrowUp":
        bridge("setVolume", { volume: clamp((state.volume || 0) + 0.05, 0, 1) })
          .then(() => NT.ui.osd(`Volume ${Math.round(clamp((state.volume || 0) + 0.05, 0, 1) * 100)}%`, { icon: "volume" }))
          .catch(() => {});
        break;
      case "ArrowDown":
        bridge("setVolume", { volume: clamp((state.volume || 0) - 0.05, 0, 1) })
          .then(() => NT.ui.osd(`Volume ${Math.round(clamp((state.volume || 0) - 0.05, 0, 1) * 100)}%`, { icon: "volume" }))
          .catch(() => {});
        break;
      case " ":
      case "Spacebar":
        if (event.repeat) break;
        togglePlay();
        break;
      case "k":
      case "K":
        togglePlay();
        break;
      case "j":
      case "J":
        seekBy(-step);
        break;
      case "l":
      case "L":
        seekBy(step);
        break;
      case "m":
      case "M":
        toggleMute();
        break;
      case "f":
      case "F":
        toggleFullscreen();
        break;
      case "b":
      case "B":
        openComposer();
        break;
      case "d":
      case "D":
        toggleDone();
        break;
      case "?":
        openDock("shortcuts");
        break;
      default:
        handled = false;
    }

    if (handled) {
      event.preventDefault();
      event.stopPropagation();
    }
  };

  /* ---------------------------------------------------------- resume logic */

  const maybeDeepLink = (next) => {
    if (!deepLink || resumeDone || !next.duration || next.duration < 5) return false;
    const link = deepLink;
    const requested = Number(link.seconds) || 0;
    deepLink = null;
    if (requested <= 0) return false;
    const target = Math.min(requested, Math.max(0, next.duration - 1));
    const routeKey = `${route?.contentId || ""}:${route?.courseId || ""}`;
    resumeDone = true;
    resumeChecked = true;
    seek(target, true).then((value) => {
      if (value != null) return;
      // A live stream or a player that was not ready can reject the seek. If
      // the learner is still on this lecture, retry once on the next player
      // state, then fall back to the normal local-resume path.
      if (!active || `${route?.contentId || ""}:${route?.courseId || ""}` !== routeKey) return;
      if (!link.retried && !deepLink) {
        link.retried = true;
        deepLink = link;
      }
      resumeDone = false;
      resumeChecked = false;
    });
    return true;
  };

  const maybeResume = (next) => {
    if (resumeChecked || resumeDone || !next.duration || next.duration < 60) return;
    if (next.time > 8) {
      resumeChecked = true;
      return;
    }
    resumeChecked = true;
    const progress = store.getProgress(route.contentId);
    if (!progress || !progress.position) return;
    if (progress.position < 15 || progress.position >= next.duration - 25) return;
    if (store.isDone(route.contentId) && !progress.position) return;

    if (store.settings.autoResume) {
      seek(progress.position).then((target) => {
        if (target == null) return;
        NT.ui.toast(`Picked up at ${NT.util.formatTime(target)}`, {
          type: "time",
          action: {
            label: "Start over",
            onClick: () => seek(0)
          }
        });
      });
      return;
    }

    if (!store.settings.showResumePrompt) return;
    showResumeCard(progress.position);
  };

  const showResumeCard = (seconds) => {
    resumeCleanup?.();
    resumeCard?.remove();
    const lecture = NT.ui.lectureForContent(route.contentId);
    const node = NT.ui.el("div", "nt-resume");
    node.innerHTML = `
      <button class="nt-resume-close" type="button" aria-label="Dismiss resume prompt">${NT.icon(
        "x",
        14
      )}</button>
      <div class="nt-resume-eyebrow">Continue where you left off</div>
      <div class="nt-resume-title">${NT.escape(lecture.title || "This lecture")}</div>
      <div class="nt-resume-row">
        <span class="nt-resume-time">${NT.icon("clock", 14)} ${NT.util.formatTime(seconds)}</span>
        <span class="nt-resume-hint">${Math.round(store.getProgress(route.contentId)?.percent || 0)}% watched</span>
      </div>
      <div class="nt-resume-actions">
        <button class="nt-btn nt-btn-ghost" data-start type="button">Start over</button>
        <button class="nt-btn nt-btn-primary" data-resume type="button">Resume at ${NT.util.formatTime(
          seconds
        )}</button>
      </div>
    `;
    const root = NT.ui.mount().querySelector(".nt-root");
    root.appendChild(node);
    resumeCard = node;
    setTimeout(() => node.classList.add("is-in"), 30);

    // Keep the prompt clear of the native control bar, which usually sits at
    // the bottom of the player. Falling back to the CSS offset is fine when
    // the site uses a custom player without Video.js controls.
    const positionCard = () => {
      if (!resumeCard) return;
      const bar =
        document.querySelector(".video-js .vjs-control-bar") ||
        document.querySelector(".vjs-control-bar");
      const player =
        document.querySelector(".video-js") || document.querySelector("video");
      const cardH = resumeCard.offsetHeight || 144;

      if (window.innerWidth <= 640) {
        // Mobile reads best as a bottom sheet instead of a floating card.
        resumeCard.style.left = "";
        resumeCard.style.right = "";
        resumeCard.style.bottom = "12px";
        return;
      }

      const rect = bar?.getBoundingClientRect();
      if (rect && rect.height && rect.top > 0 && rect.top < window.innerHeight) {
        const offset = window.innerHeight - rect.top + 12;
        const max = Math.max(16, window.innerHeight - cardH - 8);
        resumeCard.style.bottom = `${Math.min(Math.max(16, offset), max)}px`;
      } else {
        resumeCard.style.bottom = "92px";
      }

      // Keep the prompt visually inside the player column.
      const bounds = player?.getBoundingClientRect();
      if (bounds && bounds.width > 380) {
        const cardW = resumeCard.offsetWidth || 340;
        const left = Math.min(
          Math.max(16, bounds.left + 18),
          window.innerWidth - cardW - 16
        );
        resumeCard.style.left = `${left}px`;
      } else {
        resumeCard.style.left = "";
      }
    };
    const reposition = () => positionCard();
    positionCard();
    requestAnimationFrame(positionCard);
    window.addEventListener("scroll", reposition, { passive: true });
    window.addEventListener("resize", reposition);
    resumeCleanup = () => {
      window.removeEventListener("scroll", reposition);
      window.removeEventListener("resize", reposition);
      resumeCleanup = null;
    };

    const dismiss = () => {
      resumeCleanup?.();
      node.classList.remove("is-in");
      setTimeout(() => node.remove(), 180);
      if (resumeCard === node) resumeCard = null;
    };
    node.querySelector(".nt-resume-close").addEventListener("click", dismiss);
    node.querySelector("[data-start]").addEventListener("click", () => {
      seek(0);
      dismiss();
    });
    node.querySelector("[data-resume]").addEventListener("click", () => {
      seek(seconds);
      dismiss();
    });
    setTimeout(dismiss, 12000);
  };

  /* --------------------------------------------------------- bookmark flow */

  const openComposer = (options = {}) => {
    if (!route || !state?.ready) {
      NT.ui.toast("Start the lecture first, then save a timestamp.", { type: "info" });
      return;
    }
    if (composer) {
      composer.querySelector("textarea, input")?.focus();
      return;
    }
    const seconds = Math.max(0, Math.floor(Number(options.seconds ?? state.time) || 0));
    const lecture = NT.ui.lectureForContent(route.contentId);
    const course = store.getCourse(route.courseId);
    const canSync = store.settings.syncBookmarks && NT.api.session.loggedIn();
    const card = NT.ui.el("div", "nt-composer-card");
    card.innerHTML = `
      <div class="nt-composer-head">
        <div class="nt-composer-mark">${NT.icon("bookmarkFilled", 16)}</div>
        <div>
          <div class="nt-composer-title">Save this moment</div>
          <div class="nt-composer-sub">${NT.escape(lecture.title || "Lecture")}${
      course?.title ? ` · ${NT.escape(course.title)}` : ""
    }</div>
        </div>
        <button class="nt-icon-btn" data-close type="button" aria-label="Close">${NT.icon("x", 16)}</button>
      </div>
      <div class="nt-composer-time">
        ${NT.icon("clock", 15)}
        <strong>${NT.util.formatTime(seconds)}</strong>
        <span>timestamp</span>
      </div>
      <textarea data-note rows="3" maxlength="220" placeholder="Add a note (optional) — e.g. revise this derivation"></textarea>
      <div class="nt-composer-foot">
        ${
          canSync
            ? `<label class="nt-check"><input type="checkbox" data-sync checked><span></span>Also save to Next Toppers</label>`
            : `<span class="nt-composer-local">${NT.icon("cloud", 14)} Saved on this device</span>`
        }
        <div class="nt-composer-buttons">
          <button class="nt-btn nt-btn-ghost" data-cancel type="button">Cancel</button>
          <button class="nt-btn nt-btn-primary" data-save type="button">Save timestamp</button>
        </div>
      </div>
    `;

    const node = NT.ui.el("div", "nt-composer-scrim");
    node.appendChild(card);

    const layer = NT.ui.openLayer("nt-composer", node, {
      className: "nt-composer-layer",
      lockScroll: false,
      onClose: () => {
        if (composer === node) composer = null;
      }
    });
    void layer;
    composer = node;
    const input = card.querySelector("[data-note]");
    const grow = () => {
      input.style.height = "auto";
      input.style.height = `${Math.min(150, Math.max(76, input.scrollHeight))}px`;
    };
    input.addEventListener("input", grow);
    grow();
    setTimeout(() => input.focus(), 80);

    const close = () => NT.ui.closeLayer("nt-composer");
    const save = async () => {
      const note = input.value.trim();
      const syncRemote = Boolean(card.querySelector("[data-sync]")?.checked);
      const button = card.querySelector("[data-save]");
      button.disabled = true;
      button.textContent = "Saving…";
      const bookmark = store.upsertBookmark({
        lectureId: route.contentId,
        courseId: route.courseId,
        lectureTitle: lecture.title || "",
        courseTitle: course?.title || "",
        seconds,
        note
      });
      close();
      updateMarkers();
      updateDock();
      updateControlState();

      if (syncRemote) {
        try {
          const remote = await NT.api.addBookmark({
            lectureId: route.contentId,
            courseId: route.courseId,
            seconds,
            note
          });
          if (remote?.id) {
            store.upsertBookmark({
              id: bookmark.id,
              siteId: remote.id,
              remote: true,
              lectureId: route.contentId,
              courseId: route.courseId,
              seconds,
              note
            });
          }
          NT.ui.toast(`Timestamp saved at ${NT.util.formatTime(seconds)}.`, {
            type: "bookmark",
            action: { label: "View", onClick: () => openDock("bookmarks") }
          });
        } catch (error) {
          NT.ui.toast("Saved locally — the site sync failed.", {
            type: "error",
            action: { label: "Retry from Study Hub", onClick: () => openDock("bookmarks") }
          });
          console.warn("[Study Kit] Bookmark sync failed", error);
        }
      } else {
        NT.ui.toast(`Timestamp saved at ${NT.util.formatTime(seconds)}.`, {
          type: "bookmark",
          action: { label: "View", onClick: () => openDock("bookmarks") }
        });
      }
    };

    card.querySelector("[data-close]").addEventListener("click", close);
    card.querySelector("[data-cancel]").addEventListener("click", close);
    card.querySelector("[data-save]").addEventListener("click", save);
    card.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        save();
      }
    });
    node.addEventListener("mousedown", (event) => {
      if (event.target === node) close();
    });
  };

  const removeBookmark = async (id) => {
    const bookmark = store.getBookmark(id);
    if (!bookmark) return;
    if (store.settings.confirmDelete) {
      const ok = await NT.ui.confirm({
        title: "Delete this timestamp?",
        message: bookmark.note
          ? `“${bookmark.note}” at ${NT.util.formatTime(bookmark.seconds)} will be removed.`
          : `The timestamp at ${NT.util.formatTime(bookmark.seconds)} will be removed.`,
        confirmLabel: "Delete",
        danger: true
      });
      if (!ok) return;
    }

    if (bookmark.siteId && store.settings.syncBookmarks && NT.api.session.loggedIn()) {
      try {
        await NT.api.deleteBookmark(bookmark.siteId);
      } catch (error) {
        NT.ui.toast("Could not delete from nexttoppers.com. Try again.", { type: "error" });
        return;
      }
    }
    store.removeBookmark(id);
    updateMarkers();
    updateDock();
    updateControlState();
    NT.ui.toast("Timestamp removed.", { type: "info" });
  };

  /* ------------------------------------------------------------------- dock */

  const openDock = (tab = "bookmarks") => {
    dockTab = tab;
    if (NT.ui.hasLayer("nt-player-dock")) {
      const existing = NT.ui.root?.querySelector(".nt-player-dock");
      if (existing) renderDock(existing);
      return;
    }
    const host = NT.ui.el("div", "nt-dock-host");
    const node = NT.ui.el("aside", "nt-player-dock");
    node.setAttribute("role", "dialog");
    node.setAttribute("aria-label", "Study Kit lecture panel");
    host.appendChild(node);
    NT.ui.openLayer("nt-player-dock", host, {
      lockScroll: false,
      onClose: () => {
        dockOpen = false;
      }
    });
    dockOpen = true;
    renderDock(node);

    node.addEventListener("click", (event) => {
      const action = event.target.closest("[data-act]");
      if (!action) return;
      const act = action.dataset.act;
      if (act === "close") NT.ui.closeLayer("nt-player-dock");
      else if (act === "tab") {
        dockTab = action.dataset.tab;
        renderDock(node);
      } else if (act === "play") seek(Number(action.dataset.seconds), true);
      else if (act === "delete") removeBookmark(action.dataset.id);
      else if (act === "hub") {
        NT.ui.closeLayer("nt-player-dock");
        document.dispatchEvent(new CustomEvent("nt:open-hub"));
      } else if (act === "done") toggleDone();
      else if (act === "bookmark") openComposer();
    });
  };

  const updateDock = () => {
    const node = NT.ui.root?.querySelector(".nt-player-dock");
    if (node && dockOpen) renderDock(node);
  };

  const renderDock = (node) => {
    if (!route) return;
    const lecture = NT.ui.lectureForContent(route.contentId);
    const course = store.getCourse(route.courseId);
    const bookmarks = store.getLectureBookmarks(route.contentId);
    const progress = store.getProgress(route.contentId);
    const done = store.isDone(route.contentId);
    const percent = Math.round(progress?.percent || 0);
    const time = state ? NT.util.formatTime(state.time) : "0:00";

    const bookmarkRows = bookmarks.length
      ? bookmarks
          .map(
            (bookmark) => `
            <li class="nt-dock-bm">
              <button class="nt-dock-bm-time" type="button" data-act="play" data-seconds="${
                bookmark.seconds
              }">${NT.util.formatTime(bookmark.seconds)}</button>
              <div class="nt-dock-bm-copy">
                <span>${NT.escape(bookmark.note || "Timestamp")}</span>
                <small>${NT.ui.relativeDay(bookmark.createdAt)}</small>
              </div>
              <button class="nt-icon-btn nt-dock-bm-del" type="button" data-act="delete" data-id="${NT.escape(
                bookmark.id
              )}" aria-label="Delete timestamp">${NT.icon("trash", 14)}</button>
            </li>`
          )
          .join("")
      : `<li class="nt-dock-empty">${NT.icon("bookmark", 22)}<span>No timestamps yet.<br>Press <kbd>B</kbd> while watching.</span></li>`;

    const shortcutRows = [
      ["Space / K", "Play / pause"],
      ["← / →", "Seek 10 seconds"],
      ["Shift + ← / →", "Seek 30 seconds"],
      ["J / L", "Rewind / forward 10s"],
      ["B", "Save a timestamp"],
      ["D", "Mark lecture done"],
      ["M", "Mute"],
      ["F", "Fullscreen"],
      ["?", "This panel"]
    ]
      .map(
        ([key, label]) =>
          `<li><kbd>${NT.escape(key)}</kbd><span>${NT.escape(label)}</span></li>`
      )
      .join("");

    node.innerHTML = `
      <div class="nt-dock-head">
        <span class="nt-dock-mark">${NT.mark(26)}</span>
        <div class="nt-dock-heading">
          <strong>Study Kit</strong>
          <span>${NT.escape(course?.title || lecture.courseTitle || "Lecture tools")}</span>
        </div>
        <button class="nt-icon-btn" type="button" data-act="close" aria-label="Close panel">${NT.icon(
          "x",
          16
        )}</button>
      </div>
      <div class="nt-dock-lecture">
        <div class="nt-dock-lecture-title">${NT.escape(lecture.title || "Untitled lecture")}</div>
        <div class="nt-dock-lecture-meta">
          <span>${time}</span>
          <span>${percent}% watched</span>
          ${done ? `<span class="nt-dock-done">${NT.icon("check", 12)} Done</span>` : ""}
        </div>
        <div class="nt-dock-track"><span style="width:${clamp(percent, 0, 100)}%"></span></div>
      </div>
      <div class="nt-dock-tabs" role="tablist">
        <button type="button" role="tab" data-act="tab" data-tab="bookmarks" class="${
          dockTab === "bookmarks" ? "is-active" : ""
        }" aria-selected="${dockTab === "bookmarks"}">Timestamps <b>${bookmarks.length}</b></button>
        <button type="button" role="tab" data-act="tab" data-tab="shortcuts" class="${
          dockTab === "shortcuts" ? "is-active" : ""
        }" aria-selected="${dockTab === "shortcuts"}">Shortcuts</button>
      </div>
      <div class="nt-dock-body">
        ${
          dockTab === "bookmarks"
            ? `<ul class="nt-dock-list">${bookmarkRows}</ul>`
            : `<ul class="nt-dock-keys">${shortcutRows}</ul>`
        }
      </div>
      <div class="nt-dock-foot">
        <button class="nt-btn nt-btn-soft" type="button" data-act="done">
          ${NT.icon(done ? "checkCircle" : "check", 15)}
          ${done ? "Marked done" : "Mark done"}
        </button>
        <button class="nt-btn nt-btn-primary" type="button" data-act="bookmark">
          ${NT.icon("bookmark", 15)} Save timestamp
        </button>
        <button class="nt-dock-hub" type="button" data-act="hub">Open Study Hub ${NT.icon(
          "chevronRight",
          14
        )}</button>
      </div>
    `;
  };

  /* ------------------------------------------------------------------- init */

  const init = (options = {}) => {
    cleanup();
    route = NT.routes.parsePlay();
    if (!route) return false;
    active = true;
    resumeChecked = false;
    resumeDone = false;
    completionAnnounced = false;
    lastBookmarkCount = -1;
    lastState = null;
    state = null;
    watchBuffer = 0;
    lastWall = 0;
    lastPosition = 0;
    lastProgressSave = 0;

    const params = new URLSearchParams(location.search);
    const nt = Number(params.get("nt_t"));
    if (Number.isFinite(nt) && nt > 0) {
      deepLink = { seconds: nt };
      // Clean the URL so refreshes and shares stay canonical.
      try {
        const url = new URL(location.href);
        url.searchParams.delete("nt_t");
        history.replaceState(history.state, "", url.pathname + url.search + url.hash);
      } catch (_) {}
    }

    if (!boundStore) {
      boundStore = true;
      store.on(() => {
        if (!active) return;
        updateControlState();
        updateMarkers();
        updateDock();
      });
    }

    ensureControls();
    controlsTimer = setInterval(ensureControls, 900);

    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => {
      if (!active) return;
      NT.sync.syncLecture(route.contentId, route.courseId, { quiet: true }).then((lecture) => {
        if (lecture) {
          updateDock();
          updateControlState();
        }
      });
    }, options.syncDelay || 2200);

    state = { ready: false };
    bridge("getState")
      .then((initial) => {
        if (initial && active) applyState(initial);
      })
      .catch(() => {});
    return true;
  };

  const cleanup = () => {
    if (active) flushWatch();
    active = false;
    route = null;
    clearInterval(controlsTimer);
    controlsTimer = 0;
    clearTimeout(syncTimer);
    syncTimer = 0;
    controlsGroup?.remove();
    controlsGroup = null;
    markers?.remove();
    markers = null;
    resumeCard?.remove();
    resumeCard = null;
    resumeCleanup?.();
    deepLink = null;
    if (NT.ui.hasLayer("nt-composer")) NT.ui.closeLayer("nt-composer");
    if (NT.ui.hasLayer("nt-player-dock")) NT.ui.closeLayer("nt-player-dock");
    composer = null;
    dockOpen = false;
    state = null;
    lastState = null;
  };

  document.addEventListener("keydown", onKeyDown, true);

  const flushOnHide = () => {
    if (active) flushWatch();
  };
  window.addEventListener("pagehide", flushOnHide);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushOnHide();
  });

  NT.player = {
    init,
    cleanup,
    openDock,
    openComposer,
    toggleDone,
    get state() {
      return state;
    },
    get route() {
      return route;
    },
    seeks: { seek, seekBy }
  };
})();
