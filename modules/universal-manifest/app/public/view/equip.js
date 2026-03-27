// =============================================================================
// Universal Manifest Equip Screen - Identity Loadout UI
// =============================================================================
// Lightweight SPA that fetches a manifest by UMID from the resolver API
// and renders it as a Destiny 2 inspired equipment loadout screen.
//
// Design references:
//   - Destiny 2 character screen (radial equipment slots)
//   - Cyberpunk 2077 inventory (dark neon accents)
//   - Diablo 4 equipment (color-coded categories)
//
// Dependencies: none (vanilla JS, no framework)
// Target weight: <100KB total page
// =============================================================================

(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Constants
  // ---------------------------------------------------------------------------

  /** Facet metadata: maps facet names to display info and module ownership */
  const FACET_META = {
    // Social (blue)
    publicProfile:   { label: 'Public Profile',   icon: '\u{1F464}', module: 'social',     category: 'Social',      desc: 'Display name, avatar, bio' },
    socialIdentity:  { label: 'Social Identity',  icon: '\u{1F511}', module: 'social',     category: 'Social',      desc: 'DIDs, WebID, protocol keys' },
    socialGraph:     { label: 'Social Graph',     icon: '\u{1F310}', module: 'social',     category: 'Social',      desc: 'Followers, following, groups' },
    protocolStatus:  { label: 'Protocol Status',  icon: '\u{1F4E1}', module: 'social',     category: 'Social',      desc: 'Active protocol connections' },
    // DID Wallet (gold)
    credentials:             { label: 'Credentials',             icon: '\u{1F3AB}', module: 'credential', category: 'DID Wallet',      desc: 'Verifiable credentials' },
    verifiableCredentials:   { label: 'Verifiable Credentials',  icon: '\u{1F4DC}', module: 'credential', category: 'DID Wallet',      desc: 'W3C verifiable credentials' },
    // Spatial Fabric (green)
    spatialAnchors:    { label: 'Spatial Anchors',     icon: '\u{1F4CD}', module: 'spatial',    category: 'Spatial Fabric',  desc: 'Spatial location anchors' },
    placeMembership:   { label: 'Place Membership',    icon: '\u{1F3DB}', module: 'spatial',    category: 'Spatial Fabric',  desc: 'Spatial place memberships' },
    crossWorldProfile: { label: 'Cross-World Profile', icon: '\u{1F30D}', module: 'spatial',    category: 'Spatial Fabric',  desc: 'Cross-world projection' },
  };

  /** All known facet names in display order */
  const FACET_ORDER = [
    'publicProfile', 'socialIdentity', 'socialGraph', 'protocolStatus',
    'credentials', 'verifiableCredentials',
    'spatialAnchors', 'placeMembership', 'crossWorldProfile',
  ];

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  let manifest = null;
  let verificationResult = null;
  let rawJsonVisible = false;
  let activeFacet = null;

  // ---------------------------------------------------------------------------
  // UMID Extraction
  // ---------------------------------------------------------------------------

  /**
   * Extract the UMID from the current URL path.
   * Expects /view/{UMID} or /view/{encoded-UMID}
   */
  function extractUmid() {
    const path = window.location.pathname;
    const prefix = '/view/';
    if (!path.startsWith(prefix)) return null;
    const raw = path.slice(prefix.length);
    if (!raw) return null;
    return decodeURIComponent(raw);
  }

  // ---------------------------------------------------------------------------
  // API Calls
  // ---------------------------------------------------------------------------

  /**
   * Fetch manifest from the resolver API.
   * Uses relative URL so it works on any um.${DOMAIN} host.
   */
  async function fetchManifest(umid) {
    // Encode the UMID for the URL path
    const encoded = encodeURIComponent(umid);
    const resp = await fetch('/' + encoded, {
      headers: { 'Accept': 'application/ld+json' },
    });

    if (!resp.ok) {
      const body = await resp.json().catch(function () { return {}; });
      throw { status: resp.status, message: body.error || resp.statusText, umid: umid };
    }

    return resp.json();
  }

  /**
   * Verify the manifest signature via the API.
   */
  async function verifyManifestSig(manifestData) {
    try {
      const resp = await fetch('/api/um/manifest/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(manifestData),
      });
      return resp.json();
    } catch (_e) {
      return { valid: false, errors: ['Verification service unavailable'] };
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  function getFacetMeta(name) {
    return FACET_META[name] || {
      label: name,
      icon: '\u{2753}',
      module: 'unknown',
      category: 'Custom',
      desc: 'Custom facet',
    };
  }

  function formatDate(iso) {
    if (!iso) return '--';
    try {
      var d = new Date(iso);
      return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
           + ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    } catch (_e) {
      return iso;
    }
  }

  function computeTTL(expiresAt) {
    if (!expiresAt) return { text: '--', expired: false };
    var now = Date.now();
    var expires = Date.parse(expiresAt);
    if (!isFinite(expires)) return { text: '--', expired: false };
    var diff = expires - now;
    if (diff <= 0) return { text: 'Expired', expired: true };
    var hours = Math.floor(diff / 3600000);
    var mins = Math.floor((diff % 3600000) / 60000);
    if (hours > 0) return { text: hours + 'h ' + mins + 'm', expired: false };
    return { text: mins + 'm', expired: false };
  }

  function truncate(str, len) {
    if (!str) return '';
    if (str.length <= len) return str;
    return str.slice(0, len) + '...';
  }

  /** Get a summary string for a facet entity */
  function facetSummary(facet) {
    var ent = facet.entity;
    if (!ent) return 'No data';

    // publicProfile
    if (facet.name === 'publicProfile') {
      var parts = [];
      if (ent.displayName || ent.name) parts.push(ent.displayName || ent.name);
      if (ent.bio) parts.push(truncate(ent.bio, 40));
      return parts.join(' - ') || 'Profile data';
    }
    // socialIdentity
    if (facet.name === 'socialIdentity') {
      var ids = [];
      if (ent.dids && Array.isArray(ent.dids)) ids.push(ent.dids.length + ' DIDs');
      if (ent.webId) ids.push('WebID');
      if (ent.protocolKeys) ids.push(Object.keys(ent.protocolKeys).length + ' keys');
      return ids.join(', ') || 'Identity data';
    }
    // socialGraph
    if (facet.name === 'socialGraph') {
      var g = [];
      if (ent.followersCount != null) g.push(ent.followersCount + ' followers');
      if (ent.followingCount != null) g.push(ent.followingCount + ' following');
      return g.join(', ') || 'Graph data';
    }
    // protocolStatus
    if (facet.name === 'protocolStatus') {
      if (ent.protocols && Array.isArray(ent.protocols)) {
        var active = ent.protocols.filter(function (p) { return p.active || p.status === 'active'; });
        return active.length + '/' + ent.protocols.length + ' protocols active';
      }
      return 'Protocol data';
    }
    // credentials
    if (facet.name === 'credentials' || facet.name === 'verifiableCredentials') {
      if (Array.isArray(ent)) return ent.length + ' credential(s)';
      if (ent.credentials && Array.isArray(ent.credentials)) return ent.credentials.length + ' credential(s)';
      return 'Credential data';
    }
    // spatial
    if (facet.name === 'spatialAnchors') {
      if (Array.isArray(ent)) return ent.length + ' anchor(s)';
      if (ent.anchors && Array.isArray(ent.anchors)) return ent.anchors.length + ' anchor(s)';
      return 'Spatial data';
    }
    if (facet.name === 'placeMembership') {
      if (Array.isArray(ent)) return ent.length + ' place(s)';
      if (ent.places && Array.isArray(ent.places)) return ent.places.length + ' place(s)';
      return 'Place data';
    }

    // Fallback: count keys
    if (typeof ent === 'object') {
      return Object.keys(ent).length + ' field(s)';
    }
    return String(ent);
  }

  // ---------------------------------------------------------------------------
  // SVG Icons (inline, no external deps)
  // ---------------------------------------------------------------------------

  var ICONS = {
    check: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3.5 8.5 6.5 11.5 12.5 4.5"/></svg>',
    x: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="4" x2="12" y2="12"/><line x1="12" y1="4" x2="4" y2="12"/></svg>',
    warning: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2L1 14h14L8 2z"/><line x1="8" y1="6" x2="8" y2="9"/><circle cx="8" cy="11.5" r="0.5" fill="currentColor"/></svg>',
    chevron: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 4 10 8 6 12"/></svg>',
    download: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2v8M4 7l4 4 4-4M2 13h12"/></svg>',
    code: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="5 4 1 8 5 12"/><polyline points="11 4 15 8 11 12"/></svg>',
    close: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="4" x2="12" y2="12"/><line x1="12" y1="4" x2="4" y2="12"/></svg>',
  };

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------

  var root = document.getElementById('app');

  function render() {
    if (!manifest) {
      root.innerHTML = renderLoading();
      return;
    }
    root.innerHTML = renderEquipScreen();
    bindEvents();
    startCountdown();
  }

  function renderLoading() {
    return '<div class="loading-screen">'
      + '<div class="loading-spinner"></div>'
      + '<div class="loading-text">Resolving identity...</div>'
      + '</div>';
  }

  function renderError(err) {
    var statusText = '';
    if (err.status === 404) statusText = 'Identity Not Found';
    else if (err.status === 410) statusText = 'Identity Revoked';
    else if (err.status === 400) statusText = 'Invalid UMID';
    else statusText = 'Resolution Failed';

    root.innerHTML = '<div class="error-screen">'
      + '<div class="error-code">' + (err.status || 'ERR') + '</div>'
      + '<div class="error-message">' + escapeHtml(statusText) + '</div>'
      + '<div class="error-message" style="font-size:0.875rem;margin-top:4px">' + escapeHtml(err.message || '') + '</div>'
      + (err.umid ? '<div class="error-umid">' + escapeHtml(err.umid) + '</div>' : '')
      + '</div>';
  }

  function renderEquipScreen() {
    var m = manifest;
    var facets = m.facets || [];
    var facetMap = {};
    facets.forEach(function (f) { if (f.name) facetMap[f.name] = f; });

    // Extract profile info for the identity center
    var profileFacet = facetMap['publicProfile'];
    var profileEnt = profileFacet && profileFacet.entity ? profileFacet.entity : {};
    var displayName = profileEnt.displayName || profileEnt.name || 'Unknown Identity';
    var avatarUrl = profileEnt.avatar || profileEnt.image || profileEnt.avatarUrl || '';

    // Group facets by category
    var categories = buildCategories(facetMap);

    // Signature status
    var sigHtml = renderSigStatus();

    // TTL
    var ttl = computeTTL(m.expiresAt);

    var html = '<div class="equip-screen">';

    // Identity Center
    html += '<div class="identity-center">';
    html += '<div class="avatar-container">';
    html += '<div class="avatar-glow"></div>';
    if (avatarUrl) {
      html += '<img class="avatar-img" src="' + escapeAttr(avatarUrl) + '" alt="Identity avatar" onerror="this.src=\'/view/fallback-avatar.svg\'">';
    } else {
      html += '<img class="avatar-img" src="/view/fallback-avatar.svg" alt="Identity silhouette">';
    }
    html += '</div>'; // avatar-container
    html += '<div class="identity-name">' + escapeHtml(displayName) + '</div>';
    html += '<div class="identity-subject">' + escapeHtml(m.subject || m['@id'] || '') + '</div>';
    html += sigHtml;
    html += '</div>'; // identity-center

    // Facet Grid
    html += '<div class="facet-grid">';
    categories.forEach(function (cat) {
      html += '<div class="facet-category ' + cat.module + '">' + escapeHtml(cat.label) + '</div>';
      cat.facets.forEach(function (fInfo) {
        var meta = fInfo.meta;
        var facet = fInfo.facet;
        var equipped = !!facet;
        var slotClass = 'facet-slot ' + meta.module + (equipped ? ' equipped' : ' empty');
        var summary = equipped ? facetSummary(facet) : 'Not equipped';

        html += '<div class="' + slotClass + '" data-facet="' + escapeAttr(fInfo.name) + '">';
        html += '<div class="slot-icon ' + meta.module + '">' + meta.icon + '</div>';
        html += '<div class="slot-content">';
        html += '<div class="slot-name">' + escapeHtml(meta.label) + '</div>';
        if (equipped) {
          html += '<div class="slot-summary">' + escapeHtml(summary) + '</div>';
        } else {
          html += '<div class="slot-empty-label">Not equipped</div>';
        }
        html += '</div>'; // slot-content
        html += '<div class="slot-badge ' + (equipped ? 'equipped' : 'empty') + '">' + (equipped ? 'Equipped' : 'Empty') + '</div>';
        html += '<div class="slot-chevron">' + ICONS.chevron + '</div>';
        html += '</div>'; // facet-slot
      });
    });

    // Render any unknown/custom facets not in FACET_ORDER
    var knownNames = {};
    FACET_ORDER.forEach(function (n) { knownNames[n] = true; });
    var customFacets = facets.filter(function (f) { return f.name && !knownNames[f.name]; });
    if (customFacets.length > 0) {
      html += '<div class="facet-category unknown">Custom Facets</div>';
      customFacets.forEach(function (facet) {
        var meta = getFacetMeta(facet.name);
        html += '<div class="facet-slot unknown equipped" data-facet="' + escapeAttr(facet.name) + '">';
        html += '<div class="slot-icon unknown">' + meta.icon + '</div>';
        html += '<div class="slot-content">';
        html += '<div class="slot-name">' + escapeHtml(meta.label) + '</div>';
        html += '<div class="slot-summary">' + escapeHtml(facetSummary(facet)) + '</div>';
        html += '</div>';
        html += '<div class="slot-badge equipped">Equipped</div>';
        html += '<div class="slot-chevron">' + ICONS.chevron + '</div>';
        html += '</div>';
      });
    }

    html += '</div>'; // facet-grid

    // Metadata Bar
    html += '<div class="metadata-bar">';
    html += '<div class="metadata-grid">';
    html += metaItem('UMID', m['@id'] || '--', 'umid-val');
    html += metaItem('Issued', formatDate(m.issuedAt));
    html += metaItem('Expires', formatDate(m.expiresAt));
    html += metaItem('TTL', '<span class="ttl-countdown' + (ttl.expired ? ' expired' : '') + '" id="ttl-display">' + ttl.text + '</span>');
    html += metaItem('Version', m.manifestVersion || '--');
    html += metaItem('Facets', (facets.length || 0) + ' equipped');
    html += '</div>'; // metadata-grid
    html += '</div>'; // metadata-bar

    // Action Buttons
    html += '<div class="actions-bar">';
    html += '<button class="btn" id="btn-export"><span class="btn-icon">' + ICONS.download + '</span> Export .um.json</button>';
    html += '<button class="btn" id="btn-raw-json"><span class="btn-icon">' + ICONS.code + '</span> View Raw JSON</button>';
    html += '</div>';

    // Raw JSON (hidden by default)
    html += '<div class="raw-json-container" id="raw-json-container">';
    html += '<div class="raw-json-header">';
    html += '<span class="raw-json-label">Raw Manifest JSON</span>';
    html += '</div>';
    html += '<pre class="raw-json-block" id="raw-json-block"></pre>';
    html += '</div>';

    html += '</div>'; // equip-screen

    // Detail Panel Overlay
    html += '<div class="detail-overlay" id="detail-overlay"></div>';
    html += '<div class="detail-panel" id="detail-panel">';
    html += '<div class="detail-header">';
    html += '<div class="detail-title" id="detail-title">Facet Detail</div>';
    html += '<button class="detail-close" id="detail-close">' + ICONS.close + '</button>';
    html += '</div>';
    html += '<div class="detail-body" id="detail-body"></div>';
    html += '</div>';

    return html;
  }

  function buildCategories(facetMap) {
    var cats = [
      { label: 'Social', module: 'social', facets: [] },
      { label: 'DID Wallet', module: 'credential', facets: [] },
      { label: 'Spatial Fabric', module: 'spatial', facets: [] },
    ];
    var catMap = { social: cats[0], credential: cats[1], spatial: cats[2] };

    FACET_ORDER.forEach(function (name) {
      var meta = getFacetMeta(name);
      var cat = catMap[meta.module];
      if (cat) {
        cat.facets.push({ name: name, meta: meta, facet: facetMap[name] || null });
      }
    });

    return cats;
  }

  function renderSigStatus() {
    if (!verificationResult) {
      return '<div class="sig-status" style="border-color:var(--border-strong);color:var(--text-tertiary);background:var(--bg-elevated)">'
        + '<span class="sig-icon">' + ICONS.warning + '</span> Verifying...'
        + '</div>';
    }

    var ttl = computeTTL(manifest.expiresAt);
    if (ttl.expired) {
      return '<div class="sig-status expired">'
        + '<span class="sig-icon">' + ICONS.warning + '</span> Signature Valid (Expired TTL)'
        + '</div>';
    }

    if (verificationResult.valid) {
      return '<div class="sig-status valid">'
        + '<span class="sig-icon">' + ICONS.check + '</span> Signature Verified'
        + '</div>';
    }

    return '<div class="sig-status invalid">'
      + '<span class="sig-icon">' + ICONS.x + '</span> Signature Invalid'
      + '</div>';
  }

  function metaItem(label, value, extraClass) {
    return '<div class="meta-item">'
      + '<div class="meta-label">' + escapeHtml(label) + '</div>'
      + '<div class="meta-value' + (extraClass ? ' ' + extraClass : '') + '">' + value + '</div>'
      + '</div>';
  }

  // ---------------------------------------------------------------------------
  // Detail Panel
  // ---------------------------------------------------------------------------

  function openDetail(facetName) {
    var facetMap = {};
    (manifest.facets || []).forEach(function (f) { if (f.name) facetMap[f.name] = f; });
    var facet = facetMap[facetName];
    var meta = getFacetMeta(facetName);

    activeFacet = facetName;

    var titleEl = document.getElementById('detail-title');
    var bodyEl = document.getElementById('detail-body');
    titleEl.textContent = meta.icon + ' ' + meta.label;

    var html = '';

    if (facet) {
      html += '<div class="detail-section">';
      html += '<div class="detail-section-label">Status</div>';
      html += '<div class="detail-kv">';
      html += kv('State', 'Equipped');
      html += kv('Module', meta.category);
      html += kv('Type', facet['@type'] || 'um:Facet');
      html += '</div>';
      html += '</div>';

      // Entity data
      html += '<div class="detail-section">';
      html += '<div class="detail-section-label">Facet Data</div>';
      html += '<pre class="detail-json">' + escapeHtml(JSON.stringify(facet.entity || facet, null, 2)) + '</pre>';
      html += '</div>';
    } else {
      html += '<div class="detail-section">';
      html += '<div class="detail-section-label">Status</div>';
      html += '<div class="detail-kv">';
      html += kv('State', 'Not Equipped');
      html += kv('Module', meta.category);
      html += kv('Description', meta.desc);
      html += '</div>';
      html += '</div>';
      html += '<div class="detail-section" style="color:var(--text-tertiary);font-size:0.8125rem">';
      html += 'This facet slot is empty. It can be equipped when the ' + escapeHtml(meta.category) + ' module writes data to this manifest.';
      html += '</div>';
    }

    bodyEl.innerHTML = html;

    document.getElementById('detail-overlay').classList.add('open');
    document.getElementById('detail-panel').classList.add('open');
  }

  function closeDetail() {
    activeFacet = null;
    document.getElementById('detail-overlay').classList.remove('open');
    document.getElementById('detail-panel').classList.remove('open');
  }

  function kv(key, val) {
    return '<div class="detail-kv-row">'
      + '<span class="detail-kv-key">' + escapeHtml(key) + '</span>'
      + '<span class="detail-kv-val">' + escapeHtml(val) + '</span>'
      + '</div>';
  }

  // ---------------------------------------------------------------------------
  // Event Binding
  // ---------------------------------------------------------------------------

  function bindEvents() {
    // Facet slot clicks
    var slots = document.querySelectorAll('.facet-slot');
    slots.forEach(function (slot) {
      slot.addEventListener('click', function () {
        var name = slot.getAttribute('data-facet');
        if (name) openDetail(name);
      });
    });

    // Detail panel close
    var closeBtn = document.getElementById('detail-close');
    if (closeBtn) closeBtn.addEventListener('click', closeDetail);

    var overlay = document.getElementById('detail-overlay');
    if (overlay) overlay.addEventListener('click', closeDetail);

    // Keyboard: Escape closes detail
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && activeFacet) closeDetail();
    });

    // Export button
    var exportBtn = document.getElementById('btn-export');
    if (exportBtn) {
      exportBtn.addEventListener('click', function () {
        var blob = new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        var umid = manifest['@id'] || 'manifest';
        var filename = umid.replace(/[^a-zA-Z0-9-_]/g, '_') + '.um.json';
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      });
    }

    // Raw JSON toggle
    var rawBtn = document.getElementById('btn-raw-json');
    if (rawBtn) {
      rawBtn.addEventListener('click', function () {
        rawJsonVisible = !rawJsonVisible;
        var container = document.getElementById('raw-json-container');
        if (container) {
          container.classList.toggle('visible', rawJsonVisible);
          if (rawJsonVisible) {
            var block = document.getElementById('raw-json-block');
            if (block) block.textContent = JSON.stringify(manifest, null, 2);
          }
        }
        rawBtn.innerHTML = '<span class="btn-icon">' + ICONS.code + '</span> ' + (rawJsonVisible ? 'Hide Raw JSON' : 'View Raw JSON');
      });
    }
  }

  // ---------------------------------------------------------------------------
  // TTL Countdown
  // ---------------------------------------------------------------------------

  var countdownInterval = null;

  function startCountdown() {
    if (countdownInterval) clearInterval(countdownInterval);
    countdownInterval = setInterval(function () {
      var el = document.getElementById('ttl-display');
      if (!el || !manifest) return;
      var ttl = computeTTL(manifest.expiresAt);
      el.textContent = ttl.text;
      el.className = 'ttl-countdown' + (ttl.expired ? ' expired' : '');
    }, 60000); // Update every minute
  }

  // ---------------------------------------------------------------------------
  // Escaping
  // ---------------------------------------------------------------------------

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function escapeAttr(str) {
    return escapeHtml(str);
  }

  // ---------------------------------------------------------------------------
  // Bootstrap
  // ---------------------------------------------------------------------------

  async function boot() {
    var umid = extractUmid();
    if (!umid) {
      renderError({ status: 400, message: 'No UMID in URL. Expected /view/{UMID}', umid: '' });
      return;
    }

    render(); // Show loading state

    try {
      manifest = await fetchManifest(umid);
      render(); // Render equip screen

      // Verify signature in background
      verificationResult = await verifyManifestSig(manifest);
      // Re-render just the sig status without full re-render
      var sigEls = document.querySelectorAll('.sig-status');
      if (sigEls.length > 0) {
        var tempDiv = document.createElement('div');
        tempDiv.innerHTML = renderSigStatus();
        sigEls[0].replaceWith(tempDiv.firstElementChild);
      }
    } catch (err) {
      renderError(err);
    }
  }

  // Wait for DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

})();
