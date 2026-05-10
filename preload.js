const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('windowAPI', {
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close:    () => ipcRenderer.send('window-close'),
  onWindowState: (cb) => {
    ipcRenderer.removeAllListeners('window-state')
    ipcRenderer.on('window-state', (_, s) => cb(s))
  }
})

contextBridge.exposeInMainWorld('shieldAPI', {
  getStatus: () => ipcRenderer.invoke('shield-get-status'),
  toggle: (enable) => ipcRenderer.send('shield-toggle', enable),
  onLogUpdate: (cb) => {
    ipcRenderer.removeAllListeners('shield-log-update')
    ipcRenderer.on('shield-log-update', (_, log) => cb(log))
  },
  onStatusChanged: (cb) => {
    ipcRenderer.removeAllListeners('shield-status-changed')
    ipcRenderer.on('shield-status-changed', (_, enabled) => cb(enabled))
  }
})

contextBridge.exposeInMainWorld('fingerprintAPI', {
  getPreloadPath: () => ipcRenderer.invoke('fp-get-preload-path'),
  getStats: () => ipcRenderer.invoke('fp-get-stats'),
  reportAttempt: (type) => ipcRenderer.send('fp-attempt', type),
  onStatsUpdate: (cb) => {
    ipcRenderer.removeAllListeners('fp-stats-update')
    ipcRenderer.on('fp-stats-update', (_, stats) => cb(stats))
  },
})

contextBridge.exposeInMainWorld('trustAPI', {
  get:      (domain)         => ipcRenderer.invoke('trust-get', domain),
  set:      (domain, config) => ipcRenderer.send('trust-set', domain, config),
  getAll:   ()               => ipcRenderer.invoke('trust-get-all'),
  reset:    (domain)         => ipcRenderer.send('trust-reset', domain),
  reportFP: (domain, type)   => ipcRenderer.send('trust-fp-request', domain, type),
  onUpdate: (cb) => {
    ipcRenderer.removeAllListeners('trust-updated')
    ipcRenderer.on('trust-updated', (_, domain, config) => cb(domain, config))
  },
})

contextBridge.exposeInMainWorld('ephemeralAPI', {
  clear: (partitionName) => ipcRenderer.invoke('ephemeral-clear', partitionName),
})

contextBridge.exposeInMainWorld('downloadAPI', {
  onStarted:  (cb) => {
    ipcRenderer.removeAllListeners('download-started')
    ipcRenderer.on('download-started', (_, info) => cb(info))
  },
  onProgress: (cb) => {
    ipcRenderer.removeAllListeners('download-progress')
    ipcRenderer.on('download-progress', (_, info) => cb(info))
  },
  onDone: (cb) => {
    ipcRenderer.removeAllListeners('download-done')
    ipcRenderer.on('download-done', (_, info) => cb(info))
  },
  openFolder: (savePath) => ipcRenderer.send('download-open-folder', savePath),
})

contextBridge.exposeInMainWorld('updateAPI', {
  getInfo:     () => ipcRenderer.invoke('update-get-info'),
  openRelease: () => ipcRenderer.send('update-open-release'),
  onAvailable: (cb) => {
    ipcRenderer.removeAllListeners('update-available')
    ipcRenderer.on('update-available', (_, info) => cb(info))
  },
})