import { Activity, CalendarDays, Gauge, History, LineChart, ListOrdered, RotateCw, ScanSearch, ShieldAlert, Wallet } from "lucide-react";
import { useState } from "react";
import EquityCurve from "./EquityCurve";
import GlassCard from "./GlassCard";
import MetricCard from "./MetricCard";
import RecentTradesTable from "./RecentTradesTable";
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

function TabContent({ activeTab, portfolio, optimization, experimentCandidate, optimizeLoading, snapshot, mode, onOptimize, onApplyCandidate }) {
  if (activeTab === "表现") {
    return <EquityCurve data={portfolio?.equity_curve || portfolio?.trades} />;
  }
  if (activeTab === "交易分析") {
    return (
      <div className="mt-5 grid gap-5 xl:grid-cols-[1fr_.92fr]">
        <StrategyAuditPanel portfolio={portfolio} mode={mode} className="" />
        <RecentTradesTable trades={portfolio?.trades} />
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
        <RecentTradesTable trades={portfolio?.trades} />
      </div>
    );
  }
  return (
    <div className="mt-5 grid gap-5 xl:grid-cols-[.9fr_1.1fr]">
      <div className="grid gap-5">
        <HealthPanel portfolio={portfolio} />
        <OptimizationPanel optimization={optimization} loading={optimizeLoading} onOptimize={onOptimize} onApplyCandidate={onApplyCandidate} />
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
  experimentCandidate,
  snapshot,
  baselinePortfolio,
  mode,
  hasBaselineSnapshot,
  optimizeLoading,
  snapshotSaveLoading,
  snapshotSaveResult,
  onRefresh,
  onOptimize,
  onApplyCandidate,
  onSaveSnapshot,
  onRestoreSnapshot,
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

      <ComparisonStrip portfolio={portfolio} baselinePortfolio={baselinePortfolio} mode={mode} />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        {metricsFromPortfolio(portfolio).map((metric) => (
          <MetricCard key={metric.label} metric={metric} />
        ))}
      </div>

      <TabContent
        activeTab={activeTab}
        portfolio={portfolio}
        optimization={optimization}
        experimentCandidate={experimentCandidate}
        optimizeLoading={optimizeLoading}
        snapshot={snapshot}
        mode={mode}
        onOptimize={onOptimize}
        onApplyCandidate={onApplyCandidate}
      />
    </GlassCard>
  );
}
