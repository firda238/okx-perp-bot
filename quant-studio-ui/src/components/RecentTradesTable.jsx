import { useState } from "react";
import { trades as fallbackTrades } from "../data/mockData";

export function tradeKey(trade = {}) {
  return [
    trade.inst_id || "-",
    trade.entry_time || trade.time || "-",
    trade.exit_time || trade.exit || "-",
    trade.side || "-",
    trade.entry || "-",
    trade.exit_price || trade.exit || "-",
  ].join("|");
}

function formatTrade(trade) {
  const time = trade.entry_time || "";
  const pnl = Number(trade.pnl || 0);
  const pct = Number(trade.pnl_pct || 0);
  return {
    id: tradeKey(trade),
    raw: trade,
    time: time.replace("T", " ").slice(0, 16) || "-",
    timeValue: Date.parse(time) || 0,
    side: trade.side === "short" ? "Short" : "Long",
    symbol: trade.inst_id?.replace("-SWAP", "") || "-",
    entry: Number(trade.entry || 0).toLocaleString(undefined, { maximumFractionDigits: 4 }),
    entryValue: Number(trade.entry || 0),
    exit: Number(trade.exit || trade.exit_price || 0).toLocaleString(undefined, { maximumFractionDigits: 4 }),
    exitValue: Number(trade.exit || trade.exit_price || 0),
    pnl: pnl.toLocaleString(undefined, { maximumFractionDigits: 4 }),
    pnlValue: pnl,
    pct: `${(pct * 100).toFixed(2)}%`,
    pctValue: pct,
    positive: pnl >= 0,
  };
}

function tradeSymbol(trade) {
  return trade.inst_id?.replace("-SWAP", "") || "-";
}

function normalizeTrades(trades, showAll, symbolFilter, sideFilter, pnlFilter) {
  const source = trades?.length ? trades : fallbackTrades;
  const windowed = trades?.length && !showAll ? source.slice(-8) : source;
  return windowed
    .filter((trade) => symbolFilter === "all" || tradeSymbol(trade) === symbolFilter)
    .filter((trade) => sideFilter === "all" || trade.side === sideFilter)
    .filter((trade) => {
      const pnl = Number(trade.pnl || 0);
      if (pnlFilter === "wins") return pnl >= 0;
      if (pnlFilter === "losses") return pnl < 0;
      return true;
    })
    .slice()
    .reverse()
    .map(formatTrade);
}

function money(value) {
  return Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 4 });
}

function sortRows(rows, sortKey, sortDir) {
  const direction = sortDir === "asc" ? 1 : -1;
  return rows.slice().sort((a, b) => {
    if (sortKey === "symbol" || sortKey === "side") {
      return a[sortKey].localeCompare(b[sortKey]) * direction;
    }
    const valueA = a[`${sortKey}Value`] ?? 0;
    const valueB = b[`${sortKey}Value`] ?? 0;
    return (valueA - valueB) * direction;
  });
}

function SortHeader({ label, sortKey, activeKey, direction, onSort }) {
  const active = sortKey === activeKey;
  return (
    <button type="button" className={`sort-header ${active ? "is-active" : ""}`} onClick={() => onSort(sortKey)}>
      <span>{label}</span>
      <em>{active ? (direction === "asc" ? "↑" : "↓") : "↕"}</em>
    </button>
  );
}

