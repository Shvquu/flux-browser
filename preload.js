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