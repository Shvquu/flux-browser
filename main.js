// ============================================================
// main.js – Main Process
// ============================================================

const { app, BrowserWindow, ipcMain, session } = require('electron')
const path = require('path')

if (require('electron-squirrel-startup')) app.quit()

// ── FLUX Shield – Zero-Connection Mode ────────────────────
// Globaler State für den Shield-Modus.
// Wird per IPC vom Renderer gesteuert.
let shieldEnabled = true   // Standard: AN

// Tracker-Domains die IMMER blockiert werden (auch ohne Shield)
const ALWAYS_BLOCK = [
  'google-analytics.com', 'googletagmanager.com', 'googletagservices.com',
  'doubleclick.net', 'googlesyndication.com', 'adservice.google.com',
  'facebook.com/tr', 'connect.facebook.net', 'analytics.facebook.com',
  'scorecardresearch.com', 'quantserve.com', 'outbrain.com', 'taboola.com',
  'hotjar.com', 'mouseflow.com', 'fullstory.com', 'mixpanel.com',
  'amplitude.com', 'segment.io', 'segment.com', 'heap.io',
  'clarity.ms', 'bing.com/bat', 'ads.twitter.com', 'static.ads-twitter.com',
]

// Verbindungs-Log: wird an den Renderer weitergegeben (flux://network)
const connectionLog = []
const MAX_LOG = 300

function logConnection(type, url, reason) {
  connectionLog.unshift({ type, url, reason, time: Date.now() })
  if (connectionLog.length > MAX_LOG) connectionLog.pop()
  // An alle offenen Fenster broadcasten
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
  // Chromium-interne Hintergrundanfragen erkennen
  const internalPatterns = [
    'safebrowsing', 'update.googleapis.com', 'clients.google.com',
    'chrome-extension://', 'edge-update', 'browser.events.data.microsoft',
    'ocsp.', 'crl.', // Certificate checks
  ]
  return internalPatterns.some(p => url.includes(p))
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

  // Fenstersteuerung
  ipcMain.on('window-minimize', () => win.minimize())
  ipcMain.on('window-maximize', () => {
    win.isMaximized() ? win.unmaximize() : win.maximize()
  })
  ipcMain.on('window-close', () => win.close())
  win.on('maximize',   () => win.webContents.send('window-state', 'maximized'))
  win.on('unmaximize', () => win.webContents.send('window-state', 'normal'))
}

// ── Shield IPC Handler ─────────────────────────────────────
function setupShieldIPC() {
  // Renderer fragt Shield-Status ab
  ipcMain.handle('shield-get-status', () => ({
    enabled: shieldEnabled,
    log: connectionLog.slice(0, 50),
  }))

  // Renderer schaltet Shield um
  ipcMain.on('shield-toggle', (_, enable) => {
    shieldEnabled = enable
    BrowserWindow.getAllWindows().forEach(w =>
      w.webContents.send('shield-status-changed', shieldEnabled)
    )
  })
}

// ── Fingerprint Randomization State ──────────────────────
const fingerprintStats = {
  canvas:    0,
  webgl:     0,
  audio:     0,
  navigator: 0,
  screen:    0,
  total:     0,
}

// ── FLUX Trust Network ────────────────────────────────────
// Speichert Trust-Level und API-Permissions pro Domain.
// Nur im Arbeitsspeicher – wird niemals gespeichert oder übertragen.
//
// Trust-Level:
//   0 = strict    → alle fingerprint APIs blockiert/anonymisiert, Warnung
//   1 = standard  → APIs anonymisiert (Standard für neue Seiten)
//   2 = trusted   → APIs erlaubt, nur Tracker-Blocking aktiv
//
// Permissions pro API: 'anonymize' | 'allow' | 'block'
const trustStore = new Map()  // domain → { level, permissions, requestCount }

const TRUST_LEVELS = { strict: 0, standard: 1, trusted: 2 }

const DEFAULT_PERMISSIONS = {
  canvas:    'anonymize',
  webgl:     'anonymize',
  audio:     'anonymize',
  navigator: 'anonymize',
  screen:    'anonymize',
  storage:   'allow',
}

function defaultTrustConfig() {
  return {
    level: 1,  // standard
    permissions: { ...DEFAULT_PERMISSIONS },
    requestCount: 0,
    firstSeen: Date.now(),
  }
}

function getTrust(domain) {
  if (!domain || domain === 'about:blank') return defaultTrustConfig()
  if (!trustStore.has(domain)) trustStore.set(domain, defaultTrustConfig())
  return trustStore.get(domain)
}

