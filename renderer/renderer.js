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

// Load persisted settings into CONFIG at startup
;(async () => {
  try {
    const settings = await window.settingsAPI.getAll()
    if (settings.homePage) CONFIG.HOME_URL = settings.homePage
    // Load search engine URL template
    const engines = await window.settingsAPI.getSearchEngines()
    CONFIG._searchTemplate = engines[settings.searchEngine] || engines.google
  } catch {}
})()

// Listen for settings changes
window.settingsAPI?.onUpdated(async (key, value) => {
  if (key === 'homePage' && value) CONFIG.HOME_URL = value
  if (key === 'searchEngine' || key === null) {
    try {
      const engines = await window.settingsAPI.getSearchEngines()
      const settings = await window.settingsAPI.getAll()
      CONFIG._searchTemplate = engines[settings.searchEngine] || engines.google
    } catch {}
  }
})

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
  if (input === 'flux://network-transparency') return 'flux://network-transparency'
  if (input === 'flux://privacy')  return 'flux://privacy'
  if (input === 'flux://trust')    return 'flux://trust'
  if (input === 'flux://bookmarks')  return 'flux://bookmarks'
  if (input === 'flux://history')    return 'flux://history'
  if (input === 'flux://settings')   return 'flux://settings'
  if (input === 'flux://downloads')  return 'flux://downloads'

  // Gültige URL mit Protokoll? → direkt verwenden
  try {
    const url = new URL(input)
    if (url.protocol === 'http:' || url.protocol === 'https:') return input
  } catch (_) {}

  // Sieht aus wie eine Domain? → HTTPS hinzufügen
  if (/^[\w-]+(\.[\w-]+)+(\/.*)?$/.test(input)) {
    return 'https://' + input
  }

  // Alles andere → Search engine (uses settings-based engine)
  // Async getSearchUrl not used here to keep parseInput synchronous;
  // the renderer fetches the search URL template at startup instead.
  return CONFIG._searchTemplate
    ? CONFIG._searchTemplate.replace('%s', encodeURIComponent(input))
    : `https://www.google.com/search?q=${encodeURIComponent(input)}`
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
    INTERNAL_PAGE_PREFIXES.forEach(prefix => {
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
  INTERNAL_PAGE_PREFIXES.forEach(prefix => {
    const el = document.getElementById(`${prefix}-${tab.id}`)
    if (el) el.style.display = 'none'
  })
  tab.webview.classList.remove('active')

  // Internal page routing map
  const internalPages = [
    { flag: 'isNetworkPage',              prefix: 'flux-network',           url: 'flux://network',              render: renderNetworkPage },
    { flag: 'isNetworkTransparencyPage',  prefix: 'network-transparency',   url: 'flux://network-transparency', render: renderNetworkTransparencyPage },
    { flag: 'isPrivacyPage',              prefix: 'flux-privacy',           url: 'flux://privacy',              render: renderPrivacyPage },
    { flag: 'isTrustPage',               prefix: 'flux-trust',             url: 'flux://trust',                render: renderTrustPage },
    { flag: 'isBookmarksPage',            prefix: 'flux-bookmarks',         url: 'flux://bookmarks',            render: renderBookmarksPage },
    { flag: 'isHistoryPage',              prefix: 'flux-history',           url: 'flux://history',              render: renderHistoryPage },
    { flag: 'isSettingsPage',             prefix: 'flux-settings',          url: 'flux://settings',             render: renderSettingsPage },
    { flag: 'isDownloadsPage',            prefix: 'flux-downloads',         url: 'flux://downloads',            render: renderDownloadsPage },
  ]

  let handled = false
  for (const page of internalPages) {
    if (tab[page.flag]) {
      const el = document.getElementById(`${page.prefix}-${tab.id}`)
      if (el) { el.style.display = 'block' } else { page.render(tab.id) }
      dom.urlInput.value = page.url
      handled = true
      break
    }
  }

  if (!handled) {
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
  INTERNAL_PAGE_PREFIXES.forEach(prefix => {
    document.getElementById(`${prefix}-${tab.id}`)?.remove()
  })

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
    // Record in browsing history (skip ephemeral tabs)
    if (!tab.isEphemeral && e.url !== 'about:blank' && !e.url.startsWith('flux://')) {
      const title = tabEl.querySelector('.tab-title')?.textContent || e.url
      window.historyAPI.add({ url: e.url, title }).catch(() => {})
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

// ── NAVIGATION HELPERS ────────────────────────────────────

const INTERNAL_PAGE_PREFIXES = [
  'flux-network', 'flux-privacy', 'flux-trust', 'network-transparency',
  'flux-bookmarks', 'flux-history', 'flux-settings', 'flux-downloads',
]

function clearInternalPages(tab) {
  tab.isPrivacyPage = false
  tab.isNetworkPage = false
  tab.isTrustPage   = false
  tab.isNetworkTransparencyPage = false
  tab.isBookmarksPage  = false
  tab.isHistoryPage    = false
  tab.isSettingsPage   = false
  tab.isDownloadsPage  = false

  INTERNAL_PAGE_PREFIXES.forEach(prefix => {
    const el = document.getElementById(`${prefix}-${tab.id}`)
    if (el) el.style.display = 'none'
  })
}

function setTabTitle(tab, title) {
  const titleEl = tab.tabEl.querySelector('.tab-title')
  if (titleEl) titleEl.textContent = title
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
    clearInternalPages(tab)
    tab.isTrustPage = true
    dom.urlInput.value = 'flux://trust'
    dom.urlInput.blur()
    setTabTitle(tab, 'FLUX Trust')
    renderTrustPage(tab.id)
    return
  }

  // flux://privacy → interne Privacy-Seite
  if (url === 'flux://privacy') {
    clearInternalPages(tab)
    tab.isPrivacyPage = true
    dom.urlInput.value = 'flux://privacy'
    dom.urlInput.blur()
    setTabTitle(tab, 'FLUX Privacy')
    renderPrivacyPage(tab.id)
    return
  }

  // flux://network → interne Shield-Seite anzeigen
  if (url === 'flux://network') {
    clearInternalPages(tab)
    tab.isNetworkPage = true
    dom.urlInput.value = 'flux://network'
    dom.urlInput.blur()
    setTabTitle(tab, 'FLUX Network')
    renderNetworkPage(tab.id)
    return
  }

  // flux://network-transparency → Network Transparency Panel
  if (url === 'flux://network-transparency') {
    clearInternalPages(tab)
    tab.isNetworkTransparencyPage = true
    dom.urlInput.value = 'flux://network-transparency'
    dom.urlInput.blur()
    setTabTitle(tab, 'Network Transparency')
    renderNetworkTransparencyPage(tab.id)
    return
  }

  // flux://bookmarks → Bookmarks page
  if (url === 'flux://bookmarks') {
    clearInternalPages(tab)
    tab.isBookmarksPage = true
    dom.urlInput.value = 'flux://bookmarks'
    dom.urlInput.blur()
    setTabTitle(tab, 'Bookmarks')
    renderBookmarksPage(tab.id)
    return
  }

  // flux://history → History page
  if (url === 'flux://history') {
    clearInternalPages(tab)
    tab.isHistoryPage = true
    dom.urlInput.value = 'flux://history'
    dom.urlInput.blur()
    setTabTitle(tab, 'History')
    renderHistoryPage(tab.id)
    return
  }

  // flux://settings → Settings page
  if (url === 'flux://settings') {
    clearInternalPages(tab)
    tab.isSettingsPage = true
    dom.urlInput.value = 'flux://settings'
    dom.urlInput.blur()
    setTabTitle(tab, 'Settings')
    renderSettingsPage(tab.id)
    return
  }

  // flux://downloads → Downloads page
  if (url === 'flux://downloads') {
    clearInternalPages(tab)
    tab.isDownloadsPage = true
    dom.urlInput.value = 'flux://downloads'
    dom.urlInput.blur()
    setTabTitle(tab, 'Downloads')
    renderDownloadsPage(tab.id)
    return
  }

  // Immer: interne Seiten wegräumen + Webview sichtbar machen
  clearInternalPages(tab)
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

// ── COMMON INTERNAL PAGE STYLES ────────────────────────────
const PAGE_COLORS = {
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

function createInternalPage(id, prefix) {
  const existing = document.getElementById(`${prefix}-${id}`)
  if (existing) existing.remove()

  const page = document.createElement('div')
  page.id = `${prefix}-${id}`
  Object.assign(page.style, {
    position:'absolute', inset:'0', background: PAGE_COLORS.bg, overflowY:'auto',
    padding:'40px', fontFamily: PAGE_COLORS.SF, color: PAGE_COLORS.text,
    zIndex:'10', boxSizing:'border-box',
  })
  return page
}

function mountInternalPage(tabId, page) {
  const tab = getTab(tabId)
  if (!tab) return
  tab.webview.classList.remove('active')
  if (tab.newTabScreen) tab.newTabScreen.classList.add('hidden')
  dom.webviewContainer.appendChild(page)
}

function pageHeader(title, subtitle, statusText) {
  const C = PAGE_COLORS
  return `
    <div style="display:flex;align-items:flex-start;gap:16px;margin-bottom:32px;
      padding-bottom:20px;border-bottom:1px solid ${C.border};">
      <div>
        <div style="font-size:20px;font-weight:800;color:${C.accent};">${title}</div>
        <div style="font-size:12px;color:${C.muted};letter-spacing:1px;margin-top:4px;">${subtitle}</div>
      </div>
      <div style="margin-left:auto;padding:6px 14px;background:${C.accent2}10;
        border:1px solid ${C.accent2}33;border-radius:20px;font-size:11px;color:${C.accent2};white-space:nowrap;">
        <span style="display:inline-block;width:6px;height:6px;background:${C.accent2};
          border-radius:50%;box-shadow:0 0 6px ${C.accent2};margin-right:6px;"></span>
        ${statusText}
      </div>
    </div>`
}

function pageFooter() {
  const C = PAGE_COLORS
  return `
    <div style="display:flex;align-items:center;justify-content:space-between;
      padding-top:20px;border-top:1px solid ${C.border};margin-top:20px;
      font-size:11px;color:${C.muted};letter-spacing:0.5px;">
      <span>FLUX Browser — Zero Telemetry · Zero Tracking · Full Control</span>
    </div>`
}

// ── flux://bookmarks ──────────────────────────────────────

function renderBookmarksPage(tabId) {
  const C = PAGE_COLORS
  const page = createInternalPage(tabId, 'flux-bookmarks')

  page.innerHTML = `
    ${pageHeader('Bookmarks', 'flux://bookmarks · Local Bookmark Manager', 'Stored locally · Never synced')}

    <!-- Toolbar -->
    <div style="display:flex;gap:10px;margin-bottom:20px;flex-wrap:wrap;align-items:center;">
      <input id="bm-search-${tabId}" type="text" placeholder="Search bookmarks..."
        style="flex:1;min-width:200px;padding:8px 14px;background:rgba(12,8,20,0.7);
        border:1px solid ${C.border};border-radius:8px;color:${C.text};font-size:12px;outline:none;" />
      <button id="bm-add-folder-${tabId}" style="padding:8px 16px;background:${C.accent2}22;
        border:1px solid ${C.accent2}44;border-radius:8px;color:${C.accent2};font-size:11px;
        font-weight:600;cursor:pointer;">+ New Folder</button>
      <button id="bm-export-${tabId}" style="padding:8px 16px;background:${C.accent}22;
        border:1px solid ${C.accent}44;border-radius:8px;color:${C.accent};font-size:11px;
        font-weight:600;cursor:pointer;">Export</button>
      <button id="bm-import-${tabId}" style="padding:8px 16px;background:${C.green}22;
        border:1px solid ${C.green}44;border-radius:8px;color:${C.green};font-size:11px;
        font-weight:600;cursor:pointer;">Import</button>
      <input id="bm-import-file-${tabId}" type="file" accept=".json" style="display:none;" />
    </div>

    <!-- Bookmark Tree -->
    <div id="bm-tree-${tabId}" style="min-height:200px;">
      <div style="text-align:center;padding:40px 0;color:${C.muted};font-size:13px;">Loading bookmarks...</div>
    </div>

    ${pageFooter()}
  `

  mountInternalPage(tabId, page)
  setupBookmarksPageLogic(tabId)
}

async function setupBookmarksPageLogic(tabId) {
  const C = PAGE_COLORS

  async function loadTree(searchQuery = '') {
    const container = document.getElementById(`bm-tree-${tabId}`)
    if (!container) return

    let items
    if (searchQuery) {
      items = await window.bookmarksAPI.search(searchQuery)
    } else {
      items = await window.bookmarksAPI.getTree()
    }

    if (!items || items.length === 0) {
      container.innerHTML = `<div style="text-align:center;padding:60px 0;color:${C.muted};font-size:13px;">
        ${searchQuery ? 'No bookmarks match your search.' : 'No bookmarks yet. Visit a page and click the bookmark button to save it.'}
      </div>`
      return
    }

    container.innerHTML = renderBookmarkItems(items, 0)
    attachBookmarkEvents(tabId, container)
  }

  function renderBookmarkItems(items, depth) {
    return items.map(item => {
      const indent = depth * 20
      if (item.type === 'folder') {
        const childrenHTML = item.children && item.children.length > 0
          ? renderBookmarkItems(item.children, depth + 1) : ''
        return `
          <div style="margin-left:${indent}px;margin-bottom:2px;">
            <div style="display:flex;align-items:center;gap:10px;padding:10px 14px;
              background:rgba(12,8,20,0.6);border:1px solid ${C.border};border-left:3px solid ${C.accent2};
              border-radius:8px;margin-bottom:4px;cursor:pointer;" class="bm-folder" data-id="${item.id}">
              <span style="font-size:14px;">&#128193;</span>
              <span style="font-size:13px;font-weight:600;color:${C.text};flex:1;">${escapeHtml(item.title)}</span>
              <button class="bm-delete" data-id="${item.id}" style="background:none;border:none;
                color:${C.red};cursor:pointer;font-size:11px;opacity:0.6;padding:2px 6px;"
                title="Delete folder">&#10005;</button>
            </div>
            <div class="bm-folder-children">${childrenHTML}</div>
          </div>`
      }
      return `
        <div style="display:flex;align-items:center;gap:10px;padding:10px 14px;margin-left:${indent}px;
          background:rgba(12,8,20,0.4);border:1px solid ${C.border};border-radius:8px;margin-bottom:3px;
          cursor:pointer;transition:background 0.15s;" class="bm-item"
          onmouseenter="this.style.background='rgba(140,60,255,0.08)'"
          onmouseleave="this.style.background='rgba(12,8,20,0.4)'"
          data-id="${item.id}" data-url="${escapeHtml(item.url || '')}">
          <span style="font-size:12px;opacity:0.5;">&#9733;</span>
          <div style="flex:1;min-width:0;">
            <div style="font-size:12px;font-weight:600;color:${C.text};white-space:nowrap;overflow:hidden;
              text-overflow:ellipsis;">${escapeHtml(item.title)}</div>
            <div style="font-size:10px;color:${C.muted};white-space:nowrap;overflow:hidden;
              text-overflow:ellipsis;font-family:monospace;">${escapeHtml(item.url || '')}</div>
          </div>
          <button class="bm-delete" data-id="${item.id}" style="background:none;border:none;
            color:${C.red};cursor:pointer;font-size:11px;opacity:0.6;padding:2px 6px;"
            title="Delete bookmark">&#10005;</button>
        </div>`
    }).join('')
  }

  function attachBookmarkEvents(tabId, container) {
    // Click bookmark to navigate
    container.querySelectorAll('.bm-item').forEach(el => {
      el.addEventListener('click', (e) => {
        if (e.target.closest('.bm-delete')) return
        const url = el.dataset.url
        if (url) navigate(url)
      })
    })

    // Delete bookmark/folder
    container.querySelectorAll('.bm-delete').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation()
        await window.bookmarksAPI.remove(btn.dataset.id)
        loadTree(document.getElementById(`bm-search-${tabId}`)?.value || '')
      })
    })
  }

  // Search
  const searchInput = document.getElementById(`bm-search-${tabId}`)
  let searchTimeout
  searchInput?.addEventListener('input', () => {
    clearTimeout(searchTimeout)
    searchTimeout = setTimeout(() => loadTree(searchInput.value), 200)
  })

  // Add folder
  document.getElementById(`bm-add-folder-${tabId}`)?.addEventListener('click', async () => {
    const title = prompt('Folder name:')
    if (title) {
      await window.bookmarksAPI.addFolder({ title })
      loadTree()
    }
  })

  // Export
  document.getElementById(`bm-export-${tabId}`)?.addEventListener('click', async () => {
    const json = await window.bookmarksAPI.export()
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'flux-bookmarks.json'
    a.click()
    URL.revokeObjectURL(url)
  })

  // Import
  const importBtn = document.getElementById(`bm-import-${tabId}`)
  const importFile = document.getElementById(`bm-import-file-${tabId}`)
  importBtn?.addEventListener('click', () => importFile?.click())
  importFile?.addEventListener('change', async (e) => {
    const file = e.target.files[0]
    if (!file) return
    const text = await file.text()
    const result = await window.bookmarksAPI.import(text)
    if (result.success) {
      loadTree()
    } else {
      alert('Import failed: ' + result.error)
    }
  })

  // Live updates
  window.bookmarksAPI.onUpdated(() => {
    const container = document.getElementById(`bm-tree-${tabId}`)
    if (container) loadTree(document.getElementById(`bm-search-${tabId}`)?.value || '')
  })

  loadTree()
}

// ── flux://history ────────────────────────────────────────

function renderHistoryPage(tabId) {
  const C = PAGE_COLORS
  const page = createInternalPage(tabId, 'flux-history')

  page.innerHTML = `
    ${pageHeader('Browsing History', 'flux://history · Local History Browser', 'Stored locally · Never transmitted')}

    <!-- Toolbar -->
    <div style="display:flex;gap:10px;margin-bottom:20px;flex-wrap:wrap;align-items:center;">
      <input id="hist-search-${tabId}" type="text" placeholder="Search history by title or URL..."
        style="flex:1;min-width:200px;padding:8px 14px;background:rgba(12,8,20,0.7);
        border:1px solid ${C.border};border-radius:8px;color:${C.text};font-size:12px;outline:none;" />
      <select id="hist-clear-range-${tabId}" style="padding:8px 12px;background:rgba(12,8,20,0.7);
        border:1px solid ${C.border};border-radius:8px;color:${C.text};font-size:11px;outline:none;cursor:pointer;">
        <option value="">Clear...</option>
        <option value="1h">Last hour</option>
        <option value="24h">Last 24 hours</option>
        <option value="7d">Last 7 days</option>
        <option value="30d">Last 30 days</option>
        <option value="all">All history</option>
      </select>
    </div>

    <!-- Stats -->
    <div id="hist-stats-${tabId}" style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:24px;"></div>

    <!-- History grouped by date -->
    <div id="hist-list-${tabId}" style="min-height:200px;">
      <div style="text-align:center;padding:40px 0;color:${C.muted};font-size:13px;">Loading history...</div>
    </div>

    ${pageFooter()}
  `

  mountInternalPage(tabId, page)
  setupHistoryPageLogic(tabId)
}

async function setupHistoryPageLogic(tabId) {
  const C = PAGE_COLORS

  async function loadHistory(searchQuery = '') {
    const container = document.getElementById(`hist-list-${tabId}`)
    const statsEl   = document.getElementById(`hist-stats-${tabId}`)
    if (!container) return

    // Load stats
    const stats = await window.historyAPI.getStats()
    if (statsEl) {
      statsEl.innerHTML = `
        <div style="padding:16px;background:rgba(12,8,20,0.7);border:1px solid ${C.border};
          border-left:3px solid ${C.accent2};border-radius:10px;text-align:center;">
          <div style="font-size:28px;font-weight:800;color:${C.accent2};margin-bottom:4px;">${stats.totalEntries}</div>
          <div style="font-size:11px;color:${C.muted};text-transform:uppercase;letter-spacing:1px;">Pages Visited</div>
        </div>
        <div style="padding:16px;background:rgba(12,8,20,0.7);border:1px solid ${C.border};
          border-left:3px solid ${C.accent};border-radius:10px;text-align:center;">
          <div style="font-size:28px;font-weight:800;color:${C.accent};margin-bottom:4px;">${stats.uniqueDomains}</div>
          <div style="font-size:11px;color:${C.muted};text-transform:uppercase;letter-spacing:1px;">Unique Domains</div>
        </div>
        <div style="padding:16px;background:rgba(12,8,20,0.7);border:1px solid ${C.border};
          border-left:3px solid ${C.green};border-radius:10px;text-align:center;">
          <div style="font-size:28px;font-weight:800;color:${C.green};margin-bottom:4px;">&#8734;</div>
          <div style="font-size:11px;color:${C.muted};text-transform:uppercase;letter-spacing:1px;">Local Only</div>
        </div>`
    }

    let html = ''
    if (searchQuery) {
      const results = await window.historyAPI.search(searchQuery)
      if (results.length === 0) {
        container.innerHTML = `<div style="text-align:center;padding:60px 0;color:${C.muted};font-size:13px;">
          No results for "${escapeHtml(searchQuery)}"</div>`
        return
      }
      html = results.map(e => historyEntryHTML(e)).join('')
    } else {
      const groups = await window.historyAPI.getGrouped(500)
      if (!groups || groups.length === 0) {
        container.innerHTML = `<div style="text-align:center;padding:60px 0;color:${C.muted};font-size:13px;">
          No browsing history yet.</div>`
        return
      }
      html = groups.map(group => `
        <div style="margin-bottom:20px;">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
            <div style="font-size:11px;font-weight:700;letter-spacing:2px;color:${C.accent2};
              text-transform:uppercase;">${escapeHtml(group.label)} (${group.entries.length})</div>
            <button class="hist-clear-date" data-date="${group.date}" style="font-size:10px;padding:3px 10px;
              background:${C.red}18;border:1px solid ${C.red}33;border-radius:6px;color:${C.red};
              cursor:pointer;">Clear day</button>
          </div>
          ${group.entries.map(e => historyEntryHTML(e)).join('')}
        </div>`
      ).join('')
    }

    container.innerHTML = html
    attachHistoryEvents(tabId, container)
  }

  function historyEntryHTML(entry) {
    const time = new Date(entry.visitedAt).toLocaleTimeString('en-US', { hour:'2-digit', minute:'2-digit' })
    return `
      <div style="display:flex;align-items:center;gap:12px;padding:10px 14px;
        background:rgba(12,8,20,0.4);border:1px solid ${C.border};border-radius:8px;
        margin-bottom:3px;cursor:pointer;transition:background 0.15s;"
        class="hist-entry" data-url="${escapeHtml(entry.url)}" data-id="${entry.id}"
        onmouseenter="this.style.background='rgba(140,60,255,0.08)'"
        onmouseleave="this.style.background='rgba(12,8,20,0.4)'">
        <span style="font-size:10px;color:${C.muted};min-width:55px;font-family:monospace;">${time}</span>
        <div style="flex:1;min-width:0;">
          <div style="font-size:12px;font-weight:600;color:${C.text};white-space:nowrap;overflow:hidden;
            text-overflow:ellipsis;">${escapeHtml(entry.title)}</div>
          <div style="font-size:10px;color:${C.muted};white-space:nowrap;overflow:hidden;
            text-overflow:ellipsis;font-family:monospace;">${escapeHtml(entry.url)}</div>
        </div>
        <button class="hist-delete" data-id="${entry.id}" style="background:none;border:none;
          color:${C.red};cursor:pointer;font-size:11px;opacity:0.6;padding:2px 6px;"
          title="Remove entry">&#10005;</button>
      </div>`
  }

  function attachHistoryEvents(tabId, container) {
    container.querySelectorAll('.hist-entry').forEach(el => {
      el.addEventListener('click', (e) => {
        if (e.target.closest('.hist-delete')) return
        navigate(el.dataset.url)
      })
    })

    container.querySelectorAll('.hist-delete').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation()
        await window.historyAPI.remove(btn.dataset.id)
        loadHistory(document.getElementById(`hist-search-${tabId}`)?.value || '')
      })
    })

    container.querySelectorAll('.hist-clear-date').forEach(btn => {
      btn.addEventListener('click', async () => {
        await window.historyAPI.clearByDate(btn.dataset.date)
        loadHistory(document.getElementById(`hist-search-${tabId}`)?.value || '')
      })
    })
  }

  // Search
  const searchInput = document.getElementById(`hist-search-${tabId}`)
  let searchTimeout
  searchInput?.addEventListener('input', () => {
    clearTimeout(searchTimeout)
    searchTimeout = setTimeout(() => loadHistory(searchInput.value), 200)
  })

  // Clear range
  document.getElementById(`hist-clear-range-${tabId}`)?.addEventListener('change', async (e) => {
    const val = e.target.value
    if (!val) return
    e.target.value = ''

    if (val === 'all') {
      if (confirm('Clear all browsing history?')) {
        await window.historyAPI.clearAll()
        loadHistory()
      }
      return
    }

    const ranges = { '1h': 3600000, '24h': 86400000, '7d': 604800000, '30d': 2592000000 }
    const ms = ranges[val]
    if (ms) {
      await window.historyAPI.clearOlderThan(Date.now() - ms)
      loadHistory()
    }
  })

  // Live updates
  window.historyAPI.onUpdated(() => {
    const container = document.getElementById(`hist-list-${tabId}`)
    if (container) loadHistory(document.getElementById(`hist-search-${tabId}`)?.value || '')
  })

  loadHistory()
}

