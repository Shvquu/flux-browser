// ============================================================
// network-transparency.js – Network Transparency System
// ============================================================
//
// Captures, analyzes, and logs ALL network requests made by the browser.
// Zero telemetry, zero tracking – all processing happens locally.
//
// Features:
// - Complete request interception (onBeforeRequest, onCompleted, onErrorOccurred)
// - Detailed metadata capture (URL, domain, method, type, status, timing)
// - Configurable blocking based on tracker domains
// - Efficient in-memory logging (circular buffer, max 1000 entries)
// - Real-time IPC streaming to renderer
// - Performance-optimized (non-blocking, efficient data structures)

const { session, BrowserWindow } = require('electron')

// ── REQUEST STORAGE ───────────────────────────────────────
// In-memory circular buffer for request history
// Stores the most recent 1000 requests to prevent memory leaks

const MAX_REQUESTS = 1000
const requestHistory = []  // Array of request objects
let requestIdCounter = 0    // Global counter for unique request IDs

// Map to track in-flight requests by webRequest ID
const inflightRequests = new Map()

// ── TRACKING DOMAINS ──────────────────────────────────────
// Comprehensive list of known tracking and analytics domains
// This list is easily extensible – add more domains as needed

const TRACKER_DOMAINS = [
  // Google Analytics & Ads
  'google-analytics.com',
  'googletagmanager.com',
  'googletagservices.com',
  'doubleclick.net',
  'googlesyndication.com',
  'adservice.google.com',
  'www.google-analytics.com',
  'ssl.google-analytics.com',
  'www.googletagmanager.com',
  'googleadservices.com',

  // Facebook
  'facebook.com/tr',
  'connect.facebook.net',
  'analytics.facebook.com',
  'facebook.net',
  'fbcdn.net',
  'graph.facebook.com',

  // Analytics Services
  'scorecardresearch.com',
  'quantserve.com',
  'hotjar.com',
  'mouseflow.com',
  'fullstory.com',
  'mixpanel.com',
  'amplitude.com',
  'segment.io',
  'segment.com',
  'heap.io',
  'clarity.ms',
  'loggly.com',
  'newrelic.com',
  'nr-data.net',

  // Ad Networks
  'outbrain.com',
  'taboola.com',
  'criteo.com',
  'pubmatic.com',
  'rubiconproject.com',
  'openx.net',
  'adnxs.com',
  'advertising.com',
  'adsafeprotected.com',
  'moatads.com',

  // Social Media Tracking
  'ads.twitter.com',
  'static.ads-twitter.com',
  'analytics.twitter.com',
  'ads.linkedin.com',
  'px.ads.linkedin.com',
  'ads.pinterest.com',
  'analytics.pinterest.com',

  // Microsoft
  'bing.com/bat',
  'clarity.ms',
  'bat.bing.com',

  // Other Trackers
  'crazyegg.com',
  'inspectlet.com',
  'kissmetrics.com',
  'optimizely.com',
  'chartbeat.com',
  'zopim.com',
  'drift.com',
  'intercom.io',
]

// ── HELPER FUNCTIONS ──────────────────────────────────────

/**
 * Generates a unique request ID
 */
function generateRequestId() {
  return `req_${Date.now()}_${++requestIdCounter}`
}

/**
 * Extracts domain from URL
 */
function extractDomain(url) {
  try {
    const urlObj = new URL(url)
    return urlObj.hostname
  } catch {
    return null
  }
}

/**
 * Checks if a URL matches a tracker domain
 */
function isTrackerDomain(url) {
  try {
    const domain = extractDomain(url)
    if (!domain) return false

    return TRACKER_DOMAINS.some(tracker =>
      domain === tracker || domain.endsWith('.' + tracker)
    )
  } catch {
    return false
  }
}

/**
 * Checks if a URL is an internal/chromium request
 */
function isInternalRequest(url) {
  const internalPatterns = [
    'safebrowsing',
    'update.googleapis.com',
    'clients.google.com',
    'chrome-extension://',
    'edge-update',
    'browser.events.data.microsoft',
    'ocsp.',
    'crl.',
  ]
  return internalPatterns.some(pattern => url.includes(pattern))
}

/**
 * Classifies request type for better categorization
 */
function classifyRequest(resourceType, url) {
  if (isTrackerDomain(url)) return 'tracker'
  if (isInternalRequest(url)) return 'internal'

  // Map Electron resourceType to human-readable categories
  const typeMap = {
    'mainFrame': 'document',
    'subFrame': 'subdocument',
    'stylesheet': 'stylesheet',
    'script': 'script',
    'image': 'image',
    'font': 'font',
    'object': 'object',
    'xhr': 'xhr',
    'ping': 'ping',
    'cspReport': 'csp',
    'media': 'media',
    'webSocket': 'websocket',
  }

  return typeMap[resourceType] || resourceType || 'other'
}

/**
 * Adds a request to history (circular buffer)
 */
function addToHistory(request) {
  requestHistory.unshift(request)
  if (requestHistory.length > MAX_REQUESTS) {
    requestHistory.pop()
  }
}

/**
 * Broadcasts request events to all renderer processes
 */
function broadcastRequest(event, request) {
  BrowserWindow.getAllWindows().forEach(win => {
    win.webContents.send('network-transparency-event', { event, request })
  })
}

/**
 * Calculates statistics from request history
 */
function calculateStats() {
  const stats = {
    total: requestHistory.length,
    allowed: 0,
    blocked: 0,
    trackers: 0,
    internal: 0,
    byType: {},
    byDomain: {},
  }

  requestHistory.forEach(req => {
    if (req.status === 'allowed') stats.allowed++
    if (req.status === 'blocked') stats.blocked++
    if (req.category === 'tracker') stats.trackers++
    if (req.category === 'internal') stats.internal++

    // Count by type
    stats.byType[req.type] = (stats.byType[req.type] || 0) + 1

    // Count by domain
    if (req.domain) {
      stats.byDomain[req.domain] = (stats.byDomain[req.domain] || 0) + 1
    }
  })

  return stats
}

