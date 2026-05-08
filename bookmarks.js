// ============================================================
// bookmarks.js – Persistent Bookmarks System
// ============================================================
// Stores bookmarks and folders as a flat list with parent
// references. All data persisted to a local JSON file.
// No telemetry, no external APIs.
// ============================================================

const { app, ipcMain, BrowserWindow } = require('electron')
const fs   = require('fs')
const path = require('path')
const crypto = require('crypto')

// ── Data file path ─────────────────────────────────────────
const DATA_DIR  = () => path.join(app.getPath('userData'), 'flux-data')
const DATA_FILE = () => path.join(DATA_DIR(), 'bookmarks.json')

// ── In-memory store ────────────────────────────────────────
let bookmarks = []

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
      bookmarks = JSON.parse(raw)
      if (!Array.isArray(bookmarks)) bookmarks = []
    }
  } catch (err) {
    console.error('[Bookmarks] Failed to load:', err.message)
    bookmarks = []
  }
}

function save() {
  try {
    ensureDataDir()
    fs.writeFileSync(DATA_FILE(), JSON.stringify(bookmarks, null, 2), 'utf-8')
  } catch (err) {
    console.error('[Bookmarks] Failed to save:', err.message)
  }
}

function broadcast(channel, ...args) {
  BrowserWindow.getAllWindows().forEach(w =>
    w.webContents.send(channel, ...args)
  )
}

// ── Core operations ────────────────────────────────────────

function getAll() {
  return bookmarks
}

function getByParent(parentId) {
  return bookmarks.filter(b => b.parentId === parentId)
}

function getById(id) {
  return bookmarks.find(b => b.id === id) || null
}

function addBookmark({ title, url, parentId = null, favicon = null }) {
  const bookmark = {
    id: generateId(),
    type: 'bookmark',
    title: title || url || 'Untitled',
    url: url || '',
    parentId,
    favicon,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
  bookmarks.push(bookmark)
  save()
  broadcast('bookmarks-updated')
  return bookmark
}

function addFolder({ title, parentId = null }) {
  const folder = {
    id: generateId(),
    type: 'folder',
    title: title || 'New Folder',
    url: null,
    parentId,
    favicon: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
  bookmarks.push(folder)
  save()
  broadcast('bookmarks-updated')
  return folder
}

function update(id, changes) {
  const item = bookmarks.find(b => b.id === id)
  if (!item) return null

  if (changes.title !== undefined) item.title = changes.title
  if (changes.url !== undefined)   item.url   = changes.url
  if (changes.parentId !== undefined) item.parentId = changes.parentId
  if (changes.favicon !== undefined)  item.favicon  = changes.favicon
  item.updatedAt = Date.now()

  save()
  broadcast('bookmarks-updated')
  return item
}

function remove(id) {
  // Recursively remove children if this is a folder
  const children = bookmarks.filter(b => b.parentId === id)
  children.forEach(child => remove(child.id))

  bookmarks = bookmarks.filter(b => b.id !== id)
  save()
  broadcast('bookmarks-updated')
}

function move(id, newParentId) {
  const item = bookmarks.find(b => b.id === id)
  if (!item) return null

  // Prevent moving a folder into its own subtree
  if (item.type === 'folder') {
    let current = newParentId
    while (current) {
      if (current === id) return null // circular
      const parent = bookmarks.find(b => b.id === current)
      current = parent ? parent.parentId : null
    }
  }

  item.parentId = newParentId
  item.updatedAt = Date.now()
  save()
  broadcast('bookmarks-updated')
  return item
}

function search(query) {
  if (!query) return []
  const q = query.toLowerCase()
  return bookmarks.filter(b =>
    b.type === 'bookmark' && (
      (b.title && b.title.toLowerCase().includes(q)) ||
      (b.url && b.url.toLowerCase().includes(q))
    )
  )
}

function isBookmarked(url) {
  return bookmarks.some(b => b.type === 'bookmark' && b.url === url)
}

// ── Tree structure (for UI rendering) ──────────────────────
function getTree(parentId = null) {
  const children = bookmarks
    .filter(b => b.parentId === parentId)
    .sort((a, b) => a.createdAt - b.createdAt)

  return children.map(item => {
    if (item.type === 'folder') {
      return { ...item, children: getTree(item.id) }
    }
    return { ...item }
  })
}

// ── Import / Export ────────────────────────────────────────
function exportJSON() {
  return JSON.stringify(bookmarks, null, 2)
}

function importJSON(jsonString) {
  try {
    const imported = JSON.parse(jsonString)
    if (!Array.isArray(imported)) {
      throw new Error('Invalid format: expected an array')
    }

    // Validate each entry
    const valid = imported.filter(item =>
      item && typeof item === 'object' &&
      item.type && (item.type === 'bookmark' || item.type === 'folder')
    )

    // Assign new IDs to avoid collisions, build ID mapping
    const idMap = new Map()
    const processed = valid.map(item => {
      const newId = generateId()
      idMap.set(item.id, newId)
      return {
        id: newId,
        type: item.type,
        title: item.title || 'Imported',
        url: item.url || null,
        parentId: item.parentId, // will be remapped below
        favicon: item.favicon || null,
        createdAt: item.createdAt || Date.now(),
        updatedAt: Date.now(),
      }
    })

    // Remap parentIds
    processed.forEach(item => {
      if (item.parentId && idMap.has(item.parentId)) {
        item.parentId = idMap.get(item.parentId)
      } else {
        item.parentId = null // orphaned items go to root
      }
    })

    bookmarks.push(...processed)
    save()
    broadcast('bookmarks-updated')
    return { success: true, count: processed.length }
  } catch (err) {
    return { success: false, error: err.message }
  }
}

// ── IPC Handlers ───────────────────────────────────────────
function setupBookmarksIPC() {
  load()

  ipcMain.handle('bookmarks-get-all',       () => getAll())
  ipcMain.handle('bookmarks-get-tree',       () => getTree())
  ipcMain.handle('bookmarks-get-by-parent',  (_, parentId) => getByParent(parentId))
  ipcMain.handle('bookmarks-get-by-id',      (_, id) => getById(id))
  ipcMain.handle('bookmarks-search',         (_, query) => search(query))
  ipcMain.handle('bookmarks-is-bookmarked',  (_, url) => isBookmarked(url))

  ipcMain.handle('bookmarks-add', (_, data) => addBookmark(data))
  ipcMain.handle('bookmarks-add-folder', (_, data) => addFolder(data))
  ipcMain.handle('bookmarks-update', (_, id, changes) => update(id, changes))
  ipcMain.handle('bookmarks-remove', (_, id) => { remove(id); return true })
  ipcMain.handle('bookmarks-move', (_, id, newParentId) => move(id, newParentId))

  ipcMain.handle('bookmarks-export', () => exportJSON())
  ipcMain.handle('bookmarks-import', (_, jsonString) => importJSON(jsonString))
}

module.exports = { setupBookmarksIPC }
