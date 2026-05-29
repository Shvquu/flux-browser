'use strict'

// ── DOM Refs ──────────────────────────────────────────────
const dom = {
  tabsContainer:    document.getElementById('tabs-container'),
  webviewContainer: document.getElementById('webview-container'),
  urlInput:         document.getElementById('url-input'),
  securityIcon:     document.getElementById('security-icon'),
  loadingIndicator: document.getElementById('loading-indicator'),
  progressBar:      document.getElementById('progress-bar'),
  progressFill:     document.getElementById('progress-fill'),
  statusText:       document.getElementById('status-text'),
  btnBack:          document.getElementById('btn-back'),
  btnForward:       document.getElementById('btn-forward'),
  btnReload:        document.getElementById('btn-reload'),
  btnNewTab:        document.getElementById('btn-new-tab'),
  btnNewEphemeral:  document.getElementById('btn-new-ephemeral'),
  btnHome:          document.getElementById('btn-home'),
  btnBookmark:      document.getElementById('btn-bookmark'),
  btnSettings:      document.getElementById('btn-settings'),
  btnDownloads:     document.getElementById('btn-downloads'),
  btnShield:        document.getElementById('btn-shield'),
  trustBadge:       document.getElementById('trust-badge'),
  btnMinimize:      document.getElementById('btn-minimize'),
  btnMaximize:      document.getElementById('btn-maximize'),
  btnClose:         document.getElementById('btn-close'),
  bookmarkBar:      document.getElementById('bookmark-bar'),
  findBar:          document.getElementById('find-bar'),
  findInput:        document.getElementById('find-input'),
  findCount:        document.getElementById('find-count'),
  findPrev:         document.getElementById('find-prev'),
  findNext:         document.getElementById('find-next'),
  findCase:         document.getElementById('find-case'),
  findRegex:        document.getElementById('find-regex'),
  findClose:        document.getElementById('find-close'),
  downloadTray:     document.getElementById('download-tray'),
  downloadTrayBody: document.getElementById('download-tray-body'),
  downloadBadge:    document.getElementById('download-badge'),
  shortcutOverlay:  document.getElementById('shortcut-overlay'),
}

// ── State ─────────────────────────────────────────────────
const state = { tabs: [], activeTabId: null, tabCounter: 0 }

const shield = { enabled: true, blockedCount: 0, log: [] }
const fp = { preloadPath: null, stats: { canvas:0, webgl:0, audio:0, navigator:0, screen:0, total:0 } }
const trust = { store: new Map(), currentDomain: null }
const update = { info: null, dismissed: false }

const CONFIG = { HOME_URL: 'https://www.google.com' }

// ── localStorage helpers ──────────────────────────────────
function lsGet(key, fallback) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback } catch { return fallback }
}
function lsSet(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)) } catch {}
}

// ════════════════════════════════════════════════════════════
// 1. BOOKMARKS
// ════════════════════════════════════════════════════════════
const BOOKMARKS_KEY = 'flux-bookmarks'

let _bookmarkCache = null
function loadBookmarks() {
  if (!_bookmarkCache) _bookmarkCache = lsGet(BOOKMARKS_KEY, { bookmarks: [], folders: [] })
  return _bookmarkCache
}
function saveBookmarks(data) {
  _bookmarkCache = data
  lsSet(BOOKMARKS_KEY, data)
}

function isBookmarked(url) {
  const data = loadBookmarks()
  return data.bookmarks.some(b => b.url === url)
}

function addBookmark(title, url, favicon) {
  const data = loadBookmarks()
  if (!data.bookmarks.some(b => b.url === url)) {
    data.bookmarks.unshift({ id: `bm-${Date.now()}`, title: title || url, url, favicon: favicon || null, folderId: null, addedAt: Date.now() })
    saveBookmarks(data)
  }
  updateBookmarkButton()
  renderBookmarkBar()
}

function removeBookmark(url) {
  const data = loadBookmarks()
  data.bookmarks = data.bookmarks.filter(b => b.url !== url)
  saveBookmarks(data)
  updateBookmarkButton()
  renderBookmarkBar()
}

function toggleBookmark() {
  const tab = getActiveTab()
  if (!tab) return
  const url = tab.webview.getURL()
  if (!url || url === 'about:blank') return
  if (isBookmarked(url)) {
    removeBookmark(url)
  } else {
    const title = tab.tabEl.querySelector('.tab-title')?.textContent || url
    const favicon = tab.tabEl.querySelector('.tab-favicon img')?.src || null
    addBookmark(title, url, favicon)
  }
}

function updateBookmarkButton() {
  const tab = getActiveTab()
  const icon = document.getElementById('bookmark-icon')
  if (!icon || !tab) return
  const url = tab.webview.getURL()
  if (isBookmarked(url)) {
    icon.querySelector('path').setAttribute('fill', 'currentColor')
    icon.querySelector('path').setAttribute('fill-opacity', '0.8')
    dom.btnBookmark.style.color = 'var(--accent)'
  } else {
    icon.querySelector('path').setAttribute('fill', 'none')
    icon.querySelector('path').removeAttribute('fill-opacity')
    dom.btnBookmark.style.color = ''
  }
}

function renderBookmarkBar() {
  const bar = dom.bookmarkBar
  if (!bar || bar.classList.contains('hidden')) return
  const data = loadBookmarks()
  const items = data.bookmarks.slice(0, 14)
  bar.innerHTML = items.length === 0
    ? `<span style="font-size:11px;color:var(--text-secondary);padding:0 12px;">No bookmarks yet. Press Ctrl+D to add one.</span>`
    : items.map(b => `
      <button class="bm-pill" data-url="${b.url}" title="${b.url}">
        ${b.favicon ? `<img src="${b.favicon}" class="bm-favicon" onerror="this.style.display='none'">` : '<span class="bm-favicon-fallback">⬤</span>'}
        <span>${(b.title||b.url).slice(0,16)}</span>
      </button>`).join('')

  bar.querySelectorAll('.bm-pill').forEach(btn =>
    btn.addEventListener('click', () => navigate(btn.dataset.url))
  )
}

// Long-press detection for bookmark button
let bookmarkPressTimer = null
dom.btnBookmark.addEventListener('mousedown', () => {
  bookmarkPressTimer = setTimeout(() => { navigate('flux://bookmarks') }, 600)
})
dom.btnBookmark.addEventListener('mouseup',   () => clearTimeout(bookmarkPressTimer))
dom.btnBookmark.addEventListener('mouseleave',() => clearTimeout(bookmarkPressTimer))
dom.btnBookmark.addEventListener('click', (e) => {
  clearTimeout(bookmarkPressTimer)
  toggleBookmark()
})

// ════════════════════════════════════════════════════════════
// 2. HISTORY
// ════════════════════════════════════════════════════════════
const HISTORY_KEY = 'flux-history'
const MAX_HISTORY = 5000

let _historyCache = null
function loadHistory() {
  if (!_historyCache) _historyCache = lsGet(HISTORY_KEY, [])
  return _historyCache
}
function saveHistory(arr) {
  _historyCache = arr.slice(0, MAX_HISTORY)
  lsSet(HISTORY_KEY, _historyCache)
}

function recordHistory(url, title, favicon) {
  if (!url || url === 'about:blank' || url.startsWith('flux://')) return
  const history = loadHistory()
  const now = Date.now()
  // Dedup within 30 seconds
  const recent = history.find(h => h.url === url && now - h.visitedAt < 30000)
  if (recent) { recent.visitedAt = now; saveHistory(history); return }
  history.unshift({ id: `h-${now}`, url, title: title || url, favicon: favicon || null, visitedAt: now })
  saveHistory(history)
}

// ════════════════════════════════════════════════════════════
// 3. SETTINGS
// ════════════════════════════════════════════════════════════
const SETTINGS_KEY = 'flux-settings'

function defaultSettings() {
  return {
    startPage: 'flux-default',
    searchEngine: 'https://www.google.com/search?q=',
    uiScale: 100,
    shieldDefault: true,
    fpGuardDefault: true,
    ephemeralDefault: false,
  }
}

function loadSettings() { return { ...defaultSettings(), ...lsGet(SETTINGS_KEY, {}) } }
function saveSettings(s) { lsSet(SETTINGS_KEY, s) }

function applySettings() {
  const s = loadSettings()
  CONFIG.HOME_URL = s.startPage === 'flux-default' ? 'https://www.google.com' : (s.startPage || 'https://www.google.com')
  CONFIG.SEARCH_ENGINE = s.searchEngine || 'https://www.google.com/search?q='
  document.body.style.fontSize = (s.uiScale / 100) + 'em'
  // Sync privacy settings to main process
  if (window.privacyAPI) {
    window.privacyAPI.setSettings({
      httpsOnly:             s.httpsOnly             ?? false,
      dohEnabled:            s.dohEnabled            ?? false,
      dohProvider:           s.dohProvider           ?? 'cloudflare',
      dohCustomUrl:          s.dohCustomUrl          ?? '',
      clearOnExit:           s.clearOnExit           ?? false,
      clearOnExitData:       s.clearOnExitData       ?? { cookies: true, cache: true, history: false, localStorage: false },
      blockThirdPartyCookies: s.blockThirdPartyCookies ?? false,
    })
  }
}

// ════════════════════════════════════════════════════════════
// 4. FIND IN PAGE
// ════════════════════════════════════════════════════════════
let findActive = false
let findMatchCase = false
let findUseRegex  = false

function openFind() {
  findActive = true
  dom.findBar.classList.remove('hidden')
  dom.findInput.focus()
  dom.findInput.select()
  executeFind()
}

function closeFind() {
  findActive = false
  dom.findBar.classList.add('hidden')
  dom.findInput.value = ''
  dom.findCount.textContent = ''
  const tab = getActiveTab()
  if (tab?.webview) tab.webview.stopFindInPage('clearSelection')
}

function executeFind(forward = true, findNext = false) {
  const tab = getActiveTab()
  if (!tab?.webview) return
  const query = dom.findInput.value
  if (!query) { dom.findCount.textContent = ''; tab.webview.stopFindInPage('clearSelection'); return }
  tab.webview.findInPage(query, { forward, findNext, matchCase: findMatchCase })
}

dom.findInput.addEventListener('input', () => executeFind(true, false))
dom.findInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter')       { e.preventDefault(); executeFind(true, true) }
  if (e.key === 'Enter' && e.shiftKey) { e.preventDefault(); executeFind(false, true) }
  if (e.key === 'Escape')      { closeFind() }
})
dom.findPrev.addEventListener('click',  () => executeFind(false, true))
dom.findNext.addEventListener('click',  () => executeFind(true, true))
dom.findClose.addEventListener('click', () => closeFind())
dom.findCase.addEventListener('click', () => {
  findMatchCase = !findMatchCase
  dom.findCase.classList.toggle('find-toggle-active', findMatchCase)
  executeFind(true, false)
})
dom.findRegex.addEventListener('click', () => {
  findUseRegex = !findUseRegex
  dom.findRegex.classList.toggle('find-toggle-active', findUseRegex)
  executeFind(true, false)
})

// ════════════════════════════════════════════════════════════
// 5. DOWNLOADS
// ════════════════════════════════════════════════════════════
const downloadHistory = [] // session-only

function updateDownloadBadge() {
  const active = downloadHistory.filter(d => d.state === 'progressing').length
  if (active > 0) {
    dom.downloadBadge.textContent = active
    dom.downloadBadge.classList.remove('hidden')
    dom.downloadTray.classList.remove('hidden')
  } else {
    dom.downloadBadge.classList.add('hidden')
  }
}

function getFileIcon(filename) {
  const ext = (filename.split('.').pop() || '').toLowerCase()
  if (['mp4','mkv','avi','mov','webm'].includes(ext)) return '🎬'
  if (['mp3','flac','wav','ogg','aac'].includes(ext)) return '🎵'
  if (['jpg','jpeg','png','gif','webp','svg'].includes(ext)) return '🖼'
  if (['zip','7z','rar','tar','gz'].includes(ext)) return '📦'
  if (['pdf'].includes(ext)) return '📄'
  if (['exe','msi','dmg','deb','rpm'].includes(ext)) return '⚙️'
  if (['doc','docx','txt','md'].includes(ext)) return '📝'
  if (['xls','xlsx','csv'].includes(ext)) return '📊'
  return '⬇️'
}

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return ''
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024*1024) return (bytes/1024).toFixed(1) + ' KB'
  return (bytes/(1024*1024)).toFixed(1) + ' MB'
}

function renderDownloadTray() {
  const recent = downloadHistory.slice(0, 12)
  if (recent.length === 0) { dom.downloadTray.classList.add('hidden'); return }
  dom.downloadTray.classList.remove('hidden')

  dom.downloadTrayBody.innerHTML = recent.map(d => {
    const pct    = d.totalBytes > 0 ? Math.round(d.receivedBytes / d.totalBytes * 100) : 0
    const isDone = d.state === 'completed'
    const isErr  = d.state === 'interrupted' || d.state === 'cancelled'
    const isProg = d.state === 'progressing'
    const icon   = getFileIcon(d.filename)
    const size   = isDone ? formatBytes(d.totalBytes) : isProg ? `${pct}% · ${formatBytes(d.receivedBytes)}` : d.state

    return `<div class="dl-item ${isDone?'done':isErr?'error':''}" data-id="${d.id}">
      <span class="dl-icon">${icon}</span>
      <div class="dl-info">
        <div class="dl-name" title="${d.filename}">${d.filename.length>24?d.filename.slice(0,22)+'…':d.filename}</div>
        <div class="dl-status">${size}</div>
        ${isProg ? `<div class="dl-progress-wrap"><div class="dl-progress-bar" style="width:${pct}%"></div></div>` : ''}
      </div>
      ${isDone
        ? `<button class="dl-action open-folder" data-path="${d.savePath}">📂 Open</button>`
        : isErr
          ? `<button class="dl-action">✕ ${d.state}</button>`
          : `<span class="dl-action" style="cursor:default;border:none;color:var(--accent);font-weight:700;">${pct}%</span>`
      }
    </div>`
  }).join('')

  dom.downloadTrayBody.querySelectorAll('.open-folder').forEach(btn =>
    btn.addEventListener('click', () => window.downloadAPI.openFolder(btn.dataset.path))
  )
}

let _dlTrayTimer = null
function renderDownloadTrayDebounced() {
  if (_dlTrayTimer) return
  _dlTrayTimer = setTimeout(() => { _dlTrayTimer = null; renderDownloadTray() }, 200)
}

window.downloadAPI.onStarted((info) => {
  downloadHistory.unshift({ ...info })
  updateDownloadBadge()
  renderDownloadTray()
})
window.downloadAPI.onProgress(({ id, receivedBytes, totalBytes }) => {
  const d = downloadHistory.find(x => x.id === id)
  if (d) { d.receivedBytes = receivedBytes; d.totalBytes = totalBytes }
  updateDownloadBadge()
  renderDownloadTrayDebounced()
})
window.downloadAPI.onDone(({ id, state, savePath }) => {
  const d = downloadHistory.find(x => x.id === id)
  if (d) { d.state = state; d.savePath = savePath }
  updateDownloadBadge()
  renderDownloadTray()
})

