# Changelog

All notable changes to FLUX Browser are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/)
and this project adheres to [Semantic Versioning](https://semver.org/).

---

## [Unreleased]

> Planned features and changes not yet released.

### Planned
- Extension support via `session.loadExtension()`
- Custom quick-links on the start page (add / remove)
- Dark/Light mode toggle
- Zoom control (`Ctrl +`, `Ctrl -`, `Ctrl 0`)
- Print function (`Ctrl + P`)
- Right-click context menu
- Tab groups
- Password manager integration

---

## [1.5.0](https://github.com/Shvquu/flux-browser/compare/v1.2.0...v1.5.0) – 2026-05-24

> **Zero Telemetry. Zero Tracking. Full Control.**

This release delivers the complete **v1.5 Privacy Suite** — a real EasyList/EasyPrivacy-powered ad blocker, a Chrome-style silent auto-updater, a fully wired settings system, and a live Privacy Mode dashboard. Every feature card now reflects actual runtime state instead of static placeholder text.

### Added

#### 🛡️ Built-in Ad & Tracker Blocker (EasyList / EasyPrivacy)
- New `adblock.js` module — standalone filter list manager (~230 lines)
- Downloads and parses **EasyList** and **EasyPrivacy** on first launch — **70,000+ blocked domains** combined
- Local cache with **7-day TTL** — app works offline immediately; re-downloads in the background when a list expires
- **Fast-start path**: cached lists are loaded synchronously before any page navigates so blocking is active from the very first request
- Adblock Plus syntax parser supporting the canonical `||hostname^` domain-blocking pattern
- Subdomain tree walk on every request: `ads.tracker.com → tracker.com` automatically covered
- `isBlockedByFilterList(url)` wired into the main network filter in `main.js` — runs on every outgoing request when FLUX Shield is active
- New `adblockAPI` exposed via `contextBridge`:
  - `getStats()` — total blocked domains, per-list stats, last-update timestamp
  - `updateNow()` — forces an immediate re-download of all lists
  - `toggleList(id, enabled)` — enables or disables individual lists at runtime
  - `onStatus(cb)` — live callback fired when any list update completes
- Privacy Mode dashboard Ad Blocker card now shows: total domain count, per-list breakdown (EasyList / EasyPrivacy), last-updated date
- **"↻ Update now"** button in the card triggers an immediate re-download
- Dashboard re-renders automatically when a background update finishes

#### 🔄 Auto-Updater (Chrome / Brave style)
- New `updater.js` module (~180 lines) — replaces the old inline GitHub API banner in `main.js`
- **Two-path architecture**:
  - **Production (packaged `.exe` / `.dmg`)** — uses `electron-updater` for fully silent download + install:
    1. App starts → checks GitHub Releases after 6 seconds
    2. Newer version found → silent background download begins immediately
    3. Download complete → "Restart to update" banner appears
    4. User clicks → `quitAndInstall()` → browser relaunches with the new version
    5. Periodic re-check every **4 hours**
  - **Development / unpackaged** — graceful fallback to the GitHub Releases API; shows a banner with a direct download link, no crash
- Three distinct banner states rendered above the browser content:
  - 🚀 **Available** — "Version X.Y is available" + Download button
  - ⬇️ **Downloading** — animated gradient progress bar with live percentage
  - ✅ **Downloaded** — pulsing glow "Restart to update" button; re-appears after dismiss until the user restarts
- `autoUpdater.autoInstallOnAppQuit = true` — update installs automatically if the user quits before clicking restart
- Network errors on first launch silently suppressed — offline users see nothing
- New `autoUpdateAPI` exposed via `contextBridge`: `getState()`, `checkNow()`, `downloadNow()`, `restartNow()`, `onStateChange(cb)`
- Legacy `updateAPI` shim retained — existing renderer code continues to work without changes
- `electron-updater ^6.3.9` added as a production dependency
- `publish` config added to `package.json` pointing to `Shvquu/flux-browser` — `electron-builder` generates the required `latest.yml` artifact automatically on release builds

#### ⚙️ Settings System (fully wired)
- `setupSettingsIPC()` was written in v1.2 but never called — all settings IPC handlers were dead code; fixed by registering the call in the startup sequence
- New `settingsAPI` exposed via `contextBridge`:
  - `getAll()` / `get(key)` / `set(key, value)` / `setMultiple(changes)`
  - `resetAll()` / `resetKey(key)` / `getDefaults()`
  - `getSearchEngines()` / `getSearchUrl(query)`
  - `onUpdated(cb)` — live callback fired whenever any setting changes
- Settings changes broadcast to all open windows via `settings-updated` IPC event

#### 🔏 Privacy Mode Dashboard — Live State
- **Progress bar** at the top: "X of 6 features active" with animated gradient fill
- **Ad Blocker card** — live domain count, per-list stats, last-updated date, "↻ Update now" button
- **Cookie Manager card** — shows current third-party cookie blocking status (Blocked / Allowed)
- **DNS-over-HTTPS card** — shows active resolver name (Cloudflare 1.1.1.1 / Quad9 / Google DNS / Custom)
- **Clear-on-Exit card** — lists which data categories are configured to be wiped (cookies, cache, history, localStorage)
- All cards use a left-accent bordered style consistent with the FLUX design system
- Dashboard auto-reloads when a background adblock update completes

#### 🤝 GitHub Community Files
- **`.github/pull_request_template.md`** — type checkboxes (bug/feature/breaking/security), test platform checklist, before/after screenshot table, privacy compliance reminder
- **`.github/ISSUE_TEMPLATE/bug_report.yml`** — OS dropdown, install type, active privacy features at time of bug, DevTools console log field
- **`.github/ISSUE_TEMPLATE/feature_request.yml`** — required "Privacy impact" field ensures new features respect the Zero-Telemetry promise
- **`.github/ISSUE_TEMPLATE/security_report.yml`** — redirects critical vulnerabilities to GitHub's private Security Advisory
- **`.github/ISSUE_TEMPLATE/config.yml`** — disables blank issues; quick links to Discussions and the private Security Advisory
- **`.github/dependabot.yml`** — automated dependency updates:
  - npm: checked **daily** at 06:00 Europe/Berlin; `patch` and `minor` updates grouped into a single PR per ecosystem
  - Electron major-version bumps explicitly ignored (require manual testing)
  - GitHub Actions: checked **weekly** on Monday

### Changed
- `adblock.js` integrated into `main.js` network filter — `isBlockedByFilterList(url)` now runs alongside the hardcoded tracker list on every outgoing request when Shield is active
- Old inline update-checker removed from `main.js` — `GITHUB_REPO`, `RELEASES_API`, `compareVersions()`, `checkForUpdates()` and `setupUpdateIPC()` all moved to `updater.js`
- `preload.js` extended with four new `contextBridge` APIs: `adblockAPI`, `settingsAPI`, `autoUpdateAPI`, and a legacy `updateAPI` shim
- `renderPrivacyModePage()` in `renderer.js` rewritten as a fully async, data-driven function — fetches live state from `privacyAPI` and `adblockAPI` at render time instead of static markup
- Update banner logic in `renderer.js` replaced with `applyUpdateState()` / `renderUpdateBanner()` — three distinct states instead of a single static banner
- `package.json` version bumped to `1.5.0`
- `package.json` build `files` list extended to include `adblock.js`, `settings.js`, `updater.js` and all other root-level modules (previously missing from packaged builds)
- Status bar version string updated from `FLUX v1.2` to `FLUX v1.5`

### Fixed
- `setupSettingsIPC()` was never called — all settings IPC handlers were dead code since v1.2; fixed
- `electron-updater` absence in dev mode caused a silent startup crash — wrapped in `try/catch`, falls back to the GitHub API path gracefully
- Privacy Mode dashboard showed hardcoded placeholder text for ad-blocker stats — now reads live data from `adblockAPI.getStats()`
- "↻ Update now" button in the Privacy Mode card was non-functional — now correctly calls `adblockAPI.updateNow()` and re-renders on completion

### Technical Details
- 4 files modified: `main.js`, `preload.js`, `renderer/renderer.js`, `renderer/style.css`
- 1 file updated: `renderer/index.html` (version string)
- 3 new root-level modules: `adblock.js`, `updater.js`, `settings.js` (wired up)
- 7 new GitHub community files under `.github/`
- New `contextBridge` APIs: `adblockAPI`, `settingsAPI`, `autoUpdateAPI`
- New IPC channels: `adblock-get-stats`, `adblock-update-now`, `adblock-toggle-list`, `adblock-status`, `auto-update-get-state`, `auto-update-check-now`, `auto-update-download-now`, `auto-update-restart`, `auto-update-state`, `settings-get-all`, `settings-get`, `settings-set`, `settings-set-multiple`, `settings-reset-all`, `settings-reset-key`, `settings-get-defaults`, `settings-get-search-engines`, `settings-get-search-url`, `settings-updated`
- New production dependency: `electron-updater ^6.3.9`
- ~4,200 lines of code (up from ~3,400 in v1.2.0)

---

## [1.1.2](https://github.com/Shvquu/flux-browser/compare/v1.1.0...v1.1.2) – 2026-05-10

> **Zero Telemetry. Zero Tracking. Full Control.**

This release completes the core browser experience with six major features — bookmarks, history, downloads, settings, find in page and a keyboard shortcut map — all built natively into FLUX without any external dependencies or cloud sync.

### Added

#### 🔖 Bookmarks System
- Persistent bookmarks stored in `localStorage` — local only, never transmitted
- **`Ctrl+D`** — toggles a bookmark for the current page; the star icon in the navbar fills when the page is already bookmarked
- **Bookmark bar** (`Ctrl+Shift+B`) — compact strip below the navbar showing up to 14 bookmarks as favicon pills; hidden by default
- Long-press the star icon (600ms) to open the full bookmark manager at `flux://bookmarks`
- `flux://bookmarks` — full bookmark manager with:
  - Real-time search filtering by title and URL
  - Per-bookmark delete button
  - Import from any browser via Netscape HTML bookmark format (`<input type="file">`)
  - Export to Netscape HTML for use in other browsers
- Bookmark button state updates automatically on every navigation

#### 📖 Browsing History
- Automatic history recording on every `did-navigate` event
- Ephemeral Tabs and `flux://` internal pages are **never** recorded
- Entries deduplicated within 30-second windows (same URL updates `visitedAt` instead of creating a duplicate)
- Capped at 5,000 entries; oldest entries are removed automatically
- **`Ctrl+H`** opens `flux://history`
- `flux://history` — full history page with:
  - Entries grouped by date: Today, Yesterday, This Week, older dates as `DD.MM.YYYY`
  - Live search filtering by URL and title
  - Per-entry delete button
  - "Clear All" with confirmation dialog

#### ⬇️ Download Manager
- Automatic download interception via `session.defaultSession.on('will-download')`
- Chrome-style download shelf slides up from the bottom of the window on every new download
- Each download shown as a card with file-type icon (🎬 🎵 🖼 📦 ⚙️ 📄 📝), filename, size and live progress
- Gradient progress bar (purple→cyan) with percentage and received/total size
- `📂 Open` button after completion calls `shell.showItemInFolder()`
- Close button (✕) dismisses the shelf; `Show all` opens `flux://downloads`
- Download badge on the navbar button shows count of active downloads
- **`Ctrl+J`** opens `flux://downloads` with full session download history
- New IPC channels: `download-started`, `download-progress`, `download-done`, `download-cancel`, `download-open-folder`
- New `contextBridge` API: `downloadAPI`

#### ⚙️ Settings Panel
- **`flux://settings`** — fully integrated settings page, no OS dialogs
- Sections:
  - **General** — new tab page: FLUX default or custom URL
  - **Search** — default engine: Google, DuckDuckGo, Brave Search, Bing
  - **Appearance** — UI scale: 90% / 100% / 110% / 120%
  - **Privacy** — toggles for Shield default, Fingerprint Guard, Ephemeral-by-default
  - **About** — version, GitHub link
- Settings stored in `localStorage` under `flux-settings` and applied immediately on startup
- Gear icon button added to navbar (`id="btn-settings"`)

#### 🔍 Find in Page
- **`Ctrl+F`** opens a compact search bar in the top-right corner of the webview
- Slides in with CSS transition; `Esc` closes and clears the selection
- Match counter: `3 of 12`
- `Enter` = next match, `Shift+Enter` = previous match
- **`Aa`** toggle for case-sensitive search
- **`.*`** toggle for regex mode
- Powered by `webview.findInPage()` and `found-in-page` event
- `webview.stopFindInPage('clearSelection')` called on close

#### ⌨️ Keyboard Shortcut Map
- **`F1`** — full-screen overlay showing all shortcuts with styled key badges in a two-column grid
- Overlay closes on `F1` or `Esc`
- `flux://shortcuts` — permanent reference page with the same content
- All shortcuts from this release included in the map

#### Update Checker
- Polls the GitHub Releases API 4 seconds after startup
- Compares `app.getVersion()` against the latest release tag
- If an update is available: an orange banner appears between the navbar and the webview
- Banner shows version number with a "Download Update" button (opens the GitHub releases page) and a dismiss button
- Zero telemetry: no user data sent, only a single anonymous GET request to the public GitHub API

### Changed
- `createTab()` now reads `ephemeralDefault` from settings — all new tabs open as Ephemeral if the setting is enabled
- `parseInput()` extended to recognise `flux://bookmarks`, `flux://history`, `flux://settings`, `flux://downloads`, `flux://shortcuts`
- `navigate()` rewritten with a unified `INTERNAL_MAP` — adding new internal pages no longer requires changes in four separate places
- `activateTab()` uses `PAGE_MAP` for the same reason — fully data-driven internal page routing
- New tab page tagline updated to "Zero Telemetry · Zero Tracking · Full Control"
- Build system migrated from Electron Forge to **electron-builder** for full NSIS and DMG control
- macOS DMG format changed from default (7zip) to `UDZO` to fix build failures on arm64 GitHub runners
- `author` field in `package.json` changed from string to object with `name` and `email` (required for `.deb` packages)
- `electron` version pinned to exact `29.4.6` (no `^`) to fix `electron-builder` version detection

### Fixed
- macOS build failing with `E_INVALIDARG` on arm64 GitHub runners — fixed by removing the `zip` target and setting `"format": "UDZO"` on DMG
- Linux `.deb` build failing with "Please specify author email" — fixed by converting `author` to an object
- `electron-builder` failing with "unknown property env" — removed invalid `env` key from build config
- `electron-builder` failing with "cannot compute electron version" — pinned electron to exact version

### Technical Details
- 5 files modified: `main.js`, `preload.js`, `renderer.js`, `style.css`, `index.html`
- 1 new IPC channel group: `download-*`
- 1 new `contextBridge` API: `downloadAPI`
- 6 new `flux://` internal pages: `bookmarks`, `history`, `settings`, `downloads`, `shortcuts` + update banner
- New keyboard shortcuts: `Ctrl+D`, `Ctrl+Shift+B`, `Ctrl+H`, `Ctrl+F`, `Ctrl+J`, `F1`
- ~3,400 lines of code (up from ~2,400 in v1.1.0)

---

## [1.1.0] – 2026-03-14

> **Zero Telemetry. Zero Tracking. Full Control.**

This release introduces the complete **FLUX Privacy Stack** – four interlocking
privacy systems that together form a fundamentally new approach to browser security.
Rather than reacting to known trackers, FLUX now controls from the ground up what
data a website can ever see.

### Added

#### 🛡️ FLUX Shield – Zero-Connection Mode
- Global network filter via Electron's `session.webRequest.onBeforeRequest()`
- **Always-blocked tracker domains** (independent of Shield state): Google Analytics,
  Google Tag Manager, DoubleClick, Facebook Pixel, Hotjar, Fullstory, Mixpanel,
  Amplitude, Segment, Clarity, Twitter Ads, Outbrain, Taboola and more
- **Shield mode** (toggleable): additionally blocks all automatic background
  connections – Safe Browsing, update checks, OCSP, internal Chromium telemetry
- Live connection log with per-entry type tagging: `allowed`, `blocked-tracker`, `blocked-bg`
- Shield toggle button in the navbar (cyan glow = active, badge counter for blocked)
- Pulse animation on the Shield button when a connection is blocked
- `flux://network` – internal Network Monitor page:
  - Live stats: connections allowed / trackers blocked / background blocked
  - Full scrollable connection log with domain, type badge and timestamp
  - Shield toggle directly on the page
  - Real-time updates without page refresh

#### 🔐 Dynamic Fingerprint Randomization
- `fingerprint-guard.js` injected as preload into every `<webview>` before page JS runs
- Per-page random seed – each site gets a unique identity, no stable fingerprint
- **Canvas**: single pixel modified at seeded position – invisible to user, hash changes
- **WebGL**: GPU renderer and vendor strings replaced with plausible randomized values
- **AudioContext**: inaudible noise (±0.0001) injected into first 100 buffer samples
- **Navigator**: `hardwareConcurrency`, `deviceMemory`, `platform` randomized
- **Screen**: width/height varied ±8px per session
- **Timing**: `performance.now()` resolution reduced to 1ms (prevents timing attacks)
- `flux://privacy` – Fingerprint Guard dashboard:
  - Live counters: neutralized fingerprint attempts, blocked connections, unique identities
  - Per-protection status list with attempt counters
  - Link to Network Monitor

#### 👻 Ephemeral Tabs
- New tab type with fully isolated, in-memory Electron session (no `persist:` prefix)
- Each Ephemeral Tab gets a unique partition: `ephemeral-{id}-{timestamp}`
- **Nothing is written to disk**: no cookies, no cache, no LocalStorage, no IndexedDB,
  no HTTP cache, no Service Workers
- On close: `session.clearStorageData()` + `clearCache()` + `clearAuthCache()` called via IPC
- Multiple Ephemeral Tabs are fully isolated from each other (no shared session)
- 👻 button in the tab bar + `Ctrl+Shift+T` keyboard shortcut
- Orange glow on active Ephemeral Tab for clear visual distinction
- Ghost icon (👻) displayed in the tab strip next to the title
- Ephemeral banner on the new-tab page listing what is not stored

#### 🔒 FLUX Trust Network – Permissioned Internet Mode
- Zero-Trust model: every new site starts at **Standard** level, APIs anonymized
- Three trust levels per domain:
  - **Strict** (🔴) – all fingerprint APIs blocked or anonymized, maximum protection
  - **Standard** (🟡) – all fingerprint APIs anonymized, default for unknown sites
  - **Trusted** (🟢) – APIs passed through, only tracker blocking remains active
- Per-API permission control: `anonymize` / `allow` / `block` for Canvas, WebGL, Audio, Navigator, Screen
- Trust config injected into each webview via `executeJavaScript()` on `dom-ready`
- Fingerprint attempts reported back via `ipcRenderer.sendToHost()` and counted per domain
- Trust-Badge in the address bar (colored dot): shows trust level, click opens `flux://trust`
- `flux://trust` – Trust Control Panel with live updates, per-domain reset and per-API cycling

#### Internal Pages (flux:// Protocol)
- `flux://network`, `flux://privacy`, `flux://trust`
- All internal pages use inline styles for reliable rendering
- Tab-switching between internal pages and regular tabs fully supported
- Navigating away from any internal page correctly restores the webview

### Fixed
- Internal pages no longer block subsequent navigation in the same tab after being visited
- Tab-switching between internal pages no longer leaves stale overlapping divs
- `activateTab()` now fully clears all internal page layers before showing the correct view

### Changed
- `createTab()` accepts an `options` parameter (`{ ephemeral: true }`)
- `showNewTabPage()` accepts an `isEphemeral` parameter to show the privacy banner
- `fingerprint-guard.js` reads `window.__fluxTrustConfig` per API call
- `Ctrl+T` guard tightened to `!e.shiftKey` to avoid conflict with `Ctrl+Shift+T`

### Technical Details
- 6 files modified: `main.js`, `preload.js`, `renderer.js`, `style.css`, `index.html`, `fingerprint-guard.js`
- IPC channels: `shield-*`, `fp-*`, `ephemeral-*`, `trust-*`
- `contextBridge` APIs: `shieldAPI`, `fingerprintAPI`, `ephemeralAPI`, `trustAPI`
- ~2,400 lines of code (up from ~1,400 in v1.0.0)

---

## [1.0.0] – 2026-03-13

First official release of FLUX Browser.

> **Zero Telemetry. Zero Tracking. Full Control.**

### Added

#### Browser Core
- Full tab system – create, close, switch and drag & drop reorder tabs
- `<webview>`-based rendering with full process isolation
- Back/Forward navigation with correct history tracking
- Reload function (toggle: cancel loading / reload page)
- Automatic URL detection: domain → HTTPS, text → Google search
- New-window requests are intercepted as new tabs (no OS popup)

#### User Interface
- Custom frameless title bar (`frame: false`) with minimize/maximize/close buttons
- Futuristic cyberpunk design – purple, cyan, orange matching the FLUX logo
- Animated loading bar with shimmer effect and asymptotic progress
- Security indicator in the address bar (green = HTTPS, orange = HTTP)
- Per-tab loading spinner during page load
- Per-tab favicon display with fallback icon
- Tab title display with tooltip for long titles
- Status bar with hover URL display and version number

#### Start Page
- Custom new-tab page with FLUX logo (floating with glow effect)
- Live clock with date (updates every second)
- Integrated search bar with direct navigation
- 6 quick-link tiles: Google, YouTube, GitHub, Wikipedia, Reddit, X
- Fade-in animations when opening a new tab

#### Design System
- CSS custom properties for consistent theming
- Glassmorphism effects on UI elements
- Neon glow on active tab (purple-cyan gradient line)
- Gradient text for FLUX wordmark (purple → cyan → white)
- Float animation on the start page logo
- Scanline overlay as subtle background texture
- Orbitron (headings) + JetBrains Mono (URL bar) + Exo 2 (UI)

#### Security & Privacy
- `contextIsolation: true` – JS contexts strictly separated
- `nodeIntegration: false` – no Node.js access in the renderer
- `webSecurity: true` – same-origin policy enforced
- `allowpopups: false` – no automatic popups
- Content Security Policy for the app shell
- `contextBridge`-based preload bridge
- **Zero telemetry** – no tracking, no analytics, no data collection of any kind

#### Keyboard Shortcuts
- `Ctrl+T` – New tab
- `Ctrl+W` – Close active tab
- `Ctrl+L` – Focus address bar
- `F5` / `Ctrl+R` – Reload page
- `Alt+←` / `Alt+→` – Back/Forward
- `Ctrl+1–9` – Direct tab switching

#### Platform & Build
- Runs on Windows, macOS and Linux without code changes
- `npm start` – development mode
- `npm run make` – cross-platform build
- GitHub Actions CI/CD – automatic builds and releases on tag push
- App icon in taskbar via `icon` property in `BrowserWindow`
- Squirrel event handling for proper Windows installation

### Technical Details
- Electron 29.x · Node.js 18.x+
- ~1,400 lines of code across 5 files

---

## Versioning

FLUX Browser follows [Semantic Versioning](https://semver.org/):

- **MAJOR** (`1.x.x`) – Incompatible architectural changes
- **MINOR** (`x.1.x`) – New features, backwards-compatible
- **PATCH** (`x.x.1`) – Bug fixes and minor improvements

---

[Unreleased]: https://github.com/Shvquu/flux-browser/compare/v1.5.0...HEAD
[1.5.0]: https://github.com/Shvquu/flux-browser/compare/v1.1.2...v1.5.0
[1.1.2]: https://github.com/Shvquu/flux-browser/compare/v1.1.1...v1.1.2
[1.1.1]: https://github.com/Shvquu/flux-browser/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/Shvquu/flux-browser/releases/tag/v1.0.0
