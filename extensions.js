'use strict'
// ============================================================
// extensions.js – Chrome Extension Manager (FLUX v1.6)
// ============================================================
// Supports:
//   • Unpacked extensions (folder with manifest.json)
//   • .crx files (CRX2 / CRX3, extracted via built-in ZIP parser)
//   • Chrome Web Store installations (CRX download + extract)
//
// CRX extraction uses only Node built-ins (zlib + fs) — no
// extra npm packages needed.
// ============================================================

const { app, ipcMain, BrowserWindow, session, dialog } = require('electron')
const path  = require('path')
const fs    = require('fs')
const zlib  = require('zlib')
const https = require('https')
const http  = require('http')

// ── Paths ──────────────────────────────────────────────────
const EXT_DIR  = () => path.join(app.getPath('userData'), 'flux-extensions')
const EXT_META = () => path.join(EXT_DIR(), '_installed.json')

function ensureExtDir() {
  const d = EXT_DIR()
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true })
}

function loadMeta() {
  try {
    const p = EXT_META()
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf-8'))
  } catch {}
  return []
}

function saveMeta(list) {
  try { fs.writeFileSync(EXT_META(), JSON.stringify(list, null, 2), 'utf-8') } catch {}
}

function broadcast(ch, ...args) {
  BrowserWindow.getAllWindows().forEach(w => w.webContents.send(ch, ...args))
}

// ── Minimal ZIP extractor (no external deps) ───────────────
// Handles stored (method 0) and deflate (method 8) entries —
// the only two methods Chrome extensions ever use.
function extractZip(zipBuf, destDir) {
  let offset = 0

  while (offset < zipBuf.length - 30) {
    // Local file header signature: PK\x03\x04
    if (zipBuf.readUInt32LE(offset) !== 0x04034b50) break

    const flags          = zipBuf.readUInt16LE(offset + 6)
    const method         = zipBuf.readUInt16LE(offset + 8)
    const compressedSize = zipBuf.readUInt32LE(offset + 18)
    const fnLen          = zipBuf.readUInt16LE(offset + 26)
    const extraLen       = zipBuf.readUInt16LE(offset + 28)
    const fileName       = zipBuf.toString('utf8', offset + 30, offset + 30 + fnLen)
    const dataOffset     = offset + 30 + fnLen + extraLen

    offset = dataOffset + compressedSize

    // Skip entries with data descriptor (size might be 0 in header)
    if (flags & 0x08) continue

    if (!fileName || fileName.endsWith('/')) {
      if (fileName) fs.mkdirSync(path.join(destDir, fileName), { recursive: true })
      continue
    }

    try {
      const raw  = zipBuf.slice(dataOffset, dataOffset + compressedSize)
      const data = method === 0 ? raw : zlib.inflateRawSync(raw)
      const out  = path.join(destDir, fileName)
      fs.mkdirSync(path.dirname(out), { recursive: true })
      fs.writeFileSync(out, data)
    } catch (e) {
      console.warn(`[Extensions] ZIP skip "${fileName}": ${e.message}`)
    }
  }
}

// ── CRX header stripper ────────────────────────────────────
// Both CRX2 and CRX3 start with "Cr24". We scan forward to
// find the ZIP PK\x03\x04 magic and pass everything from
// there to extractZip.
function extractCrx(crxBuf, destDir) {
  if (crxBuf.toString('ascii', 0, 4) !== 'Cr24') {
    throw new Error('Not a valid CRX file (missing Cr24 magic bytes)')
  }

  let zipStart = -1
  for (let i = 8; i < crxBuf.length - 4; i++) {
    if (crxBuf[i]===0x50 && crxBuf[i+1]===0x4B &&
        crxBuf[i+2]===0x03 && crxBuf[i+3]===0x04) {
      zipStart = i; break
    }
  }
  if (zipStart < 0) throw new Error('ZIP data not found in CRX')

  extractZip(crxBuf.slice(zipStart), destDir)
}

// ── Download CRX from Chrome Web Store ────────────────────
function downloadCrx(extId) {
  return new Promise((resolve, reject) => {
    // Official update endpoint used by Chrome itself
    const url = 'https://clients2.google.com/service/update2/crx' +
      '?response=redirect&prodversion=122.0.0.0&acceptformat=crx3,crx2' +
      `&x=id%3D${extId}%26installsource%3Dondemand%26uc`

    function fetch(reqUrl, depth = 0) {
      if (depth > 5) return reject(new Error('Too many redirects'))
      const lib = reqUrl.startsWith('https') ? https : http
      lib.get(reqUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/122.0.0.0' },
        timeout: 60_000,
      }, res => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          res.resume(); return fetch(res.headers.location, depth + 1)
        }
        if (res.statusCode !== 200) {
          res.resume(); return reject(new Error(`HTTP ${res.statusCode} — extension may not be available`))
        }
        const chunks = []
        res.on('data', c => chunks.push(c))
        res.on('end',  () => resolve(Buffer.concat(chunks)))
        res.on('error', reject)
      }).on('error', reject).on('timeout', function() { this.destroy(); reject(new Error('Connection timed out')) })
    }
    fetch(url)
  })
}

// ── Manifest reader ────────────────────────────────────────
function readManifest(extPath) {
  try { return JSON.parse(fs.readFileSync(path.join(extPath, 'manifest.json'), 'utf-8')) } catch { return null }
}

// ── Load into Electron session ─────────────────────────────
async function loadExtInSession(extPath) {
  return session.defaultSession.loadExtension(extPath, { allowFileAccess: true })
}