document.getElementById('download-tray-toggle').addEventListener('click', () => {
  navigate('flux://downloads')
})

document.getElementById('download-shelf-close')?.addEventListener('click', () => {
  dom.downloadTray.classList.add('hidden')
})

// ════════════════════════════════════════════════════════════
// 6. SHORTCUT OVERLAY (F1)
// ════════════════════════════════════════════════════════════
const SHORTCUTS_DEF = [
  ['Ctrl+T',        'New Tab'],
  ['Ctrl+Shift+T',  'Ephemeral Tab'],
  ['Ctrl+W',        'Close Tab'],
  ['Ctrl+L',        'Focus Address Bar'],
  ['Ctrl+D',        'Bookmark Current Page'],
  ['Ctrl+Shift+B',  'Toggle Bookmark Bar'],
  ['Ctrl+H',        'Open History'],
  ['Ctrl+F',        'Find in Page'],
  ['Ctrl+J',        'Open Downloads'],
  ['F5 / Ctrl+R',   'Reload Page'],
  ['Alt+←',         'Go Back'],
  ['Alt+→',         'Go Forward'],
  ['Ctrl+1–9',      'Switch to Tab'],
  ['F1',            'Keyboard Shortcuts'],
  ['Ctrl+Shift+I',  'DevTools'],
  ['Ctrl+Shift+E',  'Extensions'],
  ['Ctrl+Shift+M',  'Resource Monitor'],
]

function showShortcutOverlay() {
  const overlay = dom.shortcutOverlay
  overlay.classList.remove('hidden')
  overlay.innerHTML = `
    <div class="sc-box">
      <div class="sc-title">⌨ FLUX Keyboard Shortcuts</div>
      <div class="sc-grid">
        ${SHORTCUTS_DEF.map(([k,v]) => `
          <div class="sc-row">
            <span class="sc-key">${k}</span>
            <span class="sc-label">${v}</span>
          </div>`).join('')}
      </div>
      <div class="sc-hint">Press F1 or Esc to close</div>
    </div>`
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) hideShortcutOverlay()
  }, { once: true })
}

function hideShortcutOverlay() {
  dom.shortcutOverlay.classList.add('hidden')
}

// ════════════════════════════════════════════════════════════
// AUTO-UPDATE BANNER  (Chrome/Brave style)
// ════════════════════════════════════════════════════════════

const autoUpdate = {
  status:    'idle',   // idle|checking|available|downloading|downloaded|error|upToDate
  progress:  0,
  version:   null,
  dismissed: false,
}

function renderUpdateBanner() {
  const bar = document.getElementById('flux-update-bar')
  if (!bar) return

  const { status, progress, version } = autoUpdate

  // States that should hide the bar
  if (['idle','checking','upToDate'].includes(status) || autoUpdate.dismissed) {
    bar.style.display = 'none'
    return
  }

  bar.style.display = 'flex'

  if (status === 'downloading') {
    bar.innerHTML = `
      <div class="nt-update-left">
        <span class="nt-update-icon">⬇️</span>
        <div class="nt-update-text">
          <strong>Downloading FLUX Browser ${version || ''}…</strong>
          <span>Installing in the background — ${progress}% complete</span>
        </div>
      </div>
      <div class="nt-update-actions">
        <div class="flux-update-progress-wrap">
          <div class="flux-update-progress-bar" style="width:${progress}%"></div>
        </div>
        <button id="flux-update-dismiss" title="Hide">✕</button>
      </div>`
  } else if (status === 'downloaded') {
    bar.innerHTML = `
      <div class="nt-update-left">
        <span class="nt-update-icon">✅</span>
        <div class="nt-update-text">
          <strong>FLUX Browser ${version || ''} is ready to install</strong>
          <span>Restart to apply the update — takes only a few seconds</span>
        </div>
      </div>
      <div class="nt-update-actions">
        <button id="flux-update-restart" class="flux-update-btn-primary">Restart to update</button>
        <button id="flux-update-dismiss" title="Later">✕</button>
      </div>`
    document.getElementById('flux-update-restart')?.addEventListener('click', () => {
      window.autoUpdateAPI.restartNow()
    })
  } else if (status === 'available') {
    // Fallback mode: no installer available, offer GitHub page
    bar.innerHTML = `
      <div class="nt-update-left">
        <span class="nt-update-icon">🚀</span>
        <div class="nt-update-text">
          <strong>FLUX Browser ${version || ''} is available</strong>
          <span>A new version is ready to download</span>
        </div>
      </div>
      <div class="nt-update-actions">
        <button id="flux-update-download" class="flux-update-btn-primary">Download Update</button>
        <button id="flux-update-dismiss" title="Dismiss">✕</button>
      </div>`
    document.getElementById('flux-update-download')?.addEventListener('click', () => {
      window.autoUpdateAPI.downloadNow()
    })
  } else if (status === 'error') {
    bar.style.display = 'none'  // errors stay silent
    return
  }

  document.getElementById('flux-update-dismiss')?.addEventListener('click', () => {
    // Only allow full dismiss once downloaded (like Chrome's "X" on restart banner)
    if (status !== 'downloaded') autoUpdate.dismissed = true
    bar.style.display = 'none'
  })
}

function applyUpdateState(s) {
  autoUpdate.status   = s.status   || 'idle'
  autoUpdate.progress = s.downloadProgress || 0
  autoUpdate.version  = s.latestVersion || null
  // Re-show bar after a new download completes even if previously dismissed
  if (s.status === 'downloaded') autoUpdate.dismissed = false
  renderUpdateBanner()
}

// Boot: fetch current state + subscribe to live changes
if (window.autoUpdateAPI) {
  window.autoUpdateAPI.getState().then(s => { if (s) applyUpdateState(s) }).catch(() => {})
  window.autoUpdateAPI.onStateChange(s => applyUpdateState(s))
}

// ════════════════════════════════════════════════════════════
// INTERNAL PAGE HELPER
// ════════════════════════════════════════════════════════════
const INTERNAL_PREFIXES = ['flux-network','flux-privacy','flux-trust','flux-bookmarks','flux-history','flux-settings','flux-downloads','flux-shortcuts','flux-cookies','flux-privacymode','flux-extensions']

function hideAllInternalPages(tabId) {
  INTERNAL_PREFIXES.forEach(p => {
    const el = document.getElementById(`${p}-${tabId}`)
    if (el) el.style.display = 'none'
  })
}

function showInternalPage(prefix, tabId, renderFn, tab) {
  hideAllInternalPages(tabId)
  tab.webview.classList.remove('active')
  if (tab.newTabScreen) tab.newTabScreen.classList.add('hidden')
  let el = document.getElementById(`${prefix}-${tabId}`)
  if (el) { el.style.display = 'block' } else { renderFn(tabId) }
}

function removeAllInternalPages(tabId) {
  INTERNAL_PREFIXES.forEach(p => document.getElementById(`${p}-${tabId}`)?.remove())
}

// ════════════════════════════════════════════════════════════
// SHARED INLINE COLORS
// ════════════════════════════════════════════════════════════
const C = {
  bg:'#060508', border:'rgba(140,60,255,0.18)',
  accent:'#5ce0ff', accent2:'#9b3dff', orange:'#ff6a00',
  text:'#e8d8ff', muted:'rgba(210,180,255,0.55)',
  green:'#4ade80', red:'#f87171', yellow:'#facc15',
  SF:"'Segoe UI',system-ui,-apple-system,sans-serif",
}

function makePage(id, tabId) {
  const page = document.createElement('div')
  page.id = `${id}-${tabId}`
  Object.assign(page.style, {
    position:'absolute', inset:'0', background:C.bg, overflowY:'auto',
    padding:'40px', fontFamily:C.SF, color:C.text, zIndex:'10', boxSizing:'border-box',
  })
  return page
}

function pageHeader(icon, title, subtitle, badgeText) {
  return `<div style="display:flex;align-items:flex-start;gap:16px;margin-bottom:32px;padding-bottom:20px;border-bottom:1px solid ${C.border};">
    <div>
      <div style="font-size:20px;font-weight:800;color:${C.accent};">${icon} ${title}</div>
      <div style="font-size:12px;color:${C.muted};letter-spacing:1px;margin-top:4px;">${subtitle}</div>
    </div>
    ${badgeText ? `<div style="margin-left:auto;padding:6px 14px;background:${C.accent2}10;border:1px solid ${C.accent2}33;border-radius:20px;font-size:11px;color:${C.accent2};white-space:nowrap;">${badgeText}</div>` : ''}
  </div>`
}

// ════════════════════════════════════════════════════════════
// flux://bookmarks
// ════════════════════════════════════════════════════════════
function renderBookmarksPage(tabId) {
  const tab = getTab(tabId)
  if (!tab) return
  document.getElementById(`flux-bookmarks-${tabId}`)?.remove()

  const data = loadBookmarks()
  const page = makePage('flux-bookmarks', tabId)

  const cards = data.bookmarks.length === 0
    ? `<div style="text-align:center;padding:60px 0;color:${C.muted};">No bookmarks yet. Press Ctrl+D on any page.</div>`
    : data.bookmarks.map(b => `
      <div style="display:flex;align-items:center;gap:12px;padding:12px 16px;background:rgba(12,8,20,0.7);border:1px solid ${C.border};border-radius:10px;margin-bottom:6px;cursor:pointer;" class="bm-card" data-url="${b.url}">
        ${b.favicon ? `<img src="${b.favicon}" style="width:16px;height:16px;border-radius:3px;" onerror="this.style.display='none'">` : `<span style="color:${C.accent2};font-size:14px;">⬤</span>`}
        <div style="flex:1;min-width:0;">
          <div style="font-size:13px;font-weight:600;color:${C.text};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${b.title}</div>
          <div style="font-size:11px;color:${C.muted};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${b.url}</div>
        </div>
        <button class="bm-delete" data-url="${b.url}" style="background:transparent;border:1px solid ${C.border};color:${C.red};border-radius:6px;padding:2px 8px;font-size:10px;cursor:pointer;">✕</button>
      </div>`).join('')

  page.innerHTML = `
    ${pageHeader('🔖','FLUX Bookmarks','flux://bookmarks · Your saved pages',`${data.bookmarks.length} bookmarks`)}
    <div style="display:flex;gap:10px;margin-bottom:20px;">
      <input id="bm-search-${tabId}" placeholder="Search bookmarks..." style="flex:1;background:rgba(12,8,20,0.8);border:1px solid ${C.border};border-radius:8px;padding:8px 14px;color:${C.text};font-size:13px;outline:none;">
      <label style="padding:8px 14px;background:${C.accent2}22;border:1px solid ${C.accent2}44;border-radius:8px;color:${C.accent2};font-size:12px;cursor:pointer;display:flex;align-items:center;gap:6px;">
        📥 Import
        <input type="file" accept=".html" id="bm-import-${tabId}" style="display:none;">
      </label>
      <button id="bm-export-${tabId}" style="padding:8px 14px;background:${C.accent}22;border:1px solid ${C.accent}44;border-radius:8px;color:${C.accent};font-size:12px;cursor:pointer;">📤 Export</button>
    </div>
    <div id="bm-list-${tabId}">${cards}</div>`

  tab.webview.classList.remove('active')
  if (tab.newTabScreen) tab.newTabScreen.classList.add('hidden')
  dom.webviewContainer.appendChild(page)

  page.querySelectorAll('.bm-card').forEach(card =>
    card.addEventListener('click', (e) => {
      if (!e.target.classList.contains('bm-delete')) navigate(card.dataset.url)
    })
  )
  page.querySelectorAll('.bm-delete').forEach(btn =>
    btn.addEventListener('click', (e) => {
      e.stopPropagation()
      removeBookmark(btn.dataset.url)
      renderBookmarksPage(tabId)
    })
  )

  // Search
  document.getElementById(`bm-search-${tabId}`).addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase()
    page.querySelectorAll('.bm-card').forEach(card => {
      card.style.display = card.textContent.toLowerCase().includes(q) ? '' : 'none'
    })
  })

  // Export
  document.getElementById(`bm-export-${tabId}`).addEventListener('click', () => {
    const d = loadBookmarks()
    const html = `<!DOCTYPE NETSCAPE-Bookmark-file-1>\n<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">\n<TITLE>Bookmarks</TITLE>\n<H1>Bookmarks</H1>\n<DL><p>\n${d.bookmarks.map(b=>`<DT><A HREF="${b.url}" ADD_DATE="${Math.floor(b.addedAt/1000)}">${b.title}</A>`).join('\n')}\n</DL><p>`
    const blob = new Blob([html], {type:'text/html'})
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'flux-bookmarks.html'; a.click()
  })

  // Import
  document.getElementById(`bm-import-${tabId}`).addEventListener('change', (e) => {
    const file = e.target.files[0]; if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      const parser = new DOMParser()
      const doc2 = parser.parseFromString(ev.target.result, 'text/html')
      const links = doc2.querySelectorAll('a')
      const d = loadBookmarks()
      links.forEach(a => {
        if (a.href && !d.bookmarks.some(b=>b.url===a.href)) {
          d.bookmarks.push({ id:`bm-${Date.now()}-${Math.random()}`, title:a.textContent||a.href, url:a.href, favicon:null, folderId:null, addedAt:Date.now() })
        }
      })
      saveBookmarks(d)
      renderBookmarksPage(tabId)
    }
    reader.readAsText(file)
  })
}

