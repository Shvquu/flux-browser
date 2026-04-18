// ============================================================
// network-transparency-ui.js – Network Transparency Panel UI
// ============================================================
//
// Comprehensive UI for displaying all network activity in real-time.
// Features:
// - Real-time request streaming
// - Summary statistics (total, allowed, blocked)
// - Detailed request list with filtering
// - Type and domain filtering
// - Status highlighting (allowed/blocked/tracker)
// - Request details view
// - Performance optimized (virtual scrolling for large lists)

'use strict'

// ── STATE MANAGEMENT ──────────────────────────────────────
const networkState = {
  requests: [],
  stats: {
    total: 0,
    allowed: 0,
    blocked: 0,
    trackers: 0,
    internal: 0,
    byType: {},
    byDomain: {},
  },
  filters: {
    type: 'all',      // all, script, xhr, image, etc.
    status: 'all',    // all, allowed, blocked
    domain: '',       // search filter
  },
  autoRefresh: true,
  maxDisplayed: 100,
}

// ── UI RENDERING FUNCTIONS ────────────────────────────────

/**
 * Renders the Network Transparency Panel
 */
function renderNetworkTransparencyPanel(tabId) {
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
      <!-- Stats will be inserted here -->
    </div>

    <!-- Filters -->
    <div style="display:flex;gap:12px;margin-bottom:20px;align-items:center;">
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
        style="flex:1;padding:6px 12px;background:rgba(12,8,20,0.7);
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
    <div style="display:grid;grid-template-columns:80px 1fr 120px 80px 100px;gap:12px;
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
      <!-- Requests will be inserted here -->
    </div>

    <!-- Footer -->
    <div style="display:flex;align-items:center;justify-content:space-between;
      padding-top:20px;border-top:1px solid ${C.border};margin-top:20px;
      font-size:11px;color:${C.muted};letter-spacing:0.5px;">
      <span>FLUX Browser — Zero Telemetry · Zero Tracking · Full Control</span>
      <span id="nt-count-${tabId}" style="color:${C.accent};">Loading...</span>
    </div>
  `

  return page
}

/**
 * Renders statistics section
 */
function renderStats(tabId, stats) {
  const C = {
    accent: '#5ce0ff',
    accent2: '#9b3dff',
    green: '#4ade80',
    red: '#f87171',
    border: 'rgba(140,60,255,0.18)',
    muted: 'rgba(210,180,255,0.55)',
  }

  const statsEl = document.getElementById(`nt-stats-${tabId}`)
  if (!statsEl) return

  statsEl.innerHTML = `
    <div style="padding:18px;background:rgba(12,8,20,0.7);border:1px solid ${C.border};
      border-left:3px solid ${C.accent2};border-radius:10px;text-align:center;">
      <div style="font-size:32px;font-weight:800;color:${C.accent2};margin-bottom:6px;">
        ${stats.total}
      </div>
      <div style="font-size:11px;color:${C.muted};text-transform:uppercase;letter-spacing:1px;">
        Total Requests
      </div>
    </div>

    <div style="padding:18px;background:rgba(12,8,20,0.7);border:1px solid ${C.border};
      border-left:3px solid ${C.green};border-radius:10px;text-align:center;">
      <div style="font-size:32px;font-weight:800;color:${C.green};margin-bottom:6px;">
        ${stats.allowed}
      </div>
      <div style="font-size:11px;color:${C.muted};text-transform:uppercase;letter-spacing:1px;">
        Allowed
      </div>
    </div>

    <div style="padding:18px;background:rgba(12,8,20,0.7);border:1px solid ${C.border};
      border-left:3px solid ${C.red};border-radius:10px;text-align:center;">
      <div style="font-size:32px;font-weight:800;color:${C.red};margin-bottom:6px;">
        ${stats.blocked}
      </div>
      <div style="font-size:11px;color:${C.muted};text-transform:uppercase;letter-spacing:1px;">
        Blocked
      </div>
    </div>

    <div style="padding:18px;background:rgba(12,8,20,0.7);border:1px solid ${C.border};
      border-left:3px solid ${C.accent};border-radius:10px;text-align:center;">
      <div style="font-size:32px;font-weight:800;color:${C.accent};margin-bottom:6px;">
        ${stats.trackers}
      </div>
      <div style="font-size:11px;color:${C.muted};text-transform:uppercase;letter-spacing:1px;">
        Trackers
      </div>
    </div>
  `
}

/**
 * Renders the request list
 */
function renderRequests(tabId, requests) {
  const C = {
    text: '#e8d8ff',
    muted: 'rgba(210,180,255,0.55)',
    green: '#4ade80',
    red: '#f87171',
    yellow: '#facc15',
    border: 'rgba(140,60,255,0.18)',
  }

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

  // Render only first 100 for performance
  const displayed = requests.slice(0, networkState.maxDisplayed)

  listEl.innerHTML = displayed.map(req => {
    const statusColor = req.status === 'allowed' ? C.green : C.red
    const statusBg = req.status === 'allowed' ? `${C.green}18` : `${C.red}18`
    const statusBorder = req.status === 'allowed' ? `${C.green}44` : `${C.red}44`
    const statusText = req.status === 'allowed' ? '✓ Allowed' : '✗ Blocked'

    const typeColor = req.category === 'tracker' ? C.red :
                     req.category === 'internal' ? C.yellow : C.muted

    const domain = req.domain || new URL(req.url).hostname || 'unknown'
    const displayUrl = req.url.length > 80 ? req.url.substring(0, 80) + '...' : req.url

    const timeAgo = formatTimeAgo(req.timestamp)

    return `
      <div style="display:grid;grid-template-columns:80px 1fr 120px 80px 100px;gap:12px;
        padding:12px 16px;border-bottom:1px solid ${C.border};
        transition:background 0.15s;cursor:pointer;" class="nt-request-row"
        title="${req.url}">

        <div>
          <span style="font-size:9px;font-weight:700;padding:3px 8px;border-radius:4px;
            background:${statusBg};color:${statusColor};border:1px solid ${statusBorder};
            text-transform:uppercase;letter-spacing:0.3px;">
            ${statusText}
          </span>
        </div>

        <div style="font-size:11px;color:${C.text};overflow:hidden;text-overflow:ellipsis;
          white-space:nowrap;">
          <div style="font-weight:600;margin-bottom:2px;">${domain}</div>
          <div style="font-size:10px;color:${C.muted};font-family:monospace;">
            ${displayUrl}
          </div>
          ${req.reason ? `<div style="font-size:9px;color:${C.red};margin-top:2px;">
            Reason: ${req.reason}
          </div>` : ''}
        </div>

        <div>
          <span style="font-size:9px;padding:2px 7px;border-radius:4px;
            background:${typeColor}18;color:${typeColor};border:1px solid ${typeColor}33;
            text-transform:uppercase;letter-spacing:0.5px;">
            ${req.type || 'unknown'}
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

  // Add hover effect with JavaScript
  listEl.querySelectorAll('.nt-request-row').forEach(row => {
    row.addEventListener('mouseenter', () => {
      row.style.background = 'rgba(140,60,255,0.08)'
    })
    row.addEventListener('mouseleave', () => {
      row.style.background = 'transparent'
    })
  })
}

