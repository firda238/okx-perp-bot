const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8765";

export const targetStrategyParams = {
  symbols: ["BTC-USDT-SWAP", "ETH-USDT-SWAP", "SOL-USDT-SWAP"],
  instId: "BTC-USDT-SWAP",
  bar: "15m",
  trend_bar: "1H",
  history_hours: 2160,
  window_end_ts: 1778839200000,
  initial_equity: 10,
  min_live_equity_usd: 10,
  live_margin_buffer_mult: 1.2,
  risk_pct: 0.10,
  max_loss_pct_per_trade: 0.10,
  leverage: 75,
  min_leverage: 5,
  adaptive_leverage: true,
  adaptive_trade_management: true,
  adaptive_risk: true,
  loss_streak_risk_decay: 0.30,
  drawdown_risk_sensitivity: 3.2,
  min_adaptive_risk_factor: 0.22,
  absolute_min_risk_factor: 0.08,
  max_margin_pct: 0.7,
  margin_pct_per_trade: 0.7,
  max_leverage: 75,
  maintenance_margin_rate: 0.005,
  min_liq_buffer_pct: 0.003,
  strategy_mode: "louie_price_action",
  lookback: 8,
  atr_period: 14,
  atr_stop_mult: 1.9,
  take_profit_rr: 3.0,
  min_body_ratio: 0.45,
  min_adx: 18,
  min_breakout_atr: 0.15,
  min_sweep_atr: 0.15,
  use_regime_filter: true,
  require_next_confirmation: false,
  prefer_cache: true,
  offline_mode: true,
  enable_risk_circuit_breaker: true,
  max_daily_loss_pct: 0.12,
  max_loss_streak_stop: 4,
  max_account_drawdown_pct: 0.30,
  max_atr_pct: 0.012,
  max_strategy_drawdown: 0.35,
  cooldown_bars: 4,
  time_exit_bars: 0,
  time_exit_min_rr: 0.25,
  loss_streak_pause_bars: 0,
  max_daily_trades: 1,
  min_signal_score: 0.55,
  second_trade_allowed_kinds: null,
  second_trade_side: "any",
  cost_model: "okx_aggressive",
  fee_rate: 0.0005,
  maker_fee_rate: 0.0002,
  taker_fee_rate: 0.0005,
  entry_order_type: "taker",
  take_profit_order_type: "maker",
  stop_order_type: "taker",
  slippage_pct: 0.0002,
  use_multi_take_profit: false,
  tp1_share_pct: 0.4,
  tp2_share_pct: 0.3,
  move_stop_to_breakeven_after_tp1: true,
  trend_adx: 24,
  range_adx: 18,
  max_risk_atr: 3,
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
  breakout_risk_factor: 0.35,
  enable_breakout_guard: true,
  breakout_guard_window: 8,
  breakout_guard_min_samples: 4,
  breakout_guard_max_loss_rate: 0.65,
  breakout_guard_risk_multiplier: 0.70,
  block_eth_longs: true,
  block_delayed_sweep_in_chaos: false,
  block_long_in_chaos: false,
  block_breakout_against_trend: true,
  short_trend_risk_factor: 0.70,
  limit: 300,
};

export const defaultStrategyParams = targetStrategyParams;

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `Request failed: ${response.status}`);
  }
  return payload;
}

function compactReadiness(readiness) {
  if (!readiness) return null;
  return {
    decision: readiness.decision,
    score: readiness.score,
    risk_level: readiness.risk_level,
    next_action: readiness.next_action,
    monthly_return: readiness.monthly_return,
    rolling_ratio: readiness.rolling_ratio,
    signal_state: readiness.signal_state,
    checks: readiness.checks,
    monte_carlo: { summary: readiness.monte_carlo?.summary },
    robustness: { aggregate: readiness.robustness?.aggregate },
  };
}

export function getPaperStatus() {
  return request("/api/paper/status");
}

export function getPaperAudit(limit = 40) {
  const query = new URLSearchParams({ limit: String(limit) });
  return request(`/api/paper/audit?${query.toString()}`);
}

export function getDataStatus() {
  return request("/api/data/status");
}

export function getSystemStatus() {
  return request("/api/system/status");
}

export function getDataRefreshProgress() {
  return request("/api/data/refresh-progress");
}

export function compactDataCache(dryRun = true, maxItems = null) {
  return request("/api/data/compact-cache", {
    method: "POST",
    body: JSON.stringify({ dry_run: dryRun, ...(maxItems ? { max_items: maxItems } : {}) }),
  });
}

export function enqueueTask(type, params = {}) {
  return request("/api/tasks", {
    method: "POST",
    body: JSON.stringify({ type, params }),
  });
}

export function getTasks(limit = 20) {
  return request(`/api/tasks?${new URLSearchParams({ limit: String(limit) }).toString()}`);
}

export function getTask(id) {
  return request(`/api/task?${new URLSearchParams({ id }).toString()}`);
}