// ════════════════════════════════════════════════════════════
// flux://history
// ════════════════════════════════════════════════════════════
function renderHistoryPage(tabId) {
  const tab = getTab(tabId)
  if (!tab) return
  document.getElementById(`flux-history-${tabId}`)?.remove()

  const history = loadHistory()
  const page = makePage('flux-history', tabId)

  function groupByDate(entries) {
    const groups = {}
    const today = new Date(); today.setHours(0,0,0,0)
    const yesterday = new Date(today); yesterday.setDate(today.getDate()-1)
    const weekAgo = new Date(today); weekAgo.setDate(today.getDate()-7)
    entries.forEach(e => {
      const d = new Date(e.visitedAt); d.setHours(0,0,0,0)
      let label
      if (d.getTime()===today.getTime()) label='Today'
      else if (d.getTime()===yesterday.getTime()) label='Yesterday'
      else if (d>=weekAgo) label='This Week'
      else label=d.toLocaleDateString('de-DE',{day:'2-digit',month:'2-digit',year:'numeric'})
      if (!groups[label]) groups[label]=[]
      groups[label].push(e)
    })
    return groups
  }

  function renderEntries(entries) {
    if (entries.length===0) return `<div style="text-align:center;padding:60px 0;color:${C.muted};">No history yet.</div>`
    const groups = groupByDate(entries)
    return Object.entries(groups).map(([label,items])=>`
      <div style="font-size:10px;font-weight:700;letter-spacing:2px;color:${C.accent2};text-transform:uppercase;margin:20px 0 8px;">${label}</div>
      ${items.map(e=>`
        <div class="hist-entry" data-url="${e.url}" style="display:flex;align-items:center;gap:12px;padding:10px 14px;background:rgba(12,8,20,0.7);border:1px solid ${C.border};border-radius:8px;margin-bottom:4px;cursor:pointer;">
          ${e.favicon?`<img src="${e.favicon}" style="width:14px;height:14px;" onerror="this.style.display='none'">`:`<span style="color:${C.accent2};font-size:12px;">○</span>`}
          <div style="flex:1;min-width:0;">
            <div style="font-size:12px;font-weight:600;color:${C.text};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${e.title}</div>
            <div style="font-size:10px;color:${C.muted};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${e.url}</div>
          </div>
          <span style="font-size:10px;color:${C.muted};white-space:nowrap;">${new Date(e.visitedAt).toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit'})}</span>
          <button class="hist-del" data-id="${e.id}" style="background:transparent;border:1px solid ${C.border};color:${C.red};border-radius:5px;padding:1px 7px;font-size:9px;cursor:pointer;">✕</button>
        </div>`).join('')}`).join('')
  }

  page.innerHTML = `
    ${pageHeader('📖','Browsing History','flux://history · Your visited pages',`${history.length} entries`)}
    <div style="display:flex;gap:10px;margin-bottom:20px;">
      <input id="hist-search-${tabId}" placeholder="Search history..." style="flex:1;background:rgba(12,8,20,0.8);border:1px solid ${C.border};border-radius:8px;padding:8px 14px;color:${C.text};font-size:13px;outline:none;">
      <button id="hist-clear-${tabId}" style="padding:8px 14px;background:${C.red}22;border:1px solid ${C.red}44;border-radius:8px;color:${C.red};font-size:12px;cursor:pointer;">🗑 Clear All</button>
    </div>
    <div id="hist-list-${tabId}">${renderEntries(history)}</div>`

  tab.webview.classList.remove('active')
  if (tab.newTabScreen) tab.newTabScreen.classList.add('hidden')
  dom.webviewContainer.appendChild(page)

  function bindListEvents() {
    page.querySelectorAll('.hist-entry').forEach(entry =>
      entry.addEventListener('click', (e) => { if(!e.target.classList.contains('hist-del')) navigate(entry.dataset.url) })
    )
    page.querySelectorAll('.hist-del').forEach(btn =>
      btn.addEventListener('click', (e) => {
        e.stopPropagation()
        const h = loadHistory().filter(x=>x.id!==btn.dataset.id)
        saveHistory(h)
        const list = document.getElementById(`hist-list-${tabId}`)
        if (list) list.innerHTML = renderEntries(h)
        bindListEvents()
      })
    )
  }
  bindListEvents()

  document.getElementById(`hist-search-${tabId}`).addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase()
    const filtered = loadHistory().filter(h => h.url.toLowerCase().includes(q) || h.title.toLowerCase().includes(q))
    const list = document.getElementById(`hist-list-${tabId}`)
    if (list) { list.innerHTML = renderEntries(filtered); bindListEvents() }
  })

  document.getElementById(`hist-clear-${tabId}`).addEventListener('click', () => {
    if (confirm('Delete all browsing history?')) {
      saveHistory([])
      renderHistoryPage(tabId)
    }
  })
}

// ════════════════════════════════════════════════════════════
// flux://settings
// ════════════════════════════════════════════════════════════
function renderSettingsPage(tabId) {
  const tab = getTab(tabId)
  if (!tab) return
  document.getElementById(`flux-settings-${tabId}`)?.remove()

  const s = loadSettings()
  const page = makePage('flux-settings', tabId)

  function section(title, content) {
    return `<div style="margin-bottom:28px;">
      <div style="font-size:10px;font-weight:700;letter-spacing:2px;color:${C.accent2};text-transform:uppercase;margin-bottom:12px;">${title}</div>
      <div style="background:rgba(12,8,20,0.7);border:1px solid ${C.border};border-radius:12px;overflow:hidden;">${content}</div>
    </div>`
  }
  function row(label, desc, control) {
    return `<div style="display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border-bottom:1px solid ${C.border};">
      <div>
        <div style="font-size:13px;font-weight:600;color:${C.text};">${label}</div>
        ${desc?`<div style="font-size:11px;color:${C.muted};margin-top:2px;">${desc}</div>`:''}
      </div>
      <div style="flex-shrink:0;margin-left:16px;">${control}</div>
    </div>`
  }
  function toggle(id, checked) {
    return `<button class="st-toggle ${checked?'on':''}" id="${id}" style="width:44px;height:24px;background:${checked?C.accent:'rgba(140,60,255,0.18)'};border:none;border-radius:12px;cursor:pointer;position:relative;transition:background 0.2s;"><span style="position:absolute;top:3px;left:${checked?'23':'3'}px;width:18px;height:18px;background:#fff;border-radius:50%;transition:left 0.2s;display:block;"></span></button>`
  }
  function select(id, options, value) {
    return `<select id="${id}" style="background:rgba(12,8,20,0.9);border:1px solid ${C.border};color:${C.text};padding:6px 10px;border-radius:8px;font-size:12px;">
      ${options.map(([v,l])=>`<option value="${v}" ${v===value?'selected':''}>${l}</option>`).join('')}
    </select>`
  }

  page.innerHTML = `
    ${pageHeader('⚙️','FLUX Settings','flux://settings · Browser preferences','')}
    ${section('General', [
      row('New Tab Page','What to show when opening a new tab',
        select(`st-startpage-${tabId}`, [['flux-default','FLUX Start Page'],['custom','Custom URL']], s.startPage==='flux-default'?'flux-default':'custom')),
      `<div style="padding:14px 18px;border-bottom:1px solid ${C.border};">
        <div style="font-size:13px;font-weight:600;color:${C.text};margin-bottom:6px;">Custom Start Page URL</div>
        <input id="st-customurl-${tabId}" value="${s.startPage!=='flux-default'?s.startPage:''}" placeholder="https://..." style="width:100%;background:rgba(12,8,20,0.9);border:1px solid ${C.border};color:${C.text};padding:7px 12px;border-radius:8px;font-size:12px;box-sizing:border-box;outline:none;">
      </div>`,
    ].join(''))}
    ${section('Search Engine', row('Default Search Engine','Used when typing in the address bar',
      select(`st-search-${tabId}`, [
        ['https://www.google.com/search?q=','Google'],
        ['https://duckduckgo.com/?q=','DuckDuckGo'],
        ['https://search.brave.com/search?q=','Brave Search'],
        ['https://www.bing.com/search?q=','Bing'],
      ], s.searchEngine)))}
    ${section('Appearance', row('UI Scale','Scale the browser interface',
      select(`st-scale-${tabId}`, [['90','90%'],['100','100%'],['110','110%'],['120','120%']], String(s.uiScale))))}
    ${section('Privacy', [
      row('FLUX Shield Default','Enable Shield on startup', toggle(`st-shield-${tabId}`, s.shieldDefault)),
      row('Fingerprint Guard','Randomize canvas, WebGL and audio fingerprints', toggle(`st-fp-${tabId}`, s.fpGuardDefault)),
      row('Ephemeral Tabs Default','Make all new tabs ephemeral by default (no cookies/history/cache)', toggle(`st-ephemeral-${tabId}`, s.ephemeralDefault)),
      row('Block Third-Party Cookies','Strip cookie headers for cross-site requests', toggle(`st-3pcookie-${tabId}`, s.blockThirdPartyCookies || false)),
      row('DNS-over-HTTPS','Encrypt DNS lookups via a DoH resolver',
        `<div style="display:flex;align-items:center;gap:8px;">
          ${toggle(`st-doh-${tabId}`, s.dohEnabled || false)}
          ${select(`st-doh-provider-${tabId}`,
            [['cloudflare','Cloudflare (1.1.1.1)'],['quad9','Quad9'],['google','Google DNS'],['custom','Custom']],
            s.dohProvider || 'cloudflare')}
        </div>`),
      `<div style="padding:10px 18px;border-bottom:1px solid ${C.border};">
        <div style="font-size:11px;color:${C.muted};margin-bottom:4px;">Custom DoH URL (when "Custom" is selected)</div>
        <input id="st-doh-custom-${tabId}" value="${s.dohCustomUrl||''}" placeholder="https://your-doh-resolver.example/dns-query"
          style="width:100%;background:rgba(12,8,20,0.9);border:1px solid ${C.border};color:${C.text};
                 padding:7px 12px;border-radius:8px;font-size:12px;box-sizing:border-box;outline:none;">
      </div>`,
      row('HTTPS-Only Mode','Automatically upgrade HTTP requests to HTTPS; block non-upgradeable sites', toggle(`st-httpsonly-${tabId}`, s.httpsOnly || false)),
      row('Clear-on-Exit','Wipe browsing data when the browser closes', toggle(`st-clearexit-${tabId}`, s.clearOnExit || false)),
      `<div id="st-clearexit-opts-${tabId}" style="padding:12px 18px;border-bottom:1px solid ${C.border};display:${s.clearOnExit?'block':'none'};">
        <div style="font-size:11px;color:${C.muted};margin-bottom:8px;">What to clear on exit:</div>
        <div style="display:flex;flex-wrap:wrap;gap:8px;">
          ${['cookies','cache','history','localStorage'].map(k=>`
            <label style="display:flex;align-items:center;gap:5px;font-size:12px;color:${C.text};cursor:pointer;">
              <input type="checkbox" class="st-clear-item" data-key="${k}" ${(s.clearOnExitData||{})[k]!==false?'checked':''}>
              ${k.charAt(0).toUpperCase()+k.slice(1)}
            </label>`).join('')}
        </div>
      </div>`,
      `<div style="padding:10px 18px;border-bottom:1px solid ${C.border};">
        <button id="st-open-cookies-${tabId}"
          style="font-size:12px;font-weight:700;padding:7px 16px;background:rgba(155,61,255,0.12);
                 border:1px solid ${C.accent2};border-radius:8px;color:${C.accent2};cursor:pointer;">
          🍪 Open Cookie Manager
        </button>
        <button id="st-open-privacymode-${tabId}"
          style="font-size:12px;font-weight:700;padding:7px 16px;background:rgba(155,61,255,0.12);
                 border:1px solid ${C.accent2};border-radius:8px;color:${C.accent2};cursor:pointer;margin-left:10px;">
          🔏 Privacy Mode v1.5
        </button>
      </div>`,
    ].join(''))}
    ${section('About', `
      <div style="padding:18px 18px;">
        <div style="font-size:13px;color:${C.text};margin-bottom:6px;">FLUX Browser</div>
        <div style="font-size:11px;color:${C.muted};margin-bottom:12px;">Zero Telemetry · Zero Tracking · Full Control</div>
        <a href="#" id="st-github-${tabId}" style="font-size:12px;color:${C.accent};">→ View on GitHub</a>
      </div>`)}
    <div style="display:flex;justify-content:flex-end;margin-top:8px;">
      <button id="st-save-${tabId}" style="padding:10px 24px;background:${C.accent2};border:none;border-radius:8px;color:#fff;font-size:13px;font-weight:700;cursor:pointer;">Save Settings</button>
    </div>`

  tab.webview.classList.remove('active')
  if (tab.newTabScreen) tab.newTabScreen.classList.add('hidden')
  dom.webviewContainer.appendChild(page)

  // Toggle clicks
  page.querySelectorAll('.st-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const isOn = btn.classList.contains('on')
      btn.classList.toggle('on', !isOn)
      btn.style.background = isOn ? 'rgba(140,60,255,0.18)' : C.accent
      btn.querySelector('span').style.left = isOn ? '3px' : '23px'
    })
  })

  document.getElementById(`st-github-${tabId}`)?.addEventListener('click', () => navigate('https://github.com/Shvquu/flux-browser'))

  // Clear-on-exit toggle: show/hide options panel
  const clearExitToggle = document.getElementById(`st-clearexit-${tabId}`)
  const clearExitOpts   = document.getElementById(`st-clearexit-opts-${tabId}`)
  if (clearExitToggle && clearExitOpts) {
    clearExitToggle.addEventListener('click', () => {
      // toggle fires after class update — wait a tick
      setTimeout(() => {
        clearExitOpts.style.display = clearExitToggle.classList.contains('on') ? 'block' : 'none'
      }, 0)
    })
  }

  document.getElementById(`st-open-cookies-${tabId}`)?.addEventListener('click', () => navigate('flux://cookies'))
  document.getElementById(`st-open-privacymode-${tabId}`)?.addEventListener('click', () => navigate('flux://privacymode'))

  document.getElementById(`st-save-${tabId}`)?.addEventListener('click', () => {
    const ns = { ...s }
    const startSel = document.getElementById(`st-startpage-${tabId}`)?.value
    const customUrl = document.getElementById(`st-customurl-${tabId}`)?.value
    ns.startPage = startSel === 'flux-default' ? 'flux-default' : (customUrl || 'flux-default')
    ns.searchEngine = document.getElementById(`st-search-${tabId}`)?.value || s.searchEngine
    ns.uiScale = parseInt(document.getElementById(`st-scale-${tabId}`)?.value || '100')
    ns.shieldDefault  = document.getElementById(`st-shield-${tabId}`)?.classList.contains('on')
    ns.fpGuardDefault = document.getElementById(`st-fp-${tabId}`)?.classList.contains('on')
    ns.ephemeralDefault = document.getElementById(`st-ephemeral-${tabId}`)?.classList.contains('on')
    ns.blockThirdPartyCookies = document.getElementById(`st-3pcookie-${tabId}`)?.classList.contains('on')
    ns.dohEnabled  = document.getElementById(`st-doh-${tabId}`)?.classList.contains('on')
    ns.dohProvider = document.getElementById(`st-doh-provider-${tabId}`)?.value || 'cloudflare'
    ns.dohCustomUrl = document.getElementById(`st-doh-custom-${tabId}`)?.value || ''
    ns.httpsOnly   = document.getElementById(`st-httpsonly-${tabId}`)?.classList.contains('on')
    ns.clearOnExit = document.getElementById(`st-clearexit-${tabId}`)?.classList.contains('on')
    // Clear-on-exit items
    const clearItems = {}
    document.querySelectorAll(`#st-clearexit-opts-${tabId} .st-clear-item`).forEach(cb => {
      clearItems[cb.dataset.key] = cb.checked
    })
    ns.clearOnExitData = clearItems
    saveSettings(ns)
    applySettings()
    // Sync to main process
    if (window.privacyAPI) {
      window.privacyAPI.setSettings({
        httpsOnly:             ns.httpsOnly,
        dohEnabled:            ns.dohEnabled,
        dohProvider:           ns.dohProvider,
        dohCustomUrl:          ns.dohCustomUrl,
        clearOnExit:           ns.clearOnExit,
        clearOnExitData:       ns.clearOnExitData,
        blockThirdPartyCookies: ns.blockThirdPartyCookies,
      })
    }
    // Flash save button
    const btn = document.getElementById(`st-save-${tabId}`)
    if (btn) { btn.textContent = '✓ Saved!'; setTimeout(() => { btn.textContent = 'Save Settings' }, 1500) }
  })
}

