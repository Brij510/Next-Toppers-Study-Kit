/* Next Toppers Study Kit — course capture + indexing. */
(() => {
  "use strict";

  const NT = globalThis.NT;
  const store = NT.store;
  const api = NT.api;

  // Large batches commonly contain 100+ chapter folders and 1,000+ items.
  // The old 140-request budget silently truncated them mid-crawl (a real
  // AARAMBH batch needed 221 requests for one tab), which is why only part of
  // the lecture list ever reached search. Keep a generous safety ceiling.
  const MAX_REQUESTS = 2000;
  const MAX_PAGES = 100;
  const INDEX_VERSION = Number(NT.INDEX_VERSION) || 1;
  const PAGE_SIZE = 10;
  const COURSE_TTL = 6 * 60 * 60 * 1000;
  const FOLDER_CONCURRENCY = 3;

  const state = {
    syncing: false,
    stage: "",
    current: 0,
    total: 0,
    lastError: "",
    lastSync: 0,
    cancelled: false,
    phase: "idle",
    activeCourseIds: []
  };

  const listeners = new Set();
  const inFlight = new Map();
  const requestedAuto = new Set();

  const emit = (event) => {
    listeners.forEach((handler) => {
      try {
        handler(event, state);
      } catch (error) {
        console.warn("[Study Kit] sync listener failed", error);
      }
    });
  };

  const setState = (patch) => {
    Object.assign(state, patch);
    emit("state");
  };

  const markActive = (courseId, active) => {
    const ids = new Set(state.activeCourseIds || []);
    if (active) ids.add(String(courseId));
    else ids.delete(String(courseId));
    setState({ activeCourseIds: [...ids] });
  };

  const endpointOf = (url) => {
    try {
      return new URL(url, location.origin).pathname;
    } catch (_) {
      return String(url || "");
    }
  };

  const readBody = (body) => {
    if (!body) return null;
    if (typeof body === "object") return body;
    return NT.util.safeJSON(body, null);
  };

  const cancelled = () => state.cancelled;

  /* --------------------------------------------------------- lecture details */

  const applyLectureDetails = (details, context = {}) => {
    if (!details || typeof details !== "object") return null;
    const contentId = String(
      context.contentId || details.id || details.content_id || details.video_id || ""
    );
    if (!contentId) return null;
    const courseId = String(
      context.courseId || details.course_id || details.parent_course_id || ""
    );
    const existingCourse = store.getCourse(courseId);
    const existingLecture = store.getLecture(contentId);
    const title = String(details.title || existingLecture?.title || "Lecture");
    const duration = Number(
      details.duration || details.video_duration || details.file_duration || existingLecture?.duration || 0
    );

    const lecture = store.upsertLecture({
      ...(existingLecture || {}),
      id: contentId,
      playId: String(details.video_id || existingLecture?.playId || contentId),
      videoId: String(details.video_id || existingLecture?.videoId || ""),
      courseId,
      courseTitle: existingCourse?.title || existingLecture?.courseTitle || "",
      title,
      thumbnail: details.thumbnail || existingLecture?.thumbnail || existingCourse?.thumbnail || "",
      type: details.type || existingLecture?.type || "file",
      fileType: Number(details.file_type || existingLecture?.fileType || 0),
      videoType: String(details.video_type || existingLecture?.videoType || ""),
      isDrm: Boolean(Number(details.is_drm) || existingLecture?.isDrm),
      isLive: Boolean(Number(details.is_live) || existingLecture?.isLive),
      duration: duration || existingLecture?.duration || 0,
      playable: true,
      description: String(details.description || existingLecture?.description || "")
        .replace(/<[^>]+>/g, " ")
        .slice(0, 600),
      siteDone: Boolean(
        details.is_heartbeat_complete ?? existingLecture?.siteDone ?? false
      ),
      detailsAt: Date.now()
    });

    const progress = store.getProgress(contentId);
    const siteDone = Boolean(lecture.siteDone);
    if (siteDone && !progress?.completed) {
      store.setProgress(contentId, {
        completed: true,
        siteCompleted: true,
        completedAt: Date.now(),
        duration: duration || progress?.duration || 0,
        lastWatchedAt: progress?.lastWatchedAt || Date.now()
      });
    } else if (!siteDone && progress?.siteCompleted && !progress?.manualDone) {
      store.setProgress(contentId, { completed: false, siteCompleted: false, completedAt: 0 });
    }

    if (store.settings.syncBookmarks && Array.isArray(details.video_time_bookmarks)) {
      store.syncSiteBookmarks(contentId, details.video_time_bookmarks, {
        courseId,
        lectureTitle: title,
        courseTitle: existingCourse?.title || ""
      });
    }

    emit("lecture", { lectureId: contentId, courseId });
    return lecture;
  };

  const syncLecture = async (contentId, courseId, options = {}) => {
    if (!contentId || !courseId) return null;
    const key = `lecture:${contentId}:${courseId}`;
    if (inFlight.has(key)) return inFlight.get(key);
    const task = (async () => {
      try {
        const details = await api.getContentDetails(contentId, courseId);
        return applyLectureDetails(details, { contentId, courseId });
      } catch (error) {
        if (options.quiet !== true) {
          console.warn("[Study Kit] Could not load lecture details", error);
        }
        return null;
      } finally {
        inFlight.delete(key);
      }
    })();
    inFlight.set(key, task);
    return task;
  };

  /* ------------------------------------------------------------ course index */

  const indexItems = (course, items, context = {}) => {
    const lectures = [];
    let order = Number(context.order || 0);
    const folders = [];

    (items || []).forEach((item) => {
      if (!item || typeof item !== "object") return;
      const nested =
        item.data && typeof item.data === "object" && !Array.isArray(item.data) ? item.data : null;
      const source = nested ? { ...item, ...nested } : item;
      const type = String(item.type || source.type || "").toLowerCase();
      if (type === "folder") {
        const folderId = String(
          nested?.id || item.entity_id || item.id || item.folder_id || source.id || ""
        );
        if (folderId) {
          folders.push({
            id: folderId,
            title: String(item.title || source.title || item.name || "Chapter")
          });
        }
        return;
      }
      order += 1;
      const lecture = api.normaliseLecture(item, {
        courseId: course.id,
        courseTitle: course.title,
        folderTitle: context.folderTitle || "",
        order,
        thumbnail: course.thumbnail
      });
      if (!lecture || !lecture.playable) return;
      store.upsertLecture(lecture);
      lectures.push(lecture);
    });

    return { lectures, folders, order };
  };

  const crawlFolder = async (course, options, bucket, depth = 0) => {
    if (cancelled() || depth > 4 || bucket.requests >= MAX_REQUESTS) return;
    let page = 1;

    while (page <= MAX_PAGES && bucket.requests < MAX_REQUESTS) {
      bucket.requests += 1;
      let result;
      try {
        result = await api.listContentPage(course.id, {
          folderId: options.folderId || "0",
          parentCourseId: options.parentCourseId || "0",
          tabType: options.tabType || "",
          tabId: options.tabId || "",
          isFree: options.isFree || "",
          page,
          limit: PAGE_SIZE
        });
      } catch (error) {
        if (error instanceof api.AuthError) throw error;
        // Tabs that are not part of this course commonly 404. Move on quietly.
        if (page === 1) return;
        break;
      }

      const items = result.items || [];
      if (!items.length) break;

      const indexed = indexItems(course, items, {
        folderTitle: options.folderTitle || "",
        order: bucket.order
      });
      bucket.order = indexed.order;
      bucket.lectures.push(...indexed.lectures);

      const fresh = [];
      for (const folder of indexed.folders) {
        if (cancelled() || bucket.folders.has(folder.id) || bucket.requests >= MAX_REQUESTS) {
          continue;
        }
        bucket.folders.set(folder.id, folder);
        fresh.push(folder);
      }
      // Chapters are independent, so a small pool keeps large batches from
      // turning into a long serial crawl.
      for (let i = 0; i < fresh.length; i += FOLDER_CONCURRENCY) {
        if (cancelled()) break;
        const batch = fresh.slice(i, i + FOLDER_CONCURRENCY);
        await Promise.all(
          batch.map((folder) =>
            crawlFolder(
              course,
              { ...options, folderId: folder.id, folderTitle: folder.title },
              bucket,
              depth + 1
            )
          )
        );
      }

      const pagination = result.pagination || {};
      const total = Number(pagination.total || pagination.total_count || pagination.count || 0);
      if (items.length < PAGE_SIZE) break;
      if (total && page * PAGE_SIZE >= total) break;
      page += 1;
    }
  };

  const candidateTabs = (details) => {
    const tabs = api.normaliseTabs(details);
    let candidates = tabs.filter(api.tabHasContent);
    if (!candidates.length) {
      candidates = tabs.filter((tab) => !/overview|detail|faq|review/i.test(tab.type));
    }
    if (!candidates.length) candidates = [{ type: "", title: "", sections: [] }];
    return { tabs, candidates };
  };

  const indexCourse = async (courseId, options = {}) => {
    const id = String(courseId);
    if (!id) return null;
    if (!api.session.loggedIn()) throw new api.AuthError();
    if (inFlight.has(`course:${id}`)) return inFlight.get(`course:${id}`);

    const internal = options.internal === true;
    const silent = options.silent === true;
    // A previous "Stop" must not poison a fresh, standalone index. Batched
    // runs (syncAll) own the flag, so they leave it alone.
    if (!internal && !state.syncing) state.cancelled = false;
    const ownsState = !silent && !state.syncing;
    if (ownsState) {
      setState({
        syncing: true,
        phase: "indexing",
        stage: "Reading course…",
        current: 0,
        total: 1,
        lastError: "",
        cancelled: state.cancelled
      });
    }
    markActive(id, true);

    const task = (async () => {
      const started = Date.now();
      try {
        let details = null;
        let course = store.getCourse(id);
        const parentId =
          String(options.parentId || options.parentCourseId || course?.parentId || "0") || "0";
        let detailError = null;
        try {
          details = await api.getCourseDetails(id, { force: options.force, parentId });
          const fromDetails = api.courseFromDetails(id, details, {
            ...(options.fallback || {}),
            ...(course || {})
          });
          course = store.upsertCourse({
            ...fromDetails,
            parentId: fromDetails.parentId || (parentId !== "0" ? parentId : course?.parentId || "")
          });
        } catch (error) {
          if (error instanceof api.AuthError) throw error;
          detailError = error;
          if (!course) throw error;
        }

        const { tabs, candidates } = candidateTabs(details);
        const bucket = { requests: 0, order: 0, lectures: [], folders: new Map() };
        let lastError = detailError;

        for (const tab of candidates) {
          if (cancelled()) break;
          try {
            await crawlFolder(
              course,
              {
                tabType: tab.type || "",
                tabId: tab.tabId || tab.id || "",
                parentCourseId: parentId
              },
              bucket
            );
          } catch (error) {
            if (error instanceof api.AuthError) throw error;
            lastError = error;
          }
        }

        if (!bucket.lectures.length && !tabs.length) {
          // Some purchased courses expose a single content tab under a
          // non-obvious name. Try the usual suspects before giving up.
          for (const type of ["content", "study", "class", "lecture"]) {
            if (cancelled() || bucket.requests >= MAX_REQUESTS) break;
            try {
              await crawlFolder(course, { tabType: type, parentCourseId: parentId }, bucket);
            } catch (_) {}
            if (bucket.lectures.length) break;
          }
        }

        const previousIds = store.getCourse(id)?.lectureIds || [];
        const freshIds = new Set(bucket.lectures.map((lecture) => String(lecture.id)));
        const mergedIds = [
          ...bucket.lectures.map((lecture) => String(lecture.id)),
          ...previousIds.filter((lectureId) => !freshIds.has(String(lectureId)))
        ];

        const errorMessage =
          lastError && !bucket.lectures.length ? lastError.message || "No content found" : "";

        store.upsertCourse({
          ...course,
          id,
          lectureIds: Array.from(new Set(mergedIds)),
          syncedAt: Date.now(),
          lectureCount: mergedIds.length,
          // A cancelled or budget-truncated crawl must keep retrying.
          indexVersion:
            cancelled() || bucket.requests >= MAX_REQUESTS
              ? Number(course.indexVersion) || 0
              : INDEX_VERSION,
          syncError: errorMessage
        });
        store.db.meta.lastSync = Date.now();
        store.save();

        if (ownsState) {
          setState({
            syncing: false,
            phase: "idle",
            stage: "",
            current: 1,
            total: 1,
            lastSync: Date.now(),
            lastError: errorMessage
          });
        }
        emit("course", {
          courseId: id,
          lectures: bucket.lectures.length,
          requests: bucket.requests,
          ms: Date.now() - started
        });
        return {
          courseId: id,
          lectures: bucket.lectures.length,
          requests: bucket.requests,
          error: errorMessage
        };
      } catch (error) {
        if (ownsState) {
          setState({
            syncing: false,
            phase: "idle",
            stage: "",
            lastError: error?.message || "Could not sync this course."
          });
        }
        throw error;
      } finally {
        inFlight.delete(`course:${id}`);
        markActive(id, false);
      }
    })();

    inFlight.set(`course:${id}`, task);
    return task;
  };

  /* ------------------------------------------------------------- my courses */

  const syncError = () => {
    const info = api.lastCoursesInfo;
    if (info?.errors?.length) {
      const first = info.errors[0];
      return `Could not read your courses (${first.message}). Open My Course on the site once, then retry.`;
    }
    return "No purchased courses found for this account.";
  };

  const indexMany = async (courses, options = {}) => {
    let lectures = 0;
    const errors = [];
    let cursor = 0;
    let finished = 0;
    const concurrency = Math.max(1, Math.min(3, Number(options.concurrency) || 2));

    const worker = async () => {
      while (!cancelled()) {
        const index = cursor;
        cursor += 1;
        if (index >= courses.length) return;
        const course = courses[index];
        const total = courses.length;
        setState({
          current: finished,
          total,
          phase: "indexing",
          stage: `Indexing ${course.title}`
        });
        try {
          const result = await indexCourse(course.id, {
            force: Boolean(options.force && index < 2),
            parentId: course.parentId || "",
            silent: true,
            internal: true
          });
          lectures += result?.lectures || 0;
        } catch (error) {
          if (error instanceof api.AuthError) throw error;
          errors.push({ courseId: course.id, message: error?.message || "Index failed" });
        } finally {
          finished += 1;
          setState({ current: finished, total });
        }
      }
    };

    await Promise.all(Array.from({ length: Math.min(concurrency, courses.length) }, worker));
    return { lectures, errors };
  };

  const syncAll = async (options = {}) => {
    if (!api.session.loggedIn()) throw new api.AuthError();
    if (inFlight.has("all")) return inFlight.get("all");

    const task = (async () => {
      setState({
        syncing: true,
        phase: "courses",
        stage: "Finding your courses…",
        current: 0,
        total: 1,
        lastError: "",
        cancelled: false
      });
      try {
        const courses = await api.getMyCourses({ force: options.force !== false });
        if (!courses.length) {
          const message = syncError();
          setState({ syncing: false, phase: "idle", stage: "", lastError: message });
          return { courses: 0, lectures: 0, errors: [{ message }] };
        }

        courses.forEach((course) => store.upsertCourse({ ...course, id: String(course.id) }));
        store.db.meta.lastSync = Date.now();
        store.save();
        setState({ current: 0, total: courses.length, stage: `Found ${courses.length} course(s).` });
        emit("courses", { courses });

        if (options.deep === false) {
          setState({
            syncing: false,
            phase: "idle",
            stage: "",
            current: courses.length,
            total: courses.length,
            lastSync: Date.now()
          });
          return { courses: courses.length, lectures: 0, errors: [] };
        }

        const result = await indexMany(courses, options);
        if (cancelled()) {
          setState({
            syncing: false,
            phase: "idle",
            stage: "",
            lastError: "Sync cancelled.",
            current: finishedOrZero(),
            total: courses.length
          });
          return { courses: courses.length, lectures: result.lectures, errors: result.errors, cancelled: true };
        }

        setState({
          syncing: false,
          phase: "idle",
          stage: "",
          current: courses.length,
          total: courses.length,
          lastSync: Date.now(),
          lastError: result.errors.length ? `${result.errors.length} course(s) could not be indexed.` : ""
        });
        return { courses: courses.length, lectures: result.lectures, errors: result.errors };
      } catch (error) {
        setState({
          syncing: false,
          phase: "idle",
          stage: "",
          lastError: error?.message || "Could not sync your courses."
        });
        throw error;
      } finally {
        inFlight.delete("all");
      }
    })();

    inFlight.set("all", task);
    return task;
  };

  const finishedOrZero = () => Math.max(0, Number(state.current) || 0);

  const refreshCourses = async () => {
    if (!api.session.loggedIn()) throw new api.AuthError();
    const courses = await api.getMyCourses({ force: true });
    courses.forEach((course) => store.upsertCourse({ ...course, id: String(course.id) }));
    store.db.meta.lastSync = Date.now();
    store.save();
    emit("courses", { courses });
    return courses;
  };

  const autoIndexCourse = async (courseId) => {
    if (!store.settings.autoIndexCourse || !api.session.loggedIn()) return null;
    const id = String(courseId);
    if (requestedAuto.has(id)) return null;
    requestedAuto.add(id);
    const route = NT.routes?.parseCourse?.();
    const onThisCourse = Boolean(route && String(route.courseId) === id);
    const course = store.getCourse(id);
    if (!course && !onThisCourse) return null;
    if (course?.syncedAt && Date.now() - course.syncedAt < COURSE_TTL) {
      if (Number(course.indexVersion) >= INDEX_VERSION) return null;
    }
    const parentId = String(course?.parentId || (onThisCourse ? route.parentId : "") || "0") || "0";
    const fallback = {
      id,
      title: course?.title || (onThisCourse ? NT.util.slugToTitle(route.slug) : `Course ${id}`),
      slug: course?.slug || (onThisCourse ? `${route.slug}-${id}` : ""),
      parentId
    };
    try {
      return await indexCourse(id, { force: false, silent: true, parentId, fallback });
    } catch (error) {
      if (error instanceof api.AuthError) return null;
      console.warn("[Study Kit] Auto-index skipped", error);
      return null;
    }
  };

  const cancel = () => {
    if (!state.syncing) return false;
    state.cancelled = true;
    setState({ stage: "Stopping…" });
    return true;
  };

  /* --------------------------------------------------------- site data feed */

  const ingestContentDetails = async (payload) => {
    try {
      const url = new URL(payload.url, location.origin);
      const contentId = url.searchParams.get("content_id");
      const courseId = url.searchParams.get("course_id");
      if (!contentId || !courseId) return;
      const body = payload.data;
      if (!body || body.success === false) return;
      const encrypted = body?.data?.data ?? body?.data;
      let details = null;
      if (typeof encrypted === "string") details = await api.decrypt(encrypted);
      else if (encrypted && typeof encrypted === "object") details = encrypted;
      if (details) applyLectureDetails(details, { contentId, courseId });
    } catch (error) {
      console.warn("[Study Kit] Could not read lecture payload", error);
    }
  };

  const ingestContentList = (payload) => {
    try {
      const body = readBody(payload.requestBody);
      if (!body) return;
      const courseId = String(body.course_id || body.parent_course_id || "");
      if (!courseId) return;
      const raw = payload.data?.data;
      const items = Array.isArray(raw)
        ? raw
        : Array.isArray(payload.data)
          ? payload.data
          : [];
      const route = NT.routes.parseCourse();
      const course =
        store.getCourse(courseId) ||
        {
          id: courseId,
          title: route?.courseId === courseId ? NT.util.slugToTitle(route.slug) : `Course ${courseId}`,
          slug: route?.courseId === courseId ? `${route.slug}-${courseId}` : "",
          parentId:
            body.parent_course_id && String(body.parent_course_id) !== "0"
              ? String(body.parent_course_id)
              : ""
        };
      const indexed = indexItems(course, items, {
        folderTitle: "",
        order: 0
      });
      if (indexed.lectures.length) {
        const previousIds = store.getCourse(courseId)?.lectureIds || [];
        const merged = Array.from(
          new Set([...indexed.lectures.map((lecture) => String(lecture.id)), ...previousIds])
        );
        store.upsertCourse({
          ...course,
          id: courseId,
          lectureIds: merged,
          syncedAt: store.getCourse(courseId)?.syncedAt || Date.now()
        });
        emit("lectures", { courseId, count: indexed.lectures.length });
      }
    } catch (error) {
      console.warn("[Study Kit] Could not read course content", error);
    }
  };

  const ingestApi = (payload) => {
    if (!payload || !payload.url) return;
    const path = endpointOf(payload.url);
    if (/\/content-details$/.test(path)) {
      ingestContentDetails(payload);
      return;
    }
    if (/\/all-content$/.test(path)) {
      ingestContentList(payload);
      return;
    }
    if (/\/mycourses$/.test(path) && payload.data?.success !== false) {
      try {
        const list = Array.isArray(payload.data) ? payload.data : payload.data?.data;
        if (Array.isArray(list)) {
          const courses = list.map(api.normaliseCourse).filter(Boolean);
          courses.forEach((course) => store.upsertCourse({ ...course, isPurchased: true }));
          emit("courses", { courses });
        }
      } catch (_) {}
      return;
    }
    if (/\/v1\/watch\/vod\/heartbeat$/.test(path)) {
      try {
        if (payload.data?.data?.status === "completed") {
          const body = readBody(payload.requestBody);
          if (body?.contentId) {
            store.setProgress(String(body.contentId), {
              completed: true,
              siteCompleted: true,
              completedAt: Date.now()
            });
            emit("lecture-completed", { contentId: String(body.contentId) });
          }
        }
      } catch (_) {}
    }
  };

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const msg = event.data;
    if (!msg || msg.source !== "nt-page" || msg.kind !== "api") return;
    ingestApi(msg);
  });

  const playPath = (lecture) => {
    if (!lecture) return "/";
    return NT.routes.playURL(lecture.playId || lecture.id, lecture.courseId, 0);
  };

  NT.sync = {
    state,
    on(handler) {
      listeners.add(handler);
      return () => listeners.delete(handler);
    },
    indexCourse,
    syncAll,
    refreshCourses,
    syncLecture,
    autoIndexCourse,
    cancel,
    applyLectureDetails,
    ingestApi,
    playPath
  };
})();
