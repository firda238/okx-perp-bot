import { useMemo, useState } from "react";
import GlassCard from "./GlassCard";

function pct(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "-";
  return `${(Number(value) * 100).toFixed(2)}%`;
}

function money(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "-";
  return Number(value).toLocaleString(undefined, { maximumFractionDigits: 4 });
}

function metricNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function signedPct(value) {
  const number = metricNumber(value);
  if (number === null) return "-";
  return `${number >= 0 ? "+" : ""}${(number * 100).toFixed(2)}%`;
}

function signedNumber(value) {
  const number = metricNumber(value);
  if (number === null) return "-";
  return `${number >= 0 ? "+" : ""}${number.toFixed(0)}`;
}

function DeltaLine({ label, value, format = "pct", lowerIsBetter = false }) {
  const number = metricNumber(value);
  const isGood = number !== null && (lowerIsBetter ? number <= 0 : number >= 0);
  return (
    <span className={number === null ? "" : isGood ? "is-good" : "is-bad"}>
      {label} {format === "number" ? signedNumber(number) : signedPct(number)}
    </span>
  );
}

const SNAPSHOT_SORTS = {
  created_at: { label: "时间", direction: "desc" },
  health_score: { label: "健康", direction: "desc" },
  return_pct: { label: "收益", direction: "desc" },
  max_drawdown: { label: "回撤", direction: "asc" },
};

function snapshotQuality(row = {}) {
  const health = metricNumber(row.health_score);
  const trades = metricNumber(row.trades);
  const returnPct = metricNumber(row.return_pct);
  const drawdown = metricNumber(row.max_drawdown);
  if (row.mode === "quick") return { label: "待验证", tone: "is-warn" };
  if ((health ?? 0) >= 78 && (returnPct ?? -1) > 0 && (drawdown ?? 1) <= 0.18) return { label: "候选", tone: "is-good" };
  if ((health ?? 0) >= 62 && (returnPct ?? -1) > 0) return { label: "观察", tone: "is-info" };
  if (trades !== null && trades < 20) return { label: "样本少", tone: "is-warn" };
  return { label: "高风险", tone: "is-bad" };
}

function isCandidateSnapshot(row = {}) {
  const health = metricNumber(row.health_score);
  const returnPct = metricNumber(row.return_pct);
  const drawdown = metricNumber(row.max_drawdown);
  return row.mode !== "quick" && (health ?? 0) >= 62 && (returnPct ?? -1) > 0 && (drawdown ?? 1) <= 0.22;
}

function compareSnapshotRows(sortKey, direction) {
  return (left, right) => {
    const multiplier = direction === "asc" ? 1 : -1;
    if (sortKey === "created_at") {
      return multiplier * String(left.created_at || "").localeCompare(String(right.created_at || ""));
    }
    const leftValue = metricNumber(left[sortKey]);
    const rightValue = metricNumber(right[sortKey]);
    if (leftValue === null && rightValue === null) return 0;
    if (leftValue === null) return 1;
    if (rightValue === null) return -1;
    return multiplier * (leftValue - rightValue);
  };
}

const SNAPSHOT_SETTING_FIELDS = [
  ["instId", "品种"],
  ["bar", "周期"],
  ["history_hours", "窗口"],
  ["strategy_mode", "模式"],
  ["atr_stop_mult", "ATR止损"],
  ["take_profit_rr", "止盈R"],
  ["risk_pct", "单笔风险", "pct"],
  ["leverage", "杠杆"],
  ["max_daily_trades", "日内笔数"],
  ["min_adx", "ADX门槛"],
  ["min_louie_breakout_adx", "突破ADX"],
  ["trade_louie_breakout_tests", "突破测试", "bool"],
  ["trade_louie_delayed_sweeps", "延迟扫单", "bool"],
  ["trade_louie_trend_regime", "趋势交易", "bool"],
];