// ════════════════════════════════════════════════════════════
// flux://downloads
// ════════════════════════════════════════════════════════════
function renderDownloadsPage(tabId) {
  const tab = getTab(tabId)
  if (!tab) return
  document.getElementById(`flux-downloads-${tabId}`)?.remove()

  const page = makePage('flux-downloads', tabId)

  function dlRows() {
    if (downloadHistory.length === 0)
      return `<div style="text-align:center;padding:60px 0;color:${C.muted};">No downloads yet.</div>`
    return downloadHistory.map(d => {
      const pct = d.totalBytes > 0 ? Math.round(d.receivedBytes / d.totalBytes * 100) : 0
      const stateColor = d.state==='completed' ? C.green : d.state==='progressing' ? C.accent : C.red
      return `<div style="display:flex;align-items:center;gap:12px;padding:12px 16px;background:rgba(12,8,20,0.7);border:1px solid ${C.border};border-radius:10px;margin-bottom:6px;">
        <div style="flex:1;min-width:0;">
          <div style="font-size:13px;font-weight:600;color:${C.text};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${d.filename}</div>
          <div style="font-size:10px;color:${C.muted};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${d.url}</div>
          ${d.state==='progressing'?`<div style="height:3px;background:rgba(140,60,255,0.2);border-radius:2px;margin-top:4px;"><div style="height:3px;background:${C.accent};width:${pct}%;border-radius:2px;transition:width 0.3s;"></div></div>`:''}
        </div>
        <span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:6px;background:${stateColor}18;color:${stateColor};border:1px solid ${stateColor}44;">${d.state}</span>
        ${d.state==='completed'?`<button class="dl-open" data-path="${d.savePath}" style="background:${C.accent}22;border:1px solid ${C.accent}44;color:${C.accent};border-radius:6px;padding:4px 10px;font-size:11px;cursor:pointer;">Open folder</button>`:''}
      </div>`
    }).join('')
  }

  page.innerHTML = `
    ${pageHeader('⬇️','Downloads','flux://downloads · Download history',`${downloadHistory.length} downloads`)}
    <div id="dl-page-list-${tabId}">${dlRows()}</div>`

  tab.webview.classList.remove('active')
  if (tab.newTabScreen) tab.newTabScreen.classList.add('hidden')
  dom.webviewContainer.appendChild(page)

  page.querySelectorAll('.dl-open').forEach(btn =>
    btn.addEventListener('click', () => window.downloadAPI.openFolder(btn.dataset.path))
  )
}

// ════════════════════════════════════════════════════════════
// flux://shortcuts
// ════════════════════════════════════════════════════════════
function renderShortcutsPage(tabId) {
  const tab = getTab(tabId)
  if (!tab) return
  document.getElementById(`flux-shortcuts-${tabId}`)?.remove()

  const page = makePage('flux-shortcuts', tabId)
  page.innerHTML = `
    ${pageHeader('⌨️','Keyboard Shortcuts','flux://shortcuts · All keybindings','')}
    <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:6px;">
      ${SHORTCUTS_DEF.map(([k,v]) => `
        <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:rgba(12,8,20,0.7);border:1px solid ${C.border};border-radius:8px;">
          <span style="font-size:12px;color:${C.text};">${v}</span>
          <span style="font-family:monospace;font-size:11px;padding:3px 8px;background:rgba(92,224,255,0.08);border:1px solid ${C.accent}33;border-radius:5px;color:${C.accent};white-space:nowrap;">${k}</span>
        </div>`).join('')}
    </div>`

  tab.webview.classList.remove('active')
  if (tab.newTabScreen) tab.newTabScreen.classList.add('hidden')
  dom.webviewContainer.appendChild(page)
}

// ════════════════════════════════════════════════════════════
// PARSE INPUT
// ════════════════════════════════════════════════════════════
function parseInput(input) {
  input = input.trim()
  if (!input) return CONFIG.HOME_URL
  const internals = ['flux://network','flux://privacy','flux://trust','flux://bookmarks','flux://history','flux://settings','flux://downloads','flux://shortcuts','flux://cookies','flux://privacymode','flux://extensions']
  if (internals.includes(input)) return input
  try {
    const url = new URL(input)
    if (url.protocol === 'http:' || url.protocol === 'https:') return input
  } catch (_) {}
  if (/^[\w-]+(\.[\w-]+)+(\/.*)?$/.test(input)) return 'https://' + input
  const s = loadSettings()
  const engine = s.searchEngine || 'https://www.google.com/search?q='
  return `${engine}${encodeURIComponent(input)}`
}

function getTab(id) { return state.tabs.find(t => t.id === id) ?? null }
function getActiveTab() { return getTab(state.activeTabId) }

// ════════════════════════════════════════════════════════════
// PROGRESS BAR
// ════════════════════════════════════════════════════════════
let progressTimer = null, progressValue = 0
function startProgress() {
  dom.progressBar.classList.remove('hidden'); progressValue = 5
  dom.progressFill.style.width = progressValue + '%'
  progressTimer = setInterval(() => {
    const r = 90 - progressValue; progressValue += r * 0.12
    dom.progressFill.style.width = progressValue + '%'
  }, 200)
}
function finishProgress() {
  clearInterval(progressTimer); dom.progressFill.style.width = '100%'
  setTimeout(() => { dom.progressBar.classList.add('hidden'); dom.progressFill.style.width = '0%' }, 300)
}

// ════════════════════════════════════════════════════════════
// NEW TAB PAGE
// ════════════════════════════════════════════════════════════
function showNewTabPage(tabId, isEphemeral = false) {
  document.getElementById('new-tab-' + tabId)?.remove()
  const screen = document.createElement('div')
  screen.className = 'new-tab-screen'; screen.id = 'new-tab-' + tabId

  const quickLinks = [
    { label:'Google',    url:'https://google.com',    icon:'G' },
    { label:'YouTube',   url:'https://youtube.com',   icon:'&#9654;' },
    { label:'GitHub',    url:'https://github.com',    icon:'{/}' },
    { label:'Wikipedia', url:'https://wikipedia.org', icon:'W' },
    { label:'Reddit',    url:'https://reddit.com',    icon:'R' },
    { label:'Privacy Mode', url:'flux://privacymode', icon:'🔏' },
  ]

  screen.innerHTML = `
    ${isEphemeral ? `<div class="nt-ephemeral-banner"><span class="nt-eph-icon">👻</span><div class="nt-eph-text"><strong>Ephemeral Tab</strong><span>No cookies · No cache · No history · Everything deleted on close</span></div></div>` : ''}
    <div class="nt-clock" id="nt-clock-${tabId}"></div>
    <div class="nt-brand">
      <img src="flux.png" class="nt-logo-img" alt="FLUX">
      <div class="nt-brand-text">
        <span class="nt-logo-text">FLUX</span>
        <span class="nt-tagline">Zero Telemetry · Zero Tracking · Full Control</span>
      </div>
    </div>
    <div class="nt-search-wrap">
      <div class="nt-search-bar">
        <svg class="nt-search-icon" viewBox="0 0 20 20" fill="none"><circle cx="8.5" cy="8.5" r="5.5" stroke="currentColor" stroke-width="1.5"/><path d="M13 13l3.5 3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
        <input class="nt-search-input" id="nt-search-${tabId}" type="text" placeholder="Suchen oder URL eingeben..." spellcheck="false" autocomplete="off"/>
        <kbd class="nt-search-hint">Enter</kbd>
      </div>
    </div>
    <div class="nt-quicklinks">
      ${quickLinks.map(l=>`<button class="nt-quicklink" data-url="${l.url}" title="${l.url}"><span class="nt-ql-icon">${l.icon}</span><span class="nt-ql-label">${l.label}</span></button>`).join('')}
    </div>`

  dom.webviewContainer.appendChild(screen)

  const clockEl = screen.querySelector(`#nt-clock-${tabId}`)
  function tick() {
    const now = new Date()
    clockEl.innerHTML = `<span class="nt-time">${now.toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit'})}</span><span class="nt-date">${now.toLocaleDateString('de-DE',{weekday:'long',day:'numeric',month:'long'})}</span>`
  }
  tick(); const timer = setInterval(tick,1000)
  const obs = new MutationObserver(() => { if(!document.contains(screen)){clearInterval(timer);obs.disconnect()} })
  obs.observe(document.body,{childList:true,subtree:true})

  const input = screen.querySelector(`#nt-search-${tabId}`)
  input.addEventListener('keydown', e => { if(e.key==='Enter'&&input.value.trim()){dom.urlInput.value=input.value;navigate(input.value)} })
  setTimeout(() => input.focus(), 80)
  screen.querySelectorAll('.nt-quicklink').forEach(btn => btn.addEventListener('click',()=>navigate(btn.dataset.url)))
  return screen
}

// ════════════════════════════════════════════════════════════
// TAB MANAGEMENT
// ════════════════════════════════════════════════════════════
function createTab(url = null, options = {}) {
  const id = ++state.tabCounter
  const isNewTab = url === null
  const s = loadSettings()
  const isEphemeral = !!(options.ephemeral || s.ephemeralDefault)
  const partitionName = isEphemeral ? `ephemeral-${id}-${Date.now()}` : null

  const tabEl = document.createElement('div')
  tabEl.className = isEphemeral ? 'tab ephemeral' : 'tab'
  tabEl.dataset.id = id

  const ephemeralBadge = isEphemeral ? `<span class="tab-ephemeral-icon" title="Ephemeral Tab">👻</span>` : ''
  tabEl.innerHTML = `
    ${ephemeralBadge}
    <div class="tab-favicon" ${isEphemeral?'style="display:none"':''}>
      <div class="tab-loading"></div>
    </div>
    <span class="tab-title">${isEphemeral?'Ephemeral Tab':'Neuer Tab'}</span>
    <button class="tab-close" title="Tab schließen">
      <svg viewBox="0 0 10 10" fill="none"><path d="M1 1l8 8M9 1l-8 8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>
    </button>`

  tabEl.addEventListener('click', (e) => {
    if (e.target.closest('.tab-close')) closeTab(id)
    else activateTab(id)
  })

  tabEl.setAttribute('draggable','true')
  tabEl.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain',String(id)); e.dataTransfer.effectAllowed='move'; setTimeout(()=>tabEl.classList.add('dragging'),0) })
  tabEl.addEventListener('dragend',   () => { tabEl.classList.remove('dragging'); document.querySelectorAll('.tab').forEach(t=>t.classList.remove('drag-over-left','drag-over-right')) })
  tabEl.addEventListener('dragover',  (e) => {
    e.preventDefault(); e.dataTransfer.dropEffect='move'
    const draggingId=parseInt(e.dataTransfer.getData('text/plain')); if(draggingId===id) return
    const rect=tabEl.getBoundingClientRect(), isLeft=e.clientX<rect.left+rect.width/2
    document.querySelectorAll('.tab').forEach(t=>t.classList.remove('drag-over-left','drag-over-right'))
    tabEl.classList.add(isLeft?'drag-over-left':'drag-over-right')
  })
  tabEl.addEventListener('dragleave', () => tabEl.classList.remove('drag-over-left','drag-over-right'))
  tabEl.addEventListener('drop', (e) => {
    e.preventDefault(); tabEl.classList.remove('drag-over-left','drag-over-right')
    const draggingId=parseInt(e.dataTransfer.getData('text/plain')); if(draggingId===id) return
    const rect=tabEl.getBoundingClientRect(), insertBefore=e.clientX<rect.left+rect.width/2
    const fromIndex=state.tabs.findIndex(t=>t.id===draggingId), toIndex=state.tabs.findIndex(t=>t.id===id)
    if(fromIndex===-1||toIndex===-1) return
    const [movedTab]=state.tabs.splice(fromIndex,1)
    const newIndex=insertBefore?(toIndex>fromIndex?toIndex-1:toIndex):(toIndex<fromIndex?toIndex+1:toIndex)
    state.tabs.splice(newIndex,0,movedTab)
    state.tabs.forEach(t=>dom.tabsContainer.appendChild(t.tabEl))
  })

  dom.tabsContainer.appendChild(tabEl)

  const webview = document.createElement('webview')
  webview.setAttribute('allowpopups','false')
  if (fp.preloadPath) webview.setAttribute('preload',`file://${fp.preloadPath}`)
  if (isEphemeral && partitionName) webview.setAttribute('partition', partitionName)
  webview.setAttribute('src', isNewTab ? 'about:blank' : url)
  dom.webviewContainer.appendChild(webview)

  const tab = { id, tabEl, webview, newTabScreen:null, isEphemeral, partitionName }
  state.tabs.push(tab)
  registerWebviewEvents(tab)
  if (isNewTab) tab.newTabScreen = showNewTabPage(id, isEphemeral)
  activateTab(id)
  return id
}

function activateTab(id) {
  const prevTab = getActiveTab()
  if (prevTab) {
    prevTab.tabEl.classList.remove('active')
    prevTab.webview.classList.remove('active')
    prevTab.newTabScreen?.classList.add('hidden')
    hideAllInternalPages(prevTab.id)
  }

  const tab = getTab(id)
  if (!tab) return
  tab.tabEl.classList.add('active')
  state.activeTabId = id
  hideAllInternalPages(tab.id)
  tab.webview.classList.remove('active')

  const PAGE_MAP = {
    isNetworkPage:   ['flux-network',    renderNetworkPage],
    isPrivacyPage:   ['flux-privacy',    renderPrivacyPage],
    isCookiePage:    ['flux-cookies',    renderCookiePage],
    isPrivacyModePage:['flux-privacymode',renderPrivacyModePage],
    isTrustPage:     ['flux-trust',      renderTrustPage],
    isBookmarksPage: ['flux-bookmarks',  renderBookmarksPage],
    isHistoryPage:   ['flux-history',    renderHistoryPage],
    isSettingsPage:    ['flux-settings',    renderSettingsPage],
    isDownloadsPage:   ['flux-downloads',   renderDownloadsPage],
    isShortcutsPage:   ['flux-shortcuts',   renderShortcutsPage],
    isExtensionsPage:  ['flux-extensions',  renderExtensionsPage],
  }

  let handledInternal = false
  for (const [flag,[prefix,renderFn]] of Object.entries(PAGE_MAP)) {
    if (tab[flag]) {
      const el = document.getElementById(`${prefix}-${tab.id}`)
      if (el) { el.style.display = 'block' } else { renderFn(tab.id) }
      dom.urlInput.value = `flux://${prefix.replace('flux-','')}`
      handledInternal = true; break
    }
  }

  if (!handledInternal) {
    tab.webview.classList.add('active')
    tab.newTabScreen?.classList.remove('hidden')
  }

  updateNavbar(tab)
  updateBookmarkButton()

  // Close find bar when switching tabs
  if (findActive) closeFind()
}

