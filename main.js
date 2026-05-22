// ============================================================
// main.js – Main Process
// ============================================================

const { app, BrowserWindow, ipcMain, session, shell } = require('electron')
const path = require('path')

if (require('electron-squirrel-startup')) app.quit()

// ── Modules ────────────────────────────────────────────────
const { setupAdblockIPC, initAdblock, isBlockedByFilterList } = require('./adblock')
const { setupSettingsIPC } = require('./settings')
const { setupAutoUpdater }  = require('./updater')

// ── Privacy Mode v1.5 Settings ──────────────────────────────
let privacySettings = {
  httpsOnly:             false,
  dohEnabled:            false,
  dohProvider:           'cloudflare',  // 'cloudflare' | 'quad9' | 'google' | 'custom'
  dohCustomUrl:          '',
  clearOnExit:           false,
  clearOnExitData: {
    cookies:      true,
    cache:        true,
    history:      false,
    localStorage: false,
  },
  blockThirdPartyCookies: false,
}

const DOH_PROVIDERS = {
  cloudflare: 'https://cloudflare-dns.com/dns-query',
  quad9:      'https://dns.quad9.net/dns-query',
  google:     'https://dns.google/dns-query',
}

function applyDoH() {
  try {
    if (privacySettings.dohEnabled) {
      const url = privacySettings.dohProvider === 'custom'
        ? privacySettings.dohCustomUrl
        : (DOH_PROVIDERS[privacySettings.dohProvider] || DOH_PROVIDERS.cloudflare)
      app.configureHostResolver({ secureDnsMode: 'secure', secureDnsServers: [url] })
    } else {
      app.configureHostResolver({ secureDnsMode: 'automatic' })
    }
  } catch (e) { console.error('[DoH] configureHostResolver failed:', e.message) }
}

function setupPrivacyIPC() {
  ipcMain.handle('privacy-get-settings', () => ({ ...privacySettings }))
  ipcMain.handle('privacy-get-doh-providers', () => ({ ...DOH_PROVIDERS }))
  ipcMain.on('privacy-set-settings', (_, incoming) => {
    const prev = { ...privacySettings }
    privacySettings = { ...privacySettings, ...incoming }
    if (incoming.clearOnExitData)
      privacySettings.clearOnExitData = { ...prev.clearOnExitData, ...incoming.clearOnExitData }
    // Re-apply DoH if changed
    if (incoming.dohEnabled !== undefined || incoming.dohProvider !== undefined || incoming.dohCustomUrl !== undefined)
      applyDoH()
    BrowserWindow.getAllWindows().forEach(w =>
      w.webContents.send('privacy-settings-changed', { ...privacySettings })
    )
  })
}

// ── Cookie Manager IPC ─────────────────────────────────────
function setupCookieIPC() {
  ipcMain.handle('cookies-get-all', async () => {
    try { return await session.defaultSession.cookies.get({}) } catch { return [] }
  })
  ipcMain.handle('cookies-get-for-domain', async (_, domain) => {
    try { return await session.defaultSession.cookies.get({ domain }) } catch { return [] }
  })
  ipcMain.handle('cookies-remove', async (_, url, name) => {
    try { await session.defaultSession.cookies.remove(url, name); return true } catch { return false }
  })
  ipcMain.handle('cookies-purge-domain', async (_, domain) => {
    try {
      const scheme = domain.startsWith('https') ? domain : `https://${domain.replace(/^\./, '')}`
      const list = await session.defaultSession.cookies.get({ domain })
      await Promise.all(list.map(c =>
        session.defaultSession.cookies.remove(scheme, c.name).catch(() => {})
      ))
      return true
    } catch { return false }
  })
  ipcMain.handle('cookies-purge-all', async () => {
    try {
      await session.defaultSession.clearStorageData({ storages: ['cookies'] })
      return true
    } catch { return false }
  })
  ipcMain.handle('cookies-get-stats', async () => {
    try {
      const all = await session.defaultSession.cookies.get({})
      const byDomain = {}
      all.forEach(c => {
        const d = c.domain || 'unknown'
        byDomain[d] = (byDomain[d] || 0) + 1
      })
      return { total: all.length, byDomain }
    } catch { return { total: 0, byDomain: {} } }
  })
}

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
    if (shieldEnabled && isBlockedByFilterList(url)) {
      logConnection('blocked-tracker', url, 'EasyList/EasyPrivacy filter')
      return callback({ cancel: true })
    }
    if (shieldEnabled && isInternalRequest(url)) {
      logConnection('blocked-bg', url, 'Background/internal request blocked by FLUX Shield')
      return callback({ cancel: true })
    }
    // ── HTTPS-Only Mode ──────────────────────────────────────
    if (privacySettings.httpsOnly && url.startsWith('http://')) {
      const isLocal = url.startsWith('http://localhost') ||
                      url.startsWith('http://127.') ||
                      url.startsWith('http://0.0.0.0') ||
                      url.startsWith('http://[::1]')
      if (!isLocal) {
        const httpsUrl = 'https://' + url.slice(7)
        logConnection('upgraded', url, 'HTTPS-Only Mode: upgraded to HTTPS')
        return callback({ redirectURL: httpsUrl })
      }
    }
    logConnection('allowed', url, '')
    callback({ cancel: false })
  })

  // ── Third-Party Cookie Blocking ─────────────────────────
  session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
    if (privacySettings.blockThirdPartyCookies) {
      try {
        const reqHost = new URL(details.url).hostname
        const referer = details.requestHeaders['Referer'] || details.requestHeaders['referer'] || ''
        if (referer) {
          const refHost = new URL(referer).hostname
          const refBase  = refHost.split('.').slice(-2).join('.')
          const reqBase  = reqHost.split('.').slice(-2).join('.')
          if (reqBase !== refBase) {
            const headers = { ...details.requestHeaders }
            delete headers['Cookie']
            delete headers['cookie']
            return callback({ requestHeaders: headers })
          }
        }
      } catch (_) { /* ignore parse errors */ }
    }
    callback({ requestHeaders: details.requestHeaders })
  })
}

// ── Clear-on-Exit ──────────────────────────────────────────
function setupClearOnExit() {
  app.on('before-quit', async (e) => {
    if (!privacySettings.clearOnExit) return
    const data = privacySettings.clearOnExitData || {}
    const storages = []
    if (data.cookies)      storages.push('cookies', 'serviceworkers')
    if (data.cache)        storages.push('cachestorage', 'filesystem', 'shadercache')
    if (data.localStorage) storages.push('localstorage', 'indexdb', 'websql')
    try {
      if (storages.length) await session.defaultSession.clearStorageData({ storages })
      if (data.cache)      await session.defaultSession.clearCache()
    } catch (err) { console.error('[ClearOnExit]', err.message) }
  })
}

// ── Auto-Updater handled by updater.js ───────────────────

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
  setupPrivacyIPC()
  setupCookieIPC()
  setupClearOnExit()
  setupAdblockIPC()
  setupSettingsIPC()
  applyDoH()
  initAdblock()   // load cached filter lists; refresh in background if stale
  createWindow()
  setupAutoUpdater()  // check after window is ready

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})