#!/usr/bin/env bash
# Run the scanner and/or monitor against a separate TEST Telegram bot.
# Production tokens, state, wallet links and the shared channel are never used.
#   Required: PAIRDESK_TEST_TELEGRAM_BOT_TOKEN, PAIRDESK_TEST_TELEGRAM_CHAT_ID, PAIRDESK_TEST_BOT_USERNAME
#   Optional: PAIRDESK_TEST_STATE_DIR (default /workspace/pairdesk-test-state), PAIRDESK_TEST_SCAN_MINUTES (default 5)
# Usage: scripts/test-run.sh scan      one scanner pass that sends to the test bot
#        scripts/test-run.sh monitor   monitor in the foreground (Ctrl-C to stop)
#        scripts/test-run.sh both      monitor + a scanner pass every N minutes (Ctrl-C stops both)
#        scripts/test-run.sh dry       one scanner pass, prints only, sends nothing
set -Eeuo pipefail
cd -- "$(dirname -- "$0")/.."
mode=${1:-}
[[ $mode =~ ^(scan|monitor|both|dry)$ ]] || { sed -n 2,11p "$0"; exit 2; }
state=${PAIRDESK_TEST_STATE_DIR:-/workspace/pairdesk-test-state}
case "$(realpath -m "$state")" in
 /var/lib/pairdesk*|/opt/pairdesk*|"$(realpath -m bot/state)"*) echo "Refusing: $state looks like production state."; exit 1;;
esac
if [[ $mode != dry ]]; then
 : "${PAIRDESK_TEST_TELEGRAM_BOT_TOKEN:?set PAIRDESK_TEST_TELEGRAM_BOT_TOKEN (test bot token from @BotFather)}"
 : "${PAIRDESK_TEST_TELEGRAM_CHAT_ID:?set PAIRDESK_TEST_TELEGRAM_CHAT_ID (your chat id with the test bot)}"
 : "${PAIRDESK_TEST_BOT_USERNAME:?set PAIRDESK_TEST_BOT_USERNAME (test bot username, without @)}"
 [[ ${PAIRDESK_TEST_BOT_USERNAME,,} != pairdeskbot ]] || { echo 'Refusing: that is the production bot username.'; exit 1; }
 if [[ -n ${TELEGRAM_BOT_TOKEN:-} && $TELEGRAM_BOT_TOKEN == "$PAIRDESK_TEST_TELEGRAM_BOT_TOKEN" ]]; then echo 'Refusing: test token equals TELEGRAM_BOT_TOKEN in this shell.'; exit 1; fi
fi
node=${NODE:-node}
"$node" -e 'process.exit(Number(process.versions.node.split(".")[0])>=24?0:1)' || { echo 'Node 24+ required (set NODE=/path/to/node24).'; exit 1; }
mkdir -p -m 700 "$state"
[[ -f $state/wallet-config.json ]] || echo '{"enabled":false}' > "$state/wallet-config.json"
# Clean environment: only what the test needs. Production variables are not inherited.
run(){
 env -i PATH="$PATH" HOME="${HOME:-/tmp}" \
  TELEGRAM_BOT_TOKEN="${PAIRDESK_TEST_TELEGRAM_BOT_TOKEN:-}" TELEGRAM_CHAT_ID="${PAIRDESK_TEST_TELEGRAM_CHAT_ID:-}" \
  PAIRDESK_BOT_USERNAME="${PAIRDESK_TEST_BOT_USERNAME:-pairdesk_test_bot}" \
  PAIRDESK_STATE_DIR="$state" PAIRDESK_WALLET_CONFIG="$state/wallet-config.json" \
  PAIRDESK_CHANNEL_CONFIG="$state/channel-config.json" \
  ${PAIRDESK_CONFIG:+PAIRDESK_CONFIG="$PAIRDESK_CONFIG"} ${PAIRDESK_SOLANA_RPC_URL:+PAIRDESK_SOLANA_RPC_URL="$PAIRDESK_SOLANA_RPC_URL"} \
  "$node" "$@"
}
echo "Test state: $state (production state untouched; wallet sync and shared channel disabled)"
case $mode in
 dry) run bot/scanner.cjs ;;
 scan) run bot/scanner.cjs --send ;;
 monitor) run bot/monitor.cjs ;;
 both)
  run bot/monitor.cjs & mon=$!
  trap 'kill $mon 2>/dev/null; wait $mon 2>/dev/null; echo stopped' EXIT INT TERM
  while kill -0 $mon 2>/dev/null; do run bot/collector.cjs || true; run bot/ondo-collector.cjs || true; run bot/scanner.cjs --send || echo 'Scanner pass reported failures (see above)'; sleep $(( ${PAIRDESK_TEST_SCAN_MINUTES:-5} * 60 )); done ;;
esac