function closeTab(id) {
  const index = state.tabs.findIndex(t => t.id === id)
  if (index === -1) return
  const tab = state.tabs[index]
  tab.tabEl.remove(); tab.webview.remove(); tab.newTabScreen?.remove()
  removeAllInternalPages(tab.id)
  window.resourceAPI.unregisterTab(tab.id)
  if (tab.isEphemeral && tab.partitionName) window.ephemeralAPI.clear(tab.partitionName).catch(()=>{})
  state.tabs.splice(index,1)
  if (state.tabs.length === 0) createTab()
  else if (state.activeTabId === id) activateTab(state.tabs[Math.min(index, state.tabs.length-1)].id)
}

// ════════════════════════════════════════════════════════════
// WEBVIEW EVENTS
// ════════════════════════════════════════════════════════════
function registerWebviewEvents(tab) {
  const { webview, tabEl } = tab
  const titleEl   = tabEl.querySelector('.tab-title')
  const faviconEl = tabEl.querySelector('.tab-favicon')

  webview.addEventListener('did-start-loading', () => {
    if (state.activeTabId===tab.id) { startProgress(); dom.loadingIndicator.classList.remove('hidden') }
    faviconEl.innerHTML = '<div class="tab-loading"></div>'
  })

  webview.addEventListener('did-stop-loading', () => {
    if (state.activeTabId===tab.id) { finishProgress(); dom.loadingIndicator.classList.add('hidden') }
    if (!faviconEl.querySelector('img')) faviconEl.innerHTML = defaultFaviconSVG()
  })

  webview.addEventListener('page-title-updated', (e) => {
    titleEl.textContent = e.title || 'Kein Titel'
    titleEl.title = e.title
    if (state.activeTabId===tab.id) document.title = e.title + ' – FLUX'
  })

  webview.addEventListener('page-favicon-updated', (e) => {
    if (e.favicons?.length > 0) faviconEl.innerHTML = `<img src="${e.favicons[0]}" alt="" draggable="false">`
  })

  webview.addEventListener('did-navigate', (e) => {
    if (e.url !== 'about:blank' && tab.newTabScreen) { tab.newTabScreen.remove(); tab.newTabScreen = null }
    // Record history (not for ephemeral tabs)
    if (!tab.isEphemeral && e.url !== 'about:blank') {
      const title = titleEl.textContent
      const fav = faviconEl.querySelector('img')?.src || null
      recordHistory(e.url, title, fav)
    }
    if (state.activeTabId===tab.id) {
      updateNavbar(tab)
      updateBookmarkButton()
      const domain = domainFromURL(e.url)
      if (domain) {
        window.trustAPI.get(domain).then(config => { trust.store.set(domain,config); updateTrustBadge(domain,config) })
      } else { updateTrustBadge(null,null) }
    }
    // Chrome Web Store detection – offer one-click install in FLUX
    const wsMatch = e.url.match(/chrome\.google\.com\/webstore\/detail\/([^/?#]+)\/([a-z]{32})/)
    if (wsMatch && state.activeTabId === tab.id) {
      showWebStoreBanner(wsMatch[1], wsMatch[2])
    } else if (state.activeTabId === tab.id) {
      hideWebStoreBanner()
    }
  })

  webview.addEventListener('did-navigate-in-page', () => {
    if (state.activeTabId===tab.id) updateNavbar(tab)
  })

  webview.addEventListener('did-fail-load', (e) => {
    if (e.errorCode===-3) return
    titleEl.textContent='Fehler'
    if (state.activeTabId===tab.id) finishProgress()
  })

  webview.addEventListener('dom-ready', async () => {
    // Register with resource monitor (always, even for about:blank)
    window.resourceAPI.registerTab(tab.id, webview.getWebContentsId())

    const url = webview.getURL()
    const domain = domainFromURL(url)
    if (!domain) return
    const config = await window.trustAPI.get(domain)
    trust.store.set(domain,config)
    const json = JSON.stringify(config)
    webview.executeJavaScript(`window.__fluxTrustConfig=${json};void 0`).catch(()=>{})
    if (state.activeTabId===tab.id) updateTrustBadge(domain,config)
  })

  webview.addEventListener('ipc-message', (e) => {
    if (e.channel==='flux-fp-attempt') {
      const url = webview.getURL()
      const domain = domainFromURL(url)
      if (domain) window.trustAPI.reportFP(domain, e.args[0])
    }
  })

  webview.addEventListener('found-in-page', (e) => {
    if (e.result) {
      dom.findCount.textContent = e.result.activeMatchOrdinal > 0
        ? `${e.result.activeMatchOrdinal} of ${e.result.matches}` : ''
    }
  })

  webview.addEventListener('update-target-url', (e) => { dom.statusText.textContent = e.url || '' })
  webview.addEventListener('new-window', (e) => createTab(e.url))
}

function updateNavbar(tab) {
  if (!tab?.webview) return
  if (document.activeElement !== dom.urlInput) {
    const url = tab.webview.getURL()
    dom.urlInput.value = url === 'about:blank' ? '' : url
  }
  dom.btnBack.disabled    = !tab.webview.canGoBack()
  dom.btnForward.disabled = !tab.webview.canGoForward()
  const url = tab.webview.getURL()
  const isSecure = url.startsWith('https://') || url.startsWith('about:') || url.startsWith('flux://')
  dom.securityIcon.className = isSecure ? 'secure' : 'insecure'
}

function defaultFaviconSVG() {
  return `<svg viewBox="0 0 16 16" fill="none" style="opacity:0.4"><circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.2"/><circle cx="8" cy="8" r="2" fill="currentColor"/></svg>`
}

function domainFromURL(url) { try { return new URL(url).hostname || null } catch { return null } }

// ════════════════════════════════════════════════════════════
// NAVIGATE
// ════════════════════════════════════════════════════════════
function navigate(input) {
  const tab = getActiveTab()
  if (!tab) return

  const url = parseInput(input)
  if (tab.newTabScreen) { tab.newTabScreen.remove(); tab.newTabScreen = null }

  const INTERNAL_MAP = {
    'flux://network':   ['isNetworkPage',   renderNetworkPage],
    'flux://privacy':   ['isPrivacyPage',   renderPrivacyPage],
    'flux://cookies':   ['isCookiePage',    renderCookiePage],
    'flux://privacymode':['isPrivacyModePage',renderPrivacyModePage],
    'flux://trust':     ['isTrustPage',     renderTrustPage],
    'flux://bookmarks': ['isBookmarksPage', renderBookmarksPage],
    'flux://history':   ['isHistoryPage',   renderHistoryPage],
    'flux://settings':  ['isSettingsPage',  renderSettingsPage],
    'flux://downloads':  ['isDownloadsPage',  renderDownloadsPage],
    'flux://shortcuts':  ['isShortcutsPage',  renderShortcutsPage],
    'flux://extensions': ['isExtensionsPage', renderExtensionsPage],
  }

  if (INTERNAL_MAP[url]) {
    const [flag, renderFn] = INTERNAL_MAP[url]
    // Clear all flags
    Object.keys(INTERNAL_MAP).forEach(k => tab[INTERNAL_MAP[k][0]] = false)
    tab[flag] = true
    dom.urlInput.value = url; dom.urlInput.blur()
    const titleEl = tab.tabEl.querySelector('.tab-title')
    if (titleEl) titleEl.textContent = 'FLUX ' + url.replace('flux://','').charAt(0).toUpperCase() + url.replace('flux://','').slice(1)
    hideAllInternalPages(tab.id)
    tab.webview.classList.remove('active')
    renderFn(tab.id)
    return
  }

  // Normal URL
  Object.keys(INTERNAL_MAP).forEach(k => tab[INTERNAL_MAP[k][0]] = false)
  hideAllInternalPages(tab.id)
  tab.webview.classList.add('active')
  tab.webview.loadURL(url)
  dom.urlInput.blur()
}

// ════════════════════════════════════════════════════════════
// TRUST BADGE
// ════════════════════════════════════════════════════════════
const TRUST_COLORS = {
  0: { color:'#f87171' },
  1: { color:'#facc15' },
  2: { color:'#4ade80' },
}

function updateTrustBadge(domain, config) {
  trust.currentDomain = domain
  const badge = dom.trustBadge
  if (!badge) return
  if (!domain || !config) { badge.style.display='none'; return }
  const level = config.level ?? 1
  const info  = TRUST_COLORS[level] || TRUST_COLORS[1]
  badge.style.display='flex'; badge.style.color=info.color
  badge.title=`FLUX Trust: ${['Strict','Standard','Trusted'][level]} — ${domain}\nClick to manage`
  badge.querySelector('.trust-badge-dot').style.background=info.color
  badge.querySelector('.trust-badge-dot').style.boxShadow=`0 0 6px ${info.color}`
}

// ════════════════════════════════════════════════════════════
// SHIELD UI
// ════════════════════════════════════════════════════════════
function updateShieldButton() {
  const btn=dom.btnShield, count=document.getElementById('shield-count')
  if (!btn) return
  shield.enabled ? btn.classList.remove('shield-off') : btn.classList.add('shield-off')
  if (count) {
    if (shield.blockedCount>0) { count.textContent=shield.blockedCount>99?'99+':shield.blockedCount; count.classList.remove('hidden') }
    else count.classList.add('hidden')
  }
}

function pulseShield() {
  const btn=dom.btnShield; if(!btn) return
  btn.classList.add('shield-pulse'); setTimeout(()=>btn.classList.remove('shield-pulse'),600)
}

function renderNetworkPage(tabId) {
  const tab=getTab(tabId); if(!tab) return
  document.getElementById(`flux-network-${tabId}`)?.remove()
  const allowed=shield.log.filter(e=>e.type==='allowed').length
  const trackers=shield.log.filter(e=>e.type==='blocked-tracker').length
  const bg=shield.log.filter(e=>e.type==='blocked-bg').length
  const total=shield.log.length
  function timeAgo(ts){const s=Math.floor((Date.now()-ts)/1000);if(s<5)return 'just now';if(s<60)return `${s}s ago`;return `${Math.floor(s/60)}m ago`}
  function badge(type){if(type==='allowed')return 'Allowed';if(type==='blocked-tracker')return 'Tracker';return 'BG Block'}
  const logHTML=shield.log.length===0?`<div class="fn-empty">🛡️ No connections recorded yet. Browse a page.</div>`:shield.log.map(e=>`<div class="fn-log-entry ${e.type}"><span class="fn-log-badge">${badge(e.type)}</span><span class="fn-log-url" title="${e.url}">${e.url}</span><span class="fn-log-time">${timeAgo(e.time)}</span></div>`).join('')
  const page=document.createElement('div')
  page.className='flux-network-page'; page.id=`flux-network-${tabId}`
  page.innerHTML=`<div class="fn-header"><div><div class="fn-title" style="font-family:'Segoe UI',system-ui,sans-serif;font-size:20px;font-weight:800;color:#5ce0ff;">🛡️ FLUX Shield · Network Monitor</div><div class="fn-subtitle">flux://network · Zero-Connection Mode</div></div><div class="fn-shield-toggle"><span class="fn-toggle-label">FLUX Shield</span><button class="fn-toggle ${shield.enabled?'on':''}" id="fn-toggle-${tabId}"></button></div></div><div class="fn-shield-status ${shield.enabled?'active':'inactive'}"><span class="fn-shield-dot"></span>${shield.enabled?'Zero-Connection Mode ACTIVE':'Shield DISABLED — All connections allowed'}</div><div class="fn-stats"><div class="fn-stat"><span style="font-family:'Segoe UI',system-ui,sans-serif;font-size:28px;font-weight:800;color:#4ade80;">${allowed}</span><span class="fn-stat-label">Allowed</span></div><div class="fn-stat"><span style="font-family:'Segoe UI',system-ui,sans-serif;font-size:28px;font-weight:800;color:#f87171;">${trackers}</span><span class="fn-stat-label">Trackers Blocked</span></div><div class="fn-stat"><span style="font-family:'Segoe UI',system-ui,sans-serif;font-size:28px;font-weight:800;color:#9b3dff;">${bg}</span><span class="fn-stat-label">BG Blocked</span></div></div><div style="font-family:'Segoe UI',system-ui,sans-serif;font-size:10px;font-weight:700;letter-spacing:2px;color:#9b3dff;text-transform:uppercase;margin-bottom:12px;">Connection Log (last ${total})</div><div class="fn-log">${logHTML}</div>`
  tab.webview.classList.remove('active')
  if(tab.newTabScreen) tab.newTabScreen.classList.add('hidden')
  dom.webviewContainer.appendChild(page)
  const toggleBtn=page.querySelector(`#fn-toggle-${tabId}`)
  if(toggleBtn){toggleBtn.addEventListener('click',()=>{shield.enabled=!shield.enabled;window.shieldAPI.toggle(shield.enabled);updateShieldButton();renderNetworkPage(tabId)})}
}

function renderPrivacyPage(tabId) {
  const tab=getTab(tabId); if(!tab) return
  document.getElementById(`flux-privacy-${tabId}`)?.remove()
  const s=fp.stats
  const protections=[
    {name:'Canvas Fingerprint',attempts:s.canvas,desc:'Pixel noise injected into every canvas render'},
    {name:'WebGL Fingerprint',attempts:s.webgl,desc:'GPU renderer & vendor strings randomized'},
    {name:'Audio Fingerprint',attempts:s.audio,desc:'Micro-noise added to AudioContext output'},
    {name:'Navigator Properties',attempts:s.navigator,desc:'CPU cores, device memory & platform randomized'},
    {name:'Screen Resolution',attempts:s.screen,desc:'Screen dimensions varied per session'},
    {name:'Timing Precision',attempts:0,desc:'performance.now() resolution reduced to 1ms'},
    {name:'FLUX Shield',attempts:shield.blockedCount,desc:'Zero-Connection Mode — tracker & background blocking'},
  ]
  const rows=protections.map(p=>`<div style="display:flex;align-items:center;justify-content:space-between;padding:14px 18px;margin-bottom:6px;background:rgba(12,8,20,0.6);border:1px solid rgba(140,60,255,0.2);border-left:3px solid ${C.accent2};border-radius:10px;"><div style="display:flex;flex-direction:column;gap:3px;"><span style="font-size:13px;font-weight:600;color:${C.text};">${p.name}</span><span style="font-size:11px;color:${C.muted};">${p.desc}</span></div><div style="display:flex;align-items:center;gap:10px;flex-shrink:0;margin-left:16px;">${p.attempts>0?`<span style="font-family:monospace;font-size:10px;color:${C.accent2};background:rgba(155,61,255,0.12);padding:2px 8px;border-radius:4px;">${p.attempts} attempts</span>`:''}<span style="font-size:10px;font-weight:700;padding:3px 10px;border-radius:6px;background:rgba(74,222,128,0.12);color:${C.green};border:1px solid rgba(74,222,128,0.3);">✓ Active</span></div></div>`).join('')
  const page=makePage('flux-privacy',tabId)
  page.innerHTML=`${pageHeader('🔐','FLUX Privacy · Fingerprint Guard','flux://privacy · Dynamic Fingerprint Randomization','New identity per page · Seed rotates every tab')}<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-bottom:36px;"><div style="padding:24px 20px;background:rgba(12,8,20,0.8);border:1px solid ${C.border};border-radius:14px;text-align:center;"><span style="font-size:42px;font-weight:800;color:${C.accent2};display:block;margin-bottom:8px;">${s.total}</span><span style="font-size:11px;color:${C.muted};letter-spacing:1.5px;text-transform:uppercase;">Fingerprint Attempts</span></div><div style="padding:24px 20px;background:rgba(12,8,20,0.8);border:1px solid ${C.border};border-radius:14px;text-align:center;"><span style="font-size:42px;font-weight:800;color:${C.accent};display:block;margin-bottom:8px;">${shield.blockedCount}</span><span style="font-size:11px;color:${C.muted};letter-spacing:1.5px;text-transform:uppercase;">Connections Blocked</span></div><div style="padding:24px 20px;background:rgba(12,8,20,0.8);border:1px solid ${C.border};border-radius:14px;text-align:center;"><span style="font-size:42px;font-weight:800;color:${C.green};display:block;margin-bottom:8px;">&#8734;</span><span style="font-size:11px;color:${C.muted};letter-spacing:1.5px;text-transform:uppercase;">Unique Identities</span></div></div><div style="font-size:10px;font-weight:700;letter-spacing:3px;color:${C.accent2};text-transform:uppercase;margin-bottom:12px;">Active Protections</div><div style="margin-bottom:32px;">${rows}</div><div style="display:flex;align-items:center;justify-content:space-between;padding-top:20px;border-top:1px solid ${C.border};font-size:11px;color:${C.muted};"><span>FLUX Browser — Zero Telemetry · Zero Tracking · Full Control</span><span id="fp-net-link-${tabId}" style="color:${C.accent};cursor:pointer;">→ Open Network Monitor</span></div>`
  tab.webview.classList.remove('active')
  if(tab.newTabScreen) tab.newTabScreen.classList.add('hidden')
  dom.webviewContainer.appendChild(page)
  document.getElementById(`fp-net-link-${tabId}`)?.addEventListener('click',()=>navigate('flux://network'))
}

function renderTrustPage(tabId) {
  const tab=getTab(tabId); if(!tab) return
  document.getElementById(`flux-trust-${tabId}`)?.remove()
  const currentDomain=trust.currentDomain
  const allEntries=Array.from(trust.store.entries()).sort((a,b)=>(b[1].requestCount||0)-(a[1].requestCount||0))
  const LEVEL_META={0:{label:'Strict',color:C.red,desc:'All fingerprint APIs blocked/anonymized'},1:{label:'Standard',color:C.yellow,desc:'APIs anonymized (default)'},2:{label:'Trusted',color:C.green,desc:'APIs allowed, only tracker blocking active'}}
  const APIS=['canvas','webgl','audio','navigator','screen']
  const PERM_META={'anonymize':{color:C.yellow,label:'Anonymize'},'allow':{color:C.green,label:'Allow'},'block':{color:C.red,label:'Block'}}
  function domainCard(domain,config,isCurrent){
    const level=config.level??1,meta=LEVEL_META[level]||LEVEL_META[1],perms=config.permissions||{},reqs=config.requestCount||0
    const permBadges=APIS.map(api=>{const p=perms[api]||'anonymize',pm=PERM_META[p];return `<span data-domain="${domain}" data-api="${api}" data-perm="${p}" style="font-size:9px;font-weight:700;padding:2px 7px;border-radius:4px;cursor:pointer;background:${pm.color}18;color:${pm.color};border:1px solid ${pm.color}44;">${api}:${pm.label}</span>`}).join('')
    const levelBtns=[0,1,2].map(l=>{const lm=LEVEL_META[l],active=l===level;return `<button data-domain="${domain}" data-level="${l}" style="font-size:10px;font-weight:700;padding:3px 10px;border-radius:6px;cursor:pointer;border:1px solid ${active?lm.color:C.border};background:${active?lm.color+'22':'transparent'};color:${active?lm.color:C.muted};">${lm.label}</button>`}).join('')
    return `<div style="padding:16px 18px;background:rgba(12,8,20,0.7);border:1px solid ${isCurrent?C.accent2+'55':C.border};border-left:3px solid ${meta.color};border-radius:10px;margin-bottom:8px;"><div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;"><div><span style="font-size:13px;font-weight:700;color:${C.text};">${isCurrent?'→ ':''}${domain}</span>${reqs>0?`<span style="font-size:10px;color:${C.accent2};background:${C.accent2}18;padding:1px 7px;border-radius:4px;margin-left:8px;">${reqs} FP requests</span>`:''}</div><div style="display:flex;gap:6px;align-items:center;">${levelBtns}<button data-domain="${domain}" data-action="reset" style="font-size:10px;padding:3px 8px;border-radius:6px;cursor:pointer;border:1px solid ${C.border};background:transparent;color:${C.muted};">Reset</button></div></div><div style="display:flex;flex-wrap:wrap;gap:5px;">${permBadges}</div></div>`
  }
  const cardsHTML=allEntries.length===0?`<div style="text-align:center;padding:60px 0;color:${C.muted};">No sites visited yet.</div>`:allEntries.map(([domain,config])=>domainCard(domain,config,domain===currentDomain)).join('')
  const page=makePage('flux-trust',tabId)
  page.innerHTML=`${pageHeader('🔒','FLUX Trust Network','flux://trust · Permissioned Internet Mode','Zero-Trust Model · Local only · Never transmitted')}<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:28px;">${[0,1,2].map(l=>{const lm=LEVEL_META[l];return `<div style="padding:14px;background:rgba(12,8,20,0.7);border:1px solid ${C.border};border-left:3px solid ${lm.color};border-radius:10px;"><div style="font-size:13px;font-weight:700;color:${lm.color};margin-bottom:4px;">${lm.label}</div><div style="font-size:11px;color:${C.muted};">${lm.desc}</div></div>`}).join('')}</div><div style="font-size:10px;font-weight:700;letter-spacing:3px;color:${C.accent2};text-transform:uppercase;margin-bottom:12px;">Site Permissions (${allEntries.length} sites)</div><div id="trust-cards-${tabId}">${cardsHTML}</div><div style="display:flex;align-items:center;justify-content:space-between;padding-top:20px;border-top:1px solid ${C.border};margin-top:8px;font-size:11px;color:${C.muted};"><span>FLUX Browser — Zero Telemetry · Zero Tracking · Full Control</span><span id="trust-link-privacy-${tabId}" style="color:${C.accent};cursor:pointer;">→ Open Privacy Monitor</span></div>`
  tab.webview.classList.remove('active')
  if(tab.newTabScreen) tab.newTabScreen.classList.add('hidden')
  dom.webviewContainer.appendChild(page)
  document.getElementById(`trust-link-privacy-${tabId}`)?.addEventListener('click',()=>navigate('flux://privacy'))
  const CYCLE=['anonymize','allow','block']
  page.querySelectorAll('button[data-level]').forEach(btn=>btn.addEventListener('click',()=>{const domain=btn.dataset.domain,level=parseInt(btn.dataset.level);window.trustAPI.set(domain,{level});trust.store.set(domain,{...(trust.store.get(domain)||{}),level});renderTrustPage(tabId)}))
  page.querySelectorAll('span[data-perm]').forEach(badge=>badge.addEventListener('click',()=>{const domain=badge.dataset.domain,api=badge.dataset.api,current=badge.dataset.perm,next=CYCLE[(CYCLE.indexOf(current)+1)%CYCLE.length],config=trust.store.get(domain)||{};window.trustAPI.set(domain,{permissions:{[api]:next}});trust.store.set(domain,{...config,permissions:{...(config.permissions||{}),[api]:next}});renderTrustPage(tabId)}))
  page.querySelectorAll('button[data-action="reset"]').forEach(btn=>btn.addEventListener('click',()=>{window.trustAPI.reset(btn.dataset.domain);trust.store.delete(btn.dataset.domain);renderTrustPage(tabId)}))
}

// ════════════════════════════════════════════════════════════
// flux://cookies – Cookie Manager
// ════════════════════════════════════════════════════════════
async function renderCookiePage(tabId) {
  const tab = getTab(tabId); if (!tab) return
  document.getElementById(`flux-cookies-${tabId}`)?.remove()
  const page = makePage('flux-cookies', tabId)

  const stats = await window.cookieAPI.getStats().catch(()=>({total:0,byDomain:{}}))
  const topDomains = Object.entries(stats.byDomain)
    .sort((a,b)=>b[1]-a[1])
    .slice(0, 40)

  const domainRows = topDomains.length === 0
    ? `<div style="text-align:center;padding:60px 0;color:${C.muted};">No cookies found.</div>`
    : topDomains.map(([domain, count]) => `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 18px;
                  background:rgba(12,8,20,0.6);border:1px solid ${C.border};border-radius:10px;margin-bottom:6px;">
        <div>
          <div style="font-size:13px;font-weight:600;color:${C.text};">${domain}</div>
          <div style="font-size:11px;color:${C.muted};margin-top:2px;">${count} cookie${count!==1?'s':''}</div>
        </div>
        <button data-domain="${domain}" class="cookie-purge-btn"
          style="font-size:11px;font-weight:700;padding:5px 12px;border-radius:7px;
                 background:rgba(255,60,60,0.12);border:1px solid rgba(255,60,60,0.3);
                 color:#ff6060;cursor:pointer;">
          Purge
        </button>
      </div>`).join('')

  page.innerHTML = `
    ${pageHeader('🍪','Cookie Manager','flux://cookies · Per-Site Cookie Control','Third-party blocking · One-click purge')}
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-bottom:28px;">
      <div style="padding:22px 18px;background:rgba(12,8,20,0.8);border:1px solid ${C.border};border-radius:14px;text-align:center;">
        <span style="font-size:38px;font-weight:800;color:${C.accent2};display:block;margin-bottom:6px;">${stats.total}</span>
        <span style="font-size:11px;color:${C.muted};letter-spacing:1.5px;text-transform:uppercase;">Total Cookies</span>
      </div>
      <div style="padding:22px 18px;background:rgba(12,8,20,0.8);border:1px solid ${C.border};border-radius:14px;text-align:center;">
        <span style="font-size:38px;font-weight:800;color:${C.accent};display:block;margin-bottom:6px;">${topDomains.length}</span>
        <span style="font-size:11px;color:${C.muted};letter-spacing:1.5px;text-transform:uppercase;">Sites Tracked</span>
      </div>
      <div style="padding:22px 18px;background:rgba(12,8,20,0.8);border:1px solid ${C.border};border-radius:14px;text-align:center;">
        <button id="cookie-purge-all-${tabId}"
          style="width:100%;height:100%;background:none;border:none;cursor:pointer;
                 font-size:13px;font-weight:700;color:#ff6060;letter-spacing:1px;">
          🗑️ PURGE ALL
        </button>
      </div>
    </div>
    <div style="font-size:10px;font-weight:700;letter-spacing:3px;color:${C.accent2};text-transform:uppercase;margin-bottom:12px;">
      Cookies by Site (${topDomains.length} sites)
    </div>
    <div id="cookie-list-${tabId}">${domainRows}</div>
    <div style="padding-top:20px;border-top:1px solid ${C.border};margin-top:8px;
                font-size:11px;color:${C.muted};display:flex;justify-content:space-between;align-items:center;">
      <span>FLUX Browser — Zero Telemetry · Zero Tracking · Full Control</span>
      <span id="cookie-settings-link-${tabId}" style="color:${C.accent};cursor:pointer;">→ Cookie Settings</span>
    </div>`

  tab.webview.classList.remove('active')
  if (tab.newTabScreen) tab.newTabScreen.classList.add('hidden')
  dom.webviewContainer.appendChild(page)

  document.getElementById(`cookie-purge-all-${tabId}`)?.addEventListener('click', async () => {
    if (!confirm('Delete all cookies from all sites?')) return
    await window.cookieAPI.purgeAll()
    renderCookiePage(tabId)
  })
  document.getElementById(`cookie-settings-link-${tabId}`)?.addEventListener('click', () => navigate('flux://settings'))
  page.querySelectorAll('.cookie-purge-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      await window.cookieAPI.purgeDomain(btn.dataset.domain)
      renderCookiePage(tabId)
    })
  })
}

