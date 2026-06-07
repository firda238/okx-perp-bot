import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { cancelTask, clearTasks, compactDataCache, defaultStrategyParams, enqueueTask, getAi4TradeStatus, getAutomationReadinessSnapshots, getAutomationStatus, getCandles, getDataRefreshProgress, getDataStatus, getExecutionConfig, getExecutionEnvironment, getExecutionOrders, getLatestResearchSnapshot, getOkxAccount, getOkxDiagnostics, getOkxPositions, getPaperAudit, getPaperEquityHistory, getPaperStatus, getResearchSnapshot, getResearchSnapshots, getSystemStatus, getTasks, getTradeWindowCandles, recordExecutionOrderAction, refreshDataCache, refreshStaleDataCache, runAutomationPreflight, runExecutionDryRun, runPortfolioBacktest, runReadiness, runSignalScan, saveResearchSnapshot, setOkxSessionCredentials, startPaper, stopPaper, submitLiveOrder } from "./api";
import ChartPanel from "./components/ChartPanel";
import Sidebar from "./components/Sidebar";
import StrategyControlPanel from "./components/StrategyControlPanel";
import TopBar from "./components/TopBar";
import { DashboardView, DataView, LiveView, MarketView, RiskView, SettingsView } from "./components/WorkspaceViews";

const BacktestPanel = lazy(() => import("./components/BacktestPanel"));
const DASHBOARD_REFRESH_MS = 15 * 60 * 1000;

function readStoredPreference(key, fallback) {
  if (typeof window === "undefined") return fallback;
  return window.localStorage.getItem(key) ?? fallback;
}

function readinessAllowsStart(result) {
  return String(result?.decision || "").includes("允许");
}

