// ============================================================
// adblock.js – Filter List Manager (v1.5 Privacy Suite)
// ============================================================
// Downloads and parses EasyList + EasyPrivacy filter lists.
// Caches them locally with a 7-day TTL so the app works
// offline. Exposes IPC for stats, manual update, and per-list
// toggling. Integrated into the network filter in main.js.
// ============================================================

const { app, ipcMain, BrowserWindow } = require('electron')
const path  = require('path')
const fs    = require('fs')
const https = require('https')
const http  = require('http')

// ── Paths ──────────────────────────────────────────────────
const DATA_DIR  = () => path.join(app.getPath('userData'), 'flux-data')
const LISTS_DIR = () => path.join(DATA_DIR(), 'filterlists')

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

// ── Filter list registry ───────────────────────────────────
const FILTER_LISTS = {
  easylist: {
    id:          'easylist',
    name:        'EasyList',
    url:         'https://easylist.to/easylist/easylist.txt',
    description: 'Removes adverts from English web pages',
    enabled:     true,
  },
  easyprivacy: {
    id:          'easyprivacy',
    name:        'EasyPrivacy',
    url:         'https://easylist.to/easylist/easyprivacy.txt',
    description: 'Blocks tracking scripts and data collection',
    enabled:     true,
  },
}

// ── In-memory state ────────────────────────────────────────
let blockedDomains = new Set()

let filterStats = {
  totalDomains: 0,
  listStats:    {},    // id → { name, domains, rules, updated }
  lastUpdated:  null,
  isUpdating:   false,
  error:        null,
}

// ── Helpers ────────────────────────────────────────────────
function ensureListsDir() {
  const dir = LISTS_DIR()
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

function cachePath(id) { return path.join(LISTS_DIR(), `${id}.txt`) }
function metaPath(id)  { return path.join(LISTS_DIR(), `${id}.meta.json`) }

function isCacheValid(id) {
  try {
    const mp = metaPath(id)
    if (!fs.existsSync(mp)) return false
    const { updated } = JSON.parse(fs.readFileSync(mp, 'utf-8'))
    return (Date.now() - (updated || 0)) < CACHE_TTL_MS
  } catch { return false }
}

function broadcast(channel, ...args) {
  BrowserWindow.getAllWindows().forEach(w =>
    w.webContents.send(channel, ...args))
}

// ── Download ───────────────────────────────────────────────
function downloadText(url, redirectDepth = 0) {
  return new Promise((resolve, reject) => {
    if (redirectDepth > 5) return reject(new Error('Too many redirects'))
    const proto = url.startsWith('https') ? https : http
    const req = proto.get(url, {
      headers: {
        'User-Agent': 'FLUX-Browser/1.5 FilterList-Updater',
        'Accept-Encoding': 'identity',
      },
      timeout: 60_000,
    }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        res.resume()
        const loc = res.headers.location
        if (!loc) return reject(new Error('Redirect without Location'))
        return downloadText(loc, redirectDepth + 1).then(resolve).catch(reject)
      }
      if (res.statusCode !== 200) {
        res.resume()
        return reject(new Error(`HTTP ${res.statusCode}`))
      }
      const chunks = []
      res.on('data',  c => chunks.push(c))
      res.on('end',   () => resolve(Buffer.concat(chunks).toString('utf-8')))
      res.on('error', reject)
    })
    req.on('error',   reject)
    req.on('timeout', () => { req.destroy(); reject(new Error('Connection timed out')) })
  })
}

// ── Parser ─────────────────────────────────────────────────
// Handles the most common Adblock Plus filter syntax:
//   ||example.com^         → block example.com and all subdomains
//   ||ads.example.com^     → block that subdomain
// Whitelist (@@) and cosmetic (##) rules are skipped.
function parseFilterList(text) {
  const domains  = new Set()
  let   rawRules = 0

  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('!') || line.startsWith('[')) continue
    if (line.startsWith('@@') || line.includes('##') || line.includes('#@#')) continue
    rawRules++

    // ||hostname^ — the canonical domain-blocking pattern
    const m = line.match(/^\|\|([a-zA-Z0-9][a-zA-Z0-9._-]{1,253}[a-zA-Z0-9])\^/)
    if (m) {
      const host = m[1].toLowerCase()
      // Skip rules that are clearly not plain hostnames
      if (!host.includes('/') && !host.includes('*')) {
        domains.add(host)
      }
    }
  }

  return { domains, ruleCount: rawRules }
}

// ── Per-list update ────────────────────────────────────────
async function updateList(id) {
  const cfg = FILTER_LISTS[id]
  if (!cfg || !cfg.enabled) return new Set()

  ensureListsDir()
  let text = null

  try {
    text = await downloadText(cfg.url)
    fs.writeFileSync(cachePath(id), text, 'utf-8')
    fs.writeFileSync(metaPath(id),  JSON.stringify({ updated: Date.now() }), 'utf-8')
    console.log(`[AdBlock] Downloaded ${id} (${(text.length / 1024).toFixed(0)} KB)`)
  } catch (e) {
    console.warn(`[AdBlock] Download failed for ${id}: ${e.message} – using cache`)
    const cp = cachePath(id)
    if (fs.existsSync(cp)) text = fs.readFileSync(cp, 'utf-8')
  }

  if (!text) return new Set()

  const { domains, ruleCount } = parseFilterList(text)
  const mp   = metaPath(id)
  const meta = fs.existsSync(mp) ? JSON.parse(fs.readFileSync(mp, 'utf-8')) : {}

  filterStats.listStats[id] = {
    name:    cfg.name,
    domains: domains.size,
    rules:   ruleCount,
    updated: meta.updated || null,
  }

  return domains
}

