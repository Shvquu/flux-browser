// ============================================================
// renderer.js – Renderer Process
//
// Dieser Code läuft im Renderer-Prozess (Chromium).
// Er steuert die gesamte UI-Logik:
// - Tab-Verwaltung (erstellen, schließen, wechseln)
// - Navigation (URL eingeben, Vor/Zurück, Reload)
// - Webview-Events (Laden, Titel, Favicon, Sicherheit)
// - Fenstersteuerung (via preload.js-Bridge)
//
// WICHTIG: Kein direkter Node.js-Zugriff hier!
// Kommunikation mit dem Main Process nur über window.windowAPI.
// ============================================================

'use strict'

// ── DOM-Referenzen (einmal cachen, nicht jedes Mal neu suchen) ──
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
  btnHome:          document.getElementById('btn-home'),
  btnMinimize:      document.getElementById('btn-minimize'),
  btnMaximize:      document.getElementById('btn-maximize'),
  btnClose:         document.getElementById('btn-close'),
}

// ── Zustand der Browser-Session ───────────────────────────
// Alle offenen Tabs werden hier verwaltet.
// Jeder Tab ist ein Objekt: { id, tabEl, webview }
const state = {
  tabs: [],           // Array aller Tab-Objekte
  activeTabId: null,  // ID des aktuell sichtbaren Tabs
  tabCounter: 0,      // Zähler für eindeutige Tab-IDs
}

// ── Konfiguration ─────────────────────────────────────────
const CONFIG = {
  HOME_URL:    'https://www.google.com',
  NEW_TAB_URL: null,   // null = eigene Startseite anzeigen
  USER_AGENT:  navigator.userAgent,
}

// ── Hilfsfunktionen ───────────────────────────────────────

/**
 * Wandelt eine Eingabe in eine gültige URL um.
 * "google.com"     → "https://google.com"
 * "hallo welt"     → Google-Suche
 * "https://..."    → unverändert
 */
function parseInput(input) {
  input = input.trim()
  if (!input) return CONFIG.HOME_URL

  // Gültige URL mit Protokoll? → direkt verwenden
  try {
    const url = new URL(input)
    if (url.protocol === 'http:' || url.protocol === 'https:') return input
  } catch (_) {}

  // Sieht aus wie eine Domain? → HTTPS hinzufügen
  if (/^[\w-]+(\.[\w-]+)+(\/.*)?$/.test(input)) {
    return 'https://' + input
  }

  // Alles andere → Google-Suche
  return `https://www.google.com/search?q=${encodeURIComponent(input)}`
}

/**
 * Gibt das Tab-Objekt für eine ID zurück (oder null).
 */
function getTab(id) {
  return state.tabs.find(t => t.id === id) ?? null
}

/**
 * Gibt den aktuell aktiven Tab zurück (oder null).
 */
function getActiveTab() {
  return getTab(state.activeTabId)
}

// ── Fortschrittsbalken-Steuerung ──────────────────────────
// Simuliert einen realistischen Ladebalken:
// Schnell bis ~80%, dann langsamer – bis die Seite fertig ist.
let progressTimer = null
let progressValue = 0

function startProgress() {
  dom.progressBar.classList.remove('hidden')
  progressValue = 5
  dom.progressFill.style.width = progressValue + '%'

  // Jede 200ms wächst der Balken – aber immer langsamer je weiter
  progressTimer = setInterval(() => {
    const remaining = 90 - progressValue
    progressValue += remaining * 0.12  // Asymptotisch auf 90%
    dom.progressFill.style.width = progressValue + '%'
  }, 200)
}

function finishProgress() {
  clearInterval(progressTimer)
  dom.progressFill.style.width = '100%'
  // Kurz auf 100% halten, dann ausblenden
  setTimeout(() => {
    dom.progressBar.classList.add('hidden')
    dom.progressFill.style.width = '0%'
  }, 300)
}

// ── Neue-Tab-Startseite rendern ────────────────────────────
/**
 * Zeigt unsere eigene Startseite im Webview-Container an.
 * Enthält: Logo, Uhrzeit, Suchleiste, Quick-Links.
 */
