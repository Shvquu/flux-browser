// ============================================================
// updater.js – Auto-Update System (Chrome/Brave style)
// ============================================================
// Uses electron-updater to silently download updates in the
// background and prompt the user to restart when ready.
//
// Flow (mirrors Chrome/Brave behavior):
//   1. App starts → check GitHub for newer release
//   2. Update found → download silently in background
//   3. Download complete → show "Restart to update" banner
//   4. User clicks restart → quit + install + relaunch
//
// In dev mode (no code-signing / no published release):
//   falls back to the old GitHub API check so the banner
//   still shows even without a real installer artifact.
// ============================================================

const { app, ipcMain, BrowserWindow, shell } = require('electron')

// ── State ──────────────────────────────────────────────────
const state = {
  status:          'idle',   // idle | checking | available | downloading | downloaded | error | upToDate
  currentVersion:  app.getVersion(),
  latestVersion:   null,
  downloadProgress: 0,       // 0-100
  error:           null,
  releaseNotes:    null,
  releaseUrl:      null,
  publishedAt:     null,
}

// ── Broadcast helper ───────────────────────────────────────
function broadcast(channel, payload) {
  BrowserWindow.getAllWindows().forEach(w => {
    if (!w.isDestroyed()) w.webContents.send(channel, payload)
  })
}

function sendState() {
  broadcast('auto-update-state', { ...state })
}

// ── Version compare ────────────────────────────────────────
function compareVersions(a, b) {
  const pa = String(a).replace(/^v/, '').split('.').map(Number)
  const pb = String(b).replace(/^v/, '').split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return  1
    if ((pa[i] || 0) < (pb[i] || 0)) return -1
  }
  return 0
}

// ── electron-updater path ──────────────────────────────────
// electron-updater is an optional peer dep — wrap in try/catch
// so the app still runs in dev without it installed.
let autoUpdater = null
let euAvailable = false

try {
  autoUpdater = require('electron-updater').autoUpdater
  euAvailable = true
} catch (_) {
  console.log('[Updater] electron-updater not found — using GitHub API fallback')
}

// ══════════════════════════════════════════════════════════
// PATH A: electron-updater (production / packaged builds)
// ══════════════════════════════════════════════════════════

function setupElectronUpdater() {
  autoUpdater.autoDownload    = false  // we control the download
  autoUpdater.autoInstallOnAppQuit = true  // install when user quits
  autoUpdater.allowPrerelease = false
  autoUpdater.allowDowngrade  = false

  // Keep the update log quiet (no debug spam)
  autoUpdater.logger          = null

  // ── Events ──────────────────────────────────────────────

  autoUpdater.on('checking-for-update', () => {
    state.status = 'checking'
    sendState()
    console.log('[Updater] Checking for updates…')
  })

  autoUpdater.on('update-available', (info) => {
    state.status         = 'available'
    state.latestVersion  = info.version
    state.releaseNotes   = info.releaseNotes || null
    state.publishedAt    = info.releaseDate  || null
    sendState()
    console.log(`[Updater] Update available: v${info.version}`)

    // Start silent background download immediately (Chrome behavior)
    setTimeout(() => autoUpdater.downloadUpdate(), 1500)
  })

  autoUpdater.on('update-not-available', () => {
    state.status = 'upToDate'
    sendState()
    console.log('[Updater] Already up to date.')
  })

  autoUpdater.on('download-progress', (progress) => {
    state.status           = 'downloading'
    state.downloadProgress = Math.round(progress.percent || 0)
    sendState()
  })

  autoUpdater.on('update-downloaded', (info) => {
    state.status           = 'downloaded'
    state.downloadProgress = 100
    state.latestVersion    = info.version
    state.releaseNotes     = info.releaseNotes || state.releaseNotes
    sendState()
    console.log(`[Updater] v${info.version} downloaded — ready to install`)
  })

  autoUpdater.on('error', (err) => {
    // Network errors on first launch are normal — don't alarm the user
    const msg = err.message || String(err)
    const isNetErr = /ENOTFOUND|ECONNREFUSED|ETIMEDOUT|certificate|net::/i.test(msg)
    state.status = isNetErr ? 'idle' : 'error'
    state.error  = isNetErr ? null : msg
    sendState()
    if (!isNetErr) console.error('[Updater] Error:', msg)
  })
}

