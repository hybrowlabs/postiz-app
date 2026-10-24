#!/usr/bin/env bash
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../../.."
GATE=scripts/ci/trivy-secret-gate.sh
IGN=.trivyignore.yaml
STORE=root/.local/share/pnpm/store/v10/files
H1=0b0d3d3adf93e8ba3aade330daf0f7e7f1b0321fb99d8dac9cd16254168313bfd73690b384dec46ca4189bcd07a7ff7256e5e29b093ad09be7b0c572542d8a07
H2=4a2f93d31eb7c819f5fa8aad0f982e67ef6abc0f2c6dd0954d261c1f248c758edb43c20918d798acf801b93f69979f48a892893b0bea87b2fe867e6525f93c95
H3=40f66016ceb0cd44d99104682874aebcea3ca3474b48c8b219a3350220035f8cb647181460fd1882b37a9ba1d67e3c70e81ff689aa9cceb206a65ca4bcf91a8a
fail=0
ok() { echo "PASS: $1"; }
bad() { echo "FAIL: $1"; fail=$((fail+1)); }
[[ -x "$GATE" ]] || { echo "FAIL: $GATE missing or not executable"; echo "RESULT: 1 failure(s)"; exit 1; }
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
command -v "${TRIVY:-trivy}" >/dev/null 2>&1 || { echo "FAIL: trivy not found (set TRIVY=/path/to/trivy); a missing scanner must not look like a passing gate"; echo "RESULT: 1 failure(s)"; exit 1; }
echo "trivy: $(${TRIVY:-trivy} --version | head -n 1)"
fix="$tmp/fixtures"; mkdir -p "$fix"
for v in 9.15.1:$H1 10.9.1:$H2 8.9.0:$H3; do
  ver="${v%%:*}"; h="${v#*:}"
  (cd "$fix" && npm pack "google-auth-library@$ver" --silent >/dev/null 2>&1 && mkdir -p "x$ver" && tar -xzf "google-auth-library-$ver.tgz" -C "x$ver" package/README.md) || { bad "could not fetch google-auth-library@$ver from npm"; continue; }
  got="$(sha512sum "$fix/x$ver/package/README.md" | cut -d' ' -f1)"
  [[ "$got" == "$h" ]] && ok "README of $ver has the pinned sha512" || bad "README of $ver does not match the pinned sha512"
done
fake='{
  "type": "service_account",
  "private_key_id": "0000000000000000000000000000000000000000",
  "client_email": "fake@example.invalid"
}'
place() { local root="$1" h="$2" src="$3"; mkdir -p "$root/$STORE/${h:0:2}"; cp "$src" "$root/$STORE/${h:0:2}/${h:2}"; }

ok_root="$tmp/ok"; mkdir -p "$ok_root"
place "$ok_root" "$H1" "$fix/x9.15.1/package/README.md"
place "$ok_root" "$H2" "$fix/x10.9.1/package/README.md"
place "$ok_root" "$H3" "$fix/x8.9.0/package/README.md"
if "$GATE" "$ok_root" >/dev/null 2>&1; then ok "(a) the 3 fixture store files pass"; else bad "(a) the 3 fixture store files must pass"; fi

b1="$tmp/b1"; mkdir -p "$b1/app/other"; printf '%s\n' "$fake" > "$b1/app/other/creds.json"
if "$GATE" "$b1" >/dev/null 2>&1; then bad "(b1) fake secret in a non-listed file must fail"; else ok "(b1) fake secret in a non-listed file fails"; fi

b2="$tmp/b2"; mkdir -p "$b2/$STORE/ab"; printf '%s\n' "$fake" > "$b2/$STORE/ab/cdef0123"
if "$GATE" "$b2" >/dev/null 2>&1; then bad "(b2) fake secret in a different pnpm store file must fail"; else ok "(b2) fake secret in a different pnpm store file fails"; fi

b3="$tmp/b3"; mkdir -p "$b3"; place "$b3" "$H1" "$fix/x9.15.1/package/README.md"
mkdir -p "$b3/$STORE/0c"; cp "$fix/x9.15.1/package/README.md" "$b3/$STORE/0c/${H1:2}"
if "$GATE" "$b3" >/dev/null 2>&1; then bad "(b3) same README content at a non-listed store path must fail"; else ok "(b3) same README content at a non-listed store path fails"; fi

b4="$tmp/b4"; mkdir -p "$b4/$STORE/${H1:0:2}"; printf '%s\n' "$fake" > "$b4/$STORE/${H1:0:2}/${H1:2}"
if "$GATE" "$b4" >/dev/null 2>&1; then bad "(b4) listed path with different content (hash mismatch) must fail"; else ok "(b4) listed path with different content fails"; fi

[[ -f "$IGN" ]] || { bad "(c) $IGN missing"; echo "RESULT: $fail failure(s)"; exit 1; }
if python3 - "$IGN" "$STORE" "$H1" "$H2" "$H3" <<'PY'
import sys, re
ign, store, *hashes = sys.argv[1:]
want = sorted("%s/%s/%s" % (store, h[:2], h[2:]) for h in hashes)
text = open(ign).read()
body = [l for l in text.splitlines() if l.strip() and not l.lstrip().startswith("#")]
ok = True
def err(m):
    global ok; print(m); ok = False
if body[0].strip() != "secrets:": err("first key must be secrets:")
ids = [re.sub(r"^\s*-\s*id:\s*", "", l).strip().strip("'\"") for l in body if re.match(r"^\s*-\s*id:", l)]
if ids != ["gcp-service-account"] * 3: err("ids: %r" % ids)
paths = [re.sub(r"^\s*-\s*", "", l).strip().strip("'\"") for l in body if re.match(r"^\s+-\s+['\"]?root/", l)]
if sorted(paths) != want: err("paths differ from the 3 pinned store paths: %r" % paths)
if any(c in p for p in paths for c in "*?[]{}"): err("glob in path")
allowed = {"secrets", "id", "paths", "statement"}
keys = set()
for l in body:
    m = re.match(r"^\s*(?:-\s*)?([A-Za-z_]+):", l)
    if m and not re.match(r"^\s+-\s+['\"]?root/", l): keys.add(m.group(1))
if keys - allowed: err("unexpected keys: %r" % (keys - allowed))
if len(re.findall(r"^\s*statement:", text, re.M)) != 3: err("each entry needs a statement")
for needle in ("HYBA-1448", "24 Oct 2026", "9.15.1", "10.9.1", "8.9.0"):
    if needle not in text: err("statement text missing %r" % needle)
for h in hashes:
    if h not in text: err("pinned sha512 missing in statements: " + h[:12])
sys.exit(0 if ok else 1)
PY
then ok "(c) allowlist is exactly the 3 pinned store paths for rule gcp-service-account, with statements and sha512"; else bad "(c) allowlist is not exactly the 3 pinned entries"; fi

if grep -nE -e '--skip-files|--skip-dirs|--severity|--scanners[ =]+[^s]|--scanners[ =]+secret,|--exit-code[ =]+0|--ignore-policy|\|\| *true' "$GATE" >/dev/null; then bad "(d) gate has a forbidden flag or masks the exit code"; else ok "(d) gate has no skip flag, severity change, scanner-list change or masked exit code"; fi
echo "RESULT: $fail failure(s)"; [[ $fail -eq 0 ]]
