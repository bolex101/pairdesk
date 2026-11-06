#!/usr/bin/env bash
# Keep scripts/test-run.sh running (default mode "both") for long test-bot experiments.
# Exactly one instance per lock file; restarts the run 30 s after it exits for any reason.
#   Same environment as scripts/test-run.sh. Optional: PAIRDESK_TEST_LOCK (default /tmp/pairdesk-test-run.lock)
#   Start detached:  setsid nohup scripts/test-watchdog.sh both >> /workspace/pairdesk-test-run.log 2>&1 < /dev/null &
#   Stop:            kill -TERM -- -<watchdog pid>   (signals the whole process group)
set -uo pipefail
cd -- "$(dirname -- "$0")/.."
mode=${1:-both}
exec 9>"${PAIRDESK_TEST_LOCK:-/tmp/pairdesk-test-run.lock}"
flock -n 9 || { echo "$(date -u +%FT%TZ) watchdog: another instance holds the lock; exiting"; exit 1; }
child=
trap 'echo "$(date -u +%FT%TZ) watchdog: stopping"; [[ -n $child ]] && kill -TERM "$child" 2>/dev/null; wait; exit 0' INT TERM
while :; do
 echo "$(date -u +%FT%TZ) watchdog: starting scripts/test-run.sh $mode"
 bash scripts/test-run.sh "$mode" 9>&- & child=$!
 wait "$child"; code=$?
 echo "$(date -u +%FT%TZ) watchdog: test-run exited with code $code; restarting in 30 s"
 sleep 30
done
