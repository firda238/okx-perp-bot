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
- No OKX API key is required.
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
