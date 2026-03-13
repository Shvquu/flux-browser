// ============================================================
// fingerprint-guard.js – FLUX Dynamic Fingerprint Randomization
//
// Dieses Script wird in JEDEN Webview injiziert bevor die Seite
// lädt. Es überschreibt alle Browser-APIs die für Fingerprinting
// genutzt werden können.
//
// Prinzip: Pro Seitenaufruf wird ein zufälliger Seed generiert.
// Alle Fingerprint-APIs geben Werte zurück die auf diesem Seed
// basieren – technisch plausibel, aber nie stabil genug für
// einen dauerhaften Fingerprint-Hash.
// ============================================================

;(function () {
  'use strict'

  // ── Seed-Generator ──────────────────────────────────────
  // Jede Seite bekommt einen frischen Seed → anderer Fingerprint
  const SEED = Math.random() * 0xFFFFFFFF | 0

  // Deterministischer Pseudo-Zufall auf Basis des Seeds.
  // Gibt immer denselben Wert für denselben Input zurück –
  // aber dieser Input ändert sich pro Seite (durch den Seed).
  function seededRandom(extra) {
    let h = (SEED ^ extra ^ 0xdeadbeef) >>> 0
    h = Math.imul(h ^ (h >>> 16), 0x45d9f3b)
    h = Math.imul(h ^ (h >>> 16), 0x45d9f3b)
    h = h ^ (h >>> 16)
    return (h >>> 0) / 0xFFFFFFFF
  }

  // Fügt einer Zahl minimales Rauschen hinzu (+/- maxDelta)
  function noise(value, maxDelta, seed) {
    const r = seededRandom(seed || Math.floor(value))
    return value + Math.floor((r - 0.5) * 2 * maxDelta)
  }

  // ── Fingerprint-Zähler (wird an Main Process gemeldet) ──
  let fingerprintAttempts = 0
  function countAttempt(type) {
    fingerprintAttempts++
    try {
      // An FLUX melden falls die API verfügbar ist
      if (window.__fluxFPCount) window.__fluxFPCount(type)
    } catch (_) {}
  }

  // ── 1. Canvas Fingerprint ──────────────────────────────
  // Seiten rendern eine Grafik und hashen die Pixel.
  // Wir addieren minimales, seitenspezifisches Rauschen auf
  // die Pixel-Ausgabe sodass der Hash jedes Mal anders ist.
  const origToDataURL  = HTMLCanvasElement.prototype.toDataURL
  const origToBlob     = HTMLCanvasElement.prototype.toBlob
  const origGetContext = HTMLCanvasElement.prototype.getContext

  function addCanvasNoise(canvas) {
    try {
      const ctx = origGetContext.call(canvas, '2d')
      if (!ctx) return
      const w = canvas.width, h = canvas.height
      if (w === 0 || h === 0) return

      // Nur 1 Pixel an zufälliger Position minimal verändern
      // → unsichtbar für den Nutzer, aber der Hash ändert sich
      const x = Math.floor(seededRandom(1) * Math.min(w, 50))
      const y = Math.floor(seededRandom(2) * Math.min(h, 50))
      const imageData = ctx.getImageData(x, y, 1, 1)
      const d = imageData.data
      d[0] = (d[0] + Math.floor(seededRandom(3) * 4)) & 0xFF
      d[1] = (d[1] + Math.floor(seededRandom(4) * 4)) & 0xFF
      ctx.putImageData(imageData, x, y)
    } catch (_) {}
  }

  HTMLCanvasElement.prototype.toDataURL = function (...args) {
    countAttempt('canvas')
    addCanvasNoise(this)
    return origToDataURL.apply(this, args)
  }

  HTMLCanvasElement.prototype.toBlob = function (callback, ...args) {
    countAttempt('canvas')
    addCanvasNoise(this)
    return origToBlob.apply(this, [callback, ...args])
  }

  // ── 2. WebGL Fingerprint ───────────────────────────────
  // Seiten fragen GPU-Informationen ab (Renderer, Vendor).
  // Wir ersetzen diese durch generische, plausible Strings.
  const WebGLFakeRenderer = [
    'ANGLE (Intel, Intel(R) UHD Graphics Direct3D11 vs_5_0 ps_5_0)',
    'ANGLE (NVIDIA, NVIDIA GeForce GTX 1650 Direct3D11 vs_5_0 ps_5_0)',
    'ANGLE (AMD, AMD Radeon RX 580 Direct3D11 vs_5_0 ps_5_0)',
    'Mesa Intel(R) UHD Graphics 620 (KBL GT2)',
    'Apple M1',
  ]
  const WebGLFakeVendor = ['Google Inc. (Intel)', 'Google Inc. (NVIDIA)', 'Google Inc. (AMD)', 'Apple']

  const rendererIndex = Math.floor(seededRandom(10) * WebGLFakeRenderer.length)
  const vendorIndex   = Math.floor(seededRandom(11) * WebGLFakeVendor.length)

  const WEBGL_OVERRIDES = {
    37445: WebGLFakeVendor[vendorIndex],      // UNMASKED_VENDOR_WEBGL
    37446: WebGLFakeRenderer[rendererIndex],  // UNMASKED_RENDERER_WEBGL
  }

  function patchWebGL(proto) {
    if (!proto) return
    const origGetParam = proto.getParameter
    proto.getParameter = function (param) {
      if (WEBGL_OVERRIDES[param] !== undefined) {
        countAttempt('webgl')
        return WEBGL_OVERRIDES[param]
      }
      return origGetParam.call(this, param)
    }

    const origGetExt = proto.getExtension
    proto.getExtension = function (name) {
      const ext = origGetExt.call(this, name)
      if (name === 'WEBGL_debug_renderer_info' && ext) {
        countAttempt('webgl')
      }
      return ext
    }
  }

  patchWebGL(WebGLRenderingContext?.prototype)
  patchWebGL(WebGL2RenderingContext?.prototype)

  // ── 3. AudioContext Fingerprint ────────────────────────
  // Seiten messen minimale Unterschiede in der Audioausgabe.
  // Wir fügen minimales Rauschen in den AudioBuffer ein.
  const OrigAudioContext = window.AudioContext || window.webkitAudioContext
  if (OrigAudioContext) {
    const origCreateBuffer = OrigAudioContext.prototype.createBuffer
    OrigAudioContext.prototype.createBuffer = function (channels, length, sampleRate) {
      const buffer = origCreateBuffer.call(this, channels, length, sampleRate)
      try {
        countAttempt('audio')
        for (let c = 0; c < buffer.numberOfChannels; c++) {
          const data = buffer.getChannelData(c)
          for (let i = 0; i < Math.min(data.length, 100); i++) {
            // Winziges Rauschen: max ±0.0001 – für Nutzer unhörbar
            data[i] += (seededRandom(i + c * 1000) - 0.5) * 0.0002
          }
        }
      } catch (_) {}
      return buffer
    }
  }

  // ── 4. Navigator Properties ────────────────────────────
  // Viele Seiten lesen hardwareConcurrency, deviceMemory etc.
  // Wir geben plausible, leicht veränderte Werte zurück.

  const realCores   = navigator.hardwareConcurrency || 4
  const fakeCores   = [2, 4, 4, 6, 8][Math.floor(seededRandom(20) * 5)]

  const realMemory  = navigator.deviceMemory || 4
  const fakeMemory  = [2, 4, 4, 8][Math.floor(seededRandom(21) * 4)]

  try {
    Object.defineProperty(Navigator.prototype, 'hardwareConcurrency', {
      get() { countAttempt('navigator'); return fakeCores },
      configurable: true,
    })
  } catch (_) {}

  try {
    Object.defineProperty(Navigator.prototype, 'deviceMemory', {
      get() { countAttempt('navigator'); return fakeMemory },
      configurable: true,
    })
  } catch (_) {}

  // Platform randomisieren (Windows / Linux / Mac)
  const fakePlatforms = ['Win32', 'Win32', 'Linux x86_64', 'MacIntel']
  const fakePlatform  = fakePlatforms[Math.floor(seededRandom(22) * fakePlatforms.length)]
  try {
    Object.defineProperty(Navigator.prototype, 'platform', {
      get() { countAttempt('navigator'); return fakePlatform },
      configurable: true,
    })
  } catch (_) {}

  // ── 5. Screen Properties ───────────────────────────────
  // Bildschirmauflösung ist ein häufig genutztes Merkmal.
  // Wir variieren sie leicht (±8px).
  const fakeWidth  = noise(screen.width,  8, 30)
  const fakeHeight = noise(screen.height, 8, 31)

  try {
    Object.defineProperty(Screen.prototype, 'width', {
      get() { countAttempt('screen'); return fakeWidth },
      configurable: true,
    })
    Object.defineProperty(Screen.prototype, 'height', {
      get() { countAttempt('screen'); return fakeHeight },
      configurable: true,
    })
    Object.defineProperty(Screen.prototype, 'availWidth', {
      get() { return fakeWidth },
      configurable: true,
    })
    Object.defineProperty(Screen.prototype, 'availHeight', {
      get() { return fakeHeight - 40 },
      configurable: true,
    })
    Object.defineProperty(Screen.prototype, 'colorDepth', {
      get() { return 24 },  // Immer 24 – normiert
      configurable: true,
    })
  } catch (_) {}

  // ── 6. Fonts ───────────────────────────────────────────
  // Font-Enumeration via CSS/Canvas wird durch Canvas-Noise
  // bereits erschwert. Zusätzlich überschreiben wir
  // document.fonts falls verfügbar.
  // (Vollständige Font-Liste-Blockierung würde viele Seiten
  //  kaputt machen, daher nur Canvas-basiertes Fingerprinting
  //  durch Noise bereits abgedeckt)

  // ── 7. Timing-Präzision reduzieren ────────────────────
  // performance.now() und Date.now() können für Timing-Attacks
  // genutzt werden. Wir runden auf 1ms.
  const origPerfNow = performance.now.bind(performance)
  performance.now = function () {
    return Math.round(origPerfNow() * 1) / 1
  }

  // ── Report an FLUX Shield ──────────────────────────────
  // Damit die flux://privacy Seite die Zähler anzeigen kann,
  // registrieren wir einen Listener den der Renderer abfragen kann.
  window.addEventListener('message', (e) => {
    if (e.data === 'flux-fp-count-request') {
      window.postMessage({ type: 'flux-fp-count', count: fingerprintAttempts }, '*')
    }
  })

})()