function showNewTabPage(tabId) {
  document.getElementById('new-tab-' + tabId)?.remove()

  const screen = document.createElement('div')
  screen.className = 'new-tab-screen'
  screen.id = 'new-tab-' + tabId

  const quickLinks = [
    { label: 'Google',    url: 'https://google.com',    icon: 'G' },
    { label: 'YouTube',   url: 'https://youtube.com',   icon: '&#9654;' },
    { label: 'GitHub',    url: 'https://github.com',    icon: '{/}' },
    { label: 'Wikipedia', url: 'https://wikipedia.org', icon: 'W' },
    { label: 'Reddit',    url: 'https://reddit.com',    icon: 'R' },
    { label: 'X / Twitter', url: 'https://x.com',      icon: 'X' },
  ]

  screen.innerHTML = `
    <div class="nt-clock" id="nt-clock-${tabId}"></div>

    <div class="nt-brand">
      <img src="flux.png" class="nt-logo-img" alt="FLUX">
      <div class="nt-brand-text">
        <span class="nt-logo-text">FLUX</span>
        <span class="nt-tagline">Dein Fenster zur digitalen Welt</span>
      </div>
    </div>

    <div class="nt-search-wrap">
      <div class="nt-search-bar">
        <svg class="nt-search-icon" viewBox="0 0 20 20" fill="none">
          <circle cx="8.5" cy="8.5" r="5.5" stroke="currentColor" stroke-width="1.5"/>
          <path d="M13 13l3.5 3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
        <input
          class="nt-search-input"
          id="nt-search-${tabId}"
          type="text"
          placeholder="Suchen oder URL eingeben..."
          spellcheck="false"
          autocomplete="off"
        />
        <kbd class="nt-search-hint">Enter</kbd>
      </div>
    </div>

    <div class="nt-quicklinks">
      ${quickLinks.map(l => `
        <button class="nt-quicklink" data-url="${l.url}" title="${l.url}">
          <span class="nt-ql-icon">${l.icon}</span>
          <span class="nt-ql-label">${l.label}</span>
        </button>`).join('')}
    </div>
  `

  dom.webviewContainer.appendChild(screen)

  // Uhrzeit jede Sekunde aktualisieren
  const clockEl = screen.querySelector(`#nt-clock-${tabId}`)
  function tick() {
    const now = new Date()
    const time = now.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
    const date = now.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' })
    clockEl.innerHTML = `<span class="nt-time">${time}</span><span class="nt-date">${date}</span>`
  }
  tick()
  const timer = setInterval(tick, 1000)
  const obs = new MutationObserver(() => {
    if (!document.contains(screen)) { clearInterval(timer); obs.disconnect() }
  })
  obs.observe(document.body, { childList: true, subtree: true })

  // Suchfeld: Enter navigiert
  const input = screen.querySelector(`#nt-search-${tabId}`)
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && input.value.trim()) {
      dom.urlInput.value = input.value
      navigate(input.value)
    }
  })
  setTimeout(() => input.focus(), 80)

  // Quick-Link Klicks
  screen.querySelectorAll('.nt-quicklink').forEach(btn =>
    btn.addEventListener('click', () => navigate(btn.dataset.url))
  )

  return screen
}

// ── TAB-MANAGEMENT ────────────────────────────────────────

/**
 * Erstellt einen neuen Tab und gibt seine ID zurück.
 * @param {string|null} url - URL zum Laden, oder null für Startseite
 */
