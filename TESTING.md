# Testing Pairdesk

## Unit tests

```bash
npm test            # needs Node 24 (production version); also passes on Node 20
```

Runs every `bot/test*.cjs`. No network access and no Telegram messages.

## Live test with a separate Telegram bot

This runs the real scanner and monitor against live exchange prices. Messages go to
a **test bot** only. Production state, wallet links, the shared channel and the
production bot token are never used.

1. In Telegram, create a test bot with @BotFather and note its token and username.
   Send `/start` to the test bot, then get your chat id (for example from
   `https://api.telegram.org/bot<TEST_TOKEN>/getUpdates`).
2. Set three variables and start the run:

```bash
export PAIRDESK_TEST_TELEGRAM_BOT_TOKEN='123456:ABC...'   # test bot token
export PAIRDESK_TEST_TELEGRAM_CHAT_ID='123456789'         # your chat id with the test bot
export PAIRDESK_TEST_BOT_USERNAME='my_pairdesk_test_bot'  # test bot username, no @
npm run test-bot -- both      # same as: bash scripts/test-run.sh both
```

`both` starts the monitor and runs the collectors plus one scanner pass every
5 minutes until you press Ctrl-C. Other modes:

| Command | What it does |
|---|---|
| `bash scripts/test-run.sh dry` | One scanner pass, prints results, sends nothing (no Telegram variables needed) |
| `bash scripts/test-run.sh scan` | One scanner pass, sends alerts to the test bot |
| `bash scripts/test-run.sh monitor` | Monitor only (register trades from the test bot's alerts) |
| `bash scripts/test-run.sh both` | Monitor plus a scan every `PAIRDESK_TEST_SCAN_MINUTES` (default 5) |

Optional variables:
- `PAIRDESK_TEST_STATE_DIR`: where test state is kept (default `/workspace/pairdesk-test-state`).
- `PAIRDESK_CONFIG`: a thresholds file to try other settings (see `bot/pairdesk-config.example.json`).
- `PAIRDESK_SOLANA_RPC_URL`: a private Solana RPC for Phoenix timestamps.
- `NODE`: path to a Node 24 binary if `node` on your PATH is older.

The script refuses to start if the state directory looks like production
(`/var/lib/pairdesk`, `/opt/pairdesk`, `bot/state`), if the username is `pairdeskbot`,
or if the test token matches `TELEGRAM_BOT_TOKEN` in your shell. It starts the bot
processes with a clean environment, so production variables are not passed through.
Wallet sync is off (`wallet-config.json` with `enabled:false` in the test state dir)
and the shared channel is off (no channel file in the test state dir).

Variational and Ondo build their own 5-minute history from repeated samples, so they
need about 20 hours of `both` running before they can produce setups. The other
venues work straight away.

To reset the test run, stop it and delete the test state directory.