// ════════════════════════════════════════════════════════════
// flux://privacymode – Privacy Mode v1.5 Hub
// ════════════════════════════════════════════════════════════
async function renderPrivacyModePage(tabId) {
  const tab = getTab(tabId); if (!tab) return
  document.getElementById(`flux-privacymode-${tabId}`)?.remove()
  const page = makePage('flux-privacymode', tabId)

  let ps = {}
  try { ps = await window.privacyAPI.getSettings() } catch {}

  // Load adblock stats if available
  let adblockStats = { totalDomains: 0, listStats: {}, isUpdating: false, lastUpdated: null }
  try { if (window.adblockAPI) adblockStats = await window.adblockAPI.getStats() } catch {}

  const fmtNum  = n => (n || 0).toLocaleString()
  const fmtDate = ts => ts ? new Date(ts).toLocaleDateString(undefined, { month:'short', day:'numeric', year:'numeric' }) : '—'

  function featureCard(icon, title, desc, id, active, extraHtml = '') {
    return `
    <div style="padding:20px 18px;background:rgba(12,8,20,0.85);
                border:1px solid ${active ? C.accent2+'55' : C.border};
                border-left:3px solid ${active ? C.accent2 : C.border};
                border-radius:14px;position:relative;display:flex;flex-direction:column;">
      <span style="position:absolute;top:14px;right:14px;width:8px;height:8px;border-radius:50%;
                   background:${active ? C.accent2 : 'rgba(140,60,255,0.2)'};
                   box-shadow:${active ? '0 0 8px ' + C.accent2 : 'none'};"></span>
      <div style="font-size:24px;margin-bottom:8px;">${icon}</div>
      <div style="font-size:13px;font-weight:700;color:${C.text};margin-bottom:5px;">${title}</div>
      <div style="font-size:11px;color:${C.muted};line-height:1.5;flex:1;margin-bottom:10px;">${desc}</div>
      ${extraHtml}
      <button id="pmf-${id}-${tabId}"
        style="font-size:11px;font-weight:700;padding:5px 14px;border-radius:7px;cursor:pointer;
               background:${active ? C.accent2 + '22' : 'transparent'};
               border:1px solid ${active ? C.accent2 : C.border};
               color:${active ? C.accent2 : C.muted};align-self:flex-start;margin-top:auto;">
        ${active ? '✓ Enabled' : 'Enable'}
      </button>
    </div>`
  }

  // Adblock extra: filter list stats + update button
  const updatingLabel = adblockStats.isUpdating
    ? `<span style="color:${C.accent2};font-size:10px;">↻ Updating…</span>`
    : `<button id="pmf-adblock-update-${tabId}" style="font-size:10px;padding:2px 8px;border-radius:5px;cursor:pointer;
        background:transparent;border:1px solid ${C.border};color:${C.muted};">↻ Update now</button>`
  const easylistStats    = adblockStats.listStats && adblockStats.listStats.easylist
  const easyprivacyStats = adblockStats.listStats && adblockStats.listStats.easyprivacy
  const adblockExtra = `
    <div style="background:rgba(155,61,255,0.06);border:1px solid ${C.accent2}22;border-radius:8px;
                padding:8px 10px;margin-bottom:10px;font-size:10px;color:${C.muted};">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
        <span style="color:${C.text};font-weight:600;">${fmtNum(adblockStats.totalDomains)} blocked domains</span>
        ${updatingLabel}
      </div>
      ${easylistStats ? `<div>EasyList: ${fmtNum(easylistStats.domains)} · ${fmtDate(easylistStats.updated)}</div>` : ''}
      ${easyprivacyStats ? `<div>EasyPrivacy: ${fmtNum(easyprivacyStats.domains)} · ${fmtDate(easyprivacyStats.updated)}</div>` : ''}
      ${!easylistStats && !easyprivacyStats ? `<div style="opacity:0.7;">Filter lists download on first launch…</div>` : ''}
    </div>`

  // Cookie extra: 3rd-party status
  const cookieExtra = `<div style="font-size:10px;color:${C.muted};margin-bottom:10px;">
    3rd-party cookies: <span style="color:${ps.blockThirdPartyCookies ? C.accent2 : C.muted};font-weight:600;">
      ${ps.blockThirdPartyCookies ? 'Blocked' : 'Allowed'}</span></div>`

  // DoH extra: resolver label
  const dohProviderNames = { cloudflare:'Cloudflare 1.1.1.1', quad9:'Quad9', google:'Google DNS', custom:'Custom' }
  const dohExtra = ps.dohEnabled ? `<div style="font-size:10px;color:${C.muted};margin-bottom:10px;">
    Resolver: <span style="color:${C.accent2};font-weight:600;">${dohProviderNames[ps.dohProvider] || ps.dohProvider}</span></div>` : ''

  // Clear-on-Exit extra: which data
  const coe = ps.clearOnExitData || {}
  const coeItems = ['cookies','cache','history','localStorage'].filter(k => coe[k] !== false)
  const coeExtra = ps.clearOnExit ? `<div style="font-size:10px;color:${C.muted};margin-bottom:10px;">
    Clears: <span style="color:${C.accent2};font-weight:600;">${coeItems.join(', ') || 'nothing'}</span></div>` : ''

  const features = [
    { icon:'🫂',  title:'Private / Incognito Tabs',      desc:'Separate partition with no history, no cookies, no cache after close.',                  id:'ephemeral',  active:true,                   extra:'',           action:()=>navigate('flux://settings') },
    { icon:'🛡️', title:'Built-in Ad & Tracker Blocker',  desc:'EasyList + EasyPrivacy rule sets baked in, auto-updated every 7 days.',                  id:'shield',     active:shield.enabled,         extra:adblockExtra, action:()=>{ shield.enabled=!shield.enabled; window.shieldAPI.toggle(shield.enabled); updateShieldButton(); renderPrivacyModePage(tabId) } },
    { icon:'🍪',  title:'Cookie Manager',                 desc:'Per-site cookie control, third-party blocking toggle, one-click purge.',                  id:'cookies',    active:ps.blockThirdPartyCookies, extra:cookieExtra,action:()=>navigate('flux://cookies') },
    { icon:'🌐',  title:'DNS-over-HTTPS',                 desc:'Configurable DoH resolver (Cloudflare, Quad9, custom endpoint).',                         id:'doh',        active:ps.dohEnabled,           extra:dohExtra,    action:()=>{ window.privacyAPI.setSettings({dohEnabled:!ps.dohEnabled}); setTimeout(()=>renderPrivacyModePage(tabId),100) } },
    { icon:'🔒',  title:'HTTPS-Only Mode',                desc:'Automatic upgrade of HTTP requests, warning for non-upgradeable sites.',                   id:'https',      active:ps.httpsOnly,            extra:'',          action:()=>{ window.privacyAPI.setSettings({httpsOnly:!ps.httpsOnly}); setTimeout(()=>renderPrivacyModePage(tabId),100) } },
    { icon:'🧹',  title:'Clear-on-Exit',                  desc:'Configurable data wipe: cookies, cache, history, localStorage on quit.',                  id:'clearexit',  active:ps.clearOnExit,          extra:coeExtra,    action:()=>{ window.privacyAPI.setSettings({clearOnExit:!ps.clearOnExit}); setTimeout(()=>renderPrivacyModePage(tabId),100) } },
  ]

  const activeCount = features.filter(f => f.active).length

  page.innerHTML = `
    ${pageHeader('🔏','Privacy Mode','flux://privacymode · v1.5 Privacy Suite','Zero Telemetry · Zero Tracking · Full Control')}
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:18px;">
      <div style="font-size:11px;color:${C.muted};">
        <span style="color:${C.accent2};font-weight:700;">${activeCount}</span> of ${features.length} features active
      </div>
      <div style="flex:1;height:3px;background:${C.border};border-radius:2px;overflow:hidden;">
        <div style="height:100%;width:${Math.round(activeCount/features.length*100)}%;
                    background:linear-gradient(90deg,${C.accent2},${C.accent});border-radius:2px;"></div>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-bottom:28px;">
      ${features.map(f => featureCard(f.icon, f.title, f.desc, f.id, f.active, f.extra)).join('')}
    </div>
    <div style="padding:16px 20px;background:rgba(155,61,255,0.06);border:1px solid ${C.accent2}33;border-radius:14px;
                display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
      <div>
        <div style="font-size:13px;font-weight:700;color:${C.accent2};margin-bottom:3px;">v1.5 · Privacy Mode</div>
        <div style="font-size:11px;color:${C.muted};">All features in one place. Advanced options available in ⚙️ Settings.</div>
      </div>
      <button id="pmf-settings-${tabId}"
        style="font-size:12px;font-weight:700;padding:8px 18px;border-radius:8px;cursor:pointer;
               background:${C.accent2}22;border:1px solid ${C.accent2};color:${C.accent2};white-space:nowrap;">
        ⚙️ Settings
      </button>
    </div>`

  tab.webview.classList.remove('active')
  if (tab.newTabScreen) tab.newTabScreen.classList.add('hidden')
  dom.webviewContainer.appendChild(page)

  features.forEach(f => {
    document.getElementById(`pmf-${f.id}-${tabId}`)?.addEventListener('click', f.action)
  })
  document.getElementById(`pmf-settings-${tabId}`)?.addEventListener('click', ()=>navigate('flux://settings'))
  document.getElementById(`pmf-adblock-update-${tabId}`)?.addEventListener('click', () => {
    if (window.adblockAPI) { window.adblockAPI.updateNow(); setTimeout(()=>renderPrivacyModePage(tabId), 200) }
  })
  if (window.adblockAPI) {
    window.adblockAPI.onStatus(stats => {
      if (!stats.isUpdating) { const at=getActiveTab(); if(at?.isPrivacyModePage) renderPrivacyModePage(at.id) }
    })
  }
}
// ════════════════════════════════════════════════════════════
// RESOURCE MONITOR SIDEBAR
// ════════════════════════════════════════════════════════════
let resourceMetrics = {}
let resourceSidebarOpen = false

