#!/usr/bin/env python3
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import scripts.manage_24x7 as manage


def test_recent_backtest_evidence_status_reads_latest_file() -> None:
    original_dir = manage.EVIDENCE_BUNDLE_DIR
    original_time = manage.time.time
    temp_dir = manage.CACHE_DIR / "test-recent-backtest-evidence"
    generated_at = "2026-06-06T00:00:00+00:00"
    generated_ts = manage.parse_time(generated_at)
    assert generated_ts is not None
    payload = {
        "generated_at": generated_at,
        "ok": True,
        "status": "ok",
        "portfolio": {
            "ok": True,
            "result": {
                "summary": {"return_pct": 0.34, "final_equity": 13.4, "max_drawdown": 0.12, "trades": 7},
                "health": {"grade": "B", "score": 71},
            },
        },
        "slices": {"ok": True, "result": {"aggregate": {"cases": 3, "positive_cases": 2}}},
        "runtime": {"live_submit_locked": True, "live_env_locked": True},
    }
    try:
        temp_dir.mkdir(parents=True, exist_ok=True)
        manage.EVIDENCE_BUNDLE_DIR = temp_dir
        (temp_dir / "recent-backtest-test.json").write_text(json.dumps(payload), encoding="utf-8")
        manage.time.time = lambda: generated_ts + 60
        status = manage.recent_backtest_evidence_status()
        assert status["ok"] is True
        assert status["return_pct"] == 0.34
        assert status["health_grade"] == "B"
        assert status["slice_cases"] == 3
        assert status["locks_ok"] is True

        manage.time.time = lambda: generated_ts + manage.RECENT_BACKTEST_EVIDENCE_FRESH_SECONDS + 1
        stale = manage.recent_backtest_evidence_status()
        assert stale["ok"] is False
        assert stale["age_ok"] is False
    finally:
        manage.EVIDENCE_BUNDLE_DIR = original_dir
        manage.time.time = original_time
        for path in temp_dir.glob("*"):
            path.unlink()
        if temp_dir.exists():
            temp_dir.rmdir()


def test_recent_backtest_payload_compacts_results_and_preserves_locks() -> None:
    original_post_json = manage.post_json
    original_http_request = manage.http_request
    seen_params: list[dict] = []

    def fake_post_json(url: str, payload: dict, timeout: float = 8.0):
        assert payload["offline_mode"] is True
        assert payload["prefer_cache"] is True
        if url.endswith("/api/portfolio-backtest"):
            return True, {
                "summary": {
                    "initial_equity": 10,
                    "final_equity": 12,
                    "return_pct": 0.2,
                    "max_drawdown": 0.05,
                    "trades": 3,
                },
                "health": {"grade": "B", "score": 72},
                "by_symbol": [{"inst_id": "BTC-USDT-SWAP", "trades": 3}],
                "equity_curve": [{"time": "2026-06-06T00:00:00+00:00", "equity": 12}],
                "trades": [{"time": "2026-06-06T00:00:00+00:00", "pnl": 1.5}],
            }, ""
        if url.endswith("/api/portfolio-slices"):
            return True, {
                "aggregate": {"cases": 3, "positive_cases": 2, "avg_return_pct": 0.08, "worst_drawdown": 0.06},
                "results": [
                    {
                        "slice": 1,
                        "window_start": "2026-03-01T00:00:00+00:00",
                        "window_end": "2026-04-01T00:00:00+00:00",
                        "summary": {"return_pct": 0.03, "max_drawdown": 0.02, "trades": 1},
                    }
                ],
            }, ""
        raise AssertionError(f"unexpected url: {url}")

    def fake_http_request(url: str, timeout: float = 5.0):
        if url.endswith("/api/paper/status"):
            return True, {"running": True, "equity": 10.5, "updated_at": "2026-06-07T00:00:00+00:00"}, ""
        if url.endswith("/api/execution/config"):
            return True, {
                "live_trading_enabled": False,
                "live_order_enabled": False,
                "live_cancel_enabled": False,
                "connector_status": {"dry_run_only": True, "can_submit_live": False},
            }, ""
        raise AssertionError(f"unexpected url: {url}")

    try:
        manage.post_json = fake_post_json  # type: ignore[assignment]
        manage.http_request = fake_http_request  # type: ignore[assignment]
        payload = manage.recent_backtest_payload()
    finally:
        manage.post_json = original_post_json  # type: ignore[assignment]
        manage.http_request = original_http_request  # type: ignore[assignment]

    assert payload["ok"] is True
    assert payload["status"] == "ok"
    assert payload["portfolio"]["result"]["summary"]["return_pct"] == 0.2
    assert payload["portfolio"]["result"]["latest_trade"]["pnl"] == 1.5
    assert payload["slices"]["result"]["aggregate"]["positive_cases"] == 2
    assert payload["runtime"]["paper_running"] is True
    assert payload["runtime"]["live_submit_locked"] is True
    assert payload["runtime"]["live_env_locked"] is True
    assert payload["runtime"]["locks"]["dry_run_only"] is True
    assert payload["runtime"]["locks"]["can_submit_live"] is False


