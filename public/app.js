const $ = (id) => document.getElementById(id);
let lastBacktest = { candles: [], trades: [] };
let selectedTradeIndex = null;

function cssVar(name, fallback) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

function chartTheme() {
  return {
    bg: cssVar("--chart-bg", "#fbfbfd"),
    grid: cssVar("--chart-grid", "#d2d2d7"),
    axis: cssVar("--muted", "#6e6e73"),
    equity: cssVar("--accent", "#0071e3"),
    up: cssVar("--positive", "#0a7f42"),
    down: cssVar("--danger", "#d70015"),
    warn: cssVar("--warn", "#b26a00"),
  };
}

function fmtMoney(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return "-";
  return Number(value).toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function fmtPct(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return "-";
  return `${(Number(value) * 100).toFixed(2)}%`;
}

function fmtNum(value, digits = 2) {
  if (value === null || value === undefined || Number.isNaN(value)) return "-";
  return Number(value).toFixed(digits);
}

function shortDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function shortDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString([], { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function dataSourceLabel(source) {
  const labels = {
    "okx-live": "实时",
    "memory-cache": "内存",
    "disk-cache": "缓存",
    "stale-memory-cache": "旧缓存",
    "stale-disk-cache": "旧缓存",
    "okx-error-stale-cache": "失败兜底",
  };
  return labels[source] || source || "-";
}

function dataFreshnessLabel(data) {
  if (!data) return "-";
  const stale = data.stale_markets ?? 0;
  const sourceText = (data.sources || []).map(dataSourceLabel).join("/") || "-";
  return stale > 0 ? `${sourceText}，旧 ${stale}` : sourceText;
}

function settings() {
  const preset = $("historyPreset").value;
  const historyHours = preset === "custom" ? Number($("historyHours").value) : Number(preset);
  const secondTradeFilter = $("secondTradeFilter").value;
  const secondTradeAllowedKinds =
    secondTradeFilter === "sweep"
      ? ["louie_delayed_sweep_reversal", "louie_sweep_reversal"]
      : secondTradeFilter === "delayed"
        ? ["louie_delayed_sweep_reversal"]
        : null;
  return {
    strategy_mode: $("strategyMode").value,
    instId: $("instId").value,
    bar: $("bar").value,
    trend_bar: $("trendBar").value,
    history_hours: historyHours,
    initial_equity: Number($("initialEquity").value),
    risk_pct: Number($("riskPct").value) / 100,
    max_loss_pct_per_trade: Number($("riskPct").value) / 100,
    leverage: Number($("leverage").value),
    max_leverage: Number($("leverage").value),
    min_leverage: 5,
    adaptive_leverage: $("adaptiveLeverage").checked,
    adaptive_trade_management: $("adaptiveLeverage").checked,
    adaptive_risk: $("adaptiveLeverage").checked,
    loss_streak_risk_decay: 0.30,
    drawdown_risk_sensitivity: Number($("drawdownRiskSensitivity").value),
    min_adaptive_risk_factor: Number($("minAdaptiveRiskFactor").value),
    absolute_min_risk_factor: 0.08,
    max_strategy_drawdown: 0.35,
    margin_pct_per_trade: Number($("marginPctPerTrade").value) / 100,
    maintenance_margin_rate: 0.005,
    min_liq_buffer_pct: Number($("minLiqBufferPct").value) / 100,
    cost_model: $("costModel").value,
    fee_rate: Number($("takerFeePct").value) / 100,
    maker_fee_rate: Number($("makerFeePct").value) / 100,
    taker_fee_rate: Number($("takerFeePct").value) / 100,
    entry_order_type: "taker",
    take_profit_order_type: $("costModel").value === "simple" ? "taker" : "maker",
    stop_order_type: "taker",
    slippage_pct: Number($("slippagePct").value) / 100,
    use_multi_take_profit: $("useMultiTakeProfit").checked,
    tp1_share_pct: Number($("tp1SharePct").value) / 100,
    tp2_share_pct: Number($("tp2SharePct").value) / 100,
    move_stop_to_breakeven_after_tp1: $("breakEvenAfterTp1").checked,
    lookback: Number($("lookback").value),
    atr_stop_mult: Number($("atrStopMult").value),
    take_profit_rr: Number($("takeProfitRr").value),
    min_adx: Number($("minAdx").value),
    min_breakout_atr: Number($("minBreakoutAtr").value),
    min_sweep_atr: Number($("minSweepAtr").value),
    min_body_ratio: Number($("minBodyRatio").value),
    cooldown_bars: Number($("cooldownBars").value),
    time_exit_bars: Number($("timeExitBars").value),
    time_exit_min_rr: Number($("timeExitMinRr").value),
    loss_streak_pause_bars: Number($("lossStreakPauseBars").value),
    short_trend_risk_factor: Number($("shortTrendRiskFactor").value),
    max_daily_trades: Number($("maxDailyTrades").value),
    min_signal_score: Number($("minSignalScore").value),
    second_trade_allowed_kinds: secondTradeAllowedKinds,
    second_trade_side: "any",
    enable_risk_circuit_breaker: $("enableRiskCircuitBreaker").checked,
    max_daily_loss_pct: Number($("maxDailyLossPct").value) / 100,
    max_loss_streak_stop: Number($("maxLossStreakStop").value),
    max_account_drawdown_pct: Number($("maxAccountDrawdownPct").value) / 100,
    max_atr_pct: Number($("maxAtrPct").value) / 100,
    require_next_confirmation: $("requireNextConfirmation").checked,
    prefer_cache: $("preferCache").checked,
    offline_mode: false,
    use_regime_filter: ["adaptive_price_action", "louie_price_action", "regime_multi_strategy"].includes($("strategyMode").value),
    trend_adx: 24,
    range_adx: 18,
    max_risk_atr: 3,
    atr_period: 14,
    adx_period: 14,
    trend_fast: 50,
    trend_slow: 120,
    max_surprise_prior_run_atr: 3.2,
    max_surprise_confirm_extension_atr: 1.0,
    max_surprise_confirm_retrace_atr: 0.95,
    trade_louie_trend_regime: false,
    trade_louie_breakout_tests: true,
    trade_louie_delayed_sweeps: true,
    min_louie_breakout_adx: 32,
    breakout_risk_factor: Number($("breakoutRiskFactor").value),
    enable_breakout_guard: $("enableBreakoutGuard").checked,
    breakout_guard_window: Number($("breakoutGuardWindow").value),
    breakout_guard_min_samples: 4,
    breakout_guard_max_loss_rate: 0.65,
    breakout_guard_risk_multiplier: Number($("breakoutGuardRiskMultiplier").value),
    block_eth_longs: $("blockEthLongs").checked,
    block_delayed_sweep_in_chaos: false,
    block_long_in_chaos: false,
    block_breakout_against_trend: false,
    limit: 300,
  };
}

function syncHistoryPreset() {
  const preset = $("historyPreset").value;
  if (preset !== "custom") {
    $("historyHours").value = preset;
  }
}

function applyDailyMode() {
  $("strategyMode").value = "louie_price_action";
  $("bar").value = "15m";
  $("trendBar").value = "1H";
  $("historyPreset").value = "2160";
  $("historyHours").value = "2160";
  $("riskPct").value = "3";
  $("blockEthLongs").checked = false;
  $("costModel").value = "simple";
  $("makerFeePct").value = "0.02";
  $("takerFeePct").value = "0.05";
  $("slippagePct").value = "0.02";
  $("timeExitBars").value = "0";
  $("timeExitMinRr").value = "0.25";
  $("lossStreakPauseBars").value = "0";
  $("shortTrendRiskFactor").value = "1.00";
  $("maxDailyTrades").value = "1";
  $("minSignalScore").value = "0";
  $("maxDailyLossPct").value = "6";
  $("maxLossStreakStop").value = "3";
  $("maxAccountDrawdownPct").value = "15";
  $("maxAtrPct").value = "1.2";
  $("drawdownRiskSensitivity").value = "2.4";
  $("minAdaptiveRiskFactor").value = "0.30";
  $("enableRiskCircuitBreaker").checked = true;
  $("lookback").value = "8";
  $("timeExitBars").value = "0";
  $("timeExitMinRr").value = "0.25";
  $("lossStreakPauseBars").value = "0";
  $("shortTrendRiskFactor").value = "1.00";
  $("minSweepAtr").value = "0.15";
  $("minBodyRatio").value = "0.45";
  $("breakoutRiskFactor").value = "0.70";
  $("enableBreakoutGuard").checked = false;
  $("breakoutGuardWindow").value = "6";
  $("breakoutGuardRiskMultiplier").value = "0.55";
  $("atrStopMult").value = "1.8";
  $("takeProfitRr").value = "2.8";
  $("useMultiTakeProfit").checked = false;
  $("tp1SharePct").value = "40";
  $("tp2SharePct").value = "30";
  $("breakEvenAfterTp1").checked = true;
  $("requireNextConfirmation").checked = false;
  $("preferCache").checked = true;
  $("status").textContent = "已应用每日模式，先跑组合回测和组合切片验证";
}

function applyTargetMode() {
  $("strategyMode").value = "louie_price_action";
  $("bar").value = "15m";
  $("trendBar").value = "1H";
  $("historyPreset").value = "2160";
  $("historyHours").value = "2160";
  $("riskPct").value = "10";
  $("costModel").value = "okx_aggressive";
  $("makerFeePct").value = "0.02";
  $("takerFeePct").value = "0.05";
  $("slippagePct").value = "0.02";
  $("maxDailyTrades").value = "1";
  $("secondTradeFilter").value = "off";
  $("blockEthLongs").checked = true;
  $("minSignalScore").value = "0.55";
  $("maxDailyLossPct").value = "12";
  $("maxLossStreakStop").value = "4";
  $("maxAccountDrawdownPct").value = "30";
  $("maxAtrPct").value = "1.2";
  $("drawdownRiskSensitivity").value = "3.2";
  $("minAdaptiveRiskFactor").value = "0.22";
  $("enableRiskCircuitBreaker").checked = true;
  $("lookback").value = "8";
  $("minSweepAtr").value = "0.15";
  $("minBodyRatio").value = "0.45";
  $("breakoutRiskFactor").value = "0.35";
  $("enableBreakoutGuard").checked = true;
  $("breakoutGuardWindow").value = "8";
  $("breakoutGuardRiskMultiplier").value = "0.70";
  $("atrStopMult").value = "1.9";
  $("takeProfitRr").value = "3.0";
  $("useMultiTakeProfit").checked = false;
  $("tp1SharePct").value = "40";
  $("tp2SharePct").value = "30";
  $("breakEvenAfterTp1").checked = true;
  $("requireNextConfirmation").checked = false;
  $("preferCache").checked = true;
  $("timeExitBars").value = "0";
  $("timeExitMinRr").value = "0.25";
  $("lossStreakPauseBars").value = "0";
  $("shortTrendRiskFactor").value = "0.70";
  $("status").textContent = "已应用 20% 月目标模式，建议先跑组合回测和组合切片";
}

async function postJson(url, payload = {}) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "请求失败");
  return data;
}

function drawEquity(curve) {
  const canvas = $("equityChart");
  const ctx = canvas.getContext("2d");
  const theme = chartTheme();
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = theme.bg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (!curve || curve.length < 2) return;

  const points = curve.filter((point, index, rows) => {
    if (index === 0 || index === rows.length - 1) return true;
    return point.equity !== rows[index - 1].equity || point.equity !== rows[index + 1].equity;
  });
  const plotPoints = points.length >= 2 ? points : curve;
  const values = plotPoints.map((p) => p.equity);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pad = { left: 44, right: 18, top: 24, bottom: 34 };
  const plotW = canvas.width - pad.left - pad.right;
  const plotH = canvas.height - pad.top - pad.bottom;
  const scaleY = (v) => canvas.height - pad.bottom - ((v - min) / Math.max(max - min, 1)) * plotH;
  const scaleX = (i) => pad.left + (i / Math.max(plotPoints.length - 1, 1)) * plotW;

  ctx.strokeStyle = theme.grid;
  ctx.lineWidth = 1;
  ctx.fillStyle = theme.axis;
  ctx.font = "12px system-ui";
  for (let i = 0; i < 5; i += 1) {
    const ratio = i / 4;
    const value = max - (max - min) * ratio;
    const y = pad.top + ratio * plotH;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(canvas.width - pad.right, y);
    ctx.stroke();
    ctx.fillText(fmtMoney(value), 8, y + 4);
  }

  for (let i = 0; i < 4; i += 1) {
    const index = Math.round((plotPoints.length - 1) * (i / 3));
    const x = scaleX(index);
    ctx.fillText(shortDate(plotPoints[index]?.time), x - 14, canvas.height - 10);
  }

  const baselineY = scaleY(plotPoints[0].equity);
  const gradient = ctx.createLinearGradient(0, pad.top, 0, canvas.height - pad.bottom);
  gradient.addColorStop(0, "rgba(0, 113, 227, 0.18)");
  gradient.addColorStop(1, "rgba(0, 113, 227, 0)");
  ctx.fillStyle = gradient;
  ctx.beginPath();
  plotPoints.forEach((point, i) => {
    const x = scaleX(i);
    const y = scaleY(point.equity);
    if (i === 0) ctx.moveTo(x, baselineY);
    ctx.lineTo(x, y);
  });
  ctx.lineTo(scaleX(plotPoints.length - 1), baselineY);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = theme.equity;
  ctx.lineWidth = 2.5;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.beginPath();
  plotPoints.forEach((point, i) => {
    const x = scaleX(i);
    const y = scaleY(point.equity);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  ctx.fillStyle = theme.equity;
  plotPoints.forEach((point, i) => {
    if (i !== 0 && i !== plotPoints.length - 1 && point.equity === plotPoints[i - 1].equity) return;
    ctx.beginPath();
    ctx.arc(scaleX(i), scaleY(point.equity), 2.5, 0, Math.PI * 2);
    ctx.fill();
  });

  ctx.fillStyle = theme.axis;
  ctx.font = "12px system-ui";
  ctx.fillText("权益", canvas.width - 44, 16);
}

function drawPriceChart(candles, trades, selectedTrade = null) {
  const canvas = $("priceChart");
  const ctx = canvas.getContext("2d");
  const theme = chartTheme();
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = theme.bg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (!candles || candles.length < 2) return;

  const pad = { left: 52, right: 58, top: 26, bottom: 34 };
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const max = Math.max(...highs);
  const min = Math.min(...lows);
  const plotW = canvas.width - pad.left - pad.right;
  const plotH = canvas.height - pad.top - pad.bottom;
  const candleW = Math.max(2, Math.min(9, plotW / candles.length * 0.62));
  const xFor = (i) => pad.left + (i / Math.max(candles.length - 1, 1)) * plotW;
  const yFor = (price) => canvas.height - pad.bottom - ((price - min) / Math.max(max - min, 1)) * plotH;

  ctx.strokeStyle = theme.grid;
  ctx.lineWidth = 1;
  ctx.fillStyle = theme.axis;
  ctx.font = "12px system-ui";
  for (let i = 0; i < 5; i += 1) {
    const ratio = i / 4;
    const value = max - (max - min) * ratio;
    const y = pad.top + ratio * plotH;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(canvas.width - pad.right, y);
    ctx.stroke();
    ctx.fillText(fmtMoney(value), canvas.width - pad.right + 6, y + 4);
  }

  for (let i = 0; i < 5; i += 1) {
    const index = Math.round((candles.length - 1) * (i / 4));
    const x = xFor(index);
    ctx.fillText(shortDate(candles[index]?.time), x - 14, canvas.height - 10);
  }

  candles.forEach((candle, i) => {
    const x = xFor(i);
    const openY = yFor(candle.open);
    const closeY = yFor(candle.close);
    const highY = yFor(candle.high);
    const lowY = yFor(candle.low);
    const up = candle.close >= candle.open;
    ctx.strokeStyle = up ? theme.up : theme.down;
    ctx.fillStyle = up ? theme.up : theme.down;
    ctx.beginPath();
    ctx.moveTo(x, highY);
    ctx.lineTo(x, lowY);
    ctx.stroke();
    ctx.fillRect(x - candleW / 2, Math.min(openY, closeY), candleW, Math.max(1, Math.abs(closeY - openY)));
  });

  const indexByTime = new Map(candles.map((c, i) => [c.time, i]));
  trades.forEach((trade) => {
    const entryIndex = indexByTime.get(trade.entry_time);
    if (entryIndex !== undefined) {
      const x = xFor(entryIndex);
      const y = yFor(trade.entry);
      ctx.fillStyle = trade.side === "long" ? theme.up : theme.down;
      ctx.beginPath();
      if (trade.side === "long") {
        ctx.moveTo(x, y - 8);
        ctx.lineTo(x - 6, y + 5);
        ctx.lineTo(x + 6, y + 5);
      } else {
        ctx.moveTo(x, y + 8);
        ctx.lineTo(x - 6, y - 5);
        ctx.lineTo(x + 6, y - 5);
      }
      ctx.closePath();
      ctx.fill();
    }

    const exitIndex = indexByTime.get(trade.exit_time);
    if (exitIndex !== undefined) {
      const x = xFor(exitIndex);
      const y = yFor(trade.exit_price);
      ctx.strokeStyle = trade.pnl >= 0 ? theme.up : theme.down;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, 5, 0, Math.PI * 2);
      ctx.stroke();
    }
  });

  if (selectedTrade) {
    const entryIndex = indexByTime.get(selectedTrade.entry_time);
    const exitIndex = indexByTime.get(selectedTrade.exit_time);
    const entryX = entryIndex === undefined ? pad.left : xFor(entryIndex);
    const exitX = exitIndex === undefined ? canvas.width - pad.right : xFor(exitIndex);
    const leftX = Math.min(entryX, exitX);
    const rightX = Math.max(entryX, exitX);
    const entryY = yFor(selectedTrade.entry);
    const stopY = yFor(selectedTrade.stop);
    const tpY = yFor(selectedTrade.take_profit);
    const exitY = yFor(selectedTrade.exit_price);

    ctx.fillStyle = "rgba(178, 106, 0, 0.10)";
    ctx.fillRect(leftX, pad.top, Math.max(rightX - leftX, 10), plotH);

    const drawLevel = (priceY, label, color) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 5]);
      ctx.beginPath();
      ctx.moveTo(pad.left, priceY);
      ctx.lineTo(canvas.width - pad.right, priceY);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = color;
      ctx.font = "12px system-ui";
      ctx.fillText(label, canvas.width - pad.right - 108, priceY - 5);
    };

    drawLevel(entryY, `Entry ${fmtMoney(selectedTrade.entry)}`, theme.warn);
    drawLevel(stopY, `Stop ${fmtMoney(selectedTrade.stop)}`, theme.down);
    drawLevel(tpY, `TP ${fmtMoney(selectedTrade.take_profit)}`, theme.up);

    ctx.strokeStyle = selectedTrade.pnl >= 0 ? theme.up : theme.down;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(entryX, entryY);
    ctx.lineTo(exitX, exitY);
    ctx.stroke();

    ctx.fillStyle = theme.warn;
    ctx.beginPath();
    ctx.arc(entryX, entryY, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = selectedTrade.pnl >= 0 ? theme.up : theme.down;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(exitX, exitY, 8, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.fillStyle = theme.axis;
  ctx.font = "12px system-ui";
  ctx.fillText("日期", canvas.width - 48, canvas.height - 10);
}

function renderTrades(trades) {
  $("trades").innerHTML = [...trades]
    .reverse()
    .map((t, displayIndex) => {
      const originalIndex = trades.length - 1 - displayIndex;
      const cls = t.pnl >= 0 ? "pnl-positive" : "pnl-negative";
      const selected = originalIndex === selectedTradeIndex ? " selected-row" : "";
      return `<tr class="trade-row${selected}" data-trade-index="${originalIndex}">
        <td>${new Date(t.entry_time).toLocaleString()}</td>
        <td>${t.side}</td>
        <td>${t.kind}</td>
        <td>${t.trend || "-"}</td>
        <td>${fmtMoney(t.entry)}</td>
        <td>${fmtMoney(t.exit_price)}</td>
        <td>${t.exit_reason}</td>
        <td class="${cls}">${fmtMoney(t.pnl)}</td>
      </tr>`;
    })
    .join("");
}

function tradeRMultiple(trade) {
  const risk = Math.abs(trade.entry - trade.stop);
  if (!risk) return null;
  const direction = trade.side === "long" ? 1 : -1;
  return ((trade.exit_price - trade.entry) * direction) / risk;
}

function attributionRows(trades, keyFn) {
  const groups = new Map();
  trades.forEach((trade) => {
    const key = keyFn(trade) || "-";
    const current = groups.get(key) || { key, trades: 0, wins: 0, pnl: 0, rTotal: 0, rCount: 0 };
    const r = tradeRMultiple(trade);
    current.trades += 1;
    current.wins += trade.pnl > 0 ? 1 : 0;
    current.pnl += trade.pnl;
    if (r !== null) {
      current.rTotal += r;
      current.rCount += 1;
    }
    groups.set(key, current);
  });
  return [...groups.values()].sort((a, b) => a.pnl - b.pnl);
}

function renderAttributionTable(tableId, rows) {
  if (!rows.length) {
    $(tableId).innerHTML = `<tr><td colspan="5">暂无交易</td></tr>`;
    return;
  }
  $(tableId).innerHTML = rows
    .map((row) => {
      const pnlClass = row.pnl >= 0 ? "pnl-positive" : "pnl-negative";
      const winRate = row.trades ? row.wins / row.trades : 0;
      const avgR = row.rCount ? row.rTotal / row.rCount : null;
      return `<tr>
        <td>${row.key}</td>
        <td>${row.trades}</td>
        <td>${fmtPct(winRate)}</td>
        <td>${avgR === null ? "-" : avgR.toFixed(2)}</td>
        <td class="${pnlClass}">${fmtMoney(row.pnl)}</td>
      </tr>`;
    })
    .join("");
}

function renderAttribution(trades) {
  const totalPnl = trades.reduce((sum, trade) => sum + trade.pnl, 0);
  const wins = trades.filter((trade) => trade.pnl > 0).length;
  const rValues = trades.map(tradeRMultiple).filter((value) => value !== null);
  const avgR = rValues.length ? rValues.reduce((sum, value) => sum + value, 0) / rValues.length : null;
  $("attributionCost").textContent = "-";
  $("attributionCostRatio").textContent = "-";
  $("attributionRecommendations").textContent = "-";
  $("attributionRecommendationRows").innerHTML = `<tr><td colspan="8">运行模块归因后显示建议</td></tr>`;
  $("attributionSummary").innerHTML = `
    <div><span>交易</span><strong>${trades.length}</strong></div>
    <div><span>胜率</span><strong>${fmtPct(trades.length ? wins / trades.length : 0)}</strong></div>
    <div><span>平均R</span><strong>${avgR === null ? "-" : avgR.toFixed(2)}</strong></div>
    <div><span>总盈亏</span><strong class="${totalPnl >= 0 ? "pnl-positive" : "pnl-negative"}">${fmtMoney(totalPnl)}</strong></div>
  `;
  renderAttributionTable("kindAttributionRows", attributionRows(trades, (trade) => trade.kind));
  renderAttributionTable("trendAttributionRows", attributionRows(trades, (trade) => trade.trend));
  renderAttributionTable("regimeAttributionRows", attributionRows(trades, (trade) => trade.regime));
  renderAttributionTable("sideAttributionRows", attributionRows(trades, (trade) => trade.side));
}

function renderServerAttributionTable(tableId, rows) {
  if (!rows?.length) {
    $(tableId).innerHTML = `<tr><td colspan="5">暂无交易</td></tr>`;
    return;
  }
  $(tableId).innerHTML = rows
    .map((row) => `<tr>
      <td>${row.key}</td>
      <td>${row.trades}</td>
      <td>${fmtPct(row.win_rate)}</td>
      <td>${row.avg_r === null || row.avg_r === undefined ? "-" : Number(row.avg_r).toFixed(2)}</td>
      <td class="${row.pnl >= 0 ? "pnl-positive" : "pnl-negative"}">${fmtMoney(row.pnl)}</td>
    </tr>`)
    .join("");
}

function renderAttributionReport(result) {
  const summary = result.summary || {};
  const groups = result.groups || {};
  if (result.base_result) renderPortfolio(result.base_result);
  $("attributionCost").textContent = fmtMoney(summary.total_cost);
  $("attributionCostRatio").textContent = summary.cost_to_pnl === null || summary.cost_to_pnl === undefined ? "-" : fmtPct(summary.cost_to_pnl);
  $("attributionRecommendations").textContent = summary.recommendations ?? "-";
  $("attributionRecommendationRows").innerHTML = (result.recommendations || [])
    .map((row) => {
      const statusClass = row.status === "核心" ? "pnl-positive" : row.status === "降权" ? "pnl-negative" : "warn-text";
      return `<tr>
        <td>${row.group}</td>
        <td>${row.key}</td>
        <td class="${statusClass}">${row.status}</td>
        <td>${row.trades}</td>
        <td>${fmtPct(row.win_rate)}</td>
        <td>${row.profit_factor === null || row.profit_factor === undefined ? "-" : Number(row.profit_factor).toFixed(2)}</td>
        <td class="${row.pnl >= 0 ? "pnl-positive" : "pnl-negative"}">${fmtMoney(row.pnl)}</td>
        <td class="reason-cell">${row.action}</td>
      </tr>`;
    })
    .join("") || `<tr><td colspan="8">没有需要处理的模块建议</td></tr>`;
  renderServerAttributionTable("kindAttributionRows", groups.kind || []);
  renderServerAttributionTable("trendAttributionRows", groups.trend || []);
  renderServerAttributionTable("regimeAttributionRows", groups.regime || []);
  renderServerAttributionTable("sideAttributionRows", groups.side || []);
  $("status").textContent = `模块归因完成：${summary.trades ?? 0} 笔，成本 ${fmtMoney(summary.total_cost)}`;
}

function renderAttributionExperiments(result) {
  const summary = result.summary || {};
  $("experimentBest").textContent = summary.best_name || "-";
  $("experimentBestReturn").textContent = fmtPct(summary.best_return_pct);
  $("experimentBestDrawdown").textContent = fmtPct(summary.best_drawdown);
  $("experimentCases").textContent = summary.cases ?? "-";
  $("attributionExperimentRows").innerHTML = (result.rows || [])
    .map((row, index) => {
      const s = row.summary || {};
      const robust = row.robust || {};
      const isBest = index === 0 && row.summary;
      const statusClass = row.status === "错误" ? "pnl-negative" : row.status === "通过" ? "pnl-positive" : "warn-text";
      return `<tr class="${isBest ? "selected-row" : ""}">
        <td>${row.name}</td>
        <td>${fmtNum(row.params?.short_trend_risk_factor, 2)}</td>
        <td>${fmtNum(row.params?.breakout_risk_factor, 2)}</td>
        <td>${row.score === null || row.score === undefined ? "-" : fmtNum(row.score, 3)}</td>
        <td>${s.final_equity === undefined ? "-" : fmtMoney(s.final_equity)}</td>
        <td class="${(s.return_pct || 0) >= 0 ? "pnl-positive" : "pnl-negative"}">${s.return_pct === undefined ? "-" : fmtPct(s.return_pct)}</td>
        <td class="${(row.monthly_return || 0) >= 0 ? "pnl-positive" : "pnl-negative"}">${row.monthly_return === null || row.monthly_return === undefined ? "-" : fmtPct(row.monthly_return)}</td>
        <td>${s.max_drawdown === undefined ? "-" : fmtPct(s.max_drawdown)}</td>
        <td>${row.rolling_ratio === null || row.rolling_ratio === undefined ? "-" : fmtPct(row.rolling_ratio)}</td>
        <td class="${(robust.rolling_worst_return_pct || 0) >= 0 ? "pnl-positive" : "pnl-negative"}">${robust.rolling_worst_return_pct === undefined ? "-" : fmtPct(robust.rolling_worst_return_pct)}</td>
        <td>${s.trades ?? "-"}</td>
        <td>${s.profit_factor === null || s.profit_factor === undefined ? "-" : Number(s.profit_factor).toFixed(2)}</td>
        <td class="${statusClass}">${row.status || "-"}</td>
        <td class="reason-cell">${row.error || row.note || "-"}</td>
      </tr>`;
    })
    .join("");
  $("status").textContent = `归因实验完成：最佳 ${summary.best_name || "-"}，收益 ${fmtPct(summary.best_return_pct)}`;
}

function renderSnapshotRows(result) {
  $("snapshotRows").innerHTML = (result.rows || [])
    .map((row) => `<tr>
      <td>${row.created_at ? new Date(row.created_at).toLocaleString() : "-"}</td>
      <td>${row.label || "-"}</td>
      <td class="${(row.return_pct || 0) >= 0 ? "pnl-positive" : "pnl-negative"}">${row.return_pct === undefined ? "-" : fmtPct(row.return_pct)}</td>
      <td>${row.max_drawdown === undefined ? "-" : fmtPct(row.max_drawdown)}</td>
      <td>${row.profit_factor === null || row.profit_factor === undefined ? "-" : Number(row.profit_factor).toFixed(2)}</td>
      <td>${row.readiness_decision || "-"}</td>
      <td>${row.readiness_score ?? "-"}</td>
      <td>${row.experiment_best || "-"}</td>
      <td class="reason-cell">${row.path || row.file || row.error || "-"}</td>
    </tr>`)
    .join("") || `<tr><td colspan="9">暂无快照</td></tr>`;
}

async function refreshResearchSnapshots() {
  const response = await fetch("/api/research-snapshots?limit=10");
  const result = await response.json();
  renderSnapshotRows(result);
  return result;
}

function renderSavedSnapshot(result) {
  const s = result.summary || {};
  $("snapshotStatus").textContent = result.ok ? "已保存" : "失败";
  $("snapshotFile").textContent = result.path || "-";
  $("snapshotReadiness").textContent = `${s.readiness_decision || "-"} / ${s.readiness_score ?? "-"}`;
  $("snapshotExperiment").textContent = s.experiment_best || "-";
  $("snapshotEquity").textContent = fmtMoney(s.final_equity);
  $("snapshotReturn").textContent = fmtPct(s.return_pct);
  $("snapshotDrawdown").textContent = fmtPct(s.max_drawdown);
  $("snapshotProfitFactor").textContent = s.profit_factor === null || s.profit_factor === undefined ? "-" : Number(s.profit_factor).toFixed(2);
  $("status").textContent = `研究快照已保存：${result.path}`;
}

function renderTradeReview(trade) {
  if (!trade) {
    $("tradeReview").innerHTML = `<p class="empty-review">运行回测后选择一笔交易。</p>`;
    return;
  }
  const pnlClass = trade.pnl >= 0 ? "pnl-positive" : "pnl-negative";
  const rMultiple = tradeRMultiple(trade);
  const tpHits = (trade.tp_hits || []).map((hit) => `${fmtMoney(hit.price)} (${hit.rr ? Number(hit.rr).toFixed(1) : "-"}R)`).join(" / ");
  $("tradeReview").innerHTML = `
    <div class="review-head">
      <span>${trade.side.toUpperCase()}</span>
      <strong class="${pnlClass}">${fmtMoney(trade.pnl)}</strong>
    </div>
    <dl>
      <dt>形态</dt><dd>${trade.kind}</dd>
      <dt>趋势</dt><dd>${trade.trend || "-"}</dd>
      <dt>行情</dt><dd>${trade.regime || "-"}</dd>
      <dt>入场</dt><dd>${fmtMoney(trade.entry)}</dd>
      <dt>止损</dt><dd>${fmtMoney(trade.stop)}</dd>
      <dt>止盈</dt><dd>${fmtMoney(trade.take_profit)}</dd>
      <dt>分批止盈</dt><dd>${tpHits || "-"}</dd>
      <dt>杠杆</dt><dd>${trade.leverage ? `${Number(trade.leverage).toFixed(0)}x` : "-"}</dd>
      <dt>自适应R</dt><dd>${trade.adaptive_rr ? Number(trade.adaptive_rr).toFixed(2) : "-"}</dd>
      <dt>风险系数</dt><dd>${trade.risk_factor ? Number(trade.risk_factor).toFixed(2) : "-"}</dd>
      <dt>名义</dt><dd>${fmtMoney(trade.notional)}</dd>
      <dt>保证金</dt><dd>${fmtMoney(trade.margin_used)}</dd>
      <dt>爆仓价</dt><dd>${fmtMoney(trade.liquidation_price)}</dd>
      <dt>出场</dt><dd>${fmtMoney(trade.exit_price)} / ${trade.exit_reason}</dd>
      <dt>手续费</dt><dd>${fmtMoney(trade.fees)}</dd>
      <dt>滑点</dt><dd>${fmtMoney(trade.slippage)}</dd>
      <dt>R值</dt><dd>${rMultiple === null ? "-" : rMultiple.toFixed(2)}</dd>
      <dt>ADX</dt><dd>${trade.adx === null || trade.adx === undefined ? "-" : Number(trade.adx).toFixed(1)}</dd>
      <dt>ATR</dt><dd>${trade.atr === null || trade.atr === undefined ? "-" : fmtMoney(trade.atr)}</dd>
    </dl>
  `;
}

function selectTrade(index) {
  selectedTradeIndex = index;
  const trade = lastBacktest.trades[selectedTradeIndex] || null;
  drawPriceChart(lastBacktest.candles, lastBacktest.trades, trade);
  renderTrades(lastBacktest.trades);
  renderTradeReview(trade);
}

function applyBestParams(best) {
  if (best.params.strategy_mode) $("strategyMode").value = best.params.strategy_mode;
  if (typeof best.params.require_next_confirmation === "boolean") {
    $("requireNextConfirmation").checked = best.params.require_next_confirmation;
  }
  $("lookback").value = best.params.lookback;
  $("atrStopMult").value = best.params.atr_stop_mult;
  $("takeProfitRr").value = best.params.take_profit_rr;
  $("minAdx").value = best.params.min_adx;
  $("minBreakoutAtr").value = best.params.min_breakout_atr;
  $("minSweepAtr").value = best.params.min_sweep_atr;
  if (best.params.breakout_risk_factor !== undefined) {
    $("breakoutRiskFactor").value = best.params.breakout_risk_factor;
  }
}

function renderOptimization(rows) {
  $("optimizeRows").innerHTML = rows
    .map((row, index) => `<tr>
      <td>${index + 1}</td>
      <td>${row.params.strategy_mode || "-"}</td>
      <td>${row.params.require_next_confirmation ? "是" : "否"}</td>
      <td>${row.params.lookback}</td>
      <td>${row.params.atr_stop_mult}</td>
      <td>${row.params.take_profit_rr}</td>
      <td>${row.params.min_adx}</td>
      <td>${row.params.min_breakout_atr}</td>
      <td>${row.params.min_sweep_atr}</td>
      <td>${fmtPct(row.summary.return_pct)}</td>
      <td>${fmtPct(row.summary.max_drawdown)}</td>
      <td>${row.summary.trades}</td>
      <td>${fmtPct(row.summary.win_rate)}</td>
    </tr>`)
    .join("");
}

async function runJointOptimize() {
  $("status").textContent = "联合扫描中...";
  try {
    const current = settings();
    const result = await postJson("/api/joint-optimize", {
      ...current,
      symbols: ["BTC-USDT-SWAP", "ETH-USDT-SWAP", "SOL-USDT-SWAP"],
      windows: [current.history_hours],
    });
    renderOptimization(result.top);
    if (result.best.summary.trades >= 5 && result.best.summary.positive_cases >= 2) {
      applyBestParams(result.best);
      $("status").textContent = "联合扫描完成，已应用第一名参数";
      await runValidate();
    } else {
      $("status").textContent = "联合扫描完成，但通过样本不足，未自动应用";
    }
  } catch (error) {
    $("status").textContent = error.message;
  }
}

function renderValidation(result) {
  const aggregate = result.aggregate;
  $("positiveCases").textContent = `${aggregate.positive_cases}/${aggregate.cases}`;
  $("avgValidationReturn").textContent = fmtPct(aggregate.avg_return_pct);
  $("worstValidationDrawdown").textContent = fmtPct(aggregate.worst_drawdown);
  $("validationRows").innerHTML = result.results
    .map((row) => {
      if (row.error) {
        return `<tr>
          <td>${row.inst_id}</td>
          <td>${row.history_hours}h</td>
          <td>-</td>
          <td>-</td>
          <td>-</td>
          <td>-</td>
          <td>-</td>
          <td>-</td>
          <td>${row.error}</td>
        </tr>`;
      }
      const s = row.summary;
      const status = s.trades < 5 ? "样本少" : s.return_pct > 0 ? "通过" : "失败";
      return `<tr>
        <td>${row.inst_id}</td>
        <td>${row.history_hours}h</td>
        <td class="${s.return_pct >= 0 ? "pnl-positive" : "pnl-negative"}">${fmtPct(s.return_pct)}</td>
        <td>${fmtPct(s.max_drawdown)}</td>
        <td>${s.trades}</td>
        <td>${fmtPct(s.win_rate)}</td>
        <td>${s.profit_factor === null ? "-" : Number(s.profit_factor).toFixed(2)}</td>
        <td>${s.max_consecutive_losses}</td>
        <td>${status}</td>
      </tr>`;
    })
    .join("");
}

function compactDate(value) {
  if (!value) return "-";
  return new Date(value).toLocaleDateString();
}

function renderSliceValidation(result) {
  const aggregate = result.aggregate;
  $("status").textContent = `切片验证完成：${aggregate.positive_cases}/${aggregate.cases} 为正，最差 ${fmtPct(aggregate.worst_return_pct)}`;
  $("sliceValidationRows").innerHTML = result.results
    .map((row) => {
      const s = row.summary;
      const status = s.trades === 0 ? "无交易" : s.return_pct > 0 ? "通过" : "失败";
      return `<tr>
        <td>${row.slice}</td>
        <td>${row.inst_id}</td>
        <td>${compactDate(row.window_start)} - ${compactDate(row.window_end)}</td>
        <td class="${s.return_pct >= 0 ? "pnl-positive" : "pnl-negative"}">${fmtPct(s.return_pct)}</td>
        <td>${fmtPct(s.max_drawdown)}</td>
        <td>${s.trades}</td>
        <td>${fmtPct(s.win_rate)}</td>
        <td>${s.profit_factor === null ? "-" : Number(s.profit_factor).toFixed(2)}</td>
        <td>${status}</td>
      </tr>`;
    })
    .join("");
}

function renderPortfolio(result) {
  const s = result.summary;
  $("portfolioEquity").textContent = fmtMoney(s.final_equity);
  $("portfolioReturn").textContent = fmtPct(s.return_pct);
  $("portfolioDrawdown").textContent = fmtPct(s.max_drawdown);
  $("portfolioTrades").textContent = s.trades;
  $("finalEquity").textContent = fmtMoney(s.final_equity);
  $("returnPct").textContent = fmtPct(s.return_pct);
  $("drawdown").textContent = fmtPct(s.max_drawdown);
  $("winRate").textContent = fmtPct(s.win_rate);
  $("tradeCount").textContent = s.trades;
  $("profitFactor").textContent = s.profit_factor === null ? "-" : Number(s.profit_factor).toFixed(2);
  $("expectancy").textContent = fmtMoney(s.expectancy);
  $("maxLossStreak").textContent = s.max_consecutive_losses;
  $("candleCount").textContent = result.equity_curve?.length ?? "-";
  if (result.equity_curve?.length) drawEquity(result.equity_curve);
  if (result.trades?.length) {
    lastBacktest = { candles: lastBacktest.candles || [], trades: result.trades };
    selectedTradeIndex = result.trades.length - 1;
    renderTrades(result.trades);
    renderTradeReview(result.trades[selectedTradeIndex]);
    renderAttribution(result.trades);
  }
  $("portfolioRows").innerHTML = result.by_symbol
    .map((row) => `<tr>
      <td>${row.inst_id}</td>
      <td>${row.trades}</td>
      <td class="${row.pnl >= 0 ? "pnl-positive" : "pnl-negative"}">${fmtMoney(row.pnl)} / ${fmtPct(row.return_pct)}</td>
      <td>${fmtPct(row.win_rate)}</td>
    </tr>`)
    .join("");
}

function renderPortfolioSlices(result) {
  const aggregate = result.aggregate;
  $("status").textContent = `组合切片完成：${aggregate.positive_cases}/${aggregate.cases} 为正，最差 ${fmtPct(aggregate.worst_return_pct)}`;
  $("portfolioSliceRows").innerHTML = result.results
    .map((row) => {
      const s = row.summary;
      const status = s.trades === 0 ? "无交易" : s.return_pct > 0 ? "通过" : "失败";
      return `<tr>
        <td>${row.slice}</td>
        <td>${compactDate(row.window_start)} - ${compactDate(row.window_end)}</td>
        <td>${fmtMoney(s.final_equity)}</td>
        <td class="${s.return_pct >= 0 ? "pnl-positive" : "pnl-negative"}">${fmtPct(s.return_pct)}</td>
        <td>${fmtPct(s.max_drawdown)}</td>
        <td>${s.trades}</td>
        <td>${fmtPct(s.win_rate)}</td>
        <td>${status}</td>
      </tr>`;
    })
    .join("");
}

function renderRobustness(result) {
  const aggregate = result.aggregate;
  $("robustVerdict").textContent = aggregate.verdict || "-";
  $("robustRollingPass").textContent = `${aggregate.rolling_positive_cases}/${aggregate.rolling_cases}`;
  $("robustStressWorst").textContent = fmtPct(aggregate.stress_worst_return_pct);
  $("rollingRobustRows").innerHTML = (result.rolling || [])
    .map((row) => {
      const s = row.summary;
      const status = s.trades === 0 ? "无交易" : s.return_pct > 0 ? "通过" : "失败";
      return `<tr>
        <td>${row.case}</td>
        <td>${compactDate(row.window_start)} - ${compactDate(row.window_end)}</td>
        <td class="${s.return_pct >= 0 ? "pnl-positive" : "pnl-negative"}">${fmtPct(s.return_pct)}</td>
        <td class="${row.monthly_return >= 0 ? "pnl-positive" : "pnl-negative"}">${fmtPct(row.monthly_return)}</td>
        <td>${fmtPct(s.max_drawdown)}</td>
        <td>${s.trades}</td>
        <td>${s.profit_factor === null ? "-" : Number(s.profit_factor).toFixed(2)}</td>
        <td>${status}</td>
      </tr>`;
    })
    .join("");
  $("stressRows").innerHTML = (result.stress || [])
    .map((row) => {
      const s = row.summary;
      return `<tr>
        <td>${row.name}</td>
        <td>${row.cost_model || "-"}</td>
        <td>${fmtPct(row.fee_rate)}</td>
        <td>${fmtPct(row.slippage_pct)}</td>
        <td class="${s.return_pct >= 0 ? "pnl-positive" : "pnl-negative"}">${fmtPct(s.return_pct)}</td>
        <td class="${row.monthly_return >= 0 ? "pnl-positive" : "pnl-negative"}">${fmtPct(row.monthly_return)}</td>
        <td>${fmtPct(s.max_drawdown)}</td>
        <td>${s.trades}</td>
        <td>${s.profit_factor === null ? "-" : Number(s.profit_factor).toFixed(2)}</td>
      </tr>`;
    })
    .join("");
  $("status").textContent = `稳健测试完成：滚动 ${aggregate.rolling_positive_cases}/${aggregate.rolling_cases}，压力最差 ${fmtPct(aggregate.stress_worst_return_pct)}`;
}

function renderMonteCarlo(result) {
  const s = result.summary || {};
  $("mcVerdict").textContent = s.verdict || "-";
  $("mcLossProb").textContent = fmtPct(s.loss_probability);
  $("mcFloorProb").textContent = fmtPct(s.floor_hit_probability);
  $("mcP95Drawdown").textContent = fmtPct(s.p95_max_drawdown);
  $("mcP05Equity").textContent = fmtMoney(s.p05_final_equity);
  $("mcMedianEquity").textContent = fmtMoney(s.median_final_equity);
  $("mcP95Equity").textContent = fmtMoney(s.p95_final_equity);
  $("mcWorstEquity").textContent = fmtMoney(s.worst_final_equity);
  $("monteCarloRows").innerHTML = (result.rows || [])
    .map((row) => `<tr>
      <td>${row.run}</td>
      <td class="${row.final_equity >= s.floor_equity ? "pnl-positive" : "pnl-negative"}">${fmtMoney(row.final_equity)}</td>
      <td>${fmtPct(row.max_drawdown)}</td>
      <td>${row.floor_hit ? "是" : "否"}</td>
    </tr>`)
    .join("");
  $("status").textContent = `蒙特卡洛完成：${s.verdict || "-"}，亏损概率 ${fmtPct(s.loss_probability)}，P95 回撤 ${fmtPct(s.p95_max_drawdown)}`;
}

function renderSignalScan(result) {
  const summary = result.summary || {};
  $("signalReady").textContent = summary.ready ?? "-";
  $("signalWatch").textContent = summary.watch ?? "-";
  $("signalBlocked").textContent = summary.blocked ?? "-";
  $("signalDataFreshness").textContent = dataFreshnessLabel(result.data);
  $("signalScanRows").innerHTML = (result.rows || [])
    .map((row) => {
      const signal = row.signal || {};
      const context = row.context || {};
      const priceData = row.data?.price || {};
      const statusClass = row.status === "ready" ? "pnl-positive" : row.status === "error" ? "pnl-negative" : "";
      const sourceClass = priceData.is_stale ? "pnl-negative" : "pnl-positive";
      const reasons = (row.reasons || []).join("；") || "-";
      return `<tr>
        <td>${row.inst_id}</td>
        <td>${shortDateTime(priceData.latest_closed || context.time)}</td>
        <td class="${sourceClass}">${dataSourceLabel(priceData.source)}</td>
        <td class="${statusClass}">${row.decision || row.status}</td>
        <td>${row.score === null || row.score === undefined ? "-" : fmtNum(row.score, 2)}</td>
        <td>${signal.kind || "-"}</td>
        <td>${signal.side || "-"}</td>
        <td>${context.trend || "-"} / ${context.regime || "-"}</td>
        <td>${fmtNum(context.adx, 1)}</td>
        <td>${fmtPct(context.atr_pct)}</td>
        <td class="reason-cell">${reasons}</td>
      </tr>`;
    })
    .join("");
}

function readinessValue(row) {
  const value = row.value;
  if (value === null || value === undefined) return "-";
  if (typeof value !== "number") return value;
  if (row.name.includes("交易数")) return String(Math.round(value));
  if (row.name.includes("权益")) return `${fmtMoney(value)}U`;
  if (row.name.includes("盈利因子")) return fmtNum(value, 2);
  return fmtPct(value);
}

function renderReadiness(result) {
  if (result.base_result) renderPortfolio(result.base_result);
  if (result.robustness) renderRobustness(result.robustness);
  if (result.monte_carlo) renderMonteCarlo(result.monte_carlo);
  if (result.signal_scan) renderSignalScan(result.signal_scan);

  const decision = result.decision || "-";
  const decisionEl = $("readinessDecision");
  decisionEl.textContent = decision;
  decisionEl.className = decision.includes("暂停") ? "pnl-negative" : "pnl-positive";
  $("readinessScore").textContent = `${result.score ?? "-"}/100`;
  $("readinessRisk").textContent = result.risk_level || "-";
  const signal = result.signal_state || {};
  $("readinessSignal").textContent = `可${signal.ready ?? 0} / 等${signal.watch ?? 0} / 过滤${signal.blocked ?? 0}`;
  $("readinessMonthly").textContent = fmtPct(result.monthly_return);
  $("readinessRolling").textContent = fmtPct(result.rolling_ratio);
  $("readinessLossProb").textContent = fmtPct(result.monte_carlo?.summary?.loss_probability);
  $("readinessAction").textContent = result.next_action || "-";
  $("readinessRows").innerHTML = (result.checks || [])
    .map((row) => {
      const statusClass = row.status === "pass" ? "pnl-positive" : row.status === "warn" ? "warn-text" : "pnl-negative";
      const statusText = row.status === "pass" ? "通过" : row.status === "warn" ? "观察" : "失败";
      return `<tr>
        <td>${row.name}</td>
        <td>${readinessValue(row)}</td>
        <td>${row.threshold}</td>
        <td>${row.weight}</td>
        <td class="${statusClass}">${statusText}</td>
        <td class="reason-cell">${row.action}</td>
      </tr>`;
    })
    .join("");
  $("status").textContent = `模拟准入完成：${decision}，评分 ${result.score ?? "-"}/100`;
}

function renderBenchmarks(result) {
  const summary = result.summary || {};
  $("benchmarkVerdict").textContent = summary.verdict || "-";
  $("benchmarkMarket").textContent = fmtPct(summary.market_return);
  $("benchmarkBest").textContent = summary.best_name ? `${summary.best_name} ${fmtPct(summary.best_return)}` : "-";
  $("benchmarkRank").textContent = summary.current_rank ? `${summary.current_rank}/${Math.max((summary.cases || 1) - 1, 1)}` : "-";
  $("benchmarkRows").innerHTML = (result.rows || [])
    .map((row) => {
      const s = row.summary || {};
      const statusClass =
        row.status === "错误" || row.status === "弱于市场"
          ? "pnl-negative"
          : row.status === "基准"
            ? "warn-text"
            : "pnl-positive";
      return `<tr>
        <td>${row.name}</td>
        <td>${row.source || "-"}</td>
        <td>${s.final_equity === undefined ? "-" : fmtMoney(s.final_equity)}</td>
        <td class="${(s.return_pct || 0) >= 0 ? "pnl-positive" : "pnl-negative"}">${s.return_pct === undefined ? "-" : fmtPct(s.return_pct)}</td>
        <td class="${(row.monthly_return || 0) >= 0 ? "pnl-positive" : "pnl-negative"}">${row.monthly_return === null || row.monthly_return === undefined ? "-" : fmtPct(row.monthly_return)}</td>
        <td class="${(row.edge_vs_market || 0) >= 0 ? "pnl-positive" : "pnl-negative"}">${row.edge_vs_market === null || row.edge_vs_market === undefined ? "-" : fmtPct(row.edge_vs_market)}</td>
        <td>${s.max_drawdown === undefined ? "-" : fmtPct(s.max_drawdown)}</td>
        <td>${s.trades ?? "-"}</td>
        <td>${s.profit_factor === null || s.profit_factor === undefined ? "-" : Number(s.profit_factor).toFixed(2)}</td>
        <td class="${statusClass}">${row.status || "-"}</td>
        <td class="reason-cell">${row.error || row.note || "-"}</td>
      </tr>`;
    })
    .join("");
  $("status").textContent = `基准对照完成：${summary.verdict || "-"}，市场 ${fmtPct(summary.market_return)}`;
}

function renderSignalLog(result) {
  const summary = result.summary || {};
  $("logEntries").textContent = summary.entries ?? "-";
  $("logReady").textContent = summary.ready ?? "-";
  $("logBlocked").textContent = summary.blocked ?? "-";
  $("signalLogRows").innerHTML = (result.days || [])
    .map((row) => `<tr>
      <td>${row.day}</td>
      <td>${row.scans}</td>
      <td>${row.markets}</td>
      <td class="${row.ready > 0 ? "pnl-positive" : ""}">${row.ready}</td>
      <td>${row.watch}</td>
      <td>${row.blocked}</td>
      <td class="${row.errors > 0 ? "pnl-negative" : ""}">${row.errors}</td>
      <td class="reason-cell">${(row.ready_markets || []).join(" / ") || "-"}</td>
    </tr>`)
    .join("");
}

function renderTelegramReport(result) {
  const summary = result.summary || {};
  $("tgSignals").textContent = result.signals ?? "-";
  $("tgSides").textContent = `${summary.longs ?? 0}/${summary.shorts ?? 0}`;
  $("tgAvgR").textContent = fmtNum(summary.avg_tp1_rr, 2);
  $("telegramRows").innerHTML = (result.signals_rows || [])
    .map((row) => {
      const style = [row.uses_market ? "市价" : "", row.uses_scale_in ? "分批/补仓" : ""].filter(Boolean).join(" + ") || "-";
      return `<tr>
        <td>${row.symbol || "-"}</td>
        <td>${row.side || "-"}</td>
        <td>${row.entry === null || row.entry === undefined ? "-" : fmtNum(row.entry, 6)}</td>
        <td>${row.stop === null || row.stop === undefined ? "-" : fmtNum(row.stop, 6)}</td>
        <td>${(row.take_profits || []).map((value) => fmtNum(value, 6)).join(" / ") || "-"}</td>
        <td>${fmtPct(row.stop_pct)}</td>
        <td>${row.rr_values?.length ? fmtNum(row.rr_values[0], 2) : "-"}</td>
        <td>${style}</td>
        <td class="reason-cell">${row.snippet || "-"}</td>
      </tr>`;
    })
    .join("");
}

async function runBacktest() {
  $("status").textContent = "回测中...";
  try {
    const result = await postJson("/api/backtest", settings());
    const s = result.summary;
    $("finalEquity").textContent = fmtMoney(s.final_equity);
    $("returnPct").textContent = fmtPct(s.return_pct);
    $("drawdown").textContent = fmtPct(s.max_drawdown);
    $("winRate").textContent = fmtPct(s.win_rate);
    $("tradeCount").textContent = s.trades;
    $("profitFactor").textContent = s.profit_factor === null ? "-" : Number(s.profit_factor).toFixed(2);
    $("expectancy").textContent = fmtMoney(s.expectancy);
    $("maxLossStreak").textContent = s.max_consecutive_losses;
    $("candleCount").textContent = s.candles_in_window;
    lastBacktest = { candles: result.candles, trades: result.trades };
    selectedTradeIndex = result.trades.length ? result.trades.length - 1 : null;
    const selectedTrade = selectedTradeIndex === null ? null : result.trades[selectedTradeIndex];
    drawPriceChart(result.candles, result.trades, selectedTrade);
    drawEquity(result.equity_curve);
    renderTrades(result.trades);
    renderTradeReview(selectedTrade);
    renderAttribution(result.trades);
    $("status").textContent = "回测完成";
  } catch (error) {
    $("status").textContent = error.message;
  }
}

async function runSignalScan() {
  $("status").textContent = "信号扫描中...";
  try {
    const result = await postJson("/api/signal-scan", {
      ...settings(),
      symbols: ["BTC-USDT-SWAP", "ETH-USDT-SWAP", "SOL-USDT-SWAP"],
      prefer_cache: false,
      offline_mode: false,
    });
    renderSignalScan(result);
    await refreshSignalLog(false);
    $("status").textContent = "信号扫描完成";
  } catch (error) {
    $("status").textContent = error.message;
  }
}

async function refreshSignalLog(updateStatus = true) {
  if (updateStatus) $("status").textContent = "刷新日志中...";
  try {
    const response = await fetch("/api/signal-log?limit=300");
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "刷新日志失败");
    renderSignalLog(result);
    if (updateStatus) $("status").textContent = "日志已刷新";
  } catch (error) {
    $("status").textContent = error.message;
  }
}

async function analyzeTelegram() {
  $("status").textContent = "学习频道中...";
  try {
    const result = await postJson("/api/telegram/analyze", { channel: "colin112" });
    renderTelegramReport(result);
    const avgStop = fmtPct(result.summary?.avg_stop_pct);
    $("status").textContent = `频道学习完成：${result.signals} 条信号，均值止损 ${avgStop}`;
  } catch (error) {
    $("status").textContent = error.message;
  }
}

async function runPortfolio() {
  $("status").textContent = "组合回测中...";
  try {
    const result = await postJson("/api/portfolio-backtest", {
      ...settings(),
      symbols: ["BTC-USDT-SWAP", "ETH-USDT-SWAP", "SOL-USDT-SWAP"],
    });
    renderPortfolio(result);
    $("status").textContent = "组合回测完成";
  } catch (error) {
    $("status").textContent = error.message;
  }
}

async function runPortfolioSlices() {
  $("status").textContent = "组合切片验证中...";
  try {
    const current = settings();
    const result = await postJson("/api/portfolio-slices", {
      ...current,
      symbols: ["BTC-USDT-SWAP", "ETH-USDT-SWAP", "SOL-USDT-SWAP"],
      slice_hours: Math.min(720, current.history_hours),
    });
    renderPortfolioSlices(result);
  } catch (error) {
    $("status").textContent = error.message;
  }
}

async function runRobustness() {
  $("status").textContent = "稳健性测试中...";
  try {
    const current = settings();
    const result = await postJson("/api/robustness", {
      ...current,
      symbols: ["BTC-USDT-SWAP", "ETH-USDT-SWAP", "SOL-USDT-SWAP"],
      robust_window_hours: Math.min(720, current.history_hours),
      robust_step_hours: 168,
    });
    renderRobustness(result);
  } catch (error) {
    $("status").textContent = error.message;
  }
}

async function runMonteCarlo() {
  $("status").textContent = "蒙特卡洛测试中...";
  try {
    const current = settings();
    const result = await postJson("/api/monte-carlo", {
      ...current,
      symbols: ["BTC-USDT-SWAP", "ETH-USDT-SWAP", "SOL-USDT-SWAP"],
      monte_carlo_iterations: 2000,
      monte_carlo_floor_equity: Number($("initialEquity").value) * 0.5,
    });
    renderMonteCarlo(result);
  } catch (error) {
    $("status").textContent = error.message;
  }
}

function readinessPayload(current) {
  return {
    ...current,
    symbols: ["BTC-USDT-SWAP", "ETH-USDT-SWAP", "SOL-USDT-SWAP"],
    robust_window_hours: Math.min(720, current.history_hours),
    robust_step_hours: 168,
    monte_carlo_iterations: 2000,
    monte_carlo_floor_equity: Number($("initialEquity").value) * 0.5,
    monte_carlo_max_loss_probability: 0.02,
    monte_carlo_max_p95_drawdown: 0.25,
    target_monthly_return: 0.20,
    readiness_min_rolling_ratio: 0.65,
    prefer_cache: false,
    offline_mode: false,
  };
}

async function evaluateReadiness() {
  const result = await postJson("/api/readiness", readinessPayload(settings()));
  renderReadiness(result);
  return result;
}

async function runReadiness() {
  $("status").textContent = "模拟准入评估中...";
  try {
    await evaluateReadiness();
  } catch (error) {
    $("status").textContent = error.message;
  }
}

async function runBenchmarks() {
  $("status").textContent = "基准对照运行中...";
  try {
    const current = settings();
    const result = await postJson("/api/benchmarks", {
      ...current,
      symbols: ["BTC-USDT-SWAP", "ETH-USDT-SWAP", "SOL-USDT-SWAP"],
    });
    renderBenchmarks(result);
  } catch (error) {
    $("status").textContent = error.message;
  }
}

async function runAttribution() {
  $("status").textContent = "模块归因运行中...";
  try {
    const current = settings();
    const result = await postJson("/api/attribution", {
      ...current,
      symbols: ["BTC-USDT-SWAP", "ETH-USDT-SWAP", "SOL-USDT-SWAP"],
    });
    renderAttributionReport(result);
  } catch (error) {
    $("status").textContent = error.message;
  }
}

async function runAttributionExperiments() {
  $("status").textContent = "归因实验运行中...";
  try {
    const current = settings();
    const result = await postJson("/api/attribution-experiments", {
      ...current,
      symbols: ["BTC-USDT-SWAP", "ETH-USDT-SWAP", "SOL-USDT-SWAP"],
    });
    renderAttributionExperiments(result);
  } catch (error) {
    $("status").textContent = error.message;
  }
}

async function saveResearchSnapshot() {
  $("status").textContent = "研究快照保存中...";
  try {
    const current = settings();
    const result = await postJson("/api/research-snapshot", {
      ...current,
      symbols: ["BTC-USDT-SWAP", "ETH-USDT-SWAP", "SOL-USDT-SWAP"],
      snapshot_label: `target-${new Date().toISOString().slice(0, 10)}`,
    });
    renderSavedSnapshot(result);
    await refreshResearchSnapshots();
  } catch (error) {
    $("status").textContent = error.message;
  }
}

async function runValidate() {
  $("status").textContent = "多市场验证中...";
  try {
    const current = settings();
    const windows = [current.history_hours];
    const result = await postJson("/api/validate", {
      ...current,
      symbols: ["BTC-USDT-SWAP", "ETH-USDT-SWAP", "SOL-USDT-SWAP"],
      windows,
    });
    renderValidation(result);
    $("status").textContent = "多市场验证完成";
  } catch (error) {
    $("status").textContent = error.message;
  }
}

async function runSliceValidate() {
  $("status").textContent = "时间切片验证中...";
  try {
    const current = settings();
    const result = await postJson("/api/slice-validate", {
      ...current,
      symbols: ["BTC-USDT-SWAP", "ETH-USDT-SWAP", "SOL-USDT-SWAP"],
      slice_hours: Math.min(720, current.history_hours),
    });
    renderSliceValidation(result);
  } catch (error) {
    $("status").textContent = error.message;
  }
}

async function runOptimize() {
  $("status").textContent = "扫描参数中...";
  try {
    const result = await postJson("/api/optimize", settings());
    renderOptimization(result.top);
    if (result.best.summary.trades >= 5) {
      applyBestParams(result.best);
      $("status").textContent = "扫描完成，已应用第一名参数";
      await runBacktest();
    } else {
      $("status").textContent = "扫描完成，但样本少于 5 笔，未自动应用";
    }
  } catch (error) {
    $("status").textContent = error.message;
  }
}

async function warmupData() {
  $("status").textContent = "预热数据中...";
  try {
    const historyHours = settings().history_hours;
    const windows = Array.from(new Set([historyHours, 168].filter((value) => value > 0)));
    const result = await postJson("/api/data/warmup", {
      ...settings(),
      prefer_cache: false,
      offline_mode: false,
      symbols: ["BTC-USDT-SWAP", "ETH-USDT-SWAP", "SOL-USDT-SWAP"],
      windows,
    });
    const detail = result.failed > 0 ? `，失败 ${result.failed} 组` : "";
    $("status").textContent = `预热完成 ${result.ok} 组${detail}`;
  } catch (error) {
    $("status").textContent = error.message;
  }
}

async function refreshPaper() {
  try {
    const response = await fetch("/api/paper/status");
    const state = await response.json();
    $("paperStateFile").textContent = state.state_file || "-";
    const breaker = state.circuit_breaker || {};
    const breakerReasons = (breaker.reasons || []).join("；") || "-";
    const latestScan = state.signal_log?.[0] || {};
    const latestData = latestScan.data?.price || {};
    $("paperState").innerHTML = `
      <dt>状态</dt><dd>${state.running ? "运行中" : "已停止"}</dd>
      <dt>交易对</dt><dd>${state.inst_id}</dd>
      <dt>周期</dt><dd>${state.bar}</dd>
      <dt>策略</dt><dd>${state.strategy_mode}</dd>
      <dt>数据来源</dt><dd class="${latestData.is_stale ? "pnl-negative" : "pnl-positive"}">${dataSourceLabel(latestData.source)}</dd>
      <dt>最新K线</dt><dd>${shortDateTime(latestData.latest_closed)}</dd>
      <dt>权益</dt><dd>${fmtMoney(state.equity)}</dd>
      <dt>峰值权益</dt><dd>${fmtMoney(state.peak_equity)}</dd>
      <dt>当日起始</dt><dd>${fmtMoney(state.day_start_equity)}</dd>
      <dt>今日开仓</dt><dd>${state.day_trades ?? 0}/${state.params?.max_daily_trades ?? "-"}</dd>
      <dt>连亏</dt><dd>${state.consecutive_losses ?? 0}</dd>
      <dt>开仓权限</dt><dd class="${breaker.allow_trade === false ? "pnl-negative" : "pnl-positive"}">${breaker.allow_trade === false ? "暂停" : "允许"}</dd>
      <dt>熔断原因</dt><dd>${breakerReasons}</dd>
      <dt>杠杆</dt><dd>${state.params?.leverage ? `${state.params.leverage}x` : "-"}</dd>
      <dt>仓位</dt><dd>${state.position ? `${state.position.side} ${fmtMoney(state.position.entry)} / ${fmtMoney(state.position.notional)}U` : "无"}</dd>
      <dt>爆仓价</dt><dd>${state.position ? fmtMoney(state.position.liquidation_price) : "-"}</dd>
      <dt>最近信号</dt><dd>${state.last_signal ? `${state.last_signal.side} ${state.last_signal.kind}` : "无"}</dd>
      <dt>信号检查</dt><dd>${latestScan.inst_id ? `${latestScan.inst_id} ${latestScan.decision}` : "-"}</dd>
      <dt>过滤原因</dt><dd>${latestScan.inst_id ? (latestScan.reasons || []).join("；") : "-"}</dd>
      <dt>更新时间</dt><dd>${state.updated_at ? new Date(state.updated_at).toLocaleString() : "-"}</dd>
      <dt>持久化</dt><dd>${state.persisted_at ? new Date(state.persisted_at).toLocaleString() : "-"}</dd>
      <dt>错误</dt><dd>${state.last_error || "-"}</dd>
    `;
    await refreshPaperEvents();
    await refreshPaperAudit(false);
  } catch (error) {
    $("paperState").innerHTML = `<dt>错误</dt><dd>${error.message}</dd>`;
  }
}

async function refreshPaperEvents() {
  const response = await fetch("/api/paper/events?limit=20");
  const result = await response.json();
  $("paperEventFile").textContent = result.path || "-";
  $("paperEventRows").innerHTML = (result.rows || [])
    .map((row) => {
      const payload = row.payload || {};
      const pnl = payload.pnl === undefined ? fmtMoney(payload.equity) : `${fmtMoney(payload.equity)} / ${fmtMoney(payload.pnl)}`;
      return `<tr>
        <td>${row.time ? new Date(row.time).toLocaleString() : "-"}</td>
        <td>${row.event}</td>
        <td>${payload.inst_id || "-"}</td>
        <td>${payload.side || "-"}</td>
        <td>${payload.kind || "-"}</td>
        <td class="${Number(payload.pnl || 0) < 0 ? "pnl-negative" : "pnl-positive"}">${pnl}</td>
        <td class="reason-cell">${payload.exit_reason || payload.error || payload.strategy_mode || "-"}</td>
      </tr>`;
    })
    .join("") || `<tr><td colspan="7">暂无事件</td></tr>`;
}

function auditStatusLabel(status) {
  const labels = {
    pass: "一致",
    fail: "不一致",
    skipped: "待复核",
    error: "错误",
  };
  return labels[status] || "-";
}

function renderPaperAudit(result, reconciled = false) {
  $("paperAuditFile").textContent = result.path || "-";
  const summary = result.summary || {};
  $("paperReconcileSummary").textContent = reconciled
    ? `信号一致 ${summary.pass || 0} / 动作一致 ${summary.action_pass || 0} / 动作异常 ${summary.action_fail || 0}`
    : "未运行";
  const rows = result.rows || [];
  $("paperAuditRows").innerHTML = rows
    .map((row) => {
      const scan = row.scan || {};
      const signature = row.recorded || row.scan_signature || scan.signature || {};
      const data = row.data || scan.data?.price || {};
      const status = row.status || "";
      const actionCheck = row.action_check || {};
      const statusClass =
        status === "fail" || status === "error" || actionCheck.status === "fail"
          ? "pnl-negative"
          : status === "pass" && ["pass", "skipped", undefined].includes(actionCheck.status)
            ? "pnl-positive"
            : "";
      const signalDiffs = (row.diffs || []).slice(0, 3).map((diff) => diff.field).join("、");
      const actionDiffs = (actionCheck.diffs || []).slice(0, 3).map((diff) => diff.field).join("、");
      const reasonParts = [row.reason, signalDiffs && `信号差异 ${signalDiffs}`, actionCheck.reason, actionDiffs && `动作差异 ${actionDiffs}`].filter(Boolean);
      return `<tr>
        <td>${row.time ? new Date(row.time).toLocaleString() : "-"}</td>
        <td>${shortDateTime(row.recorded_time || row.candle_time || signature.context_time)}</td>
        <td>${row.inst_id || scan.inst_id || "-"}</td>
        <td class="${data.is_stale ? "pnl-negative" : "pnl-positive"}">${dataSourceLabel(data.source)}</td>
        <td>${row.action || "-"}</td>
        <td>${signature.decision || scan.decision || "-"}</td>
        <td class="${statusClass}">${reconciled ? `${auditStatusLabel(status)} / ${auditStatusLabel(actionCheck.status)}` : "-"}</td>
        <td class="reason-cell">${reasonParts.join("；") || (scan.reasons || []).join("；") || "-"}</td>
      </tr>`;
    })
    .join("") || `<tr><td colspan="8">暂无审计记录</td></tr>`;
}

async function refreshPaperAudit(reconciled = false) {
  const response = await fetch("/api/paper/audit?limit=20");
  const result = await response.json();
  renderPaperAudit(result, reconciled);
}

async function runPaperReconcile() {
  try {
    $("status").textContent = "正在对账纸交易记录...";
    const response = await fetch("/api/paper/reconcile?limit=20");
    const result = await response.json();
    renderPaperAudit(result, true);
    const summary = result.summary || {};
    $("status").textContent = `模拟对账完成：信号一致 ${summary.pass || 0}，动作一致 ${summary.action_pass || 0}，动作异常 ${summary.action_fail || 0}`;
  } catch (error) {
    $("status").textContent = error.message;
  }
}

function setActiveView(view) {
  document.querySelectorAll(".view-tab").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.viewTarget === view);
  });
  document.querySelectorAll("[data-view]").forEach((node) => {
    const views = (node.dataset.view || "").split(/\s+/);
    node.hidden = !views.includes(view);
  });
  document.querySelectorAll(".research-grid").forEach((grid) => {
    const visiblePanels = [...grid.children].filter((child) => !child.hidden);
    grid.hidden = visiblePanels.length === 0;
  });
  localStorage.setItem("okxWorkspaceView", view);
}

