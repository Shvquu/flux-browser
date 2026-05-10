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

## [1.2.0] – 2026-05-10

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

[Unreleased]: https://github.com/Shvquu/flux-browser/compare/v1.2.0...HEAD
[1.2.0]: https://github.com/Shvquu/flux-browser/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/Shvquu/flux-browser/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/Shvquu/flux-browser/releases/tag/v1.0.0
