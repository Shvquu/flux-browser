# Security Policy

## Supported Versions

Only the latest release of FLUX Browser receives security fixes. Older versions are not patched.

| Version | Supported |
|---------|-----------|
| 1.5.x (latest) | ✅ |
| < 1.5.0 | ❌ |

---

## Reporting a Vulnerability

**Please do not report security vulnerabilities through public GitHub Issues.**

For any security or privacy vulnerability, use GitHub's private Security Advisory:

👉 **[Open a Security Advisory](https://github.com/Shvquu/flux-browser/security/advisories/new)**

This ensures the issue is handled confidentially before a fix is released publicly.

### What to include

- A clear description of the vulnerability and its impact
- Steps to reproduce (version, OS, settings active at the time)
- Whether you have a suggested fix or mitigation

### Response timeline

| Stage | Target |
|-------|--------|
| Acknowledgement | Within 48 hours |
| Status update | Within 7 days |
| Fix / patch release | Depends on severity |

---

## Scope

The following are considered in-scope security issues:

- **IPC / preload boundary violations** — renderer code escaping the sandbox or accessing Node.js APIs it shouldn't
- **Network filter bypass** — requests that should be blocked by FLUX Shield or the ad/tracker blocker reaching the network
- **Privacy data leaks** — history, cookies, localStorage or any user data being written or transmitted unexpectedly
- **HTTPS-Only bypass** — HTTP requests completing without a warning when HTTPS-Only Mode is active
- **DNS leak** — DNS queries bypassing the configured DoH resolver
- **Auto-updater integrity** — update packages that are not verified before installation
- **Clear-on-Exit bypass** — data that should be wiped on quit persisting after restart
- **Ephemeral Tab data persistence** — any data from an Ephemeral Tab surviving after the tab is closed
- **Remote Code Execution** via malicious web content
- **Content Security Policy bypass**

The following are **out of scope**:

- Vulnerabilities in Electron itself — report those to the [Electron security team](https://github.com/electron/electron/blob/main/SECURITY.md)
- Vulnerabilities in Chromium — report those to the [Chrome VRP](https://bughunters.google.com/about/rules/chrome-friends)
- Issues that require physical access to the device
- Social engineering attacks

---

## Privacy Commitment

FLUX Browser is built on a **Zero Telemetry · Zero Tracking** foundation:

- No analytics, crash reporters or usage metrics are collected
- No data is ever transmitted to Anthropic, the developer, or any third party
- The only outgoing connections initiated by the browser itself are:
    - GitHub Releases API — anonymous version check on startup (no user data sent)
    - EasyList / EasyPrivacy CDN — filter list download (no user data sent)
    - Your configured DoH resolver — DNS queries only
    - Pages and resources you navigate to directly

Any behavior that contradicts the above is considered a security or privacy vulnerability and should be reported.

---

## Disclosure Policy

We follow a **coordinated disclosure** model:

1. Reporter submits a private Security Advisory
2. We confirm and investigate the issue
3. A fix is developed and tested
4. A patched release is published
5. The advisory is made public (typically 7–14 days after the fix ships)

We credit reporters by name (or handle) in the release notes and Security Advisory unless they prefer to remain anonymous.