def test_market_data_refresh_payload_tracks_task_and_locks() -> None:
    original_post_json = manage.post_json
    original_http_request = manage.http_request
    seen_params: list[dict] = []

    def cache_status(stale: int) -> dict:
        rows = []
        for index in range(stale):
            rows.append(
                {
                    "inst_id": "BTC-USDT-SWAP",
                    "bar": "15m",
                    "count": 300,
                    "latest_closed": "2026-06-06T00:00:00+00:00",
                    "is_stale": True,
                    "recommended_refresh": True,
                    "refresh_priority": 86,
                    "refresh_cost_label": "约 1 次请求",
                }
            )
        return {"rows": rows, "cache_dir": ".cache", "portfolio_result_cache": {"count": 0}}

    def fake_post_json(url: str, payload: dict, timeout: float = 8.0):
        assert url.endswith("/api/tasks")
        assert payload["type"] == "data_refresh"
        assert payload["params"]["stale"] is True
        assert payload["params"]["recommended_only"] is True
        assert payload["params"]["include_high_cost"] is False
        assert payload["params"]["max_items"] == 2
        seen_params.append(payload["params"])
        return True, {"id": "task-refresh-1", "status": "queued"}, ""

    def fake_http_request(url: str, timeout: float = 5.0):
        if url.endswith("/api/data/status"):
            calls = getattr(fake_http_request, "status_calls", 0)
            fake_http_request.status_calls = calls + 1
            return True, cache_status(2 if calls == 0 else 0), ""
        if url.endswith("/api/execution/config"):
            return True, {
                "live_trading_enabled": False,
                "live_order_enabled": False,
                "live_cancel_enabled": False,
                "connector_status": {"dry_run_only": True, "can_submit_live": False},
            }, ""
        if url.endswith("/api/task?id=task-refresh-1"):
            return True, {
                "id": "task-refresh-1",
                "status": "completed",
                "progress": {"completed": 2, "total": 2, "ok": 2, "failed": 0},
                "result": {
                    "batch_id": "refresh-1",
                    "mode": "recommended",
                    "ok": 2,
                    "failed": 0,
                    "skipped_high_cost": 1,
                    "include_high_cost": False,
                    "results": [{"inst_id": "BTC-USDT-SWAP", "bar": "15m", "error": None}],
                },
            }, ""
        if url.endswith("/api/data/refresh-progress"):
            return True, {"active": False, "completed": 2, "total": 2, "ok": 2, "failed": 0}, ""
        raise AssertionError(f"unexpected url: {url}")

    try:
        manage.post_json = fake_post_json  # type: ignore[assignment]
        manage.http_request = fake_http_request  # type: ignore[assignment]
        payload = manage.market_data_refresh_payload(max_items=2, recommended_only=True, timeout_seconds=1, poll_seconds=0)
    finally:
        manage.post_json = original_post_json  # type: ignore[assignment]
        manage.http_request = original_http_request  # type: ignore[assignment]

    assert payload["ok"] is True
    assert payload["status"] == "ok"
    assert payload["task"]["id"] == "task-refresh-1"
    assert payload["task"]["status"] == "completed"
    assert payload["task"]["result_summary"]["ok"] == 2
    assert payload["task"]["result_summary"]["skipped_high_cost"] == 1
    assert payload["task"]["result_summary"]["include_high_cost"] is False
    assert payload["request"]["include_high_cost"] is False
    assert seen_params[0]["include_high_cost"] is False
    assert payload["cache_before"]["status"]["summary"]["stale"] == 2
    assert payload["cache_after"]["status"]["summary"]["stale"] == 0
    assert payload["runtime"]["live_submit_locked"] is True
    assert payload["runtime"]["live_env_locked"] is True
    assert payload["runtime"]["locks"]["dry_run_only"] is True
    assert payload["runtime"]["locks"]["can_submit_live"] is False


