# Changelog

All notable changes to FLUX Browser are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/)
and this project adheres to [Semantic Versioning](https://semver.org/).

---

## [Unreleased]

> Planned features and changes not yet released.

### Planned
- Bookmark manager with persistent storage
- Browser history with search
- Extension support via `session.loadExtension()`
- Settings page (start page, search engine, theme)
- Download manager with progress indicator
- Custom quick-links (add / remove)
- Dark/Light mode toggle
- Zoom control (`Ctrl +`, `Ctrl -`, `Ctrl 0`)
- Print function (`Ctrl + P`)
- Right-click context menu

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
- Live connection log with per-entry type tagging: `allowed`, `blocked-tracker`,
  `blocked-bg`
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
- On close: `session.clearStorageData()` + `clearCache()` + `clearAuthCache()` called
  via IPC – RAM freed immediately
- Multiple Ephemeral Tabs are fully isolated from each other (no shared session)
- 👻 button in the tab bar + `Ctrl+Shift+T` keyboard shortcut
- Orange glow on active Ephemeral Tab for clear visual distinction
- Ghost icon (👻) displayed in the tab strip next to the title
- Ephemeral banner on the new-tab page: lists what is not stored

#### 🔒 FLUX Trust Network – Permissioned Internet Mode
- Zero-Trust model: every new site starts at **Standard** level, APIs anonymized
- Three trust levels per domain:
  - **Strict** (🔴) – all fingerprint APIs blocked or anonymized, maximum protection
  - **Standard** (🟡) – all fingerprint APIs anonymized, default for unknown sites
  - **Trusted** (🟢) – APIs passed through, only tracker blocking remains active
- Per-API permission control: `anonymize` / `allow` / `block` for each of
  Canvas, WebGL, Audio, Navigator, Screen – independently per domain
- Trust config injected into each webview via `executeJavaScript()` on `dom-ready`,
  before any page JS runs – sites never receive unguarded access
- Fingerprint attempts reported back to main process via `ipcRenderer.sendToHost()`
  and counted per domain
- Trust-Badge in the address bar (colored dot): shows trust level of current page,
  click opens `flux://trust`
- `flux://trust` – Trust Control Panel:
  - All known domains listed, sorted by fingerprint request count
  - One-click level switching per domain
  - Per-API permission badges cycle on click: `anonymize → allow → block`
  - Reset button to return any domain to default Standard level
  - Live updates – no page reload needed
  - All trust data stored locally in memory only, never transmitted

#### Internal Pages (flux:// Protocol)
- `flux://network` – FLUX Shield Network Monitor
- `flux://privacy` – Fingerprint Guard dashboard
- `flux://trust` – Trust Network control panel
- All internal pages use inline styles for reliable rendering independent of
  external stylesheets; system fonts guarantee correct number/glyph display
- Tab-switching between internal pages and regular tabs fully supported
- Navigating away from any internal page correctly restores the webview

### Fixed
- Internal pages (`flux://network`, `flux://privacy`, `flux://trust`) no longer
  block subsequent navigation in the same tab after being visited
- Tab-switching between internal pages no longer leaves stale overlapping divs
- `activateTab()` now fully clears all three internal page layers before
  showing the correct view, preventing invisible overlay issues

### Changed
- `createTab()` accepts an `options` parameter (`{ ephemeral: true }`)
- `showNewTabPage()` accepts an `isEphemeral` parameter to show the privacy banner
- `fingerprint-guard.js` now reads `window.__fluxTrustConfig` per API call,
  enabling runtime permission changes without reloading the preload
- `Ctrl+T` guard tightened to `!e.shiftKey` to avoid conflict with `Ctrl+Shift+T`

### Technical Details
- 6 files modified / extended: `main.js`, `preload.js`, `renderer.js`,
  `style.css`, `index.html`, `fingerprint-guard.js`
- 3 new IPC channels: `shield-*`, `fp-*`, `ephemeral-*`, `trust-*`
- 4 new `contextBridge` APIs: `shieldAPI`, `fingerprintAPI`, `ephemeralAPI`, `trustAPI`
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
- `contextBridge`-based preload bridge (only 4 explicit methods)
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
- `npm run make` – cross-platform build to `.exe` / `.dmg` / `.deb` / `.rpm`
- GitHub Actions CI/CD – automatic builds and releases on tag push
- App icon in taskbar via `icon` property in `BrowserWindow`
- Squirrel event handling for proper Windows installation
  (desktop shortcut, Start Menu entry, Apps & Features entry)

### Technical Details
- Electron 29.x
- Node.js 18.x+
- Runtime dependency: `electron-squirrel-startup`
- ~1,400 lines of code across 5 files

---

## Versioning

FLUX Browser follows [Semantic Versioning](https://semver.org/):

- **MAJOR** (`1.x.x`) – Incompatible architectural changes
- **MINOR** (`x.1.x`) – New features, backwards-compatible
- **PATCH** (`x.x.1`) – Bug fixes and minor improvements

---

[Unreleased]: https://github.com/Shvquu/flux-browser/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/Shvquu/flux-browser/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/Shvquu/flux-browser/releases/tag/v1.0.0