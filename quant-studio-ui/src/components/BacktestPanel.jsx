import { Activity, CalendarDays, Gauge, History, LineChart, ListOrdered, RotateCw, ScanSearch, ShieldAlert, Wallet } from "lucide-react";
import { useState } from "react";
import EquityCurve from "./EquityCurve";
import GlassCard from "./GlassCard";
import MetricCard from "./MetricCard";
import RecentTradesTable, { tradeKey } from "./RecentTradesTable";
import StrategyAuditPanel from "./StrategyAuditPanel";

const tabs = ["概览", "表现", "交易分析", "风险指标", "日志"];

function pct(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "-";
  return `${(Number(value) * 100).toFixed(2)}%`;
}

function money(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "-";
  return Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function price(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "-";
  return Number(value).toLocaleString(undefined, { maximumFractionDigits: 4 });
}

function tradeTime(value) {
  return value ? String(value).replace("T", " ").slice(0, 16) : "-";
}

function tradeRMultiple(trade = {}) {
  const entry = Number(trade.entry);
  const stop = Number(trade.stop);
  const exit = Number(trade.exit_price ?? trade.exit);
  const risk = Math.abs(entry - stop);
  if (!Number.isFinite(entry) || !Number.isFinite(stop) || !Number.isFinite(exit) || risk <= 0) return null;
  const direction = trade.side === "short" ? -1 : 1;
  return ((exit - entry) * direction) / risk;
}

function exitReasonLabel(reason) {
  const labels = {
    take_profit: "止盈",
    take_profit_all: "全部止盈",
    stop: "止损",
    time_exit: "时间止损",
    liquidation: "强平",
  };
  return labels[reason] || reason || "-";
}

function tradeReplayNote(trade = {}) {
  if (!trade?.entry) return "选择一笔交易后显示入场、退出、成本和 R 倍数。";
  const pnl = Number(trade.pnl || 0);
  const r = tradeRMultiple(trade);
  const direction = trade.side === "short" ? "空头" : "多头";
  const result = pnl >= 0 ? "盈利" : "亏损";
  const cost = Number(trade.fees || 0) + Number(trade.slippage || 0);
  return `${direction}交易${result} ${money(pnl)}U，退出原因 ${exitReasonLabel(trade.exit_reason)}，${r === null ? "R倍数不可计算" : `约 ${r.toFixed(2)}R`}，成本 ${money(cost)}U。`;
}

function tradeEvidenceTone(status = "") {
  if (status === "pass") return "is-good";
  if (status === "watch") return "is-info";
  if (status === "warn") return "is-warn";
  return "is-bad";
}

function tradeEvidenceLabel(status = "") {
  if (status === "pass") return "通过";
  if (status === "watch") return "观察";
  if (status === "warn") return "注意";
  return "风险";
}

function tradeEvidenceRows(trade = {}) {
  const entry = Number(trade.entry);
  const stop = Number(trade.stop);
  const exit = Number(trade.exit_price ?? trade.exit);
  const takeProfit = Number(trade.take_profit);
  const liquidation = Number(trade.liquidation_price);
  const leverage = Number(trade.leverage);
  const notional = Number(trade.notional);
  const margin = Number(trade.margin_used);
  const fees = Number(trade.fees || 0);
  const slippage = Number(trade.slippage || 0);
  const cost = fees + slippage;
  const rMultiple = tradeRMultiple(trade);
  const riskDistance = Math.abs(entry - stop);
  const direction = trade.side === "short" ? -1 : 1;
  const favorableMove = Number.isFinite(entry) && Number.isFinite(exit) ? (exit - entry) * direction : null;
  const liquidationBuffer = Number.isFinite(entry) && Number.isFinite(liquidation) && entry > 0 ? Math.abs(entry - liquidation) / entry : null;
  const costRatio = Number.isFinite(notional) && notional > 0 ? cost / notional : null;
  return [
    {
      name: "入场防守",
      value: `${price(entry)} / ${price(stop)}`,
      threshold: "入场价 / 止损价",
      status: Number.isFinite(riskDistance) && riskDistance > 0 ? "pass" : "fail",
      action: riskDistance > 0 ? `风险距离 ${price(riskDistance)}` : "止损距离无效，无法计算 R 倍数。",
    },
    {
      name: "退出结果",
      value: exitReasonLabel(trade.exit_reason),
      threshold: `平仓 ${price(exit)}`,
      status: Number(trade.pnl || 0) >= 0 ? "pass" : "warn",
      action: `${tradeTime(trade.exit_time)} · PnL ${money(trade.pnl)}U`,
    },
    {
      name: "R 倍数",
      value: rMultiple === null ? "-" : `${rMultiple.toFixed(2)}R`,
      threshold: "按入场-止损距离",
      status: rMultiple === null ? "watch" : rMultiple >= 1 ? "pass" : rMultiple >= 0 ? "watch" : "warn",
      action: favorableMove === null ? "缺少平仓价。" : `有利移动 ${price(favorableMove)}`,
    },
    {
      name: "目标距离",
      value: Number.isFinite(takeProfit) && Number.isFinite(entry) ? `${(Math.abs(takeProfit - entry) / Math.max(riskDistance, 1e-9)).toFixed(2)}R` : "-",
      threshold: "止盈相对止损",
      status: Number.isFinite(takeProfit) && riskDistance > 0 ? "pass" : "watch",
      action: `止盈 ${price(takeProfit)}`,
    },
    {
      name: "交易成本",
      value: `${money(cost)}U`,
      threshold: costRatio === null ? "-" : `${(costRatio * 100).toFixed(4)}% 名义`,
      status: costRatio === null ? "watch" : costRatio <= 0.001 ? "pass" : "warn",
      action: `费用 ${money(fees)} · 滑点 ${money(slippage)}`,
    },
    {
      name: "保证金使用",
      value: `${money(margin)}U`,
      threshold: `${money(notional)}U 名义`,
      status: Number.isFinite(margin) && margin > 0 ? "pass" : "watch",
      action: Number.isFinite(leverage) ? `杠杆 ${leverage.toFixed(1)}x` : "缺少杠杆字段。",
    },
    {
      name: "强平缓冲",
      value: liquidationBuffer === null ? "-" : `${(liquidationBuffer * 100).toFixed(2)}%`,
      threshold: "距离入场价",
      status: liquidationBuffer === null ? "watch" : liquidationBuffer >= 0.003 ? "pass" : "warn",
      action: `强平价 ${price(liquidation)}`,
    },
    {
      name: "保本移动",
      value: trade.stop_moved_to_breakeven ? "已触发" : "未触发",
      threshold: "TP1 后移动止损",
      status: trade.stop_moved_to_breakeven ? "pass" : "watch",
      action: trade.tp_levels?.length ? `${trade.tp_levels.length} 个分批止盈层级` : "没有分批止盈记录。",
    },
  ];
}

function fallbackHealth(portfolio) {
  const summary = portfolio?.summary || {};
  const trades = Number(summary.trades || 0);
  const returnPct = Number(summary.return_pct || 0);
  const drawdown = Number(summary.max_drawdown || 0);
  const lossStreak = Number(summary.max_consecutive_losses || 0);
  const winRate = Number(summary.win_rate || 0);
  let score = 50 + Math.min(Math.max(returnPct, -0.5), 1.5) * 24 - Math.min(drawdown, 0.6) * 70;
  score += Math.min(trades, 80) * 0.2 - Math.max(0, 10 - trades) * 2.2;
  score += (winRate - 0.45) * 18 - lossStreak * 1.3;
  score = Math.max(0, Math.min(100, score));
  const grade = score >= 78 ? "A" : score >= 62 ? "B" : score >= 45 ? "C" : "D";
  const verdict = score >= 78 ? "可继续观察" : score >= 62 ? "需要验证" : score >= 45 ? "高风险观察" : "暂不建议扩大";
  const notes = [];
  if (trades < 20) notes.push(`样本偏少：仅 ${trades} 笔交易，优先扩大窗口或做滚动验证。`);
  if (drawdown >= 0.12) notes.push(`回撤需要关注：最大回撤 ${pct(drawdown)}。`);
  if (lossStreak >= 6) notes.push(`连续亏损压力：最大连亏 ${lossStreak} 笔。`);
  if (!notes.length) notes.push("旧快照缺少后端健康度字段，当前为前端降级估算。");
  return { score, grade, verdict, notes };
}

function portfolioHealth(portfolio) {
  return portfolio?.health || fallbackHealth(portfolio);
}

function metricsFromPortfolio(portfolio) {
  const summary = portfolio?.summary || {};
  const health = portfolioHealth(portfolio);
  return [
    { label: "最终权益 (USDT)", value: money(summary.final_equity), change: `初始 ${money(summary.initial_equity)}`, tone: "profit", icon: Wallet },
    { label: "组合收益率", value: pct(summary.return_pct), change: `${summary.history_hours || 0} 小时窗口`, tone: Number(summary.return_pct) >= 0 ? "profit" : "risk", icon: LineChart },
    { label: "最大回撤", value: pct(summary.max_drawdown), change: `连亏 ${summary.max_consecutive_losses ?? "-"}`, tone: "risk", icon: ShieldAlert },
    { label: "胜率", value: pct(summary.win_rate), change: `${summary.trades || 0} 笔样本`, tone: "blue", icon: Gauge },
    { label: "健康评分", value: Number.isFinite(Number(health.score)) ? Number(health.score).toFixed(0) : "-", change: `${health.grade || "-"} · ${health.verdict || "-"}`, tone: Number(health.score || 0) >= 62 ? "cyan" : "risk", icon: Activity },
    { label: "总交易数", value: String(summary.trades ?? "-"), change: portfolio?.by_symbol?.map((row) => `${row.inst_id.split("-")[0]} ${row.trades}`).join(" / ") || "-", tone: "cyan", icon: ListOrdered },
  ];
}

function signedNumber(value, formatter) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "-";
  const sign = Number(value) > 0 ? "+" : "";
  return `${sign}${formatter(Number(value))}`;
}