function valueLabel(value, format = "") {
  if (value === null || value === undefined || value === "") return "-";
  if (format === "pct") return pct(value);
  if (format === "bool") return value ? "开" : "关";
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : value.toFixed(4).replace(/\.?0+$/, "");
  return String(value);
}

function valuesEqual(left, right) {
  const leftNumber = metricNumber(left);
  const rightNumber = metricNumber(right);
  if (leftNumber !== null && rightNumber !== null) return Math.abs(leftNumber - rightNumber) < 1e-9;
  return String(left ?? "") === String(right ?? "");
}

function settingDiffRows(snapshotSettings = {}, currentSettings = {}) {
  return SNAPSHOT_SETTING_FIELDS.map(([key, label, format]) => {
    const currentValue = currentSettings[key];
    const snapshotValue = snapshotSettings[key];
    return {
      key,
      label,
      current: valueLabel(currentValue, format),
      snapshot: valueLabel(snapshotValue, format),
      changed: !valuesEqual(currentValue, snapshotValue),
    };
  }).filter((row) => row.changed);
}

function SnapshotDetailPanel({ snapshot, currentSnapshot, loading, onLoadSnapshot }) {
  const currentFile = currentSnapshot?.file || currentSnapshot?.path?.split("/").pop();
  const snapshotFile = snapshot?.file || snapshot?.path?.split("/").pop();
  if (loading) {
    return (
      <div className="mt-5 snapshot-detail-panel">
        <div className="snapshot-detail-empty">正在读取快照详情...</div>
      </div>
    );
  }
  if (!snapshot) {
    return (
      <div className="mt-5 snapshot-detail-panel">
        <div className="snapshot-detail-empty">选择一个研究快照查看参数差异、健康说明和品种归因。</div>
      </div>
    );
  }

  const summary = snapshot.portfolio?.summary || {};
  const health = snapshot.portfolio?.health || {};
  const readiness = snapshot.readiness || {};
  const bySymbol = snapshot.portfolio?.by_symbol || [];
  const notes = health.notes || [];
  const diffs = settingDiffRows(snapshot.settings || {}, currentSnapshot?.settings || {});
  const isCurrent = Boolean(currentFile && snapshotFile === currentFile);
  const validation = snapshot.meta?.validation_level || (snapshot.mode === "quick" ? "quick-page-result" : "full-recomputed");

  return (
    <div className="mt-5 snapshot-detail-panel">
      <div className="snapshot-detail-header">
        <div>
          <span>快照详情</span>
          <h3>{snapshot.label || snapshotFile || "-"}</h3>
          <p>{snapshot.created_at?.replace("T", " ").slice(0, 19) || "-"} · {validation}</p>
        </div>
        <div className="snapshot-detail-actions">
          <span className={`candidate-health ${snapshot.mode === "quick" ? "is-risk" : "is-ok"}`}>{snapshot.mode || "full"}</span>
          <button type="button" className="table-action" onClick={() => onLoadSnapshot?.(snapshot)} disabled={isCurrent}>
            {isCurrent ? "当前基准" : "加载为基准"}
          </button>
        </div>
      </div>

      <div className="snapshot-detail-metrics">
        <StatCell label="最终权益" value={money(summary.final_equity)} note={`初始 ${money(summary.initial_equity)}`} />
        <StatCell label="收益率" value={pct(summary.return_pct)} note={`${summary.trades ?? "-"} 笔交易`} tone={Number(summary.return_pct || 0) >= 0 ? "text-aqua" : "text-risk"} />
        <StatCell label="最大回撤" value={pct(summary.max_drawdown)} note={`连亏 ${summary.max_consecutive_losses ?? "-"} 笔`} />
        <StatCell label="健康评分" value={`${health.grade || "-"} ${metricNumber(health.score) === null ? "" : metricNumber(health.score).toFixed(0)}`} note={health.verdict || "-"} />
        <StatCell label="验证状态" value={readiness.decision || "-"} note={readiness.score === null || readiness.score === undefined ? "未给分" : `Score ${readiness.score}`} />
      </div>

      <div className="snapshot-detail-grid">
        <div>
          <h4>参数差异</h4>
          <div className="snapshot-diff-list">
            {diffs.length ? diffs.map((row) => (
              <div key={row.key}>
                <span>{row.label}</span>
                <strong>{row.snapshot}</strong>
                <em>当前 {row.current}</em>
              </div>
            )) : <p>关键参数与当前基准一致。</p>}
          </div>
        </div>
        <div>
          <h4>健康说明</h4>
          <div className="snapshot-note-list">
            {notes.length ? notes.map((note) => <p key={note}>{note}</p>) : <p>暂无健康说明。</p>}
          </div>
        </div>
        <div>
          <h4>品种归因</h4>
          <div className="snapshot-symbol-list">
            {bySymbol.length ? bySymbol.slice(0, 6).map((row) => (
              <div key={row.inst_id}>
                <span>{row.inst_id?.replace("-SWAP", "") || "-"}</span>
                <strong className={Number(row.pnl || 0) >= 0 ? "text-aqua" : "text-risk"}>{money(row.pnl)}U</strong>
                <em>{row.trades ?? 0} 笔 · {pct(row.return_pct)}</em>
              </div>
            )) : <p>暂无品种归因。</p>}
          </div>
        </div>
      </div>
    </div>
  );
}

