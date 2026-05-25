from __future__ import annotations

import json
import http.client
import math
import random
import re
import socket
import threading
import time
import urllib.request
import urllib.error
from dataclasses import dataclass, field
from datetime import datetime, timezone
from html.parser import HTMLParser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

from core.indicators import (
    build_trend_context,
    candle_body_ratio,
    close_location,
    enrich_candles,
    highest,
    lowest,
    market_regime,
    trend_for_ts,
)
from core.market_data import DIRECT_OPENER, PROXY_OPENER, MarketDataStore, bar_to_ms, needed_candle_count
from core.result_cache import ResultCache
from core.signals import (
    adapt_signal_to_market,
    apply_breakout_guard,
    candle_signal,
    confirm_signal,
    estimated_liquidation_price,
    signal_filter_reason,
    signal_score,
    uses_trend_context,
)


ROOT = Path(__file__).resolve().parent
PUBLIC = ROOT / "public"
CACHE_DIR = ROOT / ".cache"
SNAPSHOT_DIR = CACHE_DIR / "research-snapshots"
SIGNAL_LOG_FILE = CACHE_DIR / "signal-scans.jsonl"
PAPER_STATE_FILE = CACHE_DIR / "paper-state.json"
PAPER_EVENT_FILE = CACHE_DIR / "paper-events.jsonl"
PAPER_AUDIT_FILE = CACHE_DIR / "paper-audit.jsonl"
MARKET_DATA = MarketDataStore(CACHE_DIR)
PORTFOLIO_RESULT_CACHE = ResultCache(ttl_seconds=60, max_items=64)
SIGNAL_LOG_LOCK = threading.Lock()
PAPER_EVENT_LOCK = threading.Lock()
PAPER_AUDIT_LOCK = threading.Lock()
DATA_REFRESH_LOCK = threading.Lock()
DATA_REFRESH_PROGRESS: dict[str, Any] = {
    "active": False,
    "batch_id": None,
    "mode": None,
    "total": 0,
    "completed": 0,
    "ok": 0,
    "failed": 0,
    "current": None,
    "started_at": None,
    "updated_at": None,
}
TASK_LOCK = threading.Lock()
TASK_CONDITION = threading.Condition(TASK_LOCK)
TASKS: dict[str, dict[str, Any]] = {}
TASK_QUEUE: list[str] = []
TASK_WORKER_STARTED = False

CACHE_DIR.mkdir(exist_ok=True)
SNAPSHOT_DIR.mkdir(exist_ok=True)


def set_data_refresh_progress(**updates: Any) -> dict[str, Any]:
    with DATA_REFRESH_LOCK:
        DATA_REFRESH_PROGRESS.update(updates)
        DATA_REFRESH_PROGRESS["updated_at"] = datetime.now(timezone.utc).isoformat()
        return dict(DATA_REFRESH_PROGRESS)


def data_refresh_progress() -> dict[str, Any]:
    with DATA_REFRESH_LOCK:
        return dict(DATA_REFRESH_PROGRESS)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def start_task_worker() -> None:
    global TASK_WORKER_STARTED
    if TASK_WORKER_STARTED:
        return
    threading.Thread(target=task_worker_loop, daemon=True).start()
    TASK_WORKER_STARTED = True


def task_snapshot(task: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in task.items() if key not in {"result"} or value is not None}


