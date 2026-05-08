// ============================================================
// preload.js – Secure Bridge between Main and Renderer
// ============================================================

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('windowAPI', {
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close:    () => ipcRenderer.send('window-close'),

  onWindowState: (callback) => {
    ipcRenderer.removeAllListeners('window-state')
    ipcRenderer.on('window-state', (_, state) => callback(state))
  }
})

// ── Update API ────────────────────────────────────────────
contextBridge.exposeInMainWorld('updateAPI', {
  // Beim Start: prüfen ob Update vorhanden (kann null sein)
  getInfo: () => ipcRenderer.invoke('update-get-info'),
  // Release-Seite im System-Browser öffnen
  openRelease: () => ipcRenderer.send('update-open-release'),
  // Live-Event wenn Update erkannt wird (nach dem 3s-Delay)
  onAvailable: (cb) => {
    ipcRenderer.removeAllListeners('update-available')
    ipcRenderer.on('update-available', (_, info) => cb(info))
  },
})

// ── FLUX Trust Network API ───────────────────────────────
contextBridge.exposeInMainWorld('trustAPI', {
  // Trust-Config für Domain abrufen
  get:      (domain)         => ipcRenderer.invoke('trust-get', domain),
  // Trust-Config setzen { level?, permissions?: { canvas?, webgl?, ... } }
  set:      (domain, config) => ipcRenderer.send('trust-set', domain, config),
  // Alle bekannten Domains abrufen
  getAll:   ()               => ipcRenderer.invoke('trust-get-all'),
  // Domain zurücksetzen
  reset:    (domain)         => ipcRenderer.send('trust-reset', domain),
  // Fingerprint-API-Versuch melden (aus Webview via ipc-message)
  reportFP: (domain, type)   => ipcRenderer.send('trust-fp-request', domain, type),
  // Updates empfangen wenn Trust sich ändert
  onUpdate: (cb) => {
    ipcRenderer.removeAllListeners('trust-updated')
    ipcRenderer.on('trust-updated', (_, domain, config) => cb(domain, config))
  },
})

// ── Ephemeral Tab API ─────────────────────────────────────
contextBridge.exposeInMainWorld('ephemeralAPI', {
  // Partition-Daten löschen wenn Tab geschlossen wird
  clear: (partitionName) => ipcRenderer.invoke('ephemeral-clear', partitionName),
})

// ── FLUX Fingerprint API ──────────────────────────────────
contextBridge.exposeInMainWorld('fingerprintAPI', {
  // Preload-Pfad für Webviews holen
  getPreloadPath: () => ipcRenderer.invoke('fp-get-preload-path'),

  // Aktuelle Stats abrufen
  getStats: () => ipcRenderer.invoke('fp-get-stats'),

  // Einen Fingerprint-Versuch melden
  reportAttempt: (type) => ipcRenderer.send('fp-attempt', type),

  // Live-Updates empfangen
  onStatsUpdate: (callback) => {
    ipcRenderer.removeAllListeners('fp-stats-update')
    ipcRenderer.on('fp-stats-update', (_, stats) => callback(stats))
  },
})

// ── FLUX Shield API ───────────────────────────────────────
contextBridge.exposeInMainWorld('shieldAPI', {

  // Aktuellen Status + Log abrufen
  getStatus: () => ipcRenderer.invoke('shield-get-status'),

  // Shield ein-/ausschalten
  toggle: (enable) => ipcRenderer.send('shield-toggle', enable),

  // Live-Updates empfangen wenn neue Verbindungen geloggt werden
  onLogUpdate: (callback) => {
    ipcRenderer.removeAllListeners('shield-log-update')
    ipcRenderer.on('shield-log-update', (_, log) => callback(log))
  },

  // Shield-Status-Änderungen empfangen (z.B. wenn ein anderes Fenster umschaltet)
  onStatusChanged: (callback) => {
    ipcRenderer.removeAllListeners('shield-status-changed')
    ipcRenderer.on('shield-status-changed', (_, enabled) => callback(enabled))
  }
})

// ── Network Transparency API ──────────────────────────────
contextBridge.exposeInMainWorld('networkTransparencyAPI', {
  // Get full request history with stats
  getHistory: () => ipcRenderer.invoke('network-transparency-get-history'),

  // Get paginated history
  getPage: (offset, limit) => ipcRenderer.invoke('network-transparency-get-page', offset, limit),

  // Get statistics only
  getStats: () => ipcRenderer.invoke('network-transparency-get-stats'),

  // Clear all history
  clear: () => ipcRenderer.invoke('network-transparency-clear'),

  // Get list of tracker domains
  getTrackers: () => ipcRenderer.invoke('network-transparency-get-trackers'),

  // Add custom tracker domain
  addTracker: (domain) => ipcRenderer.invoke('network-transparency-add-tracker', domain),

  // Real-time event streaming
  onEvent: (callback) => {
    ipcRenderer.removeAllListeners('network-transparency-event')
    ipcRenderer.on('network-transparency-event', (_, data) => callback(data))
  },
})