function initWorkspaceViews() {
  document.querySelectorAll(".view-tab").forEach((button) => {
    button.addEventListener("click", () => setActiveView(button.dataset.viewTarget));
  });
  const saved = localStorage.getItem("okxWorkspaceView");
  const initial = document.querySelector(`.view-tab[data-view-target="${saved}"]`) ? saved : "overview";
  setActiveView(initial);
}

$("runBacktest").addEventListener("click", runBacktest);
$("runOptimize").addEventListener("click", runOptimize);
$("runJointOptimize").addEventListener("click", runJointOptimize);
$("runValidate").addEventListener("click", runValidate);
$("runSliceValidate").addEventListener("click", runSliceValidate);
$("runPortfolio").addEventListener("click", runPortfolio);
$("runPortfolioSlices").addEventListener("click", runPortfolioSlices);
$("runRobustness").addEventListener("click", runRobustness);
$("runMonteCarlo").addEventListener("click", runMonteCarlo);
$("runReadiness").addEventListener("click", runReadiness);
$("runBenchmarks").addEventListener("click", runBenchmarks);
$("runAttribution").addEventListener("click", runAttribution);
$("runAttributionExperiments").addEventListener("click", runAttributionExperiments);
$("saveResearchSnapshot").addEventListener("click", saveResearchSnapshot);
$("warmupData").addEventListener("click", warmupData);
$("applyDailyMode").addEventListener("click", applyDailyMode);
$("applyTargetMode").addEventListener("click", applyTargetMode);
$("runValidateSide").addEventListener("click", runValidate);
$("runSliceValidateSide").addEventListener("click", runSliceValidate);
$("runPortfolioSide").addEventListener("click", runPortfolio);
$("runPortfolioSlicesSide").addEventListener("click", runPortfolioSlices);
$("runRobustnessSide").addEventListener("click", runRobustness);
$("runMonteCarloSide").addEventListener("click", runMonteCarlo);
$("runReadinessSide").addEventListener("click", runReadiness);
$("runBenchmarksSide").addEventListener("click", runBenchmarks);
$("runAttributionSide").addEventListener("click", runAttribution);
$("runAttributionExperimentsSide").addEventListener("click", runAttributionExperiments);
$("saveResearchSnapshotSide").addEventListener("click", saveResearchSnapshot);
$("runSignalScan").addEventListener("click", runSignalScan);
$("refreshSignalLog").addEventListener("click", () => refreshSignalLog(true));
$("analyzeTelegram").addEventListener("click", analyzeTelegram);
$("runJointOptimizeSide").addEventListener("click", runJointOptimize);
$("historyPreset").addEventListener("change", syncHistoryPreset);
$("trades").addEventListener("click", (event) => {
  const row = event.target.closest(".trade-row");
  if (!row) return;
  selectTrade(Number(row.dataset.tradeIndex));
});
$("startPaper").addEventListener("click", async () => {
  try {
    $("status").textContent = "启动前准入评估中...";
    const gate = await evaluateReadiness();
    if ((gate.decision || "").includes("暂停")) {
      $("status").textContent = `准入未通过，未启动模拟：${gate.next_action || "请先处理失败项"}`;
      return;
    }
    await postJson("/api/paper/start", { ...settings(), prefer_cache: false, offline_mode: false });
    await refreshPaper();
    $("status").textContent = `模拟已启动：${gate.decision}`;
  } catch (error) {
    $("status").textContent = error.message;
  }
});
$("stopPaper").addEventListener("click", async () => {
  await postJson("/api/paper/stop");
  await refreshPaper();
});
$("runPaperReconcile").addEventListener("click", runPaperReconcile);

initWorkspaceViews();
refreshPaper();
refreshSignalLog(false);
refreshResearchSnapshots().catch(() => {});
setInterval(refreshPaper, 5000);