// ── NETWORK INTERCEPTION ──────────────────────────────────

/**
 * Sets up network request interception
 * @param {boolean} shieldEnabled - Whether FLUX Shield is active
 */
function setupNetworkInterception(shieldEnabled) {
  const webRequest = session.defaultSession.webRequest

  // ── onBeforeRequest: Intercept and decide to allow/block ──
  webRequest.onBeforeRequest((details, callback) => {
    const {
      id,
      url,
      method,
      resourceType,
      timestamp,
      uploadData,
    } = details

    // Create unique internal request ID
    const requestId = generateRequestId()
    const domain = extractDomain(url)
    const category = classifyRequest(resourceType, url)
    const type = classifyRequest(resourceType, url)

    // Initialize request object
    const request = {
      id: requestId,
      webRequestId: id,
      url,
      domain,
      method,
      type,
      category,
      timestamp: Date.now(),
      startTime: timestamp,
      status: 'pending',
      blocked: false,
      reason: null,
      completed: false,
      error: null,
      statusCode: null,
      responseHeaders: null,
      duration: null,
    }

    // Allow internal browser requests (file://, chrome-extension://)
    if (url.startsWith('file://') || url.startsWith('chrome-extension://')) {
      request.status = 'allowed'
      request.reason = 'Internal browser resource'
      inflightRequests.set(id, request)
      addToHistory(request)
      broadcastRequest('request', request)
      return callback({ cancel: false })
    }

    // ALWAYS block known trackers (regardless of Shield status)
    if (isTrackerDomain(url)) {
      request.status = 'blocked'
      request.blocked = true
      request.reason = 'Known tracking domain'
      request.category = 'tracker'
      inflightRequests.set(id, request)
      addToHistory(request)
      broadcastRequest('blocked', request)
      return callback({ cancel: true })
    }

    // If Shield is enabled, block internal/background requests
    if (shieldEnabled && isInternalRequest(url)) {
      request.status = 'blocked'
      request.blocked = true
      request.reason = 'Background request blocked by FLUX Shield'
      request.category = 'internal'
      inflightRequests.set(id, request)
      addToHistory(request)
      broadcastRequest('blocked', request)
      return callback({ cancel: true })
    }

    // Allow the request
    request.status = 'allowed'
    inflightRequests.set(id, request)
    addToHistory(request)
    broadcastRequest('request', request)
    callback({ cancel: false })
  })

  // ── onCompleted: Request finished successfully ──
  webRequest.onCompleted((details) => {
    const {
      id,
      url,
      statusCode,
      responseHeaders,
      timestamp,
    } = details

    const request = inflightRequests.get(id)
    if (!request) return

    // Update request with completion data
    request.completed = true
    request.statusCode = statusCode
    request.responseHeaders = responseHeaders
    request.duration = timestamp - (request.startTime || timestamp)

    // Update in history (find and replace)
    const historyIndex = requestHistory.findIndex(r => r.id === request.id)
    if (historyIndex !== -1) {
      requestHistory[historyIndex] = request
    }

    // Broadcast completion event
    broadcastRequest('completed', request)

    // Clean up in-flight tracking
    inflightRequests.delete(id)
  })

  // ── onErrorOccurred: Request failed ──
  webRequest.onErrorOccurred((details) => {
    const {
      id,
      url,
      error,
      timestamp,
    } = details

    const request = inflightRequests.get(id)
    if (!request) {
      // Request wasn't tracked (might have been blocked before logging)
      return
    }

    // Update request with error data
    request.completed = true
    request.error = error
    request.duration = timestamp - (request.startTime || timestamp)

    // Update in history
    const historyIndex = requestHistory.findIndex(r => r.id === request.id)
    if (historyIndex !== -1) {
      requestHistory[historyIndex] = request
    }

    // Broadcast error event
    broadcastRequest('error', request)

    // Clean up
    inflightRequests.delete(id)
  })
}

// ── IPC INTERFACE ─────────────────────────────────────────

/**
 * Returns IPC handlers for the network transparency system
 */
function getIpcHandlers() {
  return {
    // Get full request history
    'network-transparency-get-history': () => {
      return {
        requests: requestHistory.slice(0, 100), // Return first 100
        stats: calculateStats(),
        timestamp: Date.now(),
      }
    },

    // Get paginated history
    'network-transparency-get-page': (_, offset = 0, limit = 50) => {
      return {
        requests: requestHistory.slice(offset, offset + limit),
        total: requestHistory.length,
        offset,
        limit,
      }
    },

    // Get statistics only
    'network-transparency-get-stats': () => {
      return calculateStats()
    },

    // Clear history
    'network-transparency-clear': () => {
      requestHistory.length = 0
      inflightRequests.clear()
      requestIdCounter = 0
      return { success: true }
    },

    // Get tracker list
    'network-transparency-get-trackers': () => {
      return TRACKER_DOMAINS
    },

    // Add custom tracker domain
    'network-transparency-add-tracker': (_, domain) => {
      if (domain && !TRACKER_DOMAINS.includes(domain)) {
        TRACKER_DOMAINS.push(domain)
        return { success: true, trackers: TRACKER_DOMAINS }
      }
      return { success: false, error: 'Invalid or duplicate domain' }
    },
  }
}

// ── EXPORTS ───────────────────────────────────────────────

module.exports = {
  setupNetworkInterception,
  getIpcHandlers,
  calculateStats,
  requestHistory,
  TRACKER_DOMAINS,
}
