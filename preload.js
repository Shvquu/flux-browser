// ============================================================
// preload.js – Preload Script (Sichere Brücke)
//
// Dieses Script läuft in einem privilegierten Kontext:
// Es hat Zugriff auf Node.js UND auf das DOM – aber NUR hier.
//
// contextBridge.exposeInMainWorld() erlaubt es uns,
// explizit definierte APIs sicher an den Renderer weiterzugeben.
// Der Renderer kann NUR diese APIs nutzen – sonst nichts.
// ============================================================

const { contextBridge, ipcRenderer } = require('electron')

// ── API für den Renderer bereitstellen ────────────────────
// 'windowAPI' ist der Name, unter dem der Renderer diese Methoden
// über window.windowAPI aufruft.
contextBridge.exposeInMainWorld('windowAPI', {

  // Fensterbefehle: Renderer → Main Process
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close:    () => ipcRenderer.send('window-close'),

  // Fenster-Status-Updates: Main Process → Renderer
  // Der Renderer übergibt eine Callback-Funktion, die aufgerufen wird,
  // wenn sich der Fenster-Status ändert.
  onWindowState: (callback) => {
    // Einmaliger Listener – kein Memory Leak durch Doppelanmeldung
    ipcRenderer.removeAllListeners('window-state')
    ipcRenderer.on('window-state', (_, state) => callback(state))
  }
})