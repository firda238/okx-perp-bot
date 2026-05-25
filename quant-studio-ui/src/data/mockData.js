import {
  Activity,
  BarChart3,
  Bell,
  BrainCircuit,
  CandlestickChart,
  Database,
  Gauge,
  LayoutDashboard,
  LineChart,
  ListOrdered,
  LockKeyhole,
  Settings,
  ShieldAlert,
  SlidersHorizontal,
  Wallet,
  Waves,
} from "lucide-react";

export const navItems = [
  { label: "仪表盘", icon: LayoutDashboard },
  { label: "市场", icon: BarChart3 },
  { label: "策略", icon: BrainCircuit, active: true },
  { label: "回测", icon: CandlestickChart },
  { label: "实盘", icon: Activity },
  { label: "风控", icon: ShieldAlert },
  { label: "数据", icon: Database },
  { label: "设置", icon: Settings },
];

export const chartTools = [
  { label: "十字光标", icon: Gauge },
  { label: "趋势线", icon: LineChart },
  { label: "形态工具", icon: Waves },
  { label: "指标", icon: SlidersHorizontal },
  { label: "文本", icon: ListOrdered },
  { label: "测量", icon: BarChart3 },
  { label: "磁吸", icon: LockKeyhole },
  { label: "删除", icon: Bell },
];

export const strategyParams = {
  name: "Chan Harmonic Alpha",
  status: "运行中",
  leverage: 10,
  stopLoss: 2.0,
  takeProfit: 4.0,
  positionSize: 10.0,
  slippage: 0.05,
};

export const metrics = [
  { label: "净利润 (USDT)", value: "+162,528.20", change: "+18.24%", tone: "profit", icon: Wallet },
  { label: "夏普比率", value: "1.87", change: "稳定增强", tone: "violet", icon: LineChart },
  { label: "最大回撤", value: "-13.48%", change: "风险可控", tone: "risk", icon: ShieldAlert },
  { label: "胜率", value: "62.35%", change: "326 笔样本", tone: "blue", icon: Gauge },
  { label: "盈利因子", value: "1.93", change: "优于基准", tone: "violet", icon: SlidersHorizontal },
  { label: "总交易数", value: "326", change: "Long 184 / Short 142", tone: "cyan", icon: ListOrdered },
];

export const trades = [
  { time: "2024/05/24 14:20", side: "Long", symbol: "BTC/USDT", entry: "67,245.5", exit: "67,592.1", pnl: "+3,465.12", pct: "+1.25%" },
  { time: "2024/05/24 11:10", side: "Short", symbol: "BTC/USDT", entry: "67,812.3", exit: "67,120.0", pnl: "+6,912.45", pct: "+2.08%" },
  { time: "2024/05/23 22:45", side: "Long", symbol: "BTC/USDT", entry: "66,102.7", exit: "66,812.3", pnl: "+7,096.21", pct: "+1.73%" },
  { time: "2024/05/23 18:30", side: "Long", symbol: "BTC/USDT", entry: "65,812.3", exit: "66,102.7", pnl: "+2,903.11", pct: "+0.89%" },
  { time: "2024/05/23 15:05", side: "Short", symbol: "BTC/USDT", entry: "66,980.5", exit: "66,200.1", pnl: "+7,804.22", pct: "+2.34%" },
];

export const equityCurveData = [
  { month: "23-01", value: -20000 },
  { month: "23-02", value: -12000 },
  { month: "23-03", value: 8000 },
  { month: "23-04", value: 22000 },
  { month: "23-05", value: 18000 },
  { month: "23-06", value: 41000 },
  { month: "23-07", value: 65000 },
  { month: "23-08", value: 52000 },
  { month: "23-09", value: 77000 },
  { month: "23-10", value: 101000 },
  { month: "23-11", value: 94000 },
  { month: "23-12", value: 125000 },
  { month: "24-01", value: 138000 },
  { month: "24-02", value: 121000 },
  { month: "24-03", value: 156000 },
  { month: "24-04", value: 172000 },
  { month: "24-05", value: 190000 },
];

export const chartMockData = Array.from({ length: 58 }, (_, index) => {
  const trend = 64800 + index * 48 + Math.sin(index / 3) * 720;
  const open = trend + Math.sin(index * 1.7) * 190;
  const close = trend + Math.cos(index * 1.35) * 250;
  const high = Math.max(open, close) + 180 + (index % 7) * 28;
  const low = Math.min(open, close) - 170 - (index % 5) * 32;
  return {
    time: `${String(9 + Math.floor(index / 2)).padStart(2, "0")}:${index % 2 ? "30" : "00"}`,
    open,
    close,
    high,
    low,
    volume: 220 + Math.abs(close - open) * 0.42 + (index % 8) * 18,
    ma20: trend - 120 + Math.sin(index / 5) * 180,
    ma50: trend - 520 + Math.sin(index / 7) * 140,
    ma200: trend - 1320 + Math.cos(index / 8) * 110,
  };
});

export const tradeMarkers = [
  { index: 8, label: "Buy", tone: "buy", y: 64 },
  { index: 18, label: "Sell", tone: "sell", y: 38 },
  { index: 31, label: "Buy", tone: "profit", y: 58 },
  { index: 45, label: "Exit", tone: "exit", y: 32 },
];
