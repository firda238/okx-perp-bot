function pct(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "-";
  return `${(Number(value) * 100).toFixed(2)}%`;
}

function money(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "-";
  return Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function groupTrades(trades, key) {
  const groups = new Map();
  for (const trade of trades || []) {
    const name = trade[key] || "-";
    const row = groups.get(name) || { name, trades: 0, wins: 0, pnl: 0, best: -Infinity, worst: Infinity };
    const pnl = Number(trade.pnl || 0);
    row.trades += 1;
    row.wins += pnl > 0 ? 1 : 0;
    row.pnl += pnl;
    row.best = Math.max(row.best, pnl);
    row.worst = Math.min(row.worst, pnl);
    groups.set(name, row);
  }
  return [...groups.values()]
    .map((row) => ({ ...row, winRate: row.trades ? row.wins / row.trades : 0 }))
    .sort((a, b) => b.pnl - a.pnl);
}

function displayName(value) {
  return String(value || "-").replace("-SWAP", "");
}

function auditHighlights(summary, trades) {
  const bySymbol = groupTrades(trades, "inst_id");
  const byKind = groupTrades(trades, "kind");
  const largestLoss = [...(trades || [])].sort((a, b) => Number(a.pnl || 0) - Number(b.pnl || 0))[0];
  const netPnl = Number(summary?.final_equity || 0) - Number(summary?.initial_equity || 0);

  return [
    {
      label: "样本净盈亏",
      value: `${money(netPnl)}U`,
      note: `${trades.length || 0} 条明细参与审计`,
      tone: netPnl >= 0 ? "profit" : "risk",
    },
    {
      label: "主贡献币种",
      value: bySymbol[0] ? displayName(bySymbol[0].name) : "-",
      note: bySymbol[0] ? `${money(bySymbol[0].pnl)}U · ${pct(bySymbol[0].winRate)}` : "暂无样本",
      tone: bySymbol[0]?.pnl >= 0 ? "profit" : "risk",
    },
    {
      label: "最强信号",
      value: byKind[0] ? displayName(byKind[0].name) : "-",
      note: byKind[0] ? `${byKind[0].trades} 笔 · ${money(byKind[0].pnl)}U` : "暂无样本",
      tone: byKind[0]?.pnl >= 0 ? "profit" : "risk",
    },
    {
      label: "主要压力点",
      value: largestLoss ? displayName(largestLoss.kind) : "-",
      note: largestLoss ? `${displayName(largestLoss.inst_id)} · ${money(largestLoss.pnl)}U · 连亏 ${summary?.max_consecutive_losses ?? "-"} 笔` : "暂无样本",
      tone: Number(largestLoss?.pnl || 0) < 0 || Number(summary?.max_consecutive_losses || 0) >= 10 ? "risk" : "neutral",
    },
  ];
}

function riskNotes(summary, trades) {
  const notes = [];
  if ((summary?.return_pct || 0) > 1 && (summary?.max_drawdown || 0) > 0.12) {
    notes.push("收益来自激进风险配置，回撤已超过 12%，不要把它当低风险曲线。");
  }
  if ((summary?.max_consecutive_losses || 0) >= 10) {
    notes.push(`最大连亏 ${summary.max_consecutive_losses} 笔，模拟盘需要保留熔断和降仓。`);
  }
  const losses = (trades || []).filter((trade) => Number(trade.pnl || 0) < 0);
  const largestLoss = losses.sort((a, b) => Number(a.pnl || 0) - Number(b.pnl || 0))[0];
  if (largestLoss) {
    notes.push(`最大亏损来自 ${largestLoss.inst_id?.replace("-SWAP", "") || "-"} / ${largestLoss.kind || "-"}，单笔 ${money(largestLoss.pnl)}U。`);
  }
  return notes;
}

function AuditTable({ title, rows }) {
  return (
    <div>
      <h3 className="mb-3 text-base font-semibold text-white">{title}</h3>
      <div className="overflow-hidden rounded-[18px] border border-white/10">
        <table className="trade-table">
          <thead>
            <tr>
              <th>维度</th>
              <th>交易</th>
              <th>胜率</th>
              <th>总盈亏</th>
              <th>最好</th>
              <th>最差</th>
            </tr>
          </thead>
          <tbody>
            {rows.length ? rows.map((row) => (
              <tr key={row.name}>
                <td>{row.name}</td>
                <td>{row.trades}</td>
                <td>{pct(row.winRate)}</td>
                <td className={row.pnl >= 0 ? "text-aqua" : "text-risk"}>{money(row.pnl)}</td>
                <td>{money(row.best)}</td>
                <td>{money(row.worst)}</td>
              </tr>
            )) : (
              <tr>
                <td colSpan="6">暂无交易样本。</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function StrategyAuditPanel({ portfolio, mode, className = "mt-5" }) {
  const trades = portfolio?.trades || [];
  const summary = portfolio?.summary || {};
  const notes = riskNotes(summary, trades);
  const highlights = auditHighlights(summary, trades);
  const isExperiment = mode === "experiment";
  return (
    <div className={`analysis-card ${className}`}>
      <div className="mb-5">
        <h3 className="text-lg font-semibold text-white">策略审计</h3>
        <p className="mt-1 text-xs text-slate-500">
          {isExperiment ? "只读取当前实验回测交易，不重新回测、不覆盖历史基准。" : "只读取当前历史快照交易，不重新回测、不覆盖参数。"}
        </p>
      </div>

      <div className="audit-summary-grid mb-5">
        {highlights.map((item) => (
          <div key={item.label} className={`audit-kpi ${item.tone === "profit" ? "is-profit" : item.tone === "risk" ? "is-risk" : ""}`}>
            <span>{item.label}</span>
            <strong>{item.value}</strong>
            <p>{item.note}</p>
          </div>
        ))}
      </div>

      <div className="mb-5 grid gap-3 lg:grid-cols-3">
        {notes.length ? notes.map((note) => (
          <div key={note} className="audit-note">
            {note}
          </div>
        )) : (
          <div className="audit-note">
            当前样本没有触发额外风险提示。
          </div>
        )}
      </div>

      <div className="grid gap-5 xl:grid-cols-3">
        <AuditTable title="按币种" rows={groupTrades(trades, "inst_id")} />
        <AuditTable title="按信号形态" rows={groupTrades(trades, "kind")} />
        <AuditTable title="按方向" rows={groupTrades(trades, "side")} />
      </div>
    </div>
  );
}