function createTab(url = null) {
  const id = ++state.tabCounter
  const isNewTab = url === null

  // ── Tab-Header-Element erstellen ──
  const tabEl = document.createElement('div')
  tabEl.className = 'tab'
  tabEl.dataset.id = id

  tabEl.innerHTML = `
    <div class="tab-favicon">
      <div class="tab-loading"></div>
    </div>
    <span class="tab-title">Neuer Tab</span>
    <button class="tab-close" title="Tab schließen">
      <svg viewBox="0 0 10 10" fill="none">
        <path d="M1 1l8 8M9 1l-8 8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
      </svg>
    </button>
  `

  // Tab-Klick → Tab aktivieren
  tabEl.addEventListener('click', (e) => {
    if (e.target.closest('.tab-close')) {
      closeTab(id)
    } else {
      activateTab(id)
    }
  })

  // ── Drag & Drop: Tab verschieben ──────────────────────────
  // HTML5 Drag & Drop API: draggable=true + dragstart/dragover/drop.
  // Wir speichern die ID des gezogenen Tabs in dataTransfer und
  // ermitteln beim drop die Zielposition anhand der Maus-X-Position.
  tabEl.setAttribute('draggable', 'true')

  // dragstart: Merkt welcher Tab gerade gezogen wird
  tabEl.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData('text/plain', String(id))
    e.dataTransfer.effectAllowed = 'move'
    // Kurze Verzögerung: Ghost-Bild erscheint erst, dann dragging-Klasse setzen
    setTimeout(() => tabEl.classList.add('dragging'), 0)
  })

  // dragend: Aufräumen egal ob drop erfolgreich war oder nicht
  tabEl.addEventListener('dragend', () => {
    tabEl.classList.remove('dragging')
    document.querySelectorAll('.tab').forEach(t =>
      t.classList.remove('drag-over-left', 'drag-over-right')
    )
  })

  // dragover: Wird aufgerufen wenn ein Tab über diesen gezogen wird
  // Wir entscheiden: links oder rechts vom Ziel einfügen?
  tabEl.addEventListener('dragover', (e) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    const draggingId = parseInt(e.dataTransfer.getData('text/plain'))
    if (draggingId === id) return

    const rect = tabEl.getBoundingClientRect()
    const isLeft = e.clientX < rect.left + rect.width / 2
    document.querySelectorAll('.tab').forEach(t =>
      t.classList.remove('drag-over-left', 'drag-over-right')
    )
    tabEl.classList.add(isLeft ? 'drag-over-left' : 'drag-over-right')
  })

  // dragleave: Indikator entfernen wenn Maus den Tab verlässt
  tabEl.addEventListener('dragleave', () => {
    tabEl.classList.remove('drag-over-left', 'drag-over-right')
  })

  // drop: Tab an neuer Position einfügen
  tabEl.addEventListener('drop', (e) => {
    e.preventDefault()
    tabEl.classList.remove('drag-over-left', 'drag-over-right')

    const draggingId = parseInt(e.dataTransfer.getData('text/plain'))
    if (draggingId === id) return

    const rect = tabEl.getBoundingClientRect()
    const insertBefore = e.clientX < rect.left + rect.width / 2

    const fromIndex = state.tabs.findIndex(t => t.id === draggingId)
    const toIndex   = state.tabs.findIndex(t => t.id === id)
    if (fromIndex === -1 || toIndex === -1) return

    // Tab aus Array entfernen und an neuer Stelle einfügen
    const [movedTab] = state.tabs.splice(fromIndex, 1)
    const newIndex = insertBefore
      ? toIndex > fromIndex ? toIndex - 1 : toIndex
      : toIndex < fromIndex ? toIndex + 1 : toIndex
    state.tabs.splice(newIndex, 0, movedTab)

    // DOM-Reihenfolge der Tab-Elemente synchronisieren
    state.tabs.forEach(t => dom.tabsContainer.appendChild(t.tabEl))
  })

  dom.tabsContainer.appendChild(tabEl)

  // ── Webview-Element erstellen ──
  // <webview> ist ein Electron-spezifisches Element.
  // Es lädt Webinhalte in einem komplett isolierten Prozess (Sandbox).
  const webview = document.createElement('webview')

  // Sicherheit: Webview-interne Sandbox aktivieren
  webview.setAttribute('allowpopups', 'false')

  if (isNewTab) {
    // Statt einer Seite zu laden, zeigen wir unsere Startseite
    webview.setAttribute('src', 'about:blank')
  } else {
    webview.setAttribute('src', url)
  }

  dom.webviewContainer.appendChild(webview)

  // Tab-Objekt in den State eintragen
  const tab = { id, tabEl, webview, newTabScreen: null }
  state.tabs.push(tab)

  // ── Webview-Events registrieren ──
  registerWebviewEvents(tab)

  // Wenn Startseite: eigenen Screen anzeigen
  if (isNewTab) {
    tab.newTabScreen = showNewTabPage(id)
  }

  activateTab(id)
  return id
}

/**
 * Wechselt zum angegebenen Tab und zeigt seinen Webview an.
 */
function activateTab(id) {
  // Vorherigen Tab deaktivieren
  const prevTab = getActiveTab()
  if (prevTab) {
    prevTab.tabEl.classList.remove('active')
    prevTab.webview.classList.remove('active')
    prevTab.newTabScreen?.classList.add('hidden')
  }

  const tab = getTab(id)
  if (!tab) return

  tab.tabEl.classList.add('active')
  tab.webview.classList.add('active')
  tab.newTabScreen?.classList.remove('hidden')
  state.activeTabId = id

  // Navbar aktualisieren
  updateNavbar(tab)
}

/**
 * Schließt einen Tab. Falls es der letzte war → neuer Tab.
 */
function closeTab(id) {
  const index = state.tabs.findIndex(t => t.id === id)
  if (index === -1) return

  const tab = state.tabs[index]

  // DOM aufräumen
  tab.tabEl.remove()
  tab.webview.remove()
  tab.newTabScreen?.remove()

  // Aus State entfernen
  state.tabs.splice(index, 1)

  if (state.tabs.length === 0) {
    // Letzter Tab geschlossen → neuen öffnen
    createTab()
  } else if (state.activeTabId === id) {
    // Aktiver Tab geschlossen → benachbarten aktivieren
    const nextTab = state.tabs[Math.min(index, state.tabs.length - 1)]
    activateTab(nextTab.id)
  }
}