function latestCandle(candles) {
  return candles?.[candles.length - 1] || null;
}

function ViewShell({ title, subtitle, children }) {
  return (
    <GlassCard className="workspace-view">
      <div className="mb-5">
        <p className="text-xs uppercase tracking-[0.28em] text-slate-500">Workspace</p>
        <h2 className="text-2xl font-semibold text-white">{title}</h2>
        <p className="mt-1 text-sm text-slate-400">{subtitle}</p>
      </div>
      {children}
    </GlassCard>
  );
}

function StatCell({ label, value, note, tone = "" }) {
  return (
    <div className="risk-cell">
      <span>{label}</span>
      <strong className={tone}>{value}</strong>
      {note ? <p>{note}</p> : null}
    </div>
  );
}

export function MarketView({ candles, market, portfolio }) {
  const latest = latestCandle(candles);
  const previous = candles?.[candles.length - 2];
  const change = latest && previous ? Number(latest.close) - Number(previous.close) : 0;
  const changePct = previous ? change / Number(previous.close) : 0;
  const bySymbol = portfolio?.by_symbol || [];
  return (
    <ViewShell title="市场" subtitle="当前行情、最近 K 线和组合品种表现。">
      <div className="risk-grid">
        <StatCell label="当前品种" value={market.instId.replace("-SWAP", "")} note={`${market.bar} · OKX public`} />
        <StatCell label="最新收盘" value={money(latest?.close)} note={latest?.time?.replace("T", " ").slice(0, 16) || "-"} />
        <StatCell label="最近涨跌" value={`${change >= 0 ? "+" : ""}${money(change)}`} note={pct(changePct)} tone={change >= 0 ? "text-aqua" : "text-risk"} />
      </div>
      <div className="mt-5 analysis-card">
        <h3 className="text-lg font-semibold text-white">组合品种</h3>
        <div className="mt-4 risk-grid">
          {bySymbol.length ? bySymbol.map((row) => (
            <StatCell key={row.inst_id} label={row.inst_id.replace("-SWAP", "")} value={`${row.trades} 笔`} note={`PnL ${money(row.pnl)}U · ${pct(row.return_pct)}`} tone={Number(row.pnl) >= 0 ? "text-aqua" : "text-risk"} />
          )) : <StatCell label="组合品种" value="-" note="等待组合回测结果" />}
        </div>
      </div>
    </ViewShell>
  );
}

