#!/usr/bin/env bash
set -Eeuo pipefail
[[ $(id -u) == 0 ]] || { echo 'Run as root.'; exit 1; }
cd -- "$(dirname -- "$0")"
node=/opt/pairdesk/bin/node
for required in "$node" /opt/pairdesk/friends.cjs /opt/pairdesk/shared-channel.cjs /opt/pairdesk/wallet-link.cjs /opt/pairdesk/performance.cjs /opt/pairdesk/plan-config.json; do
 [[ -f "$required" ]] || { echo 'Install the existing five-exchange, friends and monitoring updates first.'; exit 1; }
done
"$node" -e 'if(Number(process.versions.node.split(".")[0])<24||typeof WebSocket!=="function")process.exit(1)' || { echo 'Node 24 with WebSocket support is required.'; exit 1; }
files=(linked-history.cjs risex-wallet.cjs qfex-wallet.cjs wallet-feeds.cjs wallet-sync.cjs friends.cjs buttons.cjs setup-seven-wallets.py monitor-feeds.cjs extra-venues.cjs new-venues.cjs positions.cjs shared-channel.cjs monitor.cjs performance.cjs scanner.cjs alert-rules.cjs check-seven-exchanges.cjs)
for file in "${files[@]}"; do if [[ "$file" == *.cjs ]]; then "$node" --check "$file"; fi; done
python3 -c 'import ast,pathlib; ast.parse(pathlib.Path("setup-seven-wallets.py").read_text())'
for test in test*.cjs; do "$node" "$test"; done
"$node" -e 'if(require("./alert-rules.cjs").MIN_ALERT_SCORE!==65||require("./scan-engine.js").MIN_CONFIRM_Z!==1)process.exit(1)'
backup="/opt/pairdesk-seven-wallet-backup-$(date +%Y%m%d-%H%M%S)"
mkdir -m 700 "$backup"
for file in "${files[@]}"; do if [[ -f "/opt/pairdesk/$file" ]]; then cp -p "/opt/pairdesk/$file" "$backup/"; fi; done
timer=false; monitor=false
if systemctl is-active --quiet pairdesk-alerts.timer; then timer=true; fi
if systemctl is-active --quiet pairdesk-monitor.service; then monitor=true; fi
rollback(){
 trap - ERR
 echo "Upgrade failed; restoring application files from $backup"
 for file in "${files[@]}"; do
  if [[ -f "$backup/$file" ]]; then cp -p "$backup/$file" /opt/pairdesk/; else rm -f "/opt/pairdesk/$file"; fi
 done
 if $monitor; then systemctl start pairdesk-monitor.service || true; fi
 if $timer; then systemctl start pairdesk-alerts.timer || true; fi
 exit 1
}
trap rollback ERR
systemctl stop pairdesk-alerts.timer pairdesk-alerts.service pairdesk-monitor.service
if [[ -f /var/lib/pairdesk/positions.json ]]; then cp -p /var/lib/pairdesk/positions.json "$backup/positions-state.json"; fi
for file in "${files[@]}"; do install -m 644 "$file" "/opt/pairdesk/$file"; done
"$node" -e 'const p="/opt/pairdesk/"; for(const f of ["extra-venues.cjs","new-venues.cjs","positions.cjs","shared-channel.cjs","performance.cjs","monitor-feeds.cjs","friends.cjs"])require(p+f);if(require(p+"alert-rules.cjs").MIN_ALERT_SCORE!==65)process.exit(1)'
if $monitor; then systemctl start pairdesk-monitor.service; fi
if $timer; then systemctl start pairdesk-alerts.timer; fi
trap - ERR
echo "Seven-exchange scanner and wallet-linking code installed. Backup: $backup"
echo 'Existing credentials, wallet adapters, friends, channel settings and positions retained.'
echo 'QFEX/RISEx: research alerts, manual Register trade monitoring and simulated performance enabled.'
echo 'Enable owner accounts with: python3 /opt/pairdesk/setup-seven-wallets.py risex'
echo 'Then: python3 /opt/pairdesk/setup-seven-wallets.py qfex'
echo 'QFEX primary-account access is validated before encrypted credentials are saved.'
echo 'Read-only verification: /opt/pairdesk/bin/node /opt/pairdesk/check-seven-exchanges.cjs'
