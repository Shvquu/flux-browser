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
