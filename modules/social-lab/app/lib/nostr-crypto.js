// =============================================================================
// Nostr Utilities (NIP-19 bech32, keypair generation, event signing)
// =============================================================================

import { createHash, randomBytes } from 'node:crypto';
import { schnorr } from '@noble/curves/secp256k1';
import { bytesToHex, hexToBytes } from '@noble/curves/abstract/utils';

// -- Bech32 encoding/decoding (NIP-19) --

const BECH32_CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const BECH32_GENERATOR = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];

function bech32Polymod(values) {
  let chk = 1;
  for (const v of values) {
    const top = chk >> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) {
      if ((top >> i) & 1) chk ^= BECH32_GENERATOR[i];
    }
  }
  return chk;
}

function bech32HrpExpand(hrp) {
  const ret = [];
  for (let i = 0; i < hrp.length; i++) ret.push(hrp.charCodeAt(i) >> 5);
  ret.push(0);
  for (let i = 0; i < hrp.length; i++) ret.push(hrp.charCodeAt(i) & 31);
  return ret;
}

function bech32CreateChecksum(hrp, data) {
  const values = [...bech32HrpExpand(hrp), ...data, 0, 0, 0, 0, 0, 0];
  const polymod = bech32Polymod(values) ^ 1;
  const ret = [];
  for (let i = 0; i < 6; i++) ret.push((polymod >> (5 * (5 - i))) & 31);
  return ret;
}

function bech32Encode(hrp, data5bit) {
  const combined = [...data5bit, ...bech32CreateChecksum(hrp, data5bit)];
  return hrp + '1' + combined.map(d => BECH32_CHARSET[d]).join('');
}

/** Convert between bit widths (8-bit bytes to 5-bit groups and vice versa). */
function convertBits(data, fromBits, toBits, pad) {
  let acc = 0, bits = 0;
  const ret = [];
  const maxv = (1 << toBits) - 1;
  for (const value of data) {
    acc = (acc << fromBits) | value;
    bits += fromBits;
    while (bits >= toBits) {
      bits -= toBits;
      ret.push((acc >> bits) & maxv);
    }
  }
  if (pad) {
    if (bits > 0) ret.push((acc << (toBits - bits)) & maxv);
  }
  return ret;
}

/**
 * Encode a 32-byte key as a NIP-19 bech32 string.
 * @param {string} hrp - 'npub' or 'nsec'
 * @param {Buffer|Uint8Array} key32 - 32-byte key
 * @returns {string} bech32-encoded string
 */
function nip19Encode(hrp, key32) {
  const data5bit = convertBits(key32, 8, 5, true);
  return bech32Encode(hrp, data5bit);
}

// -- Nostr keypair generation --

/**
 * Generate a Nostr secp256k1 keypair.
 * Returns { privkeyHex, pubkeyHex, npub, nsec } where:
 *   - privkeyHex: 32-byte private key as hex (for Schnorr signing)
 *   - pubkeyHex:  32-byte x-only public key as hex (Nostr identity)
 *   - npub: NIP-19 bech32-encoded public key
 *   - nsec: NIP-19 bech32-encoded private key
 *
 * Phase 1 note: The nsec is generated server-side for the Omni-Account pipeline.
 * Phase 2 migration: nsec generation will move to client-side only (F-007 Section 2).
 */
function generateNostrKeypair() {
  // Generate a cryptographically secure 32-byte private key
  const privkeyBytes = randomBytes(32);
  const privkeyHex = bytesToHex(privkeyBytes);

  // Derive x-only public key using @noble/curves Schnorr
  const pubkeyBytes = schnorr.getPublicKey(privkeyBytes);
  const pubkeyHex = bytesToHex(pubkeyBytes);

  // Encode as NIP-19 bech32
  const npub = nip19Encode('npub', pubkeyBytes);
  const nsec = nip19Encode('nsec', privkeyBytes);

  return { privkeyHex, pubkeyHex, npub, nsec };
}

// -- Nostr event construction and signing (NIP-01) --

/**
 * Create and sign a Nostr event.
 * @param {number} kind - Event kind (0=metadata, 1=note, etc.)
 * @param {string} content - Event content
 * @param {string[][]} tags - Event tags
 * @param {string} privkeyHex - 32-byte private key as hex
 * @param {string} pubkeyHex - 32-byte x-only public key as hex
 * @returns {object} Signed Nostr event
 */
function createNostrEvent(kind, content, tags, privkeyHex, pubkeyHex) {
  const created_at = Math.floor(Date.now() / 1000);

  // Compute event ID per NIP-01: SHA-256 of [0, pubkey, created_at, kind, tags, content]
  const serialized = JSON.stringify([0, pubkeyHex, created_at, kind, tags, content]);
  const idHash = createHash('sha256').update(serialized).digest();
  const id = bytesToHex(idHash);

  // Sign with Schnorr (BIP-340) using @noble/curves
  const sig = schnorr.sign(idHash, privkeyHex);
  const sigHex = bytesToHex(sig);

  return {
    id,
    pubkey: pubkeyHex,
    created_at,
    kind,
    tags,
    content,
    sig: sigHex,
  };
}

/**
 * Decode a NIP-19 npub bech32 string to hex public key.
 * @param {string} npub - NIP-19 bech32-encoded public key (npub1...)
 * @returns {string|null} 64-char hex public key, or null on error
 */
function npubToHex(npub) {
  try {
    if (!npub || !npub.startsWith('npub1')) return null;
    const data = npub.slice(5); // strip 'npub1'

    // Decode bech32 data characters to 5-bit values
    const values5bit = [];
    for (const ch of data) {
      const idx = BECH32_CHARSET.indexOf(ch);
      if (idx === -1) return null;
      values5bit.push(idx);
    }

    // Remove 6-byte checksum
    const payload5bit = values5bit.slice(0, values5bit.length - 6);

    // Convert 5-bit to 8-bit
    const bytes = convertBits(payload5bit, 5, 8, false);

    // Should be exactly 32 bytes
    if (bytes.length !== 32) return null;

    return bytes.map(b => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return null;
  }
}

export {
  generateNostrKeypair,
  createNostrEvent,
  npubToHex,
  nip19Encode,
  BECH32_CHARSET,
  convertBits,
};
