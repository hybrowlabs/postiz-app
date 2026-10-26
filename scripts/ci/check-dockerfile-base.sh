#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."
expected="${EXPECTED_BASE:-node:22-trixie-slim}"
got="$(sed -n 's/^FROM \([^ ]*\).*/\1/p' Dockerfile.dev | head -n 1)"
if [[ "$got" == "$expected" ]]; then echo "RESULT: Dockerfile.dev base is $got"; exit 0; fi
echo "RESULT: Dockerfile.dev base is '$got', expected '$expected'"; exit 1
