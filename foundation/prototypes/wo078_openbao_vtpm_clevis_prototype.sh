#!/usr/bin/env bash
set -euo pipefail

# WO-078 reproducible prototype:
# OpenBao + Clevis TPM2 pin + vTPM (swtpm) reseal/unseal validation.

HOST="${1:-root@46.225.188.213}"

ssh -o BatchMode=yes -o ConnectTimeout=20 "$HOST" 'bash -s' <<'REMOTE'
set -euo pipefail
WORK=/root/wo078
mkdir -p "$WORK"/tpm "$WORK"/openbao "$WORK"/data

apt-get update -y >/dev/null
DEBIAN_FRONTEND=noninteractive apt-get install -y jq swtpm tpm2-tools clevis clevis-tpm2 jose >/dev/null

pkill -f "swtpm socket --tpm2 --daemon --tpmstate dir=$WORK/tpm" >/dev/null 2>&1 || true
docker rm -f openbao-wo078 >/dev/null 2>&1 || true
rm -rf "$WORK/data"/* "$WORK/tpm"/*

swtpm socket --tpm2 --daemon --tpmstate dir="$WORK/tpm" \
  --ctrl type=unixio,path="$WORK/tpm/swtpm.sock.ctrl" \
  --server type=unixio,path="$WORK/tpm/swtpm.sock" \
  --flags startup-clear

export TPM2TOOLS_TCTI="swtpm:path=$WORK/tpm/swtpm.sock"
tpm2_startup -c || true

cat > "$WORK/openbao/config.hcl" <<CFG
ui = false
storage "file" { path = "/opt/openbao/data" }
listener "tcp" { address = "127.0.0.1:18200" tls_disable = 1 }
api_addr = "http://127.0.0.1:18200"
cluster_addr = "http://127.0.0.1:18201"
CFG
chmod -R 0777 "$WORK/data" "$WORK/openbao"

docker pull openbao/openbao:latest >/dev/null
docker run -d --name openbao-wo078 --cap-add IPC_LOCK \
  -p 127.0.0.1:18200:18200 \
  -v "$WORK/openbao:/opt/openbao/config" \
  -v "$WORK/data:/opt/openbao/data" \
  openbao/openbao:latest server -config=/opt/openbao/config/config.hcl >/dev/null
sleep 5

docker exec -e BAO_ADDR=http://127.0.0.1:18200 openbao-wo078 \
  bao operator init -key-shares=1 -key-threshold=1 -format=json > "$WORK/openbao-init.json"

jq -r '.unseal_keys_b64[0]' "$WORK/openbao-init.json" > "$WORK/openbao-unseal.b64"
ROOT_TOKEN=$(jq -r '.root_token' "$WORK/openbao-init.json")

# Operational state (unsealed)
docker exec -e BAO_ADDR=http://127.0.0.1:18200 openbao-wo078 \
  bao operator unseal "$(cat "$WORK/openbao-unseal.b64")" >/dev/null

# Seal key material to TPM2 pin
PIN_CFG='{"hash":"sha256","key":"ecc","pcr_bank":"sha256","pcr_ids":"7"}'
cat "$WORK/openbao-unseal.b64" | clevis encrypt tpm2 "$PIN_CFG" > "$WORK/openbao-unseal.sealed.jwe"

# Reseal and recover unseal key

docker exec -e BAO_ADDR=http://127.0.0.1:18200 -e BAO_TOKEN="$ROOT_TOKEN" openbao-wo078 \
  bao operator seal >/dev/null

cat "$WORK/openbao-unseal.sealed.jwe" | clevis decrypt > "$WORK/openbao-unseal.recovered.b64"

docker exec -e BAO_ADDR=http://127.0.0.1:18200 openbao-wo078 \
  bao operator unseal "$(cat "$WORK/openbao-unseal.recovered.b64")" >/dev/null

STATUS_JSON=$(docker exec -e BAO_ADDR=http://127.0.0.1:18200 openbao-wo078 bao status -format=json || true)
printf '%s\n' "$STATUS_JSON" | jq -r '.sealed'
REMOTE
