#!/usr/bin/env bash
# Offline runner for the isolated-session production-read worker CANDIDATE (pipefail, direct exit codes, no tee/tail masking,
# per-suite minimum collected-test counts). 1) candidate suite; 2) prior-bypass regression against the REJECTED 59a5593d bytes;
# 3) qualification regression: FROZEN Phase 1 suites executed unchanged against the CANDIDATE worker bytes.
# `./run-tests.sh --self-test` additionally proves the harness: injects one failing test, expects nonzero, restores.
set -euo pipefail; cd "$(dirname "$0")"; export PYTHONDONTWRITEBYTECODE=1
: "${VRC_PHASE1_ROOT:=$HOME/resolve-authority-freeze-v1.20/resolve-control}"; export VRC_PHASE1_ROOT
fail=0
run() { # name, cwd, file, min_tests -> records status without masking; an under-collecting suite also fails
  local name=$1 dir=$2 file=$3 min=${4:-1} log ran; log=$(mktemp)
  if (cd "$dir" && python3 -B -W ignore::ResourceWarning "$file" >"$log" 2>&1); then
    ran=$(grep -oE '^Ran [0-9]+' "$log" | head -1 | grep -oE '[0-9]+' || echo 0)
    if [ "${ran:-0}" -lt "$min" ]; then fail=1; printf '  FAIL  %-28s collected %s tests, expected >= %s (suite truncated or short-circuited)\n' "$name" "${ran:-0}" "$min"
    else printf '  PASS  %-28s Ran %s tests\n' "$name" "$ran"; fi
  else fail=1; printf '  FAIL  %-28s %s\n' "$name" "$(grep -oE '^Ran [0-9]+ tests?|FAILED.*|Error.*' "$log" | head -2 | tr '\n' ' ')"; sed -n '1,40p' "$log"; fi
  rm -f "$log"
}
suite() {
  echo "== candidate suite"; run test_production_read.py . tests/test_production_read.py 47
  echo "== prior-bypass regression (rejected 59a5593d bytes vs successor)"; run test_prior_bypass_regression.py . tests/test_prior_bypass_regression.py 4
  echo "== qualification regression (frozen Phase 1 tests vs candidate worker)"
  local S; S=$(mktemp -d); mkdir -p "$S/worker" "$S/tests"; cp worker/resolve_worker.py "$S/worker/"; ln -s "$VRC_PHASE1_ROOT/vrc" "$S/vrc"; cp "$VRC_PHASE1_ROOT"/tests/*.py "$S/tests/"
  run frozen/test_phase1.py "$S" tests/test_phase1.py 22; run frozen/test_repairs.py "$S" tests/test_repairs.py 20; rm -rf "$S"
}
if [ "${1:-}" = "--self-test" ]; then
  echo "== harness self-test: injecting one failing test"; T=$(mktemp -d); cat >"$T/test_injected_failure.py" <<'PY'
import unittest
class Injected(unittest.TestCase):
    def test_must_fail(self): self.fail("injected by run-tests.sh --self-test")
if __name__ == "__main__": unittest.main()
PY
  if run injected "$T" test_injected_failure.py; then :; fi
  if [ "$fail" -ne 1 ]; then rm -rf "$T"; echo "SELF-TEST FAILED: injected failure did not propagate"; exit 3; fi
  echo "harness propagates failure: OK"
  fail=0; echo "== harness self-test: a suite that collects fewer tests than required must also fail"
  cat >"$T/test_undercollecting.py" <<'PY2'
import unittest
class Undercollecting(unittest.TestCase):
    def test_only_one(self): self.assertTrue(True)
if __name__ == "__main__": unittest.main()
PY2
  if run undercollecting "$T" test_undercollecting.py 5; then :; fi
  rm -rf "$T"
  if [ "$fail" -ne 1 ]; then echo "SELF-TEST FAILED: undercollection did not propagate"; exit 3; fi
  echo "harness rejects undercollection: OK"; exit 0
fi
suite
if [ "$fail" -ne 0 ]; then echo "RESULT: FAIL"; exit 1; fi
echo "RESULT: PASS"
