import { ChevronsLeft, ChevronsRight, FlaskConical, Moon, Sun } from "lucide-react";
import { navItems } from "../data/mockData";

export default function Sidebar({ activeLabel, collapsed, theme, running, onThemeChange, onCollapseChange, onSelect }) {
  const nav = (
    <nav className="space-y-2">
      {navItems.map((item) => {
        const Icon = item.icon;
        const active = item.label === activeLabel;
        return (
          <button key={item.label} type="button" className={`nav-item ${active ? "nav-item-active" : ""}`} onClick={() => onSelect(item.label)}>
            <Icon size={18} />
            <span>{item.label}</span>
          </button>
        );
      })}
    </nav>
  );

  return (
    <>
    <div className="mobile-nav xl:hidden">
      {navItems.map((item) => {
        const Icon = item.icon;
        const active = item.label === activeLabel;
        return (
          <button key={item.label} type="button" className={`mobile-nav-item ${active ? "is-active" : ""}`} onClick={() => onSelect(item.label)}>
            <Icon size={16} />
            <span>{item.label}</span>
          </button>
        );
      })}
    </div>
    <aside className={`sidebar-glass hidden xl:flex ${collapsed ? "is-collapsed" : ""}`}>
      <div>
        <button
          type="button"
          className={`brand-button mb-8 ${activeLabel === "仪表盘" ? "is-active" : ""}`}
          aria-label="打开仪表盘"
          title={running ? "Quant Studio · 策略运行中" : "Quant Studio · 策略已停止"}
          onClick={() => onSelect("仪表盘")}
        >
          <div className="brand-mark">
            <FlaskConical size={18} />
            <span className={`brand-status ${running ? "is-running" : "is-stopped"}`} />
          </div>
          <div className="sidebar-copy">
            <p className="text-sm text-slate-400">OKX Lab</p>
            <h1 className="text-lg font-semibold tracking-wide text-white">Quant Studio</h1>
          </div>
        </button>
        {nav}
      </div>

      <div className="space-y-3">
        <div className={`sidebar-run-summary ${running ? "is-running" : "is-stopped"}`}>
          <span>Paper Loop</span>
          <strong>{running ? "运行中" : "已停止"}</strong>
          <p>{running ? "信号和模拟盘持续推进" : "不会自动推进信号"}</p>
        </div>
        <div className="theme-switch-shell">
          <div className="grid grid-cols-2 gap-1">
            <button
              type="button"
              className={`theme-button ${theme === "light" ? "is-active" : ""}`}
              aria-label="切换日间模式"
              aria-pressed={theme === "light"}
              onClick={() => onThemeChange?.("light")}
            >
              <Sun size={16} />
            </button>
            <button
              type="button"
              className={`theme-button ${theme === "dark" ? "is-active" : ""}`}
              aria-label="切换夜间模式"
              aria-pressed={theme === "dark"}
              onClick={() => onThemeChange?.("dark")}
            >
              <Moon size={16} />
            </button>
          </div>
        </div>
        <button
          type="button"
          className="sidebar-collapse-button"
          aria-label={collapsed ? "展开侧栏" : "折叠侧栏"}
          onClick={() => onCollapseChange?.(!collapsed)}
        >
          {collapsed ? <ChevronsRight size={20} /> : <ChevronsLeft size={20} />}
          <span>{collapsed ? ">>" : "<<"}</span>
        </button>
      </div>
    </aside>
    </>
  );
}
