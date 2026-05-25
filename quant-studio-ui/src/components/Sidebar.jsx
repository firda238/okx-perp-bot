import { ChevronsLeft, Moon, Sun } from "lucide-react";
import { useState } from "react";
import { navItems } from "../data/mockData";

export default function Sidebar({ activeLabel, onSelect }) {
  const [theme, setTheme] = useState("dark");
  const [collapsed, setCollapsed] = useState(false);

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
        <div className="mb-8 flex items-center gap-3 px-2">
          <div className="brand-mark" />
          <div className="sidebar-copy">
            <p className="text-sm text-slate-400">OKX Lab</p>
            <h1 className="text-lg font-semibold tracking-wide text-white">Quant Studio</h1>
          </div>
        </div>
        {nav}
      </div>

      <div className="space-y-3">
        <div className="rounded-[18px] border border-white/10 bg-white/[0.04] p-1.5">
          <div className="grid grid-cols-2 gap-1">
            <button type="button" className={`theme-button ${theme === "light" ? "is-active" : ""}`} onClick={() => setTheme("light")}>
              <Sun size={16} />
            </button>
            <button type="button" className={`theme-button ${theme === "dark" ? "is-active" : ""}`} onClick={() => setTheme("dark")}>
              <Moon size={16} />
            </button>
          </div>
        </div>
        <button type="button" className="nav-item justify-center" onClick={() => setCollapsed((value) => !value)}>
          <ChevronsLeft size={18} />
          <span>{collapsed ? ">>" : "<<"}</span>
        </button>
      </div>
    </aside>
    </>
  );
}
