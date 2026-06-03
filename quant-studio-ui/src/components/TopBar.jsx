import { Bell, ChevronDown, Command, RefreshCw, Search, UserRound } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import IconButton from "./IconButton";

const symbols = ["BTC-USDT-SWAP", "ETH-USDT-SWAP", "SOL-USDT-SWAP"];
const bars = ["5m", "15m", "1H", "4H"];
const viewCommands = ["仪表盘", "市场", "策略", "回测", "实盘", "风控", "数据", "设置"];

function money(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "-";
  return Number(value).toLocaleString(undefined, { maximumFractionDigits: 4 });
}

export default function TopBar({ running, apiError, loading, market, okxAccount, executionConfig, onMarketChange, onRefresh, onOpenLive, onOpenView }) {
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const searchInputRef = useRef(null);
  const okxReady = Boolean(okxAccount?.ok);
  const keyReady = Boolean(executionConfig?.okx_configured);
  const accountTitle = okxReady
    ? `OKX只读已连接 · 权益 ${money(okxAccount?.total_equity_usd)}U`
    : keyReady
      ? "OKX密钥已配置，账户读取未通过"
      : "OKX密钥未配置";
  const notifications = useMemo(() => {
    const rows = [];
    if (apiError) {
      rows.push({ tone: "risk", title: "API 需要处理", detail: apiError, action: "打开设置", target: "设置" });
    }
    if (!keyReady) {
      rows.push({ tone: "warn", title: "OKX 密钥未配置", detail: "实盘页可输入只读密钥并运行诊断。", action: "打开实盘", target: "实盘" });
    } else if (!okxReady) {
      rows.push({ tone: "warn", title: "OKX 账户未读通", detail: "密钥已存在，但只读账户读取还未通过。", action: "打开实盘", target: "实盘" });
    }
    if (loading) {
      rows.push({ tone: "info", title: "数据同步中", detail: "行情、回测或模拟盘状态正在刷新。", action: "查看数据", target: "数据" });
    }
    if (running) {
      rows.push({ tone: "ok", title: "策略运行中", detail: `${market.instId.replace("-SWAP", "")} · ${market.bar}`, action: "打开策略", target: "策略" });
    } else {
      rows.push({ tone: "risk", title: "策略已停止", detail: "模拟盘未运行，信号不会自动推进。", action: "打开策略", target: "策略" });
    }
    return rows.slice(0, 4);
  }, [apiError, keyReady, loading, market.bar, market.instId, okxReady, running]);
  const attentionCount = notifications.filter((item) => item.tone === "risk" || item.tone === "warn").length;
  const searchResults = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    const rows = [
      ...viewCommands.map((view) => ({
        key: `view-${view}`,
        label: view,
        meta: "打开工作区",
        type: "view",
        onSelect: () => (view === "实盘" ? onOpenLive?.() : onOpenView?.(view)),
      })),
      ...symbols.map((symbol) => ({
        key: `symbol-${symbol}`,
        label: symbol.replace("-SWAP", " PERP").replace("-", "/"),
        meta: "切换交易对",
        type: "symbol",
        onSelect: () => onMarketChange?.((value) => ({ ...value, instId: symbol })),
      })),
      ...bars.map((bar) => ({
        key: `bar-${bar}`,
        label: bar,
        meta: "切换周期",
        type: "bar",
        onSelect: () => onMarketChange?.((value) => ({ ...value, bar })),
      })),
    ];
    if (!query) return rows.slice(0, 6);
    return rows
      .filter((row) => `${row.label} ${row.meta} ${row.type}`.toLowerCase().includes(query))
      .slice(0, 8);
  }, [onMarketChange, onOpenLive, onOpenView, searchTerm]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchInputRef.current?.focus();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const runSearchAction = (row) => {
    row.onSelect?.();
    setSearchTerm("");
    setSearchOpen(false);
  };

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

        <label className="search-box hidden min-w-[190px] max-w-[420px] flex-1 sm:flex">
          <Search size={17} className="text-slate-400" />
          <input
            ref={searchInputRef}
            placeholder="搜索策略、指标、市场或数据..."
            value={searchTerm}
            onChange={(event) => {
              setSearchTerm(event.target.value);
              setSearchOpen(true);
            }}
            onFocus={() => setSearchOpen(true)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && searchResults[0]) {
                event.preventDefault();
                runSearchAction(searchResults[0]);
              }
              if (event.key === "Escape") {
                setSearchOpen(false);
                searchInputRef.current?.blur();
              }
            }}
          />
          <span className="shortcut">
            <Command size={12} />K
          </span>
          {searchOpen ? (
            <div className="search-popover">
              {searchResults.length ? searchResults.map((row) => (
                <button key={row.key} type="button" className="search-result" onMouseDown={(event) => event.preventDefault()} onClick={() => runSearchAction(row)}>
                  <strong>{row.label}</strong>
                  <span>{row.meta}</span>
                </button>
              )) : (
                <div className="search-empty">没有匹配结果</div>
              )}
            </div>
          ) : null}
        </label>

        <IconButton icon={RefreshCw} label="刷新行情并生成实验" onClick={onRefresh} className={loading ? "is-spinning" : ""} />
        <div className="notification-control">
          <IconButton
            icon={Bell}
            label="打开通知中心"
            onClick={() => setNotificationsOpen((value) => !value)}
            className={attentionCount ? "has-attention" : ""}
          />
          {attentionCount ? <span className="notification-count">{attentionCount}</span> : null}
          {notificationsOpen ? (
            <div className="notification-popover">
              <div className="notification-header">
                <strong>通知中心</strong>
                <span>{attentionCount ? `${attentionCount} 项待处理` : "状态正常"}</span>
              </div>
              <div className="notification-list">
                {notifications.map((item) => (
                  <button
                    key={`${item.title}-${item.detail}`}
                    type="button"
                    className={`notification-item is-${item.tone}`}
                    onClick={() => {
                      if (item.target === "实盘") onOpenLive?.();
                      else if (item.target) onOpenView?.(item.target);
                      setNotificationsOpen(false);
                    }}
                  >
                    <span />
                    <div>
                      <strong>{item.title}</strong>
                      <p>{item.detail}</p>
                      <em>{item.action}</em>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
        <button
          type="button"
          aria-label="账户与OKX状态"
          title={`${accountTitle} · 点击进入实盘状态`}
          className={`avatar-button account-status-button ${okxReady ? "is-ok" : keyReady ? "is-warn" : "is-risk"}`}
          onClick={() => onOpenLive?.()}
        >
          <UserRound size={17} />
          <span />
        </button>
      </div>
    </header>
  );
}
