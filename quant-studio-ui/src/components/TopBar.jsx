import { Bell, ChevronDown, Command, RefreshCw, Search } from "lucide-react";
import IconButton from "./IconButton";

const symbols = ["BTC-USDT-SWAP", "ETH-USDT-SWAP", "SOL-USDT-SWAP"];
const bars = ["5m", "15m", "1H", "4H"];

export default function TopBar({ running, apiError, loading, market, onMarketChange, onRefresh }) {
  return (
    <header className="topbar-glass">
      <div className="flex min-w-0 items-center gap-4">
        <div className="mr-2 hidden lg:block">
          <h2 className="text-xl font-semibold text-white">Quant Studio</h2>
          <p className="-mt-1 text-xs text-slate-400">Strategy workspace</p>
        </div>

        <label className="selector-pill">
          <span className="grid h-8 w-8 place-items-center rounded-full bg-gradient-to-br from-orange-300 to-amber-600 text-xs font-black text-slate-950">₿</span>
          <select
            value={market.instId}
            onChange={(event) => onMarketChange((value) => ({ ...value, instId: event.target.value }))}
            className="selector-select min-w-[150px]"
          >
            {symbols.map((symbol) => (
              <option key={symbol} value={symbol}>{symbol.replace("-SWAP", " PERP").replace("-", "/")}</option>
            ))}
          </select>
          <ChevronDown size={16} className="text-slate-300" />
        </label>

        <label className="selector-pill px-4">
          <select
            value={market.bar}
            onChange={(event) => onMarketChange((value) => ({ ...value, bar: event.target.value }))}
            className="selector-select w-[64px]"
          >
            {bars.map((bar) => (
              <option key={bar} value={bar}>{bar}</option>
            ))}
          </select>
          <ChevronDown size={16} className="text-slate-300" />
        </label>

      </div>

      <div className="flex min-w-0 flex-1 items-center justify-end gap-4">
        <div className={`status-pill ${running ? "is-running" : "is-stopped"}`}>
          <span className="pulse-dot" />
          <span>{apiError ? "API Attention" : loading ? "Syncing Data" : running ? "Strategy Running" : "Strategy Stopped"}</span>
        </div>

        <label className="search-box hidden min-w-[280px] max-w-[460px] flex-1 lg:flex">
          <Search size={17} className="text-slate-400" />
          <input placeholder="搜索策略、指标、市场或数据..." />
          <span className="shortcut">
            <Command size={12} />K
          </span>
        </label>

        <IconButton icon={RefreshCw} label="刷新行情并生成实验" onClick={onRefresh} className={loading ? "is-spinning" : ""} />
        <IconButton icon={Bell} label="通知（待接入）" />
        <button type="button" aria-label="用户（待接入）" title="用户（待接入）" className="avatar-button" disabled />
      </div>
    </header>
  );
}