export function RiskView({ paperState, portfolio }) {
  const circuit = paperState?.circuit_breaker || {};
  const summary = portfolio?.summary || {};
  return (
    <ViewShell title="风控" subtitle="模拟盘熔断、账户回撤、连亏和策略回测风险。">
      <div className="risk-grid">
        <StatCell label="交易许可" value={circuit.allow_trade === false ? "阻断" : "允许"} note={circuit.enabled ? "熔断已启用" : "熔断未启用"} tone={circuit.allow_trade === false ? "text-risk" : "text-aqua"} />
        <StatCell label="账户回撤" value={pct(circuit.account_drawdown ?? summary.max_drawdown)} note={`回测最大回撤 ${pct(summary.max_drawdown)}`} />
        <StatCell label="连续亏损" value={`${circuit.loss_streak ?? paperState?.consecutive_losses ?? 0} 笔`} note={`回测最大连亏 ${summary.max_consecutive_losses ?? "-"} 笔`} />
        <StatCell label="当日亏损" value={pct(circuit.daily_loss)} note={`阈值 ${pct(circuit.thresholds?.max_daily_loss_pct)}`} />
        <StatCell label="ATR 波动" value={pct(circuit.atr_pct)} note={`阈值 ${pct(circuit.thresholds?.max_atr_pct)}`} />
        <StatCell label="策略交易数" value={`${summary.trades ?? 0} 笔`} note={`胜率 ${pct(summary.win_rate)}`} />
      </div>
      {circuit.reasons?.length ? (
        <div className="mt-5 analysis-card">
          <h3 className="text-lg font-semibold text-white">阻断原因</h3>
          <div className="mt-3 event-list">
            {circuit.reasons.map((reason) => (
              <div key={reason} className="event-row"><span /><div><strong>Risk Block</strong><p>{reason}</p></div></div>
            ))}
          </div>
        </div>
      ) : null}
    </ViewShell>
  );
}