export default function RecentTradesTable({ trades, selectedTrade, onSelectTrade }) {
  const [showAll, setShowAll] = useState(false);
  const [symbolFilter, setSymbolFilter] = useState("all");
  const [sideFilter, setSideFilter] = useState("all");
  const [pnlFilter, setPnlFilter] = useState("all");
  const [sortKey, setSortKey] = useState("time");
  const [sortDir, setSortDir] = useState("desc");
  const source = trades?.length ? trades : fallbackTrades;
  const selectedKey = selectedTrade ? tradeKey(selectedTrade) : "";
  const total = trades?.length || fallbackTrades.length;
  const visibleTotal = trades?.length && !showAll ? Math.min(8, total) : total;
  const filteredRows = normalizeTrades(trades, showAll, symbolFilter, sideFilter, pnlFilter);
  const rows = sortRows(filteredRows, sortKey, sortDir);
  const canToggle = total > 8;
  const symbols = Array.from(new Set(source.map(tradeSymbol))).sort();
  const hasFilter = symbolFilter !== "all" || sideFilter !== "all" || pnlFilter !== "all";
  const summary = rows.reduce(
    (acc, trade) => ({
      pnl: acc.pnl + trade.pnlValue,
      wins: acc.wins + (trade.pnlValue >= 0 ? 1 : 0),
      losses: acc.losses + (trade.pnlValue < 0 ? 1 : 0),
    }),
    { pnl: 0, wins: 0, losses: 0 },
  );
  const avgPnl = rows.length ? summary.pnl / rows.length : 0;
  const resetFilters = () => {
    setSymbolFilter("all");
    setSideFilter("all");
    setPnlFilter("all");
  };
  const toggleAllTrades = () => {
    setShowAll((value) => {
      if (value) resetFilters();
      return !value;
    });
  };
  const updateSort = (nextKey) => {
    if (nextKey === sortKey) {
      setSortDir((value) => (value === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(nextKey);
    setSortDir(nextKey === "time" ? "desc" : "asc");
  };

  return (
    <div className="analysis-card min-h-[360px]">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-white">最近交易</h3>
          <p className="mt-1 text-xs text-slate-500">显示 {rows.length} / {visibleTotal} 条明细，总计 {total} 条，只读交易记录。</p>
        </div>
        <div className="trade-toolbar">
          <label className="table-filter">
            <span>品种</span>
            <select value={symbolFilter} onChange={(event) => setSymbolFilter(event.target.value)}>
              <option value="all">全部</option>
              {symbols.map((symbol) => (
                <option key={symbol} value={symbol}>{symbol}</option>
              ))}
            </select>
          </label>
          <label className="table-filter">
            <span>方向</span>
            <select value={sideFilter} onChange={(event) => setSideFilter(event.target.value)}>
              <option value="all">全部</option>
              <option value="long">Long</option>
              <option value="short">Short</option>
            </select>
          </label>
          <label className="table-filter">
            <span>盈亏</span>
            <select value={pnlFilter} onChange={(event) => setPnlFilter(event.target.value)}>
              <option value="all">全部</option>
              <option value="wins">盈利</option>
              <option value="losses">亏损</option>
            </select>
          </label>
          {hasFilter ? (
            <button type="button" className="secondary-button" onClick={resetFilters}>
              重置筛选
            </button>
          ) : null}
          {canToggle ? (
            <button type="button" className="secondary-button" onClick={toggleAllTrades}>
              {showAll ? "收起交易" : "查看全部交易"}
            </button>
          ) : null}
        </div>
      </div>
      <div className="trade-summary-strip">
        <div>
          <span>筛选净盈亏</span>
          <strong className={summary.pnl >= 0 ? "text-aqua" : "text-risk"}>{money(summary.pnl)}U</strong>
        </div>
        <div>
          <span>盈利明细</span>
          <strong className="text-aqua">{summary.wins}</strong>
        </div>
        <div>
          <span>亏损明细</span>
          <strong className="text-risk">{summary.losses}</strong>
        </div>
        <div>
          <span>平均盈亏</span>
          <strong className={avgPnl >= 0 ? "text-aqua" : "text-risk"}>{money(avgPnl)}U</strong>
        </div>
      </div>
      <div className={`trade-table-shell ${showAll ? "is-expanded" : ""}`}>
        <table className="trade-table">
          <thead>
            <tr>
              <th><SortHeader label="时间" sortKey="time" activeKey={sortKey} direction={sortDir} onSort={updateSort} /></th>
              <th><SortHeader label="方向" sortKey="side" activeKey={sortKey} direction={sortDir} onSort={updateSort} /></th>
              <th><SortHeader label="交易品种" sortKey="symbol" activeKey={sortKey} direction={sortDir} onSort={updateSort} /></th>
              <th><SortHeader label="开仓价" sortKey="entry" activeKey={sortKey} direction={sortDir} onSort={updateSort} /></th>
              <th><SortHeader label="平仓价" sortKey="exit" activeKey={sortKey} direction={sortDir} onSort={updateSort} /></th>
              <th><SortHeader label="盈亏 (USDT)" sortKey="pnl" activeKey={sortKey} direction={sortDir} onSort={updateSort} /></th>
              <th><SortHeader label="盈亏 (%)" sortKey="pct" activeKey={sortKey} direction={sortDir} onSort={updateSort} /></th>
            </tr>
          </thead>
          <tbody>
            {rows.length ? rows.map((trade) => (
              <tr
                key={trade.id}
                className={trade.id === selectedKey ? "is-selected-row" : ""}
                onClick={() => onSelectTrade?.(trade.raw)}
              >
                <td>{trade.time}</td>
                <td>
                  <span className={`side-pill ${trade.side === "Long" ? "long" : "short"}`}>{trade.side}</span>
                </td>
                <td>{trade.symbol}</td>
                <td>{trade.entry}</td>
                <td>{trade.exit}</td>
                <td className={`font-semibold ${trade.positive === false ? "text-risk" : "text-aqua"}`}>{trade.pnl}</td>
                <td className={`font-semibold ${trade.positive === false ? "text-risk" : "text-aqua"}`}>{trade.pct}</td>
              </tr>
            )) : (
              <tr>
                <td colSpan="7">当前筛选条件下没有交易明细。</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