def test_market_data_refresh_payload_can_include_high_cost_manual_batch() -> None:
    original_post_json = manage.post_json
    original_http_request = manage.http_request

    def cache_status(stale: int) -> dict:
        rows = [
            {
                "inst_id": "BTC-USDT-SWAP",
                "bar": "5m",
                "count": 26002,
                "latest_closed": "2026-06-06T00:00:00+00:00",
                "is_stale": True,
                "high_refresh_cost": True,
                "recommended_refresh": False,
                "refresh_priority": 38,
                "refresh_cost_label": "约 259 次请求",
            }
            for _ in range(stale)
        ]
        return {"rows": rows, "summary": {"high_cost_stale": stale}, "cache_dir": ".cache"}

    def fake_post_json(url: str, payload: dict, timeout: float = 8.0):
        assert url.endswith("/api/tasks")
        assert payload["type"] == "data_refresh"
        assert payload["params"] == {
            "stale": True,
            "recommended_only": False,
            "include_high_cost": True,
            "max_items": 3,
        }
        return True, {"id": "task-refresh-high-cost", "status": "queued"}, ""

    def fake_http_request(url: str, timeout: float = 5.0):
        if url.endswith("/api/data/status"):
            calls = getattr(fake_http_request, "status_calls", 0)
            fake_http_request.status_calls = calls + 1
            return True, cache_status(1 if calls == 0 else 0), ""
        if url.endswith("/api/execution/config"):
            return True, {
                "live_trading_enabled": False,
                "live_order_enabled": False,
                "live_cancel_enabled": False,
                "connector_status": {"dry_run_only": True, "can_submit_live": False},
            }, ""
        if url.endswith("/api/task?id=task-refresh-high-cost"):
            return True, {
                "id": "task-refresh-high-cost",
                "status": "completed",
                "progress": {"completed": 1, "total": 1, "ok": 1, "failed": 0},
                "result": {
                    "batch_id": "refresh-high-cost",
                    "mode": "stale",
                    "ok": 1,
                    "failed": 0,
                    "skipped_high_cost": 0,
                    "include_high_cost": True,
                    "results": [{"inst_id": "BTC-USDT-SWAP", "bar": "5m", "error": None}],
                },
            }, ""
        if url.endswith("/api/data/refresh-progress"):
            return True, {"active": False, "completed": 1, "total": 1, "ok": 1, "failed": 0}, ""
        raise AssertionError(f"unexpected url: {url}")

    try:
        manage.post_json = fake_post_json  # type: ignore[assignment]
        manage.http_request = fake_http_request  # type: ignore[assignment]
        payload = manage.market_data_refresh_payload(max_items=3, recommended_only=False, include_high_cost=True, timeout_seconds=1, poll_seconds=0)
    finally:
        manage.post_json = original_post_json  # type: ignore[assignment]
        manage.http_request = original_http_request  # type: ignore[assignment]

    assert payload["ok"] is True
    assert payload["request"]["recommended_only"] is False
    assert payload["request"]["include_high_cost"] is True
    assert payload["task"]["result_summary"]["include_high_cost"] is True
    assert payload["task"]["result_summary"]["skipped_high_cost"] == 0


if __name__ == "__main__":
    test_recent_backtest_evidence_status_reads_latest_file()
    test_recent_backtest_payload_compacts_results_and_preserves_locks()
    test_market_data_refresh_payload_tracks_task_and_locks()
    test_market_data_refresh_payload_can_include_high_cost_manual_batch()
    print("test_24x7_backtest_evidence ok")
