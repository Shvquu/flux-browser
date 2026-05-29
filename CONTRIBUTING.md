# Contributing to FLUX Browser

Thanks for taking the time to contribute! FLUX Browser is a privacy-first Electron browser and every contribution — bug fix, feature, documentation improvement or issue report — is welcome.

---

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [Project Structure](#project-structure)
- [Making Changes](#making-changes)
- [Commit Messages](#commit-messages)
- [Pull Requests](#pull-requests)
- [Reporting Bugs](#reporting-bugs)
- [Suggesting Features](#suggesting-features)
- [Security Vulnerabilities](#security-vulnerabilities)
- [Privacy Rules](#privacy-rules)

---

## Code of Conduct

Be respectful, constructive and welcoming. We do not tolerate harassment, discrimination or personal attacks of any kind.

---

## Getting Started

1. **Fork** the repository and clone your fork
2. Create a **feature branch** off `main`:
   ```bash
   git checkout -b feat/my-feature
   ```
3. Make your changes, test them, then open a Pull Request

---

## Development Setup

**Requirements:**
- [Node.js](https://nodejs.org/) v18 or newer
- npm v9 or newer
- Windows, macOS, or Linux

```bash
# Install dependencies
npm install

# Start the browser in development mode
npm start

# Build a distributable installer
npm run build
```

> The first `npm start` downloads EasyList and EasyPrivacy filter lists in the background (~3–4 MB). This is normal.

---

## Project Structure

```
flux-browser/
├── main.js                  # Electron main process — window, IPC, network filter
├── preload.js               # contextBridge APIs exposed to the renderer
├── adblock.js               # EasyList / EasyPrivacy filter list manager
├── updater.js               # Auto-updater (electron-updater + GitHub API fallback)
├── settings.js              # Persistent settings IPC handlers
├── bookmarks.js             # Bookmark storage and IPC
├── history.js               # Browsing history storage and IPC
├── downloads.js             # Download manager IPC
├── network-transparency.js  # Network log / Shield transparency
├── renderer/
│   ├── index.html           # Main browser window HTML
│   ├── renderer.js          # All UI logic (~4,200 lines)
│   └── style.css            # All styles
└── .github/
    ├── dependabot.yml
    ├── pull_request_template.md
    └── ISSUE_TEMPLATE/
```

**Key concepts:**
- **Main process** (`main.js`) handles Electron APIs, sessions, network filtering and IPC
- **Renderer process** (`renderer/renderer.js`) handles all UI — tabs, navigation, internal pages (`flux://`)
- **preload.js** is the only bridge between them — all communication goes through `contextBridge`
- Internal pages like `flux://settings`, `flux://history` etc. are rendered entirely in JavaScript inside the renderer, not as separate HTML files

---

## Making Changes

### Style guide

- **JavaScript** — no transpiler, no TypeScript, plain ES2020+ that Electron's Node.js version supports natively
- **Indentation** — 2 spaces
- **Strings** — single quotes for JS, backtick template literals where interpolation is needed
- **Semicolons** — none (ASI)
- **Comments** — use `// ── Section Name ──` headers for major blocks, inline comments for non-obvious logic
- **No external runtime dependencies** unless absolutely necessary — keep the dependency footprint small

### Adding a new internal page (`flux://`)

1. Add a `render<PageName>Page(tabId)` function in `renderer.js`
2. Register the route in the `INTERNAL_MAP` object in `navigate()`
3. Add a matching entry in `PAGE_MAP` in `activateTab()`
4. Add the `flux://<name>` case to `parseInput()` in `renderer.js`
5. Add the keyboard shortcut (if any) to the shortcut overlay and `flux://shortcuts`

### Adding a new IPC channel

1. Register the handler in the appropriate module (`main.js` or a dedicated `*.js` module)
2. Expose it via `contextBridge` in `preload.js`
3. Document the new channel in the `### Technical Details` section of `CHANGELOG.MD`

---

## Commit Messages

Follow the [Conventional Commits](https://www.conventionalcommits.org/) format:

```
<type>(<scope>): <short description>

[optional body]
```

**Types:**

| Type | When to use |
|------|-------------|
| `feat` | New feature |
| `fix` | Bug fix |
| `chore` | Build, deps, tooling |
| `docs` | Documentation only |
| `style` | Formatting, no logic change |
| `refactor` | Code restructure, no behavior change |
| `perf` | Performance improvement |
| `security` | Security fix |

**Examples:**
```
feat(adblock): add per-list enable/disable toggle
fix(updater): suppress network errors on first launch
chore(deps): bump electron-updater to 6.3.9
docs(contributing): add IPC channel guidelines
security(ipc): restrict contextBridge to allowed channels only
```

---

## Pull Requests

- Fill out the **pull request template** completely
- Keep PRs focused — one feature or fix per PR
- All PRs target the `main` branch
- Make sure `npm start` runs without errors before submitting
- If your PR changes the UI, include a before/after screenshot
- If your PR adds a new IPC channel or `contextBridge` API, document it

PRs that introduce telemetry, external tracking, cloud sync or any form of data collection will not be merged. See [Privacy Rules](#privacy-rules).

---

## Reporting Bugs

Use the **[Bug Report](https://github.com/Shvquu/flux-browser/issues/new?template=bug_report.yml)** issue template.

Please include:
- FLUX Browser version (shown in the status bar, bottom right)
- Operating system and version
- Steps to reliably reproduce the issue
- Any errors from the DevTools console (`Ctrl+Shift+I`)
- Which privacy features were active at the time

---

## Suggesting Features

Use the **[Feature Request](https://github.com/Shvquu/flux-browser/issues/new?template=feature_request.yml)** issue template.

Good feature requests explain the problem being solved, not just the solution. Include a "Privacy impact" assessment — any feature that requires an outgoing connection or external service needs a strong justification.

---

## Security Vulnerabilities

**Do not open a public issue for security vulnerabilities.**

Report them privately via the **[Security Advisory](https://github.com/Shvquu/flux-browser/security/advisories/new)**. See [SECURITY.md](./SECURITY.md) for the full policy.

---

## Privacy Rules

FLUX Browser's core promise is **Zero Telemetry · Zero Tracking · Full Control**. All contributions must respect this:

- ❌ No analytics, crash reporters or usage metrics
- ❌ No data sent to any server without explicit user action
- ❌ No third-party SDKs that phone home
- ❌ No `localStorage` or `IndexedDB` data synced externally
- ✅ All new outgoing connections must be opt-in, clearly documented, and user-controlled
- ✅ The only connections FLUX initiates itself: GitHub Releases API (version check), EasyList/EasyPrivacy CDN (filter lists), and the user's configured DoH resolver

Any contribution that violates these rules will not be accepted regardless of how useful the feature is.