import { ChevronDown, Minus, Pencil, Play, Plus, ShieldAlert, ShieldCheck } from "lucide-react";
import { strategyParams } from "../data/mockData";
import GlassCard from "./GlassCard";

function ParamRow({ label, value, unit, min, max, step = 0.01, readOnly = false, onChange }) {
  return (
    <label className="param-row">
      <span>{label}</span>
      <div className="param-input">
        <input
          type="number"
          value={Number(value).toFixed(step >= 1 ? 0 : 2)}
          readOnly={readOnly}
          min={min}
          max={max}
          step={step}
          onChange={(event) => onChange?.(Number(event.target.value))}
        />
        <em>{unit}</em>
      </div>
    </label>
  );
}

function ToggleRow({ label, checked, onChange }) {
  return (
    <label className="param-row">
      <span>{label}</span>
      <input
        type="checkbox"
        checked={Boolean(checked)}
        onChange={(event) => onChange?.(event.target.checked)}
      />
    </label>
  );
}

function readinessState(readiness) {
  const decision = readiness?.decision || "未检查";
  const allowed = String(decision).includes("允许");
  if (!readiness) return { label: decision, note: "启动前复检", tone: "is-pending", Icon: ShieldAlert };
  return {
    label: decision,
    note: readiness.score === undefined ? "准入已返回" : `Score ${readiness.score}/100`,
    tone: allowed ? "is-ready" : "is-blocked",
    Icon: allowed ? ShieldCheck : ShieldAlert,
  };
}

function compactNumber(value, digits = 2) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "-";
  return number.toFixed(digits).replace(/\.?0+$/, "");
}

function compactPct(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "-";
  return `${(number * 100).toFixed(2)}%`;
}

function signalStatus(scan) {
  if (!scan) return { label: "未扫描", tone: "text-slate-400" };
  if (scan.status === "ready") return { label: "Ready", tone: "text-aqua" };
  if (scan.status === "watch") return { label: "待确认", tone: "text-sky-300" };
  if (scan.status === "blocked") return { label: "过滤", tone: "text-risk" };
  if (scan.status === "error") return { label: "错误", tone: "text-risk" };
  return { label: scan.status || "-", tone: "text-slate-300" };
}

function signalAdvice(scan, config) {
  if (!scan) return "等待模拟盘完成下一次信号扫描。";
  const reasons = scan.reasons || [];
  const joined = reasons.join(" / ");
  if (scan.status === "ready") return "已有 ready 信号，实盘页会生成订单意图并继续执行保护检查。";
  if (scan.status === "watch") return "已有候选形态，等待下一根 K 线确认。";
  if (joined.includes("未触发价格行为形态")) return "继续等待扫损、突破回踩或延迟扫单形态，暂不放宽风控。";
  if (joined.includes("评分")) return `当前低于评分门槛 ${compactNumber(config.min_signal_score ?? 0, 2)}，优先观察形态质量。`;
  if (joined.includes("熔断") || joined.includes("回撤") || joined.includes("连亏")) return "先处理风控阻断，避免在账户压力状态开新仓。";
  if (joined) return joined;
  return scan.decision || "等待下一次扫描。";
}

function evidenceTone(status) {
  if (status === "pass") return "is-good";
  if (status === "watch") return "is-info";
  if (status === "warn") return "is-warn";
  return "is-bad";
}

function evidenceLabel(status) {
  if (status === "pass") return "通过";
  if (status === "watch") return "观察";
  if (status === "warn") return "注意";
  return "未通过";
}

function yesNo(value) {
  return value ? "是" : "否";
}