function toggleResourceSidebar() {
  resourceSidebarOpen = !resourceSidebarOpen
  const sidebar = document.getElementById('resource-sidebar')
  const btn     = document.getElementById('btn-resource-monitor')
  if (resourceSidebarOpen) {
    sidebar.classList.remove('hidden')
    btn?.classList.add('res-active')
    updateResourceSidebar()
  } else {
    sidebar.classList.add('hidden')
    btn?.classList.remove('res-active')
  }
}

function updateResourceSidebar() {
  if (!resourceSidebarOpen) return
  const body = document.getElementById('resource-sidebar-body')
  if (!body) return

  if (state.tabs.length === 0) {
    body.innerHTML = `<div style="padding:20px 14px;font-size:11px;color:rgba(210,180,255,0.35);">No tabs open.</div>`
    return
  }

  // Total browser memory from all tracked tabs
  const totalMem = Object.values(resourceMetrics).reduce((s, m) => s + (m.mem || 0), 0)

  body.innerHTML = [
    // Header row: total
    `<div style="padding:10px 14px 8px;border-bottom:1px solid rgba(140,60,255,0.15);display:flex;justify-content:space-between;align-items:center;">
      <span style="font-size:9px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:rgba(210,180,255,0.4);">ALL TABS</span>
      <span style="font-size:10px;color:#5ce0ff;font-family:'JetBrains Mono',monospace;">${totalMem} MB total</span>
    </div>`,
    ...state.tabs.map(tab => {
      const m       = resourceMetrics[tab.id]
      const isActive = tab.id === state.activeTabId
      const title   = tab.tabEl.querySelector('.tab-title')?.textContent || 'Tab'
      const cpu     = m?.cpu ?? null
      const mem     = m?.mem ?? null
      const cpuColor = cpu === null ? 'rgba(210,180,255,0.3)' : cpu > 25 ? '#f87171' : cpu > 8 ? '#facc15' : '#4ade80'
      const cpuPct   = cpu === null ? 0 : Math.min(cpu * 2, 100)     // 50 % CPU → full bar
      const memPct   = mem === null ? 0 : Math.min(mem / 4, 100)     // 400 MB → full bar

      return `<div style="padding:10px 14px;border-bottom:1px solid rgba(140,60,255,0.1);">
        <div style="display:flex;align-items:center;gap:5px;margin-bottom:7px;">
          ${tab.isEphemeral ? '<span style="font-size:9px;line-height:1;">👻</span>' : ''}
          <span style="font-size:11px;font-weight:${isActive?'700':'400'};
                color:${isActive?'#5ce0ff':'rgba(210,180,255,0.65)'};
                white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:196px;"
                title="${title}">${isActive ? '▸ ' : ''}${title}</span>
        </div>
        <div style="margin-bottom:5px;">
          <div style="display:flex;justify-content:space-between;margin-bottom:3px;">
            <span style="font-size:9px;color:rgba(210,180,255,0.35);letter-spacing:1px;text-transform:uppercase;">CPU</span>
            <span style="font-size:9px;font-family:'JetBrains Mono',monospace;color:${cpuColor};">${cpu !== null ? cpu.toFixed(1)+'%' : '—'}</span>
          </div>
          <div style="height:3px;background:rgba(140,60,255,0.12);border-radius:2px;overflow:hidden;">
            <div style="height:3px;width:${cpuPct}%;background:${cpuColor};border-radius:2px;transition:width 0.5s ease;"></div>
          </div>
        </div>
        <div>
          <div style="display:flex;justify-content:space-between;margin-bottom:3px;">
            <span style="font-size:9px;color:rgba(210,180,255,0.35);letter-spacing:1px;text-transform:uppercase;">RAM</span>
            <span style="font-size:9px;font-family:'JetBrains Mono',monospace;color:#5ce0ff;">${mem !== null ? mem+' MB' : '—'}</span>
          </div>
          <div style="height:3px;background:rgba(140,60,255,0.12);border-radius:2px;overflow:hidden;">
            <div style="height:3px;width:${memPct}%;background:linear-gradient(90deg,#9b3dff,#5ce0ff);border-radius:2px;transition:width 0.5s ease;"></div>
          </div>
        </div>
      </div>`
    }),
  ].join('')
}

window.resourceAPI.onMetrics(metrics => {
  resourceMetrics = metrics
  updateResourceSidebar()
})

document.getElementById('btn-resource-monitor')?.addEventListener('click', toggleResourceSidebar)
document.getElementById('resource-sidebar-close')?.addEventListener('click', toggleResourceSidebar)

// ════════════════════════════════════════════════════════════
// CHROME WEB STORE BANNER
// ════════════════════════════════════════════════════════════
let _webstorePendingExtId = null

function showWebStoreBanner(extName, extId) {
  _webstorePendingExtId = extId
  const banner = document.getElementById('webstore-banner')
  if (!banner) return
  const nameEl = document.getElementById('webstore-banner-name')
  if (nameEl) nameEl.textContent = decodeURIComponent(extName).replace(/-/g, ' ')
  banner.classList.remove('hidden')
}

function hideWebStoreBanner() {
  document.getElementById('webstore-banner')?.classList.add('hidden')
  _webstorePendingExtId = null
}

document.getElementById('webstore-banner-dismiss')?.addEventListener('click', hideWebStoreBanner)

document.getElementById('webstore-banner-install')?.addEventListener('click', async () => {
  if (!_webstorePendingExtId) return
  const extId = _webstorePendingExtId
  hideWebStoreBanner()
  // Show a loading toast
  const toast = document.createElement('div')
  toast.id = 'ext-install-toast'
  toast.style.cssText = 'position:fixed;bottom:40px;left:50%;transform:translateX(-50%);background:rgba(12,8,20,0.97);border:1px solid rgba(155,61,255,0.4);border-radius:8px;padding:10px 20px;font-size:12px;color:#9b3dff;z-index:99999;white-space:nowrap;font-family:"Exo 2",sans-serif;'
  toast.textContent = '🧩 Downloading extension…'
  document.body.appendChild(toast)

  window.extensionAPI.onInstallProgress(({ step }) => {
    const labels = { downloading: '⬇️ Downloading…', extracting: '📦 Extracting…', loading: '⚡ Loading…' }
    toast.textContent = labels[step] || step
  })

  try {
    const entry = await window.extensionAPI.installFromWebStore(extId)
    toast.style.borderColor = 'rgba(74,222,128,0.4)'
    toast.style.color = '#4ade80'
    toast.textContent = `✓ "${entry.name}" installed — restart recommended`
    setTimeout(() => toast.remove(), 3500)
  } catch (e) {
    toast.style.borderColor = 'rgba(248,113,113,0.4)'
    toast.style.color = '#f87171'
    toast.textContent = `✕ Install failed: ${e.message}`
    setTimeout(() => toast.remove(), 5000)
  }
})