def enqueue_task(task_type: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
    start_task_worker()
    task_id = f"task-{int(time.time() * 1000)}-{random.randint(1000, 9999)}"
    task = {
        "id": task_id,
        "type": task_type,
        "params": params or {},
        "status": "queued",
        "progress": {"completed": 0, "total": 0},
        "result": None,
        "error": None,
        "cancel_requested": False,
        "created_at": now_iso(),
        "started_at": None,
        "finished_at": None,
        "updated_at": now_iso(),
    }
    with TASK_CONDITION:
        TASKS[task_id] = task
        TASK_QUEUE.append(task_id)
        TASK_CONDITION.notify()
    return task_snapshot(task)


def get_task(task_id: str) -> dict[str, Any] | None:
    with TASK_LOCK:
        task = TASKS.get(task_id)
        return task_snapshot(task) if task else None


def list_tasks(limit: int = 20) -> dict[str, Any]:
    with TASK_LOCK:
        rows = sorted(TASKS.values(), key=lambda item: str(item.get("created_at") or ""), reverse=True)[:limit]
        return {"tasks": [task_snapshot(row) for row in rows]}


def update_task(task_id: str, **updates: Any) -> dict[str, Any] | None:
    with TASK_LOCK:
        task = TASKS.get(task_id)
        if not task:
            return None
        task.update(updates)
        task["updated_at"] = now_iso()
        return task_snapshot(task)


def task_cancel_requested(task_id: str | None) -> bool:
    if not task_id:
        return False
    with TASK_LOCK:
        task = TASKS.get(task_id)
        return bool(task and task.get("cancel_requested"))


def cancel_task(task_id: str) -> dict[str, Any]:
    with TASK_CONDITION:
        task = TASKS.get(task_id)
        if not task:
            raise ValueError("task not found")
        task["cancel_requested"] = True
        if task.get("status") == "queued":
            task["status"] = "cancelled"
            task["finished_at"] = now_iso()
            if task_id in TASK_QUEUE:
                TASK_QUEUE.remove(task_id)
        task["updated_at"] = now_iso()
        TASK_CONDITION.notify()
        return task_snapshot(task)


def task_worker_loop() -> None:
    while True:
        with TASK_CONDITION:
            while not TASK_QUEUE:
                TASK_CONDITION.wait()
            task_id = TASK_QUEUE.pop(0)
            task = TASKS.get(task_id)
            if not task or task.get("status") == "cancelled":
                continue
            task["status"] = "running"
            task["started_at"] = now_iso()
            task["updated_at"] = now_iso()
            task_type = str(task.get("type"))
            params = dict(task.get("params") or {})
        try:
            result = run_task_payload(task_id, task_type, params)
            final_status = "cancelled" if task_cancel_requested(task_id) else "completed"
            update_task(task_id, status=final_status, result=result, finished_at=now_iso())
        except Exception as exc:
            update_task(task_id, status="failed", error=str(exc), finished_at=now_iso())


def run_task_payload(task_id: str, task_type: str, params: dict[str, Any]) -> dict[str, Any]:
    if task_type == "data_refresh":
        payload = {**params, "task_id": task_id}
        if params.get("stale"):
            return refresh_stale_candle_cache(payload)
        return refresh_candle_cache(payload)
    if task_type == "compact_cache":
        return compact_covered_candle_cache({**params, "task_id": task_id})
    if task_type == "joint_optimize":
        return joint_optimize_params(params)
    if task_type == "readiness":
        return readiness_gate(params)
    raise ValueError(f"unsupported task type: {task_type}")


def utc_ms_to_iso(ts_ms: int) -> str:
    return datetime.fromtimestamp(ts_ms / 1000, tz=timezone.utc).isoformat()


def fetch_candles(inst_id: str, bar: str, limit: int = 300) -> list[dict[str, Any]]:
    return MARKET_DATA.fetch_candles(inst_id, bar, limit)


def last_candle_fetch(inst_id: str, bar: str, count: int) -> dict[str, Any] | None:
    return MARKET_DATA.last_candle_fetch(inst_id, bar, count)


def fetch_historical_candles(
    inst_id: str,
    bar: str,
    count: int,
    *,
    prefer_cache: bool = False,
    offline_mode: bool = False,
) -> list[dict[str, Any]]:
    return MARKET_DATA.fetch_historical_candles(
        inst_id,
        bar,
        count,
        prefer_cache=prefer_cache,
        offline_mode=offline_mode,
    )


def strategy_warmup_candles(params: dict[str, Any]) -> int:
    lookback = int(params.get("lookback", 24))
    atr_period = int(params.get("atr_period", 14))
    adx_period = int(params.get("adx_period", 14))
    volume_period = int(params.get("volume_period", 20))
    return max(lookback + 5, atr_period * 3, adx_period * 3, volume_period + 5, 80)


def backtest_candle_count(bar: str, params: dict[str, Any]) -> int:
    history_hours = float(params.get("history_hours", 24))
    return needed_candle_count(bar, history_hours, strategy_warmup_candles(params))


def trend_candle_count(trend_bar: str, params: dict[str, Any]) -> int:
    history_hours = float(params.get("history_hours", 24))
    warmup = int(params.get("trend_slow", 120)) + 20
    return needed_candle_count(trend_bar, history_hours, warmup)


def fetch_backtest_candles(inst_id: str, bar: str, params: dict[str, Any]) -> list[dict[str, Any]]:
    count = backtest_candle_count(bar, params)
    return fetch_historical_candles(
        inst_id,
        bar,
        count,
        prefer_cache=bool(params.get("prefer_cache", False)),
        offline_mode=bool(params.get("offline_mode", False)),
    )


def fetch_trend_candles(inst_id: str, trend_bar: str, params: dict[str, Any]) -> list[dict[str, Any]]:
    count = trend_candle_count(trend_bar, params)
    return fetch_historical_candles(
        inst_id,
        trend_bar,
        count,
        prefer_cache=bool(params.get("prefer_cache", False)),
        offline_mode=bool(params.get("offline_mode", False)),
    )


def symbol_slippage_multiplier(inst_id: str | None) -> float:
    if inst_id == "BTC-USDT-SWAP":
        return 1.0
    if inst_id == "ETH-USDT-SWAP":
        return 1.2
    if inst_id == "SOL-USDT-SWAP":
        return 1.8
    return 1.4


def order_type_fee(params: dict[str, Any], order_type: str) -> float:
    if order_type == "maker":
        return float(params.get("maker_fee_rate", params.get("fee_rate", 0.0005)))
    return float(params.get("taker_fee_rate", params.get("fee_rate", 0.0005)))


def trade_cost_rates(params: dict[str, Any], inst_id: str | None, exit_reason: str) -> dict[str, float]:
    model = params.get("cost_model", "simple")
    if model == "simple":
        fee = float(params.get("fee_rate", 0.0005))
        slip = float(params.get("slippage_pct", 0.0002))
        return {"entry_fee": fee, "exit_fee": fee, "entry_slippage": slip, "exit_slippage": slip}

    entry_order_type = params.get("entry_order_type", "taker")
    if exit_reason in {"take_profit", "take_profit_all"}:
        exit_order_type = params.get("take_profit_order_type", "maker")
    else:
        exit_order_type = params.get("stop_order_type", "taker")

    base_slippage = float(params.get("slippage_pct", 0.0002))
    multiplier = symbol_slippage_multiplier(inst_id)
    if model == "okx_conservative":
        multiplier *= 1.8
        entry_order_type = "taker"
        exit_order_type = "taker"
    elif model == "okx_limit":
        entry_order_type = "maker"

    entry_slippage = 0.0 if entry_order_type == "maker" else base_slippage * multiplier
    exit_slippage = 0.0 if exit_order_type == "maker" else base_slippage * multiplier
    return {
        "entry_fee": order_type_fee(params, entry_order_type),
        "exit_fee": order_type_fee(params, exit_order_type),
        "entry_slippage": entry_slippage,
        "exit_slippage": exit_slippage,
    }


def estimated_roundtrip_cost_per_qty(signal: dict[str, Any], params: dict[str, Any], exit_reason: str, exit_price: float) -> float:
    rates = trade_cost_rates(params, signal.get("inst_id"), exit_reason)
    entry = float(signal["entry"])
    return (
        entry * (rates["entry_fee"] + rates["entry_slippage"])
        + exit_price * (rates["exit_fee"] + rates["exit_slippage"])
    )


def leverage_position(signal: dict[str, Any], equity: float, params: dict[str, Any]) -> dict[str, Any] | None:
    if equity <= 0:
        return None

    risk_per_contract = abs(signal["entry"] - signal["stop"])
    if risk_per_contract <= 0:
        return None

    configured_leverage = float(params.get("leverage", 1))
    max_leverage = float(params.get("max_leverage", configured_leverage))
    min_leverage = float(params.get("min_leverage", 1))
    adaptive_leverage = bool(params.get("adaptive_leverage", False))
    margin_pct = float(params.get("margin_pct_per_trade", 1.0))
    max_loss_pct = float(params.get("max_loss_pct_per_trade", params.get("risk_pct", 0.01)))
    maintenance_margin_rate = float(params.get("maintenance_margin_rate", 0.005))
    min_liq_buffer_pct = float(params.get("min_liq_buffer_pct", 0.003))

    loss_streak = int(params.get("loss_streak", 0))
    account_peak = float(params.get("account_peak", equity))
    account_drawdown = max(0.0, (account_peak - equity) / account_peak) if account_peak else 0.0
    adaptive_risk = bool(params.get("adaptive_risk", False))
    risk_factor = float(signal.get("risk_factor", 1.0))
    if adaptive_risk:
        loss_decay = float(params.get("loss_streak_risk_decay", 0.25))
        drawdown_sensitivity = float(params.get("drawdown_risk_sensitivity", 1.8))
        min_factor = float(params.get("min_adaptive_risk_factor", 0.35))
        risk_factor *= max(min_factor, 1 - loss_streak * loss_decay)
        risk_factor *= max(min_factor, 1 - account_drawdown * drawdown_sensitivity)
    risk_amount = equity * max_loss_pct * max(float(params.get("absolute_min_risk_factor", 0.1)), min(risk_factor, 1.0))
    estimated_stop_cost = risk_per_contract + estimated_roundtrip_cost_per_qty(signal, params, "stop", float(signal["stop"]))
    risk_qty = risk_amount / max(estimated_stop_cost, 1e-9)
    margin_budget = equity * margin_pct
    target_notional = risk_qty * signal["entry"]
    stop_pct = risk_per_contract / max(signal["entry"], 1e-9)
    safe_leverage_cap = 1 / max(stop_pct + min_liq_buffer_pct + maintenance_margin_rate, 1e-9)
    if adaptive_leverage:
        required_leverage = target_notional / max(margin_budget, 1e-9)
        leverage = max(min_leverage, min(max_leverage, safe_leverage_cap, required_leverage))
    else:
        leverage = min(configured_leverage, safe_leverage_cap)
    if leverage < 1:
        return None

    notional_cap = margin_budget * leverage
    margin_qty = notional_cap / max(signal["entry"], 1e-9)
    qty = min(risk_qty, margin_qty)
    if qty <= 0:
        return None

    notional = qty * signal["entry"]
    margin_used = notional / max(leverage, 1)
    liquidation_price = estimated_liquidation_price(signal["entry"], signal["side"], leverage, maintenance_margin_rate)
    if liquidation_price is not None:
        liq_distance = abs(signal["entry"] - liquidation_price)
        stop_distance = abs(signal["entry"] - signal["stop"])
        min_buffer = signal["entry"] * min_liq_buffer_pct
        if liq_distance <= stop_distance + min_buffer:
            return None

    return {
        **signal,
        "qty": qty,
        "notional": notional,
        "margin_used": margin_used,
        "leverage": leverage,
        "liquidation_price": liquidation_price,
        "planned_risk": risk_amount,
        "planned_stop_cost": estimated_stop_cost * qty,
        "target_notional": target_notional,
        "safe_leverage_cap": safe_leverage_cap,
        "risk_factor": risk_factor,
    }


def last_closed_candle_index(candles: list[dict[str, Any]]) -> int:
    if not candles:
        return -1
    for i in range(len(candles) - 1, -1, -1):
        if candles[i].get("confirm", True):
            return i
    return len(candles) - 1


def compact_signal(signal: dict[str, Any] | None) -> dict[str, Any] | None:
    if not signal:
        return None
    keys = [
        "side",
        "kind",
        "entry",
        "stop",
        "take_profit",
        "level",
        "trend",
        "regime",
        "atr",
        "adx",
        "adaptive_rr",
        "risk_factor",
        "score",
        "leverage",
        "notional",
        "margin_used",
        "liquidation_price",
        "planned_risk",
        "safe_leverage_cap",
    ]
    return {key: signal.get(key) for key in keys if key in signal}


def signal_context(candles: list[dict[str, Any]], index: int, params: dict[str, Any], trend: str) -> dict[str, Any]:
    candle = candles[index]
    lookback = int(params.get("lookback", 24))
    context: dict[str, Any] = {
        "time": candle["time"],
        "ts": candle["ts"],
        "close": candle["close"],
        "trend": trend,
        "regime": market_regime(candle, params),
        "adx": candle.get("adx"),
        "atr": candle.get("atr"),
        "body_ratio": candle_body_ratio(candle),
        "close_location": close_location(candle),
        "confirmed": candle.get("confirm", True),
    }
    if candle.get("atr") and candle["close"]:
        context["atr_pct"] = candle["atr"] / candle["close"]
    if index >= lookback + 2:
        prior_high = highest(candles, index - lookback - 1, index - 1)
        prior_low = lowest(candles, index - lookback - 1, index - 1)
        context.update(
            {
                "prior_high": prior_high,
                "prior_low": prior_low,
                "distance_to_high_atr": (prior_high - candle["close"]) / candle["atr"] if candle.get("atr") else None,
                "distance_to_low_atr": (candle["close"] - prior_low) / candle["atr"] if candle.get("atr") else None,
            }
        )
    return context


def risk_circuit_state(params: dict[str, Any], equity: float, context: dict[str, Any] | None = None) -> dict[str, Any]:
    enabled = bool(params.get("enable_risk_circuit_breaker", True))
    peak = float(params.get("account_peak", equity) or equity)
    day_start = float(params.get("day_start_equity", equity) or equity)
    loss_streak = int(params.get("loss_streak", 0) or 0)
    max_daily_loss = float(params.get("max_daily_loss_pct", 0.06))
    max_drawdown = float(params.get("max_account_drawdown_pct", params.get("max_strategy_drawdown", 0.35)))
    max_loss_streak = int(params.get("max_loss_streak_stop", 3))
    max_atr_pct = float(params.get("max_atr_pct", 0.012))
    ctx = context or {}

    daily_loss = max(0.0, (day_start - equity) / day_start) if day_start else 0.0
    account_drawdown = max(0.0, (peak - equity) / peak) if peak else 0.0
    atr_pct = ctx.get("atr_pct")
    reasons: list[str] = []

    if enabled:
        if daily_loss >= max_daily_loss:
            reasons.append(f"当日亏损 {daily_loss * 100:.2f}% 达到阈值 {max_daily_loss * 100:.2f}%")
        if account_drawdown >= max_drawdown:
            reasons.append(f"账户回撤 {account_drawdown * 100:.2f}% 达到阈值 {max_drawdown * 100:.2f}%")
        if loss_streak >= max_loss_streak:
            reasons.append(f"连续亏损 {loss_streak} 笔达到阈值 {max_loss_streak} 笔")
        if atr_pct is not None and atr_pct >= max_atr_pct:
            reasons.append(f"ATR 波动 {atr_pct * 100:.2f}% 达到阈值 {max_atr_pct * 100:.2f}%")

    return {
        "enabled": enabled,
        "allow_trade": not reasons,
        "reasons": reasons,
        "daily_loss": daily_loss,
        "account_drawdown": account_drawdown,
        "loss_streak": loss_streak,
        "atr_pct": atr_pct,
        "thresholds": {
            "max_daily_loss_pct": max_daily_loss,
            "max_account_drawdown_pct": max_drawdown,
            "max_loss_streak_stop": max_loss_streak,
            "max_atr_pct": max_atr_pct,
        },
    }


def data_mode(params: dict[str, Any]) -> str:
    if bool(params.get("offline_mode", False)):
        return "offline"
    if bool(params.get("prefer_cache", False)):
        return "prefer-fresh-cache"
    return "realtime"


def summarize_data_sources(rows: list[dict[str, Any]]) -> dict[str, Any]:
    data_rows = [row.get("data", {}) for row in rows if row.get("data")]
    price_rows = [data.get("price", {}) for data in data_rows if data.get("price")]
    stale_rows = [row for row in price_rows if row.get("is_stale")]
    latest_closed = max((row.get("latest_closed") for row in price_rows if row.get("latest_closed")), default=None)
    sources = sorted({str(row.get("source")) for row in price_rows if row.get("source")})
    return {
        "mode": data_rows[0].get("mode") if data_rows else None,
        "sources": sources,
        "latest_closed": latest_closed,
        "stale_markets": len(stale_rows),
        "markets": len(price_rows),
        "all_fresh": bool(price_rows) and not stale_rows,
    }


def find_candle_index(
    candles: list[dict[str, Any]],
    target_ts: Any = None,
    target_time: str | None = None,
    latest_index: int | None = None,
) -> int:
    max_index = len(candles) - 1 if latest_index is None else min(latest_index, len(candles) - 1)
    if target_ts is not None:
        try:
            target_ts_int = int(target_ts)
            for index in range(max_index, -1, -1):
                if int(candles[index].get("ts", -1)) == target_ts_int:
                    return index
        except (TypeError, ValueError):
            pass
    if target_time:
        for index in range(max_index, -1, -1):
            if candles[index].get("time") == target_time:
                return index
    return -1


def diagnose_signal_for_market(inst_id: str, params: dict[str, Any], equity: float | None = None) -> dict[str, Any]:
    scan_hours = min(float(params.get("history_hours", 168)), float(params.get("scan_history_hours", 240)))
    scan_params = {**params, "history_hours": scan_hours}
    bar = scan_params.get("bar", "15m")
    candles = enrich_candles(fetch_backtest_candles(inst_id, bar, scan_params), scan_params)
    price_meta = last_candle_fetch(inst_id, bar, backtest_candle_count(bar, scan_params))
    if not candles:
        raise RuntimeError("No candles available")

    latest_index = last_closed_candle_index(candles)
    if latest_index < 0:
        raise RuntimeError("No closed candle available")

    replay_target_ts = scan_params.get("replay_context_ts")
    replay_target_time = scan_params.get("replay_context_time")
    index = latest_index
    replay_meta = None
    if replay_target_ts is not None or replay_target_time:
        index = find_candle_index(candles, replay_target_ts, replay_target_time, latest_index)
        if index < 0:
            requested = replay_target_time or replay_target_ts
            raise RuntimeError(f"Replay candle not found: {requested}")
        replay_meta = {
            "requested_time": replay_target_time,
            "requested_ts": replay_target_ts,
            "matched_time": candles[index].get("time"),
            "matched_ts": candles[index].get("ts"),
            "latest_closed_time": candles[latest_index].get("time"),
            "latest_closed_ts": candles[latest_index].get("ts"),
        }

    trend = "neutral"
    trend_meta = None
    if uses_trend_context(scan_params.get("strategy_mode", "louie_price_action")):
        trend_bar = scan_params.get("trend_bar", "1H")
        trend_candles = fetch_trend_candles(inst_id, trend_bar, scan_params)
        trend_meta = last_candle_fetch(inst_id, trend_bar, trend_candle_count(trend_bar, scan_params))
        trend_by_ts = build_trend_context(trend_candles, scan_params)
        trend = trend_for_ts(trend_by_ts, candles[index]["ts"])

    lookback = int(scan_params.get("lookback", 24))
    reasons: list[str] = []
    context = signal_context(candles, index, scan_params, trend)
    row: dict[str, Any] = {
        "inst_id": inst_id,
        "status": "blocked",
        "decision": "未交易",
        "reasons": reasons,
        "context": context,
        "signal": None,
        "position": None,
        "score": None,
        "risk": None,
        "data": {
            "mode": data_mode(scan_params),
            "price": price_meta,
            "trend": trend_meta,
            "replay": replay_meta,
        },
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }

    if price_meta and price_meta.get("is_stale") and not bool(scan_params.get("offline_mode", False)):
        reasons.append("行情数据陈旧，仅作观察")
        row["status"] = "blocked"
        row["decision"] = "数据陈旧"
        return row

    if index < lookback + 2:
        reasons.append("预热 K 线不足")
        return row

    candle = candles[index]
    if candle.get("atr") is None or candle.get("atr", 0) <= 0:
        reasons.append("ATR 尚未形成")
        return row

    account_equity = float(equity if equity is not None else scan_params.get("initial_equity", 10))
    risk_state = risk_circuit_state(scan_params, account_equity, context)
    row["risk"] = risk_state
    if not risk_state["allow_trade"]:
        row["status"] = "blocked"
        row["decision"] = "风控暂停"
        reasons.extend(risk_state["reasons"])
        return row

    strategy_mode = scan_params.get("strategy_mode", "louie_price_action")
    if strategy_mode == "trend_price_action":
        min_adx = float(scan_params.get("min_adx", 18))
        if trend == "neutral":
            reasons.append("趋势过滤为 neutral")
        if candle.get("adx") is None or candle["adx"] < min_adx:
            reasons.append(f"ADX 低于阈值 {min_adx:g}")
        if bool(scan_params.get("require_volume", False)) and candle.get("volume_ma") and candle["volume"] < candle["volume_ma"]:
            reasons.append("成交量低于均量")
        if reasons:
            return row

    raw_signal = candle_signal(candles, index, scan_params, trend)
    if not raw_signal:
        reasons.append("未触发价格行为形态")
        return row

    row["status"] = "watch" if bool(scan_params.get("require_next_confirmation", False)) else "candidate"
    row["decision"] = "等待次 K 确认" if row["status"] == "watch" else "发现候选信号"
    managed = adapt_signal_to_market(raw_signal, scan_params)
    leveraged = leverage_position(managed, account_equity, scan_params)
    if not leveraged:
        row["signal"] = compact_signal(managed)
        row["status"] = "blocked"
        row["decision"] = "风控拒绝"
        reasons.append("仓位、杠杆或爆仓缓冲不满足")
        return row

    score = signal_score(leveraged)
    leveraged = {**leveraged, "score": score}
    filter_reason = signal_filter_reason({**leveraged, "inst_id": inst_id}, scan_params)
    if filter_reason:
        row["score"] = score
        row["signal"] = compact_signal(leveraged)
        row["status"] = "blocked"
        row["decision"] = "信号过滤"
        reasons.append(filter_reason)
        return row
    managed_position = attach_trade_management(leveraged, scan_params)
    row["score"] = score
    row["signal"] = compact_signal(leveraged)
    row["position"] = {
        "side": managed_position["side"],
        "entry": managed_position["entry"],
        "stop": managed_position["stop"],
        "take_profit": managed_position["take_profit"],
        "leverage": managed_position["leverage"],
        "notional": managed_position["notional"],
        "margin_used": managed_position["margin_used"],
        "liquidation_price": managed_position["liquidation_price"],
        "planned_risk": managed_position["planned_risk"],
        "qty": managed_position["qty"],
        "original_qty": managed_position.get("original_qty"),
        "remaining_qty": managed_position.get("remaining_qty"),
        "tp_levels": managed_position.get("tp_levels", []),
        "stop_moved_to_breakeven": managed_position.get("stop_moved_to_breakeven", False),
    }

    min_score = float(scan_params.get("min_signal_score", -999))
    if score < min_score:
        row["status"] = "blocked"
        row["decision"] = "评分不足"
        reasons.append(f"评分 {score:.2f} 低于阈值 {min_score:.2f}")
        return row

    if bool(scan_params.get("require_next_confirmation", False)):
        reasons.append("需要下一根 K 线确认后才可入场")
        return row

    row["status"] = "ready"
    row["decision"] = "可交易"
    reasons.append("通过形态、评分和风控检查")
    return row


def signal_scan(params: dict[str, Any]) -> dict[str, Any]:
    symbols = params.get("symbols") or ["BTC-USDT-SWAP", "ETH-USDT-SWAP", "SOL-USDT-SWAP"]
    equity = float(params.get("initial_equity", 10))
    rows = []
    for inst_id in symbols:
        try:
            rows.append(diagnose_signal_for_market(inst_id, params, equity))
        except Exception as exc:
            rows.append(
                {
                    "inst_id": inst_id,
                    "status": "error",
                    "decision": "扫描失败",
                    "reasons": [str(exc)],
                    "context": {},
                    "signal": None,
                    "position": None,
                    "score": None,
                    "risk": None,
                    "data": {"mode": data_mode(params), "price": None, "trend": None},
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                }
            )
    ready = sum(1 for row in rows if row["status"] == "ready")
    watch = sum(1 for row in rows if row["status"] == "watch")
    blocked = sum(1 for row in rows if row["status"] == "blocked")
    result = {
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "summary": {
            "markets": len(rows),
            "ready": ready,
            "watch": watch,
            "blocked": blocked,
            "errors": sum(1 for row in rows if row["status"] == "error"),
        },
        "data": summarize_data_sources(rows),
        "rows": rows,
    }
    if bool(params.get("record_scan", True)):
        append_signal_log("manual", result)
    return result


def append_signal_log(source: str, result: dict[str, Any]) -> None:
    entry = {
        "source": source,
        "updated_at": result.get("updated_at") or datetime.now(timezone.utc).isoformat(),
        "summary": result.get("summary", {}),
        "rows": result.get("rows", []),
    }
    line = json.dumps(entry, ensure_ascii=False)
    with SIGNAL_LOG_LOCK:
        with SIGNAL_LOG_FILE.open("a", encoding="utf-8") as handle:
            handle.write(line + "\n")


def read_signal_logs(limit: int = 100) -> list[dict[str, Any]]:
    if not SIGNAL_LOG_FILE.exists():
        return []
    with SIGNAL_LOG_LOCK:
        lines = SIGNAL_LOG_FILE.read_text(encoding="utf-8").splitlines()
    entries = []
    for line in lines[-max(1, min(limit, 1000)) :]:
        try:
            entries.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return entries


def signal_log_report(limit: int = 100) -> dict[str, Any]:
    entries = read_signal_logs(limit)
    by_day: dict[str, dict[str, Any]] = {}
    latest_ready: list[dict[str, Any]] = []
    for entry in entries:
        day = str(entry.get("updated_at", ""))[:10] or "unknown"
        day_row = by_day.setdefault(
            day,
            {
                "day": day,
                "scans": 0,
                "markets": 0,
                "ready": 0,
                "watch": 0,
                "blocked": 0,
                "errors": 0,
                "ready_markets": set(),
            },
        )
        summary = entry.get("summary", {})
        day_row["scans"] += 1
        day_row["markets"] += int(summary.get("markets", 0) or 0)
        day_row["ready"] += int(summary.get("ready", 0) or 0)
        day_row["watch"] += int(summary.get("watch", 0) or 0)
        day_row["blocked"] += int(summary.get("blocked", 0) or 0)
        day_row["errors"] += int(summary.get("errors", 0) or 0)
        for row in entry.get("rows", []):
            if row.get("status") == "ready":
                day_row["ready_markets"].add(row.get("inst_id", "-"))
                latest_ready.append(
                    {
                        "updated_at": entry.get("updated_at"),
                        "source": entry.get("source"),
                        "inst_id": row.get("inst_id"),
                        "decision": row.get("decision"),
                        "score": row.get("score"),
                        "signal": row.get("signal"),
                    }
                )

    days = []
    for row in sorted(by_day.values(), key=lambda item: item["day"], reverse=True):
        days.append({**row, "ready_markets": sorted(row["ready_markets"])})
    return {
        "entries": list(reversed(entries[-limit:])),
        "days": days,
        "latest_ready": list(reversed(latest_ready[-20:])),
        "summary": {
            "entries": len(entries),
            "days": len(days),
            "ready": sum(day["ready"] for day in days),
            "watch": sum(day["watch"] for day in days),
            "blocked": sum(day["blocked"] for day in days),
            "errors": sum(day["errors"] for day in days),
        },
    }


def strategy_health(summary: dict[str, Any], trades: list[dict[str, Any]], by_symbol: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    return_pct = float(summary.get("return_pct") or 0.0)
    max_drawdown = float(summary.get("max_drawdown") or 0.0)
    trade_count = int(summary.get("trades") or len(trades) or 0)
    max_loss_streak = int(summary.get("max_consecutive_losses") or 0)
    win_rate = float(summary.get("win_rate") or 0.0)
    profit_factor = summary.get("profit_factor")
    expectancy = float(summary.get("expectancy") or 0.0)
    initial_equity = max(float(summary.get("initial_equity") or 1.0), 1e-9)
    avg_win = float(summary.get("avg_win") or 0.0)
    avg_loss = float(summary.get("avg_loss") or 0.0)
    payoff_ratio = avg_win / avg_loss if avg_loss > 0 else None
    pnl_values = [float(trade.get("pnl") or 0.0) for trade in trades]
    losses = sorted([abs(value) for value in pnl_values if value < 0], reverse=True)
    worst_loss_pct = (losses[0] / initial_equity) if losses else 0.0
    tail_loss_pct = (sum(losses[:3]) / initial_equity) if losses else 0.0

    score = 50.0
    score += min(max(return_pct, -0.5), 1.5) * 24
    score -= min(max_drawdown, 0.6) * 70
    score += min(trade_count, 80) * 0.20
    score -= max(0, 10 - trade_count) * 2.2
    score += (win_rate - 0.45) * 18
    score += min(expectancy / initial_equity, 0.08) * 100
    score -= max_loss_streak * 1.3
    if payoff_ratio is not None:
        score += min(max(payoff_ratio - 1.0, -1.0), 2.0) * 2.5
    score -= min(worst_loss_pct, 0.08) * 80
    score -= min(tail_loss_pct, 0.18) * 35
    if profit_factor is None:
        score -= 3 if trade_count else 8
    else:
        score += min(float(profit_factor), 3.0) * 4 - 5

    notes: list[str] = []
    if trade_count < 20:
        notes.append(f"样本偏少：仅 {trade_count} 笔交易，优先扩大窗口或做滚动验证。")
    if max_drawdown >= 0.20:
        notes.append(f"回撤偏高：最大回撤 {max_drawdown * 100:.2f}%，需要降风险或收紧熔断。")
    elif max_drawdown >= 0.12:
        notes.append(f"回撤需要关注：最大回撤 {max_drawdown * 100:.2f}%。")
    if max_loss_streak >= 6:
        notes.append(f"连续亏损压力：最大连亏 {max_loss_streak} 笔，模拟盘应保留暂停机制。")
    if trade_count and win_rate < 0.38:
        notes.append(f"胜率偏低：{win_rate * 100:.2f}%，需要确认盈亏比能否覆盖成本。")
    if profit_factor is not None and float(profit_factor) < 1.15:
        notes.append(f"盈利因子不足：{float(profit_factor):.2f}，成本或滑点压力下容易失效。")
    if return_pct > 0 and expectancy <= 0:
        notes.append("总收益为正但单笔期望不稳，可能依赖少数大单。")
    if payoff_ratio is not None and payoff_ratio < 0.85:
        notes.append(f"盈亏比偏弱：平均盈利/平均亏损 {payoff_ratio:.2f}。")
    if worst_loss_pct >= 0.04:
        notes.append(f"尾部亏损偏大：单笔最大亏损约占初始权益 {worst_loss_pct * 100:.2f}%。")

    concentration = None
    active_symbols = None
    if by_symbol:
        active_symbols = sum(1 for row in by_symbol if int(row.get("trades") or 0) > 0)
        if active_symbols <= 1 and trade_count >= 10:
            score -= 6
            notes.append("品种覆盖不足：有效交易集中在单一市场。")
        positive_pnl = sum(max(0.0, float(row.get("pnl") or 0.0)) for row in by_symbol)
        if positive_pnl > 0:
            leader = max(by_symbol, key=lambda row: max(0.0, float(row.get("pnl") or 0.0)))
            concentration = max(0.0, float(leader.get("pnl") or 0.0)) / positive_pnl
            if concentration >= 0.70:
                score -= 10
                notes.append(f"收益集中：{leader.get('inst_id', '-')} 贡献 {concentration * 100:.1f}% 正收益。")
            elif concentration >= 0.55:
                score -= 5

    score = max(0.0, min(100.0, score))
    if score >= 78:
        grade = "A"
        verdict = "可继续观察"
    elif score >= 62:
        grade = "B"
        verdict = "需要验证"
    elif score >= 45:
        grade = "C"
        verdict = "高风险观察"
    else:
        grade = "D"
        verdict = "暂不建议扩大"

    if not notes:
        notes.append("未发现明显单项风险，但仍需滚动窗口、压力成本和模拟盘验证。")

    return {
        "score": score,
        "grade": grade,
        "verdict": verdict,
        "notes": notes[:5],
        "metrics": {
            "return_pct": return_pct,
            "max_drawdown": max_drawdown,
            "trades": trade_count,
            "win_rate": win_rate,
            "profit_factor": profit_factor,
            "expectancy": expectancy,
            "max_consecutive_losses": max_loss_streak,
            "symbol_concentration": concentration,
            "active_symbols": active_symbols,
            "payoff_ratio": payoff_ratio,
            "worst_loss_pct": worst_loss_pct,
            "tail_loss_pct": tail_loss_pct,
        },
    }


def run_backtest(candles: list[dict[str, Any]], params: dict[str, Any], trend_by_ts: dict[int, str] | None = None) -> dict[str, Any]:
    initial_equity = float(params.get("initial_equity", 10000))
    risk_pct = float(params.get("risk_pct", 0.01))
    fee_rate = float(params.get("fee_rate", 0.0005))
    slippage_pct = float(params.get("slippage_pct", 0.0002))
    max_trades = int(params.get("max_trades", 9999))
    cooldown_bars = int(params.get("cooldown_bars", 4))
    loss_streak_pause_bars = int(params.get("loss_streak_pause_bars", 0))
    max_strategy_drawdown = float(params.get("max_strategy_drawdown", 0.35))
    max_daily_trades = int(params.get("max_daily_trades", 9999))
    min_signal_score = float(params.get("min_signal_score", -999))
    enable_risk_circuit = bool(params.get("enable_risk_circuit_breaker", True))
    max_daily_loss_pct = float(params.get("max_daily_loss_pct", 1.0))
    max_loss_streak_stop = int(params.get("max_loss_streak_stop", 9999))
    candles = enrich_candles(candles, params)
    history_hours = float(params.get("history_hours", 24))
    latest_ts = int(params.get("window_end_ts") or (candles[-1]["ts"] if candles else 0))
    window_start_ts = latest_ts - int(history_hours * 60 * 60 * 1000)

    equity = initial_equity
    peak = initial_equity
    max_drawdown = 0.0
    position: dict[str, Any] | None = None
    trades: list[dict[str, Any]] = []
    equity_curve: list[dict[str, Any]] = []
    max_consecutive_losses = 0
    current_consecutive_losses = 0
    cooldown_until_index = -1
    pending_signal: dict[str, Any] | None = None
    trend_points = sorted((trend_by_ts or {}).items())
    trend_cursor = 0
    current_trend = "neutral"
    day_start_equity = initial_equity
    current_day_key = ""
    trades_by_day: dict[str, int] = {}
    breakout_history: list[float] = []

    for i, candle in enumerate(candles):
        if latest_ts and candle["ts"] > latest_ts:
            break
        in_window = window_start_ts <= candle["ts"] <= latest_ts
        if trend_points:
            while trend_cursor < len(trend_points) and trend_points[trend_cursor][0] <= candle["ts"]:
                current_trend = trend_points[trend_cursor][1]
                trend_cursor += 1
        day_key = candle["time"][:10]
        if day_key != current_day_key:
            current_day_key = day_key
            day_start_equity = equity
        if position:
            position, trade, pnl_delta = process_position_on_candle(position, candle, params, equity, initial_equity)
            if pnl_delta:
                equity += pnl_delta
            if trade:
                trades.append(trade)
                if trade.get("kind") == "louie_breakout_test":
                    breakout_history.append(float(trade.get("pnl", 0.0)))
                if trade["pnl"] <= 0:
                    current_consecutive_losses += 1
                    max_consecutive_losses = max(max_consecutive_losses, current_consecutive_losses)
                    pause_bars = cooldown_bars
                    if enable_risk_circuit and loss_streak_pause_bars > 0 and current_consecutive_losses >= max_loss_streak_stop:
                        pause_bars = max(pause_bars, loss_streak_pause_bars)
                        current_consecutive_losses = 0
                    cooldown_until_index = i + pause_bars
                else:
                    current_consecutive_losses = 0

        day_trades = trades_by_day.get(day_key, 0)
        daily_loss = max(0.0, (day_start_equity - equity) / day_start_equity) if day_start_equity else 0.0
        daily_loss_blocked = enable_risk_circuit and daily_loss >= max_daily_loss_pct

        if (
            in_window
            and i >= cooldown_until_index
            and not position
            and len(trades) < max_trades
            and day_trades < max_daily_trades
            and not daily_loss_blocked
        ):
            if peak and (peak - equity) / peak >= max_strategy_drawdown:
                equity_curve.append({"time": candle["time"], "equity": equity})
                continue
            if pending_signal and pending_signal.get("entry_index", -1) == i - 1:
                signal = confirm_signal(pending_signal, candle, params)
                pending_signal = None
            elif pending_signal:
                pending_signal = None
                signal = None
            else:
                trend = current_trend if trend_points else "neutral"
                signal = candle_signal(candles, i, params, trend)
                if signal and bool(params.get("require_next_confirmation", False)):
                    pending_signal = {**signal, "entry_index": i, "candidate_time": candle["time"]}
                    signal = None
            if signal:
                managed_signal = adapt_signal_to_market({**signal, "inst_id": params.get("instId")}, params)
                managed_signal = apply_breakout_guard(managed_signal, params, breakout_history)
                leveraged = leverage_position(
                    managed_signal,
                    equity,
                    {
                        **params,
                        "risk_pct": risk_pct,
                        "loss_streak": current_consecutive_losses,
                        "account_peak": peak,
                    },
                )
                if leveraged:
                    if signal_filter_reason(leveraged, params):
                        continue
                    if signal_score(leveraged) < min_signal_score:
                        continue
                    position = attach_trade_management(
                        {
                            **leveraged,
                            "entry_time": candle["time"],
                            "entry_ts": candle["ts"],
                            "entry_index": i,
                        },
                        params,
                    )
                    trades_by_day[day_key] = day_trades + 1

        if in_window:
            peak = max(peak, equity)
            drawdown = (peak - equity) / peak if peak else 0
            max_drawdown = max(max_drawdown, drawdown)
            equity_curve.append({"time": candle["time"], "equity": equity})

    wins = [t for t in trades if t["pnl"] > 0]
    losses = [t for t in trades if t["pnl"] <= 0]
    profit = sum(t["pnl"] for t in wins)
    loss = abs(sum(t["pnl"] for t in losses))
    avg_win = profit / len(wins) if wins else 0
    avg_loss = loss / len(losses) if losses else 0
    gross_pnl = sum(t["pnl"] for t in trades)
    summary = {
            "initial_equity": initial_equity,
            "final_equity": equity,
            "return_pct": (equity / initial_equity - 1) if initial_equity else 0,
            "max_drawdown": max_drawdown,
            "trades": len(trades),
            "win_rate": len(wins) / len(trades) if trades else 0,
            "profit_factor": profit / loss if loss else None,
            "avg_win": avg_win,
            "avg_loss": avg_loss,
            "expectancy": gross_pnl / len(trades) if trades else 0,
            "max_consecutive_losses": max_consecutive_losses,
            "history_hours": history_hours,
            "window_start": utc_ms_to_iso(window_start_ts) if window_start_ts else None,
            "window_end": utc_ms_to_iso(latest_ts) if latest_ts else None,
            "candles_in_window": len(equity_curve),
    }
    return {
        "summary": summary,
        "health": strategy_health(summary, trades),
        "trades": trades[-100:],
        "equity_curve": equity_curve,
        "candles": [
            {
                "ts": candle["ts"],
                "time": candle["time"],
                "open": candle["open"],
                "high": candle["high"],
                "low": candle["low"],
                "close": candle["close"],
                "volume": candle["volume"],
                "regime": market_regime(candle, params),
            }
            for candle in candles
            if window_start_ts <= candle["ts"] <= latest_ts
        ],
    }


def optimize_params(candles: list[dict[str, Any]], params: dict[str, Any], trend_by_ts: dict[int, str] | None) -> dict[str, Any]:
    candidates: list[dict[str, Any]] = []
    for lookback in [16, 24, 36, 48]:
        for atr_stop_mult in [1.0, 1.4, 1.8, 2.2]:
            for take_profit_rr in [1.4, 1.8, 2.2, 2.8]:
                for min_adx in [12, 18, 24, 30]:
                    for min_breakout_atr in [0.15, 0.25, 0.4]:
                        for min_sweep_atr in [0.25, 0.4, 0.6]:
                            candidate = {
                                **params,
                                "lookback": lookback,
                                "atr_stop_mult": atr_stop_mult,
                                "take_profit_rr": take_profit_rr,
                                "min_adx": min_adx,
                                "min_breakout_atr": min_breakout_atr,
                                "min_sweep_atr": min_sweep_atr,
                            }
                            result = run_backtest(candles, candidate, trend_by_ts)
                            summary = result["summary"]
                            trade_penalty = max(0, 5 - summary["trades"]) * 0.02
                            loss_streak_penalty = summary["max_consecutive_losses"] * 0.005
                            score = summary["return_pct"] - summary["max_drawdown"] * 0.75 - trade_penalty - loss_streak_penalty
                            health = result.get("health") or strategy_health(summary, result.get("trades", []))
                            score += (float(health.get("score") or 0) - 55) * 0.001
                            candidates.append(
                                {
                                    "score": score,
                                    "health": health,
                                    "params": {
                                        "lookback": lookback,
                                        "atr_stop_mult": atr_stop_mult,
                                        "take_profit_rr": take_profit_rr,
                                        "min_adx": min_adx,
                                        "min_breakout_atr": min_breakout_atr,
                                        "min_sweep_atr": min_sweep_atr,
                                    },
                                    "summary": summary,
                                }
                            )
    unique, dedup = dedupe_optimization_candidates(candidates)
    return {"best": unique[0], "top": unique[:8], "dedup": dedup}


def score_summary(summary: dict[str, Any]) -> float:
    trade_penalty = max(0, 5 - summary["trades"]) * 0.02
    loss_streak_penalty = summary["max_consecutive_losses"] * 0.005
    return summary["return_pct"] - summary["max_drawdown"] * 0.75 - trade_penalty - loss_streak_penalty


def bucket_param(value: Any, step: float) -> float:
    try:
        return round(float(value) / step) * step
    except (TypeError, ValueError):
        return 0.0


def optimization_candidate_key(candidate: dict[str, Any]) -> tuple[Any, ...]:
    params = candidate.get("params") or {}
    return (
        params.get("strategy_mode", "single"),
        bool(params.get("require_next_confirmation", False)),
        int(bucket_param(params.get("lookback"), 12)),
        round(bucket_param(params.get("atr_stop_mult"), 0.5), 2),
        round(bucket_param(params.get("take_profit_rr"), 0.5), 2),
        int(bucket_param(params.get("min_adx"), 6)),
        round(bucket_param(params.get("min_breakout_atr"), 0.2), 2),
        round(bucket_param(params.get("min_sweep_atr"), 0.25), 2),
    )


def dedupe_optimization_candidates(candidates: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], dict[str, int]]:
    ordered = sorted(candidates, key=lambda item: float(item.get("score") or 0), reverse=True)
    representatives: dict[tuple[Any, ...], dict[str, Any]] = {}
    unique: list[dict[str, Any]] = []
    for candidate in ordered:
        key = optimization_candidate_key(candidate)
        if key in representatives:
            representatives[key]["cluster_size"] = int(representatives[key].get("cluster_size") or 1) + 1
            continue
        representative = {**candidate, "cluster_size": 1, "cluster_key": key}
        representatives[key] = representative
        unique.append(representative)
    return unique, {"raw": len(candidates), "unique": len(unique), "removed": len(candidates) - len(unique)}


def optimize_health_adjustment(health_scores: list[float]) -> float:
    if not health_scores:
        return -0.05
    avg_health = sum(health_scores) / len(health_scores)
    worst_health = min(health_scores)
    return (avg_health - 55) * 0.001 - max(0.0, 50 - worst_health) * 0.002


def optimize_candidate_diagnostics(rows: list[dict[str, Any]], raw_score: float, adjusted_score: float) -> dict[str, Any]:
    health_scores = [float((row.get("health") or {}).get("score") or 0) for row in rows]
    worst_return_row = min(rows, key=lambda row: float(row["summary"].get("return_pct") or 0), default=None)
    worst_health_row = min(rows, key=lambda row: float((row.get("health") or {}).get("score") or 0), default=None)
    notes: list[str] = []
    if worst_return_row:
        notes.append(
            f"最弱收益窗口：{worst_return_row.get('inst_id', '-')} / {float(worst_return_row.get('history_hours') or 0):g}h，"
            f"收益 {float(worst_return_row['summary'].get('return_pct') or 0) * 100:.2f}%"
        )
    if worst_health_row:
        health = worst_health_row.get("health") or {}
        notes.append(
            f"最低健康度：{worst_health_row.get('inst_id', '-')} / {float(worst_health_row.get('history_hours') or 0):g}h，"
            f"{health.get('grade', '-')} · {float(health.get('score') or 0):.0f}"
        )
    for row in rows:
        for note in (row.get("health") or {}).get("notes", []):
            if note not in notes:
                notes.append(note)
            if len(notes) >= 5:
                break
        if len(notes) >= 5:
            break

    return {
        "raw_score": raw_score,
        "adjusted_score": adjusted_score,
        "health_adjustment": adjusted_score - raw_score,
        "avg_health": sum(health_scores) / len(health_scores) if health_scores else 0.0,
        "worst_health": min(health_scores) if health_scores else 0.0,
        "worst_return": float(worst_return_row["summary"].get("return_pct") or 0) if worst_return_row else 0.0,
        "worst_case": {
            "inst_id": worst_return_row.get("inst_id") if worst_return_row else None,
            "history_hours": worst_return_row.get("history_hours") if worst_return_row else None,
            "return_pct": float(worst_return_row["summary"].get("return_pct") or 0) if worst_return_row else 0.0,
            "max_drawdown": float(worst_return_row["summary"].get("max_drawdown") or 0) if worst_return_row else 0.0,
            "trades": int(worst_return_row["summary"].get("trades") or 0) if worst_return_row else 0,
        },
        "notes": notes[:5],
    }


def joint_optimize_params(params: dict[str, Any]) -> dict[str, Any]:
    symbols = params.get("symbols") or ["BTC-USDT-SWAP", "ETH-USDT-SWAP", "SOL-USDT-SWAP"]
    windows = params.get("windows") or [168]
    datasets: list[dict[str, Any]] = []
    max_hours = max(float(hours) for hours in windows)
    base_params = {**params, "history_hours": max_hours}

    for inst_id in symbols:
        candles = fetch_backtest_candles(inst_id, base_params.get("bar", "15m"), base_params)
        trend_candles = fetch_trend_candles(inst_id, base_params.get("trend_bar", "1H"), base_params)
        datasets.append(
            {
                "inst_id": inst_id,
                "candles": candles,
                "trend_by_ts": build_trend_context(trend_candles, base_params),
            }
        )

    candidates = []
    for strategy_mode in ["regime_multi_strategy", "trend_pullback", "trend_breakout", "louie_price_action", "adaptive_price_action", "raw_price_action"]:
        for require_next_confirmation in [True]:
            for lookback in [24, 36, 48]:
                for atr_stop_mult in [1.0, 1.4]:
                    for take_profit_rr in [1.8, 2.2, 2.8]:
                        for min_breakout_atr in [0.15, 0.25]:
                            for min_sweep_atr in [0.35, 0.6]:
                                candidate = {
                                    **params,
                                    "strategy_mode": strategy_mode,
                                    "require_next_confirmation": require_next_confirmation,
                                    "lookback": lookback,
                                    "atr_stop_mult": atr_stop_mult,
                                    "take_profit_rr": take_profit_rr,
                                    "min_breakout_atr": min_breakout_atr,
                                    "min_sweep_atr": min_sweep_atr,
                                    "use_regime_filter": strategy_mode == "adaptive_price_action",
                                }
                                rows = []
                                for dataset in datasets:
                                    trend_by_ts = dataset["trend_by_ts"] if uses_trend_context(strategy_mode) else None
                                    for hours in windows:
                                        run_params = {**candidate, "history_hours": float(hours)}
                                        result = run_backtest(dataset["candles"], run_params, trend_by_ts)
                                        rows.append(
                                            {
                                                "inst_id": dataset["inst_id"],
                                                "history_hours": float(hours),
                                                "summary": result["summary"],
                                                "health": result.get("health"),
                                                "score": score_summary(result["summary"]),
                                            }
                                        )
                                positive_cases = sum(1 for row in rows if row["summary"]["return_pct"] > 0)
                                total_trades = sum(row["summary"]["trades"] for row in rows)
                                avg_score = sum(row["score"] for row in rows) / len(rows)
                                worst_return = min(row["summary"]["return_pct"] for row in rows)
                                worst_drawdown = max(row["summary"]["max_drawdown"] for row in rows)
                                worst_loss_streak = max(row["summary"]["max_consecutive_losses"] for row in rows)
                                avg_expectancy = sum(row["summary"]["expectancy"] for row in rows) / len(rows)
                                sample_penalty = max(0, len(rows) * 5 - total_trades) * 0.004
                                consistency_bonus = positive_cases / len(rows) * 0.03
                                aggregate_summary = {
                                    "initial_equity": float(params.get("initial_equity", 10)),
                                    "final_equity": None,
                                    "return_pct": sum(row["summary"]["return_pct"] for row in rows) / len(rows),
                                    "max_drawdown": worst_drawdown,
                                    "trades": total_trades,
                                    "win_rate": sum(row["summary"]["win_rate"] for row in rows) / len(rows),
                                    "profit_factor": None,
                                    "expectancy": avg_expectancy,
                                    "max_consecutive_losses": worst_loss_streak,
                                    "positive_cases": positive_cases,
                                    "cases": len(rows),
                                }
                                health_scores = [float((row.get("health") or {}).get("score") or 0) for row in rows]
                                aggregate_health = strategy_health(aggregate_summary, [])
                                raw_score = avg_score + consistency_bonus + worst_return * 0.35 - worst_drawdown * 0.35 - sample_penalty
                                joint_score = raw_score + optimize_health_adjustment(health_scores)
                                diagnostics = optimize_candidate_diagnostics(rows, raw_score, joint_score)
                                candidates.append(
                                    {
                                        "score": joint_score,
                                        "raw_score": raw_score,
                                        "health": aggregate_health,
                                        "diagnostics": diagnostics,
                                        "params": {
                                            "strategy_mode": strategy_mode,
                                            "require_next_confirmation": require_next_confirmation,
                                            "lookback": lookback,
                                            "atr_stop_mult": atr_stop_mult,
                                            "take_profit_rr": take_profit_rr,
                                            "min_adx": params.get("min_adx", 18),
                                            "min_breakout_atr": min_breakout_atr,
                                            "min_sweep_atr": min_sweep_atr,
                                        },
                                        "summary": aggregate_summary,
                                        "rows": rows,
                                    }
                                )

    unique, dedup = dedupe_optimization_candidates(candidates)
    return {"best": unique[0], "top": unique[:8], "dedup": dedup}


def run_backtest_for_market(inst_id: str, params: dict[str, Any]) -> dict[str, Any]:
    candles = fetch_backtest_candles(inst_id, params.get("bar", "15m"), params)
    trend_by_ts = None
    if uses_trend_context(params.get("strategy_mode", "trend_price_action")):
        trend_candles = fetch_trend_candles(inst_id, params.get("trend_bar", "1H"), params)
        trend_by_ts = build_trend_context(trend_candles, params)
    return run_backtest(candles, params, trend_by_ts)


def position_qty(position: dict[str, Any]) -> float:
    qty = position.get("remaining_qty", position.get("qty"))
    if qty is not None:
        return float(qty)
    return float(position.get("notional", 0)) / max(float(position.get("entry", 0) or 0), 1e-9)


def attach_trade_management(position: dict[str, Any], params: dict[str, Any]) -> dict[str, Any]:
    managed = dict(position)
    qty = position_qty(managed)
    managed.setdefault("qty", qty)
    managed.setdefault("original_qty", qty)
    managed.setdefault("remaining_qty", qty)
    managed.setdefault("realized_pnl", 0.0)
    managed.setdefault("gross_pnl_realized", 0.0)
    managed.setdefault("fees_paid", 0.0)
    managed.setdefault("slippage_paid", 0.0)
    managed.setdefault("tp_hits", [])
    managed.setdefault("stop_moved_to_breakeven", False)

    if not bool(params.get("use_multi_take_profit", False)):
        managed.setdefault("tp_levels", [])
        return managed

    entry = float(managed["entry"])
    stop = float(managed["stop"])
    final_tp = float(managed["take_profit"])
    risk = abs(entry - stop)
    if risk <= 0:
        managed["tp_levels"] = []
        return managed

    direction = 1 if managed["side"] == "long" else -1
    final_rr = abs(final_tp - entry) / max(risk, 1e-9)
    tp1_share = max(0.05, min(float(params.get("tp1_share_pct", 0.40)), 0.90))
    tp2_share = max(0.0, min(float(params.get("tp2_share_pct", 0.30)), 0.90))

    rr_targets = [1.0]
    if final_rr >= 2.05:
        rr_targets.append(2.0)
    if final_rr > rr_targets[-1] + 0.15:
        rr_targets.append(final_rr)

    if len(rr_targets) == 1:
        shares = [1.0]
    elif len(rr_targets) == 2:
        shares = [tp1_share, 1.0 - tp1_share]
    else:
        if tp1_share + tp2_share >= 0.95:
            scale = 0.90 / (tp1_share + tp2_share)
            tp1_share *= scale
            tp2_share *= scale
        shares = [tp1_share, tp2_share, 1.0 - tp1_share - tp2_share]

    levels = []
    last_price = None
    for rr, share in zip(rr_targets, shares):
        price = entry + direction * risk * rr
        if last_price is not None and abs(price - last_price) / max(entry, 1e-9) < 0.00005:
            levels[-1]["share"] += share
            continue
        levels.append({"price": price, "share": max(0.0, share), "rr": rr, "filled": False})
        last_price = price
    managed["tp_levels"] = levels
    return managed


def exit_position_on_candle(position: dict[str, Any], candle: dict[str, Any]) -> tuple[str, float] | None:
    if position["side"] == "long":
        liq_hit = position.get("liquidation_price") is not None and candle["low"] <= position["liquidation_price"]
        stop_hit = candle["low"] <= position["stop"]
        tp_hit = candle["high"] >= position["take_profit"]
        if liq_hit:
            return "liquidation", position["liquidation_price"]
        if stop_hit:
            return "stop", position["stop"]
        if tp_hit:
            return "take_profit", position["take_profit"]
    else:
        liq_hit = position.get("liquidation_price") is not None and candle["high"] >= position["liquidation_price"]
        stop_hit = candle["high"] >= position["stop"]
        tp_hit = candle["low"] <= position["take_profit"]
        if liq_hit:
            return "liquidation", position["liquidation_price"]
        if stop_hit:
            return "stop", position["stop"]
        if tp_hit:
            return "take_profit", position["take_profit"]
    return None


def time_exit_on_candle(position: dict[str, Any], candle: dict[str, Any], params: dict[str, Any]) -> tuple[str, float] | None:
    time_exit_bars = int(params.get("time_exit_bars", 0) or 0)
    if time_exit_bars <= 0:
        return None
    entry_ts = position.get("entry_ts")
    if entry_ts is None:
        return None
    held_bars = (int(candle["ts"]) - int(entry_ts)) / max(bar_to_ms(params.get("bar", "1H")), 1)
    if held_bars < time_exit_bars:
        return None

    entry = float(position["entry"])
    stop = float(position["stop"])
    risk = abs(entry - stop)
    if risk <= 0:
        return None
    direction = 1 if position["side"] == "long" else -1
    unrealized_rr = (float(candle["close"]) - entry) * direction / risk
    min_rr = float(params.get("time_exit_min_rr", 0.25))
    if unrealized_rr < min_rr:
        return "time_exit", float(candle["close"])
    return None


def realize_position_qty(
    position: dict[str, Any],
    exit_price: float,
    qty: float,
    params: dict[str, Any],
    exit_reason: str,
) -> dict[str, float]:
    direction = 1 if position["side"] == "long" else -1
    entry = float(position["entry"])
    gross = (exit_price - entry) * direction * qty
    rates = trade_cost_rates(params, position.get("inst_id"), exit_reason)
    fees = (entry * rates["entry_fee"] + exit_price * rates["exit_fee"]) * qty
    slippage = (entry * rates["entry_slippage"] + exit_price * rates["exit_slippage"]) * qty
    pnl = gross - fees - slippage
    return {"gross": gross, "fees": fees, "slippage": slippage, "pnl": pnl}


def close_position_trade(
    position: dict[str, Any],
    candle: dict[str, Any],
    exit_reason: str,
    exit_price: float,
    pnl_piece: dict[str, float],
    equity: float,
    initial_equity: float,
) -> dict[str, Any]:
    gross = float(position.get("gross_pnl_realized", 0.0)) + pnl_piece["gross"]
    fees = float(position.get("fees_paid", 0.0)) + pnl_piece["fees"]
    slippage = float(position.get("slippage_paid", 0.0)) + pnl_piece["slippage"]
    pnl = float(position.get("realized_pnl", 0.0)) + pnl_piece["pnl"]
    exit_qty = float(position.get("original_qty", position.get("qty", 0.0)))
    return {
        **position,
        "qty": exit_qty,
        "remaining_qty": 0.0,
        "exit_time": candle["time"],
        "exit_price": exit_price,
        "exit_reason": exit_reason,
        "gross_pnl": gross,
        "fees": fees,
        "slippage": slippage,
        "pnl": pnl,
        "pnl_pct": pnl / max(initial_equity, 1e-9),
        "equity": equity,
    }


def process_position_on_candle(
    position: dict[str, Any],
    candle: dict[str, Any],
    params: dict[str, Any],
    equity: float,
    initial_equity: float,
) -> tuple[dict[str, Any] | None, dict[str, Any] | None, float]:
    remaining_qty = position_qty(position)

    exit_hit = exit_position_on_candle(position, candle)
    time_exit_hit = None if exit_hit else time_exit_on_candle(position, candle, params)
    if not bool(params.get("use_multi_take_profit", False)):
        exit_hit = exit_hit or time_exit_hit
        if not exit_hit:
            return position, None, 0.0
        exit_reason, exit_price = exit_hit
        pnl_piece = realize_position_qty(position, exit_price, remaining_qty, params, exit_reason)
        trade = close_position_trade(position, candle, exit_reason, exit_price, pnl_piece, equity + pnl_piece["pnl"], initial_equity)
        return None, trade, pnl_piece["pnl"]

    if exit_hit and exit_hit[0] in {"liquidation", "stop"}:
        exit_reason, exit_price = exit_hit
        pnl_piece = realize_position_qty(position, exit_price, remaining_qty, params, exit_reason)
        trade = close_position_trade(position, candle, exit_reason, exit_price, pnl_piece, equity + pnl_piece["pnl"], initial_equity)
        return None, trade, pnl_piece["pnl"]

    updated = dict(position)
    updated["remaining_qty"] = remaining_qty
    original_qty = float(updated.get("original_qty", updated.get("qty", remaining_qty)))
    delta = 0.0
    last_tp_price = None
    tp_hits = list(updated.get("tp_hits", []))

    for level in updated.get("tp_levels", []):
        if level.get("filled"):
            continue
        price = float(level["price"])
        hit = candle["high"] >= price if updated["side"] == "long" else candle["low"] <= price
        if not hit:
            continue

        target_qty = original_qty * float(level.get("share", 0))
        qty = min(updated["remaining_qty"], target_qty)
        if qty <= 1e-12:
            level["filled"] = True
            continue

        pnl_piece = realize_position_qty(updated, price, qty, params, "take_profit")
        updated["remaining_qty"] -= qty
        updated["realized_pnl"] = float(updated.get("realized_pnl", 0.0)) + pnl_piece["pnl"]
        updated["gross_pnl_realized"] = float(updated.get("gross_pnl_realized", 0.0)) + pnl_piece["gross"]
        updated["fees_paid"] = float(updated.get("fees_paid", 0.0)) + pnl_piece["fees"]
        updated["slippage_paid"] = float(updated.get("slippage_paid", 0.0)) + pnl_piece["slippage"]
        delta += pnl_piece["pnl"]
        level["filled"] = True
        last_tp_price = price
        tp_hits.append({"time": candle["time"], "price": price, "qty": qty, "rr": level.get("rr"), "pnl": pnl_piece["pnl"]})

        if bool(params.get("move_stop_to_breakeven_after_tp1", True)) and not updated.get("stop_moved_to_breakeven"):
            updated["stop"] = updated["entry"]
            updated["stop_moved_to_breakeven"] = True

        if updated["remaining_qty"] <= max(original_qty * 1e-6, 1e-12):
            break

    updated["tp_hits"] = tp_hits
    updated["tp_levels"] = list(updated.get("tp_levels", []))
    if updated["remaining_qty"] <= max(original_qty * 1e-6, 1e-12):
        zero_piece = {"gross": 0.0, "fees": 0.0, "slippage": 0.0, "pnl": 0.0}
        trade = close_position_trade(updated, candle, "take_profit_all", last_tp_price or updated["take_profit"], zero_piece, equity + delta, initial_equity)
        return None, trade, delta

    time_exit_hit = time_exit_on_candle(updated, candle, params)
    if time_exit_hit:
        exit_reason, exit_price = time_exit_hit
        pnl_piece = realize_position_qty(updated, exit_price, updated["remaining_qty"], params, exit_reason)
        trade = close_position_trade(updated, candle, exit_reason, exit_price, pnl_piece, equity + delta + pnl_piece["pnl"], initial_equity)
        return None, trade, delta + pnl_piece["pnl"]

    return updated, None, delta


def portfolio_backtest(params: dict[str, Any]) -> dict[str, Any]:
    cached = PORTFOLIO_RESULT_CACHE.get(params)
    if cached is not None:
        cached["cache"] = {"hit": True, "ttl_seconds": PORTFOLIO_RESULT_CACHE.ttl_seconds}
        return cached
    result = run_portfolio_backtest(params)
    result["cache"] = {"hit": False, "ttl_seconds": PORTFOLIO_RESULT_CACHE.ttl_seconds}
    PORTFOLIO_RESULT_CACHE.set(params, result)
    return PORTFOLIO_RESULT_CACHE.get(params) or result


def run_portfolio_backtest(params: dict[str, Any]) -> dict[str, Any]:
    symbols = params.get("symbols") or ["BTC-USDT-SWAP", "ETH-USDT-SWAP", "SOL-USDT-SWAP"]
    history_hours = float(params.get("history_hours", 2160))
    initial_equity = float(params.get("initial_equity", 10))
    risk_pct = float(params.get("risk_pct", 0.10))
    fee_rate = float(params.get("fee_rate", 0.0005))
    slippage_pct = float(params.get("slippage_pct", 0.0002))
    cooldown_bars = int(params.get("cooldown_bars", 4))
    loss_streak_pause_bars = int(params.get("loss_streak_pause_bars", 0))
    max_strategy_drawdown = float(params.get("max_strategy_drawdown", 0.35))
    max_daily_trades = int(params.get("max_daily_trades", 9999))
    min_signal_score = float(params.get("min_signal_score", -999))
    enable_risk_circuit = bool(params.get("enable_risk_circuit_breaker", True))
    max_daily_loss_pct = float(params.get("max_daily_loss_pct", 1.0))
    max_loss_streak_stop = int(params.get("max_loss_streak_stop", 9999))
    fetch_params = {**params, "history_hours": float(params.get("fetch_history_hours", history_hours))}

    datasets = []
    for inst_id in symbols:
        candles = enrich_candles(fetch_backtest_candles(inst_id, params.get("bar", "1H"), fetch_params), params)
        trend_by_ts = {}
        if uses_trend_context(params.get("strategy_mode", "louie_price_action")):
            trend_candles = fetch_trend_candles(inst_id, params.get("trend_bar", "1H"), fetch_params)
            trend_by_ts = build_trend_context(trend_candles, params)
        datasets.append(
            {
                "inst_id": inst_id,
                "candles": candles,
                "by_ts": {candle["ts"]: index for index, candle in enumerate(candles)},
                "trend_points": sorted(trend_by_ts.items()),
                "trend_cursor": 0,
                "trend": "neutral",
                "pending_signal": None,
            }
        )

    latest_ts = int(params.get("window_end_ts") or min(dataset["candles"][-1]["ts"] for dataset in datasets if dataset["candles"]))
    window_start_ts = latest_ts - int(history_hours * 60 * 60 * 1000)
    timeline = sorted(
        {
            candle["ts"]
            for dataset in datasets
            for candle in dataset["candles"]
            if window_start_ts <= candle["ts"] <= latest_ts
        }
    )

    equity = initial_equity
    peak = initial_equity
    max_drawdown = 0.0
    position: dict[str, Any] | None = None
    trades: list[dict[str, Any]] = []
    equity_curve = []
    current_consecutive_losses = 0
    max_consecutive_losses = 0
    cooldown_until_ts = -1
    bar_ms = bar_to_ms(params.get("bar", "1H"))
    trades_by_day: dict[str, int] = {}
    day_start_equity_by_day: dict[str, float] = {}
    breakout_history: list[float] = []

    for ts in timeline:
        for dataset in datasets:
            trend_points = dataset["trend_points"]
            while dataset["trend_cursor"] < len(trend_points) and trend_points[dataset["trend_cursor"]][0] <= ts:
                dataset["trend"] = trend_points[dataset["trend_cursor"]][1]
                dataset["trend_cursor"] += 1

        if position:
            dataset = next((item for item in datasets if item["inst_id"] == position["inst_id"]), None)
            candle = None
            if dataset and ts in dataset["by_ts"]:
                candle = dataset["candles"][dataset["by_ts"][ts]]
            if candle:
                position, trade, pnl_delta = process_position_on_candle(position, candle, params, equity, initial_equity)
                if pnl_delta:
                    equity += pnl_delta
                if trade:
                    trades.append(trade)
                    if trade.get("kind") == "louie_breakout_test":
                        breakout_history.append(float(trade.get("pnl", 0.0)))
                    if trade["pnl"] <= 0:
                        current_consecutive_losses += 1
                        max_consecutive_losses = max(max_consecutive_losses, current_consecutive_losses)
                        pause_bars = cooldown_bars
                        if enable_risk_circuit and loss_streak_pause_bars > 0 and current_consecutive_losses >= max_loss_streak_stop:
                            pause_bars = max(pause_bars, loss_streak_pause_bars)
                            current_consecutive_losses = 0
                        cooldown_until_ts = ts + pause_bars * bar_ms
                    else:
                        current_consecutive_losses = 0

        day_key = utc_ms_to_iso(ts)[:10]
        day_start_equity_by_day.setdefault(day_key, equity)
        day_trades = trades_by_day.get(day_key, 0)
        day_start_equity = day_start_equity_by_day[day_key]
        daily_loss = max(0.0, (day_start_equity - equity) / day_start_equity) if day_start_equity else 0.0
        daily_loss_blocked = enable_risk_circuit and daily_loss >= max_daily_loss_pct
        if (
            not position
            and ts >= cooldown_until_ts
            and day_trades < max_daily_trades
            and not daily_loss_blocked
            and peak
            and (peak - equity) / peak < max_strategy_drawdown
        ):
            candidates = []
            for dataset in datasets:
                index = dataset["by_ts"].get(ts)
                if index is None:
                    continue
                candles = dataset["candles"]
                candle = candles[index]
                signal = None
                pending = dataset.get("pending_signal")
                if pending and pending.get("entry_index", -1) == index - 1:
                    signal = confirm_signal(pending, candle, params)
                    dataset["pending_signal"] = None
                elif pending:
                    dataset["pending_signal"] = None
                    signal = None
                else:
                    raw_signal = candle_signal(candles, index, params, dataset["trend"])
                    if raw_signal and bool(params.get("require_next_confirmation", False)):
                        dataset["pending_signal"] = {**raw_signal, "entry_index": index, "candidate_time": candle["time"]}
                    else:
                        signal = raw_signal
                if signal:
                    managed = adapt_signal_to_market({**signal, "inst_id": dataset["inst_id"]}, params)
                    managed = apply_breakout_guard(managed, params, breakout_history)
                    leveraged = leverage_position(
                        managed,
                        equity,
                        {
                            **params,
                            "risk_pct": risk_pct,
                            "loss_streak": current_consecutive_losses,
                            "account_peak": peak,
                        },
                    )
                    if leveraged:
                        leveraged = {**leveraged, "inst_id": dataset["inst_id"]}
                        if signal_filter_reason(leveraged, params):
                            continue
                        score = signal_score(leveraged)
                        if score < min_signal_score:
                            continue
                        if day_trades >= 1:
                            second_trade_min_score = params.get("second_trade_min_score")
                            if second_trade_min_score is not None and score < float(second_trade_min_score):
                                continue
                            second_trade_allowed_kinds = params.get("second_trade_allowed_kinds")
                            if second_trade_allowed_kinds and leveraged.get("kind") not in set(second_trade_allowed_kinds):
                                continue
                            second_trade_side = params.get("second_trade_side", "any")
                            if second_trade_side != "any" and leveraged.get("side") != second_trade_side:
                                continue
                        candidates.append(
                            {
                                **leveraged,
                                "entry_time": candle["time"],
                                "entry_ts": ts,
                                "entry_index": index,
                                "score": score,
                            }
                        )
            if candidates:
                position = attach_trade_management(max(candidates, key=lambda item: item["score"]), params)
                trades_by_day[day_key] = day_trades + 1
                for dataset in datasets:
                    dataset["pending_signal"] = None

        peak = max(peak, equity)
        drawdown = (peak - equity) / peak if peak else 0
        max_drawdown = max(max_drawdown, drawdown)
        equity_curve.append({"time": utc_ms_to_iso(ts), "equity": equity})

    wins = [trade for trade in trades if trade["pnl"] > 0]
    losses = [trade for trade in trades if trade["pnl"] <= 0]
    profit = sum(trade["pnl"] for trade in wins)
    loss = abs(sum(trade["pnl"] for trade in losses))
    gross_pnl = sum(trade["pnl"] for trade in trades)
    by_symbol = []
    for inst_id in symbols:
        symbol_trades = [trade for trade in trades if trade["inst_id"] == inst_id]
        symbol_pnl = sum(trade["pnl"] for trade in symbol_trades)
        by_symbol.append(
            {
                "inst_id": inst_id,
                "trades": len(symbol_trades),
                "pnl": symbol_pnl,
                "return_pct": symbol_pnl / max(initial_equity, 1e-9),
                "win_rate": sum(1 for trade in symbol_trades if trade["pnl"] > 0) / len(symbol_trades) if symbol_trades else 0,
            }
        )

    summary = {
            "initial_equity": initial_equity,
            "final_equity": equity,
            "return_pct": (equity / initial_equity - 1) if initial_equity else 0,
            "max_drawdown": max_drawdown,
            "trades": len(trades),
            "win_rate": len(wins) / len(trades) if trades else 0,
            "profit_factor": profit / loss if loss else None,
            "expectancy": gross_pnl / len(trades) if trades else 0,
            "max_consecutive_losses": max_consecutive_losses,
            "history_hours": history_hours,
            "window_start": utc_ms_to_iso(window_start_ts),
            "window_end": utc_ms_to_iso(latest_ts),
    }
    return {
        "summary": summary,
        "health": strategy_health(summary, trades, by_symbol),
        "by_symbol": by_symbol,
        "trades": trades[-100:],
        "equity_curve": equity_curve,
    }


def portfolio_time_slices(params: dict[str, Any]) -> dict[str, Any]:
    total_hours = float(params.get("history_hours", 2160))
    slice_hours = float(params.get("slice_hours", 720))
    if slice_hours <= 0 or total_hours < slice_hours:
        raise ValueError("slice_hours must be positive and no larger than history_hours")

    base_result = portfolio_backtest(params)
    latest_ts = int(datetime.fromisoformat(base_result["summary"]["window_end"]).timestamp() * 1000)
    slice_ms = int(slice_hours * 60 * 60 * 1000)
    total_ms = int(total_hours * 60 * 60 * 1000)
    first_end_ts = latest_ts - total_ms + slice_ms

    results = []
    end_ts = first_end_ts
    slice_index = 1
    while end_ts <= latest_ts:
        result = portfolio_backtest(
            {
                **params,
                "history_hours": slice_hours,
                "fetch_history_hours": total_hours,
                "window_end_ts": end_ts,
            }
        )
        results.append(
            {
                "slice": slice_index,
                "window_start": result["summary"]["window_start"],
                "window_end": result["summary"]["window_end"],
                "summary": result["summary"],
                "by_symbol": result["by_symbol"],
            }
        )
        slice_index += 1
        end_ts += slice_ms

    aggregate = {
        "cases": len(results),
        "positive_cases": sum(1 for row in results if row["summary"]["return_pct"] > 0),
        "total_trades": sum(row["summary"]["trades"] for row in results),
        "avg_return_pct": sum(row["summary"]["return_pct"] for row in results) / len(results) if results else 0,
        "worst_return_pct": min((row["summary"]["return_pct"] for row in results), default=0),
        "worst_drawdown": max((row["summary"]["max_drawdown"] for row in results), default=0),
        "empty_cases": sum(1 for row in results if row["summary"]["trades"] == 0),
    }
    return {"aggregate": aggregate, "results": results}


def monthly_compound_return(summary: dict[str, Any]) -> float:
    initial_equity = float(summary.get("initial_equity") or 0)
    final_equity = float(summary.get("final_equity") or 0)
    history_hours = float(summary.get("history_hours") or 0)
    if initial_equity <= 0 or final_equity <= 0 or history_hours <= 0:
        return 0.0
    return (final_equity / initial_equity) ** (720 / history_hours) - 1


def portfolio_robustness(params: dict[str, Any]) -> dict[str, Any]:
    total_hours = float(params.get("history_hours", 2160))
    window_hours = float(params.get("robust_window_hours", min(720, total_hours)))
    step_hours = float(params.get("robust_step_hours", 168))
    if window_hours <= 0 or total_hours < window_hours:
        raise ValueError("robust_window_hours must be positive and no larger than history_hours")
    if step_hours <= 0:
        raise ValueError("robust_step_hours must be positive")

    base_result = portfolio_backtest(params)
    latest_ts = int(datetime.fromisoformat(base_result["summary"]["window_end"]).timestamp() * 1000)
    total_ms = int(total_hours * 60 * 60 * 1000)
    window_ms = int(window_hours * 60 * 60 * 1000)
    step_ms = int(step_hours * 60 * 60 * 1000)
    end_ts = latest_ts - total_ms + window_ms

    rolling = []
    case_index = 1
    while end_ts <= latest_ts:
        result = portfolio_backtest(
            {
                **params,
                "history_hours": window_hours,
                "fetch_history_hours": total_hours,
                "window_end_ts": end_ts,
            }
        )
        summary = result["summary"]
        rolling.append(
            {
                "case": case_index,
                "window_start": summary["window_start"],
                "window_end": summary["window_end"],
                "summary": summary,
                "monthly_return": monthly_compound_return(summary),
            }
        )
        case_index += 1
        end_ts += step_ms

    fee_rate = float(params.get("fee_rate", 0.0005))
    maker_fee = float(params.get("maker_fee_rate", fee_rate))
    taker_fee = float(params.get("taker_fee_rate", fee_rate))
    slippage_pct = float(params.get("slippage_pct", 0.0002))
    stress_scenarios = [
        ("当前模型", {"cost_model": params.get("cost_model", "simple"), "fee_rate": fee_rate, "maker_fee_rate": maker_fee, "taker_fee_rate": taker_fee, "slippage_pct": slippage_pct}),
        ("全Taker", {"cost_model": "okx_conservative", "fee_rate": taker_fee, "maker_fee_rate": taker_fee, "taker_fee_rate": taker_fee, "slippage_pct": slippage_pct}),
        ("滑点x2", {"cost_model": params.get("cost_model", "simple"), "fee_rate": fee_rate, "maker_fee_rate": maker_fee, "taker_fee_rate": taker_fee, "slippage_pct": slippage_pct * 2}),
        ("保守压力", {"cost_model": "okx_conservative", "fee_rate": taker_fee * 1.5, "maker_fee_rate": taker_fee * 1.5, "taker_fee_rate": taker_fee * 1.5, "slippage_pct": slippage_pct * 2}),
    ]
    stress = []
    for name, scenario_costs in stress_scenarios:
        result = portfolio_backtest(
            {
                **params,
                **scenario_costs,
            }
        )
        summary = result["summary"]
        stress.append(
            {
                "name": name,
                "fee_rate": scenario_costs["taker_fee_rate"],
                "slippage_pct": scenario_costs["slippage_pct"],
                "cost_model": scenario_costs["cost_model"],
                "summary": summary,
                "monthly_return": monthly_compound_return(summary),
            }
        )

    rolling_positive = sum(1 for row in rolling if row["summary"]["return_pct"] > 0)
    stress_positive = sum(1 for row in stress if row["summary"]["return_pct"] > 0)
    aggregate = {
        "base_monthly_return": monthly_compound_return(base_result["summary"]),
        "rolling_cases": len(rolling),
        "rolling_positive_cases": rolling_positive,
        "rolling_avg_return_pct": sum(row["summary"]["return_pct"] for row in rolling) / len(rolling) if rolling else 0,
        "rolling_worst_return_pct": min((row["summary"]["return_pct"] for row in rolling), default=0),
        "rolling_worst_drawdown": max((row["summary"]["max_drawdown"] for row in rolling), default=0),
        "stress_cases": len(stress),
        "stress_positive_cases": stress_positive,
        "stress_worst_return_pct": min((row["summary"]["return_pct"] for row in stress), default=0),
        "stress_worst_drawdown": max((row["summary"]["max_drawdown"] for row in stress), default=0),
    }
    aggregate["verdict"] = (
        "通过"
        if rolling and stress and rolling_positive == len(rolling) and stress_positive == len(stress) and aggregate["stress_worst_return_pct"] > 0
        else "需观察"
    )
    payload = {"aggregate": aggregate, "rolling": rolling, "stress": stress, "base": base_result["summary"]}
    if bool(params.get("include_base_result", False)):
        payload["base_result"] = base_result
    return payload


def percentile(values: list[float], pct: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    index = (len(ordered) - 1) * pct
    lower = int(index)
    upper = min(lower + 1, len(ordered) - 1)
    weight = index - lower
    return ordered[lower] * (1 - weight) + ordered[upper] * weight


def monte_carlo_portfolio(params: dict[str, Any]) -> dict[str, Any]:
    base_result = portfolio_backtest(params)
    trades = base_result.get("trades", [])
    initial_equity = float(base_result["summary"].get("initial_equity") or params.get("initial_equity", 10))
    iterations = max(100, min(int(params.get("monte_carlo_iterations", 1000)), 10000))
    floor_equity = float(params.get("monte_carlo_floor_equity", initial_equity * 0.5))
    if not trades:
        return {
            "summary": {
                "iterations": iterations,
                "trades": 0,
                "floor_equity": floor_equity,
                "loss_probability": 0.0,
                "floor_hit_probability": 0.0,
                "median_final_equity": initial_equity,
                "p05_final_equity": initial_equity,
                "p95_final_equity": initial_equity,
                "median_max_drawdown": 0.0,
                "p95_max_drawdown": 0.0,
                "worst_final_equity": initial_equity,
                "worst_max_drawdown": 0.0,
            },
            "rows": [],
        }

    returns = []
    for trade in trades:
        pnl = float(trade.get("pnl") or 0.0)
        prior_equity = float(trade.get("equity") or 0.0) - pnl
        if prior_equity > 0:
            returns.append(pnl / prior_equity)
    if not returns:
        returns = [float(trade.get("pnl_pct") or 0.0) for trade in trades]

    rng = random.Random(int(params.get("monte_carlo_seed", 20260517)))
    finals = []
    drawdowns = []
    floor_hits = 0
    loss_paths = 0
    sample_rows = []
    for run in range(iterations):
        equity = initial_equity
        peak = initial_equity
        max_drawdown = 0.0
        floor_hit = False
        for _ in range(len(returns)):
            trade_return = rng.choice(returns)
            equity *= max(0.0, 1 + trade_return)
            peak = max(peak, equity)
            drawdown = (peak - equity) / peak if peak else 0.0
            max_drawdown = max(max_drawdown, drawdown)
            if equity <= floor_equity:
                floor_hit = True
        finals.append(equity)
        drawdowns.append(max_drawdown)
        if equity < initial_equity:
            loss_paths += 1
        if floor_hit:
            floor_hits += 1
        if run < 20:
            sample_rows.append({"run": run + 1, "final_equity": equity, "max_drawdown": max_drawdown, "floor_hit": floor_hit})

    loss_probability = loss_paths / iterations
    floor_hit_probability = floor_hits / iterations
    p05_final_equity = percentile(finals, 0.05)
    p95_max_drawdown = percentile(drawdowns, 0.95)
    pass_monte_carlo = (
        floor_hit_probability == 0
        and loss_probability <= float(params.get("monte_carlo_max_loss_probability", 0.02))
        and p95_max_drawdown <= float(params.get("monte_carlo_max_p95_drawdown", 0.25))
        and p05_final_equity >= initial_equity
    )

    return {
        "summary": {
            "iterations": iterations,
            "trades": len(returns),
            "floor_equity": floor_equity,
            "loss_probability": loss_probability,
            "floor_hit_probability": floor_hit_probability,
            "median_final_equity": percentile(finals, 0.50),
            "p05_final_equity": p05_final_equity,
            "p95_final_equity": percentile(finals, 0.95),
            "median_max_drawdown": percentile(drawdowns, 0.50),
            "p95_max_drawdown": p95_max_drawdown,
            "worst_final_equity": min(finals),
            "worst_max_drawdown": max(drawdowns),
            "verdict": "通过" if pass_monte_carlo else "需观察",
        },
        "rows": sample_rows,
        "base": base_result["summary"],
    }


def market_hold_benchmark(params: dict[str, Any]) -> dict[str, Any]:
    symbols = params.get("symbols") or ["BTC-USDT-SWAP", "ETH-USDT-SWAP", "SOL-USDT-SWAP"]
    history_hours = float(params.get("history_hours", 2160))
    initial_equity = float(params.get("initial_equity", 10))
    fetch_params = {**params, "history_hours": float(params.get("fetch_history_hours", history_hours))}
    datasets = []
    for inst_id in symbols:
        candles = enrich_candles(fetch_backtest_candles(inst_id, params.get("bar", "15m"), fetch_params), params)
        if candles:
            datasets.append({"inst_id": inst_id, "candles": candles})
    if not datasets:
        raise ValueError("no candle data for market benchmark")

    latest_ts = min(dataset["candles"][-1]["ts"] for dataset in datasets)
    window_start_ts = latest_ts - int(history_hours * 60 * 60 * 1000)
    series = []
    by_symbol = []
    for dataset in datasets:
        rows = [candle for candle in dataset["candles"] if window_start_ts <= candle["ts"] <= latest_ts]
        if len(rows) < 2:
            continue
        start = float(rows[0]["close"])
        end = float(rows[-1]["close"])
        ret = end / start - 1 if start else 0.0
        by_symbol.append({"inst_id": dataset["inst_id"], "return_pct": ret, "start": start, "end": end})
        series.append({"inst_id": dataset["inst_id"], "start": start, "rows": rows})
    if not series:
        raise ValueError("not enough candle data for market benchmark")

    timestamps = sorted({candle["ts"] for item in series for candle in item["rows"]})
    cursors = {item["inst_id"]: 0 for item in series}
    last_close = {item["inst_id"]: float(item["rows"][0]["close"]) for item in series}
    starts = {item["inst_id"]: float(item["start"]) for item in series}
    row_maps = {item["inst_id"]: item["rows"] for item in series}
    equity_curve = []
    peak = initial_equity
    max_drawdown = 0.0
    for ts in timestamps:
        values = []
        for item in series:
            inst_id = item["inst_id"]
            rows = row_maps[inst_id]
            cursor = cursors[inst_id]
            while cursor < len(rows) and rows[cursor]["ts"] <= ts:
                last_close[inst_id] = float(rows[cursor]["close"])
                cursor += 1
            cursors[inst_id] = cursor
            values.append(last_close[inst_id] / max(starts[inst_id], 1e-9))
        equity = initial_equity * (sum(values) / len(values))
        peak = max(peak, equity)
        max_drawdown = max(max_drawdown, (peak - equity) / peak if peak else 0.0)
        equity_curve.append({"time": utc_ms_to_iso(ts), "equity": equity})

    final_equity = equity_curve[-1]["equity"] if equity_curve else initial_equity
    return {
        "summary": {
            "initial_equity": initial_equity,
            "final_equity": final_equity,
            "return_pct": final_equity / initial_equity - 1 if initial_equity else 0.0,
            "max_drawdown": max_drawdown,
            "trades": 0,
            "win_rate": None,
            "profit_factor": None,
            "expectancy": 0.0,
            "max_consecutive_losses": 0,
            "history_hours": history_hours,
            "window_start": utc_ms_to_iso(window_start_ts),
            "window_end": utc_ms_to_iso(latest_ts),
        },
        "by_symbol": by_symbol,
        "equity_curve": equity_curve,
    }


def portfolio_benchmarks(params: dict[str, Any]) -> dict[str, Any]:
    symbols = params.get("symbols") or ["BTC-USDT-SWAP", "ETH-USDT-SWAP", "SOL-USDT-SWAP"]
    run_params = {
        **params,
        "symbols": symbols,
        "prefer_cache": True,
        "offline_mode": True,
    }
    market = market_hold_benchmark(run_params)
    market_return = float(market["summary"].get("return_pct") or 0.0)
    candidates = [
        (
            "当前价格行为",
            "本项目",
            run_params,
            "当前 10U 激进价格行为组合。",
        ),
        (
            "趋势突破基线",
            "通用趋势模型",
            {
                **run_params,
                "strategy_mode": "trend_breakout",
                "use_regime_filter": True,
                "min_signal_score": -999,
                "require_next_confirmation": False,
                "trade_louie_breakout_tests": False,
                "trade_louie_delayed_sweeps": False,
            },
            "用简单趋势突破检查是否只是趋势 Beta。",
        ),
        (
            "扫损反转基线",
            "价格行为拆分",
            {
                **run_params,
                "strategy_mode": "louie_price_action",
                "trade_louie_trend_regime": False,
                "trade_louie_breakout_tests": False,
                "trade_louie_delayed_sweeps": True,
                "min_signal_score": 0.20,
            },
            "只保留扫损/延迟扫损反转，检查策略核心来源。",
        ),
        (
            "突破测试基线",
            "价格行为拆分",
            {
                **run_params,
                "strategy_mode": "louie_price_action",
                "trade_louie_trend_regime": False,
                "trade_louie_breakout_tests": True,
                "trade_louie_delayed_sweeps": False,
                "min_signal_score": 0.20,
            },
            "只保留突破回测入场，检查突破模块贡献。",
        ),
    ]

    rows = [
        {
            "name": "市场等权持有",
            "source": "外部基准",
            "note": "BTC/ETH/SOL 等权持有，不加杠杆，不择时。",
            "summary": market["summary"],
            "monthly_return": monthly_compound_return(market["summary"]),
            "edge_vs_market": 0.0,
            "status": "基准",
        }
    ]
    for name, source, candidate_params, note in candidates:
        try:
            result = portfolio_backtest(candidate_params)
            summary = result["summary"]
            edge = float(summary.get("return_pct") or 0.0) - market_return
            rows.append(
                {
                    "name": name,
                    "source": source,
                    "note": note,
                    "summary": summary,
                    "monthly_return": monthly_compound_return(summary),
                    "edge_vs_market": edge,
                    "status": "跑赢市场" if edge > 0 else "弱于市场",
                }
            )
        except Exception as exc:
            rows.append(
                {
                    "name": name,
                    "source": source,
                    "note": note,
                    "summary": None,
                    "monthly_return": None,
                    "edge_vs_market": None,
                    "status": "错误",
                    "error": str(exc),
                }
            )

    valid_strategy_rows = [row for row in rows if row.get("summary") and row["name"] != "市场等权持有"]
    best = max(valid_strategy_rows, key=lambda row: row["summary"]["return_pct"], default=None)
    current = next((row for row in rows if row["name"] == "当前价格行为"), None)
    current_rank = None
    if current and current.get("summary"):
        ordered = sorted(valid_strategy_rows, key=lambda row: row["summary"]["return_pct"], reverse=True)
        current_rank = next((index + 1 for index, row in enumerate(ordered) if row["name"] == "当前价格行为"), None)

    verdict = "需要重构"
    if current and current.get("summary"):
        current_edge = float(current.get("edge_vs_market") or 0.0)
        current_return = float(current["summary"].get("return_pct") or 0.0)
        best_return = float(best["summary"].get("return_pct") or 0.0) if best else current_return
        if current_edge > 0 and current_rank == 1:
            verdict = "当前策略领先"
        elif current_edge > 0 and current_return >= best_return * 0.75:
            verdict = "当前策略可保留"
        elif current_edge > 0:
            verdict = "需要吸收对照组"

    return {
        "summary": {
            "verdict": verdict,
            "market_return": market_return,
            "market_monthly_return": monthly_compound_return(market["summary"]),
            "best_name": best["name"] if best else None,
            "best_return": best["summary"]["return_pct"] if best and best.get("summary") else None,
            "current_rank": current_rank,
            "cases": len(rows),
        },
        "rows": rows,
        "market": market,
    }


def trade_r_multiple(trade: dict[str, Any]) -> float | None:
    entry = float(trade.get("entry") or 0.0)
    stop = float(trade.get("stop") or 0.0)
    exit_price = float(trade.get("exit_price") or 0.0)
    risk = abs(entry - stop)
    if risk <= 0:
        return None
    direction = 1 if trade.get("side") == "long" else -1
    return (exit_price - entry) * direction / risk


def trade_group_stats(trades: list[dict[str, Any]], key_name: str) -> list[dict[str, Any]]:
    groups: dict[str, dict[str, Any]] = {}
    for trade in trades:
        key = str(trade.get(key_name) or "-")
        row = groups.setdefault(
            key,
            {
                "key": key,
                "trades": 0,
                "wins": 0,
                "pnl": 0.0,
                "profit": 0.0,
                "loss": 0.0,
                "gross_pnl": 0.0,
                "fees": 0.0,
                "slippage": 0.0,
                "r_total": 0.0,
                "r_count": 0,
            },
        )
        pnl = float(trade.get("pnl") or 0.0)
        row["trades"] += 1
        row["wins"] += 1 if pnl > 0 else 0
        row["pnl"] += pnl
        row["profit"] += max(pnl, 0.0)
        row["loss"] += abs(min(pnl, 0.0))
        row["gross_pnl"] += float(trade.get("gross_pnl") or pnl)
        row["fees"] += float(trade.get("fees") or 0.0)
        row["slippage"] += float(trade.get("slippage") or 0.0)
        r_value = trade_r_multiple(trade)
        if r_value is not None:
            row["r_total"] += r_value
            row["r_count"] += 1

    rows = []
    for row in groups.values():
        loss = float(row["loss"])
        trades = int(row["trades"])
        pnl = float(row["pnl"])
        profit_factor = float(row["profit"]) / loss if loss else None
        win_rate = int(row["wins"]) / trades if trades else 0.0
        avg_r = float(row["r_total"]) / int(row["r_count"]) if row["r_count"] else None
        avg_pnl = pnl / trades if trades else 0.0
        cost = float(row["fees"]) + float(row["slippage"])
        if trades < 5:
            status = "样本少"
            action = "继续观察，暂不按这个维度改参数"
        elif pnl < 0 or (profit_factor is not None and profit_factor < 1.0):
            status = "降权"
            action = "后续扫描优先降低风险系数或增加过滤"
        elif profit_factor is not None and profit_factor >= 1.5 and win_rate >= 0.40:
            status = "核心"
            action = "保留，后续优化围绕它做更严格准入"
        else:
            status = "观察"
            action = "有正贡献但质量一般，继续做滚动验证"
        rows.append(
            {
                "key": row["key"],
                "trades": trades,
                "win_rate": win_rate,
                "pnl": pnl,
                "avg_pnl": avg_pnl,
                "profit_factor": profit_factor,
                "avg_r": avg_r,
                "gross_pnl": float(row["gross_pnl"]),
                "fees": float(row["fees"]),
                "slippage": float(row["slippage"]),
                "cost": cost,
                "status": status,
                "action": action,
            }
        )
    return sorted(rows, key=lambda item: item["pnl"])


def portfolio_attribution(params: dict[str, Any]) -> dict[str, Any]:
    result = portfolio_backtest({**params, "prefer_cache": True, "offline_mode": True})
    trades = result.get("trades", [])
    total_pnl = sum(float(trade.get("pnl") or 0.0) for trade in trades)
    total_cost = sum(float(trade.get("fees") or 0.0) + float(trade.get("slippage") or 0.0) for trade in trades)
    groups = {
        "kind": trade_group_stats(trades, "kind"),
        "symbol": trade_group_stats(trades, "inst_id"),
        "side": trade_group_stats(trades, "side"),
        "exit_reason": trade_group_stats(trades, "exit_reason"),
        "trend": trade_group_stats(trades, "trend"),
        "regime": trade_group_stats(trades, "regime"),
    }

    recommendations = []
    for group_name, rows in groups.items():
        for row in rows:
            if row["status"] in {"降权", "核心"}:
                recommendations.append(
                    {
                        "group": group_name,
                        "key": row["key"],
                        "status": row["status"],
                        "trades": row["trades"],
                        "pnl": row["pnl"],
                        "profit_factor": row["profit_factor"],
                        "win_rate": row["win_rate"],
                        "action": row["action"],
                    }
                )
    recommendations.sort(key=lambda row: (0 if row["status"] == "降权" else 1, row["pnl"]))

    return {
        "summary": {
            **result["summary"],
            "total_pnl": total_pnl,
            "total_cost": total_cost,
            "cost_to_pnl": total_cost / abs(total_pnl) if total_pnl else None,
            "recommendations": len(recommendations),
        },
        "groups": groups,
        "recommendations": recommendations[:12],
        "base_result": result,
    }


def attribution_experiments(params: dict[str, Any]) -> dict[str, Any]:
    base_short_factor = float(params.get("short_trend_risk_factor", 1.0))
    base_breakout_factor = float(params.get("breakout_risk_factor", 0.55))
    candidates = [
        ("当前参数", {}, "保持当前参数，用作对照。"),
        ("空头趋势降权 0.95", {"short_trend_risk_factor": 0.95}, "轻微降低 short trend 环境风险。"),
        ("空头趋势降权 0.85", {"short_trend_risk_factor": 0.85}, "归因显示 short trend 偏弱后的默认候选。"),
        ("空头趋势降权 0.70", {"short_trend_risk_factor": 0.70}, "更强降权，观察回撤是否明显改善。"),
        ("突破测试降权 0.30", {"breakout_risk_factor": 0.30}, "突破测试交易多但平均R偏低，测试更低风险。"),
        ("突破测试降权 0.25", {"breakout_risk_factor": 0.25}, "进一步压低突破测试风险。"),
        (
            "双降权组合",
            {"short_trend_risk_factor": 0.85, "breakout_risk_factor": 0.30},
            "同时处理 short trend 和突破测试两个弱点。",
        ),
    ]
    seen: set[tuple[float, float]] = set()
    rows = []
    for name, overrides, note in candidates:
        run_params = {
            **params,
            "symbols": params.get("symbols") or ["BTC-USDT-SWAP", "ETH-USDT-SWAP", "SOL-USDT-SWAP"],
            "short_trend_risk_factor": float(overrides.get("short_trend_risk_factor", base_short_factor)),
            "breakout_risk_factor": float(overrides.get("breakout_risk_factor", base_breakout_factor)),
            "prefer_cache": True,
            "offline_mode": True,
        }
        key = (run_params["short_trend_risk_factor"], run_params["breakout_risk_factor"])
        if key in seen:
            continue
        seen.add(key)
        try:
            backtest = portfolio_backtest(run_params)
            robustness = portfolio_robustness(
                {
                    **run_params,
                    "robust_window_hours": min(720, float(run_params.get("history_hours", 2160))),
                    "robust_step_hours": 168,
                }
            )
            summary = backtest["summary"]
            robust = robustness["aggregate"]
            monthly = monthly_compound_return(summary)
            rolling_ratio = (
                float(robust.get("rolling_positive_cases") or 0) / float(robust.get("rolling_cases") or 1)
                if robust.get("rolling_cases")
                else 0.0
            )
            score = (
                float(summary.get("return_pct") or 0.0)
                + monthly * 0.35
                + (float(summary.get("profit_factor") or 0.0) - 1.0) * 0.12
                + rolling_ratio * 0.12
                - float(summary.get("max_drawdown") or 0.0) * 1.15
                - max(0.0, -float(robust.get("rolling_worst_return_pct") or 0.0)) * 0.45
            )
            rows.append(
                {
                    "name": name,
                    "params": {
                        "short_trend_risk_factor": run_params["short_trend_risk_factor"],
                        "breakout_risk_factor": run_params["breakout_risk_factor"],
                    },
                    "note": note,
                    "summary": summary,
                    "monthly_return": monthly,
                    "robust": robust,
                    "rolling_ratio": rolling_ratio,
                    "score": score,
                    "status": "通过" if rolling_ratio >= 0.65 and float(summary.get("return_pct") or 0.0) > 0 else "观察",
                }
            )
        except Exception as exc:
            rows.append(
                {
                    "name": name,
                    "params": {
                        "short_trend_risk_factor": run_params["short_trend_risk_factor"],
                        "breakout_risk_factor": run_params["breakout_risk_factor"],
                    },
                    "note": note,
                    "summary": None,
                    "monthly_return": None,
                    "robust": None,
                    "rolling_ratio": None,
                    "score": None,
                    "status": "错误",
                    "error": str(exc),
                }
            )

    valid = [row for row in rows if row.get("summary")]
    valid.sort(key=lambda row: row["score"], reverse=True)
    best = valid[0] if valid else None
    return {
        "summary": {
            "best_name": best["name"] if best else None,
            "best_score": best["score"] if best else None,
            "best_return_pct": best["summary"]["return_pct"] if best else None,
            "best_drawdown": best["summary"]["max_drawdown"] if best else None,
            "cases": len(rows),
        },
        "rows": valid + [row for row in rows if not row.get("summary")],
    }


def compact_portfolio_result(result: dict[str, Any]) -> dict[str, Any]:
    summary = result.get("summary") or {}
    trades = result.get("trades", []) or []
    by_symbol = result.get("by_symbol", []) or []
    return {
        "summary": summary,
        "health": result.get("health") or strategy_health(summary, trades, by_symbol),
        "by_symbol": by_symbol,
        "trades": trades[-50:],
        "equity_curve": result.get("equity_curve", []),
    }


def compact_robustness_result(result: dict[str, Any]) -> dict[str, Any]:
    return {
        "aggregate": result.get("aggregate"),
        "rolling": [
            {
                "case": row.get("case"),
                "window_start": row.get("window_start"),
                "window_end": row.get("window_end"),
                "summary": row.get("summary"),
                "monthly_return": row.get("monthly_return"),
            }
            for row in result.get("rolling", [])
        ],
        "stress": [
            {
                "name": row.get("name"),
                "cost_model": row.get("cost_model"),
                "fee_rate": row.get("fee_rate"),
                "slippage_pct": row.get("slippage_pct"),
                "summary": row.get("summary"),
                "monthly_return": row.get("monthly_return"),
            }
            for row in result.get("stress", [])
        ],
    }


def compact_benchmark_result(result: dict[str, Any]) -> dict[str, Any]:
    return {
        "summary": result.get("summary"),
        "rows": [
            {
                "name": row.get("name"),
                "source": row.get("source"),
                "note": row.get("note"),
                "summary": row.get("summary"),
                "monthly_return": row.get("monthly_return"),
                "edge_vs_market": row.get("edge_vs_market"),
                "status": row.get("status"),
                "error": row.get("error"),
            }
            for row in result.get("rows", [])
        ],
    }


def compact_experiment_result(result: dict[str, Any]) -> dict[str, Any]:
    return {
        "summary": result.get("summary"),
        "rows": [
            {
                "name": row.get("name"),
                "params": row.get("params"),
                "note": row.get("note"),
                "summary": row.get("summary"),
                "monthly_return": row.get("monthly_return"),
                "robust": row.get("robust"),
                "rolling_ratio": row.get("rolling_ratio"),
                "score": row.get("score"),
                "status": row.get("status"),
                "error": row.get("error"),
            }
            for row in result.get("rows", [])
        ],
    }


def compact_readiness_result(result: dict[str, Any]) -> dict[str, Any]:
    return {
        "decision": result.get("decision"),
        "score": result.get("score"),
        "risk_level": result.get("risk_level"),
        "next_action": result.get("next_action"),
        "monthly_return": result.get("monthly_return"),
        "rolling_ratio": result.get("rolling_ratio"),
        "signal_state": result.get("signal_state"),
        "checks": result.get("checks"),
        "monte_carlo": {"summary": (result.get("monte_carlo") or {}).get("summary")},
        "robustness": {"aggregate": ((result.get("robustness") or {}).get("aggregate"))},
    }


def safe_snapshot_label(value: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9._\-\u4e00-\u9fff]+", "-", value.strip())
    return cleaned.strip("-")[:48] or "snapshot"


def hydrate_research_snapshot(payload: dict[str, Any]) -> dict[str, Any]:
    portfolio = payload.get("portfolio")
    if not isinstance(portfolio, dict):
        return payload
    summary = portfolio.get("summary") or {}
    if summary and not portfolio.get("health"):
        portfolio["health"] = strategy_health(summary, portfolio.get("trades", []) or [], portfolio.get("by_symbol", []) or [])
    return payload


def save_research_snapshot(params: dict[str, Any]) -> dict[str, Any]:
    label = safe_snapshot_label(str(params.get("snapshot_label") or "target-mode"))
    snapshot_meta = params.get("snapshot_meta") or {}
    snapshot_mode = str(params.get("snapshot_mode") or "full")
    provided_portfolio = params.get("provided_portfolio")
    strategy_params = {
        key: value
        for key, value in params.items()
        if key not in {"snapshot_label", "snapshot_meta", "snapshot_mode", "provided_portfolio"}
    }
    run_params = {
        **strategy_params,
        "symbols": strategy_params.get("symbols") or ["BTC-USDT-SWAP", "ETH-USDT-SWAP", "SOL-USDT-SWAP"],
        "prefer_cache": True,
        "offline_mode": True,
    }
    created_at = datetime.now(timezone.utc).isoformat()
    is_quick = snapshot_mode == "quick" and isinstance(provided_portfolio, dict)
    portfolio = provided_portfolio if is_quick else portfolio_backtest(run_params)
    if isinstance(portfolio, dict) and portfolio.get("summary") and not portfolio.get("health"):
        portfolio = {
            **portfolio,
            "health": strategy_health(portfolio.get("summary") or {}, portfolio.get("trades", []) or [], portfolio.get("by_symbol", []) or []),
        }
    if is_quick:
        readiness: dict[str, Any] = {
            "decision": "未验证",
            "score": None,
            "notes": ["快速快照只保存当前页面结果，未重新运行 readiness / robustness。"],
        }
        benchmarks: dict[str, Any] = {"summary": {"verdict": "未验证"}}
        experiments: dict[str, Any] = {"summary": {}}
        attribution: dict[str, Any] = {"summary": {"recommendations": None}, "recommendations": []}
    else:
        readiness = readiness_gate(
            {
                **run_params,
                "robust_window_hours": min(720, float(run_params.get("history_hours", 2160))),
                "robust_step_hours": 168,
                "monte_carlo_iterations": int(run_params.get("monte_carlo_iterations", 2000)),
                "monte_carlo_floor_equity": float(run_params.get("initial_equity", 10)) * 0.5,
                "monte_carlo_max_loss_probability": 0.02,
                "monte_carlo_max_p95_drawdown": 0.25,
                "target_monthly_return": 0.20,
                "readiness_min_rolling_ratio": 0.65,
            }
        )
        benchmarks = portfolio_benchmarks(run_params)
        experiments = attribution_experiments(run_params)
        attribution = portfolio_attribution(run_params)

    snapshot = {
        "created_at": created_at,
        "label": label,
        "mode": "quick" if is_quick else "full",
        "meta": {
            **snapshot_meta,
            "validation_level": "quick-page-result" if is_quick else "full-recomputed",
        },
        "settings": run_params,
        "portfolio": compact_portfolio_result(portfolio),
        "readiness": compact_readiness_result(readiness),
        "benchmarks": compact_benchmark_result(benchmarks),
        "attribution_experiments": compact_experiment_result(experiments),
        "attribution": {
            "summary": attribution.get("summary"),
            "recommendations": attribution.get("recommendations", []),
        },
        "cache": cache_status(),
    }
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    path = SNAPSHOT_DIR / f"{stamp}-{label}.json"
    path.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2), encoding="utf-8")
    return {
        "ok": True,
        "created_at": created_at,
        "label": label,
        "mode": "quick" if is_quick else "full",
        "path": str(path),
        "summary": {
            "final_equity": (portfolio.get("summary") or {}).get("final_equity"),
            "return_pct": (portfolio.get("summary") or {}).get("return_pct"),
            "max_drawdown": (portfolio.get("summary") or {}).get("max_drawdown"),
            "trades": (portfolio.get("summary") or {}).get("trades"),
            "profit_factor": (portfolio.get("summary") or {}).get("profit_factor"),
            "health_score": (portfolio.get("health") or {}).get("score"),
            "health_grade": (portfolio.get("health") or {}).get("grade"),
            "readiness_decision": readiness.get("decision"),
            "readiness_score": readiness.get("score"),
            "benchmark_verdict": benchmarks.get("summary", {}).get("verdict"),
            "experiment_best": experiments.get("summary", {}).get("best_name"),
            "experiment_best_return_pct": experiments.get("summary", {}).get("best_return_pct"),
            "attribution_recommendations": attribution.get("summary", {}).get("recommendations"),
        },
    }


