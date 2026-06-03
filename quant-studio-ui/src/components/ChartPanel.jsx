import { Crosshair, Maximize2 } from "lucide-react";
import { memo, useMemo, useState } from "react";
import { chartTools } from "../data/mockData";
import GlassCard from "./GlassCard";
import IconButton from "./IconButton";

const chartHeight = 420;
const chartWidth = 920;
const padX = 54;
const padY = 34;

function fmt(value, digits = 2) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "-";
  return Number(value).toLocaleString(undefined, { maximumFractionDigits: digits });
}

function movingAverage(rows, period) {
  return rows.map((_, index) => {
    if (index + 1 < period) return null;
    const slice = rows.slice(index + 1 - period, index + 1);
    return slice.reduce((sum, item) => sum + item.close, 0) / period;
  });
}

function normalizeCandles(candles) {
  return (candles || []).slice(-90).map((candle) => ({
    ...candle,
    open: Number(candle.open),
    high: Number(candle.high),
    low: Number(candle.low),
    close: Number(candle.close),
    volume: Number(candle.volume || 0),
  }));
}

function tradeKey(trade = {}) {
  return [
    trade.inst_id || "-",
    trade.entry_time || trade.time || "-",
    trade.exit_time || trade.exit || "-",
    trade.side || "-",
    trade.entry || "-",
    trade.exit_price || trade.exit || "-",
  ].join("|");
}

