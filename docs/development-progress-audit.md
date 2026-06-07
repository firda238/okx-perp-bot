# OKX Quant Development Progress Audit

Updated: 2026-06-07 Asia/Shanghai

## Current Stage

The project is running under the local 7x24 guard stack and is close to a
controlled live-validation stage, but it is not ready for unrestricted live
trading. The correct next milestone is:

1. Import OKX credentials into macOS Keychain and restart backend/watchdog.
2. Run OKX read-only private diagnostics with real credentials.
3. Confirm account config, balance, SWAP positions, and order-query signing.
4. Refresh public K-line caches and rerun recent portfolio evidence.
5. Only after a separate unlock review, consider a 10 USDT Canary.

## Completed

- Portfolio backtest, rolling slices, attribution experiments, and recent market
  validation are callable from the backend and wired into Quant Studio.
- Quant Studio has workspaces for dashboard, market, strategy, backtest, risk,
  live execution, data, and settings.
- OKX private read-only validation paths are implemented for:
  - `GET /api/v5/account/config`
  - `GET /api/v5/account/balance`
  - `GET /api/v5/account/positions`
  - `GET /api/v5/trade/order`
- OKX live submit is implemented behind all of these gates:
  - `LIVE_TRADING_ENABLED=true`
  - `OKX_LIVE_ORDER_ENABLED=true`
  - OKX credentials configured
  - final risk gate allows submit
  - confirmation phrase is `CONFIRM_LIVE_TRADE`
- OKX live cancel is separately locked behind `OKX_LIVE_CANCEL_ENABLED=true`.
- Live cancel acceptance is recorded as `cancel_requested`, not final canceled;
  the operator must continue querying OKX order state.
- Canary live test notional is set to `10 USDT`.
- Execution ledger lifecycle now distinguishes preview, rejected, submitted,
  open, cancel requested, canceled, filled, duplicate, and timeout states.
- UI smoke covers the live workspace, connector preview, private lock state,
  Canary preview, ledger detail, query/cancel/fill action buttons, pre-live
  gate labels, AI4Trade read-only lock text, and the account-equity home page.
- `scripts/manage_24x7.py recent-backtest` now writes timestamped backtest,
  slice, paper-loop, and live-lock evidence under `.cache/launchd/evidence/`.

## Latest Backtest Evidence

Evidence file:

- `.cache/launchd/evidence/recent-backtest-20260607T052850514399Z.json`
- Public cache refresh evidence:
  `.cache/launchd/evidence/market-data-refresh-20260607T051254524483Z.json`
- Watchdog public cache refresh evidence:
  `.cache/launchd/evidence/market-data-refresh-watchdog-20260607T050918611654Z.json`
- Full runtime evidence:
  `.cache/launchd/evidence/evidence-20260607T052915110763Z.json`

Default Quant Studio-style parameters:

- Symbols: BTC/USDT SWAP, ETH/USDT SWAP, SOL/USDT SWAP
- Bar: 15m
- History: 2160 hours
- Initial equity: 10 USDT
- Canary notional cap: 10 USDT

Refreshed 90-day portfolio result:

- Window: 2026-03-09 03:15 UTC to 2026-06-07 03:15 UTC
- Final equity: 13.4533 USDT
- Return: +34.53%
- Max drawdown: 13.29%
- Trades: 47
- Win rate: 38.30%
- Profit factor: 1.55
- Max consecutive losses: 11
- Health: D, score 32.90, verdict "暂不建议扩大"

30-day portfolio slices:

- Slice 1: +0.22%, max drawdown 9.74%, 18 trades
- Slice 2: +3.11%, max drawdown 11.77%, 14 trades
- Slice 3: -1.79%, max drawdown 8.76%, 18 trades
- Aggregate: 3 cases, 2 positive, average return +0.52%, worst drawdown 11.77%

Freshness note:

- `python3 scripts/manage_24x7.py refresh-market-data --max-items 2 --timeout 120 --poll 2 --write`
  completed on 2026-06-07 and reduced stale cache rows from 41 to 39, recommended
  refresh rows from 13 to 11.
- Watchdog self-maintenance then ran one guarded recommended refresh batch and
  reduced stale cache rows from 39 to 38, recommended refresh rows from 11 to 10.
- The refreshed portfolio evidence was regenerated at 2026-06-07 05:28:49 UTC
  after public cache maintenance; summary metrics were unchanged from the prior
  accepted result.
- `doctor` now reports data-cache health. Current state: 49 caches, 38 stale,
  10 recommended. Strategy-core BTC/ETH/SOL `15m` and `1H` rows: 17 core rows,
  9 stale, 9 recommended.
- Latest 2026-06-07 maintenance run refreshed 29 public cache rows in guarded
  batches, reduced recommended refresh rows from 32 to 0, and left strategy-core
  BTC/ETH/SOL `15m` / `1H` rows at 31 core rows, 0 stale, 0 recommended.
  Remaining stale rows are covered-by-fresh-cache or high-cost historical
  caches, including a large BTC `5m` row that is no longer auto-recommended.
