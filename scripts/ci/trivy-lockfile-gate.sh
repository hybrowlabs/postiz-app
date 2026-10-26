#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."
TRIVY="${TRIVY:-trivy}"
out="$(mktemp)"; trap 'rm -f "$out"' EXIT
"$TRIVY" fs --scanners vuln --severity CRITICAL --include-dev-deps --skip-version-check --no-progress --format json --output "$out" pnpm-lock.yaml >/dev/null
python3 - "$out" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
rows = sorted({(v["PkgName"], v["InstalledVersion"], v["VulnerabilityID"], v.get("FixedVersion", "")) for r in d.get("Results", []) for v in (r.get("Vulnerabilities") or [])})
for r in rows:
    print("CRITICAL %s %s %s fixed:%s" % r)
print("RESULT: %d CRITICAL finding(s) in pnpm-lock.yaml" % len(rows))
sys.exit(1 if rows else 0)
PY