def list_research_snapshots(limit: int = 20) -> dict[str, Any]:
    rows = []
    for path in sorted(SNAPSHOT_DIR.glob("*.json"), key=lambda item: item.stat().st_mtime, reverse=True)[:limit]:
        try:
            payload = hydrate_research_snapshot(json.loads(path.read_text(encoding="utf-8")))
            portfolio = payload.get("portfolio") or {}
            portfolio_summary = portfolio.get("summary") or {}
            health = portfolio.get("health") or {}
            readiness = payload.get("readiness") or {}
            experiments = payload.get("attribution_experiments") or {}
            rows.append(
                {
                    "file": path.name,
                    "path": str(path),
                    "created_at": payload.get("created_at"),
                    "label": payload.get("label"),
                    "mode": payload.get("mode", "full"),
                    "final_equity": portfolio_summary.get("final_equity"),
                    "return_pct": portfolio_summary.get("return_pct"),
                    "max_drawdown": portfolio_summary.get("max_drawdown"),
                    "trades": portfolio_summary.get("trades"),
                    "win_rate": portfolio_summary.get("win_rate"),
                    "profit_factor": portfolio_summary.get("profit_factor"),
                    "health_score": health.get("score"),
                    "health_grade": health.get("grade"),
                    "readiness_decision": readiness.get("decision"),
                    "readiness_score": readiness.get("score"),
                    "experiment_best": (experiments.get("summary") or {}).get("best_name"),
                }
            )
        except Exception as exc:
            rows.append({"file": path.name, "path": str(path), "error": str(exc)})
    return {"dir": str(SNAPSHOT_DIR), "rows": rows}