export default function App() {
  const [running, setRunning] = useState(true);
  const [paperState, setPaperState] = useState(null);
  const [paperAudit, setPaperAudit] = useState(null);
  const [paperEquityHistory, setPaperEquityHistory] = useState(null);
  const [portfolio, setPortfolio] = useState(null);
  const [optimization, setOptimization] = useState(null);
  const [riskExperiments, setRiskExperiments] = useState(null);
  const [readiness, setReadiness] = useState(null);
  const [signalScan, setSignalScan] = useState(null);
  const [selectedBacktestTrade, setSelectedBacktestTrade] = useState(null);
  const [executionPlan, setExecutionPlan] = useState(null);
  const [executionConfig, setExecutionConfig] = useState(null);
  const [executionEnvironment, setExecutionEnvironment] = useState(null);
  const [executionOrders, setExecutionOrders] = useState(null);
  const [automationStatus, setAutomationStatus] = useState(null);
  const [readinessSnapshots, setReadinessSnapshots] = useState(null);
  const [ai4tradeStatus, setAi4tradeStatus] = useState(null);
  const [okxAccount, setOkxAccount] = useState(null);
  const [okxDiagnostics, setOkxDiagnostics] = useState(null);
  const [okxPositions, setOkxPositions] = useState(null);
  const [preflightSteps, setPreflightSteps] = useState([]);
  const [liveSubmitResult, setLiveSubmitResult] = useState(null);
  const [experimentCandidate, setExperimentCandidate] = useState(null);
  const [snapshot, setSnapshot] = useState(null);
  const [baselineSnapshot, setBaselineSnapshot] = useState(null);
  const [snapshotSaveResult, setSnapshotSaveResult] = useState(null);
  const [tradeWindow, setTradeWindow] = useState(null);
  const [dataRefreshResult, setDataRefreshResult] = useState(null);
  const [dataRefreshProgress, setDataRefreshProgress] = useState(null);
  const [dataCompactResult, setDataCompactResult] = useState(null);
  const [dataRefreshBatchSize, setDataRefreshBatchSize] = useState(4);
  const [portfolioMode, setPortfolioMode] = useState("snapshot");
  const [candles, setCandles] = useState([]);
  const [dataStatus, setDataStatus] = useState(null);
  const [systemStatus, setSystemStatus] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [appliedTaskResults, setAppliedTaskResults] = useState({});
  const [researchSnapshots, setResearchSnapshots] = useState(null);
  const [selectedResearchSnapshot, setSelectedResearchSnapshot] = useState(null);
  const [activeView, setActiveView] = useState("仪表盘");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => readStoredPreference("quant-sidebar-collapsed", "false") === "true");
  const [theme, setTheme] = useState(() => readStoredPreference("quant-theme", "dark"));
  const [market, setMarket] = useState({ instId: defaultStrategyParams.instId, bar: defaultStrategyParams.bar });
  const [strategyConfig, setStrategyConfig] = useState(defaultStrategyParams);
  const [loading, setLoading] = useState({ paper: true, audit: true, equityHistory: true, executionConfig: true, executionEnvironment: true, executionOrders: true, automation: true, ai4trade: true, okx: true, okxDiagnostics: true, okxCredentials: false, preflight: false, portfolio: true, candles: true, tradeWindow: false, optimize: false, riskExperiments: false, readiness: false, signalScan: false, execution: false, liveSubmit: false, action: false, snapshot: false, snapshotInspect: false, dataRefresh: false, dataCompact: false, tasks: false, systemStatus: false });
  const [error, setError] = useState("");

  const runParams = useCallback(
    () => ({ ...strategyConfig, instId: market.instId, bar: market.bar }),
    [market.bar, market.instId, strategyConfig],
  );

  const updateMarket = useCallback((updater) => {
    setReadiness(null);
    setSignalScan(null);
    setExecutionPlan(null);
    setLiveSubmitResult(null);
    setSelectedBacktestTrade(null);
    setTradeWindow(null);
    setMarket((current) => (typeof updater === "function" ? updater(current) : updater));
  }, []);

  const updateStrategyConfig = useCallback((updater) => {
    setReadiness(null);
    setSignalScan(null);
    setExecutionPlan(null);
    setLiveSubmitResult(null);
    setSelectedBacktestTrade(null);
    setTradeWindow(null);
    setStrategyConfig((current) => (typeof updater === "function" ? updater(current) : updater));
  }, []);

  const applySnapshot = useCallback((loaded, sourceRow = null) => {
    const settings = { ...defaultStrategyParams, ...(loaded.settings || {}) };
    const nextSnapshot = {
      ...loaded,
      file: loaded.file || sourceRow?.file,
      path: loaded.path || sourceRow?.path,
    };
    setSnapshot(nextSnapshot);
    setBaselineSnapshot(nextSnapshot);
    setSelectedResearchSnapshot(nextSnapshot);
    setPortfolio(loaded.portfolio);
    setPortfolioMode("snapshot");
    setExperimentCandidate(null);
    setReadiness(null);
    setSignalScan(null);
    setExecutionPlan(null);
    setLiveSubmitResult(null);
    setSelectedBacktestTrade(null);
    setTradeWindow(null);
    setSnapshotSaveResult(null);
    setStrategyConfig(settings);
    setMarket((current) => ({
      instId: settings.instId || current.instId,
      bar: settings.bar || current.bar,
    }));
  }, []);

  const refreshPaper = useCallback(async () => {
    setLoading((state) => ({ ...state, paper: true }));
    try {
      const state = await getPaperStatus();
      setPaperState(state);
      setRunning(Boolean(state.running));
      setError("");
    } catch (err) {
      setError(`模拟盘状态读取失败：${err.message}`);
    } finally {
      setLoading((state) => ({ ...state, paper: false }));
    }
  }, []);

  const refreshPaperAudit = useCallback(async () => {
    setLoading((state) => ({ ...state, audit: true }));
    try {
      const result = await getPaperAudit(60);
      setPaperAudit(result);
      setError("");
    } catch (err) {
      setError(`模拟盘审计读取失败：${err.message}`);
    } finally {
      setLoading((state) => ({ ...state, audit: false }));
    }
  }, []);

  const refreshPaperEquityHistory = useCallback(async () => {
    setLoading((state) => ({ ...state, equityHistory: true }));
    try {
      const result = await getPaperEquityHistory({ limit: 2000 });
      setPaperEquityHistory(result);
      setError("");
    } catch (err) {
      setError(`权益历史读取失败：${err.message}`);
    } finally {
      setLoading((state) => ({ ...state, equityHistory: false }));
    }
  }, []);

  const refreshExecutionConfig = useCallback(async () => {
    setLoading((state) => ({ ...state, executionConfig: true }));
    try {
      const result = await getExecutionConfig();
      setExecutionConfig(result);
      setError("");
    } catch (err) {
      setError(`执行环境读取失败：${err.message}`);
    } finally {
      setLoading((state) => ({ ...state, executionConfig: false }));
    }
  }, []);

  const refreshExecutionEnvironment = useCallback(async () => {
    setLoading((state) => ({ ...state, executionEnvironment: true }));
    try {
      const result = await getExecutionEnvironment();
      setExecutionEnvironment(result);
      setError("");
    } catch (err) {
      setError(`执行环境联动读取失败：${err.message}`);
    } finally {
      setLoading((state) => ({ ...state, executionEnvironment: false }));
    }
  }, []);

  const refreshExecutionOrders = useCallback(async () => {
    setLoading((state) => ({ ...state, executionOrders: true }));
    try {
      const result = await getExecutionOrders(60);
      setExecutionOrders(result);
      setError("");
    } catch (err) {
      setError(`执行账本读取失败：${err.message}`);
    } finally {
      setLoading((state) => ({ ...state, executionOrders: false }));
    }
  }, []);

  const refreshAutomationStatus = useCallback(async () => {
    setLoading((state) => ({ ...state, automation: true }));
    try {
      const result = await getAutomationStatus();
      setAutomationStatus(result);
      setError("");
    } catch (err) {
      setError(`自动化自检读取失败：${err.message}`);
    } finally {
      setLoading((state) => ({ ...state, automation: false }));
    }
  }, []);

  const refreshReadinessSnapshots = useCallback(async () => {
    try {
      const result = await getAutomationReadinessSnapshots(30);
      setReadinessSnapshots(result);
      setError("");
    } catch (err) {
      setError(`Readiness快照读取失败：${err.message}`);
    }
  }, []);

  const runAutomationCheck = useCallback(async () => {
    setLoading((state) => ({ ...state, automation: true, preflight: true }));
    try {
      const result = await runAutomationPreflight(runParams());
      if (result?.automation) setAutomationStatus(result.automation);
      if (result?.dry_run) setExecutionPlan(result.dry_run);
      await Promise.all([refreshPaperAudit(), refreshPaperEquityHistory(), refreshExecutionOrders(), refreshExecutionConfig(), refreshExecutionEnvironment(), refreshReadinessSnapshots()]);
      setError("");
      return result;
    } catch (err) {
      setError(`自动化自检失败：${err.message}`);
      throw err;
    } finally {
      setLoading((state) => ({ ...state, automation: false, preflight: false }));
    }
  }, [refreshExecutionConfig, refreshExecutionEnvironment, refreshExecutionOrders, refreshPaperAudit, refreshPaperEquityHistory, refreshReadinessSnapshots, runParams]);

  const refreshAi4TradeStatus = useCallback(async () => {
    setLoading((state) => ({ ...state, ai4trade: true }));
    try {
      const result = await getAi4TradeStatus();
      setAi4tradeStatus(result);
      setError("");
    } catch (err) {
      setError(`AI4Trade 只读状态读取失败：${err.message}`);
    } finally {
      setLoading((state) => ({ ...state, ai4trade: false }));
    }
  }, []);

  const refreshOkxReadonly = useCallback(async () => {
    setLoading((state) => ({ ...state, okx: true }));
    try {
      const [account, positions] = await Promise.all([getOkxAccount(), getOkxPositions({ instType: "SWAP" })]);
      setOkxAccount(account);
      setOkxPositions(positions);
      setError("");
    } catch (err) {
      setError(`OKX 只读账户读取失败：${err.message}`);
    } finally {
      setLoading((state) => ({ ...state, okx: false }));
    }
  }, []);

  const runOkxDiagnostics = useCallback(async () => {
    setLoading((state) => ({ ...state, okxDiagnostics: true }));
    try {
      const result = await getOkxDiagnostics();
      setOkxDiagnostics(result);
      setError("");
    } catch (err) {
      setError(`OKX 连接诊断失败：${err.message}`);
    } finally {
      setLoading((state) => ({ ...state, okxDiagnostics: false }));
    }
  }, []);

  const saveOkxSessionCredentials = useCallback(async (payload) => {
    setLoading((state) => ({ ...state, okxCredentials: true }));
    try {
      const result = await setOkxSessionCredentials(payload);
      await Promise.all([
        refreshExecutionConfig(),
        refreshExecutionEnvironment(),
        refreshOkxReadonly(),
        runOkxDiagnostics(),
        refreshAutomationStatus(),
        refreshReadinessSnapshots(),
        refreshPaperEquityHistory(),
      ]);
      setError("");
      return result;
    } catch (err) {
      setError(`OKX 密钥配置失败：${err.message}`);
      throw err;
    } finally {
      setLoading((state) => ({ ...state, okxCredentials: false }));
    }
  }, [refreshAutomationStatus, refreshExecutionConfig, refreshExecutionEnvironment, refreshOkxReadonly, refreshPaperEquityHistory, refreshReadinessSnapshots, runOkxDiagnostics]);

  const refreshPortfolio = useCallback(async () => {
    setLoading((state) => ({ ...state, portfolio: true }));
    try {
      const result = await runPortfolioBacktest(runParams());
      setPortfolio(result);
      setPortfolioMode("experiment");
      setExperimentCandidate(null);
      setSnapshotSaveResult(null);
      setError("");
    } catch (err) {
      setError(`组合回测失败：${err.message}`);
    } finally {
      setLoading((state) => ({ ...state, portfolio: false }));
    }
  }, [runParams]);

  const refreshCandles = useCallback(async () => {
    setLoading((state) => ({ ...state, candles: true }));
    try {
      const result = await getCandles(market.instId, market.bar, 180);
      setCandles(result.candles || []);
      setError("");
    } catch (err) {
      setError(`行情读取失败：${err.message}`);
    } finally {
      setLoading((state) => ({ ...state, candles: false }));
    }
  }, [market.bar, market.instId]);

  const refreshDataStatus = useCallback(async () => {
    try {
      const [status, snapshots] = await Promise.all([getDataStatus(), getResearchSnapshots(12)]);
      setDataStatus(status);
      setResearchSnapshots(snapshots);
      setError("");
    } catch (err) {
      setError(`数据状态读取失败：${err.message}`);
    }
  }, []);

  const refreshSystemStatus = useCallback(async () => {
    setLoading((state) => ({ ...state, systemStatus: true }));
    try {
      const status = await getSystemStatus();
      setSystemStatus(status);
      setError("");
    } catch (err) {
      setError(`系统状态读取失败：${err.message}`);
    } finally {
      setLoading((state) => ({ ...state, systemStatus: false }));
    }
  }, []);

  const refreshTasks = useCallback(async () => {
    setLoading((state) => ({ ...state, tasks: true }));
    try {
      const result = await getTasks(12);
      setTasks(result.tasks || []);
      setError("");
    } catch (err) {
      setError(`任务队列读取失败：${err.message}`);
    } finally {
      setLoading((state) => ({ ...state, tasks: false }));
    }
  }, []);

  const startBackgroundTask = useCallback(async (type, params = {}) => {
    setLoading((state) => ({ ...state, tasks: true }));
    try {
      await enqueueTask(type, params);
      const result = await getTasks(12);
      setTasks(result.tasks || []);
      setError("");
    } catch (err) {
      setError(`启动后台任务失败：${err.message}`);
    } finally {
      setLoading((state) => ({ ...state, tasks: false }));
    }
  }, []);

  const cancelBackgroundTask = useCallback(async (id) => {
    if (!id) return;
    setLoading((state) => ({ ...state, tasks: true }));
    try {
      await cancelTask(id);
      const result = await getTasks(12);
      setTasks(result.tasks || []);
      setError("");
    } catch (err) {
      setError(`取消后台任务失败：${err.message}`);
    } finally {
      setLoading((state) => ({ ...state, tasks: false }));
    }
  }, []);

  const clearBackgroundTasks = useCallback(async () => {
    setLoading((state) => ({ ...state, tasks: true }));
    try {
      const result = await clearTasks();
      setTasks(result.tasks || []);
      setAppliedTaskResults({});
      setError("");
    } catch (err) {
      setError(`清理后台任务失败：${err.message}`);
    } finally {
      setLoading((state) => ({ ...state, tasks: false }));
    }
  }, []);

  const runOptimization = useCallback(async () => {
    setLoading((state) => ({ ...state, optimize: true }));
    try {
      await enqueueTask("joint_optimize", { ...runParams(), history_hours: 168, windows: [168] });
      const result = await getTasks(12);
      setTasks(result.tasks || []);
      setError("");
    } catch (err) {
      setError(`后台优化扫描启动失败：${err.message}`);
    } finally {
      setLoading((state) => ({ ...state, optimize: false }));
    }
  }, [runParams]);

  const runRiskExperiments = useCallback(async () => {
    setLoading((state) => ({ ...state, riskExperiments: true }));
    try {
      await enqueueTask("attribution_experiments", runParams());
      const result = await getTasks(12);
      setTasks(result.tasks || []);
      setError("");
    } catch (err) {
      setError(`后台风险/退出实验启动失败：${err.message}`);
    } finally {
      setLoading((state) => ({ ...state, riskExperiments: false }));
    }
  }, [runParams]);

  const runReadinessCheck = useCallback(async () => {
    setLoading((state) => ({ ...state, readiness: true }));
    try {
      await enqueueTask("readiness", runParams());
      const result = await getTasks(12);
      setTasks(result.tasks || []);
      setError("");
    } catch (err) {
      setError(`后台准入检查启动失败：${err.message}`);
    } finally {
      setLoading((state) => ({ ...state, readiness: false }));
    }
  }, [runParams]);

  const runManualSignalScan = useCallback(async () => {
    setLoading((state) => ({ ...state, signalScan: true }));
    try {
      const params = runParams();
      const result = await runSignalScan({
        ...params,
        scan_history_hours: Math.min(Number(params.history_hours || 240), 240),
      });
      setSignalScan(result);
      await refreshPaper();
      setError("");
    } catch (err) {
      setError(`信号扫描失败：${err.message}`);
    } finally {
      setLoading((state) => ({ ...state, signalScan: false }));
    }
  }, [refreshPaper, runParams]);

  const runExecutionPlan = useCallback(async () => {
    setLoading((state) => ({ ...state, execution: true }));
    try {
      const result = await runExecutionDryRun(runParams());
      setExecutionPlan(result);
      setLiveSubmitResult(null);
      await Promise.all([refreshPaperAudit(), refreshPaperEquityHistory(), refreshExecutionOrders(), refreshAutomationStatus(), refreshReadinessSnapshots(), refreshOkxReadonly(), refreshExecutionEnvironment(), runOkxDiagnostics()]);
      setError("");
    } catch (err) {
      setError(`执行 dry-run 失败：${err.message}`);
    } finally {
      setLoading((state) => ({ ...state, execution: false }));
    }
  }, [refreshAutomationStatus, refreshExecutionEnvironment, refreshExecutionOrders, refreshOkxReadonly, refreshPaperAudit, refreshPaperEquityHistory, refreshReadinessSnapshots, runOkxDiagnostics, runParams]);

  const runLivePreflight = useCallback(async () => {
    const startedAt = new Date().toISOString();
    const setStep = (key, patch) => {
      setPreflightSteps((rows) => {
        const existing = rows.find((row) => row.key === key);
        const next = { key, ...(existing || {}), ...patch, updated_at: new Date().toISOString() };
        return existing ? rows.map((row) => (row.key === key ? next : row)) : [...rows, next];
      });
    };
    setPreflightSteps([
      { key: "environment", label: "刷新环境", status: "pending", detail: "等待执行", updated_at: startedAt },
      { key: "diagnostics", label: "OKX诊断", status: "pending", detail: "等待执行", updated_at: startedAt },
      { key: "dry_run", label: "执行预演", status: "pending", detail: "等待执行", updated_at: startedAt },
      { key: "ledger", label: "同步审计", status: "pending", detail: "等待执行", updated_at: startedAt },
    ]);
    setLoading((state) => ({ ...state, preflight: true }));
    try {
      setStep("environment", { status: "running", detail: "读取执行环境和 OKX 只读账户" });
      const config = await getExecutionConfig();
      setExecutionConfig(config);
      const environment = await getExecutionEnvironment();
      setExecutionEnvironment(environment);
      if (environment?.okx_account) setOkxAccount(environment.okx_account);
      if (environment?.okx_positions) setOkxPositions(environment.okx_positions);
      setStep("environment", {
        status: environment?.readonly_ready ? "pass" : "warn",
        detail: environment?.readonly_ready ? "OKX只读账户可用" : "OKX只读账户不可用",
      });
      setStep("diagnostics", { status: "running", detail: "运行签名、权限和账户读取诊断" });
      const diagnostics = await getOkxDiagnostics();
      setOkxDiagnostics(diagnostics);
      setStep("diagnostics", {
        status: diagnostics?.readonly_ok ? "pass" : "fail",
        detail: diagnostics?.readonly_ok ? "诊断通过" : diagnostics?.actions?.[0] || "诊断未通过",
      });
      setStep("dry_run", { status: "running", detail: "拉取最新 OKX 行情并生成 dry-run" });
      const plan = await runExecutionDryRun(runParams());
      setExecutionPlan(plan);
      setLiveSubmitResult(null);
      setStep("dry_run", {
        status: plan?.data_quality?.ok ? "pass" : "warn",
        detail: plan?.data_quality?.message || plan?.final_gate?.decision || "执行预演完成",
      });
      setStep("ledger", { status: "running", detail: "读取执行账本和审计记录" });
      const [audit, orders] = await Promise.all([getPaperAudit(60), getExecutionOrders(60)]);
      setPaperAudit(audit);
      setExecutionOrders(orders);
      await Promise.all([refreshAutomationStatus(), refreshReadinessSnapshots()]);
      setStep("ledger", { status: "pass", detail: "审计和账本已更新" });
      setError("");
    } catch (err) {
      setPreflightSteps((rows) => rows.map((row) => (row.status === "running" ? { ...row, status: "fail", detail: err.message, updated_at: new Date().toISOString() } : row)));
      setError(`一键预演失败：${err.message}`);
    } finally {
      setLoading((state) => ({ ...state, preflight: false }));
    }
  }, [refreshAutomationStatus, refreshReadinessSnapshots, runParams]);

  const runLiveSubmitLockTest = useCallback(async (confirmation = "", options = {}) => {
    setLoading((state) => ({ ...state, liveSubmit: true }));
    try {
      const result = await submitLiveOrder({
        ...runParams(),
        order_intent: executionPlan?.order_intent || null,
        guard: executionPlan?.guard || null,
        data_quality: executionPlan?.data_quality || null,
        confirmation,
        use_canary: Boolean(options.use_canary),
      });
      setLiveSubmitResult(result);
      await Promise.all([refreshPaperAudit(), refreshPaperEquityHistory(), refreshExecutionConfig(), refreshExecutionOrders(), refreshAutomationStatus(), refreshReadinessSnapshots()]);
      setError("");
    } catch (err) {
      setError(`实盘提交锁测试失败：${err.message}`);
    } finally {
      setLoading((state) => ({ ...state, liveSubmit: false }));
    }
  }, [executionPlan, refreshAutomationStatus, refreshExecutionConfig, refreshExecutionOrders, refreshPaperAudit, refreshPaperEquityHistory, refreshReadinessSnapshots, runParams]);

  const recordExecutionAction = useCallback(async (action, source, options = {}) => {
    if (!action || !source) return;
    setLoading((state) => ({ ...state, liveSubmit: true }));
    try {
      await recordExecutionOrderAction({ action, source, ...options });
      await Promise.all([refreshExecutionOrders(), refreshSystemStatus(), refreshPaperAudit()]);
      setError("");
    } catch (err) {
      setError(`执行账本处置记录失败：${err.message}`);
    } finally {
      setLoading((state) => ({ ...state, liveSubmit: false }));
    }
  }, [refreshExecutionOrders, refreshPaperAudit, refreshSystemStatus]);

  const refreshWorkspaceStatus = useCallback(async () => {
    setLoading((state) => ({ ...state, action: true }));
    try {
      await Promise.all([
        refreshPaper(),
        refreshPaperAudit(),
        refreshPaperEquityHistory(),
        refreshExecutionConfig(),
        refreshExecutionEnvironment(),
        refreshExecutionOrders(),
        refreshAutomationStatus(),
        refreshReadinessSnapshots(),
        refreshAi4TradeStatus(),
        refreshOkxReadonly(),
        runOkxDiagnostics(),
        refreshDataStatus(),
        refreshSystemStatus(),
      ]);
      setError("");
    } catch (err) {
      setError(`状态同步失败：${err.message}`);
    } finally {
      setLoading((state) => ({ ...state, action: false }));
    }
  }, [refreshAi4TradeStatus, refreshAutomationStatus, refreshDataStatus, refreshExecutionConfig, refreshExecutionEnvironment, refreshExecutionOrders, refreshOkxReadonly, refreshPaper, refreshPaperAudit, refreshPaperEquityHistory, refreshReadinessSnapshots, refreshSystemStatus, runOkxDiagnostics]);

  const applyCandidate = useCallback(async (candidate) => {
    const nextConfig = { ...strategyConfig, ...(candidate?.params || {}) };
    setStrategyConfig(nextConfig);
    setReadiness(null);
    setExecutionPlan(null);
    setLiveSubmitResult(null);
    setLoading((state) => ({ ...state, portfolio: true }));
    try {
      const result = await runPortfolioBacktest({ ...nextConfig, instId: market.instId, bar: market.bar });
      setPortfolio(result);
      setPortfolioMode("experiment");
      setSnapshotSaveResult(null);
      setExperimentCandidate({
        applied_at: new Date().toISOString(),
        params: candidate?.params || {},
        score: candidate?.score,
        raw_score: candidate?.raw_score,
        health: candidate?.health,
        diagnostics: candidate?.diagnostics,
        summary: candidate?.summary,
      });
      setError("");
    } catch (err) {
      setError(`应用候选失败：${err.message}`);
    } finally {
      setLoading((state) => ({ ...state, portfolio: false }));
    }
  }, [market.bar, market.instId, strategyConfig]);

  useEffect(() => {
    refreshPaper();
    refreshPaperAudit();
    refreshPaperEquityHistory();
    refreshExecutionConfig();
    refreshExecutionEnvironment();
    refreshExecutionOrders();
    refreshAutomationStatus();
    refreshReadinessSnapshots();
    refreshAi4TradeStatus();
    refreshOkxReadonly();
    runOkxDiagnostics();
    refreshDataStatus();
    refreshSystemStatus();
    refreshTasks();
  }, [refreshAi4TradeStatus, refreshAutomationStatus, refreshDataStatus, refreshExecutionConfig, refreshExecutionEnvironment, refreshExecutionOrders, refreshOkxReadonly, refreshPaper, refreshPaperAudit, refreshPaperEquityHistory, refreshReadinessSnapshots, refreshSystemStatus, refreshTasks, runOkxDiagnostics]);

  useEffect(() => {
    window.localStorage.setItem("quant-theme", theme);
  }, [theme]);

  useEffect(() => {
    window.localStorage.setItem("quant-sidebar-collapsed", String(sidebarCollapsed));
  }, [sidebarCollapsed]);

  useEffect(() => {
    if (activeView === "数据") {
      refreshDataStatus();
      refreshTasks();
    }
    if (activeView === "设置") {
      refreshSystemStatus();
    }
  }, [activeView, refreshDataStatus, refreshSystemStatus, refreshTasks]);

  useEffect(() => {
    if (activeView !== "仪表盘") return undefined;
    const timer = window.setInterval(() => {
      refreshPaper();
      refreshPaperAudit();
      refreshPaperEquityHistory();
      refreshExecutionConfig();
      refreshExecutionEnvironment();
      refreshAutomationStatus();
      refreshReadinessSnapshots();
      refreshSystemStatus();
    }, DASHBOARD_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [activeView, refreshAutomationStatus, refreshExecutionConfig, refreshExecutionEnvironment, refreshPaper, refreshPaperAudit, refreshPaperEquityHistory, refreshReadinessSnapshots, refreshSystemStatus]);

  useEffect(() => {
    const hasActiveTask = tasks.some((task) => ["queued", "running"].includes(task.status));
    if (!hasActiveTask && activeView !== "数据") return undefined;
    const timer = window.setInterval(() => {
      refreshTasks();
      if (hasActiveTask) refreshDataStatus();
    }, hasActiveTask ? 1500 : 5000);
    return () => window.clearInterval(timer);
  }, [activeView, refreshDataStatus, refreshTasks, tasks]);

  useEffect(() => {
    const completed = tasks.filter((task) => task.status === "completed" && task.result && !appliedTaskResults[task.id]);
    if (!completed.length) return;
    let shouldRefreshData = false;
    let shouldRefreshAudit = false;
    completed.forEach((task) => {
      if (task.type === "joint_optimize") {
        setOptimization(task.result);
      }
      if (task.type === "attribution_experiments") {
        setRiskExperiments(task.result);
      }
      if (task.type === "readiness") {
        setReadiness(task.result);
        shouldRefreshAudit = true;
      }
      if (task.type === "data_refresh") {
        setDataRefreshResult(task.result);
        setDataRefreshProgress(task.result.progress || null);
        shouldRefreshData = true;
      }
      if (task.type === "compact_cache") {
        setDataCompactResult(task.result);
        shouldRefreshData = true;
      }
    });
    setAppliedTaskResults((current) => {
      const next = { ...current };
      completed.forEach((task) => {
        next[task.id] = true;
      });
      return next;
    });
    if (shouldRefreshData) refreshDataStatus();
    if (shouldRefreshAudit) refreshPaperAudit();
    if (shouldRefreshData || shouldRefreshAudit) refreshSystemStatus();
  }, [appliedTaskResults, refreshDataStatus, refreshPaperAudit, refreshSystemStatus, tasks]);

  useEffect(() => {
    if (!loading.dataRefresh) return undefined;
    let cancelled = false;
    const poll = async () => {
      try {
        const progress = await getDataRefreshProgress();
        if (!cancelled) setDataRefreshProgress(progress);
      } catch {
        // Progress polling is best-effort; the refresh request still returns the final state.
      }
    };
    poll();
    const timer = window.setInterval(poll, 700);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [loading.dataRefresh]);

  useEffect(() => {
    refreshCandles();
  }, [refreshCandles]);

  useEffect(() => {
    if (!selectedBacktestTrade?.entry_time) {
      setTradeWindow(null);
      return undefined;
    }
    let ignore = false;
    async function loadTradeWindow() {
      setLoading((state) => ({ ...state, tradeWindow: true }));
      try {
        const result = await getTradeWindowCandles({
          instId: selectedBacktestTrade.inst_id || market.instId,
          bar: market.bar,
          entry_time: selectedBacktestTrade.entry_time,
          exit_time: selectedBacktestTrade.exit_time,
          before: 80,
          after: 60,
        });
        if (!ignore) {
          setTradeWindow(result);
          setError("");
        }
      } catch (err) {
        if (!ignore) {
          setTradeWindow(null);
          setError(`交易窗口 K 线读取失败：${err.message}`);
        }
      } finally {
        if (!ignore) setLoading((state) => ({ ...state, tradeWindow: false }));
      }
    }
    loadTradeWindow();
    return () => {
      ignore = true;
    };
  }, [market.bar, market.instId, selectedBacktestTrade]);

  useEffect(() => {
    let ignore = false;
    async function loadSnapshot() {
      setLoading((state) => ({ ...state, portfolio: true }));
      try {
        const latest = await getLatestResearchSnapshot();
        if (ignore) return;
        if (latest?.portfolio) {
          applySnapshot(latest);
          setError("");
        } else {
          await refreshPortfolio();
        }
      } catch (err) {
        if (!ignore) {
          setError(`研究快照读取失败：${err.message}`);
          await refreshPortfolio();
        }
      } finally {
        if (!ignore) setLoading((state) => ({ ...state, portfolio: false }));
      }
    }
    loadSnapshot();
    return () => {
      ignore = true;
    };
    // Initial research snapshot load only. Market changes should not overwrite a manually loaded snapshot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const restoreBaselineSnapshot = useCallback(() => {
    if (!baselineSnapshot?.portfolio) return;
    applySnapshot(baselineSnapshot);
  }, [applySnapshot, baselineSnapshot]);

  const loadResearchSnapshot = useCallback(async (row) => {
    if (!row?.file) return;
    setLoading((state) => ({ ...state, portfolio: true }));
    try {
      const loaded = await getResearchSnapshot(row.file);
      if (!loaded?.portfolio) throw new Error("snapshot has no portfolio");
      setSelectedResearchSnapshot({ ...loaded, file: loaded.file || row.file, path: loaded.path || row.path });
      applySnapshot(loaded, row);
      setActiveView("策略");
      setError("");
    } catch (err) {
      setError(`加载研究快照失败：${err.message}`);
    } finally {
      setLoading((state) => ({ ...state, portfolio: false }));
    }
  }, [applySnapshot]);

  const inspectResearchSnapshot = useCallback(async (row) => {
    if (!row?.file) return;
    setLoading((state) => ({ ...state, snapshotInspect: true }));
    try {
      const loaded = await getResearchSnapshot(row.file);
      if (!loaded?.portfolio) throw new Error("snapshot has no portfolio");
      setSelectedResearchSnapshot({ ...loaded, file: loaded.file || row.file, path: loaded.path || row.path });
      setError("");
    } catch (err) {
      setError(`读取研究快照详情失败：${err.message}`);
    } finally {
      setLoading((state) => ({ ...state, snapshotInspect: false }));
    }
  }, []);

  const refreshDataCacheRows = useCallback(async (row = null, recommendedOnly = false, includeHighCost = false) => {
    setLoading((state) => ({ ...state, dataRefresh: true }));
    setDataRefreshProgress(null);
    try {
      if (row) {
        const result = await refreshDataCache(row, 1);
        setDataRefreshResult(result);
        setDataRefreshProgress(result.progress || null);
      } else {
        const result = await refreshStaleDataCache(dataRefreshBatchSize, recommendedOnly, includeHighCost);
        setDataRefreshResult(result);
        setDataRefreshProgress(result.progress || null);
      }
      await refreshDataStatus();
      setError("");
    } catch (err) {
      setError(`刷新 K 线缓存失败：${err.message}`);
    } finally {
      setLoading((state) => ({ ...state, dataRefresh: false }));
    }
  }, [dataRefreshBatchSize, refreshDataStatus]);

  const compactDataCacheRows = useCallback(async (dryRun = true) => {
    setLoading((state) => ({ ...state, dataCompact: true }));
    try {
      const result = await compactDataCache(dryRun);
      setDataCompactResult(result);
      if (!dryRun) await refreshDataStatus();
      setError("");
    } catch (err) {
      setError(`压缩 K 线缓存失败：${err.message}`);
    } finally {
      setLoading((state) => ({ ...state, dataCompact: false }));
    }
  }, [refreshDataStatus]);

  const saveCurrentSnapshot = useCallback(async () => {
    if (!portfolio?.summary) return;
    setLoading((state) => ({ ...state, snapshot: true }));
    try {
      const labelDate = new Date().toISOString().slice(0, 10);
      const result = await saveResearchSnapshot({
        ...runParams(),
        snapshot_mode: "quick",
        provided_portfolio: portfolio,
        snapshot_label: `experiment-${labelDate}`,
        snapshot_meta: {
          source: experimentCandidate ? "optimization-candidate" : "manual-experiment",
          candidate: experimentCandidate,
          displayed_summary: portfolio.summary,
          displayed_health: portfolio.health,
        },
      });
      setSnapshotSaveResult(result);
      const savedSnapshot = {
        created_at: result.created_at,
        label: result.label,
        mode: result.mode,
        file: result.path?.split("/").pop(),
        path: result.path,
        meta: {
          source: experimentCandidate ? "optimization-candidate" : "manual-experiment",
          candidate: experimentCandidate,
          validation_level: "quick-page-result",
        },
        settings: runParams(),
        portfolio,
      };
      applySnapshot(savedSnapshot);
      setResearchSnapshots((state) => state ? {
        ...state,
        rows: [
          {
            file: result.path?.split("/").pop(),
            path: result.path,
            created_at: result.created_at,
            label: result.label,
            mode: result.mode,
            final_equity: result.summary?.final_equity,
            return_pct: result.summary?.return_pct,
            max_drawdown: result.summary?.max_drawdown,
            trades: result.summary?.trades,
            profit_factor: result.summary?.profit_factor,
            health_score: result.summary?.health_score,
            health_grade: result.summary?.health_grade,
            readiness_decision: result.summary?.readiness_decision,
          },
          ...(state.rows || []),
        ].slice(0, 12),
      } : state);
      setError("");
    } catch (err) {
      setError(`保存研究快照失败：${err.message}`);
    } finally {
      setLoading((state) => ({ ...state, snapshot: false }));
    }
  }, [applySnapshot, experimentCandidate, portfolio, runParams]);

  async function togglePaper() {
    setLoading((state) => ({ ...state, action: true, readiness: running ? state.readiness : true }));
    try {
      if (running) {
        await stopPaper();
      } else {
        const params = runParams();
        const result = await runReadiness(params);
        setReadiness(result);
        if (!readinessAllowsStart(result)) {
          await refreshPaperAudit();
          setError(`模拟盘未启动：准入检查 ${result.decision || "未通过"}，${result.next_action || "请先处理失败项。"}`);
          return;
        }
        await startPaper(params, result);
      }
      await refreshPaper();
      await refreshPaperAudit();
      await refreshPaperEquityHistory();
      setError("");
    } catch (err) {
      setError(`模拟盘切换失败：${err.message}`);
    } finally {
      setLoading((state) => ({ ...state, action: false, readiness: false }));
    }
  }

  const chartCandles = tradeWindow?.candles?.length ? tradeWindow.candles : candles;
  const chartMarket = tradeWindow?.candles?.length
    ? { instId: tradeWindow.inst_id || selectedBacktestTrade?.inst_id || market.instId, bar: tradeWindow.bar || market.bar }
    : market;
  const optimizeTaskActive = tasks.some((task) => task.type === "joint_optimize" && ["queued", "running"].includes(task.status));
  const riskExperimentTaskActive = tasks.some((task) => task.type === "attribution_experiments" && ["queued", "running"].includes(task.status));
  const readinessTaskActive = tasks.some((task) => task.type === "readiness" && ["queued", "running"].includes(task.status));

  return (
    <div className={`app-shell theme-${theme} ${sidebarCollapsed ? "is-sidebar-collapsed" : ""}`}>
      <div className="bg-grid" />

      <Sidebar
        activeLabel={activeView}
        collapsed={sidebarCollapsed}
        theme={theme}
        running={running}
        onThemeChange={setTheme}
        onCollapseChange={setSidebarCollapsed}
        onSelect={setActiveView}
      />

      <main className="main-stage">
        <TopBar
          running={running}
          apiError={error}
          loading={loading.paper || loading.portfolio || loading.candles}
          market={market}
          okxAccount={executionEnvironment?.okx_account || okxAccount}
          executionConfig={executionConfig}
          systemStatus={systemStatus}
          onMarketChange={updateMarket}
          onRefresh={() => {
            refreshPortfolio();
            refreshCandles();
            refreshDataStatus();
            refreshSystemStatus();
          }}
          onOpenLive={() => setActiveView("实盘")}
          onOpenView={setActiveView}
        />

        {activeView === "策略" || activeView === "回测" ? (
          <>
            <section className="mt-5 grid gap-5 2xl:grid-cols-[minmax(0,1fr)_334px]">
              <ChartPanel
                candles={chartCandles}
                market={chartMarket}
                loading={loading.candles || loading.tradeWindow}
                trades={portfolio?.trades}
                selectedTrade={selectedBacktestTrade}
                onSelectTrade={setSelectedBacktestTrade}
              />
              <StrategyControlPanel
                running={running}
                paperState={paperState}
                manualSignalScan={signalScan}
                loading={loading.action || loading.paper || loading.portfolio}
                readiness={readiness}
                readinessLoading={loading.readiness || loading.action || readinessTaskActive}
                signalScanLoading={loading.signalScan}
                riskExperimentLoading={loading.riskExperiments || riskExperimentTaskActive}
                config={strategyConfig}
                onConfigChange={updateStrategyConfig}
                onApply={refreshPortfolio}
                onRunSignalScan={runManualSignalScan}
                onRunReadiness={runReadinessCheck}
                onRunRiskExperiments={runRiskExperiments}
                onOpenView={setActiveView}
                onToggleRunning={togglePaper}
              />
            </section>

            <section className="mt-5">
              <Suspense fallback={<div className="panel-loading">正在加载回测面板...</div>}>
                <BacktestPanel
                  portfolio={portfolio}
                  loading={loading.portfolio}
                  error={error}
                  optimization={optimization}
                  riskExperiments={riskExperiments}
                  experimentCandidate={experimentCandidate}
                  snapshot={snapshot}
                  baselinePortfolio={baselineSnapshot?.portfolio}
                  mode={portfolioMode}
                  hasBaselineSnapshot={Boolean(baselineSnapshot?.portfolio)}
                  optimizeLoading={loading.optimize || optimizeTaskActive}
                  riskExperimentLoading={loading.riskExperiments || riskExperimentTaskActive}
                  snapshotSaveLoading={loading.snapshot}
                  snapshotSaveResult={snapshotSaveResult}
                  selectedTrade={selectedBacktestTrade}
                  onRefresh={refreshPortfolio}
                  onOptimize={runOptimization}
                  onRunRiskExperiments={runRiskExperiments}
                  onApplyCandidate={applyCandidate}
                  onSelectTrade={setSelectedBacktestTrade}
                  onSaveSnapshot={saveCurrentSnapshot}
                  onRestoreSnapshot={restoreBaselineSnapshot}
                  onOpenView={setActiveView}
                />
              </Suspense>
            </section>
          </>
        ) : (
          <section className="mt-5">
            {activeView === "仪表盘" ? (
              <DashboardView
                market={market}
                candles={candles}
                portfolio={portfolio}
                paperState={paperState}
                readiness={readiness}
                executionPlan={executionPlan}
                executionConfig={executionConfig}
                executionEnvironment={executionEnvironment}
                automationStatus={automationStatus}
                systemStatus={systemStatus}
                okxDiagnostics={okxDiagnostics}
                dataStatus={dataStatus}
                paperAudit={paperAudit}
                paperEquityHistory={paperEquityHistory}
                refreshAllLoading={loading.paper || loading.equityHistory || loading.portfolio || loading.candles || loading.dataRefresh || loading.automation || loading.systemStatus}
                signalScanLoading={loading.signalScan}
                preflightLoading={loading.preflight}
                onRefreshAll={() => {
                  refreshPortfolio();
                  refreshCandles();
                  refreshDataStatus();
                  refreshPaper();
                  refreshPaperAudit();
                  refreshPaperEquityHistory();
                  refreshExecutionConfig();
                  refreshExecutionEnvironment();
                  refreshAutomationStatus();
                  refreshSystemStatus();
                }}
                onOpenView={setActiveView}
                onRunSignalScan={runManualSignalScan}
                onRunAutomationCheck={runAutomationCheck}
                onRunLivePreflight={runLivePreflight}
              />
            ) : null}
            {activeView === "市场" ? (
              <MarketView
                candles={candles}
                market={market}
                portfolio={portfolio}
                candleLoading={loading.candles}
                dataRefreshLoading={loading.dataRefresh}
                signalScanLoading={loading.signalScan}
                onRefreshCandles={refreshCandles}
                onRefreshMarketCache={async (row) => {
                  await refreshDataCacheRows(row);
                  await refreshCandles();
                }}
                onOpenView={setActiveView}
                onRunSignalScan={runManualSignalScan}
              />
            ) : null}
            {activeView === "风控" ? (
              <RiskView
                paperState={paperState}
                portfolio={portfolio}
                readiness={readiness}
                readinessLoading={loading.readiness || readinessTaskActive}
                riskExperimentLoading={loading.riskExperiments || riskExperimentTaskActive}
                paperAudit={paperAudit}
                auditLoading={loading.audit}
                onRunReadiness={runReadinessCheck}
                onRunRiskExperiments={runRiskExperiments}
                onRefreshAudit={refreshPaperAudit}
                onOpenView={setActiveView}
              />
            ) : null}
            {activeView === "数据" ? (
              <DataView
                dataStatus={dataStatus}
                researchSnapshots={researchSnapshots}
                currentSnapshot={snapshot}
                selectedSnapshot={selectedResearchSnapshot}
                detailLoading={loading.snapshotInspect}
                dataRefreshLoading={loading.dataRefresh}
                dataRefreshResult={dataRefreshResult}
                dataRefreshProgress={dataRefreshProgress}
                dataCompactLoading={loading.dataCompact}
                dataCompactResult={dataCompactResult}
                dataRefreshBatchSize={dataRefreshBatchSize}
                tasks={tasks}
                taskLoading={loading.tasks}
                onDataRefreshBatchSizeChange={setDataRefreshBatchSize}
                onCompactDataCache={compactDataCacheRows}
                onInspectSnapshot={inspectResearchSnapshot}
                onLoadSnapshot={loadResearchSnapshot}
                onRefreshDataCache={refreshDataCacheRows}
                onRefreshTasks={refreshTasks}
                onStartTask={(type, params) => startBackgroundTask(type, params)}
                onCancelTask={cancelBackgroundTask}
                onClearTasks={clearBackgroundTasks}
              />
            ) : null}
            {activeView === "实盘" ? (
              <LiveView
                executionPlan={executionPlan}
                executionConfig={executionConfig}
                executionEnvironment={executionEnvironment}
                executionOrders={executionOrders}
                ai4tradeStatus={ai4tradeStatus}
                automationStatus={automationStatus}
                readinessSnapshots={readinessSnapshots}
                okxAccount={okxAccount}
                okxDiagnostics={okxDiagnostics}
                okxPositions={okxPositions}
                preflightSteps={preflightSteps}
                executionLoading={loading.execution}
                executionConfigLoading={loading.executionConfig}
                executionEnvironmentLoading={loading.executionEnvironment}
                executionOrdersLoading={loading.executionOrders}
                ai4tradeLoading={loading.ai4trade}
                okxLoading={loading.okx}
                okxDiagnosticsLoading={loading.okxDiagnostics}
                okxCredentialsLoading={loading.okxCredentials}
                preflightLoading={loading.preflight}
                liveSubmitResult={liveSubmitResult}
                liveSubmitLoading={loading.liveSubmit}
                liveRiskConfig={{
                  min_live_equity_usd: strategyConfig.min_live_equity_usd,
                  live_margin_buffer_mult: strategyConfig.live_margin_buffer_mult,
                  max_live_order_notional_usd: strategyConfig.max_live_order_notional_usd,
                  canary_order_notional_usd: strategyConfig.canary_order_notional_usd,
                }}
                paperState={paperState}
                paperAudit={paperAudit}
                onLiveRiskConfigChange={(patch) => updateStrategyConfig((current) => ({ ...current, ...patch }))}
                onRunExecutionPlan={runExecutionPlan}
                onRefreshExecutionConfig={refreshExecutionConfig}
                onRefreshExecutionEnvironment={refreshExecutionEnvironment}
                onRefreshExecutionOrders={refreshExecutionOrders}
                onRefreshAi4TradeStatus={refreshAi4TradeStatus}
                onRefreshOkxReadonly={refreshOkxReadonly}
                onRunOkxDiagnostics={runOkxDiagnostics}
                onSaveOkxSessionCredentials={saveOkxSessionCredentials}
                onRunLivePreflight={runLivePreflight}
                onRunLiveSubmitLockTest={runLiveSubmitLockTest}
                onRecordExecutionAction={recordExecutionAction}
              />
            ) : null}
            {activeView === "设置" ? (
              <SettingsView
                theme={theme}
                sidebarCollapsed={sidebarCollapsed}
                liveRiskConfig={{
                  min_live_equity_usd: strategyConfig.min_live_equity_usd,
                  live_margin_buffer_mult: strategyConfig.live_margin_buffer_mult,
                  max_live_order_notional_usd: strategyConfig.max_live_order_notional_usd,
                  canary_order_notional_usd: strategyConfig.canary_order_notional_usd,
                }}
                executionConfig={executionConfig}
                executionEnvironment={executionEnvironment}
                dataRefreshBatchSize={dataRefreshBatchSize}
                paperState={paperState}
                portfolio={portfolio}
                dataStatus={dataStatus}
                systemStatus={systemStatus}
                systemStatusLoading={loading.systemStatus}
                refreshAllLoading={loading.action}
                onThemeChange={setTheme}
                onSidebarCollapsedChange={setSidebarCollapsed}
                onLiveRiskConfigChange={(patch) => updateStrategyConfig((current) => ({ ...current, ...patch }))}
                onDataRefreshBatchSizeChange={setDataRefreshBatchSize}
                onRefreshSystemStatus={refreshSystemStatus}
                onStartTask={async (type, params) => {
                  await startBackgroundTask(type, params);
                  await refreshSystemStatus();
                }}
                taskLoading={loading.tasks}
                onOpenView={setActiveView}
                onRefreshAll={refreshWorkspaceStatus}
              />
            ) : null}
          </section>
        )}
      </main>
    </div>
  );
}