function signedPct(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "-";
  return signedNumber(Number(value), pct);
}

function experimentScore(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function experimentVerdict(row = {}, type = "optimize") {
  const score = experimentScore(row.score);
  const summary = row.summary || {};
  const health = row.health || {};
  const drawdown = Number(summary.max_drawdown || 0);
  const trades = Number(summary.trades || 0);
  if (score === null) return "等待扫描结果。";
  if (drawdown >= 0.18) return "回撤偏高，生成实验前先看风险指标。";
  if (trades > 0 && trades < 20) return "样本偏少，优先扩大窗口验证。";
  if (type === "risk" && Number(row.delta?.score || 0) <= 0) return "未明显优于当前，只作为备选。";
  if (Number(health.score || 0) >= 78 || score >= 0.72) return "优先生成实验并保存快照。";
  return "可生成实验，需结合弱窗口复核。";
}

function parameterChangeText(params = {}) {
  const parts = [];
  if (params.lookback !== undefined) parts.push(`LB ${params.lookback}`);
  if (params.atr_stop_mult !== undefined) parts.push(`ATR ${params.atr_stop_mult}`);
  if (params.take_profit_rr !== undefined) parts.push(`R ${params.take_profit_rr}`);
  if (params.risk_pct !== undefined) parts.push(`风险 ${pct(params.risk_pct)}`);
  if (params.min_signal_score !== undefined) parts.push(`评分 ${Number(params.min_signal_score).toFixed(2)}`);
  if (params.time_exit_bars) parts.push(`时间止损 ${params.time_exit_bars}K`);
  if (params.loss_streak_pause_bars) parts.push(`连亏停 ${params.loss_streak_pause_bars}K`);
  return parts.join(" · ") || "-";
}

function ComparisonStrip({ portfolio, baselinePortfolio, mode }) {
  if (mode === "snapshot" || !portfolio?.summary || !baselinePortfolio?.summary) return null;
  const current = portfolio.summary;
  const baseline = baselinePortfolio.summary;
  const rows = [
    {
      label: "最终权益差",
      value: signedNumber(Number(current.final_equity || 0) - Number(baseline.final_equity || 0), money),
      good: Number(current.final_equity || 0) >= Number(baseline.final_equity || 0),
    },
    {
      label: "收益率差",
      value: signedNumber(Number(current.return_pct || 0) - Number(baseline.return_pct || 0), pct),
      good: Number(current.return_pct || 0) >= Number(baseline.return_pct || 0),
    },
    {
      label: "回撤差",
      value: signedNumber(Number(current.max_drawdown || 0) - Number(baseline.max_drawdown || 0), pct),
      good: Number(current.max_drawdown || 0) <= Number(baseline.max_drawdown || 0),
    },
    {
      label: "交易数差",
      value: signedNumber(Number(current.trades || 0) - Number(baseline.trades || 0), (value) => `${value.toFixed(0)} 笔`),
      good: Number(current.trades || 0) >= Number(baseline.trades || 0),
    },
  ];

  return (
    <div className="mb-5 comparison-strip">
      <div>
        <p className="text-sm font-semibold text-white">相对历史基准</p>
        <p className="mt-1 text-xs text-slate-500">只比较当前实验展示，不写回策略基准。</p>
      </div>
      <div className="comparison-grid">
        {rows.map((row) => (
          <div key={row.label} className="comparison-cell">
            <span>{row.label}</span>
            <strong className={row.good ? "text-aqua" : "text-risk"}>{row.value}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}

function summaryDelta(current = {}, baseline = {}) {
  return {
    finalEquity: Number(current.final_equity || 0) - Number(baseline.final_equity || 0),
    returnPct: Number(current.return_pct || 0) - Number(baseline.return_pct || 0),
    drawdown: Number(current.max_drawdown || 0) - Number(baseline.max_drawdown || 0),
    trades: Number(current.trades || 0) - Number(baseline.trades || 0),
    winRate: Number(current.win_rate || 0) - Number(baseline.win_rate || 0),
    profitFactor: Number(current.profit_factor || 0) - Number(baseline.profit_factor || 0),
  };
}

function symbolAttributionRows(portfolio = {}, baselinePortfolio = {}) {
  const baselineBySymbol = new Map((baselinePortfolio?.by_symbol || []).map((row) => [row.inst_id, row]));
  return (portfolio?.by_symbol || []).map((row) => {
    const baseline = baselineBySymbol.get(row.inst_id) || {};
    return {
      inst_id: row.inst_id,
      pnl: Number(row.pnl || 0),
      return_pct: Number(row.return_pct || 0),
      trades: Number(row.trades || 0),
      win_rate: Number(row.win_rate || 0),
      delta_pnl: Number(row.pnl || 0) - Number(baseline.pnl || 0),
      delta_return_pct: Number(row.return_pct || 0) - Number(baseline.return_pct || 0),
      delta_trades: Number(row.trades || 0) - Number(baseline.trades || 0),
    };
  }).sort((left, right) => Math.abs(right.delta_pnl) - Math.abs(left.delta_pnl));
}

function importantParamDiffs(currentSettings = {}, baselineSettings = {}, candidateParams = {}) {
  const keys = [
    ["strategy_mode", "模式"],
    ["lookback", "回看"],
    ["atr_stop_mult", "ATR止损"],
    ["take_profit_rr", "止盈R"],
    ["risk_pct", "风险", "pct"],
    ["max_daily_trades", "日内笔数"],
    ["min_signal_score", "评分门槛"],
    ["min_adx", "ADX"],
    ["cooldown_bars", "冷却K"],
    ["time_exit_bars", "时间止损K"],
    ["loss_streak_pause_bars", "连亏暂停K"],
  ];
  return keys.map(([key, label, format]) => {
    const current = candidateParams[key] ?? currentSettings[key];
    const baseline = baselineSettings[key];
    const changed = String(current ?? "") !== String(baseline ?? "");
    return {
      key,
      label,
      current: format === "pct" ? pct(current) : current ?? "-",
      baseline: format === "pct" ? pct(baseline) : baseline ?? "-",
      changed,
    };
  }).filter((row) => row.changed).slice(0, 8);
}

function attributionVerdict(portfolio, baselinePortfolio, mode) {
  if (mode === "snapshot" || !baselinePortfolio?.summary) return "当前为历史基准，先生成实验后再做归因对比。";
  const delta = summaryDelta(portfolio?.summary, baselinePortfolio?.summary || {});
  if (delta.returnPct > 0 && delta.drawdown <= 0) return "实验同时改善收益并降低回撤，可进入保存快照或进一步风险实验。";
  if (delta.returnPct > 0 && delta.drawdown > 0) return "实验提高收益但增加回撤，需要先看风控和弱窗口。";
  if (delta.returnPct <= 0 && delta.drawdown <= 0) return "实验降低回撤但收益未改善，可作为降风险备选。";
  return "实验相对基准收益和回撤都不占优，不建议保存为基准。";
}

function BacktestAttributionPanel({ portfolio, baselinePortfolio, mode, snapshot, experimentCandidate }) {
  const current = portfolio?.summary || {};
  const baseline = baselinePortfolio?.summary || {};
  const delta = summaryDelta(current, baseline);
  const health = portfolioHealth(portfolio);
  const baselineHealth = portfolioHealth(baselinePortfolio);
  const symbolRows = symbolAttributionRows(portfolio, baselinePortfolio);
  const paramDiffs = importantParamDiffs(portfolio?.settings || {}, snapshot?.settings || {}, experimentCandidate?.params || {});
  const hasBaseline = mode !== "snapshot" && Boolean(baselinePortfolio?.summary);
  return (
    <div className="mb-5 analysis-card">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.28em] text-slate-500">Backtest Attribution</p>
          <h3 className="text-lg font-semibold text-white">回测归因复盘</h3>
          <p className="mt-1 text-sm text-slate-400">{attributionVerdict(portfolio, baselinePortfolio, mode)}</p>
        </div>
        <span className={`candidate-health ${hasBaseline && delta.returnPct > 0 && delta.drawdown <= 0 ? "is-ok" : hasBaseline ? "is-risk" : "is-info"}`}>
          {hasBaseline ? "实验对比" : "基准模式"}
        </span>
      </div>
      <div className="experiment-decision-summary">
        <div>
          <span>收益变化</span>
          <strong className={delta.returnPct >= 0 ? "text-aqua" : "text-risk"}>{hasBaseline ? signedPct(delta.returnPct) : pct(current.return_pct)}</strong>
          <p>{hasBaseline ? `当前 ${pct(current.return_pct)} · 基准 ${pct(baseline.return_pct)}` : "等待实验结果"}</p>
        </div>
        <div>
          <span>回撤变化</span>
          <strong className={hasBaseline && delta.drawdown <= 0 ? "text-aqua" : "text-risk"}>{hasBaseline ? signedPct(delta.drawdown) : pct(current.max_drawdown)}</strong>
          <p>{hasBaseline ? `当前 ${pct(current.max_drawdown)} · 基准 ${pct(baseline.max_drawdown)}` : "基准自身回撤"}</p>
        </div>
        <div>
          <span>健康变化</span>
          <strong className={Number(health.score || 0) >= Number(baselineHealth.score || 0) ? "text-aqua" : "text-risk"}>
            {hasBaseline ? signedNumber(Number(health.score || 0) - Number(baselineHealth.score || 0), (value) => value.toFixed(0)) : `${Number(health.score || 0).toFixed(0)}`}
          </strong>
          <p>{health.grade || "-"} · {health.verdict || "-"}</p>
        </div>
      </div>
      <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_1fr]">
        <div className="overflow-x-auto rounded-[18px] border border-white/10">
          <table className="trade-table">
            <thead><tr><th>品种</th><th>PnL</th><th>相对基准</th><th>收益</th><th>交易</th><th>胜率</th></tr></thead>
            <tbody>
              {symbolRows.length ? symbolRows.map((row) => (
                <tr key={row.inst_id}>
                  <td>{row.inst_id?.replace("-SWAP", "") || "-"}</td>
                  <td className={row.pnl >= 0 ? "text-aqua" : "text-risk"}>{money(row.pnl)}U</td>
                  <td className={row.delta_pnl >= 0 ? "text-aqua" : "text-risk"}>{hasBaseline ? signedNumber(row.delta_pnl, money) : "-"}</td>
                  <td>{pct(row.return_pct)}</td>
                  <td>{row.trades}{hasBaseline ? ` (${signedNumber(row.delta_trades, (value) => value.toFixed(0))})` : ""}</td>
                  <td>{pct(row.win_rate)}</td>
                </tr>
              )) : (
                <tr><td colSpan="6">暂无品种归因。</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="task-detail-panel">
          <div className="task-detail-header">
            <div>
              <span>PARAM DIFF</span>
              <h4>参数变化</h4>
              <p>{experimentCandidate ? parameterChangeText(experimentCandidate.params) : "手动参数或历史快照对照。"}</p>
            </div>
            <span className={`snapshot-quality ${paramDiffs.length ? "is-info" : "is-good"}`}>{paramDiffs.length ? `${paramDiffs.length} 项` : "一致"}</span>
          </div>
          <div className="task-detail-meta">
            {(paramDiffs.length ? paramDiffs : [{ label: "关键参数", current: "一致", baseline: "一致" }]).map((row) => (
              <div key={row.key || row.label}>
                <span>{row.label}</span>
                <p>当前 {row.current} · 基准 {row.baseline}</p>
              </div>
            ))}
          </div>
          <div className="ledger-json-panel">
            <span>Attribution Raw JSON</span>
            <pre>{JSON.stringify({
              mode,
              snapshot: snapshot?.label || snapshot?.file,
              candidate: experimentCandidate,
              summary_delta: hasBaseline ? delta : null,
              symbol_attribution: symbolRows,
              param_diffs: paramDiffs,
            }, null, 2)}</pre>
          </div>
        </div>
      </div>
    </div>
  );
}

function ExperimentDecisionPanel({ portfolio, optimization, riskExperiments, optimizeLoading, riskExperimentLoading, onOptimize, onRunRiskExperiments, onApplyCandidate }) {
  const currentSummary = portfolio?.summary || {};
  const currentHealth = portfolioHealth(portfolio);
  const optimizeBest = optimization?.best || optimization?.top?.[0];
  const riskBest = riskExperiments?.rows?.[0];
  const decisionRows = [
    optimizeBest ? {
      key: "optimize",
      source: "优化扫描",
      name: optimizeBest.params?.strategy_mode || "-",
      score: experimentScore(optimizeBest.score),
      returnPct: optimizeBest.summary?.return_pct,
      drawdown: optimizeBest.summary?.max_drawdown,
      health: optimizeBest.health,
      params: optimizeBest.params,
      verdict: experimentVerdict(optimizeBest, "optimize"),
      candidate: optimizeBest,
      action: "生成实验",
    } : null,
    riskBest ? {
      key: "risk",
      source: "风险实验",
      name: riskBest.name || "-",
      score: experimentScore(riskBest.score),
      returnPct: riskBest.summary?.return_pct,
      drawdown: riskBest.summary?.max_drawdown,
      health: riskBest.health,
      params: riskBest.params,
      verdict: experimentVerdict(riskBest, "risk"),
      candidate: riskBest,
      action: "应用",
    } : null,
    {
      key: "current",
      source: "当前展示",
      name: portfolio?.settings?.strategy_mode || "当前参数",
      score: experimentScore(currentHealth.score) === null ? null : Number(currentHealth.score) / 100,
      returnPct: currentSummary.return_pct,
      drawdown: currentSummary.max_drawdown,
      health: currentHealth,
      params: portfolio?.settings || {},
      verdict: currentHealth.verdict || "当前基准用于对照。",
      candidate: null,
      action: "基准",
    },
  ].filter(Boolean).sort((left, right) => {
    if (left.key === "current") return 1;
    if (right.key === "current") return -1;
    return Number(right.score ?? -Infinity) - Number(left.score ?? -Infinity);
  });
  const lead = decisionRows.find((row) => row.key !== "current") || decisionRows[0];
  return (
    <div className="analysis-card experiment-decision-panel">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-white">实验决策</h3>
          <p className="mt-1 text-xs text-slate-500">合并优化扫描、风险实验和当前回测，决定下一次应生成哪组实验。</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="secondary-button" onClick={onOptimize} disabled={optimizeLoading}>
            <ScanSearch size={15} />
            {optimizeLoading ? "扫描中..." : "优化扫描"}
          </button>
          <button type="button" className="secondary-button" onClick={onRunRiskExperiments} disabled={riskExperimentLoading}>
            <ShieldAlert size={15} />
            {riskExperimentLoading ? "实验中..." : "风险实验"}
          </button>
        </div>
      </div>
      <div className="experiment-decision-summary">
        <div>
          <span>建议下一步</span>
          <strong>{lead?.source || "等待扫描"}</strong>
          <p>{lead?.verdict || "先运行优化扫描或风险实验。"}</p>
        </div>
        <div>
          <span>收益/回撤</span>
          <strong className={Number(lead?.returnPct || 0) >= 0 ? "text-aqua" : "text-risk"}>{pct(lead?.returnPct)}</strong>
          <p>DD {pct(lead?.drawdown)}</p>
        </div>
        <div>
          <span>关键参数</span>
          <strong>{lead?.name || "-"}</strong>
          <p>{parameterChangeText(lead?.params)}</p>
        </div>
      </div>
      <div className="mt-4 overflow-hidden rounded-[18px] border border-white/10">
        <table className="trade-table">
          <thead><tr><th>来源</th><th>方案</th><th>Score</th><th>健康</th><th>收益</th><th>回撤</th><th>参数</th><th>判断</th><th>操作</th></tr></thead>
          <tbody>
            {decisionRows.map((row) => (
              <tr key={row.key}>
                <td>{row.source}</td>
                <td>{row.name}</td>
                <td>{row.score === null || row.score === undefined ? "-" : row.score.toFixed(3)}</td>
                <td><span className={`candidate-health ${Number(row.health?.score || 0) >= 62 ? "is-ok" : "is-risk"}`}>{row.health?.grade || "-"} · {Number.isFinite(Number(row.health?.score)) ? Number(row.health.score).toFixed(0) : "-"}</span></td>
                <td className={Number(row.returnPct || 0) >= 0 ? "text-aqua" : "text-risk"}>{pct(row.returnPct)}</td>
                <td>{pct(row.drawdown)}</td>
                <td>{parameterChangeText(row.params)}</td>
                <td>{row.verdict}</td>
                <td>
                  {row.candidate ? (
                    <button type="button" className="table-action" onClick={() => onApplyCandidate(row.candidate)}>{row.action}</button>
                  ) : (
                    <span className="snapshot-quality is-info">对照</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!optimization && !riskExperiments ? (
        <p className="mt-3 text-sm text-slate-400">还没有实验结果，先运行“优化扫描”找参数族，再用“风险实验”降低回撤和连亏压力。</p>
      ) : null}
    </div>
  );
}

function DataModeNotice({ mode, snapshot, experimentCandidate, snapshotSaveLoading, snapshotSaveResult, hasBaselineSnapshot, onSaveSnapshot, onRestoreSnapshot }) {
  const isSnapshot = mode === "snapshot";
  const health = experimentCandidate?.health || {};
  const diagnostics = experimentCandidate?.diagnostics || {};
  return (
    <div className={`mb-5 data-mode-notice ${isSnapshot ? "is-snapshot" : "is-experiment"}`}>
      <div className="flex min-w-0 items-center gap-3">
        <div className="data-mode-icon">
          {isSnapshot ? <History size={17} /> : <RotateCw size={17} />}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-white">
            {isSnapshot ? `历史快照基准${snapshot?.mode === "quick" ? " · 快速" : snapshot?.mode === "full" ? " · 全量" : ""}` : "实验回测结果"}
          </p>
          <p className="mt-1 text-xs text-slate-400">
            {isSnapshot
              ? `当前指标读取保存快照${snapshot?.label ? `：${snapshot.label}` : ""}，不重新计算策略。${snapshot?.mode === "quick" ? "该快照为页面结果快照，尚未全量验证。" : ""}`
              : experimentCandidate
                ? `当前实验来自优化候选：${experimentCandidate.params?.strategy_mode || "-"}，健康 ${health.grade || "-"} · ${Number.isFinite(Number(health.score)) ? Number(health.score).toFixed(0) : "-"}。`
                : "当前指标来自手动刷新、参数应用或候选应用，会受最新缓存行情影响，不代表已覆盖历史基准。"}
          </p>
        </div>
      </div>
      {!isSnapshot && experimentCandidate ? (
        <div className="experiment-source-strip">
          <span>Score {Number(experimentCandidate.score || 0).toFixed(3)}</span>
          <span>修正 {signedNumber(diagnostics.health_adjustment || 0, (value) => value.toFixed(3))}</span>
          <span>最弱 {diagnostics.worst_case?.inst_id?.replace("-SWAP", "") || "-"} {pct(diagnostics.worst_case?.return_pct)}</span>
        </div>
      ) : null}
      <div className="data-mode-actions">
        {!isSnapshot ? (
          <button type="button" className="secondary-button" onClick={onSaveSnapshot} disabled={snapshotSaveLoading}>
            <History size={15} />
            {snapshotSaveLoading ? "保存中..." : "保存实验快照"}
          </button>
        ) : null}
        {!isSnapshot && hasBaselineSnapshot ? (
          <button type="button" className="secondary-button" onClick={onRestoreSnapshot}>
            <History size={15} />
            回到历史快照
          </button>
        ) : null}
      </div>
      {snapshotSaveResult?.ok ? (
        <div className="snapshot-save-result">
          <span>{snapshotSaveResult.mode === "quick" ? "快速保存" : "已保存"}</span>
          <strong>{snapshotSaveResult.label}</strong>
          <p>{snapshotSaveResult.path}</p>
        </div>
      ) : null}
    </div>
  );
}

function BacktestActionQueue({
  portfolio,
  mode,
  optimization,
  riskExperiments,
  loading,
  optimizeLoading,
  riskExperimentLoading,
  snapshotSaveLoading,
  hasBaselineSnapshot,
  onRefresh,
  onOptimize,
  onRunRiskExperiments,
  onSaveSnapshot,
  onRestoreSnapshot,
  onOpenView,
}) {
  const summary = portfolio?.summary || {};
  const health = portfolioHealth(portfolio);
  const trades = Number(summary.trades || 0);
  const drawdown = Number(summary.max_drawdown || 0);
  const returnPct = Number(summary.return_pct || 0);
  const needsRisk = drawdown >= 0.12 || Number(health.score || 0) < 62;
  const needsSample = trades > 0 && trades < 30;
  const isExperiment = mode === "experiment";
  const actions = [
    {
      key: "refresh",
      title: isExperiment ? "重新生成实验回测" : "生成实验回测",
      detail: isExperiment ? "用当前参数重新计算组合回测，确认实验结果是否稳定。" : "从当前参数生成一组实验回测，不覆盖历史基准快照。",
      action: loading ? "计算中..." : "生成回测",
      disabled: loading,
      tone: "is-info",
      onClick: onRefresh,
    },
    {
      key: "optimize",
      title: optimization ? "继续优化扫描" : "运行优化扫描",
      detail: optimization ? "已有优化候选，可继续扫描或应用候选生成实验。" : "先做 7 天多市场联合扫描，找下一组参数候选。",
      action: optimizeLoading ? "扫描中..." : "优化扫描",
      disabled: optimizeLoading,
      tone: optimization ? "is-good" : "is-info",
      onClick: onOptimize,
    },
    {
      key: "risk",
      title: "风险/退出实验",
      detail: needsRisk ? "当前回撤或健康度需要处理，优先测试连亏暂停、时间止损和降风险方案。" : "压力不高时可作为对照，验证参数韧性。",
      action: riskExperimentLoading ? "实验中..." : "风险实验",
      disabled: riskExperimentLoading,
      tone: needsRisk ? "is-bad" : riskExperiments ? "is-good" : "is-info",
      onClick: onRunRiskExperiments,
    },
    {
      key: "snapshot",
      title: isExperiment ? "保存实验快照" : "快照状态",
      detail: isExperiment ? "如果当前实验可接受，保存为快速快照，后续再做全量验证。" : "当前是历史基准快照，先生成或应用实验后再保存。",
      action: snapshotSaveLoading ? "保存中..." : isExperiment ? "保存快照" : "打开数据",
      disabled: snapshotSaveLoading,
      tone: isExperiment && returnPct > 0 && drawdown < 0.18 ? "is-good" : "is-info",
      onClick: isExperiment ? onSaveSnapshot : () => onOpenView?.("数据"),
    },
    {
      key: "risk_view",
      title: "打开风控处置",
      detail: needsRisk ? "当前结果需要查看压力表和准入失败项。" : "查看准入、MC 尾部风险和模拟盘熔断状态。",
      action: "打开风控",
      tone: needsRisk ? "is-bad" : "is-info",
      onClick: () => onOpenView?.("风控"),
    },
    {
      key: "data_view",
      title: "数据与样本复核",
      detail: needsSample ? "交易样本偏少，优先检查数据窗口和快照覆盖。" : "复核缓存新鲜度、快照基准和后台任务状态。",
      action: "打开数据",
      tone: needsSample ? "is-bad" : "is-info",
      onClick: () => onOpenView?.("数据"),
    },
  ];

  return (
    <div className="mb-5 analysis-card">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.28em] text-slate-500">Backtest Actions</p>
          <h3 className="text-lg font-semibold text-white">回测动作队列</h3>
          <p className="mt-1 text-sm text-slate-400">
            {needsRisk ? `回撤 ${pct(drawdown)} 或健康 ${health.grade || "-"} 需要优先处理。` : needsSample ? `样本 ${trades} 笔偏少，先复核数据覆盖。` : "当前结果可继续观察，按需生成实验或保存快照。"}
          </p>
        </div>
        {hasBaselineSnapshot && isExperiment ? (
          <button type="button" className="table-action" onClick={onRestoreSnapshot}>
            回到历史快照
          </button>
        ) : null}
      </div>
      <div className="event-list">
        {actions.map((item) => (
          <div className="event-row" key={item.key}>
            <span className={`preflight-dot ${item.tone === "is-bad" ? "is-fail" : item.tone === "is-good" ? "is-pass" : "is-pending"}`} />
            <div>
              <strong>{item.title}</strong>
              <p>{item.detail}</p>
              <button type="button" className="mt-2 table-action" onClick={() => item.onClick?.()} disabled={item.disabled}>
                {item.action}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function OptimizationPanel({ optimization, loading, onOptimize, onApplyCandidate }) {
  const rows = optimization?.top || [];
  const best = optimization?.best || rows[0];
  const diagnostics = best?.diagnostics || {};
  const dedup = optimization?.dedup || {};
  return (
    <div className="analysis-card">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-white">优化候选</h3>
          <p className="mt-1 text-xs text-slate-500">
            7 天多市场联合扫描，仅用于生成实验结果，不覆盖历史快照基准。
            {dedup.raw ? ` 已聚类 ${dedup.raw} → ${dedup.unique}，去重 ${dedup.removed}。` : ""}
          </p>
        </div>
        <button type="button" className="secondary-button" onClick={onOptimize} disabled={loading}>
          <ScanSearch size={15} />
          {loading ? "扫描中..." : "运行优化扫描"}
        </button>
      </div>
      {best ? (
        <div className="candidate-diagnostics mb-4">
          <div>
            <span>当前首选</span>
            <strong>{best.params?.strategy_mode || "-"} · {(best.health || {}).grade || "-"}</strong>
            <p>{(best.health || {}).verdict || "等待诊断"}</p>
          </div>
          <div>
            <span>健康修正</span>
            <strong className={Number(diagnostics.health_adjustment || 0) >= 0 ? "text-aqua" : "text-risk"}>
              {signedNumber(diagnostics.health_adjustment || 0, (value) => value.toFixed(3))}
            </strong>
            <p>Raw {Number(diagnostics.raw_score || best.raw_score || 0).toFixed(3)} → {Number(diagnostics.adjusted_score || best.score || 0).toFixed(3)}</p>
          </div>
          <div>
            <span>最弱窗口</span>
            <strong>{diagnostics.worst_case?.inst_id?.replace("-SWAP", "") || "-"}</strong>
            <p>
              {diagnostics.worst_case?.history_hours ? `${diagnostics.worst_case.history_hours}h · ` : ""}
              {pct(diagnostics.worst_case?.return_pct)} / DD {pct(diagnostics.worst_case?.max_drawdown)}
            </p>
          </div>
          <div>
            <span>最低健康</span>
            <strong>{Number.isFinite(Number(diagnostics.worst_health)) ? Number(diagnostics.worst_health).toFixed(0) : "-"}</strong>
            <p>均值 {Number.isFinite(Number(diagnostics.avg_health)) ? Number(diagnostics.avg_health).toFixed(0) : "-"}</p>
          </div>
        </div>
      ) : null}
      {diagnostics.notes?.length ? (
        <div className="candidate-note-list mb-4">
          {diagnostics.notes.slice(0, 3).map((note) => (
            <p key={note}>{note}</p>
          ))}
        </div>
      ) : null}
      <div className="overflow-hidden rounded-[18px] border border-white/10">
        <table className="trade-table">
          <thead>
            <tr>
              <th>排名</th>
              <th>模式</th>
              <th>Score</th>
              <th>健康</th>
              <th>平均收益</th>
              <th>最差回撤</th>
              <th>正样本</th>
              <th>交易</th>
              <th>参数</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.length ? rows.slice(0, 5).map((row, index) => (
              <tr key={`${row.params.strategy_mode}-${index}`}>
                <td>#{index + 1}</td>
                <td>{row.params.strategy_mode}</td>
                <td>{Number(row.score || 0).toFixed(3)}</td>
                <td>
                  <span className={`candidate-health ${Number((row.health || {}).score || 0) >= 62 ? "is-ok" : "is-risk"}`}>
                    {(row.health || {}).grade || "-"} · {Number.isFinite(Number((row.health || {}).score)) ? Number(row.health.score).toFixed(0) : "-"}
                  </span>
                </td>
                <td className={Number(row.summary?.return_pct || 0) >= 0 ? "text-aqua" : "text-risk"}>{pct(row.summary?.return_pct)}</td>
                <td>{pct(row.summary?.max_drawdown)}</td>
                <td>{row.summary?.positive_cases ?? 0}/{row.summary?.cases ?? 0}</td>
                <td>{row.summary?.trades ?? 0}</td>
                <td>
                  LB {row.params.lookback} · ATR {row.params.atr_stop_mult} · R {row.params.take_profit_rr}
                  {Number(row.cluster_size || 1) > 1 ? ` · 族群 x${row.cluster_size}` : ""}
                </td>
                <td>
                  <button type="button" className="table-action" onClick={() => onApplyCandidate(row)}>生成实验</button>
                </td>
              </tr>
            )) : (
              <tr>
                <td colSpan="10">尚未运行优化扫描。</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RiskExperimentPanel({ experiments, loading, onRun, onApplyCandidate }) {
  const rows = experiments?.rows || [];
  const summary = experiments?.summary || {};
  return (
    <div className="analysis-card">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-white">风险/退出实验</h3>
          <p className="mt-1 text-xs text-slate-500">扫描连亏暂停、时间止损、评分门槛和风险比例，按弱窗口韧性排序。</p>
        </div>
        <button type="button" className="secondary-button" onClick={onRun} disabled={loading}>
          <ShieldAlert size={15} />
          {loading ? "实验中..." : "运行风险实验"}
        </button>
      </div>
      {summary.best_name ? (
        <div className="candidate-diagnostics mb-4">
          <div>
            <span>首选方案</span>
            <strong>{summary.best_name}</strong>
            <p>Score {Number(summary.best_score || 0).toFixed(3)}</p>
          </div>
          <div>
            <span>收益率</span>
            <strong className={Number(summary.best_return_pct || 0) >= 0 ? "text-aqua" : "text-risk"}>{pct(summary.best_return_pct)}</strong>
            <p>最大回撤 {pct(summary.best_drawdown)}</p>
          </div>
          <div>
            <span>弱窗口</span>
            <strong className={Number(summary.best_worst_window || 0) >= 0 ? "text-aqua" : "text-risk"}>{pct(summary.best_worst_window)}</strong>
            <p>压力最差 {pct(summary.best_stress_worst)}</p>
          </div>
          <div>
            <span>方案数</span>
            <strong>{summary.cases ?? rows.length}</strong>
            <p>保留前 6 个可应用候选</p>
          </div>
        </div>
      ) : null}
      <div className="overflow-hidden rounded-[18px] border border-white/10">
        <table className="trade-table">
          <thead>
            <tr>
              <th>方案</th>
              <th>Score</th>
              <th>收益</th>
              <th>回撤</th>
              <th>滚动</th>
              <th>最差窗口</th>
              <th>压力最差</th>
              <th>相对当前</th>
              <th>风险</th>
              <th>门槛</th>
              <th>退出</th>
              <th>诊断</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.length ? rows.slice(0, 6).map((row) => {
              const s = row.summary || {};
              const robust = row.robust || {};
              const params = row.params || {};
              const delta = row.delta || {};
              return (
                <tr key={row.name}>
                  <td>{row.name}</td>
                  <td>{row.score === null || row.score === undefined ? "-" : Number(row.score).toFixed(3)}</td>
                  <td className={Number(s.return_pct || 0) >= 0 ? "text-aqua" : "text-risk"}>{s.return_pct === undefined ? "-" : pct(s.return_pct)}</td>
                  <td>{s.max_drawdown === undefined ? "-" : pct(s.max_drawdown)}</td>
                  <td>{row.rolling_ratio === null || row.rolling_ratio === undefined ? "-" : pct(row.rolling_ratio)}</td>
                  <td className={Number(robust.rolling_worst_return_pct || 0) >= 0 ? "text-aqua" : "text-risk"}>
                    {robust.rolling_worst_return_pct === undefined ? "-" : pct(robust.rolling_worst_return_pct)}
                  </td>
                  <td className={Number(robust.stress_worst_return_pct || 0) >= 0 ? "text-aqua" : "text-risk"}>
                    {robust.stress_worst_return_pct === undefined ? "-" : pct(robust.stress_worst_return_pct)}
                  </td>
                  <td className={Number(delta.score || 0) >= 0 ? "text-aqua" : "text-risk"}>
                    {delta.score === undefined ? "-" : signedNumber(delta.score, (value) => value.toFixed(3))}
                  </td>
                  <td>{pct(params.risk_pct)}</td>
                  <td>{Number.isFinite(Number(params.min_signal_score)) ? Number(params.min_signal_score).toFixed(2) : "-"}</td>
                  <td>{params.time_exit_bars ? `${params.time_exit_bars}K/${Number(params.time_exit_min_rr || 0).toFixed(2)}R` : params.loss_streak_pause_bars ? `停 ${params.loss_streak_pause_bars}K` : "-"}</td>
                  <td title={`收益 ${signedPct(delta.return_pct)} · 回撤 ${signedPct(delta.max_drawdown)} · 弱窗口 ${signedPct(delta.rolling_worst_return_pct)}`}>
                    {row.diagnostic || "-"}
                  </td>
                  <td>
                    <button type="button" className="table-action" onClick={() => onApplyCandidate(row)}>应用</button>
                  </td>
                </tr>
              );
            }) : (
              <tr>
                <td colSpan="13">尚未运行风险/退出实验。</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RiskPanel({ portfolio, mode }) {
  const summary = portfolio?.summary || {};
  const health = portfolioHealth(portfolio);
  const rows = [
    { label: "最大回撤", value: pct(summary.max_drawdown), note: "账户权益峰值到谷值的最大跌幅" },
    { label: "最大连亏", value: `${summary.max_consecutive_losses ?? "-"} 笔`, note: "连续亏损会触发降仓或熔断判断" },
    { label: "盈利因子", value: summary.profit_factor ? Number(summary.profit_factor).toFixed(2) : "-", note: "总盈利 / 总亏损" },
    { label: "单笔期望", value: `${money(summary.expectancy)}U`, note: "每笔交易平均贡献" },
    { label: "交易样本", value: `${summary.trades ?? 0} 笔`, note: mode === "experiment" ? "当前实验样本" : "历史快照样本" },
    { label: "健康评分", value: Number.isFinite(Number(health.score)) ? `${Number(health.score).toFixed(0)} / ${health.grade}` : "-", note: health.verdict || "综合收益、回撤、样本和连亏" },
  ];

  return (
    <div className="analysis-card">
      <div className="mb-5">
        <h3 className="text-lg font-semibold text-white">风险指标</h3>
        <p className="mt-1 text-xs text-slate-500">只读取当前展示结果，用于判断回撤、连亏和样本质量。</p>
      </div>
      <div className="risk-grid">
        {rows.map((row) => (
          <div key={row.label} className="risk-cell">
            <span>{row.label}</span>
            <strong>{row.value}</strong>
            <p>{row.note}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function HealthPanel({ portfolio }) {
  const health = portfolioHealth(portfolio);
  const score = Number(health.score || 0);
  const circumference = 2 * Math.PI * 42;
  const dashOffset = circumference * (1 - Math.max(0, Math.min(score, 100)) / 100);
  return (
    <div className="analysis-card health-panel">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h3 className="text-lg font-semibold text-white">策略健康度</h3>
          <p className="mt-1 text-xs text-slate-500">综合收益、回撤、样本、连亏、胜率和成本韧性。</p>
        </div>
        <div className={`health-badge ${score >= 62 ? "is-ok" : "is-risk"}`}>{health.verdict || "-"}</div>
      </div>
      <div className="health-body">
        <div className="health-score-ring" style={{ "--offset": dashOffset, "--circumference": circumference }}>
          <svg viewBox="0 0 100 100" aria-hidden="true">
            <circle cx="50" cy="50" r="42" />
            <circle cx="50" cy="50" r="42" />
          </svg>
          <div>
            <strong>{Number.isFinite(score) ? score.toFixed(0) : "-"}</strong>
            <span>{health.grade || "-"}</span>
          </div>
        </div>
        <div className="health-notes">
          {(health.notes || []).map((note) => (
            <p key={note}>{note}</p>
          ))}
        </div>
      </div>
    </div>
  );
}

function EventLogPanel({ portfolio, snapshot, mode, experimentCandidate }) {
  const summary = portfolio?.summary || {};
  const health = portfolioHealth(portfolio);
  const latestTrade = portfolio?.trades?.[portfolio.trades.length - 1];
  const events = [
    {
      title: mode === "experiment" ? "实验回测已生成" : "历史快照已加载",
      detail: mode === "experiment"
        ? experimentCandidate
          ? `来自优化候选 ${experimentCandidate.params?.strategy_mode || "-"}，候选健康 ${(experimentCandidate.health || {}).grade || "-"}。`
          : "当前结果来自显式回测操作，未覆盖基准。"
        : `当前基准为 ${snapshot?.label || "历史快照"}。`,
    },
    {
      title: "窗口范围",
      detail: summary.window_start ? `${summary.window_start.slice(0, 10)} 到 ${summary.window_end?.slice(0, 10)}` : "等待回测窗口",
    },
    {
      title: "权益结果",
      detail: `初始 ${money(summary.initial_equity)}U，最终 ${money(summary.final_equity)}U，收益 ${pct(summary.return_pct)}。`,
    },
    {
      title: "样本统计",
      detail: `${summary.trades ?? 0} 笔交易，胜率 ${pct(summary.win_rate)}，最大回撤 ${pct(summary.max_drawdown)}。`,
    },
    {
      title: "健康度判断",
      detail: `${health.grade || "-"} 级，评分 ${Number.isFinite(Number(health.score)) ? Number(health.score).toFixed(0) : "-"}，${health.verdict || "-"}。`,
    },
    experimentCandidate?.diagnostics?.notes?.[0] ? {
      title: "候选风险备注",
      detail: experimentCandidate.diagnostics.notes[0],
    } : null,
    {
      title: "最近交易",
      detail: latestTrade ? `${latestTrade.entry_time?.slice(0, 16) || "-"} ${latestTrade.inst_id?.replace("-SWAP", "") || "-"} ${latestTrade.side || "-"}，PnL ${money(latestTrade.pnl)}U。` : "暂无交易记录。",
    },
  ].filter(Boolean);

  return (
    <div className="analysis-card">
      <div className="mb-5">
        <h3 className="text-lg font-semibold text-white">运行日志</h3>
        <p className="mt-1 text-xs text-slate-500">当前页面状态的只读摘要，不触发任何回测或参数变更。</p>
      </div>
      <div className="event-list">
        {events.map((event) => (
          <div key={event.title} className="event-row">
            <span />
            <div>
              <strong>{event.title}</strong>
              <p>{event.detail}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function TradeReplayPanel({ trade }) {
  const rMultiple = tradeRMultiple(trade);
  const cost = Number(trade?.fees || 0) + Number(trade?.slippage || 0);
  const evidenceRows = tradeEvidenceRows(trade);
  const passCount = evidenceRows.filter((row) => row.status === "pass").length;
  const warnCount = evidenceRows.filter((row) => row.status === "warn").length;
  const levels = [
    { label: "入场", value: price(trade?.entry), note: tradeTime(trade?.entry_time) },
    { label: "止损", value: price(trade?.stop), note: trade?.stop_moved_to_breakeven ? "曾移动保本" : "原始防守位" },
    { label: "止盈", value: price(trade?.take_profit), note: `${exitReasonLabel(trade?.exit_reason)}退出` },
    { label: "平仓", value: price(trade?.exit_price ?? trade?.exit), note: tradeTime(trade?.exit_time) },
  ];
  return (
    <div className="analysis-card trade-replay-card">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-white">交易复盘</h3>
          <p className="mt-1 text-xs text-slate-500">{trade ? `${trade.inst_id?.replace("-SWAP", "") || "-"} · ${trade.side || "-"} · ${trade.kind || "price_action"}` : "运行回测后选择一笔交易。"}</p>
        </div>
        <span className={`candidate-health ${Number(trade?.pnl || 0) >= 0 ? "is-ok" : "is-risk"}`}>
          {trade ? `${money(trade.pnl)}U` : "未选择"}
        </span>
      </div>
      <p className="text-sm text-slate-300">{tradeReplayNote(trade)}</p>
      <div className="mt-4 trade-replay-levels">
        {levels.map((row) => (
          <div key={row.label}>
            <span>{row.label}</span>
            <strong>{row.value}</strong>
            <p>{row.note}</p>
          </div>
        ))}
      </div>
      <div className="mt-4 risk-grid">
        <div className="risk-cell"><span>R倍数</span><strong className={Number(rMultiple || 0) >= 0 ? "text-aqua" : "text-risk"}>{rMultiple === null ? "-" : `${rMultiple.toFixed(2)}R`}</strong><p>按入场到止损距离估算</p></div>
        <div className="risk-cell"><span>名义金额</span><strong>{money(trade?.notional)}U</strong><p>保证金 {money(trade?.margin_used)}U</p></div>
        <div className="risk-cell"><span>成本</span><strong>{money(cost)}U</strong><p>费用 {money(trade?.fees)} · 滑点 {money(trade?.slippage)}</p></div>
        <div className="risk-cell"><span>杠杆</span><strong>{Number.isFinite(Number(trade?.leverage)) ? `${Number(trade.leverage).toFixed(1)}x` : "-"}</strong><p>强平 {price(trade?.liquidation_price)}</p></div>
      </div>
      <div className="mt-4 rounded-[18px] border border-white/10 p-4">
        <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.28em] text-slate-500">Trade Evidence</p>
            <h4 className="text-base font-semibold text-white">交易证据矩阵</h4>
            <p className="mt-1 text-xs text-slate-500">{trade ? `${passCount}/${evidenceRows.length} 项通过，${warnCount} 项需要观察。` : "选择一笔交易后显示证据矩阵。"}</p>
          </div>
          <span className={`snapshot-quality ${warnCount ? "is-warn" : trade ? "is-good" : "is-info"}`}>
            {trade ? `${passCount}/${evidenceRows.length}` : "待选择"}
          </span>
        </div>
        <div className="overflow-x-auto rounded-[16px] border border-white/10">
          <table className="trade-table">
            <thead><tr><th>证据</th><th>当前值</th><th>门槛/用途</th><th>状态</th><th>动作</th></tr></thead>
            <tbody>
              {trade ? evidenceRows.map((row) => (
                <tr key={row.name}>
                  <td>{row.name}</td>
                  <td>{row.value}</td>
                  <td>{row.threshold}</td>
                  <td><span className={`snapshot-quality ${tradeEvidenceTone(row.status)}`}>{tradeEvidenceLabel(row.status)}</span></td>
                  <td>{row.action}</td>
                </tr>
              )) : (
                <tr><td colSpan="5">运行回测后选择一笔交易。</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="mt-3 ledger-json-panel">
          <span>Trade Evidence JSON</span>
          <pre>{JSON.stringify({
            key: trade ? tradeKey(trade) : null,
            evidence: trade ? evidenceRows : [],
            trade: trade || null,
          }, null, 2)}</pre>
        </div>
      </div>
    </div>
  );
}

function TabContent({ activeTab, portfolio, optimization, riskExperiments, experimentCandidate, optimizeLoading, riskExperimentLoading, snapshot, mode, selectedTrade, onSelectTrade, onOptimize, onRunRiskExperiments, onApplyCandidate }) {
  const trades = portfolio?.trades || [];
  const selected = selectedTrade && trades.some((trade) => tradeKey(trade) === tradeKey(selectedTrade)) ? selectedTrade : trades.at(-1);
  if (activeTab === "表现") {
    return <EquityCurve data={portfolio?.equity_curve || portfolio?.trades} />;
  }
  if (activeTab === "交易分析") {
    return (
      <div className="mt-5 grid gap-5 xl:grid-cols-[1fr_.92fr]">
        <StrategyAuditPanel portfolio={portfolio} mode={mode} className="" />
        <div className="grid gap-5">
          <TradeReplayPanel trade={selected} />
          <RecentTradesTable trades={portfolio?.trades} selectedTrade={selected} onSelectTrade={onSelectTrade} />
        </div>
      </div>
    );
  }
  if (activeTab === "风险指标") {
    return (
      <div className="mt-5 grid gap-5 xl:grid-cols-[.92fr_1fr]">
        <RiskPanel portfolio={portfolio} mode={mode} />
        <StrategyAuditPanel portfolio={portfolio} mode={mode} className="" />
      </div>
    );
  }
  if (activeTab === "日志") {
    return (
      <div className="mt-5 grid gap-5 xl:grid-cols-[.88fr_1.12fr]">
        <EventLogPanel portfolio={portfolio} snapshot={snapshot} mode={mode} experimentCandidate={experimentCandidate} />
        <RecentTradesTable trades={portfolio?.trades} selectedTrade={selected} onSelectTrade={onSelectTrade} />
      </div>
    );
  }
  return (
    <div className="mt-5 grid gap-5 xl:grid-cols-[.9fr_1.1fr]">
      <div className="grid gap-5">
        <HealthPanel portfolio={portfolio} />
        <ExperimentDecisionPanel
          portfolio={portfolio}
          optimization={optimization}
          riskExperiments={riskExperiments}
          optimizeLoading={optimizeLoading}
          riskExperimentLoading={riskExperimentLoading}
          onOptimize={onOptimize}
          onRunRiskExperiments={onRunRiskExperiments}
          onApplyCandidate={onApplyCandidate}
        />
        <OptimizationPanel optimization={optimization} loading={optimizeLoading} onOptimize={onOptimize} onApplyCandidate={onApplyCandidate} />
        <RiskExperimentPanel experiments={riskExperiments} loading={riskExperimentLoading} onRun={onRunRiskExperiments} onApplyCandidate={onApplyCandidate} />
      </div>
      <EquityCurve data={portfolio?.equity_curve || portfolio?.trades} />
    </div>
  );
}

export default function BacktestPanel({
  portfolio,
  loading,
  error,
  optimization,
  riskExperiments,
  experimentCandidate,
  snapshot,
  baselinePortfolio,
  mode,
  hasBaselineSnapshot,
  optimizeLoading,
  riskExperimentLoading,
  snapshotSaveLoading,
  snapshotSaveResult,
  selectedTrade,
  onRefresh,
  onOptimize,
  onRunRiskExperiments,
  onApplyCandidate,
  onSelectTrade,
  onSaveSnapshot,
  onRestoreSnapshot,
  onOpenView,
}) {
  const [activeTab, setActiveTab] = useState("概览");
  const summary = portfolio?.summary || {};

  return (
    <GlassCard className="backtest-panel">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Strategy Tester</p>
          <h2 className="text-2xl font-semibold text-white">策略回测</h2>
          {snapshot?.label ? <p className="mt-1 text-xs text-slate-500">基准快照：{snapshot.label}</p> : null}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="tabbar">
            {tabs.map((tab) => (
              <button key={tab} type="button" className={activeTab === tab ? "is-active" : ""} onClick={() => setActiveTab(tab)}>
                {tab}
              </button>
            ))}
          </div>
          <div className="date-picker" role="status">
            <CalendarDays size={16} />
            <span>{summary.window_start ? `${summary.window_start.slice(0, 10)} — ${summary.window_end?.slice(0, 10)}` : "等待组合回测"}</span>
          </div>
          <button type="button" className="secondary-button" onClick={onRefresh}>
            <RotateCw size={15} />
            {loading ? "计算中..." : "生成实验回测"}
          </button>
        </div>
      </div>

      {error ? <div className="mb-4 rounded-2xl border border-risk/25 bg-risk/10 px-4 py-3 text-sm text-risk">{error}</div> : null}

      <DataModeNotice
        mode={mode}
        snapshot={snapshot}
        experimentCandidate={experimentCandidate}
        snapshotSaveLoading={snapshotSaveLoading}
        snapshotSaveResult={snapshotSaveResult}
        hasBaselineSnapshot={hasBaselineSnapshot}
        onSaveSnapshot={onSaveSnapshot}
        onRestoreSnapshot={onRestoreSnapshot}
      />

      <BacktestActionQueue
        portfolio={portfolio}
        mode={mode}
        optimization={optimization}
        riskExperiments={riskExperiments}
        loading={loading}
        optimizeLoading={optimizeLoading}
        riskExperimentLoading={riskExperimentLoading}
        snapshotSaveLoading={snapshotSaveLoading}
        hasBaselineSnapshot={hasBaselineSnapshot}
        onRefresh={onRefresh}
        onOptimize={onOptimize}
        onRunRiskExperiments={onRunRiskExperiments}
        onSaveSnapshot={onSaveSnapshot}
        onRestoreSnapshot={onRestoreSnapshot}
        onOpenView={onOpenView}
      />

      <ComparisonStrip portfolio={portfolio} baselinePortfolio={baselinePortfolio} mode={mode} />

      <BacktestAttributionPanel
        portfolio={portfolio}
        baselinePortfolio={baselinePortfolio}
        mode={mode}
        snapshot={snapshot}
        experimentCandidate={experimentCandidate}
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        {metricsFromPortfolio(portfolio).map((metric) => (
          <MetricCard key={metric.label} metric={metric} />
        ))}
      </div>

      <TabContent
        activeTab={activeTab}
        portfolio={portfolio}
        optimization={optimization}
        riskExperiments={riskExperiments}
        experimentCandidate={experimentCandidate}
        optimizeLoading={optimizeLoading}
        riskExperimentLoading={riskExperimentLoading}
        snapshot={snapshot}
        mode={mode}
        selectedTrade={selectedTrade}
        onSelectTrade={onSelectTrade}
        onOptimize={onOptimize}
        onRunRiskExperiments={onRunRiskExperiments}
        onApplyCandidate={onApplyCandidate}
      />
    </GlassCard>
  );
}