// ── WEBVIEW-EVENTS ────────────────────────────────────────

/**
 * Registriert alle relevanten Events für einen Webview.
 * Events informieren uns über Ladefortschritt, Titel, Favicon etc.
 */
function registerWebviewEvents(tab) {
  const { webview, tabEl } = tab
  const titleEl   = tabEl.querySelector('.tab-title')
  const faviconEl = tabEl.querySelector('.tab-favicon')

  // ── Laden beginnt ──
  webview.addEventListener('did-start-loading', () => {
    if (state.activeTabId === tab.id) {
      startProgress()
      dom.loadingIndicator.classList.remove('hidden')
      dom.btnReload.title = 'Laden abbrechen'
    }
    // Lade-Spinner im Tab anzeigen
    faviconEl.innerHTML = '<div class="tab-loading"></div>'
  })

  // ── Laden abgeschlossen ──
  webview.addEventListener('did-stop-loading', () => {
    if (state.activeTabId === tab.id) {
      finishProgress()
      dom.loadingIndicator.classList.add('hidden')
      dom.btnReload.title = 'Seite neu laden'
    }
    // Spinner entfernen (Favicon wird separat gesetzt)
    if (!faviconEl.querySelector('img')) {
      faviconEl.innerHTML = defaultFaviconSVG()
    }
  })

  // ── Titel hat sich geändert ──
  webview.addEventListener('page-title-updated', (e) => {
    titleEl.textContent = e.title || 'Kein Titel'
    titleEl.title = e.title  // Tooltip bei langem Titel
    if (state.activeTabId === tab.id) {
      document.title = e.title + ' – FLUX'
    }
  })

  // ── Favicon geladen ──
  webview.addEventListener('page-favicon-updated', (e) => {
    if (e.favicons?.length > 0) {
      faviconEl.innerHTML = `<img src="${e.favicons[0]}" alt="" draggable="false">`
    }
  })

  // ── Seite navigiert (URL hat sich geändert) ──
  webview.addEventListener('did-navigate', (e) => {
    // Neue-Tab-Startseite ausblenden wenn navigiert wurde
    if (e.url !== 'about:blank' && tab.newTabScreen) {
      tab.newTabScreen.remove()
      tab.newTabScreen = null
    }
    if (state.activeTabId === tab.id) {
      updateNavbar(tab)
    }
  })

  // ── In-Page Navigation (Hash, History API) ──
  webview.addEventListener('did-navigate-in-page', () => {
    if (state.activeTabId === tab.id) updateNavbar(tab)
  })

  // ── Fehler beim Laden ──
  webview.addEventListener('did-fail-load', (e) => {
    // Netzwerkfehler ignorieren (Code -3 = abgebrochen durch User)
    if (e.errorCode === -3) return
    titleEl.textContent = 'Fehler'
    if (state.activeTabId === tab.id) finishProgress()
  })

  // ── Hover-URL (für Status-Leiste) ──
  webview.addEventListener('update-target-url', (e) => {
    dom.statusText.textContent = e.url || ''
  })

  // ── Neues Fenster-Request (abfangen) ──
  // Statt ein Betriebssystem-Fenster zu öffnen, öffnen wir einen neuen Tab.
  webview.addEventListener('new-window', (e) => {
    createTab(e.url)
  })
}

/**
 * Aktualisiert Adressleiste, Navigations-Buttons und Sicherheitsindikator.
 */
function updateNavbar(tab) {
  if (!tab?.webview) return

  // URL in Adressleiste schreiben (nur wenn nicht gerade getippt wird)
  if (document.activeElement !== dom.urlInput) {
    const url = tab.webview.getURL()
    dom.urlInput.value = url === 'about:blank' ? '' : url
  }

  // Vor/Zurück-Buttons aktivieren oder deaktivieren
  dom.btnBack.disabled    = !tab.webview.canGoBack()
  dom.btnForward.disabled = !tab.webview.canGoForward()

  // Sicherheitsindikator: HTTPS → grün, HTTP → orange
  const url = tab.webview.getURL()
  const isSecure = url.startsWith('https://') || url.startsWith('about:')
  dom.securityIcon.className = isSecure ? 'secure' : 'insecure'
  dom.securityIcon.title = isSecure ? 'Sichere Verbindung (HTTPS)' : 'Unsichere Verbindung (HTTP)'
}