- Cache rows with an estimated OKX public request count above
  `MAX_AUTO_REFRESH_ESTIMATED_REQUESTS` (default `80`) now expose
  `high_refresh_cost=true` and are excluded from automatic recommended refresh
  batches. They can still be refreshed manually as a separate maintenance item.
- Automation task board now exposes `refresh_market_data` as a maintenance task
  below the OKX Keychain blocker when recommended public cache rows are present.
- Watchdog now has a guarded public-data self-maintenance path: when there are
  recommended refresh rows, no critical health checks, and live-submit locks are
  intact, it can run one recommended cache refresh batch every 30 minutes and
  write `market-data-refresh-watchdog` evidence. `doctor` and `evidence-bundle`
  now report the latest self-maintenance status through `watchdog_market_refresh`.
  It does not touch private OKX trading endpoints.
- AI4Trade sidecar alignment is now part of `doctor` / `evidence-bundle` through
  `ai4trade_signal_alignment`: AI4Trade must stay configured as read-only
  signal context, trade/copy/publish bridges must be locked, and local
  automation/execution config must still report `can_submit_live=false`.
- The same AI4Trade alignment evidence now flows into backend
  `pre_live_gates` and the Quant Studio live page `对齐自检` card, so CLI,
  watchdog evidence, and UI use the same read-only signal-context boundary.
- `doctor` / `pre-live-gate` now read the latest `recent-backtest-*` evidence
  file and warn if recent backtest evidence is missing, stale, or does not
  preserve `dry_run_only=true` / `can_submit_live=false`.

Risk interpretation: current parameters are acceptable only for tiny live
observation. They do not justify scaling beyond the first 10 USDT Canary.

Runtime evidence captured with the backtest:

- Paper loop running: true
- Paper equity: 10.560825770066224
- `dry_run_only`: true
- `can_submit_live`: false
- `LIVE_TRADING_ENABLED`: false
- `OKX_LIVE_ORDER_ENABLED`: false
- `OKX_LIVE_CANCEL_ENABLED`: false

## UI And Figma Status

Local Quant Studio UI has a working smoke test and screenshot evidence:

- `.cache/quant-live-progress.png`
- `output/playwright/quant-live-smoke.png`

Detailed UI/Figma comparison requirements are tracked in
`docs/ui-figma-audit.md`.

Figma baseline status is partially initialized:

- Baseline file: `OKX Quant Studio Live UI Baseline`
- URL: `https://www.figma.com/design/7tL766C5V1xj3h7nQDpfHr`
- Capture status: blocked by Figma MCP Starter plan tool-call limit
- Screenshot asset upload status: blocked by the same Figma MCP limit

To complete the UI@Figma requirement, one of these is required:

- Provide a node-specific Figma URL for the Quant UI design.
- Provide a Figma file URL plus the relevant node ID.
- Continue capture or asset upload into the new baseline file after the Figma
  MCP rate limit resets or the plan is upgraded.
- Manually import `output/playwright/quant-live-smoke.png` into the baseline
  file and use it as the review baseline.

Until then, Figma parity is an evidence gap, not a completed item.

## Remaining Work Before Live Testing

1. Configure real OKX read-only credentials in Keychain.
2. Run OKX diagnostics and confirm read-only health is pass.
3. Verify logs and JSON panels redact API key, secret, passphrase, and signature.
4. Decide whether to run the long BTC 5m cache refresh; strategy-core 15m/1H
   caches are fresh.
5. Generate a fresh execution dry-run and confirm:
   - data freshness is pass
   - account equity is above 10 USDT
   - OKX positions are empty
   - final gate allows submit
   - payload notional is at or below 10 USDT
6. Run `pre-live-gate --phase readonly --json` and resolve all blockers.
7. Run `pre-live-gate --phase canary --json` and perform manual review.
8. Keep real submit locked unless a separate live-submit unlock review is
   explicitly approved.
9. If live-submit is later unlocked, submit only the 10 USDT Canary and query OKX
   order state until filled or canceled.
10. Enable `OKX_LIVE_CANCEL_ENABLED=true` only if a real cancel test is needed.
11. Commit the current working tree after the read-only/live validation scope is
    accepted.

## Current Verification Commands

These commands passed after the latest connector and UI changes:

```bash
python3 scripts/test_task_queue.py
python3 scripts/smoke_research_workflow.py
python3 scripts/test_automation_safety.py
python3 scripts/test_24x7_backtest_evidence.py
python3 scripts/manage_24x7.py refresh-market-data --max-items 2 --timeout 90 --poll 2 --write
python3 scripts/manage_24x7.py refresh-market-data --max-items 1 --timeout 90 --poll 2 --write
python3 scripts/manage_24x7.py recent-backtest --write --timeout 120
python3 scripts/manage_24x7.py evidence-bundle --include-backtest --write
python3 scripts/manage_24x7.py live-lock-test --json
python3 -m py_compile app.py scripts/manage_24x7.py scripts/test_automation_safety.py scripts/test_24x7_backtest_evidence.py
cd quant-studio-ui && npm run build
cd quant-studio-ui && npm run smoke:ui
git diff --check
```

Execution ledger check found no real submitted orders and no exchange order IDs.
