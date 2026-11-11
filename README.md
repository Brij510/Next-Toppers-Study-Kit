# Next Toppers Study Kit

A light Chrome extension that adds a study layer to [nexttoppers.com](https://nexttoppers.com): lecture search, one-click resume, keyboard controls, timestamp notes and progress tracking — injected into the real site pages instead of covering them with a widget.

> Not affiliated with Next Toppers. Built to help you focus.

## Install

1. Open `chrome://extensions` in Chrome.
2. Turn on **Developer mode**.
3. Click **Load unpacked** and select this folder.
4. Open [nexttoppers.com](https://nexttoppers.com) and sign in.

The first run opens the settings page once. Course lists sync in the background, then individual courses are indexed when you open them (or when you press **Sync**).

### If it already appears in `chrome://extensions`

- Click the **Reload** (↻) button on **Next Toppers Study Kit**. This picks up manifest changes, including the `scripting` permission added in 1.1.0 and the full-course sync fix in 1.1.1.
- After reloading, open a course and press **Sync course** once so every chapter is re-indexed. Large batches can take 10–30 seconds.
- If two copies are listed, keep the one whose path ends in `Projects/NT Extension` and remove older packaged copies.
- If the browser was launched by a tool with `--disable-extensions`, extensions cannot load in that window. Use a normal Chrome window, or restart the tool without that flag.

## What it adds

### Native site surfaces
These are injected into the real Next.js page after hydration, so they inherit the site's Poppins/mint visual language:

- **Homepage study desk** — continue the last lecture, see course progress, sync your batches, or open the full Study Kit.
- **Private sidebar entry** — a **Study Desk** link beside My Course on `/private/*` pages.
- **Course header bar** — progress, next lecture, resume, lecture search and per-course sync on `/private/course/*`.
- **Player study card** — progress, mark-done, save-timestamp and recent timestamps in the player's existing right rail, above the native bookmark/notes tabs.

The **Page tools** setting turns these on or off. The old floating launcher is now optional and off by default.

### Study Kit drawer
A right-side drawer opened from the **Study Desk** sidebar entry, the course bar, the player panel, or `Alt+Shift+S`. It lazy-loads only when first opened.

- **Home** — continue the last lecture, streak, watch time, recent lectures, saved timestamps.
- **Courses** — your purchased batches with progress and per-course lecture lists.
- **Lectures** — searchable index of every lecture, filtered by course and progress.
- **Timestamps** — all saved moments with notes, jump links, and delete.
- **Activity** — 12-week consistency heatmap, weekly watch bars, recent sessions.
- **Settings** — player, completion, sync, and data controls.

### Player
- Resume prompt above the player controls, with **Start over** and **Resume at mm:ss**.
- Skip back/forward buttons in the Video.js control bar (10s by default).
- Timestamp and mark-done buttons in the control bar.
- Progress markers on the seek bar for saved timestamps.
- A lecture panel (**Study Kit** button in the control bar, or `?`) with timestamps and shortcuts.
- Automatic completion at 92% (configurable), plus manual done toggles.
- **Live lectures** — `Space`/`K` play/pause and `←`/`→` seek inside the stream's DVR window. If the live stream has no rewind buffer yet, seeking shows a short “can't be rewound yet” notice instead of failing.

### Search
- `Ctrl/Cmd+K` or `Alt+Shift+F` opens the command palette.
- Searches lectures, courses, timestamps, and actions.
- `↑` / `↓` to move, `Enter` to open, `Esc` to close.

### Timestamps
- Press `B` to save the current moment with an optional note.
- Deep links use `?nt_t=<seconds>`, so a timestamp can be reopened directly and the query is cleaned up afterwards.
- When **Mirror timestamps to the site** is on and you are logged in, new timestamps are also written to your Next Toppers account. Local copies stay if the site call fails.
- Import/export backups and clear data from **Settings → Your data**.

### Sync
- Reads both `COURSE` and `TEST_SERIES` purchases from `mycourses` and merges them.
- Fetches the course list first, then indexes with a two-course concurrency cap, request/page caps, a six-hour per-course freshness window, and cancellation.
- `/private/my-course` triggers a background deep sync at most once every 20 minutes; other pages only refresh the course list.
- Site responses are also observed passively, so lectures you open are indexed even without a full sync.


### Progress
- **Remember my place** saves the playback position locally every ~2 seconds while a lecture plays, and on pause/page hide.
- **Resume automatically** seeks to that local position on open; **Ask before resuming** shows the resume card instead. A `?nt_t=` timestamp link wins over both.
- **Auto-complete** marks a lecture done at the configured threshold. A manual “not done” is remembered and will not be re-completed by site data until you mark it done again.
- The site keeps its own account progress via its heartbeat. The extension reads that completion flag and, only when this device has no local position yet, seeds a local resume point from the site's last-watched value.

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| `←` / `→` | Seek 10s (configurable) |
| `Shift` + `←` / `→` | Seek 30s (configurable) |
| `↑` / `↓` | Volume up/down |
| `Space` / `K` | Play / pause |
| `J` / `L` | Rewind / forward |
| `B` | Save timestamp |
| `D` | Mark lecture done |
| `M` | Mute |
| `F` | Fullscreen |
| `?` | Open the lecture panel |
| `Ctrl/Cmd+K` | Quick search |
| `Alt+Shift+S` | Open Study Kit |
| `Alt+Shift+F` | Quick search |

Shortcuts are ignored while typing in an input and while a Study Kit overlay is open.

## Data and privacy

- Everything is stored in `chrome.storage.local` under the `ntdb` key.
- The extension has **storage** and **scripting** permissions, plus host access to `nexttoppers.com` and its subdomains. Scripting is only used to lazy-inject the drawer, search and player modules when you first open them.
- Course sync and timestamp mirroring use the login cookie you already have on nexttoppers.com. No third-party server is involved.
- Playback progress is written locally (`position`, percent, completion) as you watch. The extension does not send watch heartbeats; nexttoppers.com sends its own, and the extension observes the responses to mirror completion and (once, conservatively) a site-only last position. Local progress is never overwritten by an older site value.
- Content details from the site are decrypted in the page using the site's client-side key. If Next Toppers changes that format, course sync may need an update.
- The demo harness is completely local and uses mocked data; it never contacts the real site.

## Configuration

Open the extension popup → **All settings**, or `chrome://extensions` → Study Kit → **Extension options**.

Notable settings:

- **Skip step / long skip** — 5–30s and 30–90s.
- **Resume automatically / Ask before resuming** — choose between a silent seek and the resume card.
- **Auto-complete threshold** — 70–99%.
- **Show header button / Page tools / Floating launcher / Player controls** — turn individual entry points off. Page tools is on by default; the floating launcher is off.
- **Index courses automatically** — quiet lecture indexing when a course page loads.
- **Mirror timestamps to the site** — also write timestamps to your account (can be switched off).
- **Export / Import / Clear** — full local backup and reset controls.

## Demo harness

The `demo/` folder previews every in-site surface without a Next Toppers login. It seeds courses, lectures, progress, timestamps, a 6-day streak, and a mock Video.js player.

```bash
# from this folder
python3 -m http.server 4173
```

Open:

```
http://127.0.0.1:4173/demo/?seed=1&view=home
```

Useful views:

`home`, `courses`, `course`, `lectures`, `bookmarks`, `activity`, `settings`, `dock`, `composer`, `resume`, `search`, `player`

Useful params:

- `?seed=1` — reset demo data
- `?empty=1` — start with no data
- `?hub=0` — keep the hub closed
- `?course=101` / `?lecture=1004` — choose a course or lecture
- `?q=lens` — prefill search
- `?player=1&dock=1` — open the mock player and lecture panel

The demo uses `demo/chrome-shim.js` to provide a local `chrome.storage` fallback, so the Study Hub runs like a normal web page.

## Project layout

```
manifest.json          Manifest V3 configuration
src/shared.js          Constants, formatting, route parsers, icons
src/store.js           Local data model, progress, bookmarks, settings
src/page-bridge.js     MAIN-world bridge to Video.js and site APIs
src/api.js             Authenticated site API client + content decryption
src/sync.js            Course, lecture, bookmark and completion sync
src/ui-core.js         Shadow-DOM shell, layers, header button, floating tab
src/native.js          Native homepage, sidebar, course bar and player card
src/native.css         Light-DOM styles for the native sections
src/player.js          Player controls, resume card, dock, timestamp composer (lazy)
src/quick-search.js    Command palette (lazy)
src/hub.js             Study Kit drawer views (lazy)
src/content.js         Bootstrapper, routing, global shortcuts, messages
src/host.css           Page-level host and Video.js control styling
src/ui.css             Study Kit design system
src/player.css         Player overlay styling
src/background.js      Service worker and lazy-module injection
popup/                 Toolbar popup
options/               Full settings page
demo/                  Local-only preview harness
assets/                Icons (site Poppins is reused)
```

## Limitations

- Course sync requires a signed-in Next Toppers account and can break if the site changes its private API or content encryption.
- The extension cannot access lecture streams directly; it controls the player already rendered by the site.
- Player integration is built around Video.js with an HTML5 `<video>` fallback. If Next Toppers replaces its player, the custom control bar buttons may need updating.
- This is an independent project, not an official Next Toppers extension.
