# OKX Perpetual Research Bot

Local research dashboard for OKX USDT perpetual swap backtesting, signal inspection, portfolio validation, and simulated paper trading.

> Research software only. This project does not provide financial advice, does not guarantee profit, and does not place live exchange orders.

## Features

- Public OKX candle fetch for swap instruments such as `BTC-USDT-SWAP`
- Paginated OKX historical candle fetch for longer backtests
- Price-action strategy prototype:
  - breakout retest
  - false breakout reversal
- Optional trend filter:
  - higher-timeframe EMA trend direction
  - ADX trend-strength filter
  - ATR-based stop loss
- Adaptive price-action mode:
  - trend regime trades breakout retests
  - range regime trades false breakouts
  - chaotic regime does not trade
- Optional next-candle confirmation before entry
- Backtest with fees, stop loss, take profit, equity curve, drawdown, win rate
- 10 USDT aggressive profile with leverage-aware sizing, margin cap, liquidation reference, and slippage cost
- Single adaptive aggressive profile: fixed capital, automatic leverage selection, adaptive reward/risk, adaptive risk sizing, and a drawdown pause
- Backtest window control, defaulting to the latest 90 days
- Preset backtest windows for 24 hours, 3 days, 7 days, 30 days, and 90 days
- Parameter scan for lookback, ATR stop multiplier, reward/risk, and ADX threshold
- Joint parameter scan across BTC/ETH/SOL to reduce single-market overfitting
- Time-slice validation across the selected history window to show whether results are concentrated in one period
- Portfolio-level backtest for a single 10 USDT account across BTC/ETH/SOL with one open position at a time
- Portfolio time-slice validation to show whether the single-account returns come from one concentrated period
- Daily-mode preset for higher trade frequency research, using 15m entries, 1H context, one portfolio trade per day, and lower per-trade risk
- Signal-scan panel that explains current BTC/ETH/SOL decisions, signal scores, filters, and rejection reasons
- Risk circuit breaker controls for daily loss, loss streak, account drawdown, and abnormal ATR volatility
- Experimental trend strategies: trend pullback continuation, Donchian trend breakout, and a regime-based multi-strategy selector
- Telegram public-channel signal parser for learning entry, stop, take-profit, and scale-in structure from public preview messages
- Local browser dashboard
- Paper trading loop using simulated fills

## Project Structure

```text
.
├── app.py                 # Python HTTP API, research engine, and paper-trading loop
├── core/                  # Market data, indicators, signal logic, and result cache
├── public/                # Static dashboard served by app.py
├── quant-studio-ui/       # React/Vite research studio source
├── scripts/               # Lightweight validation scripts
└── requirements.txt       # Python dependency entry point
```

## Quick Start

Requirements:

- Python 3.11 or newer
- Node.js 20 or newer, only if you want to work on the React/Vite studio

```bash
git clone https://github.com/<your-user>/okx-perp-bot.git
cd okx-perp-bot
python3 -m pip install -r requirements.txt
python3 app.py
```

Open:

```text
http://127.0.0.1:8765
```

## React Studio

```bash
cd quant-studio-ui
npm install
npm run dev
```

Build check:

```bash
npm run build
```

## 24x7 Local Operations

Use the launchd manager to keep the backend, Quant Studio frontend, AI4Trade
read-only sidecar, watchdog, and sleep-prevention process running after macOS
login. Services stay bound to `127.0.0.1`.

```bash
python3 scripts/manage_24x7.py install
python3 scripts/manage_24x7.py status
python3 scripts/manage_24x7.py doctor
python3 scripts/manage_24x7.py tasks
python3 scripts/manage_24x7.py tasks --write
python3 scripts/manage_24x7.py readiness --record
python3 scripts/manage_24x7.py readiness-history
python3 scripts/manage_24x7.py live-lock-test
python3 scripts/manage_24x7.py evidence-bundle --write
python3 scripts/manage_24x7.py refresh-market-data --write
python3 scripts/manage_24x7.py recent-backtest --write
python3 scripts/manage_24x7.py pre-live-gate --phase readonly --no-fail
python3 scripts/manage_24x7.py restart
```

Runtime logs:

```text
.cache/launchd/backend.log
.cache/launchd/frontend.log
.cache/launchd/ai4trade.log
.cache/launchd/watchdog.log
.cache/launchd/readiness-snapshots.jsonl
.cache/launchd/evidence/
```

Store reboot-safe local credentials in macOS Keychain without pasting them into
chat or committing them to the repo:

```bash
python3 scripts/manage_24x7.py import-secrets
python3 scripts/manage_24x7.py import-secrets --restart
python3 scripts/manage_24x7.py import-secrets --restart --verify
python3 scripts/manage_24x7.py secrets-status
```

When `--restart` imports new values, the manager waits for the backend to come
back, prints post-import readiness evidence, and fails immediately if
`dry_run_only=true` / `can_submit_live=false` is not preserved. Use
`--skip-verify` only for local maintenance when you plan to run `readiness` or
`doctor` separately.
When credentials are entered from Quant Studio, the save receipt reports whether
the values were verified in Keychain and whether they survive a backend restart.

