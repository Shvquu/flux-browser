// ============================================================
// fingerprint-guard.js – FLUX Fingerprint Guard + Trust Network
//
// Läuft als Preload in jedem Webview BEVOR Seiten-JS startet.
// Überschreibt alle Fingerprint-APIs.
//
// Verhalten wird durch window.__fluxTrustConfig gesteuert,
// das der Renderer per executeJavaScript() on dom-ready injiziert.
// Bis die Config ankommt: Standard = anonymize (sicher by default).
//
// Permission-Werte pro API:
//   'anonymize' → Noise/Fakes einfügen (Standard)
//   'allow'     → Originale API durchlassen
//   'block'     → Leere/Null-Werte zurückgeben
// ============================================================

;(function () {
  'use strict'

  // ── Trust Config ─────────────────────────────────────────
  // Wird von renderer.js injiziert. Bis dahin: strict anonymize.
  // Format: { level: 0|1|2, permissions: { canvas, webgl, audio, navigator, screen } }
  function getConfig() {
    return window.__fluxTrustConfig || {
      level: 1,
      permissions: {
        canvas: 'anonymize', webgl: 'anonymize', audio: 'anonymize',
        navigator: 'anonymize', screen: 'anonymize',
      }
    }
  }

  function getPerm(api) {
    return getConfig().permissions?.[api] || 'anonymize'
  }

  // ── Seed-Generator ───────────────────────────────────────
  const SEED = Math.random() * 0xFFFFFFFF | 0

  function seededRandom(extra) {
    let h = (SEED ^ extra ^ 0xdeadbeef) >>> 0
    h = Math.imul(h ^ (h >>> 16), 0x45d9f3b)
    h = Math.imul(h ^ (h >>> 16), 0x45d9f3b)
    return ((h ^ (h >>> 16)) >>> 0) / 0xFFFFFFFF
  }

  function noise(value, maxDelta, seed) {
    return value + Math.floor((seededRandom(seed || Math.floor(value)) - 0.5) * 2 * maxDelta)
  }

  // ── Fingerprint-Versuch reporten ─────────────────────────
  // fingerprint-guard läuft als webview-preload → nutzt ipcRenderer.sendToHost()
  // um den Renderer-Prozess zu informieren (→ renderer.js leitet weiter)
  let reportedAPIs = new Set()
  function reportAttempt(api) {
    // Jeden API-Typ nur einmal pro Seite reporten um Spam zu vermeiden
    if (reportedAPIs.has(api)) return
    reportedAPIs.add(api)
    try {
      const { ipcRenderer } = require('electron')
      ipcRenderer.sendToHost('flux-fp-attempt', api)
    } catch (_) {}
  }

  // ── 1. Canvas ─────────────────────────────────────────────
  const origGetContext = HTMLCanvasElement.prototype.getContext
  const origToDataURL  = HTMLCanvasElement.prototype.toDataURL
  const origToBlob     = HTMLCanvasElement.prototype.toBlob

  function addCanvasNoise(canvas) {
    try {
      const ctx = origGetContext.call(canvas, '2d')
      if (!ctx || canvas.width === 0 || canvas.height === 0) return
      const x = Math.floor(seededRandom(1) * Math.min(canvas.width, 50))
      const y = Math.floor(seededRandom(2) * Math.min(canvas.height, 50))
      const d = ctx.getImageData(x, y, 1, 1)
      d.data[0] = (d.data[0] + Math.floor(seededRandom(3) * 4)) & 0xFF
      d.data[1] = (d.data[1] + Math.floor(seededRandom(4) * 4)) & 0xFF
      ctx.putImageData(d, x, y)
    } catch (_) {}
  }

  HTMLCanvasElement.prototype.toDataURL = function (...args) {
    reportAttempt('canvas')
    const p = getPerm('canvas')
    if (p === 'allow') return origToDataURL.apply(this, args)
    if (p === 'block') return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
    addCanvasNoise(this)
    return origToDataURL.apply(this, args)
  }

  HTMLCanvasElement.prototype.toBlob = function (callback, ...args) {
    reportAttempt('canvas')
    const p = getPerm('canvas')
    if (p !== 'allow' && p !== 'block') addCanvasNoise(this)
    return origToBlob.apply(this, [callback, ...args])
  }

  // ── 2. WebGL ──────────────────────────────────────────────
  const WebGLFakeRenderer = [
    'ANGLE (Intel, Intel(R) UHD Graphics Direct3D11 vs_5_0 ps_5_0)',
    'ANGLE (NVIDIA, NVIDIA GeForce GTX 1650 Direct3D11 vs_5_0 ps_5_0)',
    'ANGLE (AMD, AMD Radeon RX 580 Direct3D11 vs_5_0 ps_5_0)',
    'Mesa Intel(R) UHD Graphics 620 (KBL GT2)',
    'Apple M1',
  ]
  const WebGLFakeVendor = ['Google Inc. (Intel)', 'Google Inc. (NVIDIA)', 'Google Inc. (AMD)', 'Apple']
  const fakeRenderer = WebGLFakeRenderer[Math.floor(seededRandom(10) * WebGLFakeRenderer.length)]
  const fakeVendor   = WebGLFakeVendor[Math.floor(seededRandom(11) * WebGLFakeVendor.length)]

  function patchWebGL(proto) {
    if (!proto) return
    const orig = proto.getParameter
    proto.getParameter = function (param) {
      if (param === 37445 || param === 37446) {
        reportAttempt('webgl')
        const p = getPerm('webgl')
        if (p === 'allow')  return orig.call(this, param)
        if (p === 'block')  return ''
        return param === 37445 ? fakeVendor : fakeRenderer
      }
      return orig.call(this, param)
    }
    const origExt = proto.getExtension
    proto.getExtension = function (name) {
      if (name === 'WEBGL_debug_renderer_info') reportAttempt('webgl')
      return origExt.call(this, name)
    }
  }

  patchWebGL(WebGLRenderingContext?.prototype)
  patchWebGL(WebGL2RenderingContext?.prototype)

  // ── 3. AudioContext ───────────────────────────────────────
  const OrigAudio = window.AudioContext || window.webkitAudioContext
  if (OrigAudio) {
    const origCreateBuffer = OrigAudio.prototype.createBuffer
    OrigAudio.prototype.createBuffer = function (channels, length, sampleRate) {
      const buf = origCreateBuffer.call(this, channels, length, sampleRate)
      reportAttempt('audio')
      const p = getPerm('audio')
      if (p === 'allow' || p === 'block') return buf
      try {
        for (let c = 0; c < buf.numberOfChannels; c++) {
          const data = buf.getChannelData(c)
          for (let i = 0; i < Math.min(data.length, 100); i++) {
            data[i] += (seededRandom(i + c * 1000) - 0.5) * 0.0002
          }
        }
      } catch (_) {}
      return buf
    }
  }

  // ── 4. Navigator ──────────────────────────────────────────
  const realCores  = navigator.hardwareConcurrency || 4
  const realMemory = navigator.deviceMemory || 4
  const fakeCores  = [2, 4, 4, 6, 8][Math.floor(seededRandom(20) * 5)]
  const fakeMemory = [2, 4, 4, 8][Math.floor(seededRandom(21) * 4)]
  const fakePlat   = ['Win32','Win32','Linux x86_64','MacIntel'][Math.floor(seededRandom(22) * 4)]

  function defNav(prop, realVal, fakeVal) {
    try {
      Object.defineProperty(Navigator.prototype, prop, {
        get() {
          reportAttempt('navigator')
          const p = getPerm('navigator')
          if (p === 'allow') return realVal
          if (p === 'block') return undefined
          return fakeVal
        },
        configurable: true,
      })
    } catch (_) {}
  }

  defNav('hardwareConcurrency', realCores,  fakeCores)
  defNav('deviceMemory',        realMemory, fakeMemory)
  defNav('platform',            navigator.platform, fakePlat)

  // ── 5. Screen ─────────────────────────────────────────────
  const fakeW = noise(screen.width,  8, 30)
  const fakeH = noise(screen.height, 8, 31)

  function defScreen(prop, realVal, fakeVal) {
    try {
      Object.defineProperty(Screen.prototype, prop, {
        get() {
          reportAttempt('screen')
          const p = getPerm('screen')
          if (p === 'allow') return realVal
          if (p === 'block') return 0
          return fakeVal
        },
        configurable: true,
      })
    } catch (_) {}
  }

  defScreen('width',       screen.width,        fakeW)
  defScreen('height',      screen.height,       fakeH)
  defScreen('availWidth',  screen.availWidth,   fakeW)
  defScreen('availHeight', screen.availHeight,  fakeH - 40)

  try {
    Object.defineProperty(Screen.prototype, 'colorDepth', { get() { return 24 }, configurable: true })
  } catch (_) {}

  // ── 6. Timing ─────────────────────────────────────────────
  const origNow = performance.now.bind(performance)
  performance.now = () => Math.round(origNow() * 1) / 1

})()