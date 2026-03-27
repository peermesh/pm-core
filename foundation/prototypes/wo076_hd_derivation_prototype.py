#!/usr/bin/env python3
"""WO-076 prototype: derive module keys from one master seed.

This script demonstrates:
1) SLIP-0010 hardened Ed25519 key derivation for identity key paths.
2) HKDF-SHA256 derivation of per-module AES-256 keys.

It is a deterministic demo artifact, not production key-management code.
"""

from __future__ import annotations

import argparse
import binascii
import hashlib
import hmac
import os
import struct
from typing import Tuple


HARDENED = 0x80000000


def _hmac_sha512(key: bytes, data: bytes) -> bytes:
    return hmac.new(key, data, hashlib.sha512).digest()


def slip10_master_key(seed: bytes) -> Tuple[bytes, bytes]:
    i = _hmac_sha512(b"ed25519 seed", seed)
    return i[:32], i[32:]


def slip10_child_hardened(parent_key: bytes, parent_chain_code: bytes, index: int) -> Tuple[bytes, bytes]:
    if index >= HARDENED:
        idx = index
    else:
        idx = index + HARDENED
    data = b"\x00" + parent_key + struct.pack(">I", idx)
    i = _hmac_sha512(parent_chain_code, data)
    return i[:32], i[32:]


def derive_slip10_ed25519(seed: bytes, path: str) -> Tuple[bytes, bytes]:
    if not path.startswith("m/"):
        raise ValueError("Path must start with m/")
    key, chain = slip10_master_key(seed)
    segments = [p for p in path[2:].split("/") if p]
    for segment in segments:
        if not segment.endswith("'"):
            raise ValueError("SLIP-0010 Ed25519 supports hardened segments only")
        idx = int(segment[:-1])
        key, chain = slip10_child_hardened(key, chain, idx)
    return key, chain


def hkdf_sha256(ikm: bytes, salt: bytes, info: bytes, length: int = 32) -> bytes:
    prk = hmac.new(salt, ikm, hashlib.sha256).digest()
    out = b""
    t = b""
    counter = 1
    while len(out) < length:
        t = hmac.new(prk, t + info + bytes([counter]), hashlib.sha256).digest()
        out += t
        counter += 1
    return out[:length]


def derive_module_aes_key(seed: bytes, module_id: str, key_index: int) -> bytes:
    salt = b"peermesh-docker-lab/wo076/hkdf-v1"
    info = f"module/{module_id}/aes256/key/{key_index}".encode("utf-8")
    return hkdf_sha256(seed, salt, info, 32)


def main() -> None:
    parser = argparse.ArgumentParser(description="WO-076 HD derivation prototype")
    parser.add_argument(
        "--seed-hex",
        help="Master seed as hex (defaults to deterministic demo seed)",
        default="000102030405060708090a0b0c0d0e0f" "101112131415161718191a1b1c1d1e1f",
    )
    parser.add_argument("--module-id", default="storage")
    parser.add_argument("--module-index", type=int, default=0)
    parser.add_argument(
        "--identity-path",
        default="m/4755'/0'/1'/0'/0'",
        help="Hardened SLIP-0010 path for module identity key",
    )
    args = parser.parse_args()

    seed = binascii.unhexlify(args.seed_hex)

    identity_key, identity_chain = derive_slip10_ed25519(seed, args.identity_path)
    module_key = derive_module_aes_key(seed, args.module_id, args.module_index)

    print("wo076_hd_derivation_prototype")
    print(f"module_id={args.module_id}")
    print(f"module_index={args.module_index}")
    print(f"identity_path={args.identity_path}")
    print(f"seed_hex={args.seed_hex}")
    print(f"slip10_ed25519_private_key_hex={identity_key.hex()}")
    print(f"slip10_chain_code_hex={identity_chain.hex()}")
    print(f"module_aes256_key_hex={module_key.hex()}")


if __name__ == "__main__":
    main()
