// ============================================================
// downloads.js – Persistent Download Manager
// ============================================================
// Tracks downloads including file name, path, progress, and
// status. Maintains a persistent history of all downloads.
// Integrates with Electron's session download events.
// No telemetry, no external APIs.
// ============================================================

const { app, ipcMain, BrowserWindow, session } = require('electron')
const fs   = require('fs')
const path = require('path')
const crypto = require('crypto')

// ── Data file path ─────────────────────────────────────────
const DATA_DIR  = () => path.join(app.getPath('userData'), 'flux-data')
const DATA_FILE = () => path.join(DATA_DIR(), 'downloads.json')

// ── In-memory store ────────────────────────────────────────
let downloads = []            // persisted history
const activeItems = new Map() // downloadId → Electron DownloadItem (not persisted)
const MAX_HISTORY = 1000

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
      downloads = JSON.parse(raw)
      if (!Array.isArray(downloads)) downloads = []

      // Mark any previously in-progress downloads as interrupted
      downloads.forEach(d => {
        if (d.status === 'in_progress' || d.status === 'paused') {
          d.status = 'interrupted'
        }
      })
    }
  } catch (err) {
    console.error('[Downloads] Failed to load:', err.message)
    downloads = []
  }
}

function save() {
  try {
    ensureDataDir()
    fs.writeFileSync(DATA_FILE(), JSON.stringify(downloads, null, 2), 'utf-8')
  } catch (err) {
    console.error('[Downloads] Failed to save:', err.message)
  }
}

function broadcast(channel, ...args) {
  BrowserWindow.getAllWindows().forEach(w =>
    w.webContents.send(channel, ...args)
  )
}

// ── Core operations ────────────────────────────────────────

function getAll() {
  return downloads
}

function getRecent(limit = 50) {
  return downloads.slice(0, limit)
}

function getById(id) {
  return downloads.find(d => d.id === id) || null
}

function getByStatus(status) {
  return downloads.filter(d => d.status === status)
}

function getActive() {
  return downloads.filter(d => d.status === 'in_progress' || d.status === 'paused')
}

function removeFromHistory(id) {
  downloads = downloads.filter(d => d.id !== id)
  save()
  broadcast('downloads-updated')
}

function clearHistory() {
  // Only clear completed/failed/cancelled entries, not active downloads
  downloads = downloads.filter(d => d.status === 'in_progress' || d.status === 'paused')
  save()
  broadcast('downloads-updated')
}

function cancelDownload(id) {
  const item = activeItems.get(id)
  if (item) {
    item.cancel()
    activeItems.delete(id)
  }
  const download = downloads.find(d => d.id === id)
  if (download && download.status === 'in_progress') {
    download.status = 'cancelled'
    download.completedAt = Date.now()
    save()
    broadcast('downloads-updated')
  }
}

function pauseDownload(id) {
  const item = activeItems.get(id)
  if (item && item.canResume && !item.isPaused()) {
    item.pause()
    const download = downloads.find(d => d.id === id)
    if (download) {
      download.status = 'paused'
      save()
      broadcast('downloads-updated')
    }
  }
}

function resumeDownload(id) {
  const item = activeItems.get(id)
  if (item && item.isPaused()) {
    item.resume()
    const download = downloads.find(d => d.id === id)
    if (download) {
      download.status = 'in_progress'
      save()
      broadcast('downloads-updated')
    }
  }
}

function openFile(id) {
  const download = downloads.find(d => d.id === id)
  if (download && download.filePath) {
    const { shell } = require('electron')
    shell.openPath(download.filePath)
  }
}

function showInFolder(id) {
  const download = downloads.find(d => d.id === id)
  if (download && download.filePath) {
    const { shell } = require('electron')
    shell.showItemInFolder(download.filePath)
  }
}

// ── Electron download integration ──────────────────────────
function setupDownloadHandler() {
  session.defaultSession.on('will-download', (event, item, webContents) => {
    const id = generateId()

    const download = {
      id,
      fileName:      item.getFilename(),
      filePath:      item.getSavePath() || '',
      url:           item.getURL(),
      mimeType:      item.getMimeType(),
      totalBytes:    item.getTotalBytes(),
      receivedBytes: 0,
      progress:      0,
      status:        'in_progress',
      startedAt:     Date.now(),
      completedAt:   null,
    }

    // Update file path after save dialog
    item.once('done', () => {
      download.filePath = item.getSavePath()
    })

    downloads.unshift(download)
    if (downloads.length > MAX_HISTORY) {
      downloads = downloads.slice(0, MAX_HISTORY)
    }
    activeItems.set(id, item)

    save()
    broadcast('downloads-updated')
    broadcast('download-started', download)

    // Track progress
    item.on('updated', (event, state) => {
      download.receivedBytes = item.getReceivedBytes()
      download.totalBytes    = item.getTotalBytes()
      download.filePath      = item.getSavePath()
      download.progress      = download.totalBytes > 0
        ? Math.round((download.receivedBytes / download.totalBytes) * 100)
        : 0

      if (state === 'interrupted') {
        download.status = 'interrupted'
      } else {
        download.status = item.isPaused() ? 'paused' : 'in_progress'
      }

      save()
      broadcast('download-progress', {
        id,
        receivedBytes: download.receivedBytes,
        totalBytes:    download.totalBytes,
        progress:      download.progress,
        status:        download.status,
      })
    })

    // Download completed or failed
    item.once('done', (event, state) => {
      activeItems.delete(id)
      download.receivedBytes = item.getReceivedBytes()
      download.totalBytes    = item.getTotalBytes()
      download.filePath      = item.getSavePath()
      download.completedAt   = Date.now()

      if (state === 'completed') {
        download.status   = 'completed'
        download.progress = 100
      } else if (state === 'cancelled') {
        download.status = 'cancelled'
      } else {
        download.status = 'failed'
      }

      save()
      broadcast('downloads-updated')
      broadcast('download-completed', download)
    })
  })
}

// ── IPC Handlers ───────────────────────────────────────────
function setupDownloadsIPC() {
  load()
  setupDownloadHandler()

  ipcMain.handle('downloads-get-all',       () => getAll())
  ipcMain.handle('downloads-get-recent',    (_, limit) => getRecent(limit))
  ipcMain.handle('downloads-get-by-id',     (_, id) => getById(id))
  ipcMain.handle('downloads-get-active',    () => getActive())
  ipcMain.handle('downloads-get-by-status', (_, status) => getByStatus(status))

  ipcMain.handle('downloads-cancel',        (_, id) => { cancelDownload(id); return true })
  ipcMain.handle('downloads-pause',         (_, id) => { pauseDownload(id); return true })
  ipcMain.handle('downloads-resume',        (_, id) => { resumeDownload(id); return true })
  ipcMain.handle('downloads-open-file',     (_, id) => { openFile(id); return true })
  ipcMain.handle('downloads-show-in-folder',(_, id) => { showInFolder(id); return true })

  ipcMain.handle('downloads-remove',        (_, id) => { removeFromHistory(id); return true })
  ipcMain.handle('downloads-clear-history', () => { clearHistory(); return true })
}

module.exports = { setupDownloadsIPC }