// ── flux://settings ───────────────────────────────────────

function renderSettingsPage(tabId) {
  const C = PAGE_COLORS
  const page = createInternalPage(tabId, 'flux-settings')

  page.innerHTML = `
    ${pageHeader('Settings', 'flux://settings · Browser Preferences', 'Stored locally · Fully customizable')}

    <div id="settings-content-${tabId}" style="min-height:200px;">
      <div style="text-align:center;padding:40px 0;color:${C.muted};font-size:13px;">Loading settings...</div>
    </div>

    ${pageFooter()}
  `

  mountInternalPage(tabId, page)
  setupSettingsPageLogic(tabId)
}

async function setupSettingsPageLogic(tabId) {
  const C = PAGE_COLORS
  const container = document.getElementById(`settings-content-${tabId}`)
  if (!container) return

  const settings = await window.settingsAPI.getAll()
  const defaults = await window.settingsAPI.getDefaults()
  const engines  = await window.settingsAPI.getSearchEngines()

  function settingRow(label, description, inputHTML) {
    return `
      <div style="display:flex;align-items:center;justify-content:space-between;
        padding:14px 18px;background:rgba(12,8,20,0.6);border:1px solid ${C.border};
        border-radius:10px;margin-bottom:6px;">
        <div style="flex:1;min-width:0;">
          <div style="font-size:13px;font-weight:600;color:${C.text};">${label}</div>
          <div style="font-size:11px;color:${C.muted};margin-top:2px;">${description}</div>
        </div>
        <div style="flex-shrink:0;margin-left:20px;">${inputHTML}</div>
      </div>`
  }

  function selectInput(id, value, options) {
    const opts = options.map(o =>
      `<option value="${o.value}" ${o.value === value ? 'selected' : ''}>${o.label}</option>`
    ).join('')
    return `<select id="${id}" style="padding:6px 12px;background:rgba(12,8,20,0.7);
      border:1px solid ${C.border};border-radius:6px;color:${C.text};font-size:12px;
      outline:none;cursor:pointer;min-width:140px;">${opts}</select>`
  }

  function textInput(id, value, placeholder = '') {
    return `<input id="${id}" type="text" value="${escapeHtml(value || '')}" placeholder="${placeholder}"
      style="padding:6px 12px;background:rgba(12,8,20,0.7);border:1px solid ${C.border};
      border-radius:6px;color:${C.text};font-size:12px;outline:none;min-width:200px;" />`
  }

  function numberInput(id, value, min, max, step = 1) {
    return `<input id="${id}" type="number" value="${value}" min="${min}" max="${max}" step="${step}"
      style="padding:6px 12px;background:rgba(12,8,20,0.7);border:1px solid ${C.border};
      border-radius:6px;color:${C.text};font-size:12px;outline:none;width:80px;" />`
  }

  function toggleInput(id, checked) {
    return `<button id="${id}" data-checked="${checked}" style="width:44px;height:24px;
      border-radius:12px;border:1px solid ${checked ? C.green + '66' : C.border};cursor:pointer;
      background:${checked ? C.green + '33' : 'rgba(12,8,20,0.7)'};position:relative;transition:all 0.2s;">
      <span style="position:absolute;top:2px;${checked ? 'right:2px' : 'left:2px'};width:18px;height:18px;
        border-radius:50%;background:${checked ? C.green : C.muted};transition:all 0.2s;"></span>
    </button>`
  }

  function sectionLabel(text) {
    return `<div style="font-size:10px;font-weight:700;letter-spacing:3px;color:${C.accent2};
      text-transform:uppercase;margin:24px 0 12px;">${text}</div>`
  }

  const engineOpts = Object.keys(engines).map(k => ({
    value: k, label: k.charAt(0).toUpperCase() + k.slice(1)
  }))

  container.innerHTML = `
    ${sectionLabel('Appearance')}
    ${settingRow('Theme', 'Choose the visual theme for the browser',
      selectInput(`set-theme-${tabId}`, settings.theme, [
        { value: 'dark', label: 'Dark' },
        { value: 'light', label: 'Light' },
        { value: 'system', label: 'System' },
      ])
    )}
    ${settingRow('Accent Color', 'Primary accent color for UI elements',
      `<input id="set-accent-${tabId}" type="color" value="${settings.accentColor}"
        style="width:40px;height:30px;border:1px solid ${C.border};border-radius:6px;
        background:transparent;cursor:pointer;" />`
    )}

    ${sectionLabel('Startup')}
    ${settingRow('Start Page', 'What to show when the browser starts',
      selectInput(`set-startpage-${tabId}`, settings.startPage, [
        { value: 'newtab', label: 'New Tab Page' },
        { value: 'homepage', label: 'Home Page' },
        { value: 'last-session', label: 'Last Session' },
      ])
    )}
    ${settingRow('Home Page', 'URL used as the home page',
      textInput(`set-homepage-${tabId}`, settings.homePage, 'https://example.com')
    )}

    ${sectionLabel('Search')}
    ${settingRow('Search Engine', 'Default search engine for URL bar queries',
      selectInput(`set-engine-${tabId}`, settings.searchEngine, engineOpts)
    )}

    ${sectionLabel('Typography & Zoom')}
    ${settingRow('Font Family', 'Primary font for browser UI',
      textInput(`set-font-${tabId}`, settings.fontFamily)
    )}
    ${settingRow('Font Size', 'Base font size in pixels',
      numberInput(`set-fontsize-${tabId}`, settings.fontSize, 10, 24)
    )}
    ${settingRow('Zoom Level', 'Page zoom level (50% – 200%)',
      numberInput(`set-zoom-${tabId}`, settings.zoomLevel, 50, 200, 10)
    )}

    ${sectionLabel('Privacy')}
    ${settingRow('Clear Data on Exit', 'Automatically clear browsing data when closing the browser',
      toggleInput(`set-clearonexit-${tabId}`, settings.clearDataOnExit)
    )}
    ${settingRow('Block Third-Party Cookies', 'Block cookies set by third-party domains',
      toggleInput(`set-block3p-${tabId}`, settings.blockThirdPartyCookies)
    )}

    ${sectionLabel('Downloads')}
    ${settingRow('Download Path', 'Default folder for file downloads (empty = system default)',
      textInput(`set-dlpath-${tabId}`, settings.downloadPath, 'System default')
    )}
    ${settingRow('Ask for Download Path', 'Ask where to save each downloaded file',
      toggleInput(`set-askdl-${tabId}`, settings.askDownloadPath)
    )}

    ${sectionLabel('Tabs')}
    ${settingRow('Switch to New Tab', 'Automatically switch to newly opened tabs',
      toggleInput(`set-switchtab-${tabId}`, settings.switchToNewTab)
    )}

    <!-- Reset -->
    <div style="margin-top:30px;text-align:center;">
      <button id="set-reset-${tabId}" style="padding:10px 24px;background:${C.red}22;
        border:1px solid ${C.red}44;border-radius:8px;color:${C.red};font-size:12px;
        font-weight:600;cursor:pointer;">Reset All to Defaults</button>
    </div>
  `

  // Wire up change events
  function bindSelect(id, key) {
    document.getElementById(id)?.addEventListener('change', (e) => {
      window.settingsAPI.set(key, e.target.value)
    })
  }
  function bindText(id, key) {
    let timeout
    document.getElementById(id)?.addEventListener('input', (e) => {
      clearTimeout(timeout)
      timeout = setTimeout(() => window.settingsAPI.set(key, e.target.value), 400)
    })
  }
  function bindNumber(id, key) {
    document.getElementById(id)?.addEventListener('change', (e) => {
      window.settingsAPI.set(key, parseInt(e.target.value) || defaults[key])
    })
  }
  function bindToggle(id, key) {
    document.getElementById(id)?.addEventListener('click', (e) => {
      const btn = e.currentTarget
      const current = btn.dataset.checked === 'true'
      const next = !current
      window.settingsAPI.set(key, next)
      btn.dataset.checked = String(next)
      btn.style.background = next ? C.green + '33' : 'rgba(12,8,20,0.7)'
      btn.style.borderColor = next ? C.green + '66' : C.border
      const dot = btn.querySelector('span')
      dot.style.left = next ? 'auto' : '2px'
      dot.style.right = next ? '2px' : 'auto'
      dot.style.background = next ? C.green : C.muted
    })
  }
  function bindColor(id, key) {
    document.getElementById(id)?.addEventListener('input', (e) => {
      window.settingsAPI.set(key, e.target.value)
    })
  }

  bindSelect(`set-theme-${tabId}`, 'theme')
  bindColor(`set-accent-${tabId}`, 'accentColor')
  bindSelect(`set-startpage-${tabId}`, 'startPage')
  bindText(`set-homepage-${tabId}`, 'homePage')
  bindSelect(`set-engine-${tabId}`, 'searchEngine')
  bindText(`set-font-${tabId}`, 'fontFamily')
  bindNumber(`set-fontsize-${tabId}`, 'fontSize')
  bindNumber(`set-zoom-${tabId}`, 'zoomLevel')
  bindToggle(`set-clearonexit-${tabId}`, 'clearDataOnExit')
  bindToggle(`set-block3p-${tabId}`, 'blockThirdPartyCookies')
  bindText(`set-dlpath-${tabId}`, 'downloadPath')
  bindToggle(`set-askdl-${tabId}`, 'askDownloadPath')
  bindToggle(`set-switchtab-${tabId}`, 'switchToNewTab')

  // Reset all
  document.getElementById(`set-reset-${tabId}`)?.addEventListener('click', async () => {
    if (confirm('Reset all settings to defaults?')) {
      await window.settingsAPI.resetAll()
      renderSettingsPage(tabId)
    }
  })
}

// ── flux://downloads ──────────────────────────────────────

function renderDownloadsPage(tabId) {
  const C = PAGE_COLORS
  const page = createInternalPage(tabId, 'flux-downloads')

  page.innerHTML = `
    ${pageHeader('Downloads', 'flux://downloads · Download Manager', 'All files stored locally')}

    <!-- Toolbar -->
    <div style="display:flex;gap:10px;margin-bottom:20px;align-items:center;">
      <div style="flex:1;"></div>
      <button id="dl-clear-${tabId}" style="padding:8px 16px;background:${C.red}22;
        border:1px solid ${C.red}44;border-radius:8px;color:${C.red};font-size:11px;
        font-weight:600;cursor:pointer;">Clear Completed</button>
    </div>

    <!-- Download list -->
    <div id="dl-list-${tabId}" style="min-height:200px;">
      <div style="text-align:center;padding:40px 0;color:${C.muted};font-size:13px;">Loading downloads...</div>
    </div>

    ${pageFooter()}
  `

  mountInternalPage(tabId, page)
  setupDownloadsPageLogic(tabId)
}

async function setupDownloadsPageLogic(tabId) {
  const C = PAGE_COLORS

  async function loadDownloads() {
    const container = document.getElementById(`dl-list-${tabId}`)
    if (!container) return

    const items = await window.downloadsAPI.getAll()

    if (!items || items.length === 0) {
      container.innerHTML = `<div style="text-align:center;padding:60px 0;color:${C.muted};font-size:13px;">
        No downloads yet.</div>`
      return
    }

    container.innerHTML = items.map(dl => {
      const statusColors = {
        completed: C.green, in_progress: C.accent, paused: C.yellow,
        cancelled: C.muted, failed: C.red, interrupted: C.orange,
      }
      const statusColor = statusColors[dl.status] || C.muted
      const statusLabel = dl.status.replace('_', ' ')

      const sizeStr = dl.totalBytes > 0
        ? formatBytes(dl.totalBytes)
        : 'Unknown size'

      const progressBar = dl.status === 'in_progress' || dl.status === 'paused'
        ? `<div style="width:100%;height:4px;background:rgba(255,255,255,0.1);border-radius:2px;margin-top:6px;">
            <div style="width:${dl.progress}%;height:100%;background:${statusColor};border-radius:2px;
              transition:width 0.3s;"></div>
          </div>` : ''

      const time = new Date(dl.startedAt).toLocaleString('en-US', {
        month:'short', day:'numeric', hour:'2-digit', minute:'2-digit'
      })

      let actions = ''
      if (dl.status === 'in_progress') {
        actions = `<button class="dl-pause" data-id="${dl.id}" style="font-size:10px;padding:3px 8px;
          background:${C.yellow}22;border:1px solid ${C.yellow}44;border-radius:4px;color:${C.yellow};
          cursor:pointer;">Pause</button>
          <button class="dl-cancel" data-id="${dl.id}" style="font-size:10px;padding:3px 8px;
          background:${C.red}22;border:1px solid ${C.red}44;border-radius:4px;color:${C.red};
          cursor:pointer;">Cancel</button>`
      } else if (dl.status === 'paused') {
        actions = `<button class="dl-resume" data-id="${dl.id}" style="font-size:10px;padding:3px 8px;
          background:${C.green}22;border:1px solid ${C.green}44;border-radius:4px;color:${C.green};
          cursor:pointer;">Resume</button>`
      } else if (dl.status === 'completed') {
        actions = `<button class="dl-open" data-id="${dl.id}" style="font-size:10px;padding:3px 8px;
          background:${C.accent}22;border:1px solid ${C.accent}44;border-radius:4px;color:${C.accent};
          cursor:pointer;">Open</button>
          <button class="dl-folder" data-id="${dl.id}" style="font-size:10px;padding:3px 8px;
          background:${C.accent2}22;border:1px solid ${C.accent2}44;border-radius:4px;color:${C.accent2};
          cursor:pointer;">Show</button>`
      }

      return `
        <div style="display:flex;align-items:center;gap:14px;padding:14px 18px;
          background:rgba(12,8,20,0.5);border:1px solid ${C.border};border-left:3px solid ${statusColor};
          border-radius:10px;margin-bottom:6px;">
          <div style="flex:1;min-width:0;">
            <div style="font-size:13px;font-weight:600;color:${C.text};white-space:nowrap;
              overflow:hidden;text-overflow:ellipsis;">${escapeHtml(dl.fileName)}</div>
            <div style="display:flex;gap:12px;margin-top:4px;font-size:10px;color:${C.muted};">
              <span>${sizeStr}</span>
              <span style="text-transform:capitalize;color:${statusColor};font-weight:600;">${statusLabel}</span>
              ${dl.progress > 0 && dl.status === 'in_progress' ? `<span>${dl.progress}%</span>` : ''}
              <span>${time}</span>
            </div>
            ${progressBar}
          </div>
          <div style="display:flex;gap:6px;flex-shrink:0;">
            ${actions}
            <button class="dl-remove" data-id="${dl.id}" style="font-size:10px;padding:3px 8px;
              background:none;border:1px solid ${C.border};border-radius:4px;color:${C.muted};
              cursor:pointer;" title="Remove from history">&#10005;</button>
          </div>
        </div>`
    }).join('')

    // Wire up action buttons
    container.querySelectorAll('.dl-pause').forEach(btn =>
      btn.addEventListener('click', () => window.downloadsAPI.pause(btn.dataset.id)))
    container.querySelectorAll('.dl-resume').forEach(btn =>
      btn.addEventListener('click', () => window.downloadsAPI.resume(btn.dataset.id)))
    container.querySelectorAll('.dl-cancel').forEach(btn =>
      btn.addEventListener('click', () => window.downloadsAPI.cancel(btn.dataset.id)))
    container.querySelectorAll('.dl-open').forEach(btn =>
      btn.addEventListener('click', () => window.downloadsAPI.openFile(btn.dataset.id)))
    container.querySelectorAll('.dl-folder').forEach(btn =>
      btn.addEventListener('click', () => window.downloadsAPI.showInFolder(btn.dataset.id)))
    container.querySelectorAll('.dl-remove').forEach(btn =>
      btn.addEventListener('click', async () => {
        await window.downloadsAPI.remove(btn.dataset.id)
        loadDownloads()
      }))
  }

  // Clear completed
  document.getElementById(`dl-clear-${tabId}`)?.addEventListener('click', async () => {
    await window.downloadsAPI.clearHistory()
    loadDownloads()
  })

  // Live updates
  window.downloadsAPI.onUpdated(() => {
    const container = document.getElementById(`dl-list-${tabId}`)
    if (container) loadDownloads()
  })
  window.downloadsAPI.onProgress(() => {
    const container = document.getElementById(`dl-list-${tabId}`)
    if (container) loadDownloads()
  })

  loadDownloads()
}