export function DataView({
  dataStatus,
  researchSnapshots,
  currentSnapshot,
  selectedSnapshot,
  detailLoading,
  dataRefreshLoading,
  dataRefreshResult,
  dataRefreshProgress,
  dataCompactLoading,
  dataCompactResult,
  dataRefreshBatchSize = 4,
  onDataRefreshBatchSizeChange,
  onCompactDataCache,
  onInspectSnapshot,
  onLoadSnapshot,
  onRefreshDataCache,
}) {
  const rows = dataStatus?.rows || [];
  const snapshots = researchSnapshots?.rows || [];
  const [snapshotFilter, setSnapshotFilter] = useState("all");
  const [dataFilter, setDataFilter] = useState("all");
  const [sortState, setSortState] = useState({ key: "created_at", direction: "desc" });
  const currentFile = currentSnapshot?.file || currentSnapshot?.path?.split("/").pop();
  const currentSummary = currentSnapshot?.portfolio?.summary || {};
  const currentHealth = currentSnapshot?.portfolio?.health || {};
  const currentReturn = metricNumber(currentSummary.return_pct);
  const currentDrawdown = metricNumber(currentSummary.max_drawdown);
  const currentHealthScore = metricNumber(currentHealth.score);
  const selectedFile = selectedSnapshot?.file || selectedSnapshot?.path?.split("/").pop();
  const candidateCount = snapshots.filter(isCandidateSnapshot).length;
  const fullCount = snapshots.filter((row) => row.mode !== "quick").length;
  const quickCount = snapshots.filter((row) => row.mode === "quick").length;
  const staleDataCount = rows.filter((row) => row.is_stale).length;
  const freshDataCount = rows.length - staleDataCount;
  const recommendedDataCount = rows.filter((row) => row.recommended_refresh).length;
  const compactableRows = rows.filter((row) => row.covered_by_fresh_cache && row.is_stale);
  const compactableKb = Math.round(compactableRows.reduce((sum, row) => sum + Number(row.size_bytes || 0), 0) / 1024);
  const visibleSnapshots = useMemo(() => {
    const filtered = snapshots.filter((row) => {
      if (snapshotFilter === "candidate") return isCandidateSnapshot(row);
      if (snapshotFilter === "full") return row.mode !== "quick";
      if (snapshotFilter === "quick") return row.mode === "quick";
      return true;
    });
    return [...filtered].sort(compareSnapshotRows(sortState.key, sortState.direction));
  }, [snapshotFilter, snapshots, sortState.direction, sortState.key]);
  const visibleDataRows = useMemo(() => rows.filter((row) => {
    if (dataFilter === "fresh") return !row.is_stale;
    if (dataFilter === "stale") return row.is_stale;
    if (dataFilter === "recommended") return row.recommended_refresh;
    return true;
  }).sort((left, right) => {
    if (dataFilter === "recommended") {
      const priorityDiff = Number(right.refresh_priority || 0) - Number(left.refresh_priority || 0);
      if (priorityDiff) return priorityDiff;
      const countDiff = Number(left.count || left.candles || 0) - Number(right.count || right.candles || 0);
      if (countDiff) return countDiff;
      return `${left.inst_id || ""}-${left.bar || ""}`.localeCompare(`${right.inst_id || ""}-${right.bar || ""}`);
    }
    return 0;
  }), [dataFilter, rows]);
  const refreshResultPreview = useMemo(() => (dataRefreshResult?.results || []).slice(0, 4).map((row) => {
    const target = `${row.inst_id || "-"} ${row.bar || "-"} ${row.count || "-"}`;
    return row.error ? `${target}：${row.error}` : target;
  }).join(" · "), [dataRefreshResult]);
  const compactResultPreview = useMemo(() => (dataCompactResult?.candidates || dataCompactResult?.deleted || []).slice(0, 4).map((row) => (
    `${row.inst_id || "-"} ${row.bar || "-"} ${row.count || "-"}`
  )).join(" · "), [dataCompactResult]);
  const activeRefreshProgress = dataRefreshLoading ? dataRefreshProgress : dataRefreshResult?.progress;
  const sortLabel = SNAPSHOT_SORTS[sortState.key]?.label || "时间";
  const toggleSort = (key) => {
    setSortState((current) => {
      const defaultDirection = SNAPSHOT_SORTS[key]?.direction || "desc";
      if (current.key !== key) return { key, direction: defaultDirection };
      return { key, direction: current.direction === "asc" ? "desc" : "asc" };
    });
  };
  return (
    <ViewShell title="数据" subtitle="本地 K 线缓存、组合回测结果缓存和数据新鲜度。">
      <div className="risk-grid">
        <StatCell label="K 线缓存文件" value={String(dataStatus?.files ?? "-")} note={dataStatus?.cache_dir || "-"} />
        <StatCell label="K 线新鲜度" value={`${freshDataCount}/${rows.length || 0}`} note={`${recommendedDataCount} 建议刷新 · ${staleDataCount} 陈旧`} tone={staleDataCount ? "text-risk" : "text-aqua"} />
        <StatCell label="可压缩缓存" value={String(compactableRows.length)} note={`约 ${compactableKb} KB · 覆盖复用`} tone={compactableRows.length ? "text-aqua" : "text-slate-400"} />
        <StatCell label="结果缓存" value={`${dataStatus?.portfolio_result_cache?.items ?? 0}/${dataStatus?.portfolio_result_cache?.max_items ?? 0}`} note={`${dataStatus?.portfolio_result_cache?.ttl_seconds ?? 0}s TTL`} />
        <StatCell label="研究快照" value={String(snapshots.length)} note={`${candidateCount} 候选 · ${fullCount} 全量 · ${quickCount} 快照`} />
        <StatCell label="当前基准" value={currentSnapshot?.label || currentFile || "-"} note={`${pct(currentReturn)} · 健康 ${currentHealth.grade || "-"} ${currentHealthScore === null ? "" : currentHealthScore.toFixed(0)}`} />
      </div>
      <div className="snapshot-toolbar">
        <div className="snapshot-filter-group" aria-label="研究快照筛选">
          {[
            ["all", "全部"],
            ["candidate", "候选"],
            ["full", "全量"],
            ["quick", "快速"],
          ].map(([key, label]) => (
            <button key={key} type="button" className={snapshotFilter === key ? "is-active" : ""} onClick={() => setSnapshotFilter(key)}>
              {label}
            </button>
          ))}
        </div>
        <div className="snapshot-sort-group" aria-label="研究快照排序">
          {Object.entries(SNAPSHOT_SORTS).map(([key, option]) => (
            <button key={key} type="button" className={sortState.key === key ? "is-active" : ""} onClick={() => toggleSort(key)}>
              {option.label}{sortState.key === key ? (sortState.direction === "asc" ? " ↑" : " ↓") : ""}
            </button>
          ))}
        </div>
        <p>{visibleSnapshots.length}/{snapshots.length} · 按{sortLabel}{sortState.direction === "asc" ? "升序" : "降序"}</p>
      </div>
      <div className="mt-5 overflow-x-auto rounded-[18px] border border-white/10">
        <table className="trade-table">
          <thead><tr><th>标签</th><th>模式</th><th>质量</th><th><button type="button" className={`sort-header ${sortState.key === "health_score" ? "is-active" : ""}`} onClick={() => toggleSort("health_score")}>健康 <em>{sortState.key === "health_score" ? (sortState.direction === "asc" ? "↑" : "↓") : ""}</em></button></th><th><button type="button" className={`sort-header ${sortState.key === "return_pct" ? "is-active" : ""}`} onClick={() => toggleSort("return_pct")}>收益 <em>{sortState.key === "return_pct" ? (sortState.direction === "asc" ? "↑" : "↓") : ""}</em></button></th><th><button type="button" className={`sort-header ${sortState.key === "max_drawdown" ? "is-active" : ""}`} onClick={() => toggleSort("max_drawdown")}>回撤 <em>{sortState.key === "max_drawdown" ? (sortState.direction === "asc" ? "↑" : "↓") : ""}</em></button></th><th>相对当前</th><th>权益</th><th>验证</th><th>操作</th></tr></thead>
          <tbody>
            {visibleSnapshots.length ? visibleSnapshots.slice(0, 8).map((row) => {
              const isCurrent = Boolean(currentFile && row.file === currentFile);
              const isSelected = Boolean(selectedFile && row.file === selectedFile);
              const rowReturn = metricNumber(row.return_pct);
              const rowDrawdown = metricNumber(row.max_drawdown);
              const rowHealth = metricNumber(row.health_score);
              const hasCurrentMetrics = currentReturn !== null || currentDrawdown !== null || currentHealthScore !== null;
              const quality = snapshotQuality(row);
              return (
              <tr key={row.file || row.path} className={`${isCurrent ? "is-current-row" : ""} ${isSelected ? "is-selected-row" : ""}`}>
                <td>{row.label || row.file || "-"}</td>
                <td>
                  <span className={`candidate-health ${row.mode === "full" ? "is-ok" : "is-risk"}`}>
                    {row.mode === "quick" ? "quick" : "full"}
                  </span>
                </td>
                <td><span className={`snapshot-quality ${quality.tone}`}>{quality.label}</span></td>
                <td>{row.health_grade || "-"} {Number.isFinite(Number(row.health_score)) ? Number(row.health_score).toFixed(0) : ""}</td>
                <td className={Number(row.return_pct || 0) >= 0 ? "text-aqua" : "text-risk"}>{pct(row.return_pct)}</td>
                <td>{pct(row.max_drawdown)}</td>
                <td>
                  {isCurrent ? (
                    <span className="snapshot-delta is-current">基准</span>
                  ) : hasCurrentMetrics ? (
                    <span className="snapshot-delta">
                      <DeltaLine label="收益" value={rowReturn !== null && currentReturn !== null ? rowReturn - currentReturn : null} />
                      <DeltaLine label="回撤" value={rowDrawdown !== null && currentDrawdown !== null ? rowDrawdown - currentDrawdown : null} lowerIsBetter />
                      <DeltaLine label="健康" value={rowHealth !== null && currentHealthScore !== null ? rowHealth - currentHealthScore : null} format="number" />
                    </span>
                  ) : "-"}
                </td>
                <td>{money(row.final_equity)}</td>
                <td>{row.readiness_decision || "-"}</td>
                <td>
                  <div className="table-actions">
                    <button type="button" className="table-action" onClick={() => onInspectSnapshot?.(row)} disabled={detailLoading && isSelected}>
                      {detailLoading && isSelected ? "读取中" : "详情"}
                    </button>
                    <button type="button" className="table-action" onClick={() => onLoadSnapshot?.(row)} disabled={isCurrent}>
                      {isCurrent ? "当前" : "加载"}
                    </button>
                  </div>
                </td>
              </tr>
            );
            }) : (
              <tr><td colSpan="10">{snapshots.length ? "没有符合筛选条件的研究快照。" : "暂无研究快照。"}</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <SnapshotDetailPanel snapshot={selectedSnapshot} currentSnapshot={currentSnapshot} loading={detailLoading} onLoadSnapshot={onLoadSnapshot} />
      <div className="snapshot-toolbar">
        <div className="snapshot-filter-group" aria-label="K线缓存筛选">
          {[
            ["all", "全部缓存"],
            ["recommended", "建议刷新"],
            ["fresh", "新鲜"],
            ["stale", "陈旧"],
          ].map(([key, label]) => (
            <button key={key} type="button" className={dataFilter === key ? "is-active" : ""} onClick={() => setDataFilter(key)}>
              {label}
            </button>
          ))}
        </div>
        <button type="button" className="table-action" onClick={() => onRefreshDataCache?.(null, true)} disabled={dataRefreshLoading || recommendedDataCount === 0}>
          {dataRefreshLoading ? "刷新中..." : `刷新建议项 x${dataRefreshBatchSize}`}
        </button>
        <button type="button" className="table-action" onClick={() => onRefreshDataCache?.()} disabled={dataRefreshLoading || staleDataCount === 0}>
          {dataRefreshLoading ? "刷新中..." : `刷新陈旧缓存 x${dataRefreshBatchSize}`}
        </button>
        <button type="button" className="table-action" onClick={() => onCompactDataCache?.(true)} disabled={dataCompactLoading || compactableRows.length === 0}>
          {dataCompactLoading ? "压缩中..." : "预览压缩"}
        </button>
        <button type="button" className="table-action" onClick={() => onCompactDataCache?.(false)} disabled={dataCompactLoading || compactableRows.length === 0}>
          {dataCompactLoading ? "压缩中..." : `压缩覆盖缓存 ${compactableRows.length}`}
        </button>
        <div className="snapshot-filter-group" aria-label="刷新批量大小">
          {[4, 8, 12].map((size) => (
            <button key={size} type="button" className={dataRefreshBatchSize === size ? "is-active" : ""} onClick={() => onDataRefreshBatchSizeChange?.(size)} disabled={dataRefreshLoading}>
              x{size}
            </button>
          ))}
        </div>
        <p>{visibleDataRows.length}/{rows.length} · 建议 {recommendedDataCount} · 新鲜 {freshDataCount} · 陈旧 {staleDataCount}</p>
      </div>
      {dataRefreshResult ? (
        <div className="data-refresh-result">
          <span>{dataRefreshResult.failed ? "部分刷新失败" : "刷新完成"}</span>
          <strong>{dataRefreshResult.ok ?? 0} 成功 / {dataRefreshResult.failed ?? 0} 失败 / {dataRefreshResult.skipped_covered ?? 0} 覆盖跳过</strong>
          <p>{refreshResultPreview || "无结果"}</p>
        </div>
      ) : null}
      {dataCompactResult ? (
        <div className="data-refresh-result">
          <span>{dataCompactResult.dry_run ? "压缩预览" : "压缩完成"}</span>
          <strong>{dataCompactResult.dry_run ? dataCompactResult.candidate_count : dataCompactResult.deleted_count} 项 / {dataCompactResult.kb ?? 0} KB</strong>
          <p>{compactResultPreview || "无可压缩缓存"}</p>
        </div>
      ) : null}
      {activeRefreshProgress ? (
        <div className="data-refresh-result">
          <span>{activeRefreshProgress.active ? "刷新进行中" : "最近刷新批次"}</span>
          <strong>{activeRefreshProgress.completed ?? 0}/{activeRefreshProgress.total ?? 0} · 成功 {activeRefreshProgress.ok ?? 0} · 失败 {activeRefreshProgress.failed ?? 0}</strong>
          <p>{activeRefreshProgress.current ? `${activeRefreshProgress.current.inst_id || "-"} ${activeRefreshProgress.current.bar || "-"} ${activeRefreshProgress.current.count || "-"}` : activeRefreshProgress.mode || "-"}</p>
        </div>
      ) : null}
      <div className="mt-5 overflow-x-auto rounded-[18px] border border-white/10">
        <table className="trade-table">
          <thead><tr><th>品种</th><th>周期</th><th>K线</th><th>最新确认</th><th>状态</th><th>优先级</th><th>刷新原因</th><th>诊断</th><th>大小</th><th>操作</th></tr></thead>
          <tbody>
            {visibleDataRows.slice(0, 12).map((row) => (
              <tr key={`${row.inst_id}-${row.bar}-${row.count}`}>
                <td>{row.inst_id}</td>
                <td>{row.bar}</td>
                <td>{row.candles}</td>
                <td>{row.latest_closed?.replace("T", " ").slice(0, 16) || "-"}</td>
                <td className={row.is_stale ? row.covered_by_fresh_cache ? "text-aqua" : "text-risk" : "text-aqua"}>{row.is_stale ? row.covered_by_fresh_cache ? "已覆盖" : "陈旧" : "新鲜"}</td>
                <td><span className={`snapshot-quality ${row.recommended_refresh ? "is-warn" : row.is_stale ? "is-info" : "is-good"}`}>{row.refresh_priority ?? 0}</span></td>
                <td>{row.refresh_reasons?.join(" / ") || "-"}</td>
                <td>{row.coverage_note || `${row.refresh_cost_label || "-"} · 阈值 ${row.stale_after_minutes || "-"}m`}</td>
                <td>{Math.round((row.size_bytes || 0) / 1024)} KB</td>
                <td>
                  <button type="button" className="table-action" onClick={() => onRefreshDataCache?.(row)} disabled={dataRefreshLoading}>
                    {dataRefreshLoading ? "刷新中" : "刷新"}
                  </button>
                </td>
              </tr>
            ))}
            {!visibleDataRows.length ? <tr><td colSpan="10">没有符合筛选条件的 K 线缓存。</td></tr> : null}
          </tbody>
        </table>
      </div>
    </ViewShell>
  );
}

export function PlaceholderView({ title }) {
  return (
    <ViewShell title={title} subtitle="该工作区已接入导航，具体操作面板待继续实现。">
      <div className="analysis-card">
        <h3 className="text-lg font-semibold text-white">待实现</h3>
        <p className="mt-2 text-sm text-slate-400">当前不会再表现为无响应。后续可以按这个入口继续接真实业务能力。</p>
      </div>
    </ViewShell>
  );
}
