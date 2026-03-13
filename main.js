// ============================================================
// main.js – Main Process
//
// Der Main Process ist der "Kern" der Electron-App.
// Er hat Zugriff auf Node.js und alle nativen OS-APIs.
// Er erstellt Fenster (BrowserWindow) und kommuniziert
// mit dem Renderer via IPC (Inter-Process Communication).
// ============================================================

const { app, BrowserWindow, ipcMain, session } = require('electron')
const path = require('path')

// ── Squirrel-Events (Windows Installer) ───────────────────
// Squirrel feuert beim ersten Start nach der Installation
// spezielle Ereignisse. Wir MÜSSEN diese abfangen, sonst:
//   - Keine Desktop-Verknüpfung
//   - Kein Start-Menü-Eintrag
//   - Kein Eintrag in 'Apps & Features' (keine Deinstallation)
//
// electron-squirrel-startup erledigt das automatisch:
//   Install   → Shortcuts erstellen + Registry-Eintrag anlegen
//   Uninstall → Shortcuts + Registry entfernen
//   Update    → Shortcuts aktualisieren
// Danach beendet sich die App sofort (app.quit), da Squirrel
// die App nur kurz startet um diese Events zu verarbeiten.
if (require('electron-squirrel-startup')) app.quit()

// ── Fenster erstellen ──────────────────────────────────────
function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    frame: false,           // Eigene Titelleiste statt OS-Standard
    backgroundColor: '#050810', // Verhindert weißes Flackern beim Start

    // App-Icon für Taskleiste (Windows), Dock (macOS) und Panels (Linux).
    // Pfad relativ zu main.js → flux.png liegt im renderer/-Unterordner.
    icon: path.join(__dirname, 'renderer', 'flux.png'),

    webPreferences: {
      // Preload-Script: lädt BEVOR die Seite gerendert wird.
      // Es ist die einzige sichere Brücke zwischen Main und Renderer.
      preload: path.join(__dirname, 'preload.js'),

      // contextIsolation: MUSS true sein!
      // Trennt den JavaScript-Kontext der Webseite vom Node.js-Kontext.
      // Verhindert, dass Webseiten auf Node.js-APIs zugreifen können.
      contextIsolation: true,

      // nodeIntegration: MUSS false sein!
      // Gibt dem Renderer-Prozess KEINEN direkten Node.js-Zugriff.
      nodeIntegration: false,

      // webviewTag: Erlaubt <webview>-Elemente im Renderer.
      // <webview> ist ein spezielles Electron-Element, das Webseiten
      // in einem eigenen, isolierten Prozess lädt.
      webviewTag: true,

      // Verhindert, dass der Renderer auf lokale Dateien zugreift
      webSecurity: true,
    },
  })

  // Shell des Browsers laden (unsere eigene UI)
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'))

  // ── Fenster-Steuerung via IPC ──────────────────────────
  // Der Renderer kann keine Fenster direkt steuern (Sicherheit!).
  // Stattdessen sendet er IPC-Nachrichten, die wir hier verarbeiten.

  ipcMain.on('window-minimize', () => win.minimize())

  ipcMain.on('window-maximize', () => {
    // Toggle zwischen maximiert und Normal
    win.isMaximized() ? win.unmaximize() : win.maximize()
  })

  ipcMain.on('window-close', () => win.close())

  // Fenster-Status an Renderer melden (für Maximize-Icon)
  win.on('maximize', () => win.webContents.send('window-state', 'maximized'))
  win.on('unmaximize', () => win.webContents.send('window-state', 'normal'))

  // ── Dev Tools (nur für Entwicklung) ───────────────────
  // Im Produktionsbuild diese Zeile entfernen
  // win.webContents.openDevTools()
}

// ── Content Security Policy setzen ────────────────────────
// CSP schränkt ein, welche Ressourcen unsere Shell-UI laden darf.
// Wichtig: Diese CSP gilt NUR für unsere eigene UI, nicht für
// die <webview>-Inhalte (die haben ihr eigenes CSP).
app.whenReady().then(() => {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    // Nur für unsere eigene Shell anwenden, nicht für externe Seiten
    if (details.url.startsWith('file://')) {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [
            "default-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://fonts.gstatic.com"
          ]
        }
      })
    } else {
      callback({})
    }
  })

  createWindow()

  // macOS: App bleibt offen, auch wenn alle Fenster geschlossen sind
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Windows/Linux: App beenden, wenn letztes Fenster geschlossen wird
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})