// ── Full rebuild ───────────────────────────────────────────
async function rebuildBlocklist(forceFetch = false) {
  if (filterStats.isUpdating) return
  filterStats.isUpdating = true
  filterStats.error      = null
  broadcast('adblock-status', { ...filterStats, totalDomains: blockedDomains.size })

  try {
    const next = new Set()
    for (const id of Object.keys(FILTER_LISTS)) {
      if (forceFetch || !isCacheValid(id)) {
        const d = await updateList(id)
        for (const h of d) next.add(h)
      } else {
        // Load from cache without re-downloading
        const cp = cachePath(id)
        if (fs.existsSync(cp)) {
          const { domains, ruleCount } = parseFilterList(fs.readFileSync(cp, 'utf-8'))
          const mp   = metaPath(id)
          const meta = fs.existsSync(mp) ? JSON.parse(fs.readFileSync(mp, 'utf-8')) : {}
          filterStats.listStats[id] = {
            name:    FILTER_LISTS[id].name,
            domains: domains.size,
            rules:   ruleCount,
            updated: meta.updated || null,
          }
          for (const h of domains) next.add(h)
        } else {
          // Cache doesn't exist yet – download now
          const d = await updateList(id)
          for (const h of d) next.add(h)
        }
      }
    }

    blockedDomains          = next
    filterStats.totalDomains = next.size
    filterStats.lastUpdated  = Date.now()
    console.log(`[AdBlock] Blocklist ready: ${next.size.toLocaleString()} domains`)
  } catch (e) {
    filterStats.error = e.message
    console.error('[AdBlock] rebuildBlocklist error:', e.message)
  } finally {
    filterStats.isUpdating = false
    broadcast('adblock-status', { ...filterStats, totalDomains: blockedDomains.size })
  }
}

// ── Public API ─────────────────────────────────────────────

/**
 * Returns true if the given URL's hostname is blocked by the filter lists.
 * Also checks parent domains (so ads.blocked.com → blocked.com → matches).
 */
function isBlockedByFilterList(hostname) {
  if (blockedDomains.size === 0) return false
  if (blockedDomains.has(hostname)) return true
  const parts = hostname.split('.')
  for (let i = 1; i < parts.length - 1; i++) {
    if (blockedDomains.has(parts.slice(i).join('.'))) return true
  }
  return false
}

/** Set up IPC handlers for the renderer. */
function setupAdblockIPC() {
  ipcMain.handle('adblock-get-stats', () => ({
    ...filterStats,
    totalDomains: blockedDomains.size,
    lists:        { ...FILTER_LISTS },
  }))

  ipcMain.on('adblock-update-now', () => {
    if (!filterStats.isUpdating) rebuildBlocklist(true)
  })

  ipcMain.on('adblock-toggle-list', (_, id, enabled) => {
    if (FILTER_LISTS[id]) {
      FILTER_LISTS[id].enabled = enabled
      rebuildBlocklist(false)
    }
  })
}

/**
 * Called at app startup. Loads from cache immediately (fast path),
 * then checks if any list has expired and re-downloads in the background.
 */
async function initAdblock() {
  ensureListsDir()

  // Fast path: load whatever we have cached so blocking starts immediately
  let hasSomething = false
  for (const id of Object.keys(FILTER_LISTS)) {
    const cp = cachePath(id)
    if (fs.existsSync(cp)) {
      hasSomething = true
      break
    }
  }

  if (hasSomething) {
    // Load cached lists synchronously so the network filter is ready before
    // any pages start loading
    const combined = new Set()
    for (const id of Object.keys(FILTER_LISTS)) {
      const cp = cachePath(id)
      if (!fs.existsSync(cp)) continue
      try {
        const { domains, ruleCount } = parseFilterList(fs.readFileSync(cp, 'utf-8'))
        const mp   = metaPath(id)
        const meta = fs.existsSync(mp) ? JSON.parse(fs.readFileSync(mp, 'utf-8')) : {}
        filterStats.listStats[id] = {
          name:    FILTER_LISTS[id].name,
          domains: domains.size,
          rules:   ruleCount,
          updated: meta.updated || null,
        }
        for (const h of domains) combined.add(h)
      } catch (e) {
        console.error(`[AdBlock] Cache load error (${id}):`, e.message)
      }
    }
    blockedDomains           = combined
    filterStats.totalDomains = combined.size
    filterStats.lastUpdated  = Date.now()
    console.log(`[AdBlock] Loaded ${combined.size.toLocaleString()} domains from cache`)
  }

  // Check if any list needs a fresh download and do it in background
  const needsUpdate = Object.keys(FILTER_LISTS).some(id => !isCacheValid(id))
  if (needsUpdate) {
    // Small delay so the window can finish loading first
    setTimeout(() => rebuildBlocklist(false), 8_000)
  }
}

module.exports = { setupAdblockIPC, initAdblock, isBlockedByFilterList }
