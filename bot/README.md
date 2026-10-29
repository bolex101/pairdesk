# Pairdesk seven-exchange scanner + account linking
29 October 2026. This combined package includes the QFEX/RISEx scanner update; installing the earlier seven-exchange package separately is unnecessary.

## Install on the existing Pairdesk server
Upload this archive from your Mac, then on the server:

    cd /root
    tar -xzf pairdesk-seven-wallets.tar.gz
    cd pairdesk-seven-wallets
    bash upgrade.sh
    python3 /opt/pairdesk/setup-seven-wallets.py risex
    python3 /opt/pairdesk/setup-seven-wallets.py qfex

RISEx: accept your existing EVM wallet when prompted.
QFEX: enter the dedicated public and secret API key in the hidden server prompts. Both values stay out of shell history and Telegram. Use View positions and View orders only; no trading or transfer permissions. Primary account only, with a dedicated key scoped to it. Subaccounts are not enabled by this version.
The setup verifies API access before saving anything. QFEX credentials use systemd encrypted credentials, separately for each profile. Never paste keys into chat.
Existing five-exchange wallet integrations, Ondo credentials, current positions, friends approvals and channel settings remain in place. The installer backs up replaced code and restores it if installation/restart fails. Setup backs up the changed settings/state and rolls back on an installation exception.

## Verify privately in Telegram
After two successful monitoring cycles:

    /wallets
    /positions

Expect RISEx and QFEX account verification lines. Zero open legs is valid for an empty account.
A pair links automatically only when both legs, sides and verified entry times uniquely match a saved signal. Late entries use Link existing wallet positions on the original alert, with a review/confirmation. An API outage never means a position is closed.
If history cannot establish the current position's opening fill, the legs remain unmatched. Register actual fills manually rather than inventing an entry time. Trades opened before an alert cannot automatically adopt it.

## Friends
Existing approval-only access remains. Friends send /start and wait for owner approval.
For RISEx, an approved friend privately sends /wallet RISEx 0xTHEIR_ADDRESS.
For QFEX, each friend needs their own dedicated primary-account view-only key. Owner setup:

    python3 /opt/pairdesk/setup-seven-wallets.py qfex FRIEND_TELEGRAM_ID

The server prompts privately for that friend's key and rejects a key fingerprint already assigned to another profile. The owner must confirm that the supplied key belongs to that friend. A key fingerprint is not cryptographic proof of account ownership; different keys for the same exchange account cannot be detected through this limited access flow.
QFEX keys are never shared between owner/friend profiles. Friends see only their own registered positions and receive monitoring messages privately. Shared research messages never include wallet positions, account P&L or keys. Revocation stops friend monitoring.

## Linking checks and limitations
RISEx verifies returned wallet identity, signed position size, market name, average entry price and P&L unit consistency. Fill history is bounded to 3,000 trades. QFEX checks REST user-side fills against WebSocket executed-trade IDs, quantities, prices and execution timestamps; aggressor side and order placement time are not used as the user's direction/entry time.
Both reconstruct from the current signed quantity to the last flat/flip boundary and verify remaining average cost. Duplicate, ambiguous opposing same-time fills, insufficient history or a position changing during reads fail closed. Partial exits update remaining exposure; P&L excludes realized partial exits, fees and funding.
QFEX REST/WS correspondence must pass your server's authenticated validation; no local live QFEX account test was possible without your key. Setup will stop without saving if the production response differs from the documented format. RISEx live check for your confirmed wallet passed with zero open positions; nonempty positions were tested with fixtures.

## Scanner behavior
The 65/100 minimum, minimum same-direction 15m |z|=1, history, quote freshness and cost filters remain.
QFEX standard taker fees: equities 10bps, index/commodity 5bps per side. No personal discounts assumed.
RISEx standard taker fee: 3bps per side. Existing 3bps per-side slippage allowance remains. Funding, market impact and extra builder fees excluded.
QFEX research entries follow published weekly regular sessions. RISEx research entries use a conservative weekday 09:30–16:00 New York window. This is a research restriction, not the exchange's opening schedule. Weekly windows are not holiday calendars. Monitoring continues outside entry windows.
The scanner/monitor is updated on your server; the local browser dashboard is unchanged.

## Diagnostics
    /opt/pairdesk/bin/node /opt/pairdesk/check-seven-exchanges.cjs
    systemctl status pairdesk-monitor.service pairdesk-alerts.timer --no-pager
    journalctl -u pairdesk-monitor.service -n 40 --no-pager

## Official API references
https://docs.qfex.com/api-reference/rest/user/user-positions
https://docs.qfex.com/api-reference/rest/user/user-trades
https://docs.qfex.com/websocket/channels/trade/get_user_trades
https://docs.qfex.com/websocket/channels/trade/authenticate
https://developer.rise.trade/reference/accountservice_getportfoliodetails
https://developer.rise.trade/reference/getaccounttradehistory