// ── Shared helpers ────────────────────────────────────────

function escapeHtml(str) {
  if (!str) return ''
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;')
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
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

// ── Network Transparency Panel ────────────────────────────

function renderNetworkTransparencyPage(tabId) {
  const tab = getTab(tabId)
  if (!tab) return

  // Remove existing page if any
  const existing = document.getElementById(`network-transparency-${tabId}`)
  if (existing) existing.remove()

  const C = {
    bg: '#060508',
    surface: 'rgba(10,7,14,0.95)',
    border: 'rgba(140,60,255,0.18)',
    accent: '#5ce0ff',
    accent2: '#9b3dff',
    text: '#e8d8ff',
    muted: 'rgba(210,180,255,0.55)',
    green: '#4ade80',
    yellow: '#facc15',
    red: '#f87171',
    orange: '#ff6a00',
    SF: "'Segoe UI',system-ui,-apple-system,sans-serif",
  }

  const page = document.createElement('div')
  page.id = `network-transparency-${tabId}`
  Object.assign(page.style, {
    position: 'absolute',
    inset: '0',
    background: C.bg,
    overflowY: 'auto',
    padding: '40px',
    fontFamily: C.SF,
    color: C.text,
    zIndex: '10',
    boxSizing: 'border-box',
  })

  page.innerHTML = `
    <!-- Header -->
    <div style="display:flex;align-items:flex-start;gap:16px;margin-bottom:32px;
      padding-bottom:20px;border-bottom:1px solid ${C.border};">
      <div>
        <div style="font-size:20px;font-weight:800;color:${C.accent};">
          🌐 Network Transparency Panel
        </div>
        <div style="font-size:12px;color:${C.muted};letter-spacing:1px;margin-top:4px;">
          flux://network-transparency · Complete Request Monitoring
        </div>
      </div>
      <div style="margin-left:auto;padding:6px 14px;background:${C.accent2}10;
        border:1px solid ${C.accent2}33;border-radius:20px;font-size:11px;color:${C.accent2};white-space:nowrap;">
        <span style="display:inline-block;width:6px;height:6px;background:${C.accent2};
          border-radius:50%;box-shadow:0 0 6px ${C.accent2};margin-right:6px;"></span>
        Real-time Monitoring · Zero Telemetry · Local Only
      </div>
    </div>

    <!-- Statistics Grid -->
    <div id="nt-stats-${tabId}" style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:28px;">
      <div style="padding:18px;background:rgba(12,8,20,0.7);border:1px solid ${C.border};
        border-left:3px solid ${C.accent2};border-radius:10px;text-align:center;">
        <div style="font-size:32px;font-weight:800;color:${C.accent2};margin-bottom:6px;" id="nt-total-${tabId}">0</div>
        <div style="font-size:11px;color:${C.muted};text-transform:uppercase;letter-spacing:1px;">Total Requests</div>
      </div>
      <div style="padding:18px;background:rgba(12,8,20,0.7);border:1px solid ${C.border};
        border-left:3px solid ${C.green};border-radius:10px;text-align:center;">
        <div style="font-size:32px;font-weight:800;color:${C.green};margin-bottom:6px;" id="nt-allowed-${tabId}">0</div>
        <div style="font-size:11px;color:${C.muted};text-transform:uppercase;letter-spacing:1px;">Allowed</div>
      </div>
      <div style="padding:18px;background:rgba(12,8,20,0.7);border:1px solid ${C.border};
        border-left:3px solid ${C.red};border-radius:10px;text-align:center;">
        <div style="font-size:32px;font-weight:800;color:${C.red};margin-bottom:6px;" id="nt-blocked-${tabId}">0</div>
        <div style="font-size:11px;color:${C.muted};text-transform:uppercase;letter-spacing:1px;">Blocked</div>
      </div>
      <div style="padding:18px;background:rgba(12,8,20,0.7);border:1px solid ${C.border};
        border-left:3px solid ${C.accent};border-radius:10px;text-align:center;">
        <div style="font-size:32px;font-weight:800;color:${C.accent};margin-bottom:6px;" id="nt-trackers-${tabId}">0</div>
        <div style="font-size:11px;color:${C.muted};text-transform:uppercase;letter-spacing:1px;">Trackers</div>
      </div>
    </div>

    <!-- Filters -->
    <div style="display:flex;gap:12px;margin-bottom:20px;align-items:center;flex-wrap:wrap;">
      <div style="font-size:10px;font-weight:700;letter-spacing:2px;color:${C.accent2};
        text-transform:uppercase;flex-shrink:0;">Filters:</div>

      <select id="nt-filter-type-${tabId}" style="padding:6px 12px;background:rgba(12,8,20,0.7);
        border:1px solid ${C.border};border-radius:6px;color:${C.text};font-size:11px;
        outline:none;cursor:pointer;">
        <option value="all">All Types</option>
        <option value="document">Documents</option>
        <option value="script">Scripts</option>
        <option value="xhr">XHR/Fetch</option>
        <option value="image">Images</option>
        <option value="stylesheet">Stylesheets</option>
        <option value="font">Fonts</option>
        <option value="media">Media</option>
        <option value="websocket">WebSocket</option>
        <option value="tracker">Trackers</option>
      </select>

      <select id="nt-filter-status-${tabId}" style="padding:6px 12px;background:rgba(12,8,20,0.7);
        border:1px solid ${C.border};border-radius:6px;color:${C.text};font-size:11px;
        outline:none;cursor:pointer;">
        <option value="all">All Status</option>
        <option value="allowed">Allowed</option>
        <option value="blocked">Blocked</option>
      </select>

      <input id="nt-filter-domain-${tabId}" type="text" placeholder="Filter by domain..."
        style="flex:1;min-width:200px;padding:6px 12px;background:rgba(12,8,20,0.7);
        border:1px solid ${C.border};border-radius:6px;color:${C.text};font-size:11px;
        outline:none;" />

      <button id="nt-clear-${tabId}" style="padding:6px 16px;background:${C.red}22;
        border:1px solid ${C.red}44;border-radius:6px;color:${C.red};font-size:11px;
        font-weight:600;cursor:pointer;transition:all 0.15s;">
        Clear History
      </button>

      <button id="nt-refresh-${tabId}" style="padding:6px 16px;background:${C.accent}22;
        border:1px solid ${C.accent}44;border-radius:6px;color:${C.accent};font-size:11px;
        font-weight:600;cursor:pointer;transition:all 0.15s;">
        Refresh
      </button>
    </div>

    <!-- Request List Header -->
    <div style="display:grid;grid-template-columns:90px 1fr 110px 70px 100px;gap:12px;
      padding:10px 16px;background:rgba(12,8,20,0.7);border:1px solid ${C.border};
      border-radius:8px 8px 0 0;font-size:10px;font-weight:700;letter-spacing:1px;
      color:${C.muted};text-transform:uppercase;">
      <div>Status</div>
      <div>URL / Domain</div>
      <div>Type</div>
      <div>Method</div>
      <div>Time</div>
    </div>

    <!-- Request List -->
    <div id="nt-requests-${tabId}" style="max-height:600px;overflow-y:auto;
      border:1px solid ${C.border};border-top:none;border-radius:0 0 8px 8px;
      background:rgba(8,5,12,0.5);">
      <div style="text-align:center;padding:40px 0;color:${C.muted};font-size:13px;">
        Loading network data...
      </div>
    </div>

    <!-- Footer -->
    <div style="display:flex;align-items:center;justify-content:space-between;
      padding-top:20px;border-top:1px solid ${C.border};margin-top:20px;
      font-size:11px;color:${C.muted};letter-spacing:0.5px;">
      <span>FLUX Browser — Zero Telemetry · Zero Tracking · Full Control</span>
      <span id="nt-count-${tabId}" style="color:${C.accent};">Loading...</span>
    </div>
  `

  // Hide webview, show network transparency page
  tab.webview.classList.remove('active')
  if (tab.newTabScreen) tab.newTabScreen.classList.add('hidden')
  dom.webviewContainer.appendChild(page)

  // Setup functionality
  setupNetworkTransparencyPage(tabId)
}

function setupNetworkTransparencyPage(tabId) {
  const C = {
    text: '#e8d8ff',
    muted: 'rgba(210,180,255,0.55)',
    green: '#4ade80',
    red: '#f87171',
    yellow: '#facc15',
    border: 'rgba(140,60,255,0.18)',
  }

  let currentFilters = {
    type: 'all',
    status: 'all',
    domain: '',
  }

  // Load and render data
  async function loadAndRender() {
    try {
      const data = await window.networkTransparencyAPI.getHistory()
      const requests = data.requests || []
      const stats = data.stats || {}

      // Update stats
      document.getElementById(`nt-total-${tabId}`).textContent = stats.total || 0
      document.getElementById(`nt-allowed-${tabId}`).textContent = stats.allowed || 0
      document.getElementById(`nt-blocked-${tabId}`).textContent = stats.blocked || 0
      document.getElementById(`nt-trackers-${tabId}`).textContent = stats.trackers || 0

      // Filter requests
      const filtered = requests.filter(req => {
        if (currentFilters.type !== 'all' && req.type !== currentFilters.type && req.category !== currentFilters.type) {
          return false
        }
        if (currentFilters.status !== 'all' && req.status !== currentFilters.status) {
          return false
        }
        if (currentFilters.domain) {
          const search = currentFilters.domain.toLowerCase()
          if (!req.url.toLowerCase().includes(search) &&
              (!req.domain || !req.domain.toLowerCase().includes(search))) {
            return false
          }
        }
        return true
      })

      // Render requests
      renderRequestList(tabId, filtered)

      // Update counter
      document.getElementById(`nt-count-${tabId}`).textContent =
        `Showing ${filtered.length} of ${requests.length} requests`

    } catch (error) {
      console.error('Failed to load network data:', error)
    }
  }

  function renderRequestList(tabId, requests) {
    const listEl = document.getElementById(`nt-requests-${tabId}`)
    if (!listEl) return

    if (requests.length === 0) {
      listEl.innerHTML = `
        <div style="text-align:center;padding:60px 0;color:${C.muted};font-size:13px;">
          No requests to display. Browse a page to see network activity.
        </div>
      `
      return
    }

    // Display first 100 for performance
    const displayed = requests.slice(0, 100)

    listEl.innerHTML = displayed.map(req => {
      const statusColor = req.status === 'allowed' ? C.green : C.red
      const statusBg = req.status === 'allowed' ? `${C.green}18` : `${C.red}18`
      const statusBorder = req.status === 'allowed' ? `${C.green}44` : `${C.red}44`
      const statusText = req.status === 'allowed' ? '✓ Allow' : '✗ Block'

      const typeColor = req.category === 'tracker' ? C.red :
                       req.category === 'internal' ? C.yellow : C.muted

      const domain = req.domain || 'unknown'
      const displayUrl = req.url.length > 70 ? req.url.substring(0, 70) + '...' : req.url

      const timeAgo = formatTimeAgo(req.timestamp)

      return `
        <div style="display:grid;grid-template-columns:90px 1fr 110px 70px 100px;gap:12px;
          padding:12px 16px;border-bottom:1px solid ${C.border};
          transition:background 0.15s;cursor:pointer;" class="nt-request-row"
          onmouseenter="this.style.background='rgba(140,60,255,0.08)'"
          onmouseleave="this.style.background='transparent'"
          title="${req.url}">

          <div>
            <span style="font-size:9px;font-weight:700;padding:3px 7px;border-radius:4px;
              background:${statusBg};color:${statusColor};border:1px solid ${statusBorder};
              text-transform:uppercase;letter-spacing:0.3px;">
              ${statusText}
            </span>
          </div>

          <div style="font-size:11px;color:${C.text};overflow:hidden;text-overflow:ellipsis;">
            <div style="font-weight:600;margin-bottom:2px;">${domain}</div>
            <div style="font-size:10px;color:${C.muted};font-family:monospace;overflow:hidden;
              text-overflow:ellipsis;white-space:nowrap;">
              ${displayUrl}
            </div>
            ${req.reason ? `<div style="font-size:9px;color:${C.red};margin-top:2px;">
              ${req.reason}
            </div>` : ''}
          </div>

          <div>
            <span style="font-size:9px;padding:2px 6px;border-radius:4px;
              background:${typeColor}18;color:${typeColor};border:1px solid ${typeColor}33;
              text-transform:uppercase;letter-spacing:0.5px;">
              ${req.type || 'other'}
            </span>
          </div>

          <div style="font-size:11px;color:${C.muted};font-weight:600;">
            ${req.method || 'GET'}
          </div>

          <div style="font-size:10px;color:${C.muted};">
            ${timeAgo}
          </div>
        </div>
      `
    }).join('')
  }

  function formatTimeAgo(timestamp) {
    const seconds = Math.floor((Date.now() - timestamp) / 1000)
    if (seconds < 5) return 'just now'
    if (seconds < 60) return `${seconds}s ago`
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
    return `${Math.floor(seconds / 86400)}d ago`
  }

  // Event listeners
  document.getElementById(`nt-filter-type-${tabId}`)?.addEventListener('change', (e) => {
    currentFilters.type = e.target.value
    loadAndRender()
  })

  document.getElementById(`nt-filter-status-${tabId}`)?.addEventListener('change', (e) => {
    currentFilters.status = e.target.value
    loadAndRender()
  })

  document.getElementById(`nt-filter-domain-${tabId}`)?.addEventListener('input', (e) => {
    currentFilters.domain = e.target.value
    loadAndRender()
  })

  document.getElementById(`nt-clear-${tabId}`)?.addEventListener('click', async () => {
    if (confirm('Clear all network history?')) {
      await window.networkTransparencyAPI.clear()
      loadAndRender()
    }
  })

  document.getElementById(`nt-refresh-${tabId}`)?.addEventListener('click', () => {
    loadAndRender()
  })

  // Real-time updates
  window.networkTransparencyAPI.onEvent(() => {
    const page = document.getElementById(`network-transparency-${tabId}`)
    if (page && page.style.display !== 'none') {
      loadAndRender()
    }
  })

  // Initial load
  loadAndRender()
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