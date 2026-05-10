// ============================================================
// main.js – Main Process
// ============================================================

const { app, BrowserWindow, ipcMain, session, shell } = require('electron')
const path = require('path')

if (require('electron-squirrel-startup')) app.quit()

// ── FLUX Shield ────────────────────────────────────────────
let shieldEnabled = true

const ALWAYS_BLOCK = [
  'google-analytics.com','googletagmanager.com','googletagservices.com',
  'doubleclick.net','googlesyndication.com','adservice.google.com',
  'facebook.com/tr','connect.facebook.net','analytics.facebook.com',
  'scorecardresearch.com','quantserve.com','outbrain.com','taboola.com',
  'hotjar.com','mouseflow.com','fullstory.com','mixpanel.com',
  'amplitude.com','segment.io','segment.com','heap.io',
  'clarity.ms','bing.com/bat','ads.twitter.com','static.ads-twitter.com',
]

const connectionLog = []
const MAX_LOG = 300

function logConnection(type, url, reason) {
  connectionLog.unshift({ type, url, reason, time: Date.now() })
  if (connectionLog.length > MAX_LOG) connectionLog.pop()
  BrowserWindow.getAllWindows().forEach(w =>
    w.webContents.send('shield-log-update', connectionLog.slice(0, 50))
  )
}

function isTrackerDomain(url) {
  try {
    const host = new URL(url).hostname
    return ALWAYS_BLOCK.some(d => host === d || host.endsWith('.' + d))
  } catch { return false }
}

function isInternalRequest(url) {
  const patterns = [
    'safebrowsing','update.googleapis.com','clients.google.com',
    'chrome-extension://','edge-update','browser.events.data.microsoft',
    'ocsp.','crl.',
  ]
  return patterns.some(p => url.includes(p))
}

// ── Download Manager ───────────────────────────────────────
const activeDownloads = new Map()

function setupDownloadManager() {
  session.defaultSession.on('will-download', (event, item) => {
    const id = `dl-${Date.now()}-${Math.random().toString(36).slice(2)}`
    const dlInfo = {
      id,
      filename: item.getFilename(),
      url: item.getURL(),
      savePath: '',
      totalBytes: item.getTotalBytes(),
      receivedBytes: 0,
      state: 'progressing',
      startedAt: Date.now(),
    }
    activeDownloads.set(id, dlInfo)
    BrowserWindow.getAllWindows().forEach(w =>
      w.webContents.send('download-started', dlInfo)
    )

    item.on('updated', (_, state) => {
      dlInfo.receivedBytes = item.getReceivedBytes()
      dlInfo.totalBytes    = item.getTotalBytes()
      dlInfo.state         = state
      BrowserWindow.getAllWindows().forEach(w =>
        w.webContents.send('download-progress', {
          id, receivedBytes: dlInfo.receivedBytes,
          totalBytes: dlInfo.totalBytes, state,
        })
      )
    })

    item.once('done', (_, state) => {
      dlInfo.state    = state
      dlInfo.savePath = item.getSavePath()
      activeDownloads.delete(id)
      BrowserWindow.getAllWindows().forEach(w =>
        w.webContents.send('download-done', { id, state, savePath: dlInfo.savePath, filename: dlInfo.filename })
      )
    })
  })

  ipcMain.on('download-cancel', (_, id) => {
    // Find and cancel via session – best effort
  })

  ipcMain.on('download-open-folder', (_, savePath) => {
    if (savePath) shell.showItemInFolder(savePath)
  })
}

// ── Fenster erstellen ──────────────────────────────────────
function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    frame: false,
    backgroundColor: '#050810',
    icon: path.join(__dirname, 'renderer', 'flux.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
      webSecurity: true,
    },
  })

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'))

  // DevTools
  const { globalShortcut } = require('electron')
  globalShortcut.register('CommandOrControl+Shift+I', () => {
    const focused = BrowserWindow.getFocusedWindow()
    if (focused) focused.webContents.toggleDevTools()
  })

  ipcMain.on('window-minimize', () => win.minimize())
  ipcMain.on('window-maximize', () => {
    win.isMaximized() ? win.unmaximize() : win.maximize()
  })
  ipcMain.on('window-close', () => win.close())
  win.on('maximize',   () => win.webContents.send('window-state', 'maximized'))
  win.on('unmaximize', () => win.webContents.send('window-state', 'normal'))
}

// ── Shield IPC ─────────────────────────────────────────────
function setupShieldIPC() {
  ipcMain.handle('shield-get-status', () => ({
    enabled: shieldEnabled,
    log: connectionLog.slice(0, 50),
  }))
  ipcMain.on('shield-toggle', (_, enable) => {
    shieldEnabled = enable
    BrowserWindow.getAllWindows().forEach(w =>
      w.webContents.send('shield-status-changed', shieldEnabled)
    )
  })
}

// ── Fingerprint IPC ────────────────────────────────────────
const fingerprintStats = { canvas:0, webgl:0, audio:0, navigator:0, screen:0, total:0 }

function setupFingerprintIPC() {
  ipcMain.handle('fp-get-stats', () => fingerprintStats)
  ipcMain.on('fp-attempt', (_, type) => {
    fingerprintStats[type] = (fingerprintStats[type] || 0) + 1
    fingerprintStats.total++
    BrowserWindow.getAllWindows().forEach(w =>
      w.webContents.send('fp-stats-update', fingerprintStats)
    )
  })
  ipcMain.handle('fp-get-preload-path', () =>
    path.join(__dirname, 'renderer', 'fingerprint-guard.js')
  )
}

