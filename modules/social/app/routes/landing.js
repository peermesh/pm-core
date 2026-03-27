// =============================================================================
// Landing Page Route — GET /
// =============================================================================

import { html, VERSION, MODULE, startTime } from '../lib/helpers.js';

function landingPageHtml() {
  const uptimeSeconds = Math.floor((Date.now() - startTime) / 1000);
  return `<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>PeerMesh Social</title>
  <link rel="stylesheet" href="/static/tokens.css">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: var(--font-family-primary);
      background: var(--color-bg-primary);
      color: var(--color-text-primary);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .container {
      max-width: 480px;
      width: 100%;
      padding: var(--space-8);
    }
    .logo {
      font-size: var(--font-size-display);
      font-weight: var(--font-weight-bold);
      color: var(--color-primary);
      margin-bottom: var(--space-1);
    }
    .subtitle {
      font-size: var(--font-size-body-sm);
      color: var(--color-text-secondary);
      margin-bottom: var(--space-8);
    }
    .card {
      background: var(--color-bg-secondary);
      border: var(--border-width-default) solid var(--color-border);
      border-radius: var(--radius-md);
      padding: var(--space-5);
      margin-bottom: var(--space-5);
    }
    .row {
      display: flex;
      justify-content: space-between;
      padding: var(--space-2) 0;
      border-bottom: var(--border-width-default) solid var(--color-border);
    }
    .row:last-child { border-bottom: none; }
    .label { color: var(--color-text-secondary); font-size: var(--font-size-body-sm); }
    .value { color: var(--color-text-primary); font-size: var(--font-size-body-sm); font-weight: var(--font-weight-medium); }
    .status-ok { color: var(--color-success); }
    a {
      color: var(--color-text-link);
      text-decoration: none;
      font-size: var(--font-size-body-sm);
    }
    a:hover { color: var(--color-text-link-hover); text-decoration: underline; }
    .links { display: flex; gap: var(--space-6); margin-top: var(--space-2); }
    .footer {
      text-align: center;
      color: var(--color-text-tertiary);
      font-size: var(--font-size-caption);
      margin-top: var(--space-8);
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="logo">PeerMesh Social</div>
    <div class="subtitle">Social identity and profile backbone module</div>
    <div class="card">
      <div class="row">
        <span class="label">Module</span>
        <span class="value">${MODULE}</span>
      </div>
      <div class="row">
        <span class="label">Version</span>
        <span class="value">${VERSION}</span>
      </div>
      <div class="row">
        <span class="label">Status</span>
        <span class="value status-ok">Running</span>
      </div>
      <div class="row">
        <span class="label">Uptime</span>
        <span class="value">${uptimeSeconds}s</span>
      </div>
    </div>
    <div class="links">
      <a href="/login">Log In</a>
      <a href="/signup">Sign Up</a>
      <a href="/health">Health Check</a>
    </div>
    <div class="footer">PeerMesh Core</div>
  </div>
</body>
</html>`;
}

export default function registerRoutes(routes) {
  routes.push({
    method: 'GET',
    pattern: '/',
    handler: async (req, res) => {
      html(res, 200, landingPageHtml());
    },
  });
}