// ── IPC for electron-updater ───────────────────────────────
function setupElectronUpdaterIPC() {
  ipcMain.on('auto-update-restart', () => {
    if (state.status === 'downloaded') {
      autoUpdater.quitAndInstall(false, true) // isSilent=false, isForceRunAfter=true
    }
  })

  ipcMain.on('auto-update-download-now', () => {
    if (state.status === 'available') autoUpdater.downloadUpdate()
  })
}

// ══════════════════════════════════════════════════════════
// PATH B: GitHub API fallback (dev / unpackaged builds)
// ══════════════════════════════════════════════════════════

const GITHUB_REPO  = 'Shvquu/flux-browser'
const RELEASES_API = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`
const RELEASES_PAGE= `https://github.com/${GITHUB_REPO}/releases/latest`

let _fallbackInfo = null

async function fallbackCheck() {
  state.status = 'checking'
  sendState()
  try {
    const res = await fetch(RELEASES_API, {
      headers: { 'User-Agent': 'FLUX-Browser-AutoUpdate' },
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    const latest  = (data.tag_name || '').replace(/^v/, '')
    const current = app.getVersion()

    if (latest && compareVersions(latest, current) > 0) {
      state.status        = 'available'
      state.latestVersion = latest
      state.releaseUrl    = data.html_url || RELEASES_PAGE
      state.publishedAt   = data.published_at || null
      state.releaseNotes  = data.body ? data.body.slice(0, 500) : null
      _fallbackInfo = { ...state }
      sendState()
      console.log(`[Updater-fallback] Update available: v${latest}`)
    } else {
      state.status = 'upToDate'
      sendState()
    }
  } catch (e) {
    state.status = 'idle'  // silent — no network is not an error for the user
    sendState()
    console.log('[Updater-fallback] Check failed (network?):', e.message)
  }
}

function setupFallbackIPC() {
  ipcMain.on('auto-update-restart', () => {
    // In fallback mode "restart" opens the releases page
    if (_fallbackInfo?.releaseUrl) shell.openExternal(_fallbackInfo.releaseUrl)
    else shell.openExternal(RELEASES_PAGE)
  })
  ipcMain.on('auto-update-download-now', () => {
    if (_fallbackInfo?.releaseUrl) shell.openExternal(_fallbackInfo.releaseUrl)
    else shell.openExternal(RELEASES_PAGE)
  })
}

// ══════════════════════════════════════════════════════════
// SHARED IPC (both paths)
// ══════════════════════════════════════════════════════════

function setupSharedIPC() {
  ipcMain.handle('auto-update-get-state', () => ({ ...state }))

  ipcMain.on('auto-update-check-now', () => {
    if (euAvailable && app.isPackaged) {
      autoUpdater.checkForUpdates().catch(() => {})
    } else {
      fallbackCheck()
    }
  })
}

// ══════════════════════════════════════════════════════════
// EXPORTS
// ══════════════════════════════════════════════════════════

/**
 * Call once inside app.whenReady() — after createWindow().
 * Waits 6 s so the first page can load before using bandwidth.
 */
function setupAutoUpdater() {
  setupSharedIPC()

  if (euAvailable && app.isPackaged) {
    // Production: full silent download + install
    setupElectronUpdater()
    setupElectronUpdaterIPC()
    setTimeout(() => {
      autoUpdater.checkForUpdates().catch(() => {})
    }, 6_000)
    // Periodic re-check every 4 hours (Chrome checks every ~5 h)
    setInterval(() => {
      autoUpdater.checkForUpdates().catch(() => {})
    }, 4 * 60 * 60 * 1000)
  } else {
    // Dev / unpackaged: GitHub API banner only
    setupFallbackIPC()
    setTimeout(fallbackCheck, 6_000)
    setInterval(fallbackCheck, 4 * 60 * 60 * 1000)
  }
}

module.exports = { setupAutoUpdater }