def readiness_gate(params: dict[str, Any]) -> dict[str, Any]:
    run_params = {
        **params,
        "symbols": params.get("symbols") or ["BTC-USDT-SWAP", "ETH-USDT-SWAP", "SOL-USDT-SWAP"],
        "robust_window_hours": float(params.get("robust_window_hours", min(720, float(params.get("history_hours", 2160))))),
        "robust_step_hours": float(params.get("robust_step_hours", 168)),
        "monte_carlo_iterations": int(params.get("monte_carlo_iterations", 2000)),
        "monte_carlo_floor_equity": float(params.get("monte_carlo_floor_equity", float(params.get("initial_equity", 10)) * 0.5)),
        "prefer_cache": True,
        "offline_mode": True,
    }
    robustness = portfolio_robustness({**run_params, "include_base_result": True})
    monte_carlo = monte_carlo_portfolio(run_params)
    signal = signal_scan({**run_params, "record_scan": False, "scan_history_hours": min(float(run_params.get("history_hours", 2160)), 240)})

    base = robustness["base"]
    robust_aggregate = robustness["aggregate"]
    mc_summary = monte_carlo["summary"]
    signal_summary = signal.get("summary", {})
    initial_equity = float(base.get("initial_equity") or run_params.get("initial_equity", 10))
    target_monthly_return = float(run_params.get("target_monthly_return", 0.20))
    min_rolling_ratio = float(run_params.get("readiness_min_rolling_ratio", 0.65))
    max_base_drawdown = min(float(run_params.get("max_account_drawdown_pct", 0.30)), 0.30)
    max_p95_drawdown = float(run_params.get("monte_carlo_max_p95_drawdown", 0.25))
    max_loss_probability = float(run_params.get("monte_carlo_max_loss_probability", 0.02))
    rolling_cases = int(robust_aggregate.get("rolling_cases") or 0)
    rolling_ratio = (float(robust_aggregate.get("rolling_positive_cases") or 0) / rolling_cases) if rolling_cases else 0.0
    monthly_return = monthly_compound_return(base)

    def check(name: str, value: Any, threshold: str, passed: bool, weight: int, action: str, severity: str = "fail") -> dict[str, Any]:
        return {
            "name": name,
            "value": value,
            "threshold": threshold,
            "passed": bool(passed),
            "weight": weight,
            "action": action,
            "severity": severity,
            "status": "pass" if passed else severity,
        }

    checks = [
        check("月收益目标", monthly_return, f">= {target_monthly_return:.0%}", monthly_return >= target_monthly_return, 14, "达标才允许继续用 10U 激进模型"),
        check("组合回撤", float(base.get("max_drawdown") or 0), f"<= {max_base_drawdown:.0%}", float(base.get("max_drawdown") or 0) <= max_base_drawdown, 12, "超限则先降风险或暂停"),
        check("样本交易数", int(base.get("trades") or 0), ">= 30", int(base.get("trades") or 0) >= 30, 8, "样本太少时不放大杠杆"),
        check("盈利因子", float(base.get("profit_factor") or 0), ">= 1.40", float(base.get("profit_factor") or 0) >= 1.4, 8, "低于门槛说明赔率不足"),
        check("滚动窗口通过率", rolling_ratio, f">= {min_rolling_ratio:.0%}", rolling_ratio >= min_rolling_ratio, 12, "低于门槛说明对市场阶段敏感"),
        check("最差滚动窗口", float(robust_aggregate.get("rolling_worst_return_pct") or 0), ">= -15%", float(robust_aggregate.get("rolling_worst_return_pct") or 0) >= -0.15, 10, "最差 30 天不能伤到账户结构"),
        check("成本压力收益", float(robust_aggregate.get("stress_worst_return_pct") or 0), "> 0%", float(robust_aggregate.get("stress_worst_return_pct") or 0) > 0, 10, "全 Taker/高滑点下也要保持正收益"),
        check("蒙特卡洛结论", mc_summary.get("verdict"), "通过", mc_summary.get("verdict") == "通过", 12, "随机交易顺序压力不过关就不启动"),
        check("亏损路径概率", float(mc_summary.get("loss_probability") or 0), f"<= {max_loss_probability:.0%}", float(mc_summary.get("loss_probability") or 0) <= max_loss_probability, 6, "高于门槛时说明尾部风险偏厚"),
        check("P95 最大回撤", float(mc_summary.get("p95_max_drawdown") or 0), f"<= {max_p95_drawdown:.0%}", float(mc_summary.get("p95_max_drawdown") or 0) <= max_p95_drawdown, 6, "回撤尾部必须受控"),
        check("P5 最终权益", float(mc_summary.get("p05_final_equity") or 0), f">= {initial_equity:.2f}U", float(mc_summary.get("p05_final_equity") or 0) >= initial_equity, 2, "悲观路径不能低于本金"),
    ]

    hard_fails = [row for row in checks if not row["passed"] and row["severity"] == "fail"]
    score = sum(row["weight"] for row in checks if row["passed"])
    ready_signals = int(signal_summary.get("ready") or 0)
    watch_signals = int(signal_summary.get("watch") or 0)
    signal_errors = int(signal_summary.get("errors") or 0)
    if hard_fails:
        decision = "暂停模拟"
        risk_level = "高"
        next_action = "先修复失败项，再启动模拟盘。"
    elif signal_errors:
        decision = "暂停模拟"
        risk_level = "中"
        next_action = "当前信号扫描有错误，先确认数据缓存和网络。"
    elif ready_signals > 0:
        decision = "允许模拟"
        risk_level = "中"
        next_action = "准入通过，当前已有候选信号，模拟盘可按规则接管。"
    else:
        decision = "允许模拟，等待信号"
        risk_level = "中低"
        next_action = "准入通过，但当前没有可交易信号，继续扫描等待。"

    return {
        "decision": decision,
        "score": score,
        "risk_level": risk_level,
        "next_action": next_action,
        "monthly_return": monthly_return,
        "rolling_ratio": rolling_ratio,
        "signal_state": {
            "ready": ready_signals,
            "watch": watch_signals,
            "blocked": int(signal_summary.get("blocked") or 0),
            "errors": signal_errors,
        },
        "checks": checks,
        "base_result": robustness.get("base_result"),
        "robustness": robustness,
        "monte_carlo": monte_carlo,
        "signal_scan": signal,
        "cache": cache_status(),
    }


