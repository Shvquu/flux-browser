# Changelog

Alle nennenswerten Änderungen an FLUX Browser werden in dieser Datei dokumentiert.

Das Format basiert auf [Keep a Changelog](https://keepachangelog.com/de/1.0.0/)
und dieses Projekt folgt [Semantic Versioning](https://semver.org/lang/de/).

---

## [Unreleased]

> Geplante Features und Änderungen, die noch nicht veröffentlicht wurden.

### Geplant
- Lesezeichen-Manager mit persistenter Speicherung
- Browserverlauf mit Suchfunktion
- Erweiterungs-Support via `session.loadExtension()`
- Einstellungsseite (Startseite, Suchmaschine, Theme)
- Download-Manager mit Fortschrittsanzeige
- Benutzerdefinierte Quick-Links (hinzufügen / entfernen)
- Dark/Light-Mode-Umschalter
- Zoom-Steuerung (`Ctrl +`, `Ctrl -`, `Ctrl 0`)
- Print-Funktion (`Ctrl + P`)
- Rechtsklick-Kontextmenü

---

## [1.0.0] – 2025-03-13

Erste vollständige Version von FLUX Browser.

### Hinzugefügt

#### Browser-Core
- Vollständiges Tab-System mit dynamischem Erstellen, Schließen und Wechseln
- `<webview>`-basiertes Rendering mit vollständiger Prozess-Isolation
- Vor/Zurück-Navigation mit korrektem History-Tracking
- Reload-Funktion (toggle: Laden abbrechen / Seite neu laden)
- Automatische URL-Erkennung: Domain → HTTPS, Text → Google-Suche
- Neues-Fenster-Request wird als neuer Tab abgefangen (kein OS-Popup)

#### Benutzeroberfläche
- Eigene rahmenlose Titelleiste (`frame: false`) mit Minimize/Maximize/Close
- Futuristisches Cyberpunk-Design – Lila, Cyan, Orange passend zum FLUX-Logo
- Animierter Ladebalken mit Shimmer-Effekt und asymptotischem Fortschritt
- Sicherheitsindikator in der Adressleiste (grün = HTTPS, orange = HTTP)
- Lade-Spinner pro Tab während des Ladevorgangs
- Favicon-Anzeige pro Tab (mit Fallback-Icon)
- Tab-Titel-Anzeige mit Tooltip bei langen Titeln
- Statusleiste mit Hover-URL-Anzeige und Versionsnummer

#### Startseite
- Eigene New-Tab-Seite mit FLUX-Logo (schwebt mit Glow-Effekt)
- Lebende Uhrzeit mit Datum (aktualisiert jede Sekunde)
- Integrierte Suchleiste mit direkter Navigation
- 6 Quick-Link-Kacheln: Google, YouTube, GitHub, Wikipedia, Reddit, X
- Einblend-Animationen beim Öffnen eines neuen Tabs

#### Design-System
- CSS Custom Properties für konsistentes Theming
- Glassmorphism-Effekte auf UI-Elementen
- Neon-Glow auf aktivem Tab (Lila-Cyan-Gradient-Linie)
- Gradient-Text für FLUX-Schriftzug (Lila → Cyan → Weiß)
- Schwebeanimation auf dem Startseiten-Logo
- Scanlinien-Overlay als subtile Hintergrundtextur
- Orbitron (Headings) + JetBrains Mono (URL) + Exo 2 (UI)

#### Sicherheit
- `contextIsolation: true` – JS-Kontexte strikt getrennt
- `nodeIntegration: false` – kein Node.js-Zugriff im Renderer
- `webSecurity: true` – Same-Origin-Policy aktiv
- `allowpopups: false` – keine automatischen Popups
- Content Security Policy für die App-Shell
- `contextBridge`-basierte Preload-Bridge (nur 4 explizite Methoden)

#### Tastenkürzel
- `Ctrl+T` – Neuer Tab
- `Ctrl+W` – Aktiven Tab schließen
- `Ctrl+L` – Adressleiste fokussieren
- `F5` / `Ctrl+R` – Seite neu laden
- `Alt+←` / `Alt+→` – Vor/Zurück
- `Ctrl+1–9` – Tab-Direktwechsel

#### Plattform & Build
- Läuft auf Windows, macOS und Linux ohne Codeänderungen
- `npm start` – Entwicklungsmodus
- Vorbereitung für Electron Forge (`forge.config.js`-Dokumentation)
- `npm run make` – Cross-Platform-Build zu `.exe` / `.dmg` / `.zip`
- App-Icon in der Taskleiste via `icon`-Property in `BrowserWindow`

### Technische Details
- Electron 29.x
- Node.js 18.x+
- Keine externen Runtime-Abhängigkeiten (nur `devDependencies`)
- ~1.400 Zeilen Code verteilt auf 5 Dateien

---

## Versionsschema

FLUX Browser folgt [Semantic Versioning](https://semver.org/):

- **MAJOR** (`1.x.x`) – Inkompatible Änderungen an der Architektur
- **MINOR** (`x.1.x`) – Neue Features, abwärtskompatibel
- **PATCH** (`x.x.1`) – Bugfixes und kleine Verbesserungen

---

[Unreleased]: https://github.com/dein-name/flux-browser/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/dein-name/flux-browser/releases/tag/v1.0.0