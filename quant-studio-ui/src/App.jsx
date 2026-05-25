import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { compactDataCache, defaultStrategyParams, getCandles, getDataRefreshProgress, getDataStatus, getLatestResearchSnapshot, getPaperStatus, getResearchSnapshot, getResearchSnapshots, refreshDataCache, refreshStaleDataCache, runJointOptimize, runPortfolioBacktest, saveResearchSnapshot, startPaper, stopPaper } from "./api";
import ChartPanel from "./components/ChartPanel";
import Sidebar from "./components/Sidebar";
import StrategyControlPanel from "./components/StrategyControlPanel";
import TopBar from "./components/TopBar";
import { DataView, MarketView, PlaceholderView, RiskView } from "./components/WorkspaceViews";

const BacktestPanel = lazy(() => import("./components/BacktestPanel"));

export default function App() {
  const [running, setRunning] = useState(true);
  const [paperState, setPaperState] = useState(null);
  const [portfolio, setPortfolio] = useState(null);
  const [optimization, setOptimization] = useState(null);
  const [experimentCandidate, setExperimentCandidate] = useState(null);
  const [snapshot, setSnapshot] = useState(null);
  const [baselineSnapshot, setBaselineSnapshot] = useState(null);
  const [snapshotSaveResult, setSnapshotSaveResult] = useState(null);
  const [dataRefreshResult, setDataRefreshResult] = useState(null);
  const [dataRefreshProgress, setDataRefreshProgress] = useState(null);
  const [dataCompactResult, setDataCompactResult] = useState(null);
  const [dataRefreshBatchSize, setDataRefreshBatchSize] = useState(4);
  const [portfolioMode, setPortfolioMode] = useState("snapshot");
  const [candles, setCandles] = useState([]);
  const [dataStatus, setDataStatus] = useState(null);
  const [researchSnapshots, setResearchSnapshots] = useState(null);
  const [selectedResearchSnapshot, setSelectedResearchSnapshot] = useState(null);
  const [activeView, setActiveView] = useState("策略");
  const [market, setMarket] = useState({ instId: defaultStrategyParams.instId, bar: defaultStrategyParams.bar });
  const [strategyConfig, setStrategyConfig] = useState(defaultStrategyParams);
  const [loading, setLoading] = useState({ paper: true, portfolio: true, candles: true, optimize: false, action: false, snapshot: false, snapshotInspect: false, dataRefresh: false, dataCompact: false });
  const [error, setError] = useState("");

  const runParams = useCallback(
    () => ({ ...strategyConfig, instId: market.instId, bar: market.bar }),
    [market.bar, market.instId, strategyConfig],
  );

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

  const runOptimization = useCallback(async () => {
    setLoading((state) => ({ ...state, optimize: true }));
    try {
      const result = await runJointOptimize({ ...runParams(), history_hours: 168, windows: [168] });
      setOptimization(result);
      setError("");
    } catch (err) {
      setError(`优化扫描失败：${err.message}`);
    } finally {
      setLoading((state) => ({ ...state, optimize: false }));
    }
  }, [runParams]);

  const applyCandidate = useCallback(async (candidate) => {
    const nextConfig = { ...strategyConfig, ...(candidate?.params || {}) };
    setStrategyConfig(nextConfig);
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
    refreshDataStatus();
  }, [refreshDataStatus, refreshPaper]);

  useEffect(() => {
    if (activeView === "数据") refreshDataStatus();
  }, [activeView, refreshDataStatus]);

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

  const refreshDataCacheRows = useCallback(async (row = null, recommendedOnly = false) => {
    setLoading((state) => ({ ...state, dataRefresh: true }));
    setDataRefreshProgress(null);
    try {
      if (row) {
        const result = await refreshDataCache(row, 1);
        setDataRefreshResult(result);
        setDataRefreshProgress(result.progress || null);
      } else {
        const result = await refreshStaleDataCache(dataRefreshBatchSize, recommendedOnly);
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
    setLoading((state) => ({ ...state, action: true }));
    try {
      if (running) {
        await stopPaper();
      } else {
        await startPaper(runParams());
      }
      await refreshPaper();
    } catch (err) {
      setError(`模拟盘切换失败：${err.message}`);
    } finally {
      setLoading((state) => ({ ...state, action: false }));
    }
  }

  return (
    <div className="app-shell">
      <div className="bg-orb bg-orb-a" />
      <div className="bg-orb bg-orb-b" />
      <div className="bg-grid" />

      <Sidebar activeLabel={activeView} onSelect={setActiveView} />

      <main className="main-stage">
        <TopBar
          running={running}
          apiError={error}
          loading={loading.paper || loading.portfolio || loading.candles}
          market={market}
          onMarketChange={setMarket}
          onRefresh={() => {
            refreshPortfolio();
            refreshCandles();
            refreshDataStatus();
          }}
        />

        {activeView === "策略" || activeView === "仪表盘" || activeView === "回测" ? (
          <>
            <section className="mt-5 grid gap-5 2xl:grid-cols-[minmax(0,1fr)_334px]">
              <ChartPanel candles={candles} market={market} loading={loading.candles} />
              <StrategyControlPanel
                running={running}
                paperState={paperState}
                loading={loading.action || loading.paper || loading.portfolio}
                config={strategyConfig}
                onConfigChange={setStrategyConfig}
                onApply={refreshPortfolio}
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
                  experimentCandidate={experimentCandidate}
                  snapshot={snapshot}
                  baselinePortfolio={baselineSnapshot?.portfolio}
                  mode={portfolioMode}
                  hasBaselineSnapshot={Boolean(baselineSnapshot?.portfolio)}
                  optimizeLoading={loading.optimize}
                  snapshotSaveLoading={loading.snapshot}
                  snapshotSaveResult={snapshotSaveResult}
                  onRefresh={refreshPortfolio}
                  onOptimize={runOptimization}
                  onApplyCandidate={applyCandidate}
                  onSaveSnapshot={saveCurrentSnapshot}
                  onRestoreSnapshot={restoreBaselineSnapshot}
                />
              </Suspense>
            </section>
          </>
        ) : (
          <section className="mt-5">
            {activeView === "市场" ? <MarketView candles={candles} market={market} portfolio={portfolio} /> : null}
            {activeView === "风控" ? <RiskView paperState={paperState} portfolio={portfolio} /> : null}
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
                onDataRefreshBatchSizeChange={setDataRefreshBatchSize}
                onCompactDataCache={compactDataCacheRows}
                onInspectSnapshot={inspectResearchSnapshot}
                onLoadSnapshot={loadResearchSnapshot}
                onRefreshDataCache={refreshDataCacheRows}
              />
            ) : null}
            {["实盘", "设置"].includes(activeView) ? <PlaceholderView title={activeView} /> : null}
          </section>
        )}
      </main>
    </div>
  );
}
