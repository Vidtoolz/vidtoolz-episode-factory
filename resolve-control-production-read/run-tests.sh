#!/usr/bin/env bash
# Offline test runner for the production-read worker CANDIDATE. No Resolve, no network, no production library.
# 1) candidate suite (PR-01..PR-20 + identity tests); 2) qualification regression: the FROZEN Phase 1 suites executed
#    against the CANDIDATE worker bytes in a scratch tree (frozen vrc + frozen tests + candidate worker).
set -eu; cd "$(dirname "$0")"; export PYTHONDONTWRITEBYTECODE=1
: "${VRC_PHASE1_ROOT:=$HOME/resolve-authority-freeze-v1.20/resolve-control}"; export VRC_PHASE1_ROOT
echo "== candidate suite"; python3 -B -W ignore::ResourceWarning tests/test_production_read.py 2>&1 | tail -3
echo "== qualification regression (frozen Phase 1 tests vs candidate worker)"
S=$(mktemp -d); mkdir -p "$S/worker" "$S/tests"; cp worker/resolve_worker.py "$S/worker/"; ln -s "$VRC_PHASE1_ROOT/vrc" "$S/vrc"; cp "$VRC_PHASE1_ROOT"/tests/*.py "$S/tests/"
for t in test_phase1.py test_repairs.py; do echo "-- $t"; (cd "$S" && python3 -B -W ignore::ResourceWarning "tests/$t" 2>&1 | tail -3); done
rm -rf "$S"