def validate_markets(params: dict[str, Any]) -> dict[str, Any]:
    symbols = params.get("symbols") or ["BTC-USDT-SWAP", "ETH-USDT-SWAP", "SOL-USDT-SWAP"]
    windows = params.get("windows") or [168, 720]
    results = []
    for inst_id in symbols:
        for hours in windows:
            candidate = {**params, "history_hours": float(hours)}
            try:
                result = run_backtest_for_market(inst_id, candidate)
                summary = result["summary"]
                score = summary["return_pct"] - summary["max_drawdown"] * 0.75 - max(0, 5 - summary["trades"]) * 0.02
                results.append(
                    {
                        "inst_id": inst_id,
                        "history_hours": float(hours),
                        "score": score,
                        "summary": summary,
                        "error": None,
                    }
                )
            except Exception as exc:
                results.append(
                    {
                        "inst_id": inst_id,
                        "history_hours": float(hours),
                        "score": None,
                        "summary": None,
                        "error": str(exc),
                    }
                )
    valid = [row for row in results if row["summary"]]
    aggregate = {
        "cases": len(valid),
        "positive_cases": sum(1 for row in valid if row["summary"]["return_pct"] > 0),
        "total_trades": sum(row["summary"]["trades"] for row in valid),
        "avg_return_pct": sum(row["summary"]["return_pct"] for row in valid) / len(valid) if valid else 0,
        "worst_drawdown": max((row["summary"]["max_drawdown"] for row in valid), default=0),
        "avg_score": sum(row["score"] for row in valid if row["score"] is not None) / len(valid) if valid else 0,
    }
    return {"aggregate": aggregate, "results": results}


