import { Area, AreaChart, CartesianGrid, Tooltip, XAxis, YAxis } from "recharts";
import { useState } from "react";
import { equityCurveData } from "../data/mockData";

function normalizeCurve(data) {
  if (!data?.length) return equityCurveData;
  return data.map((point) => ({
    month: (point.time || point.entry_time || point.exit_time)?.slice(5, 10) || "-",
    value: Number(point.equity || 0),
  })).filter((point) => point.value > 0);
}

export default function EquityCurve({ data }) {
  const [view, setView] = useState("net");
  const [logScale, setLogScale] = useState(false);
  const rows = normalizeCurve(data);
  const canUseLogScale = rows.every((row) => row.value > 0);
  return (
    <div className="analysis-card min-h-[360px]">
      <div className="mb-5 flex items-center justify-between">
        <h3 className="text-lg font-semibold text-white">净值曲线</h3>
        <div className="segmented">
          <button type="button" className={view === "net" ? "is-active" : ""} onClick={() => setView("net")}>净值</button>
          <button type="button" className={view === "equity" ? "is-active" : ""} onClick={() => setView("equity")}>权益</button>
          <label>
            <input type="checkbox" checked={logScale} disabled={!canUseLogScale} onChange={(event) => setLogScale(event.target.checked)} />
            对数坐标
          </label>
        </div>
      </div>
      <div className="min-h-[286px] min-w-[1px] overflow-x-auto">
          <AreaChart width={620} height={286} data={rows} margin={{ top: 12, right: 12, left: -10, bottom: 0 }}>
            <defs>
              <linearGradient id="equityLine" x1="0" x2="1" y1="0" y2="0">
                <stop offset="0%" stopColor="#2f80ff" />
                <stop offset="100%" stopColor="#a855f7" />
              </linearGradient>
              <linearGradient id="equityFill" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="#a855f7" stopOpacity="0.28" />
                <stop offset="100%" stopColor="#2f80ff" stopOpacity="0.02" />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="rgba(180,210,255,.08)" vertical={false} />
            <XAxis dataKey="month" tick={{ fill: "rgba(226,232,240,.55)", fontSize: 12 }} axisLine={false} tickLine={false} />
            <YAxis scale={logScale && canUseLogScale ? "log" : "auto"} domain={["auto", "auto"]} tickFormatter={(value) => Number(value).toLocaleString(undefined, { maximumFractionDigits: 1 })} tick={{ fill: "rgba(226,232,240,.55)", fontSize: 12 }} axisLine={false} tickLine={false} />
            <Tooltip
              cursor={{ stroke: "rgba(168,85,247,.35)" }}
              contentStyle={{ background: "rgba(9,18,33,.92)", border: "1px solid rgba(160,200,255,.18)", borderRadius: 16, color: "#fff", backdropFilter: "blur(18px)" }}
              formatter={(value) => [`${Number(value).toLocaleString()} USDT`, "净值"]}
            />
            <Area type="monotone" dataKey="value" stroke="url(#equityLine)" strokeWidth={3} fill="url(#equityFill)" />
          </AreaChart>
      </div>
    </div>
  );
}