export function cancelTask(id) {
  return request("/api/task/cancel", {
    method: "POST",
    body: JSON.stringify({ id }),
  });
}

export function clearTasks(statuses = ["completed", "failed", "cancelled"]) {
  return request("/api/tasks/clear", {
    method: "POST",
    body: JSON.stringify({ statuses }),
  });
}

export function refreshDataCache(row, maxItems = 1) {
  return request("/api/data/refresh", {
    method: "POST",
    body: JSON.stringify({ ...row, max_items: maxItems }),
  });
}

export function refreshStaleDataCache(maxItems = 4, recommendedOnly = false) {
  return request("/api/data/refresh-stale", {
    method: "POST",
    body: JSON.stringify({ max_items: maxItems, recommended_only: recommendedOnly }),
  });
}

export function getCandles(instId = defaultStrategyParams.instId, bar = defaultStrategyParams.bar, limit = 180) {
  const query = new URLSearchParams({ instId, bar, limit: String(limit) });
  return request(`/api/candles?${query.toString()}`);
}

export async function getLatestResearchSnapshot() {
  const list = await request("/api/research-snapshots?limit=20");
  const row = list.rows?.find((item) => item.mode === "full") || list.rows?.[0];
  const file = row?.file;
  if (!file) return null;
  const snapshot = await getResearchSnapshot(file);
  return { ...snapshot, file, path: row?.path };
}

export function getResearchSnapshot(file) {
  const query = new URLSearchParams({ file });
  return request(`/api/research-snapshot?${query.toString()}`);
}

export function getResearchSnapshots(limit = 12) {
  const query = new URLSearchParams({ limit: String(limit) });
  return request(`/api/research-snapshots?${query.toString()}`);
}

export function runPortfolioBacktest(params = defaultStrategyParams) {
  return request("/api/portfolio-backtest", {
    method: "POST",
    body: JSON.stringify(params),
  });
}

export function runJointOptimize(params = defaultStrategyParams) {
  return request("/api/joint-optimize", {
    method: "POST",
    body: JSON.stringify({ ...params, windows: params.windows || [168] }),
  });
}

export function runAttributionExperiments(params = defaultStrategyParams) {
  return request("/api/attribution-experiments", {
    method: "POST",
    body: JSON.stringify(params),
  });
}

export function runReadiness(params = defaultStrategyParams) {
  const initialEquity = Number(params.initial_equity || defaultStrategyParams.initial_equity || 10);
  const historyHours = Number(params.history_hours || defaultStrategyParams.history_hours || 2160);
  return request("/api/readiness", {
    method: "POST",
    body: JSON.stringify({
      ...params,
      robust_window_hours: Math.min(720, historyHours),
      robust_step_hours: 168,
      monte_carlo_iterations: 1000,
      monte_carlo_floor_equity: initialEquity * 0.5,
      monte_carlo_max_loss_probability: 0.02,
      monte_carlo_max_p95_drawdown: 0.25,
      target_monthly_return: 0.20,
      readiness_min_rolling_ratio: 0.65,
    }),
  });
}

export function runSignalScan(params = defaultStrategyParams) {
  return request("/api/signal-scan", {
    method: "POST",
    body: JSON.stringify({ ...params, record_scan: true }),
  });
}

export function getTradeWindowCandles(params = {}) {
  return request("/api/trade-window-candles", {
    method: "POST",
    body: JSON.stringify(params),
  });
}

export function runExecutionDryRun(params = defaultStrategyParams) {
  return request("/api/execution/dry-run", {
    method: "POST",
    body: JSON.stringify(params),
  });
}

export function getExecutionConfig() {
  return request("/api/execution/config");
}

export function getExecutionOrders(limit = 40) {
  const query = new URLSearchParams({ limit: String(limit) });
  return request(`/api/execution/orders?${query.toString()}`);
}

export function getExecutionEnvironment() {
  return request("/api/execution/environment");
}

export function getOkxAccount() {
  return request("/api/okx/account");
}

export function getOkxDiagnostics() {
  return request("/api/okx/diagnostics");
}

export function setOkxSessionCredentials(payload) {
  return request("/api/okx/session-credentials", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function getOkxPositions(params = {}) {
  const query = new URLSearchParams(params);
  const suffix = query.toString() ? `?${query.toString()}` : "";
  return request(`/api/okx/positions${suffix}`);
}

export function submitLiveOrder(payload = {}) {
  return request("/api/execution/live-submit", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function saveResearchSnapshot(params = defaultStrategyParams) {
  return request("/api/research-snapshot", {
    method: "POST",
    body: JSON.stringify(params),
  });
}

export function startPaper(params = defaultStrategyParams, readiness = null) {
  return request("/api/paper/start", {
    method: "POST",
    body: JSON.stringify({ ...params, ...(readiness ? { startup_readiness: compactReadiness(readiness) } : {}) }),
  });
}

export function stopPaper() {
  return request("/api/paper/stop", { method: "POST" });
}
