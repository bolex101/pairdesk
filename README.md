# Pairdesk

TradFi pair-research scanner and private Telegram position monitor.

## Included
- Seven-exchange server scanner: Popdex, Arcus, Variational, Ondo, Phoenix, QFEX and RISEx.
- Score >=65 and same-direction 15m confirmation filters, fixed-fit pair plans and estimated trading costs.
- Shared research channel, approval-only friend access, private fill registration and position monitoring.
- Read-only account linking, late-entry linking and simulated signal performance.
- QFEX authentication/history response fix.
- Original local dashboard (its exchange coverage differs from the server scanner).

No exchange orders are placed. Pair z-target/z-stop alerts are model thresholds, not guarantees of monetary profit or loss.

## Layout
- bot/: current consolidated server source, tests, setup tools and existing-installation upgrade script.
- dashboard/: local browser application and Python read-only market relay.
- diagnostics/: credential-safe Ondo authentication diagnostic.

This is a source snapshot of the local project, not a backup of the production server. Credentials, trading records, sampled price history and user/channel settings are deliberately excluded. Server-only modifications may differ from this snapshot. The installer is for an existing Pairdesk deployment; it is not a fresh-server installer.

## Test
Requires Node.js 24 and Python 3:

    cd bot
    for test in test*.cjs; do node "$test" || exit 1; done

Tests use synthetic fixtures and mocked Telegram/account requests. Live checks are separate.

## Local dashboard
    python3 dashboard/server.py

Open http://127.0.0.1:8765/. The relay binds locally; do not expose it as a public service.

## Existing server
See bot/README.md for upgrade/setup. Preserve /etc/pairdesk and /var/lib/pairdesk separately using your own protected backup.
Configure credentials through interactive server setup tools. Copy example settings only when configuring a new local development environment; never overwrite live settings with examples.
QFEX linking currently supports the primary account. Missing execution timestamps, ambiguous matches or insufficient history leave positions unlinked.

## Privacy
Owner and approved friends have separate state and notifications. Shared-channel messages contain research fields, not wallet balances or position P&L. Keep actual bot tokens and exchange keys outside the repository, even if it is private.
