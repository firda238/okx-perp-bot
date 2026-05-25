import { ChevronDown, Minus, Pencil, Play, Plus } from "lucide-react";
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

export default function StrategyControlPanel({ running, paperState, loading, config, onConfigChange, onApply, onToggleRunning }) {
  const leverage = Number(config.max_leverage || strategyParams.leverage);
  const equity = Number(paperState?.equity ?? 0);
  const dayTrades = paperState?.day_trades ?? 0;
  const setConfigValue = (key, value) => onConfigChange((current) => ({ ...current, [key]: value }));
  const updateLeverage = (next) => setConfigValue("max_leverage", Math.min(125, Math.max(1, next)));

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
        <ParamRow label="当前权益 Equity" value={equity || config.initial_equity || 0} unit="U" readOnly />
        <ParamRow label="今日开仓 Day Trades" value={Number(dayTrades)} unit="笔" step={1} readOnly />

        <button type="button" onClick={onApply} disabled={loading} className="flex w-full items-center justify-between rounded-[16px] border border-white/10 bg-white/[0.045] px-4 py-3 text-sm text-slate-300 hover:border-electric/35 hover:bg-electric/10">
          <span>{loading ? "回测计算中..." : "生成实验回测"}</span>
          <ChevronDown size={17} />
        </button>
      </div>

      <div className="mt-4 grid grid-cols-[1fr_50px] gap-3">
        <button type="button" className="primary-button" onClick={onToggleRunning} disabled={loading}>{running ? "停止模拟" : "启动模拟"}</button>
        <button type="button" className="play-button" onClick={onToggleRunning} disabled={loading}>
          <Play size={18} fill="currentColor" />
        </button>
      </div>
    </GlassCard>
  );
}