function setupTrustIPC() {
  // Trust-Config für eine Domain abrufen
  ipcMain.handle('trust-get', (_, domain) => getTrust(domain))

  // Trust-Config setzen (Level oder einzelne Permission)
  ipcMain.on('trust-set', (_, domain, config) => {
    const current = getTrust(domain)
    const updated = { ...current, ...config,
      permissions: { ...current.permissions, ...(config.permissions || {}) }
    }
    trustStore.set(domain, updated)
    // Alle Fenster informieren
    BrowserWindow.getAllWindows().forEach(w =>
      w.webContents.send('trust-updated', domain, updated)
    )
  })

  // Alle Trust-Einträge abrufen (für flux://trust Seite)
  ipcMain.handle('trust-get-all', () => {
    const result = {}
    trustStore.forEach((v, k) => { result[k] = v })
    return result
  })

  // Domain aus Trust-Store entfernen (Reset)
  ipcMain.on('trust-reset', (_, domain) => {
    trustStore.delete(domain)
    BrowserWindow.getAllWindows().forEach(w =>
      w.webContents.send('trust-updated', domain, defaultTrustConfig())
    )
  })

  // Fingerprint-Versuch melden + Trust requestCount erhöhen
  ipcMain.on('trust-fp-request', (_, domain, apiType) => {
    const t = getTrust(domain)
    t.requestCount = (t.requestCount || 0) + 1
    trustStore.set(domain, t)
    // Fingerprint-Stats auch im fp-System zählen
    fingerprintStats[apiType] = (fingerprintStats[apiType] || 0) + 1
    fingerprintStats.total++
    BrowserWindow.getAllWindows().forEach(w =>
      w.webContents.send('fp-stats-update', fingerprintStats)
    )
  })
}

// ── Ephemeral Tabs – Session Cleanup ──────────────────────
function setupEphemeralIPC() {
  // Renderer meldet: Ephemeral-Tab wurde geschlossen → Partition löschen
  ipcMain.handle('ephemeral-clear', async (_, partitionName) => {
    try {
      const { session } = require('electron')
      const s = session.fromPartition(partitionName)
      await s.clearStorageData()
      await s.clearCache()
      await s.clearAuthCache()
    } catch (e) {
      console.error('Ephemeral clear failed:', e)
    }
  })
}

function setupFingerprintIPC() {
  // Renderer fragt Stats ab
  ipcMain.handle('fp-get-stats', () => fingerprintStats)

  // Renderer meldet einen erkannten Fingerprint-Versuch
  ipcMain.on('fp-attempt', (_, type) => {
    fingerprintStats[type] = (fingerprintStats[type] || 0) + 1
    fingerprintStats.total++
    // An alle Fenster broadcasten (für flux://privacy Live-Update)
    BrowserWindow.getAllWindows().forEach(w =>
      w.webContents.send('fp-stats-update', fingerprintStats)
    )
  })

  // Preload-Pfad an Renderer geben damit Webviews ihn setzen können
  ipcMain.handle('fp-get-preload-path', () =>
    path.join(__dirname, 'renderer', 'fingerprint-guard.js')
  )
}

// ── Netzwerkfilter (Herzstück des Shield) ─────────────────
function setupNetworkFilter() {
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    const url   = details.url
    const type  = details.resourceType   // 'mainFrame', 'script', 'image' etc.

    // Eigene App-URLs immer erlauben
    if (url.startsWith('file://') || url.startsWith('chrome-extension://')) {
      return callback({ cancel: false })
    }

    // Tracker IMMER blockieren (unabhängig vom Shield)
    if (isTrackerDomain(url)) {
      logConnection('blocked-tracker', url, 'Known tracker domain')
      return callback({ cancel: true })
    }

    // Im Shield-Modus: Hintergrundanfragen blockieren
    if (shieldEnabled) {
      if (isInternalRequest(url)) {
        logConnection('blocked-bg', url, 'Background/internal request blocked by FLUX Shield')
        return callback({ cancel: true })
      }
    }

    // Erlaubt
    logConnection('allowed', url, '')
    callback({ cancel: false })
  })
}

// ── CSP + App starten ─────────────────────────────────────
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
    } else {
      callback({})
    }
  })

  setupNetworkFilter()
  setupShieldIPC()
  setupFingerprintIPC()
  setupEphemeralIPC()
  setupTrustIPC()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})