/**
 * Standard-Favicon als SVG (wenn keine echte Favicon vorhanden).
 */
function defaultFaviconSVG() {
  return `<svg viewBox="0 0 16 16" fill="none" style="opacity:0.4">
    <circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.2"/>
    <circle cx="8" cy="8" r="2" fill="currentColor"/>
  </svg>`
}

// ── NAVIGATION ────────────────────────────────────────────

/**
 * Navigiert den aktiven Tab zur gegebenen URL oder Suchanfrage.
 */
function navigate(input) {
  const tab = getActiveTab()
  if (!tab) return

  const url = parseInput(input)

  // Startseite entfernen wenn navigiert wird
  if (tab.newTabScreen) {
    tab.newTabScreen.remove()
    tab.newTabScreen = null
  }

  tab.webview.loadURL(url)
  dom.urlInput.blur()  // Tastatur-Fokus entfernen
}

// ── EVENT-LISTENER (UI-Interaktion) ───────────────────────

// Adressleiste: Enter → navigieren, Escape → Abbrechen
dom.urlInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    navigate(dom.urlInput.value)
  } else if (e.key === 'Escape') {
    const tab = getActiveTab()
    if (tab) {
      const url = tab.webview.getURL()
      dom.urlInput.value = url === 'about:blank' ? '' : url
    }
    dom.urlInput.blur()
  }
})

// Adressleiste fokussiert → Text komplett markieren (wie echter Browser)
dom.urlInput.addEventListener('focus', () => dom.urlInput.select())

// Navigations-Buttons
dom.btnBack.addEventListener('click',    () => getActiveTab()?.webview.goBack())
dom.btnForward.addEventListener('click', () => getActiveTab()?.webview.goForward())
dom.btnReload.addEventListener('click',  () => {
  const tab = getActiveTab()
  if (!tab) return
  // Während des Ladens → Stop, sonst → Reload
  tab.webview.isLoading() ? tab.webview.stop() : tab.webview.reload()
})

dom.btnHome.addEventListener('click', () => navigate(CONFIG.HOME_URL))

// Neuer Tab
dom.btnNewTab.addEventListener('click', () => createTab())

// Fenster-Steuerung (über preload.js-Bridge)
dom.btnMinimize.addEventListener('click', () => window.windowAPI.minimize())
dom.btnMaximize.addEventListener('click', () => window.windowAPI.maximize())
dom.btnClose.addEventListener('click',    () => window.windowAPI.close())

// Tastenkürzel (Keyboard Shortcuts)
document.addEventListener('keydown', (e) => {
  // Ctrl+T → Neuer Tab
  if (e.ctrlKey && e.key === 't') { e.preventDefault(); createTab() }

  // Ctrl+W → Aktiven Tab schließen
  if (e.ctrlKey && e.key === 'w') { e.preventDefault(); closeTab(state.activeTabId) }

  // Ctrl+L → Adressleiste fokussieren
  if (e.ctrlKey && e.key === 'l') { e.preventDefault(); dom.urlInput.focus(); dom.urlInput.select() }

  // F5 / Ctrl+R → Reload
  if (e.key === 'F5' || (e.ctrlKey && e.key === 'r')) { e.preventDefault(); getActiveTab()?.webview.reload() }

  // Alt+← / Alt+→ → Vor/Zurück
  if (e.altKey && e.key === 'ArrowLeft') getActiveTab()?.webview.goBack()
  if (e.altKey && e.key === 'ArrowRight') getActiveTab()?.webview.goForward()

  // Ctrl+1-9 → Tab-Wechsel
  if (e.ctrlKey && e.key >= '1' && e.key <= '9') {
    const index = parseInt(e.key) - 1
    if (state.tabs[index]) activateTab(state.tabs[index].id)
  }
})

// ── INITIALISIERUNG ───────────────────────────────────────

// Startet mit der FLUX-Startseite (eigene New-Tab-Page)
createTab(null)

// Fenster-Zustand-Listener (Maximize-Icon aktualisieren)
window.windowAPI.onWindowState((state) => {
  const icon = dom.btnMaximize.querySelector('svg')
  if (state === 'maximized') {
    // Bei Maximierung: Doppeltes Rechteck-Symbol
    icon.innerHTML = `<path d="M4 2h6v6H4zM2 4h2v6h6v2H2z" stroke="currentColor" stroke-width="1" fill="none"/>`
  } else {
    // Normal: Einzelnes Rechteck
    icon.innerHTML = `<rect x="2" y="2" width="8" height="8" stroke="currentColor" stroke-width="1.5" fill="none"/>`
  }
})