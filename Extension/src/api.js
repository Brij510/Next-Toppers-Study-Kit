/* Next Toppers Study Kit — site API client (isolated content-script world). */
(() => {
  "use strict";

  const NT = globalThis.NT;
  const API = "/api/service-proxy/course";
  const COURSE = `${API}/course`;
  const TIMEOUT = 22000;
  const CACHE_TTL = 10 * 60 * 1000;
  const MY_COURSE_TYPES = ["COURSE", "TEST_SERIES"];
  let lastCoursesInfo = { types: [], errors: [], fetchedAt: 0 };

  const KEY_TEXT = "Ch@tS3cr3tK3y!16";
  const IV_TEXT = "Ch@tIV#16Bytes!!";
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  const cache = new Map();

  class AuthError extends Error {
    constructor(message = "Sign in to nexttoppers.com to sync your courses.") {
      super(message);
      this.name = "AuthError";
      this.code = "AUTH";
    }
  }

  class ApiError extends Error {
    constructor(message, responseCode = "", status = 0) {
      super(message);
      this.name = "ApiError";
      this.responseCode = String(responseCode || "");
      this.status = status;
    }
  }

  const readJSON = (key) => {
    try {
      return NT.util.safeJSON(localStorage.getItem(key), null);
    } catch (_) {
      return null;
    }
  };

  const session = {
    userId() {
      const cred = readJSON("cred") || {};
      const stored = localStorage.getItem("user_id");
      const id = cred.user_id || cred.userId || cred.id || stored || "";
      return id ? String(id) : "";
    },
    loggedIn() {
      if (this.userId()) return true;
      try {
        return Boolean(localStorage.getItem("token"));
      } catch (_) {
        return false;
      }
    }
  };

  const headers = () => {
    const userId = session.userId();
    const base = {
      "content-type": "application/json",
      accept: "application/json",
      app_id: NT.APP_ID,
      "x-app-id": NT.APP_ID,
      extra_value: "NEXT400",
      "x-extra-value": "NEXT400",
      version: "1",
      Version: "1",
      platform: "3"
    };
    if (userId) {
      base.user_id = userId;
      base["x-user-id"] = userId;
    }
    return base;
  };

  const request = async (path, options = {}) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeout || TIMEOUT);
    const method = String(options.method || "GET").toUpperCase();
    let body;
    if (options.body != null) body = JSON.stringify(options.body);

    let response;
    try {
      response = await fetch(path, {
        method,
        headers: headers(),
        credentials: "include",
        body,
        signal: controller.signal,
        cache: "no-store"
      });
    } catch (error) {
      clearTimeout(timer);
      if (error?.name === "AbortError") throw new ApiError("The site took too long to respond.", "", 0);
      throw new ApiError("Could not reach nexttoppers.com. Check your connection.", "", 0);
    } finally {
      clearTimeout(timer);
    }

    let json = null;
    try {
      json = await response.json();
    } catch (_) {
      json = null;
    }

    if (response.status === 401 || response.status === 403) throw new AuthError();
    if (!response.ok) {
      throw new ApiError(
        json?.message || `The site responded with ${response.status}.`,
        json?.responseCode,
        response.status
      );
    }
    if (!json) throw new ApiError("The site returned an unexpected response.", "", response.status);

    const code = String(json.responseCode || "");
    if (json.success === false) {
      if (code === "1110010" || /token.*required|unauthor/i.test(json.message || "")) {
        throw new AuthError();
      }
      if (code === "404") return { ...json, data: null };
      throw new ApiError(json.message || "The site could not complete that request.", code, response.status);
    }

    return json;
  };

  /* ------------------------------------------------------------ decryption */

  let cryptoKeyPromise = null;
  const cryptoKey = () => {
    if (!cryptoKeyPromise) {
      cryptoKeyPromise = crypto.subtle.importKey(
        "raw",
        encoder.encode(KEY_TEXT),
        { name: "AES-CBC" },
        false,
        ["decrypt"]
      );
    }
    return cryptoKeyPromise;
  };

  const decrypt = async (payload) => {
    if (!payload) return null;
    try {
      const binary = atob(String(payload));
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
      const key = await cryptoKey();
      const plain = await crypto.subtle.decrypt(
        { name: "AES-CBC", iv: encoder.encode(IV_TEXT) },
        key,
        bytes
      );
      const text = decoder.decode(plain);
      return NT.util.safeJSON(text, null);
    } catch (error) {
      console.warn("[Study Kit] Could not decode lecture details", error);
      return null;
    }
  };

  /* -------------------------------------------------------------- normalise */

  const pick = (object, keys, fallback = "") => {
    if (!object || typeof object !== "object") return fallback;
    for (const key of keys) {
      const value = object[key];
      if (value !== undefined && value !== null && value !== "") return value;
    }
    return fallback;
  };

  const number = (value, fallback = 0) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  };

  const bool = (value) => {
    if (value === true || value === 1) return true;
    if (typeof value === "string") return value === "1" || value.toLowerCase() === "true";
    return false;
  };

  const deepArray = (value, depth = 0) => {
    if (depth > 4 || value == null) return null;
    if (Array.isArray(value)) return value;
    if (typeof value !== "object") return null;
    for (const key of [
      "data",
      "courses",
      "mycourses",
      "my_courses",
      "myCourse",
      "purchased",
      "results",
      "list",
      "items",
      "content"
    ]) {
      if (Array.isArray(value[key])) return value[key];
      if (value[key] && typeof value[key] === "object") {
        const found = deepArray(value[key], depth + 1);
        if (found) return found;
      }
    }
    return null;
  };

  const slugify = (value) =>
    String(value || "")
      .toLowerCase()
      .replace(/&/g, " and ")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 70);

  const absolute = (value) => {
    const raw = String(value || "").trim();
    if (!raw) return "";
    try {
      const parsed = new URL(raw, location.origin);
      // Only ordinary web images; never javascript:, data:, blob:, etc.
      return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.href : "";
    } catch (_) {
      return "";
    }
  };

  const normaliseCourse = (raw) => {
    if (!raw || typeof raw !== "object") return null;
    const inner = raw.course && typeof raw.course === "object" ? raw.course : raw;
    const nested =
      raw.data && typeof raw.data === "object" && !Array.isArray(raw.data) ? raw.data : null;
    const source = nested ? { ...inner, ...nested } : inner;
    const id = pick(source, ["course_id", "courseId", "item_id", "id"]);
    if (!id) return null;
    const title = String(
      pick(source, ["title", "course_title", "item_name", "name"], "Untitled course")
    );
    const slugRaw = String(pick(source, ["slug", "course_slug", "dynamic_link"], ""));
    const slug = slugRaw && !/^https?:\/\//.test(slugRaw) ? slugRaw.replace(/^\//, "") : `${slugify(title)}-${id}`;
    const thumbnail = absolute(
      pick(source, ["thumbnail", "course_thumbnail", "image", "cover_image", "banner"], "")
    );
    const parentId = String(pick(source, ["parent_id", "parent_course_id"], "0") || "0");
    return {
      id: String(id),
      title,
      slug,
      courseId: String(id),
      parentId: parentId && parentId !== "0" ? parentId : "",
      thumbnail,
      description: String(pick(source, ["description", "short_description"], "")).replace(/<[^>]+>/g, " ").slice(0, 400),
      educator: String(pick(source, ["educator_name", "educator", "teacher_name"], "")),
      itemType: String(pick(source, ["item_type"], "")),
      courseType: String(pick(source, ["course_type", "type"], "")),
      isPurchased: bool(pick(source, ["is_purchased", "is_bought"], "")) || raw.purchased === true,
      purchasedAt: number(pick(source, ["purchased_at", "enrolled_at"], 0)),
      validity: String(pick(source, ["end_date", "expiry", "validity"], "")),
      raw: undefined
    };
  };

  const normaliseLecture = (item, context = {}) => {
    if (!item || typeof item !== "object") return null;
    // The site's content list nests the real record under `data`:
    // { type: "file", title, data: { id, file_type, video_type, ... } }.
    const nested =
      item.data && typeof item.data === "object" && !Array.isArray(item.data) ? item.data : null;
    const source = nested ? { ...item, ...nested } : item;
    const type = String(pick(item, ["type"], pick(source, ["type"], ""))).toLowerCase();
    const videoId = pick(source, ["video_id", "content_video_id", "file_id"]);
    const id = pick(source, ["id", "content_id", "video_id"]);
    if (!id) return null;
    const title = String(pick(source, ["title", "name"], "")).trim();
    const fileTypeRaw = pick(source, ["file_type"], "");
    const hasFileType = fileTypeRaw !== "" && fileTypeRaw !== null && fileTypeRaw !== undefined;
    const fileType = number(fileTypeRaw, 0);
    const videoType = String(pick(source, ["video_type"], ""));
    const playable =
      type !== "folder" &&
      type !== "test" &&
      (type === "file" || type === "") &&
      (!hasFileType || fileType === 2 || videoType === "3" || videoType === "4");
    const durationRaw = pick(source, ["duration", "video_duration", "length", "file_duration"], 0);
    const duration = number(durationRaw, 0);

    return {
      id: String(id),
      playId: String(videoId || id),
      videoId: String(videoId || ""),
      courseId: String(context.courseId || source.course_id || ""),
      courseTitle: String(context.courseTitle || ""),
      title: title || "Untitled lecture",
      thumbnail: absolute(pick(source, ["thumbnail", "image", "cover"], context.thumbnail || "")),
      type: type || "file",
      fileType,
      videoType,
      isDrm: bool(pick(source, ["is_drm"], false)),
      isFree: bool(pick(source, ["is_free", "free"], false)),
      isLive: bool(pick(source, ["is_live", "live_status"], false)),
      duration,
      playable,
      folderId: String(pick(source, ["folder_id", "parent_id"], "")),
      folderTitle: String(context.folderTitle || ""),
      order: number(context.order, 0),
      description: String(pick(source, ["description", "info"], "")).replace(/<[^>]+>/g, " ").slice(0, 500),
      siteDone: bool(pick(source, ["is_heartbeat_complete", "is_completed"], false)),
      updatedAt: number(pick(source, ["updated_at", "modified_at"], 0)) * (String(pick(source, ["updated_at"], "")).length <= 10 ? 1000 : 1)
    };
  };

  const normaliseTabs = (courseDetails) => {
    // The API has returned tabs as an array, under `tabs`, and most recently
    // as an object keyed "0"/"1". Walk every object value instead of only the
    // two shapes we happened to see, otherwise newer responses yield zero tabs
    // and the crawler silently falls back to a single guessed tab.
    const root = courseDetails?.data ?? courseDetails;
    const out = [];
    const walk = (node, depth = 0) => {
      if (!node || depth > 4) return;
      if (Array.isArray(node)) {
        node.forEach((item) => walk(item, depth + 1));
        return;
      }
      if (typeof node !== "object") return;
      const type = String(pick(node, ["type", "tab_type"], "")).trim();
      const title = String(pick(node, ["title", "name"], "")).trim();
      const tabId = String(pick(node, ["tab_id", "tabId"], "")).trim();
      const sections = Array.isArray(node.data)
        ? node.data
        : Array.isArray(node.layout_data)
        ? node.layout_data
        : null;
      // A tab is a titled/typed container with its own sections. Section
      // records use `layout_type`, so they are not mistaken for tabs.
      if (type && type.toLowerCase() !== "overview" && sections && !node.layout_type) {
        out.push({ type, title, tabId, sections });
      }
      if (Array.isArray(node.tabs)) node.tabs.forEach((item) => walk(item, depth + 1));
      Object.keys(node).forEach((key) => {
        if (key === "tabs" || key === "data" || key === "layout_data") return;
        const value = node[key];
        if (value && typeof value === "object") walk(value, depth + 1);
      });
    };
    walk(root);
    // Keep every distinct tab. Deduping by type alone dropped same-type tabs
    // that carried different tab_ids (and therefore different content).
    const seen = new Set();
    return out.filter((tab) => {
      const key = `${tab.type.toLowerCase()}|${tab.tabId || tab.title || ""}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };

  const tabHasContent = (tab) => {
    if (!tab?.sections) return false;
    return tab.sections.some((section) => {
      const type = String(section?.layout_type || section?.type || "");
      const items = section?.layout_data;
      return /content|chapter|folder|video|lecture|class|study/i.test(type) || (Array.isArray(items) && items.some((i) => i?.type === "folder" || i?.video_id));
    });
  };

  /* -------------------------------------------------------------- endpoints */

  const fetchCourseType = async (type, limit) => {
    const found = [];
    let page = 1;
    // The site's own viewer requests COURSE and TEST_SERIES separately. Merging
    // them matters: an account can have purchased batches and test series at
    // the same time, and stopping at the first non-empty response drops half.
    while (page <= 3) {
      const json = await request(
        `${COURSE}/mycourses?type=${encodeURIComponent(type)}&page=${page}&limit=${limit}`
      );
      const batch = deepArray(json?.data) || deepArray(json) || [];
      found.push(...batch);
      if (batch.length < limit) break;
      page += 1;
    }
    return found;
  };

  const getMyCourses = async (options = {}) => {
    const key = "mycourses";
    const cached = cache.get(key);
    if (cached && Date.now() - cached.at <= CACHE_TTL && !options.force) {
      return cached.value.map(normaliseCourse).filter(Boolean);
    }

    const limit = Math.max(1, Math.min(200, Number(options.limit) || 100));
    const wanted = Array.isArray(options.types) && options.types.length
      ? options.types.map(String)
      : MY_COURSE_TYPES;
    const types = [...new Set(wanted)];
    const byId = new Map();
    const errors = [];

    const merge = (rawList) => {
      (rawList || []).forEach((raw) => {
        const course = normaliseCourse(raw);
        if (!course) return;
        course.isPurchased = true;
        const previous = byId.get(course.id);
        byId.set(course.id, previous ? { ...previous, ...course } : course);
      });
    };

    for (const type of types) {
      try {
        merge(await fetchCourseType(type, limit));
      } catch (error) {
        if (error instanceof AuthError) throw error;
        errors.push({ type, message: error?.message || "Request failed" });
      }
    }

    // Older accounts and a few regional deployments still answer on the
    // numeric types used by the live-class widget. Only try them when the
    // named types produced nothing, so normal accounts never pay for it.
    if (!byId.size && !options.types) {
      for (const type of ["1", "2"]) {
        try {
          merge(await fetchCourseType(type, limit));
        } catch (error) {
          if (error instanceof AuthError) throw error;
          errors.push({ type, message: error?.message || "Request failed" });
        }
      }
    }

    lastCoursesInfo = { types, errors, fetchedAt: Date.now() };
    const value = [...byId.values()];
    cache.set(key, { at: Date.now(), value, errors });
    if (value.length) {
      console.info(
        `[Study Kit] Course sync: ${value.length} course(s) via ${types.join(" + ")}`
      );
    } else if (errors.length) {
      console.warn("[Study Kit] Course sync returned no courses", errors);
    }
    return value;
  };

  const getCourseDetails = async (courseId, options = {}) => {
    const id = String(courseId);
    const parentId = String(options.parentId || "0") || "0";
    const key = `course:${id}:${parentId}`;
    const cached = cache.get(key);
    if (!cached || Date.now() - cached.at > CACHE_TTL || options.force) {
      const json = await request(`${COURSE}/course-details`, {
        method: "POST",
        body: { course_id: id, parent_id: parentId }
      });
      cache.set(key, { at: Date.now(), value: json.data });
      return json.data;
    }
    return cached.value;
  };

  const listContentPage = async (courseId, options = {}) => {
    const body = {
      course_id: String(courseId),
      folder_id: String(options.folderId || "0"),
      page: String(options.page || 1),
      // The site itself asks for 10 per page and paginates while a full page
      // comes back. Asking for more silently returns 10 anyway, which made the
      // old crawler stop after the first page.
      limit: String(options.limit || 10),
      keyword: "",
      parent_course_id: String(options.parentCourseId || "0"),
      tab_type: String(options.tabType || ""),
      is_free: String(options.isFree || "")
    };
    if (options.tabId) body.tab_id = String(options.tabId);
    const json = await request(`${COURSE}/all-content`, { method: "POST", body });
    const payload = json.data;
    const items = Array.isArray(payload) ? payload : deepArray(payload) || [];
    const pagination = payload?.pagination || json.pagination || {};
    return { items, pagination };
  };

  const getContentDetails = async (contentId, courseId) => {
    const json = await request(
      `${COURSE}/content-details?content_id=${encodeURIComponent(contentId)}&course_id=${encodeURIComponent(
        courseId
      )}`
    );
    const encrypted = json?.data?.data ?? json?.data;
    if (typeof encrypted !== "string") {
      if (encrypted && typeof encrypted === "object") return encrypted;
      throw new ApiError("This lecture's details were not available.");
    }
    const decoded = await decrypt(encrypted);
    if (!decoded) throw new ApiError("Could not unlock this lecture's details.");
    return decoded;
  };

  const addBookmark = async ({ lectureId, courseId, seconds, note }) => {
    const json = await request(`${COURSE}/add-video-time-bookmark`, {
      method: "POST",
      body: {
        video_id: String(lectureId),
        at_seconds: String(Math.max(0, Math.floor(Number(seconds) || 0))),
        info: String(note || "").trim() || `Study Kit · ${NT.util.formatTime(seconds)}`
      }
    });
    const data = json?.data;
    return {
      id: String(
        data?.id || data?.bookmark_id || data?.video_time_bookmarks?.slice?.(-1)?.[0]?.id || ""
      ),
      raw: data
    };
  };

  const deleteBookmark = async (bookmarkId) =>
    request(`${COURSE}/delete-video-time-bookmark`, {
      method: "POST",
      body: { bookmark_id: String(bookmarkId) }
    });

  const courseFromDetails = (courseId, details, fallback = {}) => {
    const root = details?.data ?? details;
    let found = null;
    const walk = (node, depth = 0) => {
      if (found || !node || depth > 5) return;
      if (Array.isArray(node)) {
        node.forEach((item) => walk(item, depth + 1));
        return;
      }
      if (typeof node !== "object") return;
      if (String(node.id || node.course_id || "") === String(courseId) && (node.title || node.name)) {
        found = node;
        return;
      }
      Object.values(node).forEach((value) => {
        if (value && typeof value === "object") walk(value, depth + 1);
      });
    };
    walk(root);
    return normaliseCourse({ ...fallback, ...(found || {}), id: courseId }) || {
      id: String(courseId),
      slug: String(fallback.slug || ""),
      title: String(fallback.title || `Course ${courseId}`),
      thumbnail: fallback.thumbnail || ""
    };
  };

  NT.api = {
    AuthError,
    ApiError,
    session,
    request,
    decrypt,
    headers,
    getMyCourses,
    getCourseDetails,
    listContentPage,
    getContentDetails,
    addBookmark,
    deleteBookmark,
    normaliseCourse,
    normaliseLecture,
    normaliseTabs,
    tabHasContent,
    courseFromDetails,
    get lastCoursesInfo() {
      return lastCoursesInfo;
    },
    clearCache() {
      cache.clear();
    }
  };
})();