def validate_time_slices(params: dict[str, Any]) -> dict[str, Any]:
    symbols = params.get("symbols") or ["BTC-USDT-SWAP", "ETH-USDT-SWAP", "SOL-USDT-SWAP"]
    total_hours = float(params.get("history_hours", 2160))
    slice_hours = float(params.get("slice_hours", 720))
    if slice_hours <= 0 or total_hours < slice_hours:
        raise ValueError("slice_hours must be positive and no larger than history_hours")

    base_params = {**params, "history_hours": total_hours}
    datasets = []
    for inst_id in symbols:
        candles = fetch_backtest_candles(inst_id, base_params.get("bar", "1H"), base_params)
        trend_by_ts = None
        if uses_trend_context(base_params.get("strategy_mode", "trend_price_action")):
            trend_candles = fetch_trend_candles(inst_id, base_params.get("trend_bar", "1H"), base_params)
            trend_by_ts = build_trend_context(trend_candles, base_params)
        datasets.append({"inst_id": inst_id, "candles": candles, "trend_by_ts": trend_by_ts})

    latest_ts = min(dataset["candles"][-1]["ts"] for dataset in datasets if dataset["candles"])
    slice_ms = int(slice_hours * 60 * 60 * 1000)
    total_ms = int(total_hours * 60 * 60 * 1000)
    first_end_ts = latest_ts - total_ms + slice_ms
    slice_ends = []
    end_ts = first_end_ts
    while end_ts <= latest_ts:
        slice_ends.append(end_ts)
        end_ts += slice_ms

    results = []
    for slice_index, end_ts in enumerate(slice_ends, start=1):
        start_ts = end_ts - slice_ms
        for dataset in datasets:
            run_params = {
                **base_params,
                "history_hours": slice_hours,
                "window_end_ts": end_ts,
            }
            result = run_backtest(dataset["candles"], run_params, dataset["trend_by_ts"])
            summary = result["summary"]
            results.append(
                {
                    "slice": slice_index,
                    "slice_hours": slice_hours,
                    "inst_id": dataset["inst_id"],
                    "window_start": utc_ms_to_iso(start_ts),
                    "window_end": utc_ms_to_iso(end_ts),
                    "summary": summary,
                }
            )

    aggregate = {
        "cases": len(results),
        "positive_cases": sum(1 for row in results if row["summary"]["return_pct"] > 0),
        "total_trades": sum(row["summary"]["trades"] for row in results),
        "avg_return_pct": sum(row["summary"]["return_pct"] for row in results) / len(results) if results else 0,
        "worst_return_pct": min((row["summary"]["return_pct"] for row in results), default=0),
        "worst_drawdown": max((row["summary"]["max_drawdown"] for row in results), default=0),
        "empty_cases": sum(1 for row in results if row["summary"]["trades"] == 0),
    }
    return {"aggregate": aggregate, "results": results}


def cache_status() -> dict[str, Any]:
    status = MARKET_DATA.status()
    rows = [annotate_cache_refresh_priority(row) for row in status.get("rows", [])]
    return {
        **status,
        "rows": rows,
        "portfolio_result_cache": PORTFOLIO_RESULT_CACHE.status(),
    }


def compact_cache_plan() -> list[dict[str, Any]]:
    rows = cache_status().get("rows", [])
    plan: list[dict[str, Any]] = []
    for row in rows:
        if not row.get("covered_by_fresh_cache") or not row.get("is_stale"):
            continue
        inst_id = str(row.get("inst_id") or "")
        bar = str(row.get("bar") or "")
        count = int(row.get("count") or row.get("candles") or 0)
        covered_by_count = int(row.get("covered_by_count") or 0)
        if not inst_id or not bar or count <= 0 or covered_by_count < count:
            continue
        path = MARKET_DATA.candle_cache_file(inst_id, bar, count)
        if not path.exists() or not path.resolve().is_relative_to(CACHE_DIR.resolve()):
            continue
        plan.append(
            {
                "inst_id": inst_id,
                "bar": bar,
                "count": count,
                "covered_by_count": covered_by_count,
                "path": str(path),
                "size_bytes": path.stat().st_size,
                "coverage_note": row.get("coverage_note"),
            }
        )
    plan.sort(key=lambda item: (item["inst_id"], item["bar"], item["count"]))
    return plan


def compact_covered_candle_cache(params: dict[str, Any] | None = None) -> dict[str, Any]:
    params = params or {}
    dry_run = bool(params.get("dry_run", True))
    task_id = params.get("task_id")
    plan = compact_cache_plan()
    max_items = int(params.get("max_items") or len(plan) or 0)
    if max_items > 0:
        plan = plan[:max_items]
    total_bytes = sum(int(row.get("size_bytes") or 0) for row in plan)
    deleted: list[dict[str, Any]] = []
    skipped: list[dict[str, Any]] = []
    update_task(task_id, progress={"completed": 0, "total": len(plan)}) if task_id else None

    if not dry_run:
        for index, row in enumerate(plan, start=1):
            if task_cancel_requested(task_id):
                skipped.extend(plan[index - 1 :])
                break
            try:
                deleted.append(MARKET_DATA.delete_candle_cache(row["inst_id"], row["bar"], int(row["count"])) | row)
            except Exception as exc:
                skipped.append({**row, "error": str(exc)})
            if task_id:
                update_task(task_id, progress={"completed": index, "total": len(plan), "deleted": len(deleted), "skipped": len(skipped)})
    elif task_id:
        update_task(task_id, progress={"completed": len(plan), "total": len(plan), "deleted": 0, "skipped": 0})

    return {
        "dry_run": dry_run,
        "candidates": plan,
        "candidate_count": len(plan),
        "bytes": total_bytes,
        "kb": round(total_bytes / 1024, 1),
        "deleted": deleted,
        "deleted_count": len(deleted),
        "skipped": skipped,
        "skipped_count": len(skipped),
        "cache": cache_status() if not dry_run else None,
    }


def annotate_cache_refresh_priority(row: dict[str, Any]) -> dict[str, Any]:
    inst_id = str(row.get("inst_id") or "")
    bar = str(row.get("bar") or "")
    count = int(row.get("count") or row.get("candles") or 0)
    is_stale = bool(row.get("is_stale"))
    is_covered = bool(row.get("covered_by_fresh_cache"))
    age_seconds = float(row.get("latest_closed_age_seconds") or 0.0)
    stale_after_seconds = float(row.get("stale_after_seconds") or 0.0)
    estimated_requests = 1 if count <= 300 else 1 + max(0, math.ceil((count - 300) / 100))
    symbols = {"BTC-USDT-SWAP", "ETH-USDT-SWAP", "SOL-USDT-SWAP"}
    reasons: list[str] = []
    priority = 0
    if is_stale:
        priority += 40
        reasons.append("缓存陈旧")
    if is_covered:
        priority = 8
        reasons = [row.get("coverage_note") or "可由大缓存覆盖"]
        return {
            **row,
            "refresh_priority": priority,
            "refresh_reasons": reasons[:4],
            "recommended_refresh": False,
            "refresh_estimated_requests": estimated_requests,
            "refresh_cost_label": "覆盖复用",
            "stale_after_minutes": round(stale_after_seconds / 60, 1) if stale_after_seconds else None,
        }
    if inst_id in symbols:
        priority += 18
        reasons.append("组合品种")
    if bar in {"15m", "1H"}:
        priority += 16
        reasons.append("策略周期")
    elif bar in {"5m", "4H"}:
        priority += 6
    if count <= 400:
        priority += 12
        reasons.append("刷新成本低")
    elif count <= 1200:
        priority += 6
    elif count >= 5000:
        priority -= 8
        reasons.append("历史窗口较大")
    if age_seconds >= 7 * 24 * 3600:
        priority += 10
        reasons.append("超过7天")
    elif age_seconds >= 24 * 3600:
        priority += 5
    if not is_stale:
        priority = 0
        reasons = ["已新鲜"]
    return {
        **row,
        "refresh_priority": max(0, priority),
        "refresh_reasons": reasons[:4],
        "recommended_refresh": is_stale and priority >= 60,
        "refresh_estimated_requests": estimated_requests,
        "refresh_cost_label": f"约 {estimated_requests} 次请求",
        "stale_after_minutes": round(stale_after_seconds / 60, 1) if stale_after_seconds else None,
    }


def warmup_data(params: dict[str, Any]) -> dict[str, Any]:
    symbols = params.get("symbols") or ["BTC-USDT-SWAP", "ETH-USDT-SWAP", "SOL-USDT-SWAP"]
    windows = params.get("windows") or [float(params.get("history_hours", 24))]
    bar = params.get("bar", "15m")
    trend_bar = params.get("trend_bar", "1H")
    previous_prefer_cache = params.get("prefer_cache", False)
    previous_offline_mode = params.get("offline_mode", False)
    results = []

    for inst_id in symbols:
        for hours in windows:
            run_params = {
                **params,
                "history_hours": float(hours),
                "prefer_cache": False,
                "offline_mode": False,
            }
            try:
                candles = fetch_backtest_candles(inst_id, bar, run_params)
                trend_candles = fetch_trend_candles(inst_id, trend_bar, run_params)
                results.append(
                    {
                        "inst_id": inst_id,
                        "history_hours": float(hours),
                        "bar": bar,
                        "trend_bar": trend_bar,
                        "candles": len(candles),
                        "trend_candles": len(trend_candles),
                        "last": candles[-1]["time"] if candles else None,
                        "error": None,
                    }
                )
            except Exception as exc:
                results.append(
                    {
                        "inst_id": inst_id,
                        "history_hours": float(hours),
                        "bar": bar,
                        "trend_bar": trend_bar,
                        "candles": 0,
                        "trend_candles": 0,
                        "last": None,
                        "error": str(exc),
                    }
                )

    params["prefer_cache"] = previous_prefer_cache
    params["offline_mode"] = previous_offline_mode
    ok_rows = [row for row in results if not row["error"]]
    return {
        "ok": len(ok_rows),
        "failed": len(results) - len(ok_rows),
        "results": results,
        "cache": cache_status(),
    }


def refresh_candle_cache_row(row: dict[str, Any]) -> dict[str, Any]:
    inst_id = str(row.get("inst_id") or row.get("instId") or "")
    bar = str(row.get("bar") or "")
    count = int(row.get("count") or row.get("candles") or 0)
    if not inst_id or not bar or count <= 0:
        raise ValueError("inst_id, bar and count are required")
    candles = fetch_historical_candles(inst_id, bar, count, prefer_cache=False, offline_mode=False)
    meta = last_candle_fetch(inst_id, bar, count) or {}
    return {
        "inst_id": inst_id,
        "bar": bar,
        "count": count,
        "candles": len(candles),
        "latest_closed": meta.get("latest_closed") or (candles[-1].get("time") if candles else None),
        "is_stale": meta.get("is_stale"),
        "source": meta.get("source"),
        "error": None,
    }


def refresh_candle_cache(params: dict[str, Any]) -> dict[str, Any]:
    rows = params.get("rows")
    if rows is None:
        rows = [params]
    if not isinstance(rows, list):
        raise ValueError("rows must be a list")
    max_items = max(1, min(int(params.get("max_items", 6)), 12))
    targets = rows[:max_items]
    batch_id = f"refresh-{int(time.time() * 1000)}"
    mode = str(params.get("mode") or "manual")
    task_id = params.get("task_id")
    set_data_refresh_progress(
        active=True,
        batch_id=batch_id,
        mode=mode,
        total=len(targets),
        completed=0,
        ok=0,
        failed=0,
        current=None,
        started_at=datetime.now(timezone.utc).isoformat(),
    )
    if task_id:
        update_task(task_id, progress={"completed": 0, "total": len(targets), "ok": 0, "failed": 0})
    results = []
    ok_count = 0
    failed_count = 0
    for index, row in enumerate(targets):
        if task_cancel_requested(task_id):
            break
        current = {
            "index": index + 1,
            "inst_id": row.get("inst_id") or row.get("instId"),
            "bar": row.get("bar"),
            "count": row.get("count") or row.get("candles"),
        }
        set_data_refresh_progress(current=current)
        if task_id:
            update_task(task_id, progress={"completed": index, "total": len(targets), "ok": ok_count, "failed": failed_count, "current": current})
        try:
            result = refresh_candle_cache_row(row)
            results.append({**result, "index": index + 1})
            ok_count += 1
            time.sleep(0.08)
        except Exception as exc:
            results.append(
                {
                    "index": index + 1,
                    "inst_id": row.get("inst_id") or row.get("instId"),
                    "bar": row.get("bar"),
                    "count": row.get("count") or row.get("candles"),
                    "candles": 0,
                    "latest_closed": None,
                    "is_stale": True,
                    "source": None,
                    "error": str(exc),
                }
            )
            failed_count += 1
        set_data_refresh_progress(completed=index + 1, ok=ok_count, failed=failed_count)
        if task_id:
            update_task(task_id, progress={"completed": index + 1, "total": len(targets), "ok": ok_count, "failed": failed_count})
    set_data_refresh_progress(active=False, current=None, completed=len(results), ok=ok_count, failed=failed_count)
    return {
        "batch_id": batch_id,
        "mode": mode,
        "ok": ok_count,
        "failed": failed_count,
        "results": results,
        "progress": data_refresh_progress(),
        "cache": cache_status(),
    }


