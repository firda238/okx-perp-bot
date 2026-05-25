const toneClass = {
  profit: "from-aqua/25 to-aqua/5 text-aqua",
  risk: "from-risk/25 to-risk/5 text-risk",
  blue: "from-electric/25 to-electric/5 text-sky-300",
  violet: "from-violet/25 to-violet/5 text-violet-300",
  cyan: "from-cyan-300/25 to-cyan-300/5 text-cyan-200",
};

export default function MetricCard({ metric }) {
  const Icon = metric.icon;
  return (
    <article className="metric-card">
      <div className={`metric-icon bg-gradient-to-br ${toneClass[metric.tone]}`}>
        <Icon size={20} />
      </div>
      <div className="min-w-0">
        <p className="truncate text-xs text-slate-400">{metric.label}</p>
        <strong className={`mt-1 block text-2xl font-semibold tabular-nums ${metric.tone === "risk" ? "text-risk" : metric.tone === "profit" ? "text-aqua" : "text-white"}`}>
          {metric.value}
        </strong>
        <span className="mt-1 block text-xs text-slate-500">{metric.change}</span>
      </div>
    </article>
  );
}
