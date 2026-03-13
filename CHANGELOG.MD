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

## [1.0.0] – 2025-03-13

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

[Unreleased]: https://github.com/Shvquu/flux-browser/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/Shvquu/flux-browser/releases/tag/v1.0.0