// ════════════════════════════════════════════════════════════
// flux://extensions
// ════════════════════════════════════════════════════════════
function renderExtensionsPage(tabId) {
  const tab = getTab(tabId)
  if (!tab) return
  document.getElementById(`flux-extensions-${tabId}`)?.remove()

  const page = makePage('flux-extensions', tabId)

  function renderExtList(exts) {
    if (!exts || exts.length === 0) {
      return `<div style="text-align:center;padding:60px 0;color:${C.muted};font-size:13px;">
        No extensions installed yet.<br>
        <span style="font-size:11px;">Load an unpacked folder, a .crx file, or paste a Chrome Web Store URL.</span>
      </div>`
    }
    return exts.map(ext => {
      const srcLabel  = ext.source === 'webstore' ? '🌐 Web Store' : ext.source === 'crx' ? '📦 .crx' : '📁 Unpacked'
      const srcColor  = ext.source === 'webstore' ? C.accent2 : C.accent
      return `<div style="display:flex;align-items:flex-start;gap:14px;padding:16px 18px;
          background:rgba(12,8,20,0.7);border:1px solid ${ext.error ? C.red+'33' : C.border};
          border-radius:12px;margin-bottom:8px;transition:border-color 0.15s;">
        <div style="width:38px;height:38px;background:rgba(155,61,255,0.12);border-radius:9px;
            display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0;">🧩</div>
        <div style="flex:1;min-width:0;">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:3px;">
            <span style="font-size:13px;font-weight:700;color:${C.text};">${ext.name}</span>
            <span style="font-size:10px;color:${C.muted};">v${ext.version}</span>
            <span style="font-size:9px;font-weight:700;padding:1px 7px;border-radius:4px;
                background:${srcColor}18;color:${srcColor};border:1px solid ${srcColor}33;">${srcLabel}</span>
          </div>
          ${ext.description ? `<div style="font-size:11px;color:${C.muted};margin-bottom:4px;line-height:1.5;">${ext.description}</div>` : ''}
          ${ext.error
            ? `<div style="font-size:10px;color:${C.red};margin-top:2px;">⚠ ${ext.error}</div>`
            : `<div style="font-size:10px;color:${C.green};margin-top:2px;">✓ Active — ID: <span style="font-family:monospace;opacity:0.7;">${ext.id}</span></div>`}
        </div>
        <button data-ext-id="${ext.id}" data-ext-name="${ext.name}" class="ext-remove-btn"
          style="background:transparent;border:1px solid ${C.border};color:${C.red};
                 border-radius:6px;padding:5px 12px;font-size:10px;font-weight:700;cursor:pointer;flex-shrink:0;
                 transition:background 0.15s,border-color 0.15s;">
          Remove
        </button>
      </div>`
    }).join('')
  }

  page.innerHTML = `
    ${pageHeader('🧩','Extensions','flux://extensions · Chrome Extension Support','')}
    <div style="display:flex;gap:10px;margin-bottom:20px;flex-wrap:wrap;">
      <button id="ext-load-unpacked-${tabId}"
        style="padding:9px 16px;background:${C.accent2}1a;border:1px solid ${C.accent2}44;
               border-radius:8px;color:${C.accent2};font-size:12px;font-weight:700;cursor:pointer;display:flex;align-items:center;gap:6px;">
        📁 Load Unpacked
      </button>
      <button id="ext-load-crx-${tabId}"
        style="padding:9px 16px;background:${C.accent}1a;border:1px solid ${C.accent}44;
               border-radius:8px;color:${C.accent};font-size:12px;font-weight:700;cursor:pointer;display:flex;align-items:center;gap:6px;">
        📦 Load .crx File
      </button>
      <button id="ext-webstore-${tabId}"
        style="padding:9px 16px;background:rgba(74,222,128,0.1);border:1px solid rgba(74,222,128,0.3);
               border-radius:8px;color:${C.green};font-size:12px;font-weight:700;cursor:pointer;display:flex;align-items:center;gap:6px;">
        🌐 Web Store URL / ID
      </button>
    </div>
    <div style="padding:11px 16px;background:rgba(155,61,255,0.05);border:1px solid ${C.accent2}1a;
                border-radius:10px;margin-bottom:22px;font-size:11px;color:${C.muted};line-height:1.65;">
      <strong style="color:${C.text};">ℹ Compatibility:</strong>
      Content scripts, background pages and network rules work well in FLUX.
      Browser-action toolbars and Manifest V3 service workers have limited support.
      A browser restart is required after installing new extensions.
    </div>
    <div id="ext-list-${tabId}"><div style="padding:20px;color:${C.muted};font-size:12px;">Loading…</div></div>`

  tab.webview.classList.remove('active')
  if (tab.newTabScreen) tab.newTabScreen.classList.add('hidden')
  dom.webviewContainer.appendChild(page)

  async function refreshList() {
    const exts  = await window.extensionAPI.list().catch(() => [])
    const listEl = document.getElementById(`ext-list-${tabId}`)
    if (!listEl) return
    listEl.innerHTML = renderExtList(exts)
    listEl.querySelectorAll('.ext-remove-btn').forEach(btn => {
      btn.addEventListener('mouseenter', () => { btn.style.background = C.red + '18'; btn.style.borderColor = C.red + '55' })
      btn.addEventListener('mouseleave', () => { btn.style.background = 'transparent'; btn.style.borderColor = C.border })
      btn.addEventListener('click', async () => {
        if (!confirm(`Remove extension "${btn.dataset.extName}"?\nThe extension folder will be deleted.`)) return
        try {
          await window.extensionAPI.remove(btn.dataset.extId)
          await refreshList()
        } catch (e) { alert('Error: ' + e.message) }
      })
    })
  }

  document.getElementById(`ext-load-unpacked-${tabId}`)?.addEventListener('click', async () => {
    try {
      const entry = await window.extensionAPI.installUnpacked()
      if (entry) { await refreshList(); _showExtToast(`"${entry.name}" installed`) }
    } catch (e) { alert('Error: ' + e.message) }
  })

  document.getElementById(`ext-load-crx-${tabId}`)?.addEventListener('click', async () => {
    try {
      const entry = await window.extensionAPI.installCrx()
      if (entry) { await refreshList(); _showExtToast(`"${entry.name}" installed`) }
    } catch (e) { alert('Error: ' + e.message) }
  })

  document.getElementById(`ext-webstore-${tabId}`)?.addEventListener('click', async () => {
    const input = prompt(
      'Paste a Chrome Web Store URL or 32-char extension ID:\n\n' +
      'Example URL: https://chrome.google.com/webstore/detail/ublock-origin/cjpalhdlnbpafiamejdnhcphjbkeiagm\n' +
      'Example ID:  cjpalhdlnbpafiamejdnhcphjbkeiagm'
    )
    if (!input) return
    const match = input.match(/\/([a-z]{32})(?:[/?#]|$)/) || [null, input.match(/^[a-z]{32}$/) ? input : null]
    const extId = match[1]
    if (!extId) { alert('Could not find a valid extension ID in that input.\nExpected a 32-character lowercase string.'); return }
    const toast = _showExtToast('⬇️ Downloading from Web Store…', 60000)
    window.extensionAPI.onInstallProgress(({ step }) => {
      const labels = { downloading: '⬇️ Downloading…', extracting: '📦 Extracting…', loading: '⚡ Loading into session…' }
      toast.textContent = labels[step] || step
    })
    try {
      const entry = await window.extensionAPI.installFromWebStore(extId)
      toast.remove()
      await refreshList()
      _showExtToast(`✓ "${entry.name}" installed — restart recommended`)
    } catch (e) {
      toast.remove()
      alert('Install failed: ' + e.message)
    }
  })

  // Live-update when another tab triggers a list change
  window.extensionAPI.onListUpdated(async () => {
    if (getActiveTab()?.isExtensionsPage) await refreshList()
  })

  refreshList()
}

function _showExtToast(msg, duration = 3500) {
  const t = document.createElement('div')
  t.style.cssText = `position:fixed;bottom:40px;left:50%;transform:translateX(-50%);
    background:rgba(12,8,20,0.97);border:1px solid rgba(155,61,255,0.4);border-radius:8px;
    padding:10px 20px;font-size:12px;color:#9b3dff;z-index:99999;white-space:nowrap;
    animation:tab-appear 0.2s ease;font-family:'Exo 2',sans-serif;`
  t.textContent = msg
  document.body.appendChild(t)
  if (duration < 60000) setTimeout(() => t.remove(), duration)
  return t
}

dom.urlInput.addEventListener('keydown', (e) => {
  if (e.key==='Enter') navigate(dom.urlInput.value)
  else if (e.key==='Escape') {
    const tab=getActiveTab(); if(tab){const url=tab.webview.getURL();dom.urlInput.value=url==='about:blank'?'':url}
    dom.urlInput.blur()
  }
})
dom.urlInput.addEventListener('focus', ()=>dom.urlInput.select())
dom.btnBack.addEventListener('click',    ()=>getActiveTab()?.webview.goBack())
dom.btnForward.addEventListener('click', ()=>getActiveTab()?.webview.goForward())
dom.btnReload.addEventListener('click',  ()=>{const t=getActiveTab();if(!t)return;t.webview.isLoading()?t.webview.stop():t.webview.reload()})
dom.btnHome.addEventListener('click', ()=>navigate(CONFIG.HOME_URL))
dom.btnNewTab.addEventListener('click',       ()=>createTab())
dom.btnNewEphemeral?.addEventListener('click',()=>createTab(null,{ephemeral:true}))
dom.btnSettings?.addEventListener('click',    ()=>navigate('flux://settings'))
dom.btnDownloads?.addEventListener('click',   ()=>navigate('flux://downloads'))
document.getElementById('btn-extensions')?.addEventListener('click', () => navigate('flux://extensions'))
dom.btnMinimize.addEventListener('click', ()=>window.windowAPI.minimize())
dom.btnMaximize.addEventListener('click', ()=>window.windowAPI.maximize())
dom.btnClose.addEventListener('click',    ()=>window.windowAPI.close())
dom.trustBadge?.addEventListener('click', ()=>navigate('flux://trust'))

dom.btnShield?.addEventListener('click', (e) => {
  if (e.ctrlKey) { navigate('flux://network'); return }
  shield.enabled=!shield.enabled; window.shieldAPI.toggle(shield.enabled); updateShieldButton(); pulseShield()
})
dom.btnShield?.addEventListener('contextmenu',(e)=>{e.preventDefault();navigate('flux://network')})

// ════════════════════════════════════════════════════════════
// KEYBOARD SHORTCUTS
// ════════════════════════════════════════════════════════════
document.addEventListener('keydown', (e) => {
  const ctrl=e.ctrlKey, shift=e.shiftKey, key=e.key

  if (ctrl && !shift && key==='t')           { e.preventDefault(); createTab() }
  if (ctrl && shift && key==='T')            { e.preventDefault(); createTab(null,{ephemeral:true}) }
  if (ctrl && key==='w')                     { e.preventDefault(); closeTab(state.activeTabId) }
  if (ctrl && key==='l')                     { e.preventDefault(); dom.urlInput.focus(); dom.urlInput.select() }
  if (ctrl && key==='d')                     { e.preventDefault(); toggleBookmark() }
  if (ctrl && shift && key==='B')            { e.preventDefault(); dom.bookmarkBar.classList.toggle('hidden'); renderBookmarkBar() }
  if (ctrl && key==='h')                     { e.preventDefault(); navigate('flux://history') }
  if (ctrl && key==='f')                     { e.preventDefault(); openFind() }
  if (ctrl && key==='j')                     { e.preventDefault(); navigate('flux://downloads') }
  if (ctrl && shift && key==='E')            { e.preventDefault(); navigate('flux://extensions') }
  if (ctrl && shift && key==='M')            { e.preventDefault(); toggleResourceSidebar() }
  if (key==='F5' || (ctrl && key==='r'))     { e.preventDefault(); getActiveTab()?.webview.reload() }
  if (key==='F1')                            { e.preventDefault(); dom.shortcutOverlay.classList.contains('hidden')?showShortcutOverlay():hideShortcutOverlay() }
  if (key==='Escape' && !dom.shortcutOverlay.classList.contains('hidden')) hideShortcutOverlay()
  if (e.altKey && key==='ArrowLeft')         getActiveTab()?.webview.goBack()
  if (e.altKey && key==='ArrowRight')        getActiveTab()?.webview.goForward()
  if (ctrl && key>='1' && key<='9') {
    const index=parseInt(key)-1
    if (state.tabs[index]) activateTab(state.tabs[index].id)
  }
})

// ════════════════════════════════════════════════════════════
// SHIELD IPC
// ════════════════════════════════════════════════════════════
window.shieldAPI.onLogUpdate((log) => {
  shield.log = log
  const newBlocked = log.filter(e=>e.type!=='allowed').length
  if (newBlocked>shield.blockedCount) pulseShield()
  shield.blockedCount = newBlocked
  updateShieldButton()
  const activeTab=getActiveTab()
  if (activeTab?.isNetworkPage) renderNetworkPage(activeTab.id)
})
window.shieldAPI.onStatusChanged((enabled) => { shield.enabled=enabled; updateShieldButton() })
window.trustAPI.onUpdate((domain,config) => {
  trust.store.set(domain,config)
  if (domain===trust.currentDomain) updateTrustBadge(domain,config)
  const at=getActiveTab(); if(at?.isTrustPage) renderTrustPage(at.id)
})
window.fingerprintAPI.onStatsUpdate((stats) => {
  fp.stats=stats
  const at=getActiveTab(); if(at?.isPrivacyPage) renderPrivacyPage(at.id)
})

// ════════════════════════════════════════════════════════════
// INIT
// ════════════════════════════════════════════════════════════
applySettings()
createTab(null)

updateTrustBadge(null,null)

window.fingerprintAPI.getPreloadPath().then(p => { fp.preloadPath = p })
window.fingerprintAPI.getStats().then(stats => { fp.stats = stats })
window.shieldAPI.getStatus().then(({enabled,log}) => {
  shield.enabled=enabled; shield.log=log
  shield.blockedCount=log.filter(e=>e.type!=='allowed').length
  updateShieldButton()
})

window.windowAPI.onWindowState((s) => {
  const icon=dom.btnMaximize.querySelector('svg')
  if (s==='maximized') icon.innerHTML=`<path d="M4 2h6v6H4zM2 4h2v6h6v2H2z" stroke="currentColor" stroke-width="1" fill="none"/>`
  else icon.innerHTML=`<rect x="2" y="2" width="8" height="8" stroke="currentColor" stroke-width="1.5" fill="none"/>`
})
