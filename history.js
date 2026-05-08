// ============================================================
// history.js – Persistent Browsing History System
// ============================================================
// Records visited URLs with titles, timestamps, and favicons.
// Supports date grouping, search, and partial/full clearing.
// All data stored locally in a JSON file.
// No telemetry, no external APIs.
// ============================================================

const { app, ipcMain, BrowserWindow } = require('electron')
const fs   = require('fs')
const path = require('path')
const crypto = require('crypto')

// ── Data file path ─────────────────────────────────────────
const DATA_DIR  = () => path.join(app.getPath('userData'), 'flux-data')
const DATA_FILE = () => path.join(DATA_DIR(), 'history.json')

// ── In-memory store ────────────────────────────────────────
let history = []
const MAX_HISTORY = 10000

// ── Helpers ────────────────────────────────────────────────
function generateId() {
  return crypto.randomBytes(8).toString('hex')
}

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
      history = JSON.parse(raw)
      if (!Array.isArray(history)) history = []
    }
  } catch (err) {
    console.error('[History] Failed to load:', err.message)
    history = []
  }
}

function save() {
  try {
    ensureDataDir()
    fs.writeFileSync(DATA_FILE(), JSON.stringify(history, null, 2), 'utf-8')
  } catch (err) {
    console.error('[History] Failed to save:', err.message)
  }
}

function broadcast(channel, ...args) {
  BrowserWindow.getAllWindows().forEach(w =>
    w.webContents.send(channel, ...args)
  )
}

// ── Date helpers ───────────────────────────────────────────
function dateKey(timestamp) {
  const d = new Date(timestamp)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function dateLabel(key) {
  const today     = dateKey(Date.now())
  const yesterday = dateKey(Date.now() - 86400000)
  if (key === today)     return 'Today'
  if (key === yesterday) return 'Yesterday'
  const [y, m, d] = key.split('-')
  const date = new Date(Number(y), Number(m) - 1, Number(d))
  return date.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
}

// ── Core operations ────────────────────────────────────────

function addEntry({ url, title, favicon = null }) {
  // Skip internal URLs
  if (!url || url === 'about:blank' || url.startsWith('flux://')) return null

  const entry = {
    id: generateId(),
    url,
    title: title || url,
    favicon,
    visitedAt: Date.now(),
  }

  history.unshift(entry)

  // Enforce maximum entries
  if (history.length > MAX_HISTORY) {
    history = history.slice(0, MAX_HISTORY)
  }

  save()
  broadcast('history-updated')
  return entry
}

function getAll() {
  return history
}

function getRecent(limit = 100) {
  return history.slice(0, limit)
}

function getGroupedByDate(limit = 500) {
  const entries = history.slice(0, limit)
  const groups = new Map()

  for (const entry of entries) {
    const key = dateKey(entry.visitedAt)
    if (!groups.has(key)) {
      groups.set(key, {
        date: key,
        label: dateLabel(key),
        entries: [],
      })
    }
    groups.get(key).entries.push(entry)
  }

  return Array.from(groups.values())
}

function search(query) {
  if (!query) return []
  const q = query.toLowerCase()
  return history.filter(entry =>
    (entry.title && entry.title.toLowerCase().includes(q)) ||
    (entry.url && entry.url.toLowerCase().includes(q))
  ).slice(0, 200)
}

function removeEntry(id) {
  history = history.filter(e => e.id !== id)
  save()
  broadcast('history-updated')
}

function clearAll() {
  history = []
  save()
  broadcast('history-updated')
}

function clearByDateRange(startTime, endTime) {
  history = history.filter(e =>
    e.visitedAt < startTime || e.visitedAt > endTime
  )
  save()
  broadcast('history-updated')
}

function clearByDate(dateKeyStr) {
  history = history.filter(e => dateKey(e.visitedAt) !== dateKeyStr)
  save()
  broadcast('history-updated')
}

function clearOlderThan(timestamp) {
  history = history.filter(e => e.visitedAt >= timestamp)
  save()
  broadcast('history-updated')
}

function getStats() {
  const domains = new Set()
  history.forEach(e => {
    try { domains.add(new URL(e.url).hostname) } catch {}
  })
  return {
    totalEntries: history.length,
    uniqueDomains: domains.size,
    oldestEntry: history.length > 0 ? history[history.length - 1].visitedAt : null,
    newestEntry: history.length > 0 ? history[0].visitedAt : null,
  }
}

// ── IPC Handlers ───────────────────────────────────────────
function setupHistoryIPC() {
  load()

  ipcMain.handle('history-add',             (_, data) => addEntry(data))
  ipcMain.handle('history-get-all',         () => getAll())
  ipcMain.handle('history-get-recent',      (_, limit) => getRecent(limit))
  ipcMain.handle('history-get-grouped',     (_, limit) => getGroupedByDate(limit))
  ipcMain.handle('history-search',          (_, query) => search(query))
  ipcMain.handle('history-get-stats',       () => getStats())

  ipcMain.handle('history-remove',          (_, id) => { removeEntry(id); return true })
  ipcMain.handle('history-clear-all',       () => { clearAll(); return true })
  ipcMain.handle('history-clear-by-date',   (_, dateKeyStr) => { clearByDate(dateKeyStr); return true })
  ipcMain.handle('history-clear-range',     (_, start, end) => { clearByDateRange(start, end); return true })
  ipcMain.handle('history-clear-older-than', (_, timestamp) => { clearOlderThan(timestamp); return true })
}

module.exports = { setupHistoryIPC }
