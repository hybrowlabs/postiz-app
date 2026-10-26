#!/usr/bin/env bash
set -euo pipefail
repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
target="${1:?usage: trivy-secret-gate.sh <dir|image-rootfs> [report.json]}"
report="${2:-$(mktemp)}"
TRIVY="${TRIVY:-trivy}"
"$TRIVY" fs --scanners secret --ignorefile "$repo/.trivyignore.yaml" --skip-version-check --no-progress --format json --output "$report" "$target" >/dev/null 2>&1
pin_bad=0
while IFS= read -r rel; do
  f="$target/$rel"
  [[ -f "$f" ]] || continue
  want="$(echo "$rel" | sed -E 's#.*/files/([0-9a-f]{2})/([0-9a-f]+)$#\1\2#')"
  got="$(sha512sum "$f" | cut -d' ' -f1)"
  if [[ "$got" != "$want" ]]; then echo "PIN MISMATCH: $rel content sha512 differs from its pinned hash" >&2; pin_bad=$((pin_bad+1)); fi
done < <(sed -nE 's/^[[:space:]]*-[[:space:]]*"(root\/[^"]+)"[[:space:]]*$/\1/p' "$repo/.trivyignore.yaml")
if [[ "$pin_bad" -ne 0 ]]; then echo "RESULT: $pin_bad allowlisted file(s) do not match their pinned hash, gate failed"; exit 1; fi
count="$(python3 - "$report" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
rows = sorted({(r["Target"], s["RuleID"], s.get("StartLine", 0)) for r in d.get("Results", []) for s in (r.get("Secrets") or [])})
for t, rule, line in rows:
    print("SECRET %s %s line %s" % (rule, t, line), file=sys.stderr)
print(len(rows))
PY
)"
if [[ "$count" -ne 0 ]]; then echo "RESULT: $count secret finding(s), gate failed"; exit 1; fi
echo "RESULT: 0 secret finding(s)"
