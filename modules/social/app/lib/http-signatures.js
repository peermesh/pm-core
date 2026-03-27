// =============================================================================
// HTTP Signature Signing & Verification (Cavage draft, rsa-sha256)
// =============================================================================
// Hand-rolled using node:crypto. No external libraries.
// Based on proven spatial-fabric implementation.

import { createHash, createSign, createVerify } from 'node:crypto';

/**
 * Sign an outbound HTTP request (Cavage HTTP Signatures draft).
 * Returns headers to add to the request: Date, Digest, Signature, Host.
 *
 * @param {string} method - HTTP method (POST, GET, etc.)
 * @param {string} url - Full URL to send to
 * @param {string|Buffer|null} body - Request body (null for GET)
 * @param {string} privateKeyPem - RSA private key in PEM format
 * @param {string} keyId - Key ID URI (e.g., https://example.com/ap/actor/alice#main-key)
 * @returns {Record<string, string>} Headers to merge into the request
 */
function signRequest(method, url, body, privateKeyPem, keyId) {
  const parsed = new URL(url);
  const date = new Date().toUTCString();

  // Compute SHA-256 digest of the body
  const bodyBuf = body ? Buffer.from(body) : Buffer.alloc(0);
  const digest = `SHA-256=${createHash('sha256').update(bodyBuf).digest('base64')}`;

  // Construct the signature string per Cavage HTTP Signatures draft
  const signedHeaders = '(request-target) host date digest';
  const signatureString = [
    `(request-target): ${method.toLowerCase()} ${parsed.pathname}`,
    `host: ${parsed.host}`,
    `date: ${date}`,
    `digest: ${digest}`,
  ].join('\n');

  const signer = createSign('SHA256');
  signer.update(signatureString);
  signer.end();
  const signatureB64 = signer.sign(privateKeyPem, 'base64');

  const signatureHeader = [
    `keyId="${keyId}"`,
    `algorithm="rsa-sha256"`,
    `headers="${signedHeaders}"`,
    `signature="${signatureB64}"`,
  ].join(',');

  return {
    Date: date,
    Digest: digest,
    Signature: signatureHeader,
    Host: parsed.host,
  };
}

/**
 * Send a signed HTTP POST request to a remote ActivityPub inbox.
 *
 * @param {string} url - Remote inbox URL
 * @param {object} activity - Activity object to send
 * @param {string} privateKeyPem - Our actor's RSA private key
 * @param {string} keyId - Our actor's key ID URI
 * @returns {Promise<{status: number, body: string}>}
 */
async function signedFetch(url, activity, privateKeyPem, keyId) {
  const bodyStr = JSON.stringify(activity);
  const headers = signRequest('POST', url, bodyStr, privateKeyPem, keyId);

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      ...headers,
      'Content-Type': 'application/activity+json',
      'Accept': 'application/activity+json',
    },
    body: bodyStr,
  });

  const responseBody = await response.text();
  console.log(`[federation] signedFetch POST ${url} => ${response.status} ${responseBody.substring(0, 200)}`);
  return { status: response.status, body: responseBody };
}

/**
 * Fetch a remote actor document.
 * @param {string} actorUrl - Remote actor URI
 * @returns {Promise<object|null>} The actor document, or null on failure
 */
async function fetchRemoteActor(actorUrl) {
  try {
    const response = await fetch(actorUrl, {
      headers: {
        'Accept': 'application/activity+json, application/ld+json',
      },
    });
    if (!response.ok) {
      console.error(`[federation] Failed to fetch remote actor ${actorUrl}: ${response.status}`);
      return null;
    }
    return await response.json();
  } catch (err) {
    console.error(`[federation] Error fetching remote actor ${actorUrl}:`, err.message);
    return null;
  }
}

/**
 * Parse a Signature header into its components.
 * Format: keyId="...",algorithm="...",headers="...",signature="..."
 * @param {string} signatureHeader
 * @returns {{ keyId: string, algorithm: string, headers: string, signature: string } | null}
 */
function parseSignatureHeader(signatureHeader) {
  if (!signatureHeader) return null;
  const params = {};
  const regex = /([a-zA-Z][a-zA-Z0-9_-]*)="([^"]*)"/g;
  let match;
  while ((match = regex.exec(signatureHeader)) !== null) {
    params[match[1]] = match[2];
  }
  if (!params.keyId || !params.signature || !params.headers) return null;
  return params;
}

/**
 * Verify the HTTP Signature on an incoming request.
 *
 * @param {object} options
 * @param {string} options.method - HTTP method
 * @param {string} options.path - Request path (e.g., /ap/inbox)
 * @param {object} options.headers - Request headers (lowercase keys)
 * @param {string} options.rawBody - Raw request body string
 * @returns {Promise<{ valid: boolean, actorUrl: string|null, error?: string }>}
 */
async function verifyHttpSignature({ method, path, headers, rawBody }) {
  const sigParams = parseSignatureHeader(headers['signature']);
  if (!sigParams) {
    return { valid: false, actorUrl: null, error: 'Missing or unparseable Signature header' };
  }

  // Verify Digest header matches body
  if (rawBody) {
    const expectedDigest = `SHA-256=${createHash('sha256').update(Buffer.from(rawBody)).digest('base64')}`;
    const receivedDigest = headers['digest'];
    if (!receivedDigest || receivedDigest !== expectedDigest) {
      return { valid: false, actorUrl: null, error: `Digest mismatch. Expected: ${expectedDigest}, Got: ${receivedDigest}` };
    }
  }

  // Extract actor URL from keyId (strip #main-key fragment)
  const actorUrl = sigParams.keyId.replace(/#.*$/, '');

  // Fetch remote actor to get public key
  const remoteActor = await fetchRemoteActor(actorUrl);
  if (!remoteActor || !remoteActor.publicKey || !remoteActor.publicKey.publicKeyPem) {
    return { valid: false, actorUrl, error: 'Could not fetch remote actor or public key' };
  }

  // Verify keyId matches actor's publicKey.id
  if (remoteActor.publicKey.id !== sigParams.keyId) {
    return { valid: false, actorUrl, error: `keyId mismatch: ${sigParams.keyId} vs ${remoteActor.publicKey.id}` };
  }

  // Reconstruct the signing string
  const signedHeaderNames = sigParams.headers.split(' ');
  const signingLines = signedHeaderNames.map(headerName => {
    if (headerName === '(request-target)') {
      return `(request-target): ${method.toLowerCase()} ${path}`;
    }
    const value = headers[headerName.toLowerCase()];
    return `${headerName.toLowerCase()}: ${value || ''}`;
  });
  const signingString = signingLines.join('\n');

  // Verify signature
  try {
    const verifier = createVerify('RSA-SHA256');
    verifier.update(signingString);
    verifier.end();
    const isValid = verifier.verify(remoteActor.publicKey.publicKeyPem, sigParams.signature, 'base64');
    if (!isValid) {
      return { valid: false, actorUrl, error: 'Signature verification failed' };
    }
    return { valid: true, actorUrl, remoteActor };
  } catch (err) {
    return { valid: false, actorUrl, error: `Verification error: ${err.message}` };
  }
}

export { signRequest, signedFetch, fetchRemoteActor, verifyHttpSignature };