function nearestIndexByTime(rows, value) {
  const target = Date.parse(value || "");
  if (!Number.isFinite(target) || !rows.length) return -1;
  let bestIndex = -1;
  let bestDistance = Infinity;
  rows.forEach((row, index) => {
    const ts = Number(row.ts || Date.parse(row.time || ""));
    const distance = Math.abs(ts - target);
    if (Number.isFinite(ts) && distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  });
  return bestIndex;
}

function normalizeTradeMarkers(trades, rows, market, selectedTrade) {
  const selectedKey = selectedTrade ? tradeKey(selectedTrade) : "";
  const visibleStart = Number(rows[0]?.ts || Date.parse(rows[0]?.time || ""));
  const visibleEnd = Number(rows.at(-1)?.ts || Date.parse(rows.at(-1)?.time || ""));
  return (trades || [])
    .filter((trade) => trade.inst_id === market.instId)
    .map((trade) => {
      const entryTs = Date.parse(trade.entry_time || "");
      const exitTs = Date.parse(trade.exit_time || "");
      const selected = tradeKey(trade) === selectedKey;
      const inView = (
        Number.isFinite(entryTs)
        && Number.isFinite(exitTs)
        && entryTs >= visibleStart
        && entryTs <= visibleEnd
      );
      return inView ? {
        trade,
        selected,
        entryIndex: nearestIndexByTime(rows, trade.entry_time),
        exitIndex: nearestIndexByTime(rows, trade.exit_time),
      } : null;
    })
    .filter((marker) => marker && marker.entryIndex >= 0)
    .slice(-18);
}

function ChartPanel({ candles, market, loading, trades = [], selectedTrade = null, onSelectTrade }) {
  const [activeTool, setActiveTool] = useState("十字光标");
  const [activePeriod, setActivePeriod] = useState("1个月");
  const [expanded, setExpanded] = useState(false);
  const rows = useMemo(() => normalizeCandles(candles), [candles]);
  const latest = rows[rows.length - 1];
  const previous = rows[rows.length - 2];
  const priceValues = useMemo(() => rows.flatMap((row) => [row.high, row.low]), [rows]);
  const min = Math.min(...priceValues);
  const max = Math.max(...priceValues);
  const padding = Math.max((max - min) * 0.12, latest ? latest.close * 0.002 : 1);
  const priceMin = Number.isFinite(min) ? min - padding : 0;
  const priceMax = Number.isFinite(max) ? max + padding : 1;
  const maxVolume = Math.max(...rows.map((row) => row.volume), 1);
  const ma20 = useMemo(() => movingAverage(rows, 20), [rows]);
  const ma50 = useMemo(() => movingAverage(rows, 50), [rows]);
  const ma200 = useMemo(() => movingAverage(rows, 200), [rows]);
  const priceTicks = Array.from({ length: 6 }, (_, index) => priceMax - ((priceMax - priceMin) / 5) * index);
  const periods = ["1天", "5天", "1个月", "3个月", "6个月", "YTD", "1年", "5年", "全部"];
  const change = latest && previous ? latest.close - previous.close : 0;
  const changePct = previous ? change / previous.close : 0;
  const yScale = (value) => padY + ((priceMax - value) / (priceMax - priceMin || 1)) * (chartHeight - padY * 2);
  const xScale = (index) => padX + (index / Math.max(rows.length - 1, 1)) * (chartWidth - padX * 2 - 74);
  const tradeMarkers = useMemo(() => normalizeTradeMarkers(trades, rows, market, selectedTrade), [market, rows, selectedTrade, trades]);
  const selectedMarkerVisible = selectedTrade ? tradeMarkers.some((marker) => marker.selected) : false;

  function linePath(values) {
    return values
      .map((value, index) => (value === null ? null : `${index === 0 || values[index - 1] === null ? "M" : "L"} ${xScale(index).toFixed(2)} ${yScale(value).toFixed(2)}`))
      .filter(Boolean)
      .join(" ");
  }

  const timeTicks = rows.filter((_, index) => index % Math.max(1, Math.floor(rows.length / 6)) === 0).slice(0, 6);

  return (
    <GlassCard className={`chart-panel overflow-hidden ${expanded ? "is-expanded" : ""}`}>
      <div className="chart-header">
        <div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
            <span className="font-semibold text-white">{market.instId.replace("-SWAP", " PERP").replace("-", "/")}</span>
            <span className="text-slate-400">{latest?.time?.replace("T", " ").slice(0, 16) || (loading ? "加载行情..." : "-")}</span>
            <span>开 <b>{fmt(latest?.open, 4)}</b></span>
            <span>高 <b>{fmt(latest?.high, 4)}</b></span>
            <span>低 <b>{fmt(latest?.low, 4)}</b></span>
            <span>收 <b>{fmt(latest?.close, 4)}</b></span>
            <span className={`font-semibold ${change >= 0 ? "text-aqua" : "text-risk"}`}>
              {change >= 0 ? "+" : ""}{fmt(change, 4)} ({changePct >= 0 ? "+" : ""}{(changePct * 100).toFixed(2)}%)
            </span>
          </div>
          <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-400">
            <span><b className="text-electric">MA</b> 20/50/200 {fmt(ma20.at(-1), 2)} {fmt(ma50.at(-1), 2)} {fmt(ma200.at(-1), 2)}</span>
            <span><b className="text-violet">DATA</b> {market.bar} · {rows.length} candles · OKX public</span>
            <span><b className="text-aqua">TRADES</b> {tradeMarkers.length} visible{selectedTrade ? selectedMarkerVisible ? " · selected" : " · selected outside view" : ""}</span>
          </div>
        </div>
        <IconButton
          icon={Maximize2}
          label={expanded ? "退出图表全屏" : "展开图表"}
          onClick={() => setExpanded((value) => !value)}
          className={expanded ? "is-active" : ""}
        />
      </div>

      <div className="relative mt-4 flex">
        <div className="chart-toolrail">
          {chartTools.map((tool) => (
            <button key={tool.label} type="button" title={tool.label} className={`chart-tool ${activeTool === tool.label ? "is-active" : ""}`} onClick={() => setActiveTool(tool.label)}>
              <tool.icon size={17} />
            </button>
          ))}
        </div>

        <div className="chart-canvas relative min-w-0 flex-1 rounded-[24px] border border-white/10 p-3 shadow-inner">
          <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} className="h-[460px] w-full overflow-visible">
            <defs>
              <linearGradient id="volumeGradient" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="#21e6b5" stopOpacity="0.55" />
                <stop offset="100%" stopColor="#2f80ff" stopOpacity="0.08" />
              </linearGradient>
            </defs>

            {Array.from({ length: 9 }).map((_, i) => {
              const y = 34 + i * 42;
              return <line key={`h-${i}`} className="chart-grid-line" x1={padX} x2={chartWidth - 78} y1={y} y2={y} />;
            })}
            {Array.from({ length: 12 }).map((_, i) => {
              const x = padX + i * 66;
              return <line key={`v-${i}`} className="chart-grid-line is-minor" x1={x} x2={x} y1={padY} y2={chartHeight - 44} />;
            })}

            <path d={linePath(ma20)} fill="none" stroke="#2f80ff" strokeWidth="2.4" opacity=".95" />
            <path d={linePath(ma50)} fill="none" stroke="#a855f7" strokeWidth="2.2" opacity=".88" />
            <path d={linePath(ma200)} fill="none" stroke="#fb923c" strokeWidth="2" opacity=".72" />

            {rows.map((candle, index) => {
              const x = xScale(index);
              const up = candle.close >= candle.open;
              const bodyTop = yScale(Math.max(candle.open, candle.close));
              const bodyBottom = yScale(Math.min(candle.open, candle.close));
              const bodyHeight = Math.max(3, bodyBottom - bodyTop);
              const color = up ? "#21e6b5" : "#ff4d6d";
              const volumeHeight = Math.min(72, (candle.volume / maxVolume) * 72);
              return (
                <g key={candle.ts || candle.time}>
                  <rect x={x - 3.5} y={chartHeight - 35 - volumeHeight} width="7" height={volumeHeight} rx="2" fill={up ? "url(#volumeGradient)" : "rgba(255,77,109,.26)"} />
                  <line x1={x} x2={x} y1={yScale(candle.high)} y2={yScale(candle.low)} stroke={color} strokeWidth="1.4" />
                  <rect x={x - 4.8} y={bodyTop} width="9.6" height={bodyHeight} rx="2.2" fill={up ? "rgba(33,230,181,.88)" : "rgba(255,77,109,.88)"} />
                </g>
              );
            })}

            {tradeMarkers.map(({ trade, selected, entryIndex, exitIndex }) => {
              const entryX = xScale(entryIndex);
              const exitX = exitIndex >= 0 ? xScale(exitIndex) : entryX;
              const entryY = yScale(Number(trade.entry || 0));
              const exitY = yScale(Number(trade.exit_price ?? trade.exit ?? trade.entry ?? 0));
              const positive = Number(trade.pnl || 0) >= 0;
              const markerColor = selected ? "#f8fafc" : positive ? "#21e6b5" : "#ff4d6d";
              return (
                <g
                  key={tradeKey(trade)}
                  className={`trade-marker ${selected ? "is-selected" : ""}`}
                  onClick={() => onSelectTrade?.(trade)}
                >
                  <line x1={entryX} x2={exitX} y1={entryY} y2={exitY} stroke={markerColor} strokeWidth={selected ? "2.4" : "1.6"} strokeDasharray={selected ? "0" : "4 5"} opacity={selected ? ".95" : ".55"} />
                  <circle cx={entryX} cy={entryY} r={selected ? "7" : "5"} fill="#0b0f18" stroke={markerColor} strokeWidth="2" />
                  <text x={entryX} y={entryY + 4} textAnchor="middle" fill={markerColor} fontSize="9" fontWeight="900">E</text>
                  <circle cx={exitX} cy={exitY} r={selected ? "7" : "5"} fill="#0b0f18" stroke={markerColor} strokeWidth="2" />
                  <text x={exitX} y={exitY + 4} textAnchor="middle" fill={markerColor} fontSize="9" fontWeight="900">X</text>
                </g>
              );
            })}

            {priceTicks.map((tick) => (
              <text key={tick} className="chart-axis-label" x={chartWidth - 65} y={yScale(tick) + 4} fontSize="12">{fmt(tick, 2)}</text>
            ))}

            {timeTicks.map((tick, i) => (
              <text key={tick.ts || tick.time} className="chart-axis-label" x={padX + i * 130} y={chartHeight - 12} fontSize="12">{tick.time?.slice(11, 16) || "-"}</text>
            ))}

            {latest ? (
              <>
                <line x1={padX} x2={chartWidth - 78} y1={yScale(latest.close)} y2={yScale(latest.close)} stroke="rgba(33,230,181,.3)" strokeDasharray="4 6" />
                <g transform={`translate(${chartWidth - 76}, ${yScale(latest.close) - 13})`}>
                  <rect width="70" height="26" rx="13" fill="rgba(33,230,181,.88)" />
                  <text x="35" y="17" textAnchor="middle" fill="#05111c" fontSize="12" fontWeight="800">{fmt(latest.close, 2)}</text>
                </g>
              </>
            ) : null}
          </svg>
        </div>
      </div>

      <div className="chart-footer">
        <div className="flex flex-wrap gap-2">
          {periods.map((period, index) => (
            <button key={period} type="button" className={`range-button ${activePeriod === period ? "is-active" : ""}`} onClick={() => setActivePeriod(period)}>
              {period}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-400">
          <Crosshair size={14} />
          <span>{new Date().toLocaleTimeString()} (UTC+8)</span>
          <span className="range-button">%</span>
          <span className="range-button">log</span>
          <span className="range-button is-active">自动</span>
        </div>
      </div>
    </GlassCard>
  );
}

export default memo(ChartPanel);
