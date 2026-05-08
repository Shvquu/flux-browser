// ============================================================
// settings.js – Persistent Settings System
// ============================================================
// Stores user preferences (theme, start page, search engine,
// fonts, zoom, etc.) in a local JSON file. Designed to be
// easily extendable — just add new keys to DEFAULTS.
// No telemetry, no external APIs.
// ============================================================

const { app, ipcMain, BrowserWindow } = require('electron')
const fs   = require('fs')
const path = require('path')

// ── Data file path ─────────────────────────────────────────
const DATA_DIR  = () => path.join(app.getPath('userData'), 'flux-data')
const DATA_FILE = () => path.join(DATA_DIR(), 'settings.json')

// ── Default settings ──────────────────────────────────────
// To add a new setting, simply add it here. The system will
// automatically merge it into existing user settings on load.
const DEFAULTS = {
  // Appearance
  theme:           'dark',        // 'dark' | 'light' | 'system'
  accentColor:     '#9b3dff',     // hex color

  // Start behavior
  startPage:       'newtab',      // 'newtab' | 'homepage' | 'last-session'
  homePage:        'https://www.google.com',

  // Search
  searchEngine:    'google',      // 'google' | 'duckduckgo' | 'bing' | 'startpage' | 'brave'

  // Typography
  fontFamily:      'system-ui, -apple-system, sans-serif',
  fontSize:        14,            // px
  monoFontFamily:  'Consolas, monospace',

  // Zoom
  zoomLevel:       100,           // percentage (50-200)

  // Privacy (these extend the existing shield/trust)
  clearDataOnExit: false,
  blockThirdPartyCookies: true,

  // Downloads
  downloadPath:    '',            // empty = system default (user's Downloads folder)
  askDownloadPath: true,

  // Tabs
  openNewTabOnStartup:   true,
  switchToNewTab:        true,

  // Language / Locale
  language:        'en',          // 'en' | 'de' | etc.
}

// ── Search engine URL templates ────────────────────────────
const SEARCH_ENGINES = {
  google:      'https://www.google.com/search?q=%s',
  duckduckgo:  'https://duckduckgo.com/?q=%s',
  bing:        'https://www.bing.com/search?q=%s',
  startpage:   'https://www.startpage.com/do/search?q=%s',
  brave:       'https://search.brave.com/search?q=%s',
}

// ── In-memory store ────────────────────────────────────────
let settings = { ...DEFAULTS }

// ── Helpers ────────────────────────────────────────────────
function ensureDataDir() {
  const dir = DATA_DIR()
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

function load() {
  try {
    const file = DATA_FILE()
    if (fs.existsSync(file)) {
      const raw = fs.readFileSync(file, 'utf-8')
      const stored = JSON.parse(raw)
      // Merge with defaults so new settings are automatically available
      settings = { ...DEFAULTS, ...stored }
    }
  } catch (err) {
    console.error('[Settings] Failed to load:', err.message)
    settings = { ...DEFAULTS }
  }
}

function save() {
  try {
    ensureDataDir()
    fs.writeFileSync(DATA_FILE(), JSON.stringify(settings, null, 2), 'utf-8')
  } catch (err) {
    console.error('[Settings] Failed to save:', err.message)
  }
}

function broadcast(channel, ...args) {
  BrowserWindow.getAllWindows().forEach(w =>
    w.webContents.send(channel, ...args)
  )
}

// ── Core operations ────────────────────────────────────────

function getAll() {
  return { ...settings }
}

function get(key) {
  return key in settings ? settings[key] : (DEFAULTS[key] ?? null)
}

function set(key, value) {
  if (!(key in DEFAULTS)) {
    // Allow arbitrary keys for extensibility but log a notice
    console.log(`[Settings] New key added: ${key}`)
  }
  settings[key] = value
  save()
  broadcast('settings-updated', key, value)
  return true
}

function setMultiple(changes) {
  if (!changes || typeof changes !== 'object') return false
  for (const [key, value] of Object.entries(changes)) {
    settings[key] = value
  }
  save()
  broadcast('settings-updated', null, settings)
  return true
}

function resetToDefaults() {
  settings = { ...DEFAULTS }
  save()
  broadcast('settings-updated', null, settings)
  return true
}

function resetKey(key) {
  if (key in DEFAULTS) {
    settings[key] = DEFAULTS[key]
    save()
    broadcast('settings-updated', key, settings[key])
    return true
  }
  return false
}

function getDefaults() {
  return { ...DEFAULTS }
}

function getSearchEngines() {
  return { ...SEARCH_ENGINES }
}

function getSearchUrl(query) {
  const engine = settings.searchEngine || 'google'
  const template = SEARCH_ENGINES[engine] || SEARCH_ENGINES.google
  return template.replace('%s', encodeURIComponent(query))
}

// ── IPC Handlers ───────────────────────────────────────────
function setupSettingsIPC() {
  load()

  ipcMain.handle('settings-get-all',        () => getAll())
  ipcMain.handle('settings-get',            (_, key) => get(key))
  ipcMain.handle('settings-set',            (_, key, value) => set(key, value))
  ipcMain.handle('settings-set-multiple',   (_, changes) => setMultiple(changes))
  ipcMain.handle('settings-reset-all',      () => resetToDefaults())
  ipcMain.handle('settings-reset-key',      (_, key) => resetKey(key))
  ipcMain.handle('settings-get-defaults',   () => getDefaults())
  ipcMain.handle('settings-get-search-engines', () => getSearchEngines())
  ipcMain.handle('settings-get-search-url', (_, query) => getSearchUrl(query))
}

module.exports = { setupSettingsIPC }