def refresh_stale_candle_cache(params: dict[str, Any]) -> dict[str, Any]:
    max_items = max(1, min(int(params.get("max_items", 4)), 12))
    recommended_only = bool(params.get("recommended_only", False))
    status = cache_status()
    stale_rows = [row for row in status.get("rows", []) if row.get("is_stale")]
    skipped_covered_rows = [row for row in stale_rows if row.get("covered_by_fresh_cache")]
    stale_rows = [row for row in stale_rows if not row.get("covered_by_fresh_cache")]
    if recommended_only:
        stale_rows = [row for row in stale_rows if row.get("recommended_refresh")]
    stale_rows.sort(key=lambda row: (-int(row.get("refresh_priority") or 0), int(row.get("count") or row.get("candles") or 0)))
    result = refresh_candle_cache({"rows": stale_rows, "max_items": max_items, "mode": "recommended" if recommended_only else "stale", "task_id": params.get("task_id")})
    result["skipped_covered"] = len(skipped_covered_rows)
    result["skipped_covered_rows"] = skipped_covered_rows[:12]
    return result


class TelegramPreviewParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.messages: list[dict[str, Any]] = []
        self.current: dict[str, Any] | None = None
        self.message_depth = 0
        self.in_text = False
        self.in_time = False
        self.text_parts: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        data = {key: value or "" for key, value in attrs}
        classes = data.get("class", "")
        if tag == "div" and "tgme_widget_message" in classes and data.get("data-post"):
            self.current = {"id": data.get("data-post"), "text": "", "time": "", "datetime": ""}
            self.message_depth = 1
            return
        if self.current:
            if tag == "div":
                self.message_depth += 1
            if tag == "div" and "tgme_widget_message_text" in classes:
                self.in_text = True
                self.text_parts = []
            if tag == "time":
                self.in_time = True
                self.current["datetime"] = data.get("datetime", "")
            if self.in_text and tag == "br":
                self.text_parts.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if not self.current:
            return
        if tag == "time":
            self.in_time = False
        if tag == "div" and self.in_text:
            self.current["text"] = normalize_message_text("".join(self.text_parts))
            self.in_text = False
            self.text_parts = []
            return
        if tag == "div":
            self.message_depth -= 1
            if self.message_depth <= 0:
                if self.current.get("text"):
                    self.messages.append(self.current)
                self.current = None

    def handle_data(self, data: str) -> None:
        if self.current and self.in_text:
            self.text_parts.append(data)
        if self.current and self.in_time:
            self.current["time"] += data


def normalize_message_text(text: str) -> str:
    lines = [re.sub(r"\s+", " ", line).strip() for line in text.replace("\r", "\n").split("\n")]
    return "\n".join(line for line in lines if line)


def fetch_telegram_preview(channel: str = "colin112") -> list[dict[str, Any]]:
    channel = re.sub(r"[^A-Za-z0-9_]", "", channel.strip().removeprefix("@")) or "colin112"
    url = f"https://t.me/s/{channel}"
    req = urllib.request.Request(url, headers={"User-Agent": "okx-perp-bot/0.1"})
    last_error: Exception | None = None
    for opener in [PROXY_OPENER, DIRECT_OPENER]:
        try:
            with opener.open(req, timeout=20) as response:
                html = response.read().decode("utf-8", "ignore")
            parser = TelegramPreviewParser()
            parser.feed(html)
            return parser.messages
        except (urllib.error.URLError, TimeoutError, socket.timeout, http.client.IncompleteRead, http.client.RemoteDisconnected) as exc:
            last_error = exc
    raise RuntimeError(f"Telegram preview fetch failed: {last_error}")


def extract_prices(text: str) -> list[float]:
    return [float(item) for item in re.findall(r"(?<![A-Za-z])(?:\d+\.\d+|\d+)(?![A-Za-z])", text)]


def price_lines(text: str, keywords: tuple[str, ...]) -> str:
    return "\n".join(line for line in text.splitlines() if any(keyword in line for keyword in keywords))


def prices_after_keywords(text: str, keywords: tuple[str, ...], until_keywords: tuple[str, ...] = ()) -> list[float]:
    prices: list[float] = []
    for keyword in keywords:
        for match in re.finditer(re.escape(keyword), text, re.I):
            segment = text[match.end() :]
            cut_points = [pos for marker in until_keywords for pos in [segment.lower().find(marker.lower())] if pos >= 0]
            if cut_points:
                segment = segment[: min(cut_points)]
            prices.extend(extract_prices(segment))
    return prices


def infer_signal_side(text: str) -> str | None:
    if re.search(r"(做空|市价空|市價空|分批空|空单|空單|#\w+.*空)", text, re.I):
        return "short"
    if re.search(r"(做多|市价多|市價多|分批多|多单|多單|#\w+.*多)", text, re.I):
        return "long"
    return None


def parse_telegram_signal(message: dict[str, Any]) -> dict[str, Any]:
    text = message.get("text", "")
    symbol_match = re.search(r"#([A-Za-z0-9_]+)", text)
    symbol = symbol_match.group(1).upper() if symbol_match else None
    side = infer_signal_side(text)
    take_profits = prices_after_keywords(text, ("止盈", "目標", "目标", "TP", "tp"), ("止損", "止损", "SL", "sl"))
    stops = prices_after_keywords(text, ("止損", "止损", "SL", "sl"))
    entry_text = text
    for marker in ("止盈", "目標", "目标", "止損", "止损", "TP", "tp", "SL", "sl"):
        if marker in entry_text:
            entry_text = entry_text.split(marker, 1)[0]
    entry_prices = extract_prices(entry_text)
    stop = stops[0] if stops else None
    entry = sum(entry_prices) / len(entry_prices) if entry_prices else None

    rr_values: list[float] = []
    stop_pct = None
    if side and entry and stop:
        risk = (entry - stop) if side == "long" else (stop - entry)
        if risk > 0:
            stop_pct = risk / entry
            for target in take_profits:
                reward = (target - entry) if side == "long" else (entry - target)
                if reward > 0:
                    rr_values.append(reward / risk)

    actionable = bool(side and symbol and (entry_prices or take_profits or stops))
    return {
        "id": message.get("id"),
        "datetime": message.get("datetime"),
        "time": message.get("time"),
        "symbol": symbol,
        "side": side,
        "entry_prices": entry_prices[:4],
        "entry": entry,
        "take_profits": take_profits[:6],
        "stop": stop,
        "stop_pct": stop_pct,
        "rr_values": rr_values[:6],
        "tp_count": len(take_profits),
        "uses_market": "市价" in text or "市價" in text,
        "uses_scale_in": "补仓" in text or "補倉" in text or "分批" in text,
        "actionable": actionable,
        "snippet": text[:140],
    }


def telegram_strategy_report(params: dict[str, Any]) -> dict[str, Any]:
    channel = params.get("channel", "colin112")
    messages = fetch_telegram_preview(channel)
    parsed = [parse_telegram_signal(message) for message in messages]
    signals = [item for item in parsed if item["actionable"]]
    longs = [item for item in signals if item["side"] == "long"]
    shorts = [item for item in signals if item["side"] == "short"]
    rr1 = [item["rr_values"][0] for item in signals if item["rr_values"]]
    stop_pcts = [item["stop_pct"] for item in signals if item["stop_pct"] is not None]
    tp_counts = [item["tp_count"] for item in signals if item["tp_count"]]
    by_symbol: dict[str, int] = {}
    for item in signals:
        by_symbol[item["symbol"]] = by_symbol.get(item["symbol"], 0) + 1
    top_symbols = sorted(by_symbol.items(), key=lambda item: item[1], reverse=True)[:10]
    return {
        "channel": channel,
        "source_url": f"https://t.me/s/{channel}",
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        "messages": len(messages),
        "signals": len(signals),
        "summary": {
            "longs": len(longs),
            "shorts": len(shorts),
            "market_entries": sum(1 for item in signals if item["uses_market"]),
            "scale_ins": sum(1 for item in signals if item["uses_scale_in"]),
            "avg_stop_pct": sum(stop_pcts) / len(stop_pcts) if stop_pcts else None,
            "avg_tp1_rr": sum(rr1) / len(rr1) if rr1 else None,
            "avg_tp_count": sum(tp_counts) / len(tp_counts) if tp_counts else None,
            "top_symbols": top_symbols,
        },
        "signals_rows": signals[:50],
        "raw_rows": parsed[:50],
    }


@dataclass
class PaperState:
    running: bool = False
    inst_id: str = "BTC-USDT-SWAP"
    bar: str = "1H"
    equity: float = 10.0
    peak_equity: float = 10.0
    day_start_equity: float = 10.0
    day_key: str | None = None
    day_trades: int = 0
    consecutive_losses: int = 0
    circuit_breaker: dict[str, Any] = field(default_factory=dict)
    position: dict[str, Any] | None = None
    trades: list[dict[str, Any]] | None = None
    last_signal: dict[str, Any] | None = None
    signal_log: list[dict[str, Any]] = field(default_factory=list)
    last_signal_log_key: str | None = None
    strategy_mode: str = "louie_price_action"
    params: dict[str, Any] = field(default_factory=dict)
    last_error: str | None = None
    updated_at: str | None = None


def paper_runtime_params(params: dict[str, Any]) -> dict[str, Any]:
    return {**params, "prefer_cache": False, "offline_mode": False}


def paper_state_payload(state: PaperState) -> dict[str, Any]:
    return {
        "running": state.running,
        "inst_id": state.inst_id,
        "bar": state.bar,
        "equity": state.equity,
        "peak_equity": state.peak_equity,
        "day_start_equity": state.day_start_equity,
        "day_key": state.day_key,
        "day_trades": state.day_trades,
        "consecutive_losses": state.consecutive_losses,
        "circuit_breaker": state.circuit_breaker,
        "position": state.position,
        "trades": state.trades or [],
        "last_signal": state.last_signal,
        "signal_log": state.signal_log,
        "last_signal_log_key": state.last_signal_log_key,
        "strategy_mode": state.strategy_mode,
        "params": paper_runtime_params(state.params),
        "last_error": state.last_error,
        "updated_at": state.updated_at,
        "persisted_at": datetime.now(timezone.utc).isoformat(),
        "state_file": str(PAPER_STATE_FILE),
    }


def load_paper_state() -> PaperState:
    if not PAPER_STATE_FILE.exists():
        return PaperState(trades=[])
    try:
        payload = json.loads(PAPER_STATE_FILE.read_text(encoding="utf-8"))
        state = PaperState(trades=[])
        for key in PaperState.__dataclass_fields__:
            if key in payload:
                setattr(state, key, payload[key])
        state.trades = state.trades or []
        state.signal_log = state.signal_log or []
        state.params = paper_runtime_params(state.params)
        return state
    except Exception as exc:
        append_paper_event("restore_error", {"error": str(exc)})
        return PaperState(trades=[])


def save_paper_state(state: PaperState) -> None:
    PAPER_STATE_FILE.write_text(json.dumps(paper_state_payload(state), ensure_ascii=False, indent=2), encoding="utf-8")


def append_paper_event(event: str, payload: dict[str, Any] | None = None) -> None:
    row = {
        "time": datetime.now(timezone.utc).isoformat(),
        "event": event,
        "payload": payload or {},
    }
    with PAPER_EVENT_LOCK:
        with PAPER_EVENT_FILE.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(row, ensure_ascii=False) + "\n")


def read_paper_events(limit: int = 100) -> dict[str, Any]:
    if not PAPER_EVENT_FILE.exists():
        return {"path": str(PAPER_EVENT_FILE), "rows": []}
    rows = []
    with PAPER_EVENT_LOCK:
        lines = PAPER_EVENT_FILE.read_text(encoding="utf-8").splitlines()[-limit:]
    for line in lines:
        try:
            rows.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return {"path": str(PAPER_EVENT_FILE), "rows": list(reversed(rows))}


def audit_number(value: Any, digits: int = 8) -> Any:
    if value is None:
        return None
    try:
        return round(float(value), digits)
    except (TypeError, ValueError):
        return value


def paper_scan_signature(scan: dict[str, Any] | None) -> dict[str, Any]:
    scan = scan or {}
    signal = scan.get("signal") or {}
    position = scan.get("position") or {}
    context = scan.get("context") or {}
    return {
        "status": scan.get("status"),
        "decision": scan.get("decision"),
        "reasons": scan.get("reasons") or [],
        "context_time": context.get("time"),
        "context_ts": context.get("ts"),
        "context_close": audit_number(context.get("close")),
        "trend": context.get("trend"),
        "regime": context.get("regime"),
        "signal_side": signal.get("side"),
        "signal_kind": signal.get("kind"),
        "score": audit_number(scan.get("score") if scan.get("score") is not None else signal.get("score"), 6),
        "entry": audit_number(position.get("entry") if position else signal.get("entry")),
        "stop": audit_number(position.get("stop") if position else signal.get("stop")),
        "take_profit": audit_number(position.get("take_profit") if position else signal.get("take_profit")),
        "leverage": audit_number(position.get("leverage") if position else signal.get("leverage"), 4),
        "notional": audit_number(position.get("notional") if position else signal.get("notional"), 4),
    }


def compact_paper_scan(scan: dict[str, Any] | None) -> dict[str, Any]:
    scan = scan or {}
    return {
        "inst_id": scan.get("inst_id"),
        "status": scan.get("status"),
        "decision": scan.get("decision"),
        "reasons": scan.get("reasons") or [],
        "context": scan.get("context") or {},
        "signal": scan.get("signal"),
        "position": scan.get("position"),
        "score": scan.get("score"),
        "risk": scan.get("risk"),
        "data": scan.get("data"),
        "updated_at": scan.get("updated_at"),
        "signature": paper_scan_signature(scan),
    }


def append_paper_audit(row: dict[str, Any]) -> None:
    entry = {
        "time": datetime.now(timezone.utc).isoformat(),
        **row,
    }
    with PAPER_AUDIT_LOCK:
        with PAPER_AUDIT_FILE.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(entry, ensure_ascii=False) + "\n")


def read_paper_audit(limit: int = 100) -> dict[str, Any]:
    if not PAPER_AUDIT_FILE.exists():
        return {"path": str(PAPER_AUDIT_FILE), "rows": []}
    rows = []
    with PAPER_AUDIT_LOCK:
        lines = PAPER_AUDIT_FILE.read_text(encoding="utf-8").splitlines()[-max(1, min(limit, 1000)) :]
    for line in lines:
        try:
            rows.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return {"path": str(PAPER_AUDIT_FILE), "rows": list(reversed(rows))}


def signature_diffs(recorded: dict[str, Any], replay: dict[str, Any]) -> list[dict[str, Any]]:
    diffs = []
    for key in sorted(set(recorded) | set(replay)):
        if recorded.get(key) != replay.get(key):
            diffs.append({"field": key, "recorded": recorded.get(key), "replay": replay.get(key)})
    return diffs


def paper_position_signature(position: dict[str, Any] | None) -> dict[str, Any] | None:
    if not position:
        return None
    return {
        "side": position.get("side"),
        "kind": position.get("kind"),
        "entry_time": position.get("entry_time"),
        "entry_ts": position.get("entry_ts"),
        "entry": audit_number(position.get("entry")),
        "stop": audit_number(position.get("stop")),
        "take_profit": audit_number(position.get("take_profit")),
        "leverage": audit_number(position.get("leverage"), 4),
        "notional": audit_number(position.get("notional"), 4),
        "qty": audit_number(position.get("qty"), 8),
        "liquidation_price": audit_number(position.get("liquidation_price")),
    }


def paper_trade_signature(trade: dict[str, Any] | None) -> dict[str, Any] | None:
    if not trade:
        return None
    return {
        "side": trade.get("side"),
        "kind": trade.get("kind"),
        "entry_time": trade.get("entry_time"),
        "entry_ts": trade.get("entry_ts"),
        "exit_time": trade.get("exit_time"),
        "exit_reason": trade.get("exit_reason"),
        "entry": audit_number(trade.get("entry")),
        "exit_price": audit_number(trade.get("exit_price")),
        "pnl": audit_number(trade.get("pnl"), 8),
        "gross_pnl": audit_number(trade.get("gross_pnl"), 8),
        "fees": audit_number(trade.get("fees"), 8),
        "slippage": audit_number(trade.get("slippage"), 8),
    }


def replay_close_for_audit(entry: dict[str, Any], params: dict[str, Any]) -> dict[str, Any]:
    position_before = entry.get("position_before")
    recorded_trade = entry.get("closed_trade")
    recorded_time = (entry.get("scan_signature") or {}).get("context_time") or entry.get("candle_time")
    recorded_ts = (entry.get("scan_signature") or {}).get("context_ts")
    if not position_before or not recorded_trade:
        return {"status": "skipped", "reason": "无平仓动作"}

    candles = enrich_candles(fetch_backtest_candles(entry.get("inst_id", "BTC-USDT-SWAP"), entry.get("bar") or params.get("bar", "1H"), params), params)
    index = find_candle_index(candles, recorded_ts, recorded_time, last_closed_candle_index(candles))
    if index < 0:
        return {"status": "skipped", "reason": "平仓 K 线不在当前历史窗口"}
    _, replay_trade, _ = process_position_on_candle(
        dict(position_before),
        candles[index],
        params,
        float(entry.get("equity_before") or params.get("initial_equity", 10)),
        float(params.get("initial_equity", entry.get("equity_before") or 10)),
    )
    recorded_sig = paper_trade_signature(recorded_trade)
    replay_sig = paper_trade_signature(replay_trade)
    diffs = signature_diffs(recorded_sig or {}, replay_sig or {})
    if not replay_trade:
        return {"status": "fail", "reason": "复放未触发平仓", "recorded": recorded_sig, "replay": replay_sig, "diffs": diffs}
    if diffs:
        return {"status": "fail", "reason": "平仓路径不一致", "recorded": recorded_sig, "replay": replay_sig, "diffs": diffs}
    return {"status": "pass", "reason": "平仓路径一致", "recorded": recorded_sig, "replay": replay_sig, "diffs": []}


def replay_action_for_audit(entry: dict[str, Any], replay_scan: dict[str, Any], params: dict[str, Any]) -> dict[str, Any]:
    action = str(entry.get("action") or "")
    checks = []
    if "close" in action:
        checks.append({"name": "close", **replay_close_for_audit(entry, params)})
    if "open" in action:
        recorded_position = paper_position_signature(entry.get("position_after"))
        replay_position = paper_position_signature(
            attach_trade_management(
                {
                    **(replay_scan.get("position") or {}),
                    "entry_time": replay_scan.get("context", {}).get("time"),
                    "entry_ts": replay_scan.get("context", {}).get("ts"),
                },
                params,
            )
            if replay_scan.get("status") == "ready" and replay_scan.get("position")
            else None
        )
        diffs = signature_diffs(recorded_position or {}, replay_position or {})
        if not replay_position:
            checks.append({"name": "open", "status": "fail", "reason": "复放未触发开仓", "recorded": recorded_position, "replay": replay_position, "diffs": diffs})
        elif diffs:
            checks.append({"name": "open", "status": "fail", "reason": "开仓路径不一致", "recorded": recorded_position, "replay": replay_position, "diffs": diffs})
        else:
            checks.append({"name": "open", "status": "pass", "reason": "开仓路径一致", "recorded": recorded_position, "replay": replay_position, "diffs": []})
    if not checks:
        return {"status": "skipped", "reason": "无开平仓动作", "checks": []}
    if any(check.get("status") == "fail" for check in checks):
        status = "fail"
    elif all(check.get("status") == "pass" for check in checks):
        status = "pass"
    else:
        status = "skipped"
    diffs = []
    for check in checks:
        for diff in check.get("diffs", []):
            diffs.append({"field": f"{check.get('name')}.{diff.get('field')}", "recorded": diff.get("recorded"), "replay": diff.get("replay")})
    return {
        "status": status,
        "reason": "；".join(check.get("reason", "") for check in checks if check.get("reason")),
        "checks": checks,
        "diffs": diffs,
    }


