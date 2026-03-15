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
  btnNewEphemeral:  document.getElementById('btn-new-ephemeral'),
  btnHome:          document.getElementById('btn-home'),
  btnShield:        document.getElementById('btn-shield'),
  trustBadge:       document.getElementById('trust-badge'),
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

// ── Update State ─────────────────────────────────────────────
const update = {
  info: null,        // { latestVersion, currentVersion, releaseUrl, publishedAt }
  dismissed: false,  // Nutzer hat Banner weggeklickt
}

// ── Trust State ──────────────────────────────────────────────
const trust = {
  // domain → config cache (gespiegelt vom Main Process)
  store: new Map(),
  // Aktuell angezeigte Domain
  currentDomain: null,
}

function domainFromURL(url) {
  try {
    const u = new URL(url)
    return u.hostname || null
  } catch { return null }
}

// ── Fingerprint State ────────────────────────────────────────
const fp = {
  preloadPath: null,   // Pfad zu fingerprint-guard.js
  stats: { canvas: 0, webgl: 0, audio: 0, navigator: 0, screen: 0, total: 0 },
}

// ── Shield State ───────────────────────────────────────────
const shield = {
  enabled: true,
  blockedCount: 0,
  log: [],
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

  // flux:// interne Seiten
  if (input === 'flux://network')  return 'flux://network'
  if (input === 'flux://privacy')  return 'flux://privacy'
  if (input === 'flux://trust')    return 'flux://trust'

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
function showNewTabPage(tabId, isEphemeral = false) {
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
    ${isEphemeral ? `
    <div class="nt-ephemeral-banner">
      <span class="nt-eph-icon">👻</span>
      <div class="nt-eph-text">
        <strong>Ephemeral Tab</strong>
        <span>No cookies · No cache · No history · Isolated session · Everything deleted on close</span>
      </div>
    </div>` : ''}

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

  // Update-Banner einblenden falls Update bereits bekannt
  showUpdateBanner()

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
function createTab(url = null, options = {}) {
  const id = ++state.tabCounter
  const isNewTab = url === null
  const isEphemeral = !!options.ephemeral

  // Eindeutiger Partitionsname für diesen Tab (in-memory, kein persist: Prefix)
  const partitionName = isEphemeral ? `ephemeral-${id}-${Date.now()}` : null

  // ── Tab-Header-Element erstellen ──
  const tabEl = document.createElement('div')
  tabEl.className = isEphemeral ? 'tab ephemeral' : 'tab'
  tabEl.dataset.id = id

  // Ephemeral-Icon: Geister-Symbol statt normalem Favicon-Platzhalter
  const ephemeralBadge = isEphemeral
    ? `<span class="tab-ephemeral-icon" title="Ephemeral Tab — No data stored">👻</span>`
    : ''

  tabEl.innerHTML = `
    ${ephemeralBadge}
    <div class="tab-favicon" ${isEphemeral ? 'style="display:none"' : ''}>
      <div class="tab-loading"></div>
    </div>
    <span class="tab-title">${isEphemeral ? 'Ephemeral Tab' : 'Neuer Tab'}</span>
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
  const webview = document.createElement('webview')
  webview.setAttribute('allowpopups', 'false')

  // Fingerprint-Guard in jeden Webview injizieren
  if (fp.preloadPath) {
    webview.setAttribute('preload', `file://${fp.preloadPath}`)
  }

  // Ephemeral: eigene in-memory Partition → kein persist: Prefix = kein Disk-Speicher
  if (isEphemeral && partitionName) {
    webview.setAttribute('partition', partitionName)
  }

  if (isNewTab) {
    // Statt einer Seite zu laden, zeigen wir unsere Startseite
    webview.setAttribute('src', 'about:blank')
  } else {
    webview.setAttribute('src', url)
  }

  dom.webviewContainer.appendChild(webview)

  // Tab-Objekt in den State eintragen
  const tab = { id, tabEl, webview, newTabScreen: null, isEphemeral, partitionName }
  state.tabs.push(tab)

  // ── Webview-Events registrieren ──
  registerWebviewEvents(tab)

  // Wenn Startseite: eigenen Screen anzeigen
  if (isNewTab) {
    tab.newTabScreen = showNewTabPage(id, isEphemeral)
  }

  activateTab(id)
  return id
}

/**
 * Wechselt zum angegebenen Tab und zeigt seinen Webview an.
 */
function activateTab(id) {
  // ── Vorherigen Tab komplett deaktivieren ──
  const prevTab = getActiveTab()
  if (prevTab) {
    prevTab.tabEl.classList.remove('active')
    prevTab.webview.classList.remove('active')
    prevTab.newTabScreen?.classList.add('hidden')
    // ALLE internen Seiten des alten Tabs verstecken
    ;['flux-network', 'flux-privacy', 'flux-trust'].forEach(prefix => {
      const el = document.getElementById(`${prefix}-${prevTab.id}`)
      if (el) el.style.display = 'none'
    })
  }

  const tab = getTab(id)
  if (!tab) return

  tab.tabEl.classList.add('active')
  state.activeTabId = id

  // ALLE internen Seiten des neuen Tabs erst verstecken,
  // dann nur die richtige einblenden (verhindert Überlappungen)
  ;['flux-network', 'flux-privacy', 'flux-trust'].forEach(prefix => {
    const el = document.getElementById(`${prefix}-${tab.id}`)
    if (el) el.style.display = 'none'
  })
  tab.webview.classList.remove('active')

  if (tab.isNetworkPage) {
    const el = document.getElementById(`flux-network-${tab.id}`)
    if (el) { el.style.display = 'block' } else { renderNetworkPage(tab.id) }
    dom.urlInput.value = 'flux://network'
  } else if (tab.isPrivacyPage) {
    const el = document.getElementById(`flux-privacy-${tab.id}`)
    if (el) { el.style.display = 'block' } else { renderPrivacyPage(tab.id) }
    dom.urlInput.value = 'flux://privacy'
  } else if (tab.isTrustPage) {
    const el = document.getElementById(`flux-trust-${tab.id}`)
    if (el) { el.style.display = 'block' } else { renderTrustPage(tab.id) }
    dom.urlInput.value = 'flux://trust'
  } else {
    // Normaler Tab: Webview + ggf. New-Tab-Screen einblenden
    tab.webview.classList.add('active')
    tab.newTabScreen?.classList.remove('hidden')
  }

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
  document.getElementById(`flux-network-${tab.id}`)?.remove()
  document.getElementById(`flux-privacy-${tab.id}`)?.remove()
  document.getElementById(`flux-trust-${tab.id}`)?.remove()

  // Ephemeral: Partition vollständig löschen (Cookies, Cache, Storage)
  if (tab.isEphemeral && tab.partitionName) {
    window.ephemeralAPI.clear(tab.partitionName).catch(() => {})
  }

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
    if (e.url !== 'about:blank' && tab.newTabScreen) {
      tab.newTabScreen.remove()
      tab.newTabScreen = null
    }
    if (state.activeTabId === tab.id) {
      updateNavbar(tab)
      const domain = domainFromURL(e.url)
      if (domain) {
        window.trustAPI.get(domain).then(config => {
          trust.store.set(domain, config)
          updateTrustBadge(domain, config)
        })
      } else {
        updateTrustBadge(null, null)
      }
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

  // ── Trust-Config in Webview injizieren (dom-ready → vor Seiten-JS) ──
  webview.addEventListener('dom-ready', async () => {
    const url    = webview.getURL()
    const domain = domainFromURL(url)
    if (!domain) return
    const config = await window.trustAPI.get(domain)
    trust.store.set(domain, config)
    // Sicher serialisieren und injizieren
    const json = JSON.stringify(config)
    webview.executeJavaScript(`window.__fluxTrustConfig = ${json}; void 0`).catch(() => {})
    if (state.activeTabId === tab.id) updateTrustBadge(domain, config)
  })

  // ── IPC-Messages aus dem Webview (fingerprint-guard.js → renderer) ──
  webview.addEventListener('ipc-message', (e) => {
    if (e.channel === 'flux-fp-attempt') {
      const apiType = e.args[0]
      const url     = webview.getURL()
      const domain  = domainFromURL(url)
      if (domain) window.trustAPI.reportFP(domain, apiType)
    }
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

  // flux://trust → Trust Network Seite
  if (url === 'flux://trust') {
    document.querySelectorAll('.flux-trust-page').forEach(el => el.remove())
    tab.isTrustPage    = true
    tab.isPrivacyPage  = false
    tab.isNetworkPage  = false
    dom.urlInput.value = 'flux://trust'
    dom.urlInput.blur()
    const titleEl = tab.tabEl.querySelector('.tab-title')
    if (titleEl) titleEl.textContent = 'FLUX Trust'
    renderTrustPage(tab.id)
    return
  }

  // flux://privacy → interne Privacy-Seite
  if (url === 'flux://privacy') {
    document.querySelectorAll('.flux-privacy-page').forEach(el => el.remove())
    tab.isPrivacyPage = true
    tab.isNetworkPage = false
    dom.urlInput.value = 'flux://privacy'
    dom.urlInput.blur()
    const titleEl = tab.tabEl.querySelector('.tab-title')
    if (titleEl) titleEl.textContent = 'FLUX Privacy'
    renderPrivacyPage(tab.id)
    return
  }

  // flux://network → interne Shield-Seite anzeigen
  if (url === 'flux://network') {
    document.querySelectorAll('.flux-network-page').forEach(el => el.remove())
    tab.isNetworkPage = true
    tab.isPrivacyPage = false
    dom.urlInput.value = 'flux://network'
    dom.urlInput.blur()
    const titleEl = tab.tabEl.querySelector('.tab-title')
    if (titleEl) titleEl.textContent = 'FLUX Network'
    renderNetworkPage(tab.id)
    return
  }

  // Immer: interne Seiten wegräumen + Webview sichtbar machen
  tab.isPrivacyPage = false
  tab.isNetworkPage = false
  tab.isTrustPage   = false
  const privPage  = document.getElementById(`flux-privacy-${tab.id}`)
  const netPage   = document.getElementById(`flux-network-${tab.id}`)
  const trustPage = document.getElementById(`flux-trust-${tab.id}`)
  if (privPage)  privPage.style.display  = 'none'
  if (netPage)   netPage.style.display   = 'none'
  if (trustPage) trustPage.style.display = 'none'
  tab.webview.classList.add('active')

  tab.webview.loadURL(url)
  dom.urlInput.blur()
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
dom.btnNewEphemeral?.addEventListener('click', () => createTab(null, { ephemeral: true }))

// Fenster-Steuerung (über preload.js-Bridge)
dom.btnMinimize.addEventListener('click', () => window.windowAPI.minimize())
dom.btnMaximize.addEventListener('click', () => window.windowAPI.maximize())
dom.btnClose.addEventListener('click',    () => window.windowAPI.close())

// Tastenkürzel (Keyboard Shortcuts)
document.addEventListener('keydown', (e) => {
  // Ctrl+T → Neuer Tab
  if (e.ctrlKey && !e.shiftKey && e.key === 't') { e.preventDefault(); createTab() }

  // Ctrl+Shift+T → Ephemeral Tab
  if (e.ctrlKey && e.shiftKey && e.key === 'T') { e.preventDefault(); createTab(null, { ephemeral: true }) }

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

// ── Trust Badge (Adressleiste) ───────────────────────────

const TRUST_COLORS = {
  0: { color: '#f87171', label: 'Strict',   icon: '⚠' },   // rot
  1: { color: '#facc15', label: 'Standard', icon: '●' },   // gelb
  2: { color: '#4ade80', label: 'Trusted',  icon: '✓' },   // grün
}

function updateTrustBadge(domain, config) {
  trust.currentDomain = domain
  const badge = dom.trustBadge
  if (!badge) return

  if (!domain || !config) {
    badge.style.display = 'none'
    return
  }

  const level = config.level ?? 1
  const info  = TRUST_COLORS[level] || TRUST_COLORS[1]
  badge.style.display = 'flex'
  badge.style.color   = info.color
  badge.title = `FLUX Trust: ${info.label} — ${domain}\nClick to manage`
  badge.querySelector('.trust-badge-dot').style.background = info.color
  badge.querySelector('.trust-badge-dot').style.boxShadow  = `0 0 6px ${info.color}`
}

// ── flux://trust Seite ────────────────────────────────────

function renderTrustPage(tabId) {
  const tab = getTab(tabId)
  if (!tab) return

  const existing = document.getElementById(`flux-trust-${tabId}`)
  if (existing) existing.remove()

  const C = {
    bg:      '#060508',
    surface: 'rgba(10,7,14,0.95)',
    border:  'rgba(140,60,255,0.18)',
    accent:  '#5ce0ff',
    accent2: '#9b3dff',
    text:    '#e8d8ff',
    muted:   'rgba(210,180,255,0.55)',
    green:   '#4ade80',
    yellow:  '#facc15',
    red:     '#f87171',
    orange:  '#ff6a00',
    SF:      "'Segoe UI',system-ui,-apple-system,sans-serif",
  }

  // Aktuelle Domain priorisieren
  const currentDomain = trust.currentDomain
  const allEntries = Array.from(trust.store.entries())
    .sort((a, b) => (b[1].requestCount || 0) - (a[1].requestCount || 0))

  const LEVEL_META = {
    0: { label: 'Strict',   color: C.red,    desc: 'All fingerprint APIs blocked/anonymized' },
    1: { label: 'Standard', color: C.yellow, desc: 'Fingerprint APIs anonymized (default)' },
    2: { label: 'Trusted',  color: C.green,  desc: 'APIs allowed, only tracker blocking active' },
  }

  const APIS = ['canvas', 'webgl', 'audio', 'navigator', 'screen']
  const PERM_META = {
    'anonymize': { color: C.yellow, label: 'Anonymize' },
    'allow':     { color: C.green,  label: 'Allow' },
    'block':     { color: C.red,    label: 'Block' },
  }

  function domainCard(domain, config, isCurrent) {
    const level = config.level ?? 1
    const meta  = LEVEL_META[level] || LEVEL_META[1]
    const perms = config.permissions || {}
    const reqs  = config.requestCount || 0

    const permBadges = APIS.map(api => {
      const p    = perms[api] || 'anonymize'
      const pm   = PERM_META[p]
      return `<span data-domain="${domain}" data-api="${api}" data-perm="${p}"
        style="font-size:9px;font-weight:700;padding:2px 7px;border-radius:4px;cursor:pointer;
          background:${pm.color}18;color:${pm.color};border:1px solid ${pm.color}44;
          transition:opacity 0.15s;letter-spacing:0.3px;text-transform:uppercase;"
        title="Click to cycle: anonymize → allow → block">${api}: ${pm.label}</span>`
    }).join('')

    const levelBtns = [0, 1, 2].map(l => {
      const lm = LEVEL_META[l]
      const active = l === level
      return `<button data-domain="${domain}" data-level="${l}"
        style="font-size:10px;font-weight:700;padding:3px 10px;border-radius:6px;cursor:pointer;
          border:1px solid ${active ? lm.color : C.border};
          background:${active ? lm.color + '22' : 'transparent'};
          color:${active ? lm.color : C.muted};transition:all 0.15s;">${lm.label}</button>`
    }).join('')

    const resetBtn = `<button data-domain="${domain}" data-action="reset"
      style="font-size:10px;padding:3px 8px;border-radius:6px;cursor:pointer;
        border:1px solid ${C.border};background:transparent;color:${C.muted};">Reset</button>`

    return `
      <div style="padding:16px 18px;background:rgba(12,8,20,0.7);
        border:1px solid ${isCurrent ? C.accent2 + '55' : C.border};
        border-left:3px solid ${meta.color};border-radius:10px;margin-bottom:8px;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
          <div>
            <span style="font-size:13px;font-weight:700;color:${C.text};">
              ${isCurrent ? '→ ' : ''}${domain}
            </span>
            ${reqs > 0 ? `<span style="font-size:10px;color:${C.accent2};background:${C.accent2}18;
              padding:1px 7px;border-radius:4px;margin-left:8px;">${reqs} FP requests</span>` : ''}
          </div>
          <div style="display:flex;gap:6px;align-items:center;">
            ${levelBtns}
            ${resetBtn}
          </div>
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:5px;">${permBadges}</div>
      </div>`
  }

  const cardsHTML = allEntries.length === 0
    ? `<div style="text-align:center;padding:60px 0;color:${C.muted};font-size:13px;">
        No sites visited yet. Browse a page to see trust data here.
       </div>`
    : allEntries.map(([domain, config]) =>
        domainCard(domain, config, domain === currentDomain)
      ).join('')

  const page = document.createElement('div')
  page.id = `flux-trust-${tabId}`
  Object.assign(page.style, {
    position:'absolute', inset:'0', background:C.bg, overflowY:'auto',
    padding:'40px', fontFamily:C.SF, color:C.text, zIndex:'10', boxSizing:'border-box',
  })

  page.innerHTML = `
    <!-- Header -->
    <div style="display:flex;align-items:flex-start;gap:16px;margin-bottom:32px;
      padding-bottom:20px;border-bottom:1px solid ${C.border};">
      <div>
        <div style="font-size:20px;font-weight:800;color:${C.accent};">🔒 FLUX Trust Network</div>
        <div style="font-size:12px;color:${C.muted};letter-spacing:1px;margin-top:4px;">
          flux://trust · Permissioned Internet Mode
        </div>
      </div>
      <div style="margin-left:auto;padding:6px 14px;background:${C.accent2}10;
        border:1px solid ${C.accent2}33;border-radius:20px;font-size:11px;color:${C.accent2};white-space:nowrap;">
        <span style="display:inline-block;width:6px;height:6px;background:${C.accent2};
          border-radius:50%;box-shadow:0 0 6px ${C.accent2};margin-right:6px;"></span>
        Zero-Trust Model · Local only · Never transmitted
      </div>
    </div>

    <!-- Legend -->
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:28px;">
      ${[0,1,2].map(l => {
        const lm = LEVEL_META[l]
        return `<div style="padding:14px;background:rgba(12,8,20,0.7);border:1px solid ${C.border};
          border-left:3px solid ${lm.color};border-radius:10px;">
          <div style="font-size:13px;font-weight:700;color:${lm.color};margin-bottom:4px;">${lm.label}</div>
          <div style="font-size:11px;color:${C.muted};">${lm.desc}</div>
        </div>`
      }).join('')}
    </div>

    <!-- Site List -->
    <div style="font-size:10px;font-weight:700;letter-spacing:3px;color:${C.accent2};
      text-transform:uppercase;margin-bottom:12px;">Site Permissions (${allEntries.length} sites)</div>
    <div id="trust-cards-${tabId}">${cardsHTML}</div>

    <!-- Footer -->
    <div style="display:flex;align-items:center;justify-content:space-between;
      padding-top:20px;border-top:1px solid ${C.border};margin-top:8px;
      font-size:11px;color:${C.muted};letter-spacing:0.5px;">
      <span>FLUX Browser — Zero Telemetry · Zero Tracking · Full Control</span>
      <span id="trust-link-privacy-${tabId}" style="color:${C.accent};cursor:pointer;font-size:12px;font-weight:500;">
        → Open Privacy Monitor
      </span>
    </div>
  `

  tab.webview.classList.remove('active')
  if (tab.newTabScreen) tab.newTabScreen.classList.add('hidden')
  dom.webviewContainer.appendChild(page)

  // Footer link
  document.getElementById(`trust-link-privacy-${tabId}`)
    ?.addEventListener('click', () => navigate('flux://privacy'))

  // Trust level button clicks
  page.querySelectorAll('button[data-level]').forEach(btn => {
    btn.addEventListener('click', () => {
      const domain = btn.dataset.domain
      const level  = parseInt(btn.dataset.level)
      window.trustAPI.set(domain, { level })
      trust.store.set(domain, { ...(trust.store.get(domain) || {}), level })
      // Re-inject into current webview if this is the current domain
      if (domain === trust.currentDomain) {
        const activeTab = getActiveTab()
        // Don't re-inject into trust page itself
      }
      renderTrustPage(tabId)  // Seite neu rendern
    })
  })

  // Permission badge clicks (cycle: anonymize → allow → block → anonymize)
  const CYCLE = ['anonymize', 'allow', 'block']
  page.querySelectorAll('span[data-perm]').forEach(badge => {
    badge.addEventListener('click', () => {
      const domain  = badge.dataset.domain
      const api     = badge.dataset.api
      const current = badge.dataset.perm
      const next    = CYCLE[(CYCLE.indexOf(current) + 1) % CYCLE.length]
      const config  = trust.store.get(domain) || {}
      const newPerms = { ...(config.permissions || {}), [api]: next }
      window.trustAPI.set(domain, { permissions: { [api]: next } })
      trust.store.set(domain, { ...config, permissions: newPerms })
      renderTrustPage(tabId)
    })
  })

  // Reset button
  page.querySelectorAll('button[data-action="reset"]').forEach(btn => {
    btn.addEventListener('click', () => {
      window.trustAPI.reset(btn.dataset.domain)
      trust.store.delete(btn.dataset.domain)
      renderTrustPage(tabId)
    })
  })
}

// ── flux://privacy Seite ──────────────────────────────────

function renderPrivacyPage(tabId) {
  const tab = getTab(tabId)
  if (!tab) return

  const existing = document.getElementById(`flux-privacy-${tabId}`)
  if (existing) existing.remove()

  const s = fp.stats
  const protections = [
    { name: 'Canvas Fingerprint',   status: true,           attempts: s.canvas,          desc: 'Pixel noise injected into every canvas render' },
    { name: 'WebGL Fingerprint',    status: true,           attempts: s.webgl,           desc: 'GPU renderer & vendor strings randomized' },
    { name: 'Audio Fingerprint',    status: true,           attempts: s.audio,           desc: 'Micro-noise added to AudioContext output' },
    { name: 'Navigator Properties', status: true,           attempts: s.navigator,       desc: 'CPU cores, device memory & platform randomized' },
    { name: 'Screen Resolution',    status: true,           attempts: s.screen,          desc: 'Screen dimensions varied per session' },
    { name: 'Timing Precision',     status: true,           attempts: 0,                 desc: 'performance.now() resolution reduced to 1ms' },
    { name: 'FLUX Shield',          status: shield.enabled, attempts: shield.blockedCount, desc: 'Zero-Connection Mode — tracker & background blocking' },
  ]

  // Inline-Styles: unabhängig von externen CSS-Klassen
  const C = {
    bg:        '#060508',
    surface:   'rgba(10,7,14,0.95)',
    border:    'rgba(140,60,255,0.18)',
    accent:    '#5ce0ff',
    accent2:   '#9b3dff',
    text:      '#e8d8ff',
    muted:     'rgba(210,180,255,0.55)',
    green:     '#4ade80',
    red:       '#f87171',
  }

  const rows = protections.map(p => `
    <div style="
      display:flex; align-items:center; justify-content:space-between;
      padding:14px 18px; margin-bottom:6px;
      background:rgba(12,8,20,0.6);
      border:1px solid ${p.status ? 'rgba(140,60,255,0.2)' : C.border};
      border-left:3px solid ${p.status ? C.accent2 : 'rgba(140,60,255,0.2)'};
      border-radius:10px;">
      <div style="display:flex; flex-direction:column; gap:3px;">
        <span style="font-size:13px; font-weight:600; color:${C.text};">${p.name}</span>
        <span style="font-size:11px; color:${C.muted};">${p.desc}</span>
      </div>
      <div style="display:flex; align-items:center; gap:10px; flex-shrink:0; margin-left:16px;">
        ${p.attempts > 0 ? `<span style="font-family:monospace; font-size:10px; color:${C.accent2}; background:rgba(155,61,255,0.12); padding:2px 8px; border-radius:4px;">${p.attempts} attempts</span>` : ''}
        <span style="font-size:10px; font-weight:700; padding:3px 10px; border-radius:6px; letter-spacing:0.5px;
          background:${p.status ? 'rgba(74,222,128,0.12)' : 'rgba(255,255,255,0.05)'};
          color:${p.status ? C.green : C.muted};
          border:1px solid ${p.status ? 'rgba(74,222,128,0.3)' : C.border};">
          ${p.status ? '✓ Active' : '✗ Off'}
        </span>
      </div>
    </div>`).join('')

  const page = document.createElement('div')
  page.id = `flux-privacy-${tabId}`
  Object.assign(page.style, {
    position: 'absolute', inset: '0', background: C.bg,
    overflowY: 'auto', padding: '40px',
    fontFamily: "'Exo 2', 'Segoe UI', sans-serif", color: C.text, zIndex: '10',
    boxSizing: 'border-box',
  })

  page.innerHTML = `
    <!-- Header -->
    <div style="display:flex; align-items:flex-start; gap:16px; margin-bottom:32px; padding-bottom:20px; border-bottom:1px solid ${C.border};">
      <div>
        <div style="font-family:'Segoe UI',system-ui,-apple-system,sans-serif; font-size:20px; font-weight:800;
          color:${C.accent}; letter-spacing:0.5px;">🔐 FLUX Privacy · Fingerprint Guard</div>
        <div style="font-size:12px; color:${C.muted}; letter-spacing:1px; margin-top:4px;">
          flux://privacy · Dynamic Fingerprint Randomization
        </div>
      </div>
      <div style="margin-left:auto; display:flex; align-items:center; gap:8px; padding:6px 14px;
        background:rgba(155,61,255,0.07); border:1px solid rgba(155,61,255,0.25);
        border-radius:20px; font-size:11px; color:${C.accent2}; white-space:nowrap;">
        <span style="width:6px; height:6px; background:${C.accent2}; border-radius:50%;
          box-shadow:0 0 6px ${C.accent2}; display:inline-block;"></span>
        New identity per page · Seed rotates every tab
      </div>
    </div>

    <!-- Hero Stats -->
    <div style="display:grid; grid-template-columns:repeat(3,1fr); gap:16px; margin-bottom:36px;">
      <div style="padding:24px 20px; background:rgba(12,8,20,0.8); border:1px solid ${C.border};
        border-radius:14px; text-align:center;">
        <span style="font-family:'Segoe UI',system-ui,-apple-system,sans-serif; font-size:42px; font-weight:800;
          color:${C.accent2}; display:block; margin-bottom:8px; letter-spacing:-1px;
          text-shadow:0 0 20px rgba(155,61,255,0.5);">${s.total}</span>
        <span style="font-size:11px; color:${C.muted}; letter-spacing:1.5px; text-transform:uppercase;">
          Fingerprint Attempts Neutralized</span>
      </div>
      <div style="padding:24px 20px; background:rgba(12,8,20,0.8); border:1px solid ${C.border};
        border-radius:14px; text-align:center;">
        <span style="font-family:'Segoe UI',system-ui,-apple-system,sans-serif; font-size:42px; font-weight:800;
          color:${C.accent}; display:block; margin-bottom:8px; letter-spacing:-1px;
          text-shadow:0 0 20px rgba(92,224,255,0.4);">${shield.blockedCount}</span>
        <span style="font-size:11px; color:${C.muted}; letter-spacing:1.5px; text-transform:uppercase;">
          Connections Blocked by Shield</span>
      </div>
      <div style="padding:24px 20px; background:rgba(12,8,20,0.8); border:1px solid ${C.border};
        border-radius:14px; text-align:center;">
        <span style="font-family:'Segoe UI',system-ui,-apple-system,sans-serif; font-size:42px; font-weight:800;
          color:${C.green}; display:block; margin-bottom:8px; letter-spacing:-1px;
          text-shadow:0 0 20px rgba(74,222,128,0.4);">&#8734;</span>
        <span style="font-size:11px; color:${C.muted}; letter-spacing:1.5px; text-transform:uppercase;">
          Unique Identities (per session)</span>
      </div>
    </div>

    <!-- Section Label -->
    <div style="font-family:'Segoe UI',system-ui,-apple-system,sans-serif; font-size:10px; font-weight:700; letter-spacing:3px;
      color:${C.accent2}; text-transform:uppercase; margin-bottom:12px;">Active Protections</div>

    <!-- Rows -->
    <div style="margin-bottom:32px;">${rows}</div>

    <!-- Footer -->
    <div style="display:flex; align-items:center; justify-content:space-between;
      padding-top:20px; border-top:1px solid ${C.border};
      font-size:11px; color:${C.muted}; letter-spacing:0.5px;">
      <span>FLUX Browser — Zero Telemetry · Zero Tracking · Full Control</span>
      <span id="fp-net-link-${tabId}" style="color:${C.accent}; cursor:pointer; font-size:12px;
        font-weight:500; transition:color 0.15s;">→ Open Network Monitor</span>
    </div>
  `

  tab.webview.classList.remove('active')
  if (tab.newTabScreen) tab.newTabScreen.classList.add('hidden')
  dom.webviewContainer.appendChild(page)

  document.getElementById(`fp-net-link-${tabId}`)
    ?.addEventListener('click', () => navigate('flux://network'))
}

// ── FLUX SHIELD UI ────────────────────────────────────────

// Shield-Button aktualisieren (Farbe + Zähler)
function updateShieldButton() {
  const btn   = dom.btnShield
  const count = document.getElementById('shield-count')
  if (!btn) return

  if (shield.enabled) {
    btn.classList.remove('shield-off')
  } else {
    btn.classList.add('shield-off')
  }

  if (count) {
    if (shield.blockedCount > 0) {
      count.textContent = shield.blockedCount > 99 ? '99+' : shield.blockedCount
      count.classList.remove('hidden')
    } else {
      count.classList.add('hidden')
    }
  }
}

// Kurzer Pulse-Effekt wenn etwas blockiert wurde
function pulseShield() {
  const btn = dom.btnShield
  if (!btn) return
  btn.classList.add('shield-pulse')
  setTimeout(() => btn.classList.remove('shield-pulse'), 600)
}

// flux://network Seite rendern
function renderNetworkPage(tabId) {
  const tab = getTab(tabId)
  if (!tab) return

  // Vorhandenen Screen entfernen
  const existing = document.getElementById(`flux-network-${tabId}`)
  if (existing) existing.remove()

  const allowed  = shield.log.filter(e => e.type === 'allowed').length
  const trackers = shield.log.filter(e => e.type === 'blocked-tracker').length
  const bg       = shield.log.filter(e => e.type === 'blocked-bg').length
  const total    = shield.log.length

  function timeAgo(ts) {
    const s = Math.floor((Date.now() - ts) / 1000)
    if (s < 5)  return 'just now'
    if (s < 60) return `${s}s ago`
    return `${Math.floor(s/60)}m ago`
  }

  function badgeText(type) {
    if (type === 'allowed')         return 'Allowed'
    if (type === 'blocked-tracker') return 'Tracker'
    if (type === 'blocked-bg')      return 'BG Block'
    return type
  }

  const logHTML = shield.log.length === 0
    ? `<div class="fn-empty">🛡️ No connections recorded yet.<br>Browse a page to see activity here.</div>`
    : shield.log.map(e => `
        <div class="fn-log-entry ${e.type}">
          <span class="fn-log-badge">${badgeText(e.type)}</span>
          <span class="fn-log-url" title="${e.url}">${e.url}</span>
          <span class="fn-log-time">${timeAgo(e.time)}</span>
        </div>`).join('')

  const page = document.createElement('div')
  page.className = 'flux-network-page'
  page.id = `flux-network-${tabId}`
  page.innerHTML = `
    <div class="fn-header">
      <div>
        <div class="fn-title" style="font-family:'Segoe UI',system-ui,-apple-system,sans-serif;font-size:20px;font-weight:800;color:#5ce0ff;">🛡️ FLUX Shield · Network Monitor</div>
        <div class="fn-subtitle">flux://network · Zero-Connection Mode</div>
      </div>
      <div class="fn-shield-toggle">
        <span class="fn-toggle-label">FLUX Shield</span>
        <button class="fn-toggle ${shield.enabled ? 'on' : ''}" id="fn-toggle-${tabId}"></button>
      </div>
    </div>

    <div class="fn-shield-status ${shield.enabled ? 'active' : 'inactive'}">
      <span class="fn-shield-dot"></span>
      ${shield.enabled ? 'Zero-Connection Mode ACTIVE — Background connections are blocked' : 'Shield DISABLED — All connections allowed'}
    </div>

    <div class="fn-stats">
      <div class="fn-stat">
        <span class="fn-stat-value green" style="font-family:'Segoe UI',system-ui,-apple-system,sans-serif;font-size:28px;font-weight:800;color:#4ade80;">${allowed}</span>
        <span class="fn-stat-label">Connections Allowed</span>
      </div>
      <div class="fn-stat">
        <span class="fn-stat-value red" style="font-family:'Segoe UI',system-ui,-apple-system,sans-serif;font-size:28px;font-weight:800;color:#f87171;">${trackers}</span>
        <span class="fn-stat-label">Trackers Blocked</span>
      </div>
      <div class="fn-stat">
        <span class="fn-stat-value purple" style="font-family:'Segoe UI',system-ui,-apple-system,sans-serif;font-size:28px;font-weight:800;color:#9b3dff;">${bg}</span>
        <span class="fn-stat-label">Background Blocked</span>
      </div>
    </div>

    <div class="fn-log-title" style="font-family:'Segoe UI',system-ui,-apple-system,sans-serif;font-size:10px;font-weight:700;letter-spacing:2px;color:#9b3dff;text-transform:uppercase;margin-bottom:12px;">Connection Log (last ${total})</div>
    <div class="fn-log">${logHTML}</div>
  `

  // Webview verstecken, Network-Seite zeigen
  tab.webview.classList.remove('active')
  if (tab.newTabScreen) tab.newTabScreen.classList.add('hidden')
  dom.webviewContainer.appendChild(page)

  // Shield-Toggle auf der Seite
  const toggleBtn = page.querySelector(`#fn-toggle-${tabId}`)
  if (toggleBtn) {
    toggleBtn.addEventListener('click', () => {
      const newState = !shield.enabled
      shield.enabled = newState
      window.shieldAPI.toggle(newState)
      updateShieldButton()
      // Seite neu rendern
      renderNetworkPage(tabId)
    })
  }
}

// Shield-Button Klick: Umschalten oder flux://network öffnen
dom.btnShield?.addEventListener('click', (e) => {
  // Ctrl+Klick → Network-Seite im neuen Tab
  if (e.ctrlKey) {
    navigate('flux://network')
    return
  }
  // Einfacher Klick → Shield togglen
  shield.enabled = !shield.enabled
  window.shieldAPI.toggle(shield.enabled)
  updateShieldButton()
  pulseShield()
})

// Trust-Badge Klick → flux://trust öffnen
dom.trustBadge?.addEventListener('click', () => navigate('flux://trust'))

// Shield-Button Rechtsklick → Network-Seite
dom.btnShield?.addEventListener('contextmenu', (e) => {
  e.preventDefault()
  navigate('flux://network')
})

// Live-Updates vom Main Process empfangen
window.shieldAPI.onLogUpdate((log) => {
  shield.log = log

  // Blockierungen zählen
  const newBlocked = log.filter(e => e.type !== 'allowed').length
  if (newBlocked > shield.blockedCount) {
    pulseShield()
  }
  shield.blockedCount = newBlocked
  updateShieldButton()

  // Network-Seite live aktualisieren falls geöffnet
  const activeTab = getActiveTab()
  if (activeTab && activeTab.isNetworkPage) {
    renderNetworkPage(activeTab.id)
  }
})

// Shield-Status-Änderungen (z.B. von flux://network Toggle)
window.shieldAPI.onStatusChanged((enabled) => {
  shield.enabled = enabled
  updateShieldButton()
})

// ── INITIALISIERUNG ───────────────────────────────────────

// Startet mit der FLUX-Startseite (eigene New-Tab-Page)
createTab(null)

// Update-Info beim Start laden
// Update-Check
async function pollForUpdate() {
  console.log('[FLUX Update UI] polling...')
  try {
    const info = await window.updateAPI.getInfo()
    console.log('[FLUX Update UI] getInfo result:', info)
    if (info && !update.info) {
      update.info = info
      showUpdateBanner()
    }
  } catch(e) {
    console.error('[FLUX Update UI] poll error:', e)
  }
}

console.log('[FLUX Update UI] setTimeout registered')
setTimeout(pollForUpdate, 4000)

function showUpdateBanner() {
  console.log('[FLUX Update UI] showUpdateBanner called, info:', !!update.info, 'dismissed:', update.dismissed)
  if (!update.info || update.dismissed) return

  const bar = document.getElementById('flux-update-bar')
  console.log('[FLUX Update UI] bar element:', bar)
  if (!bar) return

  bar.style.display = 'flex'
  console.log('[FLUX Update UI] bar display set to flex')
  bar.innerHTML = `
    <div class="nt-update-left">
      <span class="nt-update-icon">🚀</span>
      <div class="nt-update-text">
        <strong>FLUX Browser ${update.info.latestVersion} is available</strong>
        <span>You're on v${update.info.currentVersion} &middot; Click to download the latest release</span>
      </div>
    </div>
    <div class="nt-update-actions">
      <button id="flux-update-download">Download Update</button>
      <button id="flux-update-dismiss" title="Dismiss">✕</button>
    </div>`

  document.getElementById('flux-update-download').addEventListener('click', () => {
    window.updateAPI.openRelease()
  })
  document.getElementById('flux-update-dismiss').addEventListener('click', () => {
    update.dismissed = true
    bar.style.display = 'none'
    bar.innerHTML = ''
  })
}

// Trust-Updates live empfangen
window.trustAPI.onUpdate((domain, config) => {
  trust.store.set(domain, config)
  if (domain === trust.currentDomain) updateTrustBadge(domain, config)
  // Trust-Seite live neu rendern falls offen
  const activeTab = getActiveTab()
  if (activeTab?.isTrustPage) renderTrustPage(activeTab.id)
})

// Trust-Badge initial ausblenden
updateTrustBadge(null, null)

// Fingerprint-Preload-Pfad holen und Webviews damit ausstatten
window.fingerprintAPI.getPreloadPath().then(p => {
  fp.preloadPath = p
})

// Fingerprint-Stats laden
window.fingerprintAPI.getStats().then(stats => {
  fp.stats = stats
})

// Live-Updates der Fingerprint-Stats
window.fingerprintAPI.onStatsUpdate((stats) => {
  fp.stats = stats
  // Privacy-Seite live aktualisieren falls geöffnet
  const activeTab = getActiveTab()
  if (activeTab?.isPrivacyPage) renderPrivacyPage(activeTab.id)
})

// Shield-Status vom Main Process laden und UI initialisieren
window.shieldAPI.getStatus().then(({ enabled, log }) => {
  shield.enabled = enabled
  shield.log     = log
  shield.blockedCount = log.filter(e => e.type !== 'allowed').length
  updateShieldButton()
})

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