function scanEvidenceRows(scan, config) {
  const context = scan?.context || {};
  const signal = scan?.signal || {};
  const position = scan?.position || {};
  const risk = scan?.risk || {};
  const priceData = scan?.data?.price || {};
  const score = Number(scan?.score ?? signal.score);
  const minScore = Number(config.min_signal_score ?? -999);
  const hasSignal = Boolean(signal && Object.keys(signal).length);
  const hasPosition = Boolean(position && Object.keys(position).length);
  const hasFreshData = !priceData.is_stale;
  return [
    {
      name: "行情数据",
      value: priceData.latest_closed ? String(priceData.latest_closed).replace("T", " ").slice(0, 16) : "-",
      threshold: priceData.is_stale ? "需刷新" : "可用",
      status: hasFreshData ? "pass" : "fail",
      action: hasFreshData ? "继续判断形态。" : "打开数据页刷新当前品种缓存。",
    },
    {
      name: "风控熔断",
      value: risk.allow_trade === false ? "阻断" : risk.allow_trade === true ? "允许" : "-",
      threshold: "allow_trade=true",
      status: risk.allow_trade === false ? "fail" : risk.allow_trade === true ? "pass" : "watch",
      action: risk.allow_trade === false ? (risk.reasons || [])[0] || "先处理风控阻断。" : "没有风控硬阻断。",
    },
    {
      name: "价格形态",
      value: signal.kind || "未触发",
      threshold: "扫损 / 突破 / 延迟扫单",
      status: hasSignal ? "pass" : "fail",
      action: hasSignal ? `${signal.side || "-"} · ${signal.kind || "-"}` : "继续等待价格行为形态。",
    },
    {
      name: "趋势环境",
      value: `${context.trend || "-"} / ${context.regime || "-"}`,
      threshold: config.use_regime_filter ? "启用过滤" : "不过滤",
      status: context.trend || context.regime ? "pass" : "watch",
      action: "用于判断顺逆势、震荡和空头降权。",
    },
    {
      name: "ADX 门槛",
      value: compactNumber(context.adx, 1),
      threshold: compactNumber(config.min_adx, 1),
      status: Number(context.adx) >= Number(config.min_adx || 0) ? "pass" : "warn",
      action: Number(context.adx) >= Number(config.min_adx || 0) ? "趋势强度满足配置。" : "趋势强度偏弱，等待更清晰形态。",
    },
    {
      name: "信号评分",
      value: Number.isFinite(score) ? compactNumber(score, 2) : "-",
      threshold: compactNumber(minScore, 2),
      status: Number.isFinite(score) ? score >= minScore ? "pass" : "fail" : "watch",
      action: Number.isFinite(score) ? score >= minScore ? "评分通过。" : "低于评分门槛，保持过滤。" : "没有形态时无法评分。",
    },
    {
      name: "仓位生成",
      value: hasPosition ? `${compactNumber(position.leverage, 1)}x / ${compactNumber(position.notional, 2)}U` : "未生成",
      threshold: "爆仓缓冲 + 保证金",
      status: hasPosition ? "pass" : hasSignal ? "fail" : "watch",
      action: hasPosition ? `保证金 ${compactNumber(position.margin_used, 4)}U` : hasSignal ? "仓位、杠杆或爆仓缓冲不满足。" : "等待候选信号后计算仓位。",
    },
    {
      name: "次K确认",
      value: yesNo(config.require_next_confirmation),
      threshold: config.require_next_confirmation ? "必须等待" : "无需等待",
      status: config.require_next_confirmation ? scan?.status === "watch" ? "watch" : "pass" : "pass",
      action: config.require_next_confirmation ? "策略会先进入待确认状态。" : "候选信号可直接进入 ready 复核。",
    },
  ];
}

function scanSummaryRows(rows = []) {
  return rows.map((row) => {
    const context = row.context || {};
    const signal = row.signal || {};
    return {
      instId: row.inst_id || "-",
      status: signalStatus(row),
      decision: row.decision || "-",
      score: row.score ?? signal.score,
      pattern: signal.kind || "-",
      side: signal.side || "-",
      context: `${context.trend || "-"} / ${context.regime || "-"}`,
      reason: (row.reasons || [])[0] || "-",
    };
  });
}

export default function StrategyControlPanel({
  running,
  paperState,
  manualSignalScan,
  loading,
  readiness,
  readinessLoading,
  signalScanLoading,
  riskExperimentLoading,
  config,
  onConfigChange,
  onApply,
  onRunSignalScan,
  onRunReadiness,
  onRunRiskExperiments,
  onOpenView,
  onToggleRunning,
}) {
  const leverage = Number(config.max_leverage || strategyParams.leverage);
  const equity = Number(paperState?.equity ?? 0);
  const dayTrades = paperState?.day_trades ?? 0;
  const gate = readinessState(readiness);
  const GateIcon = gate.Icon;
  const manualRows = manualSignalScan?.rows || [];
  const manualRow = manualRows.find((row) => row.inst_id === config.instId) || manualRows[0];
  const latestScan = manualRow || paperState?.signal_log?.[0] || null;
  const latestContext = latestScan?.context || {};
  const latestSignal = latestScan?.signal || {};
  const scanState = signalStatus(latestScan);
  const scanSource = manualRow ? "手动扫描" : paperState?.signal_log?.length ? "模拟盘扫描" : "等待扫描";
  const evidenceRows = scanEvidenceRows(latestScan, config);
  const scanRows = scanSummaryRows(manualRows.length ? manualRows : paperState?.signal_log?.slice(0, 6) || []);
  const passCount = evidenceRows.filter((row) => row.status === "pass").length;
  const failCount = evidenceRows.filter((row) => row.status === "fail").length;
  const watchCount = evidenceRows.length - passCount - failCount;
  const setConfigValue = (key, value) => onConfigChange((current) => ({ ...current, [key]: value }));
  const updateLeverage = (next) => setConfigValue("max_leverage", Math.min(125, Math.max(1, next)));
  const hasReadySignal = latestScan?.status === "ready";
  const hasRiskBlock = latestScan?.reasons?.some((reason) => String(reason).includes("熔断") || String(reason).includes("回撤") || String(reason).includes("连亏"));
  const actionRows = [
    {
      key: "scan",
      title: "信号扫描",
      detail: signalAdvice(latestScan, config),
      action: signalScanLoading ? "扫描中..." : "立即扫描",
      disabled: loading || signalScanLoading,
      tone: hasReadySignal ? "is-pass" : latestScan?.status === "blocked" ? "is-fail" : "is-pending",
      onClick: onRunSignalScan,
    },
    {
      key: "readiness",
      title: "准入检查",
      detail: readiness?.next_action || "启动模拟或放大风险前，先复核回测、滚动窗口和 MC 尾部风险。",
      action: readinessLoading ? "检查中..." : "运行检查",
      disabled: readinessLoading,
      tone: String(readiness?.decision || "").includes("允许") ? "is-pass" : "is-pending",
      onClick: onRunReadiness,
    },
    {
      key: "risk",
      title: "风控处置",
      detail: hasRiskBlock ? "信号或账户处于风控压力，先打开风控页处理阻断。" : "查看风险压力表、准入失败项和风险实验入口。",
      action: "打开风控",
      tone: hasRiskBlock ? "is-fail" : "is-pending",
      onClick: () => onOpenView?.("风控"),
    },
    {
      key: "experiment",
      title: "风险实验",
      detail: "测试连亏暂停、时间止损、评分门槛和降风险方案，降低回撤压力。",
      action: riskExperimentLoading ? "实验中..." : "启动实验",
      disabled: riskExperimentLoading,
      tone: "is-pending",
      onClick: onRunRiskExperiments,
    },
    {
      key: "live",
      title: "实盘预演",
      detail: hasReadySignal ? "已有 ready 信号，进入实盘页生成订单意图并做最终门槛。" : "没有 ready 信号时，实盘页只做环境和锁检查。",
      action: "打开实盘",
      tone: hasReadySignal ? "is-pass" : "is-pending",
      onClick: () => onOpenView?.("实盘"),
    },
    {
      key: "data",
      title: "数据维护",
      detail: "查看缓存新鲜度、后台刷新和研究快照，避免用陈旧 K 线判断信号。",
      action: "打开数据",
      tone: "is-pending",
      onClick: () => onOpenView?.("数据"),
    },
  ];

  return (
    <GlassCard className="strategy-panel">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.28em] text-slate-400">Automation</p>
          <h2 className="text-xl font-semibold text-white">策略控制</h2>
        </div>
        <div className="h-11 w-11 rounded-2xl border border-aqua/25 bg-aqua/10 shadow-[0_0_30px_rgba(33,230,181,.18)]" />
      </div>

      <div className="space-y-4">
        <div className="rounded-[18px] border border-white/10 bg-white/[0.045] p-3">
          <div className="mb-2 flex items-center justify-between text-sm text-slate-400">
            <span>策略名称</span>
            <Pencil size={15} />
          </div>
          <p className="text-lg font-semibold text-white">{strategyParams.name}</p>
          <p className="mt-1 text-xs text-slate-500">{paperState?.strategy_mode || "louie_price_action"}</p>
        </div>

        <div className="flex items-center justify-between rounded-[18px] border border-white/10 bg-white/[0.045] p-3">
          <div>
            <p className="text-sm text-slate-400">状态</p>
            <div className="mt-2 inline-flex items-center gap-2 rounded-full border border-aqua/25 bg-aqua/10 px-3 py-1 text-sm font-semibold text-aqua">
              <span className="h-2 w-2 rounded-full bg-aqua shadow-[0_0_12px_rgba(33,230,181,.9)]" />
              {loading ? "同步中" : running ? "运行中" : "已停止"}
            </div>
          </div>
          <button type="button" onClick={onToggleRunning} className={`toggle ${running ? "is-on" : ""}`} disabled={loading}>
            <span />
          </button>
        </div>

        <div className={`readiness-mini ${gate.tone}`}>
          <div>
            <GateIcon size={17} />
            <span>准入</span>
          </div>
          <strong>{readinessLoading ? "检查中..." : gate.label}</strong>
          <p>{gate.note}</p>
        </div>

        <div className="rounded-[18px] border border-white/10 bg-white/[0.045] p-3">
          <div className="mb-3 flex items-center justify-between text-sm text-slate-400">
            <span>策略动作队列</span>
            <span className={hasReadySignal ? "text-aqua" : hasRiskBlock ? "text-risk" : "text-slate-500"}>
              {hasReadySignal ? "Ready" : hasRiskBlock ? "需风控" : "观察"}
            </span>
          </div>
          <div className="event-list">
            {actionRows.map((item) => (
              <div className="event-row" key={item.key}>
                <span className={`preflight-dot ${item.tone}`} />
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

        <div className="rounded-[18px] border border-white/10 bg-white/[0.045] p-3">
          <div className="mb-2 flex items-center justify-between text-sm text-slate-400">
            <span>最近信号扫描</span>
            <button type="button" className="table-action" onClick={onRunSignalScan} disabled={loading || signalScanLoading}>
              {signalScanLoading ? "扫描中..." : "立即扫描"}
            </button>
          </div>
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-semibold text-white">{latestScan?.decision || "等待扫描"}</p>
            <span className={scanState.tone}>{scanState.label}</span>
          </div>
          <p className="mt-1 text-xs text-slate-500">{signalAdvice(latestScan, config)}</p>
          <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-400">
            <span>趋势 <strong className="text-slate-200">{latestContext.trend || "-"}</strong></span>
            <span>行情 <strong className="text-slate-200">{latestContext.regime || "-"}</strong></span>
            <span>ADX <strong className="text-slate-200">{compactNumber(latestContext.adx, 1)}</strong></span>
            <span>ATR% <strong className="text-slate-200">{compactPct(latestContext.atr_pct)}</strong></span>
            <span>实体 <strong className="text-slate-200">{compactPct(latestContext.body_ratio)}</strong></span>
            <span>评分 <strong className="text-slate-200">{compactNumber(latestScan?.score ?? latestSignal.score, 2)}</strong></span>
          </div>
          <p className="mt-2 text-xs text-slate-500">{scanSource} · {latestScan?.reasons?.[0] || latestScan?.updated_at || "暂无过滤原因。"}</p>
        </div>

        <div className="rounded-[18px] border border-white/10 bg-white/[0.045] p-3">
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Signal Evidence</p>
              <h3 className="text-base font-semibold text-white">信号证据矩阵</h3>
              <p className="mt-1 text-xs text-slate-500">{signalAdvice(latestScan, config)}</p>
            </div>
            <span className={scanState.tone}>{scanState.label}</span>
          </div>
          <div className="mb-3 grid grid-cols-3 gap-2">
            <div className="rounded-[14px] border border-white/10 bg-white/[0.035] p-2">
              <span className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Pass</span>
              <strong className="block text-lg text-aqua">{passCount}</strong>
            </div>
            <div className="rounded-[14px] border border-white/10 bg-white/[0.035] p-2">
              <span className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Watch</span>
              <strong className="block text-lg text-sky-300">{watchCount}</strong>
            </div>
            <div className="rounded-[14px] border border-white/10 bg-white/[0.035] p-2">
              <span className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Fail</span>
              <strong className="block text-lg text-risk">{failCount}</strong>
            </div>
          </div>
          <div className="overflow-x-auto rounded-[16px] border border-white/10">
            <table className="trade-table">
              <thead><tr><th>证据</th><th>当前值</th><th>门槛</th><th>状态</th><th>动作</th></tr></thead>
              <tbody>
                {evidenceRows.map((row) => (
                  <tr key={row.name}>
                    <td>{row.name}</td>
                    <td>{row.value}</td>
                    <td>{row.threshold}</td>
                    <td><span className={`snapshot-quality ${evidenceTone(row.status)}`}>{evidenceLabel(row.status)}</span></td>
                    <td>{row.action}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-3 overflow-x-auto rounded-[16px] border border-white/10">
            <table className="trade-table">
              <thead><tr><th>扫描品种</th><th>状态</th><th>评分</th><th>形态</th><th>方向</th><th>趋势/行情</th><th>原因</th></tr></thead>
              <tbody>
                {scanRows.length ? scanRows.map((row, index) => (
                  <tr key={`${row.instId}-${row.decision}-${index}`}>
                    <td>{row.instId.replace("-SWAP", "")}</td>
                    <td><span className={row.status.tone}>{row.status.label}</span></td>
                    <td>{compactNumber(row.score, 2)}</td>
                    <td>{row.pattern}</td>
                    <td>{row.side}</td>
                    <td>{row.context}</td>
                    <td>{row.reason}</td>
                  </tr>
                )) : (
                  <tr><td colSpan="7">运行手动扫描后显示多品种信号摘要。</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="mt-3 ledger-json-panel">
            <span>Signal Evidence JSON</span>
            <pre>{JSON.stringify({
              source: scanSource,
              selected: latestScan ? {
                inst_id: latestScan.inst_id,
                status: latestScan.status,
                decision: latestScan.decision,
                reasons: latestScan.reasons || [],
                score: latestScan.score ?? latestSignal.score,
                context: latestScan.context || {},
                signal: latestScan.signal || null,
                position: latestScan.position || null,
                risk: latestScan.risk || null,
                data: latestScan.data || null,
              } : null,
              summary: manualSignalScan?.summary || null,
              evidence: evidenceRows,
            }, null, 2)}</pre>
          </div>
        </div>

        <div className="rounded-[18px] border border-white/10 bg-white/[0.045] p-3">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-sm text-slate-400">杠杆</span>
            <span className="text-xs text-slate-500">1x - 125x</span>
          </div>
          <div className="grid grid-cols-[40px_1fr_40px] gap-3">
            <button type="button" className="stepper" onClick={() => updateLeverage(leverage - 1)} disabled={loading}>
              <Minus size={16} />
            </button>
            <div className="grid place-items-center rounded-[16px] border border-electric/25 bg-electric/10 text-2xl font-semibold text-white">{leverage}x</div>
            <button type="button" className="stepper" onClick={() => updateLeverage(leverage + 1)} disabled={loading}>
              <Plus size={16} />
            </button>
          </div>
        </div>

        <ParamRow label="ATR 止损倍数" value={config.atr_stop_mult} unit="x" min={0.5} max={5} step={0.1} onChange={(value) => setConfigValue("atr_stop_mult", value)} />
        <ParamRow label="止盈 R 倍数" value={config.take_profit_rr} unit="R" min={0.5} max={6} step={0.1} onChange={(value) => setConfigValue("take_profit_rr", value)} />
        <ParamRow label="单笔风险" value={(config.risk_pct || 0) * 100} unit="%" min={0.5} max={40} step={0.5} onChange={(value) => setConfigValue("risk_pct", value / 100)} />
        <ParamRow label="滑点容忍度" value={(config.slippage_pct || 0) * 100} unit="%" min={0} max={0.5} step={0.01} onChange={(value) => setConfigValue("slippage_pct", value / 100)} />
        <ParamRow label="评分门槛" value={config.min_signal_score ?? 0} unit="" min={-1} max={2} step={0.05} onChange={(value) => setConfigValue("min_signal_score", value)} />
        <ToggleRow label="过滤逆势突破" checked={config.block_breakout_against_trend} onChange={(value) => setConfigValue("block_breakout_against_trend", value)} />
        <ParamRow label="当前权益 Equity" value={equity || config.initial_equity || 0} unit="U" readOnly />
        <ParamRow label="今日开仓 Day Trades" value={Number(dayTrades)} unit="笔" step={1} readOnly />

        <button type="button" onClick={onApply} disabled={loading} className="flex w-full items-center justify-between rounded-[16px] border border-white/10 bg-white/[0.045] px-4 py-3 text-sm text-slate-300 hover:border-electric/35 hover:bg-electric/10">
          <span>{loading ? "回测计算中..." : "生成实验回测"}</span>
          <ChevronDown size={17} />
        </button>
      </div>

      <div className="mt-4 grid grid-cols-[1fr_50px] gap-3">
        <button type="button" className="primary-button" onClick={onToggleRunning} disabled={loading || readinessLoading}>{readinessLoading && !running ? "准入检查中..." : running ? "停止模拟" : "启动模拟"}</button>
        <button type="button" className="play-button" onClick={onToggleRunning} disabled={loading || readinessLoading}>
          <Play size={18} fill="currentColor" />
        </button>
      </div>
    </GlassCard>
  );
}