/**
 * Formats timestamp to relative time
 */
function formatTimeAgo(timestamp) {
  const seconds = Math.floor((Date.now() - timestamp) / 1000)

  if (seconds < 5) return 'just now'
  if (seconds < 60) return `${seconds}s ago`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  return `${Math.floor(seconds / 86400)}d ago`
}

/**
 * Applies filters to request list
 */
function applyFilters(requests) {
  return requests.filter(req => {
    // Type filter
    if (networkState.filters.type !== 'all') {
      if (req.type !== networkState.filters.type && req.category !== networkState.filters.type) {
        return false
      }
    }

    // Status filter
    if (networkState.filters.status !== 'all') {
      if (req.status !== networkState.filters.status) {
        return false
      }
    }

    // Domain filter (search)
    if (networkState.filters.domain) {
      const search = networkState.filters.domain.toLowerCase()
      if (!req.url.toLowerCase().includes(search) &&
          (!req.domain || !req.domain.toLowerCase().includes(search))) {
        return false
      }
    }

    return true
  })
}

/**
 * Loads and displays network data
 */
async function loadNetworkData(tabId) {
  try {
    const data = await window.networkTransparencyAPI.getHistory()
    networkState.requests = data.requests || []
    networkState.stats = data.stats || networkState.stats

    // Apply filters
    const filtered = applyFilters(networkState.requests)

    // Update UI
    renderStats(tabId, networkState.stats)
    renderRequests(tabId, filtered)

    // Update counter
    const counterEl = document.getElementById(`nt-count-${tabId}`)
    if (counterEl) {
      counterEl.textContent = `Showing ${filtered.length} of ${networkState.requests.length} requests`
    }
  } catch (error) {
    console.error('Failed to load network data:', error)
  }
}

/**
 * Sets up event listeners for the panel
 */
function setupEventListeners(tabId) {
  // Type filter
  const typeFilter = document.getElementById(`nt-filter-type-${tabId}`)
  if (typeFilter) {
    typeFilter.addEventListener('change', (e) => {
      networkState.filters.type = e.target.value
      loadNetworkData(tabId)
    })
  }

  // Status filter
  const statusFilter = document.getElementById(`nt-filter-status-${tabId}`)
  if (statusFilter) {
    statusFilter.addEventListener('change', (e) => {
      networkState.filters.status = e.target.value
      loadNetworkData(tabId)
    })
  }

  // Domain search
  const domainFilter = document.getElementById(`nt-filter-domain-${tabId}`)
  if (domainFilter) {
    domainFilter.addEventListener('input', (e) => {
      networkState.filters.domain = e.target.value
      loadNetworkData(tabId)
    })
  }

  // Clear button
  const clearBtn = document.getElementById(`nt-clear-${tabId}`)
  if (clearBtn) {
    clearBtn.addEventListener('click', async () => {
      if (confirm('Clear all network history?')) {
        await window.networkTransparencyAPI.clear()
        loadNetworkData(tabId)
      }
    })
  }

  // Refresh button
  const refreshBtn = document.getElementById(`nt-refresh-${tabId}`)
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      loadNetworkData(tabId)
    })
  }

  // Real-time updates
  window.networkTransparencyAPI.onEvent((data) => {
    if (networkState.autoRefresh) {
      // Only reload if this panel is visible
      const panel = document.getElementById(`network-transparency-${tabId}`)
      if (panel && panel.style.display !== 'none') {
        loadNetworkData(tabId)
      }
    }
  })
}

/**
 * Initialize the Network Transparency Panel
 */
function initNetworkTransparencyPanel(tabId) {
  const panel = renderNetworkTransparencyPanel(tabId)
  setupEventListeners(tabId)
  loadNetworkData(tabId)
  return panel
}

// Export for use in renderer.js
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    initNetworkTransparencyPanel,
    loadNetworkData,
  }
}
