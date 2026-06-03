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

function shortTime(value) {
  if (!value) return "-";
  return String(value).replace("T", " ").slice(0, 19);
}

function bytesLabel(value) {
  const bytes = Number(value || 0);
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

function diagnosticLabel(category) {
  const labels = {
    readonly_ok: "只读正常",
    missing_credentials: "缺少密钥",
    network_timeout: "网络超时",
    ip_not_allowed: "IP受限",
    permission_denied: "权限不足",
    auth_failed: "认证失败",
    timestamp_or_signature: "签名/时间",
    okx_rejected: "OKX拒绝",
  };
  return labels[category] || category || "-";
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

function checkValueLabel(row = {}) {
  const number = metricNumber(row.value);
  if (number === null) return valueLabel(row.value);
  const name = String(row.name || "");
  const threshold = String(row.threshold || "");
  if (threshold.includes("%")) return pct(number);
  if (name.includes("权益")) return `${money(number)}U`;
  if (Number.isInteger(number)) return String(number);
  return number.toFixed(2);
}

function readinessStatusLabel(row = {}) {
  if (row.passed) return "通过";
  if (row.status === "warn") return "观察";
  return "失败";
}

function readinessStatusTone(row = {}) {
  if (row.passed) return "is-good";
  if (row.status === "warn") return "is-warn";
  return "is-bad";
}

function readinessCheckRank(row = {}) {
  if (!row.passed) return row.status === "warn" ? 2 : 3;
  return 1;
}

function sortedReadinessChecks(checks = []) {
  return [...checks].sort((left, right) => {
    const rankDiff = readinessCheckRank(right) - readinessCheckRank(left);
    if (rankDiff) return rankDiff;
    return Number(right.weight || 0) - Number(left.weight || 0);
  });
}

function readinessEvidenceLabel(readiness, failedChecks, watchChecks) {
  if (!readiness) return "尚未生成准入证据";
  if (failedChecks.length) return `${failedChecks.length} 项失败阻断准入`;
  if (watchChecks.length) return `${watchChecks.length} 项观察，准入需保守执行`;
  if (String(readiness.decision || "").includes("允许")) return "准入证据通过";
  return readiness.decision || "准入证据待复核";
}

function readinessTone(value = "") {
  if (!value) return "";
  if (String(value).includes("允许")) return "text-aqua";
  if (String(value).includes("等待")) return "text-sky-300";
  return "text-risk";
}

function auditActionLabel(row = {}) {
  const action = String(row.action || "");
  if (action === "readiness_check") return "准入检查";
  if (action === "execution_dry_run") return "执行预演";
  if (action === "live_submit_rejected") return "实盘拒绝";
  if (action === "start") return "启动模拟";
  if (action === "stop") return "停止模拟";
  if (action === "scan") return "扫描";
  if (action.includes("open")) return "开仓扫描";
  if (action.includes("close")) return "平仓扫描";
  if (action.includes("no_open")) return "未开仓";
  return action || "-";
}

function auditResultLabel(row = {}) {
  const readiness = row.readiness || {};
  if (readiness.decision) return readiness.decision;
  if (row.live_submit?.decision) return row.live_submit.decision;
  const scan = row.scan || {};
  if (scan.decision) return scan.decision;
  const actions = row.actions || [];
  return actions.map((item) => item.reason || item.type).filter(Boolean).join(" / ") || "-";
}

function auditTimeLabel(value) {
  return value ? String(value).replace("T", " ").slice(0, 19) : "-";
}

function ledgerRowKey(row = {}, index = 0) {
  return `${row.time || index}-${row.event || "event"}-${row.intent_fingerprint || "no-fingerprint"}`;
}

function ledgerEventLabel(event) {
  if (event === "dry_run") return "预演";
  if (event === "live_submit_rejected") return "拒绝";
  return event || "-";
}

function ledgerStatusTone(row = {}) {
  if (row.duplicate_intent || row.status === "duplicate" || row.status === "rejected") return "is-bad";
  if (row.status === "candidate") return "is-info";
  if (row.status === "no_intent") return "is-warn";
  return "is-info";
}

function guardValueLabel(row = {}) {
  if (typeof row.value === "boolean") return row.value ? "开" : "关";
  return valueLabel(row.value, String(row.threshold || "").includes("%") ? "pct" : "");
}

function preflightSummary(executionPlan, okxDiagnostics, executionConfig) {
  const finalGate = executionPlan?.final_gate || {};
  const checks = finalGate.checks || [];
  const failedNames = checks.filter((row) => !row.passed).map((row) => row.name);
  const onlyLiveLocks = checks.length > 0 && checks.filter((row) => !row.passed).every((row) => row.severity === "live_lock");
  if (!executionPlan) {
    return { label: "未预演", note: "等待一键预演", tone: "text-slate-300" };
  }
  if (okxDiagnostics && !okxDiagnostics.readonly_ok) {
    return { label: "连接异常", note: diagnosticLabel(okxDiagnostics.category), tone: "text-risk" };
  }
  if (finalGate.allow_submit) {
    return { label: "可继续观察", note: "最终门槛通过", tone: "text-aqua" };
  }
  if (failedNames.includes("行情新鲜度")) {
    return { label: "数据陈旧", note: finalGate.blocked_reasons?.[0] || "行情新鲜度未通过", tone: "text-risk" };
  }
  if (!executionPlan.order_intent) {
    return { label: "等待信号", note: "当前没有 ready 订单意图", tone: "text-sky-300" };
  }
  if (failedNames.includes("账户最低权益") || failedNames.includes("保证金缓冲")) {
    return { label: "资金不足", note: finalGate.blocked_reasons?.[0] || "账户权益或保证金缓冲未通过", tone: "text-risk" };
  }
  if (failedNames.includes("交易所规则") || failedNames.includes("OKX payload")) {
    return { label: "规则不通过", note: finalGate.blocked_reasons?.[0] || "交易所规则或 payload 未通过", tone: "text-risk" };
  }
  if (onlyLiveLocks || !executionConfig?.live_trading_enabled) {
    return { label: "实盘锁定", note: "真实下单总锁仍关闭", tone: "text-sky-300" };
  }
  return { label: "需处理", note: finalGate.blocked_reasons?.[0] || "仍有阻断项", tone: "text-risk" };
}

function liveSubmitPath(executionPlan, executionConfig, okxDiagnostics, executionEnvironment) {
  const finalGate = executionPlan?.final_gate || {};
  const finalChecks = finalGate.checks || [];
  const dataQuality = executionPlan?.data_quality || {};
  const intent = executionPlan?.order_intent;
  const exchangeValidation = executionPlan?.exchange_rules?.validation || {};
  const positionCount = Number(finalGate.okx_position_count ?? executionEnvironment?.position_count ?? 0);
  const findCheck = (name) => finalChecks.find((row) => row.name === name);
  const okxReadonlyCheck = findCheck("OKX只读连通");
  const liveLockCheck = findCheck("实盘总开关");
  const hardFailure = finalChecks.find((row) => !row.passed && row.severity !== "live_lock");
  const rows = [
    {
      key: "credentials",
      label: "密钥配置",
      status: executionConfig?.okx_configured ? "pass" : "fail",
      detail: executionConfig?.okx_configured ? "OKX API Key / Secret / Passphrase 已配置" : "缺少 OKX 会话密钥",
    },
    {
      key: "readonly",
      label: "只读账户",
      status: okxDiagnostics?.readonly_ok || okxReadonlyCheck?.passed ? "pass" : okxDiagnostics || okxReadonlyCheck ? "fail" : "pending",
      detail: okxDiagnostics?.readonly_ok || okxReadonlyCheck?.passed ? "账户余额接口可读" : diagnosticLabel(okxDiagnostics?.category) || okxReadonlyCheck?.action || "等待诊断",
    },
    {
      key: "data",
      label: "行情新鲜度",
      status: executionPlan ? dataQuality.ok ? "pass" : "fail" : "pending",
      detail: executionPlan ? `${dataQuality.source || "-"} · ${dataQuality.latest_closed || "无最新K线"}` : "等待执行预演",
    },
    {
      key: "intent",
      label: "订单意图",
      status: intent ? "pass" : executionPlan ? "warn" : "pending",
      detail: intent ? `${intent.side || "-"} ${money(intent.notional)}U @ ${money(intent.entry)}` : executionPlan ? "当前没有 ready 信号" : "等待执行预演",
    },
    {
      key: "exchange",
      label: "交易所规则",
      status: executionPlan ? exchangeValidation.ok ? "pass" : "fail" : "pending",
      detail: exchangeValidation.message || "等待 OKX 规则校验",
    },
    {
      key: "positions",
      label: "真实持仓",
      status: positionCount > 0 ? "fail" : executionPlan || executionEnvironment ? "pass" : "pending",
      detail: `${Number.isFinite(positionCount) ? positionCount : 0} 个 SWAP 持仓`,
    },
    {
      key: "live_lock",
      label: "实盘总锁",
      status: executionConfig?.live_trading_enabled ? "pass" : liveLockCheck ? "warn" : "pending",
      detail: executionConfig?.live_trading_enabled ? "LIVE_TRADING_ENABLED 已开启" : "默认保持关闭，只允许 dry-run 和锁测试",
    },
  ];
  if (!executionConfig?.okx_configured) {
    return { label: "先配置密钥", note: "输入 OKX 会话密钥后运行诊断", tone: "text-risk", rows };
  }
  if (okxDiagnostics && !okxDiagnostics.readonly_ok) {
    return { label: "先修复连接", note: diagnosticLabel(okxDiagnostics.category), tone: "text-risk", rows };
  }
  if (!executionPlan) {
    return { label: "先做预演", note: "运行一键预演生成提交路径", tone: "text-sky-300", rows };
  }
  if (!dataQuality.ok) {
    return { label: "先刷新行情", note: finalGate.blocked_reasons?.[0] || "行情新鲜度未通过", tone: "text-risk", rows };
  }
  if (!intent) {
    return { label: "等待信号", note: "没有订单意图时不会进入提交", tone: "text-sky-300", rows };
  }
  if (hardFailure) {
    return { label: "阻断提交", note: hardFailure.action || hardFailure.name, tone: "text-risk", rows };
  }
  if (!executionConfig?.live_trading_enabled) {
    return { label: "锁定正常", note: "所有硬门槛通过后仍由实盘总锁拦截", tone: "text-sky-300", rows };
  }
  return { label: finalGate.allow_submit ? "可二次确认" : "继续复核", note: finalGate.decision || "等待最终门槛", tone: finalGate.allow_submit ? "text-aqua" : "text-risk", rows };
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

function barDurationMs(bar = "15m") {
  const value = String(bar);
  if (value.endsWith("m")) return Number(value.replace("m", "")) * 60 * 1000;
  if (value.endsWith("H")) return Number(value.replace("H", "")) * 60 * 60 * 1000;
  if (value.endsWith("D")) return Number(value.replace("D", "")) * 24 * 60 * 60 * 1000;
  return 15 * 60 * 1000;
}

function candleTimeLabel(value) {
  return value ? String(value).replace("T", " ").slice(0, 16) : "-";
}

function average(values = []) {
  const valid = values.map(Number).filter(Number.isFinite);
  if (!valid.length) return null;
  return valid.reduce((sum, value) => sum + value, 0) / valid.length;
}

function movingAverage(candles = [], period = 20) {
  if (candles.length < period) return null;
  return average(candles.slice(-period).map((row) => row.close));
}

function windowReturn(candles = [], bars = 24) {
  if (candles.length <= bars) return null;
  const latest = Number(candles[candles.length - 1]?.close);
  const start = Number(candles[candles.length - 1 - bars]?.close);
  if (!Number.isFinite(latest) || !Number.isFinite(start) || start <= 0) return null;
  return (latest - start) / start;
}

function avgRangePct(candles = [], bars = 24) {
  const rows = candles.slice(-bars);
  return average(rows.map((row) => {
    const close = Number(row.close);
    if (!Number.isFinite(close) || close <= 0) return null;
    return (Number(row.high || 0) - Number(row.low || 0)) / close;
  }));
}

function marketTone(status = "") {
  if (["多头", "放量", "正常", "新鲜", "顺势"].some((text) => status.includes(text))) return "text-aqua";
  if (["震荡", "低波", "缩量", "等待", "观察"].some((text) => status.includes(text))) return "text-sky-300";
  return "text-risk";
}

function marketEvidenceTone(status = "") {
  if (status === "pass") return "is-good";
  if (status === "watch") return "is-info";
  if (status === "warn") return "is-warn";
  return "is-bad";
}

function marketEvidenceLabel(status = "") {
  if (status === "pass") return "通过";
  if (status === "watch") return "观察";
  if (status === "warn") return "注意";
  return "阻断";
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

function dashboardSignalAdvice(scan = {}) {
  const reasons = scan.reasons || [];
  const joined = reasons.join(" / ");
  if (!scan.status) return "等待模拟盘或手动扫描生成信号状态。";
  if (scan.status === "ready") return "已有 ready 信号，可进入实盘分支做 dry-run 和最终门槛复核。";
  if (scan.status === "watch") return "有候选形态，等待下一根 K 线确认。";
  if (joined.includes("未触发价格行为形态")) return "继续等待价格行为形态，当前不建议放宽风控。";
  return joined || scan.decision || "等待下一次扫描。";
}

function dashboardStateTone(state = "") {
  if (["正常", "运行中", "新鲜", "已连接", "允许", "可用"].some((text) => String(state).includes(text))) return "text-aqua";
  if (["等待", "锁定", "观察", "未预演"].some((text) => String(state).includes(text))) return "text-sky-300";
  return "text-risk";
}

function dashboardSignalLabel(status = "") {
  if (status === "ready") return "Ready";
  if (status === "watch") return "待确认";
  if (status === "blocked") return "过滤";
  if (status === "error") return "错误";
  return status || "-";
}

function riskUsage(value, threshold) {
  const current = metricNumber(value);
  const limit = metricNumber(threshold);
  if (current === null || limit === null || limit <= 0) return null;
  return Math.max(0, current / limit);
}

function riskUsageStatus(usage) {
  if (usage === null || usage === undefined) return { label: "未知", tone: "is-info", textTone: "text-sky-300" };
  if (usage >= 1) return { label: "熔断", tone: "is-bad", textTone: "text-risk" };
  if (usage >= 0.8) return { label: "危险", tone: "is-bad", textTone: "text-risk" };
  if (usage >= 0.6) return { label: "观察", tone: "is-warn", textTone: "text-sky-300" };
  return { label: "正常", tone: "is-good", textTone: "text-aqua" };
}

function riskAction(row) {
  if (row.usage === null || row.usage === undefined) return "等待更多运行数据。";
  if (row.usage >= 1) return row.blockAction || "暂停开仓，等待熔断恢复。";
  if (row.usage >= 0.8) return row.warnAction || "降低风险，避免继续逼近阈值。";
  if (row.usage >= 0.6) return row.watchAction || "维持观察，下一次信号前复核。";
  return row.okAction || "保持当前参数。";
}

function RiskMeter({ usage, tone }) {
  const percent = Math.max(0, Math.min(1.2, Number(usage || 0))) * 100;
  const status = riskUsageStatus(usage);
  return (
    <div className="risk-meter">
      <span style={{ width: `${Math.min(percent, 100)}%` }} className={tone || status.tone} />
    </div>
  );
}

function ReadinessEvidencePanel({ readiness, riskRows, loading, onRunReadiness }) {
  const checks = sortedReadinessChecks(readiness?.checks || []);
  const failedChecks = checks.filter((row) => !row.passed && row.status !== "warn");
  const watchChecks = checks.filter((row) => !row.passed && row.status === "warn");
  const passedChecks = checks.filter((row) => row.passed);
  const robustness = readiness?.robustness?.aggregate || {};
  const monteCarlo = readiness?.monte_carlo?.summary || {};
  const signalState = readiness?.signal_state || {};
  const hotRisks = (riskRows || []).filter((row) => row.normalizedUsage !== null && row.normalizedUsage >= 0.6);
  const evidenceLabel = readinessEvidenceLabel(readiness, failedChecks, watchChecks);
  const firstAction = failedChecks[0]?.action || watchChecks[0]?.action || readiness?.next_action || "保持观察并等待下一次信号。";
  const rawPayload = readiness ? {
    decision: readiness.decision,
    score: readiness.score,
    risk_level: readiness.risk_level,
    next_action: readiness.next_action,
    failed_checks: failedChecks.map((row) => row.name),
    watch_checks: watchChecks.map((row) => row.name),
    robustness,
    monte_carlo: monteCarlo,
    signal_state: signalState,
    hot_risks: hotRisks.map((row) => ({ name: row.name, status: row.status.label, usage: row.normalizedUsage })),
  } : {
    decision: null,
    next_action: "运行准入检查生成证据矩阵。",
    hot_risks: hotRisks.map((row) => ({ name: row.name, status: row.status.label, usage: row.normalizedUsage })),
  };

  return (
    <div className="mt-5 analysis-card readiness-evidence-panel">
      <div className="readiness-evidence-header">
        <div>
          <p className="text-xs uppercase tracking-[0.28em] text-slate-500">Admission Evidence</p>
          <h3 className="text-lg font-semibold text-white">准入证据矩阵</h3>
          <p>{evidenceLabel} · {firstAction}</p>
        </div>
        <div className="readiness-evidence-actions">
          <span className={`candidate-health ${failedChecks.length ? "is-risk" : watchChecks.length ? "is-info" : readiness ? "is-ok" : "is-info"}`}>
            {readiness?.score === undefined ? "待检查" : `${readiness.score}/100`}
          </span>
          <button type="button" className="table-action" onClick={() => onRunReadiness?.()} disabled={loading}>
            {loading ? "检查中..." : readiness ? "重新检查" : "运行检查"}
          </button>
        </div>
      </div>
      <div className="readiness-evidence-grid">
        <StatCell label="失败项" value={String(failedChecks.length)} note={failedChecks[0]?.name || "无硬阻断"} tone={failedChecks.length ? "text-risk" : "text-aqua"} />
        <StatCell label="观察项" value={String(watchChecks.length)} note={watchChecks[0]?.name || "无观察项"} tone={watchChecks.length ? "text-sky-300" : "text-aqua"} />
        <StatCell label="通过项" value={`${passedChecks.length}/${checks.length || 0}`} note={readiness?.decision || "等待准入结论"} tone={failedChecks.length ? "text-risk" : readiness ? "text-aqua" : "text-sky-300"} />
        <StatCell label="滚动稳健" value={pct(readiness?.rolling_ratio)} note={`${robustness.rolling_positive_cases ?? "-"} / ${robustness.rolling_cases ?? "-"} 窗口`} />
        <StatCell label="MC 尾部" value={pct(monteCarlo.loss_probability)} note={`P95 DD ${pct(monteCarlo.p95_max_drawdown)}`} tone={Number(monteCarlo.loss_probability || 0) <= 0.02 ? "text-aqua" : "text-risk"} />
        <StatCell label="信号状态" value={`${signalState.ready ?? 0}/${signalState.watch ?? 0}`} note={`过滤 ${signalState.blocked ?? 0} · 错误 ${signalState.errors ?? 0}`} />
      </div>
      <div className="mt-4 overflow-x-auto rounded-[18px] border border-white/10">
        <table className="trade-table">
          <thead><tr><th>优先级</th><th>证据项</th><th>当前值</th><th>门槛</th><th>权重</th><th>状态</th><th>处理动作</th></tr></thead>
          <tbody>
            {checks.length ? checks.map((row, index) => (
              <tr key={`evidence-${row.name}`}>
                <td>{index + 1}</td>
                <td>{row.name}</td>
                <td>{checkValueLabel(row)}</td>
                <td>{row.threshold || "-"}</td>
                <td>{row.weight ?? "-"}</td>
                <td><span className={`snapshot-quality ${readinessStatusTone(row)}`}>{readinessStatusLabel(row)}</span></td>
                <td>{row.action || "-"}</td>
              </tr>
            )) : (
              <tr><td colSpan="7">还没有准入证据。运行准入检查后会按失败、观察、通过排序。</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="readiness-evidence-detail">
        <div>
          <span>ROLLING</span>
          <strong>{robustness.rolling_cases === undefined ? "-" : `${robustness.rolling_positive_cases ?? 0}/${robustness.rolling_cases}`}</strong>
          <p>滚动窗口用于判断参数是否只适配单一历史片段。</p>
        </div>
        <div>
          <span>MONTE CARLO</span>
          <strong>{pct(monteCarlo.loss_probability)}</strong>
          <p>尾部亏损概率和 P95 回撤用于控制小资金账户破产风险。</p>
        </div>
        <div>
          <span>RISK PRESSURE</span>
          <strong>{hotRisks.length ? `${hotRisks.length} 项` : "正常"}</strong>
          <p>{hotRisks[0] ? `${hotRisks[0].name} · ${hotRisks[0].status.label}` : "压力表没有接近阈值的项目。"}</p>
        </div>
      </div>
      <div className="ledger-json-panel">
        <span>Readiness Evidence JSON</span>
        <pre>{JSON.stringify(rawPayload, null, 2)}</pre>
      </div>
    </div>
  );
}

function dataAgeLabel(seconds) {
  const value = metricNumber(seconds);
  if (value === null) return "-";
  if (value < 60) return `${Math.round(value)} 秒`;
  if (value < 3600) return `${Math.round(value / 60)} 分钟`;
  if (value < 86400) return `${(value / 3600).toFixed(value >= 7200 ? 0 : 1)} 小时`;
  return `${(value / 86400).toFixed(1)} 天`;
}

function dataHealthScore(rows = []) {
  if (!rows.length) return 0;
  const staleCount = rows.filter((row) => row.is_stale && !row.covered_by_fresh_cache).length;
  const recommendedCount = rows.filter((row) => row.recommended_refresh).length;
  const coveredCount = rows.filter((row) => row.is_stale && row.covered_by_fresh_cache).length;
  const highPriority = rows.filter((row) => Number(row.refresh_priority || 0) >= 60).length;
  const penalty = staleCount * 12 + recommendedCount * 8 + highPriority * 6 + coveredCount * 2;
  return Math.max(0, Math.min(100, Math.round(100 - penalty)));
}

function dataHealthStatus(score) {
  if (score >= 86) return { label: "健康", tone: "text-aqua", badge: "is-good" };
  if (score >= 68) return { label: "需维护", tone: "text-sky-300", badge: "is-warn" };
  return { label: "需刷新", tone: "text-risk", badge: "is-bad" };
}

function taskTypeLabel(type = "") {
  const labels = {
    data_refresh: "数据刷新",
    compact_cache: "缓存压缩",
    joint_optimize: "联合优化",
    attribution_experiments: "风险实验",
    readiness: "准入检查",
  };
  return labels[type] || type || "-";
}

function taskStatusLabel(status = "") {
  const labels = {
    queued: "排队",
    running: "运行中",
    completed: "完成",
    failed: "失败",
    cancelled: "已取消",
  };
  return labels[status] || status || "-";
}

function taskStatusTone(status = "") {
  if (status === "completed") return "is-good";
  if (status === "running" || status === "queued") return "is-info";
  if (status === "cancelled") return "is-warn";
  return "is-bad";
}

function taskProgressLabel(task = {}) {
  const progress = task.progress || {};
  const total = Number(progress.total || 0);
  const completed = Number(progress.completed || 0);
  if (total) return `${completed}/${total}`;
  if (task.status === "completed") return "完成";
  if (task.status === "running") return "运行中";
  return "-";
}

function taskResultRows(task = {}) {
  const result = task.result || {};
  if (task.error) {
    return [
      { label: "错误", value: task.error, note: "任务执行失败" },
    ];
  }
  if (!task.result) {
    return [
      { label: "状态", value: taskStatusLabel(task.status), note: "等待任务返回结果" },
      { label: "进度", value: taskProgressLabel(task), note: task.progress?.current?.inst_id || "-" },
    ];
  }
  if (task.type === "data_refresh") {
    return [
      { label: "成功", value: String(result.ok ?? 0), note: `${result.failed ?? 0} 失败` },
      { label: "覆盖跳过", value: String(result.skipped_covered ?? 0), note: result.mode || "refresh" },
      { label: "结果数", value: String((result.results || []).length), note: (result.results || []).slice(0, 2).map((row) => `${row.inst_id || "-"} ${row.bar || ""}`).join(" / ") || "-" },
    ];
  }
  if (task.type === "compact_cache") {
    return [
      { label: result.dry_run ? "候选" : "已删除", value: String(result.dry_run ? result.candidate_count ?? 0 : result.deleted_count ?? 0), note: result.dry_run ? "压缩预览" : "压缩完成" },
      { label: "空间", value: `${result.kb ?? 0} KB`, note: "覆盖缓存" },
      { label: "跳过", value: String(result.skipped_count ?? 0), note: (result.skipped || []).slice(0, 1).map((row) => row.error).filter(Boolean).join(" / ") || "-" },
    ];
  }
  if (task.type === "joint_optimize") {
    const best = result.best || result.top?.[0] || {};
    return [
      { label: "首选", value: best.params?.strategy_mode || "-", note: `Score ${Number(best.score || 0).toFixed(3)}` },
      { label: "收益", value: pct(best.summary?.return_pct), note: `回撤 ${pct(best.summary?.max_drawdown)}` },
      { label: "候选", value: String((result.top || []).length), note: result.dedup?.raw ? `去重 ${result.dedup.raw} -> ${result.dedup.unique}` : "-" },
    ];
  }
  if (task.type === "attribution_experiments") {
    const summary = result.summary || {};
    const best = result.rows?.[0] || {};
    return [
      { label: "首选方案", value: summary.best_name || best.name || "-", note: `Score ${Number(summary.best_score ?? best.score ?? 0).toFixed(3)}` },
      { label: "收益/回撤", value: pct(summary.best_return_pct ?? best.summary?.return_pct), note: `DD ${pct(summary.best_drawdown ?? best.summary?.max_drawdown)}` },
      { label: "方案数", value: String(summary.cases ?? (result.rows || []).length), note: summary.best_stress_worst === undefined ? "-" : `压力 ${pct(summary.best_stress_worst)}` },
    ];
  }
  if (task.type === "readiness") {
    return [
      { label: "结论", value: result.decision || "-", note: result.next_action || "-" },
      { label: "评分", value: result.score === undefined ? "-" : `${result.score}/100`, note: `风险 ${result.risk_level || "-"}` },
      { label: "检查项", value: String((result.checks || []).filter((row) => row.passed).length), note: `共 ${(result.checks || []).length} 项` },
    ];
  }
  return [
    { label: "结果", value: "已有结果", note: Object.keys(result).slice(0, 4).join(" / ") || "-" },
  ];
}

function taskDetailItems(task = {}) {
  const result = task.result || {};
  if (task.type === "data_refresh") return result.results || [];
  if (task.type === "compact_cache") return result.deleted || result.candidates || result.skipped || [];
  if (task.type === "joint_optimize") return result.top || [];
  if (task.type === "attribution_experiments") return result.rows || [];
  if (task.type === "readiness") return result.checks || [];
  return [];
}

function taskDetailItemLabel(task, item = {}, index = 0) {
  if (task.type === "data_refresh" || task.type === "compact_cache") {
    return `${item.inst_id || "-"} ${item.bar || "-"} ${item.count || item.candles || "-"}`;
  }
  if (task.type === "joint_optimize") return item.name || item.params?.strategy_mode || `候选 ${index + 1}`;
  if (task.type === "attribution_experiments") return item.name || `方案 ${index + 1}`;
  if (task.type === "readiness") return item.name || `检查 ${index + 1}`;
  return item.name || item.id || `项目 ${index + 1}`;
}

function taskDetailItemStatus(task, item = {}) {
  if (item.error) return { label: "失败", tone: "is-bad", detail: item.error };
  if (task.type === "data_refresh") return { label: item.is_stale ? "陈旧" : "成功", tone: item.is_stale ? "is-warn" : "is-good", detail: item.latest_closed || item.source || "-" };
  if (task.type === "compact_cache") return { label: item.error ? "跳过" : "完成", tone: item.error ? "is-warn" : "is-good", detail: item.path || item.file || "-" };
  if (task.type === "readiness") return { label: item.passed ? "通过" : readinessStatusLabel(item), tone: item.passed ? "is-good" : "is-bad", detail: item.action || item.threshold || "-" };
  return { label: item.status || item.decision || "结果", tone: "is-info", detail: item.reason || item.note || "-" };
}

function dataRowKey(row = {}) {
  return `${row.inst_id || "-"}-${row.bar || "-"}-${row.count || row.candles || "-"}`;
}

function TaskDetailPanel({ task }) {
  if (!task) {
    return (
      <div className="task-detail-panel">
        <div className="task-detail-empty">选择一个后台任务查看参数、进度和结果摘要。</div>
      </div>
    );
  }
  const rows = taskResultRows(task);
  const params = task.params || {};
  const progress = task.progress || {};
  const detailItems = taskDetailItems(task).slice(0, 8);
  return (
    <div className="task-detail-panel">
      <div className="task-detail-header">
        <div>
          <span>任务详情</span>
          <h4>{taskTypeLabel(task.type)} · {taskStatusLabel(task.status)}</h4>
          <p>{task.id || "-"} · {(task.updated_at || task.created_at || "").replace("T", " ").slice(0, 19) || "-"}</p>
        </div>
        <span className={`snapshot-quality ${taskStatusTone(task.status)}`}>{taskProgressLabel(task)}</span>
      </div>
      <div className="task-detail-grid">
        {rows.map((row) => (
          <div key={row.label}>
            <span>{row.label}</span>
            <strong>{row.value}</strong>
            <p>{row.note}</p>
          </div>
        ))}
      </div>
      <div className="task-detail-meta">
        <div>
          <span>参数</span>
          <p>{Object.entries(params).slice(0, 8).map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(",") : String(value)}`).join(" · ") || "-"}</p>
        </div>
        <div>
          <span>进度</span>
          <p>{progress.current ? `${progress.current.inst_id || "-"} ${progress.current.bar || ""} ${progress.current.count || ""}` : task.error || taskStatusLabel(task.status)}</p>
        </div>
      </div>
      <div className="overflow-x-auto rounded-[16px] border border-white/10">
        <table className="trade-table">
          <thead><tr><th>结果明细</th><th>状态</th><th>说明</th></tr></thead>
          <tbody>
            {detailItems.length ? detailItems.map((item, index) => {
              const status = taskDetailItemStatus(task, item);
              return (
                <tr key={`${task.id}-${index}-${taskDetailItemLabel(task, item, index)}`}>
                  <td>{taskDetailItemLabel(task, item, index)}</td>
                  <td><span className={`snapshot-quality ${status.tone}`}>{status.label}</span></td>
                  <td>{status.detail}</td>
                </tr>
              );
            }) : (
              <tr><td colSpan="3">暂无逐项结果。任务完成后会显示刷新、压缩或检查明细。</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="ledger-json-panel">
        <span>Task Raw JSON</span>
        <pre>{JSON.stringify({
          id: task.id,
          type: task.type,
          status: task.status,
          params,
          progress,
          result: task.result,
          error: task.error,
        }, null, 2)}</pre>
      </div>
    </div>
  );
}

export function DashboardView({
  market,
  candles,
  portfolio,
  paperState,
  readiness,
  executionPlan,
  executionConfig,
  executionEnvironment,
  okxDiagnostics,
  dataStatus,
  paperAudit,
  refreshAllLoading,
  signalScanLoading,
  preflightLoading,
  onRefreshAll,
  onOpenView,
  onRunSignalScan,
  onRunLivePreflight,
}) {
  const latest = latestCandle(candles);
  const previous = candles?.[candles.length - 2];
  const changePct = latest && previous ? (Number(latest.close) - Number(previous.close)) / Math.max(Number(previous.close), 1e-9) : null;
  const summary = portfolio?.summary || {};
  const health = portfolio?.health || {};
  const signalScan = paperState?.signal_log?.[0] || {};
  const dataRows = dataStatus?.rows || [];
  const staleRows = dataRows.filter((row) => row.is_stale);
  const recommendedRows = dataRows.filter((row) => row.recommended_refresh);
  const preflight = preflightSummary(executionPlan, okxDiagnostics, executionConfig);
  const submitPath = liveSubmitPath(executionPlan, executionConfig, okxDiagnostics, executionEnvironment);
  const recentAuditRows = paperAudit?.rows || [];
  const branchRows = [
    {
      name: "市场",
      state: latest ? "新鲜行情" : "等待行情",
      detail: `${market.instId?.replace("-SWAP", "") || "-"} · ${market.bar} · ${candleTimeLabel(latest?.time)}`,
      next: "查看区间、量能和最近K线",
    },
    {
      name: "策略",
      state: signalScan.status === "ready" ? "允许" : signalScan.status === "watch" ? "观察" : signalScan.status ? "等待" : "待扫描",
      detail: signalScan.decision || dashboardSignalAdvice(signalScan),
      next: dashboardSignalAdvice(signalScan),
    },
    {
      name: "回测",
      state: summary.trades ? "有结果" : "待运行",
      detail: `收益 ${pct(summary.return_pct)} · 回撤 ${pct(summary.max_drawdown)} · 交易 ${summary.trades ?? 0}`,
      next: "复盘交易或生成实验回测",
    },
    {
      name: "风控",
      state: paperState?.circuit_breaker?.allow_trade === false ? "阻断" : "正常",
      detail: `日内 ${paperState?.day_trades ?? 0} 笔 · 连亏 ${paperState?.consecutive_losses ?? 0}`,
      next: paperState?.circuit_breaker?.reasons?.[0] || readiness?.next_action || "保持熔断监控",
    },
    {
      name: "实盘",
      state: submitPath.label,
      detail: submitPath.note,
      next: executionConfig?.okx_configured ? "运行一键预演" : "先配置 OKX 会话密钥",
    },
    {
      name: "数据",
      state: staleRows.length ? "需维护" : "正常",
      detail: `${dataRows.length || 0} 个缓存 · ${recommendedRows.length} 建议刷新`,
      next: staleRows.length ? "刷新陈旧 K 线缓存" : "缓存状态正常",
    },
  ];
  const nextActions = [
    {
      title: "信号状态",
      detail: dashboardSignalAdvice(signalScan),
      action: signalScan.status === "ready" ? "进入实盘" : "立即扫描",
      view: signalScan.status === "ready" ? "实盘" : "策略",
      onClick: signalScan.status === "ready" ? () => onOpenView?.("实盘") : onRunSignalScan,
      loading: signalScanLoading,
    },
    {
      title: "实盘提交路径",
      detail: `${submitPath.label} · ${submitPath.note}`,
      action: executionConfig?.okx_configured ? "一键预演" : "配置密钥",
      view: "实盘",
      onClick: executionConfig?.okx_configured ? onRunLivePreflight : () => onOpenView?.("实盘"),
      loading: preflightLoading,
    },
    {
      title: "数据维护",
      detail: staleRows.length ? `${staleRows.length} 个陈旧缓存，${recommendedRows.length} 个建议刷新。` : "K 线缓存当前没有明显陈旧项。",
      action: "打开数据",
      view: "数据",
      onClick: () => onOpenView?.("数据"),
    },
  ];
  return (
    <ViewShell title="仪表盘" subtitle="项目运行驾驶舱，汇总行情、策略、回测、风控、实盘和数据状态。">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          <button type="button" className="table-action" onClick={() => onRefreshAll?.()} disabled={refreshAllLoading}>
            {refreshAllLoading ? "刷新中..." : "刷新总览"}
          </button>
          <button type="button" className="table-action" onClick={() => onOpenView?.("实盘")}>实盘门槛</button>
          <button type="button" className="table-action" onClick={() => onOpenView?.("回测")}>交易复盘</button>
        </div>
      </div>
      <div className="risk-grid">
        <StatCell label="当前行情" value={money(latest?.close)} note={`${market.instId?.replace("-SWAP", "") || "-"} · ${signedPct(changePct)}`} tone={Number(changePct || 0) >= 0 ? "text-aqua" : "text-risk"} />
        <StatCell label="模拟盘" value={paperState?.running ? "运行中" : "已停止"} note={`权益 ${money(paperState?.equity)}U · 日内 ${paperState?.day_trades ?? 0}`} tone={paperState?.running ? "text-aqua" : "text-sky-300"} />
        <StatCell label="回测健康" value={`${health.grade || "-"} ${Number.isFinite(Number(health.score)) ? Number(health.score).toFixed(0) : ""}`} note={`收益 ${pct(summary.return_pct)} · 交易 ${summary.trades ?? 0}`} tone={Number(health.score || 0) >= 62 ? "text-aqua" : "text-risk"} />
        <StatCell label="当前信号" value={dashboardSignalLabel(signalScan.status)} note={signalScan.reasons?.[0] || signalScan.decision || "等待扫描"} tone={signalScan.status === "ready" ? "text-aqua" : signalScan.status === "blocked" ? "text-risk" : "text-sky-300"} />
        <StatCell label="实盘路径" value={submitPath.label} note={submitPath.note} tone={submitPath.tone} />
        <StatCell label="数据缓存" value={`${dataRows.length - staleRows.length}/${dataRows.length || 0}`} note={`${recommendedRows.length} 建议刷新 · ${staleRows.length} 陈旧`} tone={staleRows.length ? "text-risk" : "text-aqua"} />
      </div>
      <div className="mt-5 analysis-card">
        <div className="mb-4">
          <h3 className="text-lg font-semibold text-white">分支状态</h3>
          <p className="mt-1 text-xs text-slate-500">每个导航分支的当前状态、关键信息和建议下一步。</p>
        </div>
        <div className="overflow-x-auto rounded-[18px] border border-white/10">
          <table className="trade-table">
            <thead><tr><th>分支</th><th>状态</th><th>重点</th><th>下一步</th><th>操作</th></tr></thead>
            <tbody>
              {branchRows.map((row) => (
                <tr key={row.name}>
                  <td>{row.name}</td>
                  <td className={dashboardStateTone(row.state)}>{row.state}</td>
                  <td>{row.detail}</td>
                  <td>{row.next}</td>
                  <td><button type="button" className="table-action" onClick={() => onOpenView?.(row.name)}>打开</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="mt-5 grid gap-5 xl:grid-cols-[.9fr_1.1fr]">
        <div className="analysis-card">
          <h3 className="text-lg font-semibold text-white">下一步动作</h3>
          <div className="mt-4 event-list">
            {nextActions.map((item) => (
              <div className="event-row" key={item.title}>
                <span className={`preflight-dot is-${item.loading ? "running" : "pending"}`} />
                <div>
                  <strong>{item.title}</strong>
                  <p>{item.detail}</p>
                  <button type="button" className="mt-2 table-action" onClick={item.onClick || (() => onOpenView?.(item.view))} disabled={item.loading}>
                    {item.loading ? "处理中..." : item.action}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="analysis-card">
          <h3 className="text-lg font-semibold text-white">最近审计</h3>
          <div className="mt-4 overflow-x-auto rounded-[18px] border border-white/10">
            <table className="trade-table">
              <thead><tr><th>时间</th><th>动作</th><th>结果</th><th>权益</th></tr></thead>
              <tbody>
                {recentAuditRows.length ? recentAuditRows.slice(0, 6).map((row, index) => (
                  <tr key={`${row.time || index}-${row.action || ""}`}>
                    <td>{auditTimeLabel(row.time)}</td>
                    <td>{auditActionLabel(row)}</td>
                    <td>{auditResultLabel(row)}</td>
                    <td>{money(row.equity_after ?? row.equity_before)}U</td>
                  </tr>
                )) : (
                  <tr><td colSpan="4">暂无审计记录。</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </ViewShell>
  );
}

export function MarketView({
  candles,
  market,
  portfolio,
  candleLoading,
  dataRefreshLoading,
  signalScanLoading,
  onRefreshCandles,
  onRefreshMarketCache,
  onOpenView,
  onRunSignalScan,
}) {
  const latest = latestCandle(candles);
  const previous = candles?.[candles.length - 2];
  const change = latest && previous ? Number(latest.close) - Number(previous.close) : 0;
  const changePct = previous ? change / Number(previous.close) : 0;
  const bySymbol = portfolio?.by_symbol || [];
  const recent = (candles || []).slice(-24);
  const visibleRecent = recent.slice(-10).map((row, index, rows) => ({
    row,
    prev: index > 0 ? rows[index - 1] : (candles || [])[candles.length - recent.length - 1],
  })).reverse();
  const high24 = recent.length ? Math.max(...recent.map((row) => Number(row.high || 0))) : null;
  const low24 = recent.length ? Math.min(...recent.map((row) => Number(row.low || 0)).filter((value) => value > 0)) : null;
  const rangePct = high24 && low24 ? (high24 - low24) / Math.max(Number(latest?.close || 0), 1e-9) : null;
  const latestRangePct = latest ? (Number(latest.high || 0) - Number(latest.low || 0)) / Math.max(Number(latest.close || 0), 1e-9) : null;
  const avgVolume = recent.length ? recent.reduce((total, row) => total + Number(row.volume || 0), 0) / recent.length : null;
  const latestVolume = Number(latest?.volume || 0);
  const volumeRatio = avgVolume ? latestVolume / avgVolume : null;
  const latestTs = Number(latest?.ts || 0);
  const ageMs = latestTs ? Date.now() - latestTs : null;
  const freshAfterMs = Math.max(15 * 60 * 1000, 2 * barDurationMs(market.bar));
  const isFresh = ageMs !== null && ageMs <= freshAfterMs;
  const ma20 = movingAverage(candles || [], 20);
  const ma60 = movingAverage(candles || [], 60);
  const ret6 = windowReturn(candles || [], 6);
  const ret24 = windowReturn(candles || [], 24);
  const ret72 = windowReturn(candles || [], 72);
  const avgRange24 = avgRangePct(candles || [], 24);
  const avgRange72 = avgRangePct(candles || [], 72);
  const rangeRatio = avgRange72 ? Number(avgRange24 || 0) / avgRange72 : null;
  const latestClose = Number(latest?.close || 0);
  const trendState = latestClose && ma20 && ma60
    ? latestClose > ma20 && ma20 > ma60 && Number(ret24 || 0) > 0 ? "多头顺势"
      : latestClose < ma20 && ma20 < ma60 && Number(ret24 || 0) < 0 ? "空头顺势"
        : "震荡过渡"
    : "等待数据";
  const volumeState = volumeRatio === null ? "等待量能" : volumeRatio >= 1.5 ? "放量" : volumeRatio <= 0.65 ? "缩量" : "正常";
  const volatilityState = rangeRatio === null ? "等待波动" : rangeRatio >= 1.35 ? "高波动" : rangeRatio <= 0.75 ? "低波动" : "正常波动";
  const marketAction = !isFresh
    ? "先刷新行情缓存，再判断信号。"
    : volatilityState === "高波动"
      ? "波动升高，优先等待收敛或降低仓位。"
      : trendState === "震荡过渡"
        ? "趋势不清晰，等待突破或扫损形态确认。"
        : trendState === "空头顺势"
          ? "空头环境，按策略过滤和降权执行。"
          : "顺势环境，可等待价格行为信号。";
  const refreshCount = Math.max(180, Math.min(500, candles?.length || 180));
  const marketActions = [
    {
      key: "candles",
      title: "刷新屏幕行情",
      detail: "重新读取当前品种和周期的最近 K 线，用于更新图表和市场状态。",
      action: candleLoading ? "刷新中..." : "刷新行情",
      disabled: candleLoading,
      onClick: onRefreshCandles,
      tone: isFresh ? "is-info" : "is-bad",
    },
    {
      key: "cache",
      title: "刷新当前缓存",
      detail: `${market.instId} ${market.bar} · ${refreshCount} 根 K 线，直接更新本地缓存。`,
      action: dataRefreshLoading ? "提交中..." : "刷新当前缓存",
      disabled: dataRefreshLoading,
      onClick: () => onRefreshMarketCache?.({ inst_id: market.instId, bar: market.bar, count: refreshCount }),
      tone: isFresh ? "is-info" : "is-bad",
    },
    {
      key: "scan",
      title: "扫描价格行为信号",
      detail: "行情可用后，回到策略信号扫描确认是否出现突破、扫损或延迟扫单形态。",
      action: signalScanLoading ? "扫描中..." : "立即扫描",
      disabled: signalScanLoading,
      onClick: onRunSignalScan,
      tone: trendState === "震荡过渡" ? "is-info" : "is-good",
    },
    {
      key: "data",
      title: "打开数据维护",
      detail: "查看所有品种缓存新鲜度、刷新建议和后台任务队列。",
      action: "打开数据",
      onClick: () => onOpenView?.("数据"),
      tone: "is-info",
    },
  ];
  const regimeRows = [
    { label: "6K动量", value: pct(ret6), status: Number(ret6 || 0) >= 0 ? "上行" : "下行", tone: Number(ret6 || 0) >= 0 ? "text-aqua" : "text-risk" },
    { label: "24K动量", value: pct(ret24), status: Number(ret24 || 0) >= 0 ? "上行" : "下行", tone: Number(ret24 || 0) >= 0 ? "text-aqua" : "text-risk" },
    { label: "72K动量", value: pct(ret72), status: Number(ret72 || 0) >= 0 ? "上行" : "下行", tone: Number(ret72 || 0) >= 0 ? "text-aqua" : "text-risk" },
    { label: "MA20", value: money(ma20), status: latestClose && ma20 ? `${latestClose >= ma20 ? "站上" : "跌破"} ${pct((latestClose - ma20) / ma20)}` : "-", tone: latestClose >= Number(ma20 || Infinity) ? "text-aqua" : "text-risk" },
    { label: "MA60", value: money(ma60), status: latestClose && ma60 ? `${latestClose >= ma60 ? "站上" : "跌破"} ${pct((latestClose - ma60) / ma60)}` : "-", tone: latestClose >= Number(ma60 || Infinity) ? "text-aqua" : "text-risk" },
    { label: "波动倍数", value: rangeRatio === null ? "-" : `${rangeRatio.toFixed(2)}x`, status: volatilityState, tone: marketTone(volatilityState) },
  ];
  const candleBodyPct = latest ? Math.abs(Number(latest.close || 0) - Number(latest.open || 0)) / Math.max(Number(latest.close || 0), 1e-9) : null;
  const closeLocation = latest ? (Number(latest.close || 0) - Number(latest.low || 0)) / Math.max(Number(latest.high || 0) - Number(latest.low || 0), 1e-9) : null;
  const evidenceRows = [
    {
      name: "数据新鲜度",
      value: isFresh ? "新鲜" : ageMs === null ? "无K线" : dataAgeLabel(Math.max(0, ageMs / 1000)),
      threshold: `<= ${dataAgeLabel(freshAfterMs / 1000)}`,
      status: isFresh ? "pass" : "fail",
      action: isFresh ? "可继续观察信号。" : "先刷新行情或缓存。",
    },
    {
      name: "趋势位置",
      value: trendState,
      threshold: "MA20 / MA60 / 24K动量",
      status: trendState === "等待数据" ? "watch" : trendState === "震荡过渡" ? "watch" : "pass",
      action: trendState === "震荡过渡" ? "等待突破或扫损确认。" : trendState === "空头顺势" ? "空头环境按策略降权。" : "顺势环境可等待价格行为。",
    },
    {
      name: "波动压力",
      value: rangeRatio === null ? "-" : `${rangeRatio.toFixed(2)}x`,
      threshold: "24K/72K <= 1.35x",
      status: rangeRatio === null ? "watch" : rangeRatio >= 1.35 ? "warn" : "pass",
      action: rangeRatio === null ? "等待更多波动样本。" : rangeRatio >= 1.35 ? "波动升高，降低仓位或等待收敛。" : "波动未触发额外压力。",
    },
    {
      name: "量能确认",
      value: volumeRatio === null ? "-" : `${volumeRatio.toFixed(2)}x`,
      threshold: "0.65x - 1.50x 正常区",
      status: volumeRatio === null ? "watch" : volumeRatio >= 1.5 ? "pass" : volumeRatio <= 0.65 ? "warn" : "pass",
      action: volumeRatio === null ? "等待成交量。" : volumeRatio >= 1.5 ? "放量确认，注意滑点。" : volumeRatio <= 0.65 ? "缩量，信号可信度下降。" : "量能正常。",
    },
    {
      name: "当前K振幅",
      value: pct(latestRangePct),
      threshold: "用于滑点/突破判断",
      status: latestRangePct === null ? "watch" : latestRangePct >= 0.012 ? "warn" : "pass",
      action: Number(latestRangePct || 0) >= 0.012 ? "当前K线振幅偏大，避免追价。" : "当前K线振幅可观察。",
    },
    {
      name: "收盘位置",
      value: closeLocation === null ? "-" : `${(closeLocation * 100).toFixed(0)}%`,
      threshold: "靠近高/低点代表方向压力",
      status: closeLocation === null ? "watch" : closeLocation >= 0.8 || closeLocation <= 0.2 ? "pass" : "watch",
      action: closeLocation === null ? "等待K线。" : closeLocation >= 0.8 ? "收盘靠近高点，多头压力较强。" : closeLocation <= 0.2 ? "收盘靠近低点，空头压力较强。" : "收盘位于区间中部，方向不够明确。",
    },
    {
      name: "实体强度",
      value: pct(candleBodyPct),
      threshold: "实体越大，方向越清晰",
      status: candleBodyPct === null ? "watch" : candleBodyPct >= 0.002 ? "pass" : "watch",
      action: Number(candleBodyPct || 0) >= 0.002 ? "当前K线有一定实体。" : "实体偏小，等待更明确价格行为。",
    },
  ];
  const evidencePass = evidenceRows.filter((row) => row.status === "pass").length;
  const evidenceWarn = evidenceRows.filter((row) => row.status === "warn").length;
  const evidenceBlocked = evidenceRows.filter((row) => row.status === "fail").length;
  const marketEvidenceSummary = evidenceBlocked
    ? "行情证据存在阻断项，优先刷新数据。"
    : evidenceWarn
      ? `${evidenceWarn} 项行情压力需要观察。`
      : trendState === "震荡过渡"
        ? "行情证据偏震荡，等待形态确认。"
        : "行情证据允许继续观察信号。";
  return (
    <ViewShell title="市场" subtitle="当前行情、最近 K 线和组合品种表现。">
      <div className="risk-grid">
        <StatCell label="当前品种" value={market.instId.replace("-SWAP", "")} note={`${market.bar} · OKX public`} />
        <StatCell label="最新收盘" value={money(latest?.close)} note={candleTimeLabel(latest?.time)} />
        <StatCell label="最近涨跌" value={`${change >= 0 ? "+" : ""}${money(change)}`} note={pct(changePct)} tone={change >= 0 ? "text-aqua" : "text-risk"} />
        <StatCell label="数据新鲜度" value={isFresh ? "新鲜" : "陈旧"} note={ageMs === null ? "无K线" : `${Math.max(0, Math.round(ageMs / 1000))} 秒前`} tone={isFresh ? "text-aqua" : "text-risk"} />
        <StatCell label="24K区间" value={pct(rangePct)} note={`${money(low24)} - ${money(high24)}`} />
        <StatCell label="当前K振幅" value={pct(latestRangePct)} note={`量能 ${volumeRatio ? `${volumeRatio.toFixed(2)}x` : "-"}`} />
      </div>
      <div className="mt-5 analysis-card">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold text-white">行情状态</h3>
            <p className="mt-1 text-xs text-slate-500">用最近 K 线计算趋势、量能和波动，只作为信号前的市场环境判断。</p>
          </div>
          <span className={`candidate-health ${trendState.includes("多头") || trendState.includes("正常") ? "is-ok" : trendState.includes("空头") || volatilityState.includes("高") ? "is-risk" : "is-info"}`}>
            {trendState}
          </span>
        </div>
        <div className="risk-grid">
          <StatCell label="趋势状态" value={trendState} note={`MA20 ${money(ma20)} · MA60 ${money(ma60)}`} tone={marketTone(trendState)} />
          <StatCell label="量能状态" value={volumeState} note={volumeRatio === null ? "等待成交量" : `${volumeRatio.toFixed(2)}x 最近24K均量`} tone={marketTone(volumeState)} />
          <StatCell label="波动状态" value={volatilityState} note={rangeRatio === null ? "等待波动" : `24K/72K ${rangeRatio.toFixed(2)}x`} tone={marketTone(volatilityState)} />
          <StatCell label="策略动作" value={isFresh ? "可观察" : "先刷新"} note={marketAction} tone={isFresh ? marketTone(trendState) : "text-risk"} />
        </div>
        <div className="mt-4 overflow-x-auto rounded-[18px] border border-white/10">
          <table className="trade-table">
            <thead><tr><th>指标</th><th>当前值</th><th>状态</th><th>用途</th></tr></thead>
            <tbody>
              {regimeRows.map((row) => (
                <tr key={row.label}>
                  <td>{row.label}</td>
                  <td>{row.value}</td>
                  <td className={row.tone}>{row.status}</td>
                  <td>{row.label.includes("动量") ? "判断短中期方向" : row.label.startsWith("MA") ? "判断均线位置" : "判断是否需要等待波动回落"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="mt-5 analysis-card">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.28em] text-slate-500">Market Evidence</p>
            <h3 className="text-lg font-semibold text-white">市场证据矩阵</h3>
            <p className="mt-1 text-sm text-slate-400">{marketEvidenceSummary}</p>
          </div>
          <span className={`candidate-health ${evidenceBlocked ? "is-risk" : evidenceWarn ? "is-info" : "is-ok"}`}>
            {evidencePass}/{evidenceRows.length} 通过
          </span>
        </div>
        <div className="mb-4 risk-grid">
          <StatCell label="证据通过" value={String(evidencePass)} note="可继续观察的项目" tone="text-aqua" />
          <StatCell label="观察/注意" value={String(evidenceRows.length - evidencePass - evidenceBlocked)} note={`${evidenceWarn} 项压力提示`} tone={evidenceWarn ? "text-sky-300" : "text-aqua"} />
          <StatCell label="阻断项" value={String(evidenceBlocked)} note={evidenceBlocked ? "先处理数据或行情问题" : "无硬阻断"} tone={evidenceBlocked ? "text-risk" : "text-aqua"} />
        </div>
        <div className="overflow-x-auto rounded-[18px] border border-white/10">
          <table className="trade-table">
            <thead><tr><th>证据</th><th>当前值</th><th>门槛/用途</th><th>状态</th><th>动作</th></tr></thead>
            <tbody>
              {evidenceRows.map((row) => (
                <tr key={row.name}>
                  <td>{row.name}</td>
                  <td>{row.value}</td>
                  <td>{row.threshold}</td>
                  <td><span className={`snapshot-quality ${marketEvidenceTone(row.status)}`}>{marketEvidenceLabel(row.status)}</span></td>
                  <td>{row.action}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-4 ledger-json-panel">
          <span>Market Evidence JSON</span>
          <pre>{JSON.stringify({
            market,
            latest_candle: latest || null,
            metrics: {
              change_pct: changePct,
              range_pct: rangePct,
              latest_range_pct: latestRangePct,
              volume_ratio: volumeRatio,
              range_ratio: rangeRatio,
              ret6,
              ret24,
              ret72,
              ma20,
              ma60,
              body_pct: candleBodyPct,
              close_location: closeLocation,
              data_age_seconds: ageMs === null ? null : Math.max(0, ageMs / 1000),
            },
            states: {
              is_fresh: isFresh,
              trend: trendState,
              volume: volumeState,
              volatility: volatilityState,
              action: marketAction,
            },
            evidence: evidenceRows,
          }, null, 2)}</pre>
        </div>
      </div>
      <div className="mt-5 analysis-card">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.28em] text-slate-500">Market Actions</p>
            <h3 className="text-lg font-semibold text-white">市场动作队列</h3>
            <p className="mt-1 text-sm text-slate-400">{marketAction}</p>
          </div>
          <span className={`candidate-health ${isFresh ? "is-ok" : "is-risk"}`}>
            {isFresh ? "可继续观察" : "需刷新"}
          </span>
        </div>
        <div className="event-list">
          {marketActions.map((item) => (
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
      <div className="mt-5 analysis-card">
        <h3 className="text-lg font-semibold text-white">组合品种</h3>
        <div className="mt-4 risk-grid">
          {bySymbol.length ? bySymbol.map((row) => (
            <StatCell key={row.inst_id} label={row.inst_id.replace("-SWAP", "")} value={`${row.trades} 笔`} note={`PnL ${money(row.pnl)}U · ${pct(row.return_pct)}`} tone={Number(row.pnl) >= 0 ? "text-aqua" : "text-risk"} />
          )) : <StatCell label="组合品种" value="-" note="等待组合回测结果" />}
        </div>
      </div>
      <div className="mt-5 analysis-card">
        <h3 className="text-lg font-semibold text-white">最近K线</h3>
        <div className="mt-4 overflow-x-auto rounded-[18px] border border-white/10">
          <table className="trade-table">
            <thead><tr><th>时间</th><th>开</th><th>高</th><th>低</th><th>收</th><th>涨跌</th><th>振幅</th><th>成交量</th></tr></thead>
            <tbody>
              {visibleRecent.length ? visibleRecent.map(({ row, prev }) => {
                const rowChange = prev ? Number(row.close || 0) - Number(prev.close || 0) : 0;
                const rowChangePct = prev ? rowChange / Math.max(Number(prev.close || 0), 1e-9) : null;
                const rowRangePct = (Number(row.high || 0) - Number(row.low || 0)) / Math.max(Number(row.close || 0), 1e-9);
                return (
                  <tr key={row.ts || row.time}>
                    <td>{candleTimeLabel(row.time)}</td>
                    <td>{money(row.open)}</td>
                    <td>{money(row.high)}</td>
                    <td>{money(row.low)}</td>
                    <td>{money(row.close)}</td>
                    <td className={rowChange >= 0 ? "text-aqua" : "text-risk"}>{pct(rowChangePct)}</td>
                    <td>{pct(rowRangePct)}</td>
                    <td>{money(row.volume)}</td>
                  </tr>
                );
              }) : (
                <tr><td colSpan="8">暂无 K 线数据。</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </ViewShell>
  );
}

export function RiskView({
  paperState,
  portfolio,
  readiness,
  readinessLoading,
  riskExperimentLoading,
  paperAudit,
  auditLoading,
  onRunReadiness,
  onRunRiskExperiments,
  onRefreshAudit,
  onOpenView,
}) {
  const circuit = paperState?.circuit_breaker || {};
  const summary = portfolio?.summary || {};
  const thresholds = circuit.thresholds || {};
  const checks = readiness?.checks || [];
  const robustness = readiness?.robustness?.aggregate || {};
  const monteCarlo = readiness?.monte_carlo?.summary || {};
  const signalState = readiness?.signal_state || {};
  const auditRows = paperAudit?.rows || [];
  const lossStreak = Number(circuit.loss_streak ?? paperState?.consecutive_losses ?? 0);
  const maxLossStreak = Number(thresholds.max_loss_streak_stop ?? 0);
  const sampleTarget = 50;
  const tradeSamples = Number(summary.trades || 0);
  const riskRows = [
    {
      name: "当日亏损",
      value: pct(circuit.daily_loss),
      threshold: pct(thresholds.max_daily_loss_pct),
      usage: riskUsage(circuit.daily_loss, thresholds.max_daily_loss_pct),
      watchAction: "减少开仓频率，等待日内权益恢复。",
      warnAction: "停止新信号放大，优先保住日内本金。",
      blockAction: "触发日亏熔断，暂停开仓到下一交易日。",
    },
    {
      name: "账户回撤",
      value: pct(circuit.account_drawdown ?? summary.max_drawdown),
      threshold: pct(thresholds.max_account_drawdown_pct),
      usage: riskUsage(circuit.account_drawdown ?? summary.max_drawdown, thresholds.max_account_drawdown_pct),
      watchAction: "观察权益曲线，必要时降低 risk_pct。",
      warnAction: "降低仓位或暂停高波动品种。",
      blockAction: "账户回撤达到阈值，停止策略扩张。",
    },
    {
      name: "连续亏损",
      value: `${lossStreak} 笔`,
      threshold: maxLossStreak ? `${maxLossStreak} 笔` : "-",
      usage: riskUsage(lossStreak, maxLossStreak),
      watchAction: "下一笔信号前复核形态质量。",
      warnAction: "降低单笔风险，等待连亏重置。",
      blockAction: "连亏熔断，暂停新开仓。",
    },
    {
      name: "ATR 波动",
      value: pct(circuit.atr_pct),
      threshold: pct(thresholds.max_atr_pct),
      usage: riskUsage(circuit.atr_pct, thresholds.max_atr_pct),
      watchAction: "波动升高，优先等待确认信号。",
      warnAction: "扩大滑点审查，降低杠杆。",
      blockAction: "波动熔断，等待 ATR 回落。",
    },
    {
      name: "策略回撤",
      value: pct(summary.max_drawdown),
      threshold: pct(0.18),
      usage: riskUsage(summary.max_drawdown, 0.18),
      watchAction: "复盘回撤来源，检查弱窗口。",
      warnAction: "运行风险/退出实验，降低回撤。",
      blockAction: "回撤超过策略观察线，先修参数。",
    },
    {
      name: "样本覆盖",
      value: `${tradeSamples} 笔`,
      threshold: `${sampleTarget} 笔`,
      usage: tradeSamples ? Math.min(1, tradeSamples / sampleTarget) : 0,
      inverse: true,
      watchAction: "样本仍偏少，优先扩大窗口或多品种验证。",
      warnAction: "样本不足，不建议提高实盘风险。",
      okAction: "样本覆盖较充分，可结合稳健性判断。",
    },
  ].map((row) => {
    const normalizedUsage = row.inverse ? (row.usage === null ? null : 1 - row.usage) : row.usage;
    return { ...row, status: riskUsageStatus(normalizedUsage), action: riskAction({ ...row, usage: normalizedUsage }), displayUsage: row.usage, normalizedUsage };
  });
  const hotRows = riskRows.filter((row) => row.normalizedUsage !== null && row.normalizedUsage >= 0.6);
  const worstRisk = [...riskRows].filter((row) => row.normalizedUsage !== null).sort((a, b) => b.normalizedUsage - a.normalizedUsage)[0];
  const failedChecks = checks.filter((row) => !row.passed);
  const riskActions = [
    {
      key: "readiness",
      title: readiness ? "重新准入检查" : "运行准入检查",
      detail: readiness?.next_action || "先把组合回测、滚动窗口、成本压力和 MC 尾部风险合并检查。",
      action: readinessLoading ? "检查中..." : "运行检查",
      disabled: readinessLoading,
      onClick: onRunReadiness,
      tone: readiness?.decision?.includes("允许") ? "is-good" : "is-info",
    },
    {
      key: "risk_experiment",
      title: "风险/退出实验",
      detail: hotRows.length || failedChecks.length ? "针对回撤、连亏、样本和弱窗口启动参数归因实验。" : "当前压力正常，可在调整参数前先保留一组对照实验。",
      action: riskExperimentLoading ? "实验中..." : "启动实验",
      disabled: riskExperimentLoading,
      onClick: onRunRiskExperiments,
      tone: hotRows.length ? "is-bad" : "is-info",
    },
    {
      key: "data",
      title: "数据与快照复核",
      detail: readiness?.signal_state?.errors ? "准入信号扫描存在错误，先检查数据缓存和快照。" : "复核研究快照、缓存新鲜度和后台任务状态。",
      action: "打开数据",
      onClick: () => onOpenView?.("数据"),
      tone: readiness?.signal_state?.errors ? "is-bad" : "is-info",
    },
    {
      key: "live",
      title: "实盘前门槛",
      detail: "风险处理完成后，到实盘页复核权益、持仓、OKX 诊断和最终提交锁。",
      action: "打开实盘",
      onClick: () => onOpenView?.("实盘"),
      tone: "is-info",
    },
  ];
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
      <div className="mt-5 analysis-card">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.28em] text-slate-500">Risk Pressure</p>
            <h3 className="text-lg font-semibold text-white">风险压力表</h3>
            <p className="mt-1 text-sm text-slate-400">
              {worstRisk ? `当前最接近阈值：${worstRisk.name}，状态 ${worstRisk.status.label}。` : "等待模拟盘生成风险上下文。"}
            </p>
          </div>
          <span className={`candidate-health ${hotRows.length ? "is-risk" : "is-ok"}`}>
            {hotRows.length ? `${hotRows.length} 项需关注` : "压力正常"}
          </span>
        </div>
        <div className="overflow-x-auto rounded-[18px] border border-white/10">
          <table className="trade-table">
            <thead><tr><th>风险项</th><th>当前值</th><th>阈值/目标</th><th>使用率</th><th>状态</th><th>动作</th></tr></thead>
            <tbody>
              {riskRows.map((row) => (
                <tr key={row.name}>
                  <td>{row.name}</td>
                  <td>{row.value}</td>
                  <td>{row.threshold}</td>
                  <td>
                    <div className="risk-meter-cell">
                      <RiskMeter usage={row.displayUsage} tone={row.status.tone} />
                      <span>{row.displayUsage === null || row.displayUsage === undefined ? "-" : `${Math.round(Math.max(0, row.displayUsage) * 100)}%`}</span>
                    </div>
                  </td>
                  <td><span className={`snapshot-quality ${row.status.tone}`}>{row.status.label}</span></td>
                  <td>{row.action}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="mt-5 analysis-card">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.28em] text-slate-500">Risk Actions</p>
            <h3 className="text-lg font-semibold text-white">风控处置队列</h3>
            <p className="mt-1 text-sm text-slate-400">
              {failedChecks.length ? `${failedChecks.length} 个准入项未通过，优先按动作处理。` : hotRows.length ? `${hotRows.length} 个风险压力项需关注。` : "当前没有硬性阻断，保留检查和实验入口。"}
            </p>
          </div>
          <span className={`candidate-health ${failedChecks.length || hotRows.length ? "is-risk" : "is-ok"}`}>
            {failedChecks.length || hotRows.length ? "需处理" : "可观察"}
          </span>
        </div>
        <div className="event-list">
          {riskActions.map((item) => (
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
        {failedChecks.length ? (
          <div className="mt-4 overflow-x-auto rounded-[18px] border border-white/10">
            <table className="trade-table">
              <thead><tr><th>失败项</th><th>当前值</th><th>门槛</th><th>动作</th></tr></thead>
              <tbody>
                {failedChecks.slice(0, 6).map((row) => (
                  <tr key={`failed-${row.name}`}>
                    <td>{row.name}</td>
                    <td>{checkValueLabel(row)}</td>
                    <td>{row.threshold || "-"}</td>
                    <td>{row.action || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
      <ReadinessEvidencePanel
        readiness={readiness}
        riskRows={riskRows}
        loading={readinessLoading}
        onRunReadiness={onRunReadiness}
      />
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
      <div className="mt-5 analysis-card">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.28em] text-slate-500">Readiness Gate</p>
            <h3 className="text-lg font-semibold text-white">模拟准入检查</h3>
            <p className="mt-1 text-sm text-slate-400">{readiness?.next_action || "运行后会汇总组合回测、滚动稳健性、成本压力和蒙特卡洛尾部风险。"}</p>
          </div>
          <button type="button" className="table-action" onClick={() => onRunReadiness?.()} disabled={readinessLoading}>
            {readinessLoading ? "检查中..." : "运行准入检查"}
          </button>
        </div>
        <div className="mt-4 risk-grid">
          <StatCell label="准入结论" value={readiness?.decision || "-"} note={`风险 ${readiness?.risk_level || "-"}`} tone={readinessTone(readiness?.decision)} />
          <StatCell label="准入评分" value={readiness?.score === undefined ? "-" : `${readiness.score}/100`} note={`${checks.filter((row) => row.passed).length}/${checks.length || 0} 项通过`} />
          <StatCell label="月复合收益" value={pct(readiness?.monthly_return)} note={`目标 ${pct(0.20)}`} tone={Number(readiness?.monthly_return || 0) >= 0.20 ? "text-aqua" : "text-risk"} />
          <StatCell label="滚动通过率" value={pct(readiness?.rolling_ratio)} note={`${robustness.rolling_positive_cases ?? "-"}/${robustness.rolling_cases ?? "-"} 窗口`} />
          <StatCell label="MC亏损概率" value={pct(monteCarlo.loss_probability)} note={`P95回撤 ${pct(monteCarlo.p95_max_drawdown)}`} />
          <StatCell label="当前信号" value={`${signalState.ready ?? 0}/${signalState.watch ?? 0}`} note={`阻断 ${signalState.blocked ?? 0} · 错误 ${signalState.errors ?? 0}`} />
        </div>
        {checks.length ? (
          <div className="mt-5 overflow-x-auto rounded-[18px] border border-white/10">
            <table className="trade-table">
              <thead><tr><th>检查项</th><th>结果</th><th>阈值</th><th>状态</th><th>处理动作</th></tr></thead>
              <tbody>
                {checks.map((row) => (
                  <tr key={row.name}>
                    <td>{row.name}</td>
                    <td>{checkValueLabel(row)}</td>
                    <td>{row.threshold || "-"}</td>
                    <td><span className={`candidate-health ${row.passed ? "is-ok" : "is-risk"}`}>{readinessStatusLabel(row)}</span></td>
                    <td>{row.action || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="mt-4 text-sm text-slate-400">还没有准入检查结果。</p>
        )}
      </div>
      <div className="mt-5 analysis-card">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.28em] text-slate-500">Paper Audit</p>
            <h3 className="text-lg font-semibold text-white">启动审计</h3>
            <p className="mt-1 text-sm text-slate-400">记录准入检查、启动停止和模拟盘扫描动作，用于复盘运行原因。</p>
          </div>
          <button type="button" className="table-action" onClick={() => onRefreshAudit?.()} disabled={auditLoading}>
            {auditLoading ? "刷新中..." : "刷新审计"}
          </button>
        </div>
        <div className="mt-5 overflow-x-auto rounded-[18px] border border-white/10">
          <table className="trade-table">
            <thead><tr><th>时间</th><th>动作</th><th>品种</th><th>结果</th><th>权益</th><th>关键参数</th></tr></thead>
            <tbody>
              {auditRows.length ? auditRows.slice(0, 12).map((row, index) => {
                const params = row.params || {};
                const readinessRow = row.readiness || {};
                const result = auditResultLabel(row);
                return (
                  <tr key={`${row.time || index}-${row.action || ""}`}>
                    <td>{auditTimeLabel(row.time)}</td>
                    <td><span className={`snapshot-quality ${row.action === "start" || row.action === "readiness_check" ? "is-info" : row.action === "stop" ? "is-warn" : "is-good"}`}>{auditActionLabel(row)}</span></td>
                    <td>{row.inst_id?.replace("-SWAP", "") || params.instId?.replace("-SWAP", "") || "-"}</td>
                    <td>{result}{readinessRow.score === undefined ? "" : ` · ${readinessRow.score}/100`}</td>
                    <td>{money(row.equity_after ?? row.equity_before)}</td>
                    <td>风险 {pct(params.risk_pct)} · 杠杆 {params.max_leverage ?? params.leverage ?? "-"}x · 日内 {params.max_daily_trades ?? "-"} 笔</td>
                  </tr>
                );
              }) : (
                <tr><td colSpan="6">{auditLoading ? "正在读取审计日志..." : "暂无启动审计记录。"}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
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
  tasks = [],
  taskLoading,
  onDataRefreshBatchSizeChange,
  onCompactDataCache,
  onInspectSnapshot,
  onLoadSnapshot,
  onRefreshDataCache,
  onRefreshTasks,
  onStartTask,
  onCancelTask,
  onClearTasks,
}) {
  const rows = dataStatus?.rows || [];
  const snapshots = researchSnapshots?.rows || [];
  const [snapshotFilter, setSnapshotFilter] = useState("all");
  const [dataFilter, setDataFilter] = useState("all");
  const [selectedTaskId, setSelectedTaskId] = useState(null);
  const [selectedDataKey, setSelectedDataKey] = useState("");
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
  const uncoveredStaleRows = rows.filter((row) => row.is_stale && !row.covered_by_fresh_cache);
  const refreshQueue = [...rows]
    .filter((row) => row.recommended_refresh || (row.is_stale && !row.covered_by_fresh_cache))
    .sort((left, right) => {
      const priorityDiff = Number(right.refresh_priority || 0) - Number(left.refresh_priority || 0);
      if (priorityDiff) return priorityDiff;
      return Number(left.refresh_estimated_requests || 1) - Number(right.refresh_estimated_requests || 1);
    });
  const topRefreshQueue = refreshQueue.slice(0, dataRefreshBatchSize);
  const estimatedRequests = topRefreshQueue.reduce((sum, row) => sum + Number(row.refresh_estimated_requests || 1), 0);
  const oldestRow = rows.reduce((oldest, row) => {
    if (!oldest) return row;
    return Number(row.latest_closed_age_seconds || 0) > Number(oldest.latest_closed_age_seconds || 0) ? row : oldest;
  }, null);
  const newestRow = rows.reduce((newest, row) => {
    if (!newest) return row;
    return Number(row.latest_closed_age_seconds || Infinity) < Number(newest.latest_closed_age_seconds || Infinity) ? row : newest;
  }, null);
  const healthScore = dataHealthScore(rows);
  const healthStatus = dataHealthStatus(healthScore);
  const activeTasks = tasks.filter((task) => ["queued", "running"].includes(task.status));
  const clearableTasks = tasks.filter((task) => ["completed", "failed", "cancelled"].includes(task.status));
  const latestTask = tasks[0];
  const selectedTask = tasks.find((task) => task.id === selectedTaskId) || latestTask || null;
  const maintenanceFocus = recommendedDataCount > 0
    ? `优先刷新 ${recommendedDataCount} 个建议项`
    : compactableRows.length > 0
      ? `可压缩 ${compactableRows.length} 个覆盖缓存`
      : uncoveredStaleRows.length > 0
        ? `复核 ${uncoveredStaleRows.length} 个陈旧缓存`
        : "保持当前缓存";
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
  const selectedDataRow = visibleDataRows.find((row) => dataRowKey(row) === selectedDataKey) || visibleDataRows[0] || null;
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
      <div className="mt-5 analysis-card data-health-panel">
        <div className="data-health-header">
          <div>
            <span>DATA HEALTH</span>
            <h3>数据健康诊断</h3>
            <p>{maintenanceFocus} · 最旧 {oldestRow ? `${oldestRow.inst_id} ${oldestRow.bar} ${dataAgeLabel(oldestRow.latest_closed_age_seconds)}` : "-"} · 最新 {newestRow ? `${newestRow.inst_id} ${newestRow.bar} ${dataAgeLabel(newestRow.latest_closed_age_seconds)}` : "-"}</p>
          </div>
          <div className="data-health-score">
            <span className={`snapshot-quality ${healthStatus.badge}`}>{healthStatus.label}</span>
            <strong className={healthStatus.tone}>{healthScore}</strong>
          </div>
        </div>
        <div className="data-health-grid">
          <div>
            <span>推荐刷新</span>
            <strong>{recommendedDataCount}</strong>
            <p>{topRefreshQueue.length ? `本批约 ${estimatedRequests} 次请求` : "暂无推荐队列"}</p>
          </div>
          <div>
            <span>未覆盖陈旧</span>
            <strong className={uncoveredStaleRows.length ? "text-risk" : "text-aqua"}>{uncoveredStaleRows.length}</strong>
            <p>{uncoveredStaleRows.length ? "会影响回测或扫描新鲜度" : "陈旧项均可覆盖或不存在"}</p>
          </div>
          <div>
            <span>覆盖压缩</span>
            <strong>{compactableRows.length}</strong>
            <p>可释放约 {compactableKb} KB</p>
          </div>
        </div>
        <div className="data-health-actions">
          <button type="button" className="table-action" onClick={() => onRefreshDataCache?.(null, true)} disabled={dataRefreshLoading || recommendedDataCount === 0}>
            {dataRefreshLoading ? "刷新中..." : "刷新推荐批次"}
          </button>
          <button type="button" className="table-action" onClick={() => setDataFilter("recommended")} disabled={recommendedDataCount === 0}>查看建议项</button>
          <button type="button" className="table-action" onClick={() => setDataFilter("stale")} disabled={staleDataCount === 0}>查看陈旧项</button>
          <button type="button" className="table-action" onClick={() => onCompactDataCache?.(true)} disabled={dataCompactLoading || compactableRows.length === 0}>
            {dataCompactLoading ? "压缩中..." : "预览压缩"}
          </button>
        </div>
        <div className="overflow-x-auto rounded-[18px] border border-white/10">
          <table className="trade-table">
            <thead><tr><th>刷新队列</th><th>周期</th><th>K线</th><th>优先级</th><th>成本</th><th>原因</th><th>最新确认</th></tr></thead>
            <tbody>
              {topRefreshQueue.length ? topRefreshQueue.map((row) => (
                <tr key={`queue-${row.inst_id}-${row.bar}-${row.count}`}>
                  <td>{row.inst_id}</td>
                  <td>{row.bar}</td>
                  <td>{row.candles ?? row.count}</td>
                  <td><span className={`snapshot-quality ${row.recommended_refresh ? "is-warn" : "is-info"}`}>{row.refresh_priority ?? 0}</span></td>
                  <td>{row.refresh_cost_label || `${row.refresh_estimated_requests || 1} 次请求`}</td>
                  <td>{row.refresh_reasons?.join(" / ") || "-"}</td>
                  <td>{row.latest_closed?.replace("T", " ").slice(0, 16) || "-"}</td>
                </tr>
              )) : (
                <tr><td colSpan="7">暂无必须刷新的 K 线缓存，优先处理覆盖压缩或保持观察。</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      <div className="mt-5 analysis-card data-health-panel">
        <div className="data-health-header">
          <div>
            <span>TASK QUEUE</span>
            <h3>后台任务队列</h3>
            <p>{activeTasks.length ? `${activeTasks.length} 个任务正在排队或运行` : latestTask ? `最近任务 ${taskTypeLabel(latestTask.type)} · ${taskStatusLabel(latestTask.status)}` : "暂无后台任务"}</p>
          </div>
          <div className="data-health-score">
            <span className={`snapshot-quality ${activeTasks.length ? "is-info" : latestTask?.status === "failed" ? "is-bad" : "is-good"}`}>
              {activeTasks.length ? "运行中" : "空闲"}
            </span>
            <strong>{tasks.length}</strong>
          </div>
        </div>
        <div className="data-health-actions">
          <button
            type="button"
            className="table-action"
            onClick={() => onStartTask?.("data_refresh", { stale: true, max_items: dataRefreshBatchSize, recommended_only: true })}
            disabled={taskLoading || recommendedDataCount === 0}
          >
            {taskLoading ? "提交中..." : `后台刷新建议 x${dataRefreshBatchSize}`}
          </button>
          <button
            type="button"
            className="table-action"
            onClick={() => onStartTask?.("data_refresh", { stale: true, max_items: dataRefreshBatchSize, recommended_only: false })}
            disabled={taskLoading || staleDataCount === 0}
          >
            {taskLoading ? "提交中..." : `后台刷新陈旧 x${dataRefreshBatchSize}`}
          </button>
          <button
            type="button"
            className="table-action"
            onClick={() => onStartTask?.("compact_cache", { dry_run: false })}
            disabled={taskLoading || compactableRows.length === 0}
          >
            {taskLoading ? "提交中..." : `后台压缩 ${compactableRows.length}`}
          </button>
          <button type="button" className="table-action" onClick={() => onRefreshTasks?.()} disabled={taskLoading}>
            {taskLoading ? "刷新中..." : "刷新队列"}
          </button>
          <button type="button" className="table-action" onClick={() => onClearTasks?.()} disabled={taskLoading || clearableTasks.length === 0}>
            {taskLoading ? "清理中..." : `清理历史 ${clearableTasks.length}`}
          </button>
        </div>
        <div className="overflow-x-auto rounded-[18px] border border-white/10">
          <table className="trade-table">
            <thead><tr><th>任务</th><th>状态</th><th>进度</th><th>当前对象</th><th>更新时间</th><th>结果</th><th>操作</th></tr></thead>
            <tbody>
              {tasks.length ? tasks.slice(0, 8).map((task) => {
                const progress = task.progress || {};
                const current = progress.current || {};
                const total = Number(progress.total || 0);
                const completed = Number(progress.completed || 0);
                return (
                  <tr key={task.id} className={selectedTask?.id === task.id ? "is-selected-row" : ""}>
                    <td>{taskTypeLabel(task.type)}</td>
                    <td><span className={`snapshot-quality ${taskStatusTone(task.status)}`}>{taskStatusLabel(task.status)}</span></td>
                    <td>{total ? `${completed}/${total}` : "-"}</td>
                    <td>{current.inst_id ? `${current.inst_id} ${current.bar || ""} ${current.count || ""}` : task.params?.recommended_only ? "建议项" : "-"}</td>
                    <td>{(task.updated_at || task.created_at || "").replace("T", " ").slice(0, 19) || "-"}</td>
                    <td>{task.error || (task.result ? "已有结果" : "-")}</td>
                    <td>
                      <div className="table-actions">
                        <button type="button" className="table-action" onClick={() => setSelectedTaskId(task.id)}>详情</button>
                        {["queued", "running"].includes(task.status) ? (
                          <button type="button" className="table-action" onClick={() => onCancelTask?.(task.id)} disabled={taskLoading}>取消</button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              }) : (
                <tr><td colSpan="7">暂无后台任务。可用上方按钮把刷新或压缩放到后台执行。</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <TaskDetailPanel task={selectedTask} />
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
              <tr key={dataRowKey(row)} className={selectedDataRow && dataRowKey(selectedDataRow) === dataRowKey(row) ? "is-selected-row" : ""}>
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
                  <div className="table-actions">
                    <button type="button" className="table-action" onClick={() => setSelectedDataKey(dataRowKey(row))}>详情</button>
                    <button type="button" className="table-action" onClick={() => onRefreshDataCache?.(row)} disabled={dataRefreshLoading}>
                      {dataRefreshLoading ? "刷新中" : "刷新"}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {!visibleDataRows.length ? <tr><td colSpan="10">没有符合筛选条件的 K 线缓存。</td></tr> : null}
          </tbody>
        </table>
      </div>
      <div className="mt-4 task-detail-panel">
        <div className="task-detail-header">
          <div>
            <span>CACHE DETAIL</span>
            <h4>缓存详情</h4>
            <p>{selectedDataRow ? `${selectedDataRow.inst_id} · ${selectedDataRow.bar} · ${selectedDataRow.count || selectedDataRow.candles} K线` : "选择一条 K 线缓存查看刷新原因、覆盖关系和诊断字段。"}</p>
          </div>
          <span className={`snapshot-quality ${selectedDataRow?.recommended_refresh ? "is-warn" : selectedDataRow?.is_stale ? "is-info" : "is-good"}`}>
            {selectedDataRow ? selectedDataRow.recommended_refresh ? "建议刷新" : selectedDataRow.is_stale ? "陈旧" : "新鲜" : "待选择"}
          </span>
        </div>
        {selectedDataRow ? (
          <>
            <div className="task-detail-grid">
              <div>
                <span>AGE</span>
                <strong>{dataAgeLabel(selectedDataRow.latest_closed_age_seconds)}</strong>
                <p>阈值 {selectedDataRow.stale_after_minutes || "-"} 分钟 · 最新 {selectedDataRow.latest_closed?.replace("T", " ").slice(0, 16) || "-"}</p>
              </div>
              <div>
                <span>REFRESH COST</span>
                <strong>{selectedDataRow.refresh_cost_label || `${selectedDataRow.refresh_estimated_requests || 1} 次请求`}</strong>
                <p>优先级 {selectedDataRow.refresh_priority ?? 0}</p>
              </div>
              <div>
                <span>COVERAGE</span>
                <strong>{selectedDataRow.covered_by_fresh_cache ? "已覆盖" : "未覆盖"}</strong>
                <p>{selectedDataRow.coverage_note || (selectedDataRow.covered_by_count ? `由 ${selectedDataRow.covered_by_count} K 缓存覆盖` : "没有覆盖关系")}</p>
              </div>
            </div>
            <div className="task-detail-meta">
              <div>
                <span>刷新原因</span>
                <p>{selectedDataRow.refresh_reasons?.join(" · ") || "-"}</p>
              </div>
              <div>
                <span>文件信息</span>
                <p>{Math.round((selectedDataRow.size_bytes || 0) / 1024)} KB · 更新 {selectedDataRow.updated_at?.replace("T", " ").slice(0, 19) || "-"}</p>
              </div>
            </div>
            <div className="ledger-json-panel">
              <span>Cache Raw JSON</span>
              <pre>{JSON.stringify(selectedDataRow, null, 2)}</pre>
            </div>
          </>
        ) : (
          <div className="task-detail-empty">当前没有符合筛选条件的 K 线缓存。</div>
        )}
      </div>
    </ViewShell>
  );
}

export function LiveView({
  executionPlan,
  executionConfig,
  executionEnvironment,
  executionOrders,
  okxAccount,
  okxDiagnostics,
  okxPositions,
  preflightSteps,
  executionLoading,
  executionConfigLoading,
  executionEnvironmentLoading,
  executionOrdersLoading,
  okxLoading,
  okxDiagnosticsLoading,
  okxCredentialsLoading,
  preflightLoading,
  liveSubmitResult,
  liveSubmitLoading,
  liveRiskConfig,
  paperState,
  paperAudit,
  onLiveRiskConfigChange,
  onRunExecutionPlan,
  onRefreshExecutionConfig,
  onRefreshExecutionEnvironment,
  onRefreshExecutionOrders,
  onRefreshOkxReadonly,
  onRunOkxDiagnostics,
  onSaveOkxSessionCredentials,
  onRunLivePreflight,
  onRunLiveSubmitLockTest,
}) {
  const [credentialForm, setCredentialForm] = useState({ api_key: "", api_secret: "", api_passphrase: "", simulated: false });
  const [credentialStatus, setCredentialStatus] = useState("");
  const [submitConfirmation, setSubmitConfirmation] = useState("");
  const [selectedLedgerKey, setSelectedLedgerKey] = useState("");
  const intent = executionPlan?.order_intent;
  const guard = executionPlan?.guard || {};
  const checks = guard.checks || [];
  const finalGate = executionPlan?.final_gate || {};
  const finalChecks = finalGate.checks || [];
  const recentExecution = (paperAudit?.rows || []).find((row) => ["execution_dry_run", "live_submit_rejected"].includes(row.action));
  const okxKeys = executionConfig?.okx_keys || {};
  const orderRows = executionOrders?.rows || [];
  const okxRows = okxPositions?.positions || [];
  const envOkx = executionEnvironment?.okx_account || okxAccount || {};
  const envPositions = executionEnvironment?.okx_positions || okxPositions || {};
  const okxEquityNumber = Number(envOkx.total_equity_usd);
  const diagnosticSteps = okxDiagnostics?.steps || [];
  const diagnosticActions = okxDiagnostics?.actions || [];
  const instrumentRules = executionPlan?.exchange_rules?.instrument || {};
  const exchangeValidation = executionPlan?.exchange_rules?.validation || {};
  const okxOrderPreview = executionPlan?.okx_order || {};
  const okxOrderPayload = okxOrderPreview?.payload || {};
  const dataQuality = executionPlan?.data_quality || {};
  const preflight = preflightSummary(executionPlan, okxDiagnostics, executionConfig);
  const submitPath = liveSubmitPath(executionPlan, executionConfig, okxDiagnostics, executionEnvironment);
  const expectedConfirmation = executionConfig?.confirmation_phrase || "CONFIRM_LIVE_TRADE";
  const confirmationMatches = submitConfirmation.trim() === expectedConfirmation;
  const liveSubmitChecks = liveSubmitResult?.checks || [];
  const liveSubmitBlocked = liveSubmitResult?.blocked_reasons || [];
  const recentLiveReject = orderRows.find((row) => row.event === "live_submit_rejected");
  const ledgerRows = orderRows.slice(0, 10);
  const selectedLedgerRow = ledgerRows.find((row, index) => ledgerRowKey(row, index) === selectedLedgerKey) || ledgerRows[0] || null;
  const selectedLedgerFinalGate = selectedLedgerRow?.final_gate || {};
  const selectedLedgerChecks = selectedLedgerFinalGate?.checks || [];
  const selectedLedgerOrder = selectedLedgerRow?.okx_order || {};
  const selectedLedgerPayload = selectedLedgerOrder?.payload || {};
  const selectedLedgerValidation = selectedLedgerRow?.exchange_validation || {};
  const selectedLedgerReasons = selectedLedgerRow?.rejection_reasons || selectedLedgerFinalGate?.blocked_reasons || [];
  const liveActionRows = [
    {
      key: "environment",
      title: "刷新执行环境",
      detail: "重新读取实盘总锁、OKX 配置和执行环境状态。",
      action: executionConfigLoading ? "读取中..." : "刷新环境",
      disabled: executionConfigLoading,
      status: executionConfig?.okx_configured ? "pass" : "pending",
      onClick: onRefreshExecutionConfig,
    },
    {
      key: "diagnostics",
      title: "运行 OKX 诊断",
      detail: okxDiagnostics?.readonly_ok ? "OKX 只读账户诊断已通过。" : diagnosticActions[0] || "定位密钥、签名、IP 白名单、权限或网络问题。",
      action: okxDiagnosticsLoading ? "诊断中..." : "运行诊断",
      disabled: okxDiagnosticsLoading,
      status: okxDiagnostics?.readonly_ok ? "pass" : okxDiagnostics ? "fail" : "pending",
      onClick: onRunOkxDiagnostics,
    },
    {
      key: "okx",
      title: "刷新 OKX 只读账户",
      detail: envOkx?.ok ? `权益 ${money(envOkx.total_equity_usd)}U，持仓 ${envPositions?.count ?? 0} 个。` : envOkx?.error || "读取账户余额和 SWAP 持仓。",
      action: okxLoading ? "读取中..." : "刷新OKX",
      disabled: okxLoading,
      status: envOkx?.ok ? "pass" : envOkx?.configured ? "fail" : "pending",
      onClick: onRefreshOkxReadonly,
    },
    {
      key: "preflight",
      title: "一键预演",
      detail: `${submitPath.label} · ${submitPath.note}`,
      action: preflightLoading ? "预演中..." : "一键预演",
      disabled: preflightLoading,
      status: submitPath.tone === "text-risk" ? "fail" : submitPath.tone === "text-aqua" ? "pass" : "pending",
      onClick: onRunLivePreflight,
    },
    {
      key: "dry_run",
      title: "生成执行预演",
      detail: intent ? `${intent.side || "-"} ${money(intent.notional)}U @ ${money(intent.entry)}` : "拉取最新行情并尝试生成订单意图和保护检查。",
      action: executionLoading ? "预演中..." : "生成预演",
      disabled: executionLoading,
      status: intent ? "pass" : executionPlan ? "warn" : "pending",
      onClick: onRunExecutionPlan,
    },
    {
      key: "lock_test",
      title: "测试提交锁",
      detail: liveSubmitResult?.decision ? `${liveSubmitResult.decision} · ${(liveSubmitResult.blocked_reasons || [])[0] || "已记录审计"}` : "发送无确认短语请求，验证真实提交会被锁住。",
      action: liveSubmitLoading ? "测试中..." : "测试提交锁",
      disabled: liveSubmitLoading,
      status: liveSubmitResult ? "pass" : "pending",
      onClick: () => onRunLiveSubmitLockTest?.(""),
    },
    {
      key: "ledger",
      title: "刷新执行账本",
      detail: `${orderRows.length} 条 dry-run / 拒绝记录，用于识别重复订单意图。`,
      action: executionOrdersLoading ? "刷新中..." : "刷新账本",
      disabled: executionOrdersLoading,
      status: orderRows.length ? "pass" : "pending",
      onClick: onRefreshExecutionOrders,
    },
  ];
  const minLiveEquity = Number(liveRiskConfig?.min_live_equity_usd ?? 10);
  const marginBufferMult = Number(liveRiskConfig?.live_margin_buffer_mult ?? 1.2);
  const updateLiveRiskNumber = (key, value) => {
    const number = Number(value);
    if (!Number.isFinite(number)) return;
    onLiveRiskConfigChange?.({ [key]: number });
  };
  const updateCredentialField = (key, value) => {
    setCredentialStatus("");
    setCredentialForm((current) => ({ ...current, [key]: value }));
  };
  const submitCredentials = async (event) => {
    event.preventDefault();
    await onSaveOkxSessionCredentials?.(credentialForm);
    setCredentialForm({ api_key: "", api_secret: "", api_passphrase: "", simulated: credentialForm.simulated });
    setCredentialStatus("已保存到当前后端进程，输入框已清空。");
  };
  return (
    <ViewShell title="实盘" subtitle="真实下单前的订单意图、执行保护和 dry-run 审计。">
      <div className="risk-grid">
        <StatCell label="实盘总开关" value={executionConfig?.live_trading_enabled ? "已开启" : "关闭"} note="默认必须保持关闭" tone={executionConfig?.live_trading_enabled ? "text-risk" : "text-aqua"} />
        <StatCell label="执行结论" value={guard.decision || "-"} note={guard.allow_live ? "允许真实执行" : guard.allow_dry_run ? "仅允许 dry-run" : "阻断执行"} tone={guard.allow_live ? "text-risk" : guard.allow_dry_run ? "text-aqua" : "text-risk"} />
        <StatCell label="最终提交" value={finalGate.decision || "-"} note={finalGate.allow_submit ? "全部通过" : finalGate.blocked_reasons?.[0] || "等待预演"} tone={finalGate.allow_submit ? "text-aqua" : finalGate.ready_except_live_lock ? "text-sky-300" : "text-risk"} />
        <StatCell label="模拟盘状态" value={paperState?.running ? "运行中" : "已停止"} note={`权益 ${money(paperState?.equity)}U · 日内 ${paperState?.day_trades ?? 0} 笔`} />
      </div>

      <div className="mt-5 analysis-card">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.28em] text-slate-500">Live Actions</p>
            <h3 className="text-lg font-semibold text-white">实盘动作队列</h3>
            <p className="mt-1 text-sm text-slate-400">当前下一步：{submitPath.label} · {submitPath.note}</p>
          </div>
          <span className={`candidate-health ${submitPath.tone === "text-risk" ? "is-risk" : submitPath.tone === "text-aqua" ? "is-ok" : "is-info"}`}>
            {submitPath.label}
          </span>
        </div>
        <div className="mt-4 event-list">
          {liveActionRows.map((row) => (
            <div className="event-row" key={row.key}>
              <span className={`preflight-dot is-${row.status || "pending"}`} />
              <div>
                <strong>{row.title}</strong>
                <p>{row.detail}</p>
                <button type="button" className="mt-2 table-action" onClick={() => row.onClick?.()} disabled={row.disabled}>
                  {row.action}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-5 analysis-card">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.28em] text-slate-500">Preflight</p>
            <h3 className="text-lg font-semibold text-white">一键预演流程</h3>
            <p className="mt-1 text-sm text-slate-400">刷新 OKX、运行诊断、生成执行预演并更新最终门槛。</p>
          </div>
          <button type="button" className="table-action" onClick={() => onRunLivePreflight?.()} disabled={preflightLoading}>
            {preflightLoading ? "预演中..." : "一键预演"}
          </button>
        </div>
        <div className="mt-4 risk-grid">
          <StatCell label="预演结论" value={preflight.label} note={preflight.note} tone={preflight.tone} />
          <StatCell label="OKX诊断" value={okxDiagnostics?.readonly_ok ? "通过" : okxDiagnostics ? "需处理" : "-"} note={diagnosticLabel(okxDiagnostics?.category)} tone={okxDiagnostics?.readonly_ok ? "text-aqua" : "text-risk"} />
          <StatCell label="行情新鲜度" value={dataQuality.status === "fresh" ? "新鲜" : executionPlan ? "陈旧" : "-"} note={dataQuality.latest_closed ? `${dataQuality.source || "-"} · ${dataQuality.latest_closed}` : "等待预演"} tone={dataQuality.ok ? "text-aqua" : "text-risk"} />
          <StatCell label="订单意图" value={intent ? "已生成" : "未生成"} note={intent?.side ? `${intent.side} ${money(intent.notional)}U` : executionPlan ? "等待 ready 信号" : "等待预演"} tone={intent ? "text-aqua" : "text-sky-300"} />
          <StatCell label="最终门槛" value={finalGate.decision || "-"} note={finalGate.blocked_reasons?.[0] || "等待预演"} tone={finalGate.allow_submit ? "text-aqua" : finalGate.ready_except_live_lock ? "text-sky-300" : "text-risk"} />
        </div>
        <div className="mt-4 event-list">
          {(preflightSteps?.length ? preflightSteps : [
            { key: "environment", label: "刷新环境", status: "pending", detail: "等待一键预演" },
            { key: "diagnostics", label: "OKX诊断", status: "pending", detail: "等待一键预演" },
            { key: "dry_run", label: "执行预演", status: "pending", detail: "等待一键预演" },
            { key: "ledger", label: "同步审计", status: "pending", detail: "等待一键预演" },
          ]).map((step) => (
            <div className="event-row" key={step.key}>
              <span className={`preflight-dot is-${step.status || "pending"}`} />
              <div>
                <strong>{step.label}</strong>
                <p>{step.detail || "-"}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-5 analysis-card">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.28em] text-slate-500">Submit Path</p>
            <h3 className="text-lg font-semibold text-white">提交路径解释</h3>
            <p className="mt-1 text-sm text-slate-400">把密钥、只读账户、行情、订单意图、持仓和实盘总锁合成当前下一步。</p>
          </div>
          <span className={`candidate-health ${submitPath.tone === "text-risk" ? "is-risk" : "is-ok"}`}>
            {submitPath.label}
          </span>
        </div>
        <div className="mt-4 risk-grid">
          <StatCell label="当前下一步" value={submitPath.label} note={submitPath.note} tone={submitPath.tone} />
          <StatCell label="硬阻断" value={`${submitPath.rows.filter((row) => row.status === "fail").length} 项`} note="必须先处理" tone={submitPath.rows.some((row) => row.status === "fail") ? "text-risk" : "text-aqua"} />
          <StatCell label="等待/观察" value={`${submitPath.rows.filter((row) => ["pending", "warn"].includes(row.status)).length} 项`} note="不会自动真实下单" tone="text-sky-300" />
        </div>
        <div className="mt-4 event-list">
          {submitPath.rows.map((row) => (
            <div className="event-row" key={row.key}>
              <span className={`preflight-dot is-${row.status}`} />
              <div>
                <strong>{row.label}</strong>
                <p>{row.detail || "-"}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-5 analysis-card">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.28em] text-slate-500">Submit Confirmation</p>
            <h3 className="text-lg font-semibold text-white">提交确认控制台</h3>
            <p className="mt-1 text-sm text-slate-400">确认短语、最终门槛、提交拒绝和执行账本的集中检查；当前仍只做锁测试和审计。</p>
          </div>
          <span className={`candidate-health ${confirmationMatches ? "is-ok" : "is-risk"}`}>
            {confirmationMatches ? "短语匹配" : "等待短语"}
          </span>
        </div>
        <div className="mt-4 task-detail-grid">
          <div>
            <span>EXPECTED</span>
            <strong>{expectedConfirmation}</strong>
            <p>真实提交前必须显式输入的确认短语。</p>
          </div>
          <div>
            <span>FINAL GATE</span>
            <strong>{finalGate.decision || "等待预演"}</strong>
            <p>{finalGate.blocked_reasons?.[0] || "生成执行预演后显示最终门槛。"}</p>
          </div>
          <div>
            <span>LAST REJECT</span>
            <strong>{recentLiveReject ? auditTimeLabel(recentLiveReject.time) : "-"}</strong>
            <p>{recentLiveReject?.rejection_reasons?.[0] || liveSubmitBlocked[0] || "暂无提交拒绝审计。"}</p>
          </div>
        </div>
        <div className="mt-4 grid gap-3 xl:grid-cols-[1fr_auto_auto]">
          <label className="param-input live-risk-input">
            <input
              autoComplete="off"
              placeholder={expectedConfirmation}
              value={submitConfirmation}
              onChange={(event) => setSubmitConfirmation(event.target.value)}
            />
            <em>确认短语输入</em>
          </label>
          <button type="button" className="table-action" onClick={() => onRunLiveSubmitLockTest?.("")} disabled={liveSubmitLoading}>
            {liveSubmitLoading ? "测试中..." : "空短语锁测试"}
          </button>
          <button type="button" className="table-action" onClick={() => onRunLiveSubmitLockTest?.(submitConfirmation.trim())} disabled={liveSubmitLoading || !confirmationMatches}>
            {liveSubmitLoading ? "测试中..." : "确认短语锁测试"}
          </button>
        </div>
        <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_.9fr]">
          <div className="overflow-x-auto rounded-[18px] border border-white/10">
            <table className="trade-table">
              <thead><tr><th>锁检查</th><th>当前值</th><th>门槛</th><th>状态</th><th>动作</th></tr></thead>
              <tbody>
                {liveSubmitChecks.length ? liveSubmitChecks.map((row) => (
                  <tr key={row.name}>
                    <td>{row.name}</td>
                    <td>{guardValueLabel(row)}</td>
                    <td>{row.threshold || "-"}</td>
                    <td><span className={`candidate-health ${row.passed ? "is-ok" : "is-risk"}`}>{row.passed ? "通过" : row.status === "live_lock" ? "锁定" : "阻断"}</span></td>
                    <td>{row.action || "-"}</td>
                  </tr>
                )) : (
                  <tr><td colSpan="5">运行提交锁测试后显示后端拒绝检查明细。</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="task-detail-panel">
            <div className="task-detail-header">
              <div>
                <span>BLOCKED REASONS</span>
                <h4>{liveSubmitResult?.decision || "等待锁测试"}</h4>
                <p>{liveSubmitResult?.intent_fingerprint || recentLiveReject?.intent_fingerprint || "没有订单意图指纹。"}</p>
              </div>
              <span className={`snapshot-quality ${liveSubmitResult ? "is-bad" : "is-info"}`}>{liveSubmitResult ? "已拒绝" : "未测试"}</span>
            </div>
            <div className="task-detail-meta">
              {(liveSubmitBlocked.length ? liveSubmitBlocked : ["运行空短语或确认短语锁测试后，后端拒绝原因会写入这里。"]).slice(0, 4).map((reason) => (
                <div key={reason}>
                  <span>REASON</span>
                  <p>{reason}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="mt-5 analysis-card">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.28em] text-slate-500">Live Environment</p>
            <h3 className="text-lg font-semibold text-white">实盘环境锁</h3>
            <p className="mt-1 text-sm text-slate-400">只显示配置是否存在，不显示任何密钥内容；当前版本真实提交接口只做锁检查和审计。</p>
          </div>
          <button type="button" className="table-action" onClick={() => onRefreshExecutionConfig?.()} disabled={executionConfigLoading}>
            {executionConfigLoading ? "读取中..." : "刷新环境"}
          </button>
        </div>
        <div className="mt-4 risk-grid">
          <StatCell label="OKX密钥" value={executionConfig?.okx_configured ? "齐全" : "缺失"} note={Object.entries(okxKeys).map(([key, ok]) => `${key.replace("OKX_", "")}:${ok ? "有" : "无"}`).join(" · ") || "-"} tone={executionConfig?.okx_configured ? "text-aqua" : "text-risk"} />
          <StatCell label="连接器" value={executionConfig?.connector || "-"} note={executionConfig?.live_submit_available ? "可提交" : "真实提交未开放"} />
          <StatCell label="确认短语" value={executionConfig?.confirmation_phrase || "-"} note="真实提交还需二次确认" />
        </div>
        <form className="mt-4 grid gap-3 xl:grid-cols-[1fr_1fr_1fr_auto]" onSubmit={submitCredentials}>
          <label className="param-input">
            <input
              autoComplete="off"
              placeholder="OKX_API_KEY"
              type="password"
              value={credentialForm.api_key}
              onChange={(event) => updateCredentialField("api_key", event.target.value)}
            />
            <em>API Key</em>
          </label>
          <label className="param-input">
            <input
              autoComplete="off"
              placeholder="OKX_API_SECRET"
              type="password"
              value={credentialForm.api_secret}
              onChange={(event) => updateCredentialField("api_secret", event.target.value)}
            />
            <em>Secret</em>
          </label>
          <label className="param-input">
            <input
              autoComplete="off"
              placeholder="OKX_API_PASSPHRASE"
              type="password"
              value={credentialForm.api_passphrase}
              onChange={(event) => updateCredentialField("api_passphrase", event.target.value)}
            />
            <em>Passphrase</em>
          </label>
          <button type="submit" className="table-action" disabled={okxCredentialsLoading}>
            {okxCredentialsLoading ? "保存中..." : "保存密钥"}
          </button>
        </form>
        <label className="mt-3 flex items-center gap-2 text-sm text-slate-400">
          <input
            type="checkbox"
            checked={credentialForm.simulated}
            onChange={(event) => updateCredentialField("simulated", event.target.checked)}
          />
          使用 OKX 模拟盘标记
        </label>
        <p className="mt-2 text-xs text-slate-500">{credentialStatus || "密钥只保存到当前后端进程，不写入仓库文件；后端重启后需要重新输入。"}</p>
      </div>

      <div className="mt-5 analysis-card">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.28em] text-slate-500">Risk Link</p>
            <h3 className="text-lg font-semibold text-white">账户风险联动</h3>
            <p className="mt-1 text-sm text-slate-400">执行保护优先使用 OKX 只读权益和真实持仓；不可用时回退模拟盘权益。</p>
          </div>
          <button type="button" className="table-action" onClick={() => onRefreshExecutionEnvironment?.()} disabled={executionEnvironmentLoading}>
            {executionEnvironmentLoading ? "联动中..." : "刷新联动"}
          </button>
        </div>
        <div className="mt-4 risk-grid">
          <StatCell label="权益来源" value={executionPlan?.equity_source || executionEnvironment?.equity_source || "paper"} note={executionEnvironment?.readonly_ready ? "OKX只读可用" : "回退模拟盘"} tone={executionEnvironment?.readonly_ready ? "text-aqua" : "text-risk"} />
          <StatCell label="保护权益" value={money(executionPlan?.guard?.equity ?? envOkx.total_equity_usd ?? paperState?.equity)} note={`模拟 ${money(paperState?.equity)}U · OKX ${money(envOkx.total_equity_usd)}U`} />
          <StatCell label="真实持仓" value={`${executionPlan?.guard?.okx_position_count ?? executionEnvironment?.position_count ?? envPositions.count ?? 0} 个`} note=">0 时阻断新开仓" tone={(executionPlan?.guard?.okx_position_count ?? executionEnvironment?.position_count ?? 0) > 0 ? "text-risk" : "text-aqua"} />
        </div>
        <div className="mt-4 grid gap-3 xl:grid-cols-[1fr_1fr_auto_auto]">
          <label className="param-input live-risk-input">
            <input
              min="0"
              step="0.0001"
              type="number"
              value={Number.isFinite(minLiveEquity) ? minLiveEquity : 10}
              onChange={(event) => updateLiveRiskNumber("min_live_equity_usd", event.target.value)}
            />
            <em>最低实盘权益 USDT</em>
          </label>
          <label className="param-input live-risk-input">
            <input
              min="1"
              step="0.05"
              type="number"
              value={Number.isFinite(marginBufferMult) ? marginBufferMult : 1.2}
              onChange={(event) => updateLiveRiskNumber("live_margin_buffer_mult", event.target.value)}
            />
            <em>保证金缓冲倍数</em>
          </label>
          <button
            type="button"
            className="table-action"
            disabled={!Number.isFinite(okxEquityNumber) || okxEquityNumber <= 0}
            onClick={() => onLiveRiskConfigChange?.({ min_live_equity_usd: Number(okxEquityNumber.toFixed(6)) })}
          >
            使用OKX权益
          </button>
          <button type="button" className="table-action" onClick={() => onLiveRiskConfigChange?.({ min_live_equity_usd: 10 })}>
            恢复10U
          </button>
        </div>
        <p className="mt-2 text-xs text-slate-500">改动只影响 dry-run 的最终提交门槛，不会开启真实下单。</p>
      </div>

      <div className="mt-5 analysis-card">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.28em] text-slate-500">OKX Diagnostics</p>
            <h3 className="text-lg font-semibold text-white">OKX 连接诊断</h3>
            <p className="mt-1 text-sm text-slate-400">只做只读探测，定位密钥、签名时间、IP 白名单、权限或网络问题。</p>
          </div>
          <button type="button" className="table-action" onClick={() => onRunOkxDiagnostics?.()} disabled={okxDiagnosticsLoading}>
            {okxDiagnosticsLoading ? "诊断中..." : "运行诊断"}
          </button>
        </div>
        <div className="mt-4 risk-grid">
          <StatCell label="诊断状态" value={okxDiagnostics?.readonly_ok ? "通过" : okxDiagnostics ? "需处理" : "-"} note={okxDiagnostics?.updated_at || "等待诊断"} tone={okxDiagnostics?.readonly_ok ? "text-aqua" : "text-risk"} />
          <StatCell label="问题分类" value={diagnosticLabel(okxDiagnostics?.category)} note={okxDiagnostics?.local_utc ? `UTC ${okxDiagnostics.local_utc}` : "-"} />
          <StatCell label="只读账户" value={okxDiagnostics?.readonly_ok ? "可用" : "不可用"} note={okxDiagnostics?.status?.simulated ? "模拟盘标记开启" : okxDiagnostics?.status?.base_url || "-"} tone={okxDiagnostics?.readonly_ok ? "text-aqua" : "text-risk"} />
        </div>
        <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_.9fr]">
          <div className="overflow-x-auto rounded-[18px] border border-white/10">
            <table className="trade-table">
              <thead><tr><th>步骤</th><th>状态</th><th>分类</th><th>返回码</th><th>信息</th></tr></thead>
              <tbody>
                {diagnosticSteps.length ? diagnosticSteps.map((step) => (
                  <tr key={step.name}>
                    <td>{step.name}</td>
                    <td><span className={`candidate-health ${step.ok ? "is-ok" : "is-risk"}`}>{step.ok ? "通过" : "失败"}</span></td>
                    <td>{diagnosticLabel(step.category)}</td>
                    <td>{step.code || "-"}</td>
                    <td>{step.message || "-"}</td>
                  </tr>
                )) : (
                  <tr><td colSpan="5">{okxDiagnosticsLoading ? "正在运行 OKX 连接诊断..." : "暂无诊断结果。"}</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="rounded-[18px] border border-white/10 p-4">
            <p className="text-sm font-semibold text-white">建议动作</p>
            <div className="mt-3 space-y-2 text-sm text-slate-300">
              {diagnosticActions.length ? diagnosticActions.map((action) => (
                <p key={action}>{action}</p>
              )) : (
                <p>运行诊断后显示下一步处理动作。</p>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="mt-5 analysis-card">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.28em] text-slate-500">OKX Read Only</p>
            <h3 className="text-lg font-semibold text-white">OKX 只读账户</h3>
            <p className="mt-1 text-sm text-slate-400">只调用账户余额和持仓查询，不开放下单、撤单或转账。</p>
          </div>
          <button type="button" className="table-action" onClick={() => onRefreshOkxReadonly?.()} disabled={okxLoading}>
            {okxLoading ? "读取中..." : "刷新OKX"}
          </button>
        </div>
        <div className="mt-4 risk-grid">
          <StatCell label="连接状态" value={envOkx?.ok ? "已连接" : envOkx?.configured ? "读取失败" : "未配置"} note={envOkx?.error || envOkx?.config?.base_url || "-"} tone={envOkx?.ok ? "text-aqua" : "text-risk"} />
          <StatCell label="账户权益" value={money(envOkx?.total_equity_usd)} note={`Adj ${money(envOkx?.adjusted_equity_usd)}U`} />
          <StatCell label="SWAP持仓" value={`${envPositions?.count ?? 0} 个`} note={envPositions?.error || `${envPositions?.raw_count ?? 0} 条原始记录`} />
        </div>
        <div className="mt-4 overflow-x-auto rounded-[18px] border border-white/10">
          <table className="trade-table">
            <thead><tr><th>合约</th><th>方向</th><th>数量</th><th>均价</th><th>标记价</th><th>名义价值</th><th>未实现PnL</th><th>杠杆</th></tr></thead>
            <tbody>
              {okxRows.length ? okxRows.slice(0, 8).map((row) => (
                <tr key={`${row.inst_id}-${row.pos_side}`}>
                  <td>{row.inst_id?.replace("-SWAP", "") || "-"}</td>
                  <td>{row.side || row.pos_side || "-"}</td>
                  <td>{money(row.pos)}</td>
                  <td>{money(row.avg_px)}</td>
                  <td>{money(row.mark_px)}</td>
                  <td>{money(row.notional_usd)}</td>
                  <td className={Number(row.u_pnl || 0) >= 0 ? "text-aqua" : "text-risk"}>{money(row.u_pnl)}</td>
                  <td>{row.leverage ? `${row.leverage}x` : "-"}</td>
                </tr>
              )) : (
                <tr><td colSpan="8">{okxLoading ? "正在读取 OKX 只读数据..." : okxAccount?.configured ? "当前无 SWAP 持仓或读取失败。" : "未配置 OKX 只读密钥。"}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-5 analysis-card">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.28em] text-slate-500">Execution Dry Run</p>
            <h3 className="text-lg font-semibold text-white">订单意图预演</h3>
            <p className="mt-1 text-sm text-slate-400">只生成执行计划和保护检查，写入审计日志，不连接 OKX 私钥，不发送真实订单。</p>
          </div>
          <button type="button" className="table-action" onClick={() => onRunExecutionPlan?.()} disabled={executionLoading}>
            {executionLoading ? "预演中..." : "生成执行预演"}
          </button>
        </div>
        <div className="mt-4 risk-grid">
          <StatCell label="订单方向" value={intent?.side || "-"} note={intent?.kind || "等待 ready 信号"} />
          <StatCell label="名义金额" value={money(intent?.notional)} note={`保证金 ${money(intent?.margin_used)}U`} />
          <StatCell label="杠杆" value={intent?.leverage ? `${Number(intent.leverage).toFixed(1)}x` : "-"} note={`数量 ${intent?.qty ? Number(intent.qty).toFixed(6) : "-"}`} />
          <StatCell label="入场" value={money(intent?.entry)} note={`止损 ${money(intent?.stop)}`} />
          <StatCell label="止盈" value={money(intent?.take_profit)} note={`强平 ${money(intent?.liquidation_price)}`} />
          <StatCell label="准入引用" value={intent?.readiness_score === undefined ? "-" : `${intent.readiness_score}/100`} note={intent?.readiness_decision || "-"} />
        </div>
        <div className="mt-4 risk-grid">
          <StatCell label="交易所规则" value={exchangeValidation?.ok ? "通过" : executionPlan ? "未通过" : "-"} note={exchangeValidation?.message || "等待执行预演"} tone={exchangeValidation?.ok ? "text-aqua" : "text-risk"} />
          <StatCell label="OKX张数" value={exchangeValidation?.order_size_contracts ?? "-"} note={`原始 ${exchangeValidation?.raw_contracts ?? "-"} · 最小 ${exchangeValidation?.min_size ?? "-"}`} />
          <StatCell label="合约面值" value={instrumentRules?.contract_value ?? "-"} note={`${instrumentRules?.contract_value_ccy || "-"} · lot ${instrumentRules?.lot_size ?? "-"}`} />
          <StatCell label="价格精度" value={instrumentRules?.tick_size ?? "-"} note={exchangeValidation?.warnings?.[0] || `入场 ${exchangeValidation?.normalized_prices?.entry ?? "-"}`} />
        </div>
        <div className="mt-4 overflow-x-auto rounded-[18px] border border-white/10">
          <table className="trade-table">
            <thead><tr><th>OKX字段</th><th>预览值</th><th>说明</th></tr></thead>
            <tbody>
              {Object.keys(okxOrderPayload).length ? Object.entries(okxOrderPayload).map(([key, value]) => (
                <tr key={key}>
                  <td>{key}</td>
                  <td>{String(value)}</td>
                  <td>{key === "sz" ? "合约张数" : key === "px" ? "按 tickSz 规整后的限价" : key === "tdMode" ? "保证金模式" : key === "clOrdId" ? "客户端幂等ID" : "-"}</td>
                </tr>
              )) : (
                <tr><td colSpan="3">{executionPlan ? okxOrderPreview?.message || "当前无法生成 OKX 下单预览。" : "生成执行预演后显示 OKX 下单 payload。"}</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-slate-500">{okxOrderPreview?.endpoint || "POST /api/v5/trade/order"} · {okxOrderPreview?.dry_run_only === false ? "可提交" : "仅预览，不提交"}</p>
        {!intent ? (
          <p className="mt-4 text-sm text-slate-400">{executionPlan ? "当前没有 ready 信号，因此没有生成订单意图。" : "点击生成执行预演后查看订单意图。"}</p>
        ) : null}
      </div>

      <div className="mt-5 analysis-card">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.28em] text-slate-500">Final Gate</p>
            <h3 className="text-lg font-semibold text-white">最终提交门槛</h3>
            <p className="mt-1 text-sm text-slate-400">独立复核账户权益、真实持仓、交易所规则、payload 和实盘锁；当前仍不发送真实订单。</p>
          </div>
          <span className={`candidate-health ${finalGate.allow_submit ? "is-ok" : "is-risk"}`}>
            {finalGate.decision || "等待预演"}
          </span>
        </div>
        <div className="mt-4 risk-grid">
          <StatCell label="OKX权益" value={`${money(finalGate.account_equity ?? envOkx.total_equity_usd)}U`} note={executionPlan?.equity_source || executionEnvironment?.equity_source || "paper"} tone={(Number(finalGate.account_equity ?? envOkx.total_equity_usd) || 0) >= (Number(finalGate.min_live_equity_usd) || 10) ? "text-aqua" : "text-risk"} />
          <StatCell label="最低权益" value={`${money(finalGate.min_live_equity_usd)}U`} note="min_live_equity_usd" />
          <StatCell label="保证金缓冲" value={`${money(finalGate.required_margin_buffer)}U`} note="计划保证金 x 缓冲倍数" />
          <StatCell label="真实持仓" value={`${finalGate.okx_position_count ?? executionEnvironment?.position_count ?? envPositions.count ?? 0} 个`} note="必须为 0" tone={(finalGate.okx_position_count ?? executionEnvironment?.position_count ?? 0) > 0 ? "text-risk" : "text-aqua"} />
        </div>
        <div className="mt-4 overflow-x-auto rounded-[18px] border border-white/10">
          <table className="trade-table">
            <thead><tr><th>检查项</th><th>当前值</th><th>门槛</th><th>状态</th><th>动作</th></tr></thead>
            <tbody>
              {finalChecks.length ? finalChecks.map((row) => (
                <tr key={row.name}>
                  <td>{row.name}</td>
                  <td>{guardValueLabel(row)}</td>
                  <td>{row.threshold || "-"}</td>
                  <td><span className={`candidate-health ${row.passed ? "is-ok" : "is-risk"}`}>{row.passed ? "通过" : row.severity === "live_lock" ? "锁定" : "阻断"}</span></td>
                  <td>{row.action || "-"}</td>
                </tr>
              )) : (
                <tr><td colSpan="5">生成执行预演后显示最终提交门槛。</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-[1fr_.9fr]">
        <div className="analysis-card">
          <h3 className="text-lg font-semibold text-white">执行保护检查</h3>
          <div className="mt-4 overflow-x-auto rounded-[18px] border border-white/10">
            <table className="trade-table">
              <thead><tr><th>检查项</th><th>结果</th><th>阈值</th><th>状态</th><th>处理动作</th></tr></thead>
              <tbody>
                {checks.length ? checks.map((row) => (
                  <tr key={row.name}>
                    <td>{row.name}</td>
                    <td>{guardValueLabel(row)}</td>
                    <td>{row.threshold || "-"}</td>
                    <td><span className={`candidate-health ${row.passed ? "is-ok" : row.severity === "live_lock" ? "is-risk" : "is-risk"}`}>{row.passed ? "通过" : row.severity === "live_lock" ? "锁定" : "阻断"}</span></td>
                    <td>{row.action || "-"}</td>
                  </tr>
                )) : (
                  <tr><td colSpan="5">暂无执行检查结果。</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
        <div className="analysis-card">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h3 className="text-lg font-semibold text-white">真实提交锁测试</h3>
              <p className="mt-1 text-sm text-slate-400">发送一次无确认短语的提交请求，验证后端会拒绝并写入审计。</p>
            </div>
            <button type="button" className="table-action" onClick={() => onRunLiveSubmitLockTest?.()} disabled={liveSubmitLoading}>
              {liveSubmitLoading ? "测试中..." : "测试提交锁"}
            </button>
          </div>
          {liveSubmitResult ? (
            <div className="mt-4 event-list">
              <div className="event-row"><span /><div><strong>{liveSubmitResult.decision || "-"}</strong><p>{(liveSubmitResult.blocked_reasons || []).slice(0, 2).join(" / ") || "无阻断原因"}</p></div></div>
            </div>
          ) : null}
          <h3 className="mt-5 text-lg font-semibold text-white">最近执行审计</h3>
          {recentExecution ? (
            <div className="mt-4 event-list">
              <div className="event-row"><span /><div><strong>{auditTimeLabel(recentExecution.time)}</strong><p>{auditResultLabel(recentExecution)} · {recentExecution.execution_guard?.decision || "-"}</p></div></div>
              <div className="event-row"><span /><div><strong>订单</strong><p>{recentExecution.order_intent ? `${recentExecution.order_intent.side || "-"} ${money(recentExecution.order_intent.notional)}U @ ${money(recentExecution.order_intent.entry)}` : "未生成订单意图"}</p></div></div>
              <div className="event-row"><span /><div><strong>锁定</strong><p>{recentExecution.execution_guard?.live_trading_enabled ? "实盘开关已开启" : "LIVE_TRADING_ENABLED 未开启，真实下单锁定。"}</p></div></div>
            </div>
          ) : (
            <p className="mt-4 text-sm text-slate-400">暂无执行预演审计。</p>
          )}
        </div>
      </div>

      <div className="mt-5 analysis-card">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.28em] text-slate-500">Execution Ledger</p>
            <h3 className="text-lg font-semibold text-white">执行账本</h3>
            <p className="mt-1 text-sm text-slate-400">按订单意图哈希记录 dry-run 和提交拒绝，用于识别重复信号和防止重复提交。</p>
          </div>
          <button type="button" className="table-action" onClick={() => onRefreshExecutionOrders?.()} disabled={executionOrdersLoading}>
            {executionOrdersLoading ? "刷新中..." : "刷新账本"}
          </button>
        </div>
        <div className="mt-4 overflow-x-auto rounded-[18px] border border-white/10">
          <table className="trade-table">
            <thead><tr><th>时间</th><th>事件</th><th>状态</th><th>指纹</th><th>品种</th><th>方向</th><th>名义金额</th><th>决策</th><th>操作</th></tr></thead>
            <tbody>
              {ledgerRows.length ? ledgerRows.map((row, index) => {
                const key = ledgerRowKey(row, index);
                return (
                <tr key={key}>
                  <td>{auditTimeLabel(row.time)}</td>
                  <td>{ledgerEventLabel(row.event)}</td>
                  <td><span className={`snapshot-quality ${ledgerStatusTone(row)}`}>{row.duplicate_intent ? "重复" : row.status || "-"}</span></td>
                  <td>{row.intent_fingerprint || "-"}</td>
                  <td>{row.inst_id?.replace("-SWAP", "") || "-"}</td>
                  <td>{row.side || "-"}</td>
                  <td>{money(row.notional)}</td>
                  <td>{row.guard_decision || row.rejection_reasons?.[0] || "-"}</td>
                  <td><button type="button" className="table-action" onClick={() => setSelectedLedgerKey(key)}>详情</button></td>
                </tr>
              );}) : (
                <tr><td colSpan="9">{executionOrdersLoading ? "正在读取执行账本..." : "暂无执行账本记录。"}</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="mt-4 task-detail-panel">
          <div className="task-detail-header">
            <div>
              <span>LEDGER DETAIL</span>
              <h4>账本详情</h4>
              <p>{selectedLedgerRow ? `${auditTimeLabel(selectedLedgerRow.time)} · ${ledgerEventLabel(selectedLedgerRow.event)} · ${selectedLedgerRow.intent_fingerprint || "无指纹"}` : "选择一条执行账本记录查看 payload、final gate 和拒绝原因。"}</p>
            </div>
            <span className={`snapshot-quality ${selectedLedgerRow ? ledgerStatusTone(selectedLedgerRow) : "is-info"}`}>{selectedLedgerRow ? selectedLedgerRow.status || "-" : "待选择"}</span>
          </div>
          {selectedLedgerRow ? (
            <>
              <div className="task-detail-grid">
                <div>
                  <span>ORDER</span>
                  <strong>{selectedLedgerRow.order_intent ? `${selectedLedgerRow.side || "-"} ${money(selectedLedgerRow.notional)}U` : "无订单意图"}</strong>
                  <p>{selectedLedgerRow.inst_id || "-"} · {selectedLedgerRow.bar || "-"}</p>
                </div>
                <div>
                  <span>FINAL GATE</span>
                  <strong>{selectedLedgerFinalGate.decision || "-"}</strong>
                  <p>{selectedLedgerFinalGate.allow_submit ? "允许提交" : selectedLedgerFinalGate.blocked_reasons?.[0] || "无最终门槛说明"}</p>
                </div>
                <div>
                  <span>EXCHANGE</span>
                  <strong>{selectedLedgerValidation.ok ? "通过" : selectedLedgerValidation.status || "-"}</strong>
                  <p>{selectedLedgerValidation.message || selectedLedgerOrder.message || "-"}</p>
                </div>
              </div>
              <div className="mt-2 grid gap-4 xl:grid-cols-[1fr_1fr]">
                <div className="overflow-x-auto rounded-[16px] border border-white/10">
                  <table className="trade-table">
                    <thead><tr><th>Final Gate 检查</th><th>状态</th><th>动作</th></tr></thead>
                    <tbody>
                      {selectedLedgerChecks.length ? selectedLedgerChecks.map((row) => (
                        <tr key={row.name}>
                          <td>{row.name}</td>
                          <td><span className={`candidate-health ${row.passed ? "is-ok" : "is-risk"}`}>{row.passed ? "通过" : row.status === "live_lock" ? "锁定" : "阻断"}</span></td>
                          <td>{row.action || "-"}</td>
                        </tr>
                      )) : (
                        <tr><td colSpan="3">这条记录没有 final gate 明细。</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
                <div className="task-detail-meta">
                  {(selectedLedgerReasons.length ? selectedLedgerReasons : ["没有拒绝原因，或该记录不是提交拒绝事件。"]).slice(0, 6).map((reason) => (
                    <div key={reason}>
                      <span>REJECTION</span>
                      <p>{reason}</p>
                    </div>
                  ))}
                </div>
              </div>
              <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_1fr]">
                <div className="overflow-x-auto rounded-[16px] border border-white/10">
                  <table className="trade-table">
                    <thead><tr><th>OKX Payload</th><th>值</th></tr></thead>
                    <tbody>
                      {Object.keys(selectedLedgerPayload).length ? Object.entries(selectedLedgerPayload).map(([key, value]) => (
                        <tr key={key}><td>{key}</td><td>{String(value)}</td></tr>
                      )) : (
                        <tr><td colSpan="2">{selectedLedgerOrder.message || "没有 OKX payload。"}</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
                <div className="ledger-json-panel">
                  <span>Payload / Gate JSON</span>
                  <pre>{JSON.stringify({
                    intent: selectedLedgerRow.order_intent,
                    exchange_validation: selectedLedgerValidation,
                    okx_order: selectedLedgerOrder,
                    final_gate: selectedLedgerFinalGate,
                  }, null, 2)}</pre>
                </div>
              </div>
            </>
          ) : (
            <div className="task-detail-empty">当前没有执行账本记录。</div>
          )}
        </div>
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

function recommendationTargetView(area) {
  if (area && typeof area === "object") return area.target_view || recommendationTargetView(area.area);
  const mapping = {
    数据: "数据",
    实盘: "实盘",
    策略: "策略",
    执行: "实盘",
    任务: "数据",
    系统: "设置",
  };
  return mapping[area] || "设置";
}

function recommendationTaskPayload(row = {}, batchSize = 4) {
  if (row.task?.type) {
    return {
      type: row.task.type,
      params: { ...(row.task.params || {}), max_items: batchSize },
    };
  }
  if (row.area !== "数据") return null;
  const title = String(row.title || "");
  return {
    type: "data_refresh",
    params: {
      stale: true,
      max_items: batchSize,
      recommended_only: title.includes("建议"),
    },
  };
}

export function SettingsView({
  theme,
  sidebarCollapsed,
  liveRiskConfig,
  executionConfig,
  executionEnvironment,
  dataRefreshBatchSize,
  paperState,
  portfolio,
  dataStatus,
  systemStatus,
  systemStatusLoading,
  onThemeChange,
  onSidebarCollapsedChange,
  onLiveRiskConfigChange,
  onDataRefreshBatchSizeChange,
  onRefreshSystemStatus,
  onStartTask,
  taskLoading,
  onOpenView,
  onRefreshAll,
  refreshAllLoading,
}) {
  const readonlyReady = Boolean(executionEnvironment?.readonly_ready);
  const liveSwitch = Boolean(executionConfig?.live_trading_enabled);
  const cacheRows = dataStatus?.rows || [];
  const staleRows = cacheRows.filter((row) => row.is_stale);
  const systemCache = systemStatus?.cache || {};
  const systemTasks = systemStatus?.tasks || {};
  const systemFiles = systemStatus?.files || {};
  const systemRecommendations = systemStatus?.recommendations || [];
  const taskCountsText = Object.entries(systemTasks.counts || {}).map(([key, value]) => `${key} ${value}`).join(" · ") || "无任务";
  const fileRows = [
    ["paper_state", "模拟盘状态"],
    ["paper_events", "模拟事件"],
    ["paper_audit", "审计记录"],
    ["execution_orders", "执行账本"],
    ["signal_log", "信号日志"],
    ["task_history", "任务历史"],
  ].map(([key, label]) => ({ key, label, ...(systemFiles[key] || {}) }));
  const branches = [
    { name: "市场", state: "已接入", detail: `${cacheRows.length || "-"} 个缓存市场 · 陈旧 ${staleRows.length}` },
    { name: "策略", state: paperState?.running ? "运行中" : "已停止", detail: `模拟权益 ${money(paperState?.equity)}U` },
    { name: "回测", state: portfolio?.summary ? "有结果" : "待运行", detail: portfolio?.summary ? `收益 ${pct(portfolio.summary.return_pct)} · 交易 ${portfolio.summary.trades}` : "等待组合回测" },
    { name: "实盘", state: readonlyReady ? "只读已连" : "待配置", detail: liveSwitch ? "实盘总开关已开启" : "真实下单锁关闭" },
    { name: "风控", state: paperState?.circuit_breaker?.allow_trade === false ? "阻断" : "允许", detail: `连亏 ${paperState?.consecutive_losses ?? 0} · 日内 ${paperState?.day_trades ?? 0}` },
    { name: "数据", state: staleRows.length ? "需刷新" : "正常", detail: `${cacheRows.length || 0} 项缓存检查` },
  ];
  const missingFileRows = fileRows.filter((row) => !row.exists);
  const activeTaskCount = Number(systemTasks.active_count || 0);
  const queueDepth = Number(systemTasks.queue_depth || 0);
  const highRecommendations = systemRecommendations.filter((row) => ["high", "medium"].includes(row.priority));
  const systemEvidenceRows = [
    {
      name: "缓存新鲜度",
      value: `${staleRows.length}/${cacheRows.length || 0}`,
      status: staleRows.length ? "需维护" : "正常",
      tone: staleRows.length ? "is-bad" : "is-good",
      action: staleRows.length ? "打开数据页刷新陈旧缓存。" : "缓存状态保持观察。",
    },
    {
      name: "后台任务",
      value: `${activeTaskCount} 活跃 / ${queueDepth} 排队`,
      status: activeTaskCount || queueDepth ? "运行中" : "空闲",
      tone: activeTaskCount || queueDepth ? "is-info" : "is-good",
      action: activeTaskCount || queueDepth ? "在数据页跟踪任务详情。" : "无需处理。",
    },
    {
      name: "关键账本",
      value: `${fileRows.length - missingFileRows.length}/${fileRows.length}`,
      status: missingFileRows.length ? "缺失" : "齐全",
      tone: missingFileRows.length ? "is-bad" : "is-good",
      action: missingFileRows.length ? `复核 ${missingFileRows.map((row) => row.label).join("、")}。` : "关键文件均存在。",
    },
    {
      name: "实盘总锁",
      value: liveSwitch ? "开启" : "关闭",
      status: liveSwitch ? "高风险" : "安全",
      tone: liveSwitch ? "is-bad" : "is-good",
      action: liveSwitch ? "确认确实需要真实下单，否则关闭总锁。" : "真实下单仍被总锁保护。",
    },
    {
      name: "OKX只读",
      value: readonlyReady ? "已连接" : "未连接",
      status: readonlyReady ? "通过" : "待处理",
      tone: readonlyReady ? "is-good" : "is-warn",
      action: readonlyReady ? "可用于实盘门槛复核。" : "去实盘页运行 OKX 诊断或输入密钥。",
    },
    {
      name: "维护建议",
      value: String(systemRecommendations.length),
      status: highRecommendations.length ? "优先处理" : "观察",
      tone: highRecommendations.length ? "is-bad" : systemRecommendations.length ? "is-info" : "is-good",
      action: highRecommendations[0]?.action || "没有高优先级维护建议。",
    },
  ];
  const minLiveEquity = Number(liveRiskConfig?.min_live_equity_usd ?? 10);
  const marginBufferMult = Number(liveRiskConfig?.live_margin_buffer_mult ?? 1.2);
  const updateLiveNumber = (key, value) => {
    const number = Number(value);
    if (Number.isFinite(number)) onLiveRiskConfigChange?.({ [key]: number });
  };

  return (
    <ViewShell title="设置" subtitle="全局外观、分支状态和实盘前门槛配置。">
      <div className="risk-grid">
        <StatCell label="主题" value={theme === "light" ? "白天" : "夜间"} note="影响全部工作区" />
        <StatCell label="侧栏" value={sidebarCollapsed ? "收起" : "展开"} note="桌面布局偏好" />
        <StatCell label="OKX只读" value={readonlyReady ? "已连接" : "未连接"} note={executionEnvironment?.okx_account?.error || executionConfig?.okx_base_url || "-"} tone={readonlyReady ? "text-aqua" : "text-risk"} />
        <StatCell label="实盘锁" value={liveSwitch ? "开启" : "关闭"} note="默认必须保持关闭" tone={liveSwitch ? "text-risk" : "text-aqua"} />
      </div>

      <div className="mt-5 analysis-card">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.28em] text-slate-500">System</p>
            <h3 className="text-lg font-semibold text-white">系统健康</h3>
            <p className="mt-1 text-sm text-slate-400">后端服务、缓存目录、任务历史和关键账本文件状态。</p>
          </div>
          <button type="button" className="table-action" onClick={() => onRefreshSystemStatus?.()} disabled={systemStatusLoading}>
            {systemStatusLoading ? "刷新中..." : "刷新系统"}
          </button>
        </div>
        <div className="mt-4 risk-grid">
          <StatCell label="后端服务" value={systemStatus?.ok ? "正常" : "待同步"} note={`启动 ${shortTime(systemStatus?.server?.started_at)}`} tone={systemStatus?.ok ? "text-aqua" : "text-risk"} />
          <StatCell label="缓存目录" value={bytesLabel(systemCache.size_bytes)} note={`${systemCache.file_count ?? 0} 个文件 · 陈旧 ${systemCache.stale_rows ?? staleRows.length}`} />
          <StatCell label="后台任务" value={`${systemTasks.total ?? 0} 个`} note={`活跃 ${systemTasks.active_count ?? 0} · 队列 ${systemTasks.queue_depth ?? 0}`} tone={(systemTasks.active_count ?? 0) > 0 ? "text-aqua" : ""} />
          <StatCell label="OKX环境" value={systemStatus?.environment?.okx_configured ? "已配置" : "未配置"} note={systemStatus?.environment?.live_trading_enabled ? "实盘总开关开启" : "实盘总开关关闭"} tone={systemStatus?.environment?.live_trading_enabled ? "text-risk" : "text-aqua"} />
        </div>
        <div className="mt-4 overflow-x-auto rounded-[18px] border border-white/10">
          <table className="trade-table">
            <thead><tr><th>项目</th><th>状态</th><th>大小</th><th>更新时间</th></tr></thead>
            <tbody>
              {fileRows.map((row) => (
                <tr key={row.key}>
                  <td>{row.label}</td>
                  <td><span className={`candidate-health ${row.exists ? "is-ok" : "is-risk"}`}>{row.exists ? "存在" : "缺失"}</span></td>
                  <td>{bytesLabel(row.size_bytes)}</td>
                  <td>{shortTime(row.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-4 overflow-x-auto rounded-[18px] border border-white/10">
          <table className="trade-table">
            <thead><tr><th>系统证据</th><th>当前值</th><th>状态</th><th>处理动作</th></tr></thead>
            <tbody>
              {systemEvidenceRows.map((row) => (
                <tr key={row.name}>
                  <td>{row.name}</td>
                  <td>{row.value}</td>
                  <td><span className={`snapshot-quality ${row.tone}`}>{row.status}</span></td>
                  <td>{row.action}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-4 overflow-x-auto rounded-[18px] border border-white/10">
          <table className="trade-table">
            <thead><tr><th>优先级</th><th>范围</th><th>建议</th><th>动作</th></tr></thead>
            <tbody>
              {systemRecommendations.length ? systemRecommendations.map((row) => {
                const taskPayload = recommendationTaskPayload(row, dataRefreshBatchSize);
                const targetView = recommendationTargetView(row);
                return (
                  <tr key={`${row.area}-${row.title}`}>
                    <td><span className={`candidate-health ${row.priority === "high" || row.priority === "medium" ? "is-risk" : "is-info"}`}>{row.priority || "-"}</span></td>
                    <td>{row.area || "-"}</td>
                    <td><strong>{row.title || "-"}</strong><p className="mt-1 text-xs text-slate-500">{row.detail || "-"}</p></td>
                    <td>
                      <div className="table-actions">
                        <span>{row.action || "-"}</span>
                        {taskPayload ? (
                          <button type="button" className="table-action" onClick={() => onStartTask?.(taskPayload.type, taskPayload.params)} disabled={taskLoading}>
                            {taskLoading ? "提交中..." : `执行维护 x${dataRefreshBatchSize}`}
                          </button>
                        ) : null}
                        <button type="button" className="table-action" onClick={() => onOpenView?.(targetView)}>
                          打开{targetView}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              }) : (
                <tr><td colSpan="4">等待系统状态刷新。</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="mt-4 ledger-json-panel">
          <span>System Evidence JSON</span>
          <pre>{JSON.stringify({
            ok: systemStatus?.ok || false,
            server: systemStatus?.server || {},
            cache: systemCache,
            tasks: systemTasks,
            files: systemFiles,
            evidence: systemEvidenceRows.map((row) => ({
              name: row.name,
              value: row.value,
              status: row.status,
              action: row.action,
            })),
            recommendations: systemRecommendations,
          }, null, 2)}</pre>
        </div>
        <p className="mt-3 text-xs text-slate-500">任务状态：{taskCountsText} · 服务时间：{shortTime(systemStatus?.server?.updated_at)}</p>
      </div>

      <div className="mt-5 analysis-card">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.28em] text-slate-500">Branches</p>
            <h3 className="text-lg font-semibold text-white">项目分支状态</h3>
            <p className="mt-1 text-sm text-slate-400">按导航分支汇总当前接入状态，方便继续补齐弱项。</p>
          </div>
          <button type="button" className="table-action" onClick={() => onRefreshAll?.()} disabled={refreshAllLoading}>
            {refreshAllLoading ? "刷新中..." : "刷新状态"}
          </button>
        </div>
        <div className="mt-4 overflow-x-auto rounded-[18px] border border-white/10">
          <table className="trade-table">
            <thead><tr><th>分支</th><th>状态</th><th>说明</th></tr></thead>
            <tbody>
              {branches.map((branch) => (
                <tr key={branch.name}>
                  <td>{branch.name}</td>
                  <td><span className={`candidate-health ${["已接入", "运行中", "有结果", "只读已连", "允许", "正常"].includes(branch.state) ? "is-ok" : branch.state === "需刷新" ? "is-risk" : "is-risk"}`}>{branch.state}</span></td>
                  <td>{branch.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-2">
        <div className="analysis-card">
          <h3 className="text-lg font-semibold text-white">界面偏好</h3>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <button type="button" className={`table-action ${theme === "dark" ? "is-active" : ""}`} onClick={() => onThemeChange?.("dark")}>夜间模式</button>
            <button type="button" className={`table-action ${theme === "light" ? "is-active" : ""}`} onClick={() => onThemeChange?.("light")}>白天模式</button>
            <button type="button" className="table-action" onClick={() => onSidebarCollapsedChange?.(!sidebarCollapsed)}>{sidebarCollapsed ? "展开侧栏" : "收起侧栏"}</button>
            <button type="button" className="table-action" onClick={() => onRefreshAll?.()} disabled={refreshAllLoading}>{refreshAllLoading ? "同步中..." : "同步状态"}</button>
          </div>
        </div>

        <div className="analysis-card">
          <h3 className="text-lg font-semibold text-white">实盘前默认门槛</h3>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="param-input live-risk-input">
              <input
                min="0"
                step="0.0001"
                type="number"
                value={Number.isFinite(minLiveEquity) ? minLiveEquity : 10}
                onChange={(event) => updateLiveNumber("min_live_equity_usd", event.target.value)}
              />
              <em>最低实盘权益 USDT</em>
            </label>
            <label className="param-input live-risk-input">
              <input
                min="1"
                step="0.05"
                type="number"
                value={Number.isFinite(marginBufferMult) ? marginBufferMult : 1.2}
                onChange={(event) => updateLiveNumber("live_margin_buffer_mult", event.target.value)}
              />
              <em>保证金缓冲倍数</em>
            </label>
          </div>
          <p className="mt-2 text-xs text-slate-500">这些参数只影响 dry-run 和最终提交门槛，不会开启真实下单。</p>
        </div>
      </div>

      <div className="mt-5 analysis-card">
        <h3 className="text-lg font-semibold text-white">数据刷新偏好</h3>
        <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto]">
          <label className="param-input live-risk-input">
            <input
              min="1"
              max="20"
              step="1"
              type="number"
              value={dataRefreshBatchSize ?? 4}
              onChange={(event) => onDataRefreshBatchSizeChange?.(Number(event.target.value))}
            />
            <em>批量刷新数量</em>
          </label>
          <button type="button" className="table-action" onClick={() => onDataRefreshBatchSizeChange?.(4)}>恢复默认</button>
        </div>
      </div>
    </ViewShell>
  );
}
