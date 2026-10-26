#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."
file="${DOCKERFILE:-Dockerfile.dev}"
forbidden='g\+\+|gcc|make|build-essential|libc6-dev|linux-libc-dev|python3-pip|python3-dev'
awk -v forbidden="$forbidden" '
  /^FROM /{stage++; last=$0}
  {lines[NR]=$0; st[NR]=stage}
  END{
    if (stage < 2) {print "RESULT: FAIL, Dockerfile has " stage " stage(s), expected a separate runtime stage"; exit 1}
    bad=0
    for (i=1;i<=NR;i++) if (st[i]==stage) {
      if (lines[i] ~ ("(^|[ \t])(" forbidden ")([ \t\\\\]|$)")) {print "FAIL: runtime stage installs toolchain: " lines[i]; bad++}
    }
    if (bad) {print "RESULT: FAIL, " bad " toolchain package(s) in runtime stage"; exit 1}
    print "RESULT: runtime stage (last of " stage ") installs no compiler, libc headers or kernel headers"
  }' "$file"
grep -qE '^COPY --from=' "$file" || { echo "RESULT: FAIL, runtime stage does not copy from the builder stage"; exit 1; }
echo "RESULT: ok"