The manager forces `LIVE_TRADING_ENABLED=0`, `OKX_LIVE_ORDER_ENABLED=0`, and
`OKX_LIVE_CANCEL_ENABLED=0` for launchd services. `doctor` and the watchdog
treat `dry_run_only=true`, `can_submit_live=false`, and an execution ledger with
no `live_submitted` rows as required healthy safety conditions.
Use `evidence-bundle --write` when you need one sanitized audit artifact with
service status, equity source, readiness snapshots, Keychain presence, live-lock
state, and execution-ledger evidence.
Use `tasks --write` to persist the current automation task board. The watchdog
also writes `automation-task-board-watchdog-*` evidence when the top automation
task changes, so long-running sessions keep an audit trail of next actions.
Use `refresh-market-data --write` before recent backtests when cache freshness
matters. It enqueues a background `data_refresh` task, polls it with a timeout,
and writes public candle-cache refresh evidence without blocking the 7x24
services indefinitely. The automation task board also surfaces recommended
cache refreshes as a maintenance task, below safety-lock and OKX Keychain
blockers, so stale public data is visible from the same operator workflow. The
watchdog can also run one recommended public-cache refresh batch every 30
minutes when services are healthy and live-submit locks are intact; each
watchdog refresh writes a `market-data-refresh-watchdog` evidence file and is
reported by `doctor` / `evidence-bundle` as `watchdog_market_refresh`.
Very large stale history caches are marked with `high_refresh_cost=true` and
excluded from automatic recommended refresh batches once their estimated OKX
request count exceeds `MAX_AUTO_REFRESH_ESTIMATED_REQUESTS` (default `80`).
They are also skipped by the default stale-cache batch unless a caller explicitly
sets `include_high_cost=true`; refresh them from the data page one row at a time
or run a deliberate long-maintenance batch with
`python3 scripts/manage_24x7.py refresh-market-data --all-stale --include-high-cost --write`.
The data page and `doctor` show these as manual long-refresh rows, so they no
longer look like ordinary stale-cache blockers or prevent the 7x24 watchdog from
clearing strategy-core `15m` / `1H` data first.
AI4Trade remains a read-only signal/context source: `doctor` also reports
`ai4trade_signal_alignment`, which requires AI4Trade trade/copy/publish bridges
to be locked while local automation and execution config still expose
`can_submit_live=false`. The same check is included in the three pre-live gate
phases and surfaced on the Quant Studio live page as `对齐自检`.
Use `recent-backtest --write` to append a timestamped operational backtest
evidence file under `.cache/launchd/evidence/`. It runs the current 90-day
BTC/ETH/SOL 15m portfolio backtest, 30-day slice validation, paper-loop status,
and execution-lock checks through local APIs only. Add
`evidence-bundle --include-backtest --write` when you want the same backtest
summary embedded into the full runtime evidence bundle.
`doctor` and `pre-live-gate` also read the latest `recent-backtest-*` evidence
file and warn when the backtest evidence is stale, missing, or no longer proves
the live-submit locks stayed closed.
Use `pre-live-gate` for a strict machine-readable GO/NO-GO decision before
read-only validation, manual Canary review, or any future live-submit unlock.
It exits non-zero on `NO-GO`; add `--no-fail` when you want to print evidence
inside dashboards or scripts without stopping the caller:

```bash
python3 scripts/manage_24x7.py pre-live-gate --phase readonly --json --no-fail
python3 scripts/manage_24x7.py pre-live-gate --phase canary --json --no-fail
python3 scripts/manage_24x7.py pre-live-gate --phase live-submit --json --no-fail
```

The Quant Studio home page starts with the account equity curve fixed at
`2026-06-06 00:00` and advances in 15-minute slots. When OKX read-only
credentials are available, the curve records OKX account total equity from
`/api/v5/account/balance`; otherwise it explicitly falls back to simulated
paper-loop equity and shows the fallback reason.

## Read-Only Live Validation

This project can validate OKX private read-only access before any live-order work.
Use an OKX API key with read permissions only; do not enable trade or withdrawal
permissions for this phase.

1. Start the backend and Quant Studio frontend:

```bash
python3 app.py
cd quant-studio-ui
npm run dev
```

2. Open `http://127.0.0.1:5173`, go to the live workspace, and enter the
   read-only OKX key, secret, and passphrase.
3. Run OKX diagnostics. The expected pass state is account config, balance, and
   SWAP positions readable, with the private connector still reporting
   `dry_run_only` and `can_submit_live=false`.
4. Confirm the home page equity source switches to OKX read-only account equity.
5. Confirm the live-submit controls remain locked. Canary payloads and signed
   request previews are audit artifacts only; the app must not send
   `POST /api/v5/trade/order` or real cancel requests in this phase.

The first future Canary cap is recorded as 10 USDT, but real order submission
still requires a separate code unlock and review.

## Live Order Connector

The OKX live order path is implemented behind two local environment locks and
the in-app confirmation phrase. The default remains safe: no order is submitted
unless every lock and final gate passes.