// ── Trust Network IPC ──────────────────────────────────────
const trustStore = new Map()

const DEFAULT_PERMISSIONS = {
  canvas:'anonymize', webgl:'anonymize', audio:'anonymize',
  navigator:'anonymize', screen:'anonymize', storage:'allow',
}

function defaultTrustConfig() {
  return { level:1, permissions:{...DEFAULT_PERMISSIONS}, requestCount:0, firstSeen:Date.now() }
}

function getTrust(domain) {
  if (!domain || domain === 'about:blank') return defaultTrustConfig()
  if (!trustStore.has(domain)) trustStore.set(domain, defaultTrustConfig())
  return trustStore.get(domain)
}

function setupTrustIPC() {
  ipcMain.handle('trust-get', (_, domain) => getTrust(domain))
  ipcMain.on('trust-set', (_, domain, config) => {
    const current = getTrust(domain)
    const updated = { ...current, ...config,
      permissions: { ...current.permissions, ...(config.permissions || {}) }
    }
    trustStore.set(domain, updated)
    BrowserWindow.getAllWindows().forEach(w =>
      w.webContents.send('trust-updated', domain, updated)
    )
  })
  ipcMain.handle('trust-get-all', () => {
    const result = {}
    trustStore.forEach((v, k) => { result[k] = v })
    return result
  })
  ipcMain.on('trust-reset', (_, domain) => {
    trustStore.delete(domain)
    BrowserWindow.getAllWindows().forEach(w =>
      w.webContents.send('trust-updated', domain, defaultTrustConfig())
    )
  })
  ipcMain.on('trust-fp-request', (_, domain, apiType) => {
    const t = getTrust(domain)
    t.requestCount = (t.requestCount || 0) + 1
    trustStore.set(domain, t)
    fingerprintStats[apiType] = (fingerprintStats[apiType] || 0) + 1
    fingerprintStats.total++
    BrowserWindow.getAllWindows().forEach(w =>
      w.webContents.send('fp-stats-update', fingerprintStats)
    )
  })
}

// ── Ephemeral IPC ──────────────────────────────────────────
function setupEphemeralIPC() {
  ipcMain.handle('ephemeral-clear', async (_, partitionName) => {
    try {
      const s = session.fromPartition(partitionName)
      await s.clearStorageData()
      await s.clearCache()
      await s.clearAuthCache()
    } catch (e) { console.error('Ephemeral clear failed:', e) }
  })
}

// ── Network Filter ─────────────────────────────────────────
function setupNetworkFilter() {
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    const url = details.url
    if (url.startsWith('file://') || url.startsWith('chrome-extension://')) {
      return callback({ cancel: false })
    }
    if (isTrackerDomain(url)) {
      logConnection('blocked-tracker', url, 'Known tracker domain')
      return callback({ cancel: true })
    }
    if (shieldEnabled && isInternalRequest(url)) {
      logConnection('blocked-bg', url, 'Background/internal request blocked by FLUX Shield')
      return callback({ cancel: true })
    }
    logConnection('allowed', url, '')
    callback({ cancel: false })
  })
}

// ── Update Checker ─────────────────────────────────────────
const GITHUB_REPO   = 'Shvquu/flux-browser'
const RELEASES_API  = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`
const RELEASES_PAGE = `https://github.com/${GITHUB_REPO}/releases/latest`
let updateInfo = null

function compareVersions(a, b) {
  const pa = a.replace(/^v/,'').split('.').map(Number)
  const pb = b.replace(/^v/,'').split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    if ((pa[i]||0) > (pb[i]||0)) return 1
    if ((pa[i]||0) < (pb[i]||0)) return -1
  }
  return 0
}

async function checkForUpdates() {
  try {
    const res  = await fetch(RELEASES_API, { headers:{'User-Agent':'FLUX-Browser-UpdateCheck'} })
    if (!res.ok) return
    const data          = await res.json()
    const latestVersion = (data.tag_name||'').replace(/^v/,'')
    const currentVersion = app.getVersion()
    if (latestVersion && compareVersions(latestVersion, currentVersion) > 0) {
      updateInfo = { latestVersion, currentVersion, releaseUrl: data.html_url || RELEASES_PAGE, publishedAt: data.published_at || null }
      BrowserWindow.getAllWindows().forEach(w =>
        w.webContents.send('update-available', updateInfo)
      )
    }
  } catch(_) {}
}

function setupUpdateIPC() {
  ipcMain.handle('update-get-info', () => updateInfo)
  ipcMain.on('update-open-release', () => {
    shell.openExternal(updateInfo?.releaseUrl || RELEASES_PAGE)
  })
}

// ── Start ──────────────────────────────────────────────────
app.whenReady().then(() => {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    if (details.url.startsWith('file://')) {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [
            "default-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://fonts.gstatic.com"
          ]
        }
      })
    } else { callback({}) }
  })

  setupNetworkFilter()
  setupShieldIPC()
  setupFingerprintIPC()
  setupEphemeralIPC()
  setupTrustIPC()
  setupDownloadManager()
  setupUpdateIPC()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})