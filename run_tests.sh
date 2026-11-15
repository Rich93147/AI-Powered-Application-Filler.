#!/bin/sh
# Runs every regression test. Python tests need: pip install playwright && playwright install chromium
# Tests use Playwright's Chromium; set CHROMIUM_PATH=/path/to/chrome to use a different one.
cd "$(dirname "$0")"; fail=0
for t in tests/test_*.py; do timeout 180 python3 "$t" >/tmp/af_t.txt 2>&1 && echo "PASS $t" || { echo "FAIL $t"; tail -4 /tmp/af_t.txt; fail=1; }; done
for t in tests/test_*.cjs; do timeout 90 node "$t" >/tmp/af_t.txt 2>&1 && echo "PASS $t" || { echo "FAIL $t"; tail -4 /tmp/af_t.txt; fail=1; }; done
exit $fail