Current development status, backtest evidence, UI/Figma gap, and live-validation
checklist are tracked in `docs/development-progress-audit.md`.

Required live-submit locks:

```bash
LIVE_TRADING_ENABLED=true
OKX_LIVE_ORDER_ENABLED=true
```

Recommended first live test:

1. Use an OKX API key with trade permission but no withdrawal permission.
2. Keep `max_live_order_notional_usd=10` and `canary_order_notional_usd=10`.
3. Run OKX diagnostics and confirm account config, balance, and SWAP positions
   are readable.
4. Generate an execution dry-run, review the final gate, then enter
   `CONFIRM_LIVE_TRADE`.
5. Use Canary lock test first. Only when the result records `live_submitted`
   with an OKX `ordId` should the order lifecycle be tracked.

Order status queries use `GET /api/v5/trade/order` for the selected ledger
entry. Live cancel requests remain locked unless `OKX_LIVE_CANCEL_ENABLED=true`
is set; when enabled, the live workspace exposes an explicit "提交真实撤单"
action for the selected order. A successful cancel request is recorded as
`cancel_requested`; keep querying the order until OKX reports a final canceled
or filled state.

## Checks

Run the lightweight research workflow smoke test after changing strategy health, snapshots, or research APIs:

```bash
python3 scripts/smoke_research_workflow.py
```

For frontend changes:

```bash
cd quant-studio-ui
npm run build
```

## Data and Privacy

- The backend uses OKX public market-data endpoints.
- No OKX API key is required for public data, backtests, or the default dry-run
  workflow.
- Private OKX credentials are optional and are kept in the current backend
  process for read-only diagnostics or explicitly unlocked live tests. Logs and
  JSON panels must show redacted keys/signatures only.
- Paper trading is simulated locally and does not submit exchange orders.
- Runtime cache, screenshots, logs, and paper-trading state are written under `.cache/`, `output/`, and `test-results/`; those paths are intentionally ignored by Git.

## Notes

- This version uses OKX public market data only. No API key is needed.
- Paper trading is simulated locally and does not send orders.
- The first goal is strategy research, not live execution.
- The default profile is intentionally aggressive: 10 USDT equity, up to 75x leverage, 70% maximum margin usage, and 10% maximum planned loss per trade. Lower these before any real-money test if the drawdown is unacceptable.
- The default research profile now uses 1H candles, 1.8 ATR stops, and a 90-day validation window. The Louie-style mode focuses on same-bar sweep, delayed sweep, wedge reversal, and selective high-ADX breakout tests; broad trend-chasing remains disabled after longer validation showed 15m trend breakout entries were the main loss source.
- The daily-mode preset is for activity, not maximum return. In the latest cached 90-day BTC/ETH/SOL portfolio test it produced about 70 trades, +31.55% return from 10 USDT, and 11.59% max drawdown. The 30-day slices were +18.38%, +15.62%, and -1.18%, so it is more active but still has losing periods.
- Experimental trend strategies did not beat the current daily-mode baseline in the latest 90-day portfolio check. The best new candidate was strict trend pullback at about +26.28% with 30 trades and 12.83% max drawdown; keep it as a secondary candidate, not the default.
- The 20% monthly target preset enables the inverse-trend breakout-test filter. On the latest cached 90-day BTC/ETH/SOL portfolio window, this changed the target-mode result from about +15.74% return / 15.59% max drawdown to about +26.15% return / 14.91% max drawdown, while improving the three 30-day slice profile from 1/3 positive to 2/3 positive. Daily mode leaves the filter off because its cached baseline was stronger without it.
- The Telegram learning module only analyzes public preview messages. In the latest `@colin112` sample it found 9 structured signals from 12 visible messages: all used market-style entries, most used scale-in/add-on wording, average stop distance was about 4.15%, and average TP1 was about 1.24R.
- The paper-trading loop now applies risk circuit breakers before opening a simulated position. Defaults are 6% daily loss, 3 consecutive losses, 15% account drawdown, and 1.2% ATR volatility.
- Liquidation price is an approximation for research. OKX uses mark price, account mode, position tiers, maintenance margin, funding, order loss, and current fee tier in live risk checks.
- Do not treat a parameter scan with very few trades as reliable. The dashboard will not auto-apply scan results with fewer than 5 trades.
- The dashboard keeps extra candles for indicator warmup, but entries and equity statistics are restricted to the configured backtest window.
- Scanned parameters can overfit one market. Use the multi-market validation table across BTC/ETH/SOL and 7/30-day windows before trusting any candidate.
- Use time-slice validation before paper/live testing. The current aggressive default is positive on the 90-day aggregate, but slice results can show weak or empty earlier periods.
- Use portfolio backtest to estimate the single-account path. Per-market validation treats each symbol as a separate 10 USDT account, while portfolio backtest shares one equity pool and chooses one signal at a time.
- Use portfolio time-slice validation before trusting the headline return. A high aggregate return can still be concentrated in the most recent slice.
- If joint scan cannot find a positive multi-market candidate, treat that as strategy failure rather than a parameter problem.