// ── State ──────────────────────────────────────────────────
let installed = []
// entry shape: { id, name, version, description, path, enabled, source, storeId?, error? }

// ── Install: unpacked folder ───────────────────────────────
async function installUnpacked(srcPath) {
  const manifest = readManifest(srcPath)
  if (!manifest) throw new Error('manifest.json not found in selected folder')

  const slug    = (manifest.name || 'ext').toLowerCase().replace(/[^a-z0-9]/g, '_')
  const destDir = path.join(EXT_DIR(), `${slug}_${Date.now()}`)
  fs.cpSync(srcPath, destDir, { recursive: true })

  const ext = await loadExtInSession(destDir)
  const entry = {
    id: ext.id, name: manifest.name || ext.id,
    version: manifest.version || '?',
    description: (manifest.description || '').slice(0, 160),
    path: destDir, enabled: true, source: 'unpacked',
  }
  installed.push(entry)
  saveMeta(installed)
  return entry
}

// ── Install: .crx file ─────────────────────────────────────
async function installCrx(crxPath) {
  const crxBuf = fs.readFileSync(crxPath)
  const destDir = path.join(EXT_DIR(), `crx_${Date.now()}`)
  fs.mkdirSync(destDir, { recursive: true })
  extractCrx(crxBuf, destDir)

  const manifest = readManifest(destDir)
  if (!manifest) throw new Error('Extracted CRX has no manifest.json')

  const ext = await loadExtInSession(destDir)
  const entry = {
    id: ext.id, name: manifest.name || ext.id,
    version: manifest.version || '?',
    description: (manifest.description || '').slice(0, 160),
    path: destDir, enabled: true, source: 'crx',
  }
  installed.push(entry)
  saveMeta(installed)
  return entry
}

// ── Install: Chrome Web Store ──────────────────────────────
async function installFromWebStore(extId) {
  ensureExtDir()
  broadcast('ext-install-progress', { extId, step: 'downloading' })

  const crxBuf  = await downloadCrx(extId)
  const destDir = path.join(EXT_DIR(), `ws_${extId}`)

  // Replace any previous version with the same store ID
  if (fs.existsSync(destDir)) fs.rmSync(destDir, { recursive: true, force: true })
  fs.mkdirSync(destDir, { recursive: true })

  broadcast('ext-install-progress', { extId, step: 'extracting' })
  extractCrx(crxBuf, destDir)

  const manifest = readManifest(destDir)
  if (!manifest) throw new Error('Extracted extension has no manifest.json')

  broadcast('ext-install-progress', { extId, step: 'loading' })
  const ext = await loadExtInSession(destDir)
  const entry = {
    id: ext.id, name: manifest.name || ext.id,
    version: manifest.version || '?',
    description: (manifest.description || '').slice(0, 160),
    path: destDir, enabled: true, source: 'webstore', storeId: extId,
  }

  installed = installed.filter(e => e.storeId !== extId)
  installed.push(entry)
  saveMeta(installed)
  return entry
}

// ── Remove ─────────────────────────────────────────────────
async function removeExtension(extId) {
  const entry = installed.find(e => e.id === extId)
  if (!entry) throw new Error('Extension not found')
  if (entry.path && fs.existsSync(entry.path)) {
    fs.rmSync(entry.path, { recursive: true, force: true })
  }
  installed = installed.filter(e => e.id !== extId)
  saveMeta(installed)
}

// ── Startup: reload persisted extensions ──────────────────
async function initExtensions() {
  ensureExtDir()
  const meta = loadMeta()
  installed = []

  for (const entry of meta) {
    if (!entry.enabled) { installed.push(entry); continue }
    if (!entry.path || !fs.existsSync(entry.path)) {
      installed.push({ ...entry, error: 'Extension folder not found (was it deleted?)' })
      continue
    }
    try {
      const ext = await loadExtInSession(entry.path)
      installed.push({ ...entry, id: ext.id, error: null })
    } catch (e) {
      console.error(`[Extensions] Failed to load "${entry.name}": ${e.message}`)
      installed.push({ ...entry, error: e.message })
    }
  }

  const ok  = installed.filter(e => !e.error).length
  const all = installed.length
  if (all > 0) console.log(`[Extensions] ${ok}/${all} extensions loaded`)
  saveMeta(installed)
}

// ── IPC ────────────────────────────────────────────────────
function setupExtensionIPC() {
  ipcMain.handle('ext-list', () => installed.map(e => ({ ...e })))

  ipcMain.handle('ext-install-unpacked', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: 'Select Extension Folder',
      properties: ['openDirectory'],
    })
    if (canceled || !filePaths.length) return null
    const entry = await installUnpacked(filePaths[0])
    broadcast('ext-list-updated', installed.map(e => ({ ...e })))
    return entry
  })

  ipcMain.handle('ext-install-crx', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: 'Select CRX File',
      filters: [{ name: 'Chrome Extension', extensions: ['crx'] }],
      properties: ['openFile'],
    })
    if (canceled || !filePaths.length) return null
    const entry = await installCrx(filePaths[0])
    broadcast('ext-list-updated', installed.map(e => ({ ...e })))
    return entry
  })

  ipcMain.handle('ext-install-webstore', async (_, extId) => {
    const entry = await installFromWebStore(extId)
    broadcast('ext-list-updated', installed.map(e => ({ ...e })))
    return entry
  })

  ipcMain.handle('ext-remove', async (_, extId) => {
    await removeExtension(extId)
    broadcast('ext-list-updated', installed.map(e => ({ ...e })))
    return true
  })
}

module.exports = { setupExtensionIPC, initExtensions }