// ── Bookmarks API ─────────────────────────────────────────
contextBridge.exposeInMainWorld('bookmarksAPI', {
  getAll:        ()                  => ipcRenderer.invoke('bookmarks-get-all'),
  getTree:       ()                  => ipcRenderer.invoke('bookmarks-get-tree'),
  getByParent:   (parentId)          => ipcRenderer.invoke('bookmarks-get-by-parent', parentId),
  getById:       (id)                => ipcRenderer.invoke('bookmarks-get-by-id', id),
  search:        (query)             => ipcRenderer.invoke('bookmarks-search', query),
  isBookmarked:  (url)               => ipcRenderer.invoke('bookmarks-is-bookmarked', url),

  add:           (data)              => ipcRenderer.invoke('bookmarks-add', data),
  addFolder:     (data)              => ipcRenderer.invoke('bookmarks-add-folder', data),
  update:        (id, changes)       => ipcRenderer.invoke('bookmarks-update', id, changes),
  remove:        (id)                => ipcRenderer.invoke('bookmarks-remove', id),
  move:          (id, newParentId)   => ipcRenderer.invoke('bookmarks-move', id, newParentId),

  export:        ()                  => ipcRenderer.invoke('bookmarks-export'),
  import:        (jsonString)        => ipcRenderer.invoke('bookmarks-import', jsonString),

  onUpdated: (callback) => {
    ipcRenderer.removeAllListeners('bookmarks-updated')
    ipcRenderer.on('bookmarks-updated', () => callback())
  },
})

// ── History API ───────────────────────────────────────────
contextBridge.exposeInMainWorld('historyAPI', {
  add:           (data)              => ipcRenderer.invoke('history-add', data),
  getAll:        ()                  => ipcRenderer.invoke('history-get-all'),
  getRecent:     (limit)             => ipcRenderer.invoke('history-get-recent', limit),
  getGrouped:    (limit)             => ipcRenderer.invoke('history-get-grouped', limit),
  search:        (query)             => ipcRenderer.invoke('history-search', query),
  getStats:      ()                  => ipcRenderer.invoke('history-get-stats'),

  remove:        (id)                => ipcRenderer.invoke('history-remove', id),
  clearAll:      ()                  => ipcRenderer.invoke('history-clear-all'),
  clearByDate:   (dateKey)           => ipcRenderer.invoke('history-clear-by-date', dateKey),
  clearRange:    (start, end)        => ipcRenderer.invoke('history-clear-range', start, end),
  clearOlderThan:(timestamp)         => ipcRenderer.invoke('history-clear-older-than', timestamp),

  onUpdated: (callback) => {
    ipcRenderer.removeAllListeners('history-updated')
    ipcRenderer.on('history-updated', () => callback())
  },
})

// ── Settings API ──────────────────────────────────────────
contextBridge.exposeInMainWorld('settingsAPI', {
  getAll:          ()                => ipcRenderer.invoke('settings-get-all'),
  get:             (key)             => ipcRenderer.invoke('settings-get', key),
  set:             (key, value)      => ipcRenderer.invoke('settings-set', key, value),
  setMultiple:     (changes)         => ipcRenderer.invoke('settings-set-multiple', changes),
  resetAll:        ()                => ipcRenderer.invoke('settings-reset-all'),
  resetKey:        (key)             => ipcRenderer.invoke('settings-reset-key', key),
  getDefaults:     ()                => ipcRenderer.invoke('settings-get-defaults'),
  getSearchEngines:()                => ipcRenderer.invoke('settings-get-search-engines'),
  getSearchUrl:    (query)           => ipcRenderer.invoke('settings-get-search-url', query),

  onUpdated: (callback) => {
    ipcRenderer.removeAllListeners('settings-updated')
    ipcRenderer.on('settings-updated', (_, key, value) => callback(key, value))
  },
})

// ── Downloads API ─────────────────────────────────────────
contextBridge.exposeInMainWorld('downloadsAPI', {
  getAll:        ()                  => ipcRenderer.invoke('downloads-get-all'),
  getRecent:     (limit)             => ipcRenderer.invoke('downloads-get-recent', limit),
  getById:       (id)                => ipcRenderer.invoke('downloads-get-by-id', id),
  getActive:     ()                  => ipcRenderer.invoke('downloads-get-active'),
  getByStatus:   (status)            => ipcRenderer.invoke('downloads-get-by-status', status),

  cancel:        (id)                => ipcRenderer.invoke('downloads-cancel', id),
  pause:         (id)                => ipcRenderer.invoke('downloads-pause', id),
  resume:        (id)                => ipcRenderer.invoke('downloads-resume', id),
  openFile:      (id)                => ipcRenderer.invoke('downloads-open-file', id),
  showInFolder:  (id)                => ipcRenderer.invoke('downloads-show-in-folder', id),

  remove:        (id)                => ipcRenderer.invoke('downloads-remove', id),
  clearHistory:  ()                  => ipcRenderer.invoke('downloads-clear-history'),

  onUpdated: (callback) => {
    ipcRenderer.removeAllListeners('downloads-updated')
    ipcRenderer.on('downloads-updated', () => callback())
  },
  onProgress: (callback) => {
    ipcRenderer.removeAllListeners('download-progress')
    ipcRenderer.on('download-progress', (_, data) => callback(data))
  },
  onStarted: (callback) => {
    ipcRenderer.removeAllListeners('download-started')
    ipcRenderer.on('download-started', (_, download) => callback(download))
  },
  onCompleted: (callback) => {
    ipcRenderer.removeAllListeners('download-completed')
    ipcRenderer.on('download-completed', (_, download) => callback(download))
  },
})
