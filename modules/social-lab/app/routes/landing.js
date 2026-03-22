// =============================================================================
// Landing Page Route — GET /
// =============================================================================

import { html, VERSION, MODULE, startTime } from '../lib/helpers.js';

function landingPageHtml() {
  const uptimeSeconds = Math.floor((Date.now() - startTime) / 1000);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>PeerMesh Social Lab</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      background: #0d1117;
      color: #e6edf3;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .container {
      max-width: 480px;
      width: 100%;
      padding: 2rem;
    }
    .logo {
      font-size: 2.4rem;
      font-weight: 700;
      color: #58a6ff;
      margin-bottom: 0.3rem;
    }
    .subtitle {
      font-size: 0.95rem;
      color: #8b949e;
      margin-bottom: 2rem;
    }
    .card {
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 8px;
      padding: 1.4rem;
      margin-bottom: 1.2rem;
    }
    .row {
      display: flex;
      justify-content: space-between;
      padding: 0.45rem 0;
      border-bottom: 1px solid #21262d;
    }
    .row:last-child { border-bottom: none; }
    .label { color: #8b949e; font-size: 0.85rem; }
    .value { color: #e6edf3; font-size: 0.85rem; font-weight: 500; }
    .status-ok { color: #3fb950; }
    a {
      color: #58a6ff;
      text-decoration: none;
      font-size: 0.9rem;
    }
    a:hover { text-decoration: underline; }
    .links { display: flex; gap: 1.5rem; margin-top: 0.5rem; }
    .footer {
      text-align: center;
      color: #484f58;
      font-size: 0.75rem;
      margin-top: 2rem;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="logo">PeerMesh Social Lab</div>
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
    <div class="footer">PeerMesh Docker Lab</div>
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