def reconcile_paper_audit(limit: int = 20) -> dict[str, Any]:
    audit = read_paper_audit(limit)
    rows: list[dict[str, Any]] = []
    summary = {"pass": 0, "fail": 0, "skipped": 0, "error": 0, "action_pass": 0, "action_fail": 0, "action_skipped": 0}
    for entry in audit["rows"]:
        recorded_scan = entry.get("scan") or {}
        recorded_signature = entry.get("scan_signature") or recorded_scan.get("signature") or paper_scan_signature(recorded_scan)
        recorded_time = recorded_signature.get("context_time")
        try:
            params = paper_runtime_params(entry.get("params") or {})
            params = {
                **params,
                "bar": entry.get("bar") or params.get("bar", "1H"),
                "scan_history_hours": params.get("scan_history_hours", 240),
                "record_scan": False,
                "replay_context_ts": recorded_signature.get("context_ts"),
                "replay_context_time": recorded_time,
            }
            replay = diagnose_signal_for_market(entry.get("inst_id", "BTC-USDT-SWAP"), params, entry.get("equity_before"))
            replay_signature = paper_scan_signature(replay)
            replay_time = replay_signature.get("context_time")
            diffs = signature_diffs(recorded_signature, replay_signature)
            action_check = replay_action_for_audit(entry, replay, params)
            action_status = action_check.get("status")
            if action_status == "pass":
                summary["action_pass"] += 1
            elif action_status == "fail":
                summary["action_fail"] += 1
            else:
                summary["action_skipped"] += 1
            if recorded_time != replay_time:
                status = "skipped"
                reason = "历史 K 线未精确匹配，保留审计记录"
            elif not diffs:
                status = "pass"
                reason = "历史定点复放与纸交易记录一致"
            else:
                status = "fail"
                reason = "历史定点复放与纸交易记录不一致"
            summary[status] += 1
            rows.append(
                {
                    "status": status,
                    "reason": reason,
                    "time": entry.get("time"),
                    "inst_id": entry.get("inst_id"),
                    "bar": entry.get("bar"),
                    "action": entry.get("action"),
                    "recorded_time": recorded_time,
                    "replay_time": replay_time,
                    "recorded": recorded_signature,
                    "replay": replay_signature,
                    "diffs": diffs,
                    "action_check": action_check,
                    "data": (recorded_scan.get("data") or {}).get("price") or {},
                }
            )
        except Exception as exc:
            status = "skipped" if str(exc).startswith("Replay candle not found:") else "error"
            summary[status] += 1
            summary["action_skipped"] += 1
            rows.append(
                {
                    "status": status,
                    "reason": str(exc),
                    "time": entry.get("time"),
                    "inst_id": entry.get("inst_id"),
                    "bar": entry.get("bar"),
                    "action": entry.get("action"),
                    "recorded_time": recorded_time,
                    "replay_time": None,
                    "recorded": recorded_signature,
                    "replay": None,
                    "diffs": [],
                    "action_check": {"status": "skipped", "reason": "信号复放失败，未执行动作复放"},
                    "data": (recorded_scan.get("data") or {}).get("price") or {},
                }
            )
    return {"path": str(PAPER_AUDIT_FILE), "summary": summary, "rows": rows}


paper_state = load_paper_state()
paper_lock = threading.Lock()
paper_loop_started = False


def paper_loop() -> None:
    while True:
        time.sleep(20)
        with paper_lock:
            if not paper_state.running:
                continue
            inst_id = paper_state.inst_id
            bar = paper_state.bar
            state_params = dict(paper_state.params)
            equity = paper_state.equity
            peak_equity = paper_state.peak_equity
            day_start_equity = paper_state.day_start_equity
            day_key = paper_state.day_key
            day_trades = paper_state.day_trades
            loss_streak = paper_state.consecutive_losses
            existing_position = dict(paper_state.position) if paper_state.position else None
        try:
            equity_before = equity
            position_before = dict(existing_position) if existing_position else None
            params = {
                "strategy_mode": paper_state.strategy_mode,
                "lookback": 12,
                "atr_period": 14,
                "adx_period": 14,
                "min_adx": 18,
                "atr_stop_mult": 1.8,
                "take_profit_rr": 2.8,
                "min_breakout_atr": 0.25,
                "min_sweep_atr": 0.25,
                "max_risk_atr": 3,
                "trend_adx": 24,
                "range_adx": 18,
                "initial_equity": paper_state.equity,
                "risk_pct": 0.10,
                "max_loss_pct_per_trade": 0.10,
                "leverage": 75,
                "max_leverage": 75,
                "min_leverage": 5,
                "adaptive_leverage": True,
                "adaptive_trade_management": True,
                "adaptive_risk": True,
                "max_strategy_drawdown": 0.35,
                "margin_pct_per_trade": 0.70,
                "maintenance_margin_rate": 0.005,
                "min_liq_buffer_pct": 0.003,
                "fee_rate": 0.0005,
                "slippage_pct": 0.0002,
                "max_surprise_prior_run_atr": 3.2,
                "max_surprise_confirm_extension_atr": 1.0,
                "max_surprise_confirm_retrace_atr": 0.95,
                "trade_louie_trend_regime": False,
                "trade_louie_breakout_tests": True,
                "trade_louie_delayed_sweeps": True,
                "min_louie_breakout_adx": 32,
                "breakout_risk_factor": 0.7,
                "use_multi_take_profit": False,
                "tp1_share_pct": 0.40,
                "tp2_share_pct": 0.30,
                "move_stop_to_breakeven_after_tp1": True,
                **paper_runtime_params(state_params),
            }
            candles = enrich_candles(fetch_backtest_candles(inst_id, bar, {**params, "history_hours": 240}), params)
            closed_index = last_closed_candle_index(candles)
            closed_candle = candles[closed_index] if closed_index >= 0 else None
            closed_day_key = closed_candle["time"][:10] if closed_candle else datetime.now(timezone.utc).date().isoformat()
            if day_key != closed_day_key:
                day_key = closed_day_key
                day_start_equity = equity
                day_trades = 0

            closed_trade = None
            actions: list[dict[str, Any]] = []
            if existing_position and closed_candle:
                existing_position, closed_trade, pnl_delta = process_position_on_candle(
                    existing_position,
                    closed_candle,
                    params,
                    equity,
                    float(params.get("initial_equity", 10)),
                )
                if pnl_delta:
                    equity += pnl_delta
                if closed_trade:
                    loss_streak = loss_streak + 1 if closed_trade["pnl"] <= 0 else 0
                    actions.append(
                        {
                            "type": "close",
                            "side": closed_trade.get("side"),
                            "kind": closed_trade.get("kind"),
                            "pnl": closed_trade.get("pnl"),
                            "exit_reason": closed_trade.get("exit_reason"),
                        }
                    )

            peak_equity = max(peak_equity, equity)
            scan_params = {
                **params,
                "bar": bar,
                "scan_history_hours": 240,
                "account_peak": peak_equity,
                "day_start_equity": day_start_equity,
                "loss_streak": loss_streak,
            }
            scan = diagnose_signal_for_market(inst_id, scan_params, equity)
            signal = scan.get("signal")
            log_key = f"{inst_id}:{scan.get('context', {}).get('time')}"
            should_log = log_key != paper_state.last_signal_log_key
            with paper_lock:
                paper_state.equity = equity
                paper_state.peak_equity = peak_equity
                paper_state.day_start_equity = day_start_equity
                paper_state.day_key = day_key
                paper_state.day_trades = day_trades
                paper_state.consecutive_losses = loss_streak
                paper_state.circuit_breaker = scan.get("risk") or risk_circuit_state(scan_params, equity)
                if closed_trade:
                    paper_state.trades = ([closed_trade] + (paper_state.trades or []))[:100]
                    paper_state.position = None
                    append_paper_event(
                        "close",
                        {
                            "inst_id": closed_trade.get("inst_id"),
                            "side": closed_trade.get("side"),
                            "kind": closed_trade.get("kind"),
                            "pnl": closed_trade.get("pnl"),
                            "equity": equity,
                            "exit_reason": closed_trade.get("exit_reason"),
                        },
                    )
                elif existing_position:
                    paper_state.position = existing_position
                paper_state.last_signal = signal
                paper_state.signal_log = ([scan] + paper_state.signal_log)[:100]
                if should_log:
                    append_signal_log(
                        "paper",
                        {
                            "updated_at": scan.get("updated_at"),
                            "summary": {
                                "markets": 1,
                                "ready": 1 if scan.get("status") == "ready" else 0,
                                "watch": 1 if scan.get("status") == "watch" else 0,
                                "blocked": 1 if scan.get("status") == "blocked" else 0,
                                "errors": 1 if scan.get("status") == "error" else 0,
                            },
                            "rows": [scan],
                        },
                    )
                    paper_state.last_signal_log_key = log_key
                paper_state.updated_at = datetime.now(timezone.utc).isoformat()
                paper_state.last_error = None
                if scan.get("status") == "ready" and scan.get("position") and paper_state.position is None:
                    can_open = day_trades < int(params.get("max_daily_trades", 9999))
                    no_open_reason = "达到单日交易次数上限"
                    if can_open and day_trades >= 1:
                        signal_kind = (scan.get("signal") or {}).get("kind")
                        allowed_kinds = params.get("second_trade_allowed_kinds")
                        if allowed_kinds and signal_kind not in set(allowed_kinds):
                            can_open = False
                            no_open_reason = "第二笔交易形态不允许"
                        second_trade_side = params.get("second_trade_side", "any")
                        signal_side = (scan.get("signal") or {}).get("side")
                        if second_trade_side != "any" and signal_side != second_trade_side:
                            can_open = False
                            no_open_reason = "第二笔交易方向不允许"
                    if can_open:
                        paper_state.position = attach_trade_management(
                            {
                                **scan["position"],
                                "entry_time": scan["context"].get("time"),
                                "entry_ts": scan["context"].get("ts"),
                            },
                            params,
                        )
                        paper_state.day_trades = day_trades + 1
                        actions.append(
                            {
                                "type": "open",
                                "side": paper_state.position.get("side"),
                                "kind": paper_state.position.get("kind"),
                                "entry": paper_state.position.get("entry"),
                                "notional": paper_state.position.get("notional"),
                            }
                        )
                        append_paper_event(
                            "open",
                            {
                                "inst_id": inst_id,
                                "side": paper_state.position.get("side"),
                                "kind": paper_state.position.get("kind"),
                                "entry": paper_state.position.get("entry"),
                                "notional": paper_state.position.get("notional"),
                                "equity": equity,
                            },
                        )
                    else:
                        actions.append({"type": "no_open", "reason": no_open_reason})
                if not actions:
                    actions.append({"type": "scan", "decision": scan.get("decision"), "status": scan.get("status")})
                if should_log:
                    append_paper_audit(
                        {
                            "inst_id": inst_id,
                            "bar": bar,
                            "strategy_mode": paper_state.strategy_mode,
                            "candle_time": scan.get("context", {}).get("time"),
                            "params": params,
                            "equity_before": equity_before,
                            "equity_after": paper_state.equity,
                            "day_trades": paper_state.day_trades,
                            "loss_streak": paper_state.consecutive_losses,
                            "position_before": position_before,
                            "position_after": paper_state.position,
                            "closed_trade": closed_trade,
                            "action": ",".join(action.get("type", "unknown") for action in actions),
                            "actions": actions,
                            "scan": compact_paper_scan(scan),
                            "scan_signature": paper_scan_signature(scan),
                        }
                    )
                save_paper_state(paper_state)
        except Exception as exc:
            with paper_lock:
                paper_state.last_error = str(exc)
                paper_state.updated_at = datetime.now(timezone.utc).isoformat()
                append_paper_event("error", {"error": str(exc)})
                save_paper_state(paper_state)


def start_paper_loop() -> None:
    global paper_loop_started
    if paper_loop_started:
        return
    threading.Thread(target=paper_loop, daemon=True).start()
    paper_loop_started = True


def read_json(handler: BaseHTTPRequestHandler) -> dict[str, Any]:
    length = int(handler.headers.get("content-length", "0"))
    if length == 0:
        return {}
    return json.loads(handler.rfile.read(length).decode("utf-8"))


class Handler(BaseHTTPRequestHandler):
    def send_cors_headers(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def send_json(self, payload: Any, status: int = 200) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_cors_headers()
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self.send_cors_headers()
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self) -> None:
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/favicon.ico":
            self.send_response(204)
            self.send_header("Content-Length", "0")
            self.end_headers()
            return

        if parsed.path == "/api/candles":
            query = urllib.parse.parse_qs(parsed.query)
            try:
                candles = fetch_candles(
                    query.get("instId", ["BTC-USDT-SWAP"])[0],
                    query.get("bar", ["15m"])[0],
                    int(query.get("limit", ["200"])[0]),
                )
                self.send_json({"candles": candles})
            except Exception as exc:
                self.send_json({"error": str(exc)}, 500)
            return

        if parsed.path == "/api/paper/status":
            with paper_lock:
                self.send_json(paper_state_payload(paper_state))
            return

        if parsed.path == "/api/paper/events":
            query = urllib.parse.parse_qs(parsed.query)
            limit = int(query.get("limit", ["50"])[0])
            self.send_json(read_paper_events(limit))
            return

        if parsed.path == "/api/paper/audit":
            query = urllib.parse.parse_qs(parsed.query)
            limit = int(query.get("limit", ["50"])[0])
            self.send_json(read_paper_audit(limit))
            return

        if parsed.path == "/api/paper/reconcile":
            query = urllib.parse.parse_qs(parsed.query)
            limit = int(query.get("limit", ["20"])[0])
            self.send_json(reconcile_paper_audit(limit))
            return

        if parsed.path == "/api/data/status":
            self.send_json(cache_status())
            return

        if parsed.path == "/api/data/refresh-progress":
            self.send_json(data_refresh_progress())
            return

        if parsed.path == "/api/tasks":
            query = urllib.parse.parse_qs(parsed.query)
            self.send_json(list_tasks(int(query.get("limit", ["20"])[0])))
            return

        if parsed.path == "/api/task":
            query = urllib.parse.parse_qs(parsed.query)
            task_id = query.get("id", [""])[0]
            task = get_task(task_id)
            self.send_json(task or {"error": "task not found"}, 200 if task else 404)
            return

        if parsed.path == "/api/signal-log":
            query = urllib.parse.parse_qs(parsed.query)
            limit = int(query.get("limit", ["100"])[0])
            self.send_json(signal_log_report(limit))
            return

        if parsed.path == "/api/research-snapshots":
            query = urllib.parse.parse_qs(parsed.query)
            limit = int(query.get("limit", ["20"])[0])
            self.send_json(list_research_snapshots(limit))
            return

        if parsed.path == "/api/research-snapshot":
            query = urllib.parse.parse_qs(parsed.query)
            file_name = query.get("file", [""])[0]
            path = SNAPSHOT_DIR / file_name
            if not file_name or not path.resolve().is_relative_to(SNAPSHOT_DIR.resolve()) or not path.exists():
                self.send_json({"error": "snapshot not found"}, 404)
                return
            self.send_json(hydrate_research_snapshot(json.loads(path.read_text(encoding="utf-8"))))
            return

        path = PUBLIC / ("index.html" if parsed.path == "/" else parsed.path.lstrip("/"))
        if not path.resolve().is_relative_to(PUBLIC.resolve()) or not path.exists():
            self.send_error(404)
            return
        content_type = "text/html"
        if path.suffix == ".css":
            content_type = "text/css"
        elif path.suffix == ".js":
            content_type = "application/javascript"
        body = path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_cors_headers()
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_HEAD(self) -> None:
        parsed = urllib.parse.urlparse(self.path)
        path = PUBLIC / ("index.html" if parsed.path == "/" else parsed.path.lstrip("/"))
        if not path.resolve().is_relative_to(PUBLIC.resolve()) or not path.exists():
            self.send_error(404)
            return
        self.send_response(200)
        self.send_cors_headers()
        self.send_header("Content-Length", str(path.stat().st_size))
        self.end_headers()

    def do_POST(self) -> None:
        if self.path == "/api/backtest":
            try:
                body = read_json(self)
                inst_id = body.get("instId", "BTC-USDT-SWAP")
                candles = fetch_backtest_candles(inst_id, body.get("bar", "15m"), body)
                trend_by_ts = None
                if uses_trend_context(body.get("strategy_mode", "trend_price_action")):
                    trend_candles = fetch_trend_candles(inst_id, body.get("trend_bar", "1H"), body)
                    trend_by_ts = build_trend_context(trend_candles, body)
                self.send_json(run_backtest(candles, body, trend_by_ts))
            except Exception as exc:
                self.send_json({"error": str(exc)}, 500)
            return

        if self.path == "/api/optimize":
            try:
                body = read_json(self)
                inst_id = body.get("instId", "BTC-USDT-SWAP")
                candles = fetch_backtest_candles(inst_id, body.get("bar", "15m"), body)
                trend_by_ts = None
                if uses_trend_context(body.get("strategy_mode", "trend_price_action")):
                    trend_candles = fetch_trend_candles(inst_id, body.get("trend_bar", "1H"), body)
                    trend_by_ts = build_trend_context(trend_candles, body)
                self.send_json(optimize_params(candles, body, trend_by_ts))
            except Exception as exc:
                self.send_json({"error": str(exc)}, 500)
            return

        if self.path == "/api/joint-optimize":
            try:
                body = read_json(self)
                self.send_json(joint_optimize_params(body))
            except Exception as exc:
                self.send_json({"error": str(exc)}, 500)
            return

        if self.path == "/api/validate":
            try:
                body = read_json(self)
                self.send_json(validate_markets(body))
            except Exception as exc:
                self.send_json({"error": str(exc)}, 500)
            return

        if self.path == "/api/slice-validate":
            try:
                body = read_json(self)
                self.send_json(validate_time_slices(body))
            except Exception as exc:
                self.send_json({"error": str(exc)}, 500)
            return

        if self.path == "/api/portfolio-backtest":
            try:
                body = read_json(self)
                self.send_json(portfolio_backtest(body))
            except Exception as exc:
                self.send_json({"error": str(exc)}, 500)
            return

        if self.path == "/api/portfolio-slices":
            try:
                body = read_json(self)
                self.send_json(portfolio_time_slices(body))
            except Exception as exc:
                self.send_json({"error": str(exc)}, 500)
            return

        if self.path == "/api/robustness":
            try:
                body = read_json(self)
                self.send_json(portfolio_robustness(body))
            except Exception as exc:
                self.send_json({"error": str(exc)}, 500)
            return

        if self.path == "/api/monte-carlo":
            try:
                body = read_json(self)
                self.send_json(monte_carlo_portfolio(body))
            except Exception as exc:
                self.send_json({"error": str(exc)}, 500)
            return

        if self.path == "/api/readiness":
            try:
                body = read_json(self)
                self.send_json(readiness_gate(body))
            except Exception as exc:
                self.send_json({"error": str(exc)}, 500)
            return

        if self.path == "/api/benchmarks":
            try:
                body = read_json(self)
                self.send_json(portfolio_benchmarks(body))
            except Exception as exc:
                self.send_json({"error": str(exc)}, 500)
            return

        if self.path == "/api/attribution":
            try:
                body = read_json(self)
                self.send_json(portfolio_attribution(body))
            except Exception as exc:
                self.send_json({"error": str(exc)}, 500)
            return

        if self.path == "/api/attribution-experiments":
            try:
                body = read_json(self)
                self.send_json(attribution_experiments(body))
            except Exception as exc:
                self.send_json({"error": str(exc)}, 500)
            return

        if self.path == "/api/research-snapshot":
            try:
                body = read_json(self)
                self.send_json(save_research_snapshot(body))
            except Exception as exc:
                self.send_json({"error": str(exc)}, 500)
            return

        if self.path == "/api/signal-scan":
            try:
                body = read_json(self)
                self.send_json(signal_scan(body))
            except Exception as exc:
                self.send_json({"error": str(exc)}, 500)
            return

        if self.path == "/api/telegram/analyze":
            try:
                body = read_json(self)
                self.send_json(telegram_strategy_report(body))
            except Exception as exc:
                self.send_json({"error": str(exc)}, 500)
            return

        if self.path == "/api/data/warmup":
            try:
                body = read_json(self)
                self.send_json(warmup_data(body))
            except Exception as exc:
                self.send_json({"error": str(exc)}, 500)
            return

        if self.path == "/api/data/refresh":
            try:
                body = read_json(self)
                self.send_json(refresh_candle_cache(body))
            except Exception as exc:
                self.send_json({"error": str(exc)}, 500)
            return

        if self.path == "/api/data/refresh-stale":
            try:
                body = read_json(self)
                self.send_json(refresh_stale_candle_cache(body))
            except Exception as exc:
                self.send_json({"error": str(exc)}, 500)
            return

        if self.path == "/api/data/compact-cache":
            try:
                body = read_json(self)
                self.send_json(compact_covered_candle_cache(body))
            except Exception as exc:
                self.send_json({"error": str(exc)}, 500)
            return

        if self.path == "/api/tasks":
            try:
                body = read_json(self)
                task_type = str(body.get("type") or "")
                params = body.get("params") or {}
                if not task_type:
                    raise ValueError("type is required")
                self.send_json(enqueue_task(task_type, params))
            except Exception as exc:
                self.send_json({"error": str(exc)}, 500)
            return

        if self.path == "/api/task/cancel":
            try:
                body = read_json(self)
                self.send_json(cancel_task(str(body.get("id") or "")))
            except Exception as exc:
                self.send_json({"error": str(exc)}, 500)
            return

        if self.path == "/api/paper/start":
            body = read_json(self)
            with paper_lock:
                paper_state.running = True
                paper_state.inst_id = body.get("instId", paper_state.inst_id)
                paper_state.bar = body.get("bar", paper_state.bar)
                paper_state.strategy_mode = body.get("strategy_mode", paper_state.strategy_mode)
                paper_state.equity = float(body.get("initial_equity", paper_state.equity))
                paper_state.peak_equity = paper_state.equity
                paper_state.day_start_equity = paper_state.equity
                paper_state.day_key = None
                paper_state.day_trades = 0
                paper_state.consecutive_losses = 0
                paper_state.circuit_breaker = {}
                paper_state.params = paper_runtime_params(body)
                paper_state.position = None
                paper_state.trades = []
                paper_state.updated_at = datetime.now(timezone.utc).isoformat()
                append_paper_event(
                    "start",
                    {
                        "inst_id": paper_state.inst_id,
                        "bar": paper_state.bar,
                        "strategy_mode": paper_state.strategy_mode,
                        "equity": paper_state.equity,
                        "max_daily_trades": body.get("max_daily_trades"),
                    },
                )
                save_paper_state(paper_state)
            self.send_json({"ok": True})
            return

        if self.path == "/api/paper/stop":
            with paper_lock:
                paper_state.running = False
                paper_state.updated_at = datetime.now(timezone.utc).isoformat()
                append_paper_event("stop", {"equity": paper_state.equity, "position": paper_state.position is not None})
                save_paper_state(paper_state)
            self.send_json({"ok": True})
            return

        self.send_error(404)

    def log_message(self, fmt: str, *args: Any) -> None:
        print(f"{self.address_string()} - {fmt % args}")


def main() -> None:
    start_task_worker()
    start_paper_loop()
    server = ThreadingHTTPServer(("127.0.0.1", 8765), Handler)
    print("OKX perp bot dashboard: http://127.0.0.1:8765")
    server.serve_forever()


if __name__ == "__main__":
    main()
