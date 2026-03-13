# FLUX Browser

<div align="center">

<img src="renderer/flux.png" alt="FLUX Browser Logo" width="120"/>

### Zero Telemetry. Zero Tracking. Full Control.
**Built with Electron · Windows · macOS · Linux**

![Version](https://img.shields.io/github/v/release/Shvquu/flux-browser?style=flat-square&color=9b3dff&label=version)
![Electron](https://img.shields.io/badge/electron-29.x-5ce0ff?style=flat-square)
![License](https://img.shields.io/badge/license-MIT-ff6a00?style=flat-square)
![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-444?style=flat-square)
![Downloads](https://img.shields.io/github/downloads/Shvquu/flux-browser/total?style=flat-square&color=9b3dff&label=Downloads)

</div>

---

## Table of Contents

- [About FLUX](#about-flux)
- [Features](#features)
- [Downloads](#downloads)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Usage](#usage)
- [Keyboard Shortcuts](#keyboard-shortcuts)
- [Project Structure](#project-structure)
- [Architecture](#architecture)
- [Build & Distribution](#build--distribution)
- [Customization](#customization)
- [Security](#security)
- [License](#license)

---

## About FLUX

FLUX is a custom desktop browser built on top of [Electron](https://www.electronjs.org/). It combines the Chromium rendering engine with a futuristic cyberpunk-style interface — purple, cyan, and orange, matching the FLUX logo.

> **Zero Telemetry. Zero Tracking. Full Control.**  
> FLUX collects no usage data, sends no crash reports, and includes no analytics SDKs. What you do in your browser stays on your machine.

The project is aimed at developers who want to understand how browsers work internally, or who want to use a custom browser as the foundation for specialized applications (kiosk systems, white-label browsers, internal tools).

---

## Features

- **Full Tab Management** – Open, close, switch and drag & drop reorder tabs
- **Custom Start Page** – Logo, live clock, search bar and quick-links
- **Futuristic UI** – Cyberpunk design with neon glow, glassmorphism and animated elements
- **Custom Title Bar** – Frameless window with custom minimize/maximize/close buttons
- **Security Architecture** – `contextIsolation`, no `nodeIntegration`, preload bridge, CSP
- **Progress Bar** – Realistic loading bar with shimmer effect
- **Status Bar** – Shows hover URLs and browser version
- **Cross-Platform** – Runs on Windows, macOS and Linux without code changes
- **Keyboard Shortcuts** – Full keyboard control
- **Zero Telemetry** – No tracking, no analytics, no data collection

---

## Downloads

[![GitHub Releases](https://img.shields.io/github/downloads/Shvquu/flux-browser/total?style=flat-square&color=9b3dff&label=Total%20Downloads)](https://github.com/Shvquu/flux-browser/releases)

| Platform | File | Download |
|----------|------|----------|
| 🪟 Windows | `.exe` Installer | [Latest Release](https://github.com/Shvquu/flux-browser/releases/latest) |
| 🍎 macOS   | `.dmg`           | [Latest Release](https://github.com/Shvquu/flux-browser/releases/latest) |
| 🐧 Linux   | `.deb` / `.rpm`  | [Latest Release](https://github.com/Shvquu/flux-browser/releases/latest) |

[→ View all releases and previous versions](https://github.com/Shvquu/flux-browser/releases)

---

## Prerequisites

| Software | Minimum Version | Download |
|----------|----------------|---------|
| Node.js  | 18.x           | [nodejs.org](https://nodejs.org) |
| npm      | 9.x            | Included with Node.js |
| Git      | any            | [git-scm.com](https://git-scm.com) |

---

## Installation

```bash
# 1. Clone the repository
git clone https://github.com/Shvquu/flux-browser.git
cd flux-browser

# 2. Install dependencies
npm install

# 3. Start the browser
npm start
```

> **Windows note:** If Electron shows a security dialog on first launch, click "Run anyway".

---

## Usage

FLUX opens directly on its custom start page. From there:

- **Enter a URL** – Click the address bar and type a URL or search query, then press Enter
- **New Tab** – Click the `+` button in the tab bar or press `Ctrl+T`
- **Search** – Type any text in the address bar or start page search → automatic Google search
- **Quick-Links** – Jump to your most used sites directly from the start page
- **Reorder Tabs** – Drag and drop tabs to rearrange them

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl + T` | New tab |
| `Ctrl + W` | Close active tab |
| `Ctrl + L` | Focus address bar |
| `F5` / `Ctrl + R` | Reload page |
| `Alt + ←` | Go back |
| `Alt + →` | Go forward |
| `Ctrl + 1–9` | Switch to tab 1–9 directly |

---

## Project Structure

```
flux-browser/
│
├── main.js              # Main Process – window, IPC, security
├── preload.js           # Preload Script – secure bridge to Node.js
├── package.json         # Project metadata & npm scripts
├── forge.config.js      # Electron Forge build configuration
│
├── renderer/            # Renderer Process – the user interface
│   ├── index.html       # HTML structure of the browser shell
│   ├── renderer.js      # UI logic: tabs, navigation, events
│   ├── style.css        # Futuristic cyberpunk design
│   └── flux.png         # App logo
│
├── .github/
│   └── workflows/
│       └── build.yml    # GitHub Actions CI/CD
│
├── README.md
├── LICENSE.MD
└── CHANGELOG.MD
```

---

## Architecture

FLUX follows the strict Electron two-process architecture:

```
┌─────────────────────────────────────────────────┐
│                  Main Process                    │
│  Node.js + Electron API                         │
│  • Create BrowserWindow                         │
│  • Handle IPC messages                          │
│  • Native OS APIs (menu, tray, dialogs)         │
└────────────────┬────────────────────────────────┘
                 │  IPC (ipcMain / ipcRenderer)
                 │  via contextBridge (secure)
┌────────────────▼────────────────────────────────┐
│               Renderer Process                   │
│  Chromium + Web APIs                            │
│  • Browser UI (HTML/CSS/JS)                     │
│  • Tab management                               │
│  • Navigation                                   │
└────────────────┬────────────────────────────────┘
                 │  <webview> tag (isolated process)
┌────────────────▼────────────────────────────────┐
│             WebView Process(es)                  │
│  • Loaded web pages                             │
│  • Fully sandboxed                              │
│  • No access to app internals                   │
└─────────────────────────────────────────────────┘
```

**Why `contextIsolation: true`?**  
Without this option, any loaded web page could access Node.js APIs via `window` and read files or start processes. With `contextIsolation`, JavaScript contexts are completely separated.

**Why `preload.js`?**  
The preload script is the only allowed bridge. It runs in a privileged context and exposes only explicitly defined, safe methods to the renderer via `contextBridge.exposeInMainWorld()`.

---

## Build & Distribution

### Build locally

```bash
npm run make
```

Finished packages are placed in `out/make/`. On Windows this creates a `.exe` installer.

### Automated builds via GitHub Actions

Every push to a version tag (e.g. `v1.0.1`) automatically:
1. Builds for Windows, macOS and Linux in parallel
2. Creates a GitHub Release
3. Attaches all installer files (`.exe`, `.dmg`, `.deb`, `.rpm`)

```bash
git tag v1.0.1
git push origin v1.0.1
```

> **Icon note:** Windows requires a `.ico` file. Convert `flux.png` for free at [cloudconvert.com](https://cloudconvert.com/png-to-ico).

---

## Customization

### Change quick-links on the start page

In `renderer/renderer.js`, function `showNewTabPage()`, edit the `quickLinks` array:

```js
const quickLinks = [
  { label: 'Google',    url: 'https://google.com',  icon: 'G' },
  { label: 'Your Site', url: 'https://your-url.com', icon: '★' },
]
```

### Change colors

All colors are defined as CSS variables in `renderer/style.css` under `:root { ... }`.

---

## Security

FLUX implements all Electron-recommended security best practices:

| Measure | Status | Description |
|---------|--------|-------------|
| `contextIsolation` | ✅ enabled | JS contexts are strictly separated |
| `nodeIntegration` | ✅ disabled | No Node.js access in the renderer |
| `webSecurity` | ✅ enabled | Same-origin policy enforced |
| `allowpopups` | ✅ disabled | No automatic popup windows |
| Content Security Policy | ✅ set | Restricted resources for the app shell |
| Preload bridge | ✅ | Only explicitly exposed APIs reachable |
| **Zero Telemetry** | ✅ | No tracking, no analytics, no data collection |

Further reading: [Electron Security Documentation](https://www.electronjs.org/docs/latest/tutorial/security)

---

## License

MIT – see [LICENSE.md](LICENSE.MD)