#!/usr/bin/env python3
from __future__ import annotations

import contextlib
import io
import importlib.util
import json
import os
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import app


def test_keychain_persist_mock() -> None:
    written: list[str] = []
    original_set = app.okx_keychain_set
    original_get = app.okx_keychain_get
    original_env = {key: os.environ.get(key) for key in app.OKX_ENV_KEYS}
    try:
        app.okx_keychain_set = lambda account, _value: written.append(account)  # type: ignore[assignment]
        app.okx_keychain_get = lambda account: "stored" if account in written else ""  # type: ignore[assignment]
        for key in app.OKX_ENV_KEYS:
            os.environ.pop(key, None)
        result = app.set_okx_session_credentials(
            {
                "api_key": "test-key",
                "api_secret": "test-secret",
                "api_passphrase": "test-passphrase",
                "persist_to_keychain": True,
            }
        )
        assert result["ok"] is True
        assert result["configured"] is True
        assert result["scope"] == "keychain_and_current_backend_process"
        assert result["persist_requested"] is True
        assert result["restart_survives"] is True
        assert "Keychain 已读回确认" in result["next_action"]
        assert result["keychain"]["ok"] is True
        assert result["keychain"]["verified"] is True
        assert result["keychain_status"]["configured"] is True
        assert sorted(written) == sorted(app.OKX_ENV_KEYS)
    finally:
        app.okx_keychain_set = original_set  # type: ignore[assignment]
        app.okx_keychain_get = original_get  # type: ignore[assignment]
        for key, value in original_env.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value


def test_keychain_persist_requires_readback_verification() -> None:
    written: list[str] = []
    original_set = app.okx_keychain_set
    original_get = app.okx_keychain_get
    original_env = {key: os.environ.get(key) for key in app.OKX_ENV_KEYS}
    try:
        app.okx_keychain_set = lambda account, _value: written.append(account)  # type: ignore[assignment]
        app.okx_keychain_get = lambda _account: ""  # type: ignore[assignment]
        for key in app.OKX_ENV_KEYS:
            os.environ.pop(key, None)
        result = app.set_okx_session_credentials(
            {
                "api_key": "test-key",
                "api_secret": "test-secret",
                "api_passphrase": "test-passphrase",
                "persist_to_keychain": True,
            }
        )
        assert result["ok"] is True
        assert result["configured"] is True
        assert result["scope"] == "current_backend_process_only"
        assert result["keychain"]["ok"] is False
        assert result["keychain"]["verified"] is False
        assert result["keychain_status"]["configured"] is False
        assert result["restart_survives"] is False
        assert "import-secrets --restart" in result["next_action"]
        assert sorted(written) == sorted(app.OKX_ENV_KEYS)
    finally:
        app.okx_keychain_set = original_set  # type: ignore[assignment]
        app.okx_keychain_get = original_get  # type: ignore[assignment]
        for key, value in original_env.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value


def test_automation_readiness_stages() -> None:
    original_status = app.okx_credentials_status
    policy = {"dry_run_only": True, "can_submit_live": False}
    try:
        app.okx_credentials_status = lambda: {"configured": False, "keys": {}, "simulated": False}  # type: ignore[assignment]
        missing = app.automation_readiness(
            {"last_preflight": {"allow_dry_run": True, "guard_decision": "仅 dry-run"}},
            policy,
            signal_ready=False,
            preflight_current=True,
            heartbeat_fresh=True,
        )
        assert missing["stage"] == "missing_credentials"
        assert missing["blockers"]

        app.okx_credentials_status = lambda: {"configured": True, "keys": {}, "simulated": False}  # type: ignore[assignment]
        canary = app.automation_readiness(
            {"last_preflight": {"allow_dry_run": True, "guard_decision": "仅 dry-run"}},
            policy,
            signal_ready=True,
            preflight_current=True,
            heartbeat_fresh=True,
        )
        assert canary["stage"] == "manual_canary_review"
        assert canary["label"] == "人工Canary审核"

        blocked = app.automation_readiness(
            {"last_preflight": {"allow_dry_run": False, "guard_decision": "阻断"}},
            policy,
            signal_ready=False,
            preflight_current=True,
            heartbeat_fresh=True,
        )
        assert blocked["stage"] == "preflight_blocked"
    finally:
        app.okx_credentials_status = original_status  # type: ignore[assignment]


def test_automation_readiness_summary_go_no_go() -> None:
    original_credentials = app.okx_credentials_status
    original_diagnostics = app.read_okx_diagnostics_history
    original_orders = app.read_execution_orders
    original_live = app.LIVE_TRADING_ENABLED
    original_order = app.OKX_LIVE_ORDER_ENABLED
    original_cancel = app.OKX_LIVE_CANCEL_ENABLED
    locked_shadow = {
        "present": True,
        "type": "shadow_live_order",
        "would_submit": False,
        "dry_run_only": True,
        "can_submit_live": False,
        "payload_ready": True,
        "payload_sha256": "hash",
    }
    preflight_history = {"latest": {"summary": {"shadow_order": locked_shadow}}}
    event_history = {"latest": {"preflight": {"shadow_order": locked_shadow}}}
    task_board = {"top_task": {"id": "manual_canary_review", "title": "人工 Canary 审核", "status": "review"}}
    policy = {"dry_run_only": True, "can_submit_live": False}
    try:
        app.LIVE_TRADING_ENABLED = False
        app.OKX_LIVE_ORDER_ENABLED = False
        app.OKX_LIVE_CANCEL_ENABLED = False
        app.read_execution_orders = lambda limit=200: {"rows": []}  # type: ignore[assignment]

        app.okx_credentials_status = lambda: {"configured": False, "keys": {}, "simulated": False}  # type: ignore[assignment]
        app.read_okx_diagnostics_history = lambda limit=1: {"latest": {"readonly_ok": False, "category": "missing_credentials"}}  # type: ignore[assignment]
        missing = app.automation_readiness_summary(
            {"stage": "missing_credentials", "blockers": ["缺少密钥"]},
            policy,
            heartbeat_fresh=True,
            preflight_history=preflight_history,
            event_history=event_history,
            task_board={"top_task": {"id": "import_okx_keychain", "command": "python3 scripts/manage_24x7.py import-secrets --restart"}},
        )
        assert missing["status"] == "missing_credentials"
        assert missing["readonly_ready"] is False
        assert missing["canary_review_ready"] is False
        assert missing["checks"]["shadow_order_locked"] is True

        app.okx_credentials_status = lambda: {"configured": True, "keys": {}, "simulated": False}  # type: ignore[assignment]
        app.read_okx_diagnostics_history = lambda limit=1: {"latest": {"readonly_ok": True, "category": "readonly_ok"}}  # type: ignore[assignment]
        ready = app.automation_readiness_summary(
            {"stage": "manual_canary_review", "blockers": []},
            policy,
            heartbeat_fresh=True,
            preflight_history=preflight_history,
            event_history=event_history,
            task_board=task_board,
        )
        assert ready["status"] == "canary_review_ready"
        assert ready["readonly_ready"] is True
        assert ready["canary_review_ready"] is True
        assert ready["checks"]["no_real_submitted_orders"] is True
        assert ready["locks"]["can_submit_live"] is False
    finally:
        app.okx_credentials_status = original_credentials  # type: ignore[assignment]
        app.read_okx_diagnostics_history = original_diagnostics  # type: ignore[assignment]
        app.read_execution_orders = original_orders  # type: ignore[assignment]
        app.LIVE_TRADING_ENABLED = original_live
        app.OKX_LIVE_ORDER_ENABLED = original_order
        app.OKX_LIVE_CANCEL_ENABLED = original_cancel


def test_automation_status_pre_live_gates_keep_submit_locked() -> None:
    base_summary = {
        "status": "missing_credentials",
        "readonly_ready": False,
        "canary_review_ready": False,
        "next_action": "python3 scripts/manage_24x7.py import-secrets --restart",
        "checks": {
            "keychain_ok": False,
            "okx_readonly_ok": False,
            "heartbeat_fresh": True,
            "shadow_order_locked": True,
            "no_real_submitted_orders": True,
            "live_submit_locked": True,
            "live_env_locked": True,
        },
        "locks": {
            "dry_run_only": True,
            "can_submit_live": False,
            "live_trading_enabled": False,
            "live_order_enabled": False,
            "live_cancel_enabled": False,
        },
    }
    policy = {"dry_run_only": True, "can_submit_live": False}
    paper_equity = {
        "source": "paper_loop",
        "source_label": "模拟盘权益",
        "readonly_ok": False,
        "latest": {"equity": 10},
        "anchor_date": "2026-06-06",
        "interval_seconds": 900,
    }
    missing = app.automation_pre_live_gates(base_summary, policy, paper_equity)
    readonly = missing["phases"][0]
    blocker_names = {row["name"] for row in readonly["blockers"]}
    assert readonly["phase"] == "readonly"
    assert readonly["status"] == "no_go"
    assert "okx_keychain" in blocker_names
    assert "okx_readonly" in blocker_names
    assert "okx_equity_source" in blocker_names
    assert "live_submit_locked" not in blocker_names

    canary_summary = {
        **base_summary,
        "status": "canary_review_ready",
        "readonly_ready": True,
        "canary_review_ready": True,
        "checks": {
            **base_summary["checks"],
            "keychain_ok": True,
            "okx_readonly_ok": True,
        },
    }
    okx_equity = {
        "source": "okx_readonly",
        "source_label": "OKX只读账户权益",
        "readonly_ok": True,
        "latest": {"equity": 42.25, "slot": "2026-06-06T00:00:00+00:00"},
        "anchor_date": "2026-06-06",
        "interval_seconds": 900,
    }
    ready = app.automation_pre_live_gates(canary_summary, policy, okx_equity)
    phases = {row["phase"]: row for row in ready["phases"]}
    assert phases["readonly"]["status"] == "go"
    assert phases["canary"]["status"] == "go"
    assert phases["live-submit"]["status"] == "no_go"
    assert {row["name"] for row in phases["live-submit"]["blockers"]} == {"manual_live_unlock_review"}
    assert ready["locks"]["can_submit_live"] is False
    assert ready["equity_source"] == "okx_readonly"


def test_watchdog_stage_notifications_dedupe() -> None:
    spec = importlib.util.spec_from_file_location("manage_24x7", Path("scripts/manage_24x7.py"))
    assert spec and spec.loader
    manage = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(manage)

    state_path = app.CACHE_DIR / "watchdog-state-test.json"
    if state_path.exists():
        state_path.unlink()
    notifications: list[tuple[str, str]] = []
    original_state_path = manage.WATCHDOG_STATE_FILE
    original_notify = manage.notify
    original_snapshot = manage.maybe_record_watchdog_readiness_snapshot
    original_lock_test = manage.maybe_run_watchdog_live_lock_test
    original_task_board_payload = manage.automation_task_board_payload
    original_write = manage.write_evidence_payload
    written: list[tuple[dict, str]] = []
    try:
        manage.WATCHDOG_STATE_FILE = state_path
        manage.notify = lambda title, message: notifications.append((title, message))
        manage.maybe_record_watchdog_readiness_snapshot = lambda state, now=None, health_payload=None: None
        manage.maybe_run_watchdog_live_lock_test = lambda state, health_payload, now=None: None
        manage.automation_task_board_payload = lambda: {  # type: ignore[assignment]
            "count": 1,
            "top_task": {"id": "import_okx_keychain", "title": "导入 OKX Keychain", "status": "blocked"},
            "tasks": [{"id": "import_okx_keychain", "api_secret": "must-not-leak"}],
        }
        manage.write_evidence_payload = lambda payload, prefix: (written.append((payload, prefix)) or Path(f"/tmp/{prefix}.json"))  # type: ignore[assignment]
        payload = {
            "critical": [],
            "warnings": [],
            "checks": [
                {
                    "name": "automation_stage",
                    "ok": True,
                    "severity": "warning",
                    "detail": "缺少OKX密钥",
                    "data": {"stage": "missing_credentials", "label": "缺少OKX密钥", "next_action": "导入密钥"},
                }
            ],
        }
        manage.maybe_alert(payload)
        manage.maybe_alert(payload)
        assert len(notifications) == 1

        payload["checks"][0]["data"] = {"stage": "waiting_signal", "label": "等待信号", "next_action": "继续观察"}
        manage.maybe_alert(payload)
        assert len(notifications) == 2
    finally:
        manage.WATCHDOG_STATE_FILE = original_state_path
        manage.notify = original_notify
        manage.maybe_record_watchdog_readiness_snapshot = original_snapshot
        manage.maybe_run_watchdog_live_lock_test = original_lock_test
        if state_path.exists():
            state_path.unlink()


def test_watchdog_task_notifications_dedupe() -> None:
    spec = importlib.util.spec_from_file_location("manage_24x7", Path("scripts/manage_24x7.py"))
    assert spec and spec.loader
    manage = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(manage)

    state_path = app.CACHE_DIR / "watchdog-task-state-test.json"
    if state_path.exists():
        state_path.unlink()
    notifications: list[tuple[str, str]] = []
    original_state_path = manage.WATCHDOG_STATE_FILE
    original_notify = manage.notify
    original_snapshot = manage.maybe_record_watchdog_readiness_snapshot
    original_lock_test = manage.maybe_run_watchdog_live_lock_test
    original_task_board_payload = manage.automation_task_board_payload
    original_write = manage.write_evidence_payload
    written: list[tuple[dict, str]] = []
    try:
        manage.WATCHDOG_STATE_FILE = state_path
        manage.notify = lambda title, message: notifications.append((title, message))
        manage.maybe_record_watchdog_readiness_snapshot = lambda state, now=None, health_payload=None: None
        manage.maybe_run_watchdog_live_lock_test = lambda state, health_payload, now=None: None
        manage.automation_task_board_payload = lambda: {  # type: ignore[assignment]
            "count": 1,
            "top_task": {"id": "import_okx_keychain", "title": "导入 OKX Keychain", "status": "blocked"},
            "tasks": [{"id": "import_okx_keychain", "api_secret": "must-not-leak"}],
        }
        manage.write_evidence_payload = lambda payload, prefix: (written.append((payload, prefix)) or Path(f"/tmp/{prefix}.json"))  # type: ignore[assignment]
        payload = {
            "critical": [],
            "warnings": [],
            "checks": [
                {
                    "name": "automation_task_board",
                    "ok": True,
                    "severity": "warning",
                    "detail": "1 tasks",
                    "data": {
                        "top_task_id": "import_okx_keychain",
                        "top_task_title": "导入 OKX Keychain",
                        "top_task_status": "blocked",
                        "top_task_command": "python3 scripts/manage_24x7.py import-secrets --restart",
                    },
                }
            ],
        }
        manage.maybe_alert(payload)
        manage.maybe_alert(payload)
        assert notifications == [("OKX Quant Task", "导入 OKX Keychain: python3 scripts/manage_24x7.py import-secrets --restart")]
        assert len(written) == 1
        assert written[0][1] == "automation-task-board-watchdog"
        assert written[0][0]["watchdog_trigger"]["top_task_id"] == "import_okx_keychain"
        assert "must-not-leak" not in json.dumps(written[0][0], ensure_ascii=False).lower()

        payload["checks"][0]["data"] = {
            "top_task_id": "run_ready_preflight",
            "top_task_title": "运行 ready 信号预检",
            "top_task_status": "ready",
            "top_task_action": "运行自动化预检",
        }
        manage.automation_task_board_payload = lambda: {  # type: ignore[assignment]
            "count": 1,
            "top_task": {"id": "run_ready_preflight", "title": "运行 ready 信号预检", "status": "ready"},
            "tasks": [{"id": "run_ready_preflight"}],
        }
        manage.maybe_alert(payload)
        assert notifications[-1] == ("OKX Quant Task", "运行 ready 信号预检: 运行自动化预检")
        assert len(notifications) == 2
        assert len(written) == 2
        assert written[-1][0]["watchdog_trigger"]["top_task_id"] == "run_ready_preflight"
    finally:
        manage.WATCHDOG_STATE_FILE = original_state_path
        manage.notify = original_notify
        manage.maybe_record_watchdog_readiness_snapshot = original_snapshot
        manage.maybe_run_watchdog_live_lock_test = original_lock_test
        manage.automation_task_board_payload = original_task_board_payload
        manage.write_evidence_payload = original_write
        if state_path.exists():
            state_path.unlink()


def test_watchdog_market_refresh_is_throttled_and_lock_guarded() -> None:
    spec = importlib.util.spec_from_file_location("manage_24x7", Path("scripts/manage_24x7.py"))
    assert spec and spec.loader
    manage = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(manage)

    calls: list[dict] = []
    writes: list[str] = []
    original_refresh = manage.market_data_refresh_payload
    original_write = manage.write_evidence_payload
    try:
        manage.market_data_refresh_payload = lambda **kwargs: calls.append(kwargs) or {  # type: ignore[assignment]
            "ok": True,
            "status": "ok",
            "task": {"id": "task-refresh-watchdog"},
            "cache_after": {"status": {"summary": {"stale": 8, "recommended": 3}}},
        }
        manage.write_evidence_payload = lambda payload, prefix: writes.append(prefix) or Path("/tmp/watchdog-refresh.json")  # type: ignore[assignment]
        payload = {
            "critical": [],
            "checks": [
                {"name": "data_cache_recommended_refresh", "ok": False, "data": {"recommended": 4}},
                {"name": "live_submit_locked", "ok": True},
                {"name": "dry_run_only", "ok": True},
                {"name": "live_trading_enabled", "ok": True},
                {"name": "live_order_enabled", "ok": True},
                {"name": "live_cancel_enabled", "ok": True},
            ],
        }
        state: dict[str, object] = {}
        summary = manage.maybe_run_watchdog_market_refresh(state, payload, now=2_000.0)
        assert summary["ok"] is True
        assert summary["task_id"] == "task-refresh-watchdog"
        assert summary["recommended_before"] == 4
        assert summary["recommended_after"] == 3
        assert calls[0]["max_items"] == 1
        assert calls[0]["recommended_only"] is True
        assert writes == ["market-data-refresh-watchdog"]

        throttled = manage.maybe_run_watchdog_market_refresh(state, payload, now=2_100.0)
        assert throttled is None
        assert len(calls) == 1

        unsafe_payload = {
            **payload,
            "checks": [
                {"name": "data_cache_recommended_refresh", "ok": False, "data": {"recommended": 4}},
                {"name": "live_submit_locked", "ok": False},
                {"name": "dry_run_only", "ok": True},
                {"name": "live_trading_enabled", "ok": True},
                {"name": "live_order_enabled", "ok": True},
                {"name": "live_cancel_enabled", "ok": True},
            ],
        }
        unsafe_state: dict[str, object] = {}
        skipped = manage.maybe_run_watchdog_market_refresh(unsafe_state, unsafe_payload, now=2_000.0)
        assert skipped is None
        assert unsafe_state["market_refresh_last_skip"] == "live_lock_not_healthy"
        assert len(calls) == 1
    finally:
        manage.market_data_refresh_payload = original_refresh  # type: ignore[assignment]
        manage.write_evidence_payload = original_write  # type: ignore[assignment]


def test_ai4trade_signal_alignment_requires_live_lock() -> None:
    spec = importlib.util.spec_from_file_location("manage_24x7", Path("scripts/manage_24x7.py"))
    assert spec and spec.loader
    manage = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(manage)

    ai4trade = {
        "configured": True,
        "policy": {
            "execution_allowed": False,
            "trade_endpoints_locked": True,
            "copy_trade_locked": True,
            "publish_locked": True,
            "okx_bridge": "disabled; AI4Trade can only annotate signals and market context.",
        },
    }
    ai_latest = {
        "configured": True,
        "signals": {"summary": {"count": 3, "symbols": [["BTC", 2]], "types": [["signal", 3]]}},
        "policy": {"trade_endpoints_locked": True},
    }
    automation = {
        "state": "waiting_ready_signal",
        "policy": {"dry_run_only": True, "can_submit_live": False},
        "readiness": {"stage": "missing_credentials"},
    }
    config = {
        "connector_status": {"dry_run_only": True, "can_submit_live": False},
        "live_submit_available": False,
    }
    ok, detail, data = manage.ai4trade_signal_alignment(ai4trade, ai_latest, 1, automation, config)
    assert ok is True
    assert "signals=3" in detail
    assert data["bridge_locked"] is True
    assert data["local_live_locked"] is True

    unsafe_config = {
        "connector_status": {"dry_run_only": True, "can_submit_live": True},
        "live_submit_available": True,
    }
    unsafe_ok, unsafe_detail, unsafe_data = manage.ai4trade_signal_alignment(ai4trade, ai_latest, 1, automation, unsafe_config)
    assert unsafe_ok is False
    assert "can_submit_live=True" in unsafe_detail
    assert unsafe_data["local_live_locked"] is False

    writable = {
        **ai4trade,
        "policy": {
            **ai4trade["policy"],
            "execution_allowed": True,
            "trade_endpoints_locked": False,
        },
    }
    writable_ok, _writable_detail, writable_data = manage.ai4trade_signal_alignment(writable, ai_latest, 1, automation, config)
    assert writable_ok is False
    assert writable_data["bridge_locked"] is False


def test_automation_ai4trade_alignment_status_requires_bridge_and_lock() -> None:
    readiness_summary = {
        "locks": {"dry_run_only": True, "can_submit_live": False},
    }
    policy = {"dry_run_only": True, "can_submit_live": False}
    history = {
        "count": 1,
        "latest": {
            "time": "2026-06-06T00:00:00+00:00",
            "configured": True,
            "signals": {"summary": {"count": 4, "symbols": [["BTC", 2]]}},
            "policy": {
                "trade_endpoints_locked": True,
                "copy_trade_locked": True,
                "publish_locked": True,
                "execution_allowed": False,
                "okx_bridge": "disabled; AI4Trade can only annotate signals and market context.",
            },
        },
    }
    status = app.automation_ai4trade_alignment_status(readiness_summary, policy, history)
    assert status["ok"] is True
    assert status["signal_count"] == 4
    assert status["bridge_locked"] is True
    assert status["local_live_locked"] is True

    unsafe_status = app.automation_ai4trade_alignment_status(
        {"locks": {"dry_run_only": True, "can_submit_live": True}},
        {"dry_run_only": True, "can_submit_live": True},
        history,
    )
    assert unsafe_status["ok"] is False
    assert unsafe_status["local_live_locked"] is False
    assert "can_submit_live=True" in unsafe_status["detail"]


def test_latest_recent_backtest_evidence_status_reads_launchd_evidence() -> None:
    original_dir = app.LAUNCHD_EVIDENCE_DIR
    temp_dir = app.CACHE_DIR / "test-app-recent-backtest-evidence"
    payload = {
        "ok": True,
        "status": "ok",
        "portfolio": {
            "ok": True,
            "result": {
                "summary": {"return_pct": 0.21, "final_equity": 12.1, "max_drawdown": 0.08, "trades": 5},
                "health": {"grade": "B", "score": 70},
            },
        },
        "slices": {"ok": True, "result": {"aggregate": {"cases": 3, "positive_cases": 2}}},
        "runtime": {"live_submit_locked": True, "live_env_locked": True},
    }
    try:
        temp_dir.mkdir(parents=True, exist_ok=True)
        app.LAUNCHD_EVIDENCE_DIR = temp_dir
        path = temp_dir / "recent-backtest-test.json"
        path.write_text(json.dumps(payload), encoding="utf-8")
        status = app.latest_recent_backtest_evidence_status()
        assert status["ok"] is True
        assert status["return_pct"] == 0.21
        assert status["health_grade"] == "B"
        assert status["locks_ok"] is True

        old = time.time() - app.RECENT_BACKTEST_EVIDENCE_FRESH_SECONDS - 60
        os.utime(path, (old, old))
        stale = app.latest_recent_backtest_evidence_status()
        assert stale["ok"] is False
        assert stale["fresh"] is False
    finally:
        app.LAUNCHD_EVIDENCE_DIR = original_dir
        for path in temp_dir.glob("*"):
            path.unlink()
        if temp_dir.exists():
            temp_dir.rmdir()


def test_import_secrets_restart_flag() -> None:
    spec = importlib.util.spec_from_file_location("manage_24x7", Path("scripts/manage_24x7.py"))
    assert spec and spec.loader
    manage = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(manage)

    restarted: list[list[str]] = []
    verified: list[bool] = []
    original_restart = manage.restart
    original_keychain_get = manage.keychain_get
    original_verify = manage.verify_import_readiness
    try:
        manage.restart = lambda args: restarted.append(list(args.services))
        manage.keychain_get = lambda _service, _account: ""
        manage.verify_import_readiness = lambda: verified.append(True)
        args = type(
            "Args",
            (),
            {
                "from_env_file": None,
                "from_process_env": False,
                "no_prompt": True,
                "restart": True,
                "verify": False,
                "skip_verify": False,
            },
        )()
        manage.import_secrets(args)
        assert restarted == [["backend", "ai4trade", "watchdog"]]
        assert verified == []
    finally:
        manage.restart = original_restart
        manage.keychain_get = original_keychain_get
        manage.verify_import_readiness = original_verify


def test_import_secrets_keychain_verify_summary() -> None:
    spec = importlib.util.spec_from_file_location("manage_24x7", Path("scripts/manage_24x7.py"))
    assert spec and spec.loader
    manage = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(manage)

    store: dict[tuple[str, str], str] = {}
    env_file = app.CACHE_DIR / "test-import-secrets.env"
    env_file.write_text(
        "\n".join(
            [
                "OKX_API_KEY=okx-key",
                "OKX_API_SECRET=okx-secret",
                "OKX_API_PASSPHRASE=okx-passphrase",
                "AI4TRADE_TOKEN=ai-token",
            ]
        ),
        encoding="utf-8",
    )
    original_set = manage.keychain_set
    original_get = manage.keychain_get
    try:
        manage.keychain_set = lambda service, account, value: store.__setitem__((service, account), value)
        manage.keychain_get = lambda service, account: store.get((service, account), "")
        args = type(
            "Args",
            (),
            {
                "from_env_file": str(env_file),
                "from_process_env": False,
                "no_prompt": True,
                "restart": False,
                "verify": False,
                "skip_verify": False,
            },
        )()
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            manage.import_secrets(args)
        text = output.getvalue()
        assert "keychain verify OKX: configured" in text
        assert "API_KEY:有" in text
        assert "API_SECRET:有" in text
        assert "API_PASSPHRASE:有" in text
        assert "keychain verify AI4Trade: token_present" in text
        assert "TOKEN:有" in text
    finally:
        manage.keychain_set = original_set
        manage.keychain_get = original_get
        if env_file.exists():
            env_file.unlink()


def test_import_secrets_restart_runs_post_verify_after_write() -> None:
    spec = importlib.util.spec_from_file_location("manage_24x7", Path("scripts/manage_24x7.py"))
    assert spec and spec.loader
    manage = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(manage)

    store: dict[tuple[str, str], str] = {}
    restarted: list[list[str]] = []
    verified: list[bool] = []
    env_file = app.CACHE_DIR / "test-import-secrets-restart.env"
    env_file.write_text(
        "\n".join(
            [
                "OKX_API_KEY=okx-key",
                "OKX_API_SECRET=okx-secret",
                "OKX_API_PASSPHRASE=okx-passphrase",
            ]
        ),
        encoding="utf-8",
    )
    original_set = manage.keychain_set
    original_get = manage.keychain_get
    original_restart = manage.restart
    original_verify = manage.verify_import_readiness
    try:
        manage.keychain_set = lambda service, account, value: store.__setitem__((service, account), value)
        manage.keychain_get = lambda service, account: store.get((service, account), "")
        manage.restart = lambda args: restarted.append(list(args.services))
        manage.verify_import_readiness = lambda: verified.append(True)
        args = type(
            "Args",
            (),
            {
                "from_env_file": str(env_file),
                "from_process_env": False,
                "no_prompt": True,
                "restart": True,
                "verify": False,
                "skip_verify": False,
            },
        )()
        manage.import_secrets(args)
        assert restarted == [["backend", "ai4trade", "watchdog"]]
        assert verified == [True]
    finally:
        manage.keychain_set = original_set
        manage.keychain_get = original_get
        manage.restart = original_restart
        manage.verify_import_readiness = original_verify
        if env_file.exists():
            env_file.unlink()


def test_verify_import_readiness_fails_if_live_lock_opens() -> None:
    spec = importlib.util.spec_from_file_location("manage_24x7", Path("scripts/manage_24x7.py"))
    assert spec and spec.loader
    manage = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(manage)

    original_wait = manage.wait_for_http
    original_readiness = manage.readiness_payload
    try:
        manage.wait_for_http = lambda _url, timeout_seconds=45.0: (  # type: ignore[assignment]
            True,
            {
                "okx_configured": True,
                "live_submit_available": True,
                "connector_status": {"dry_run_only": False, "can_submit_live": True},
            },
            "",
        )
        manage.readiness_payload = lambda _health=None: {  # type: ignore[assignment]
            "status": "live_lock_unsafe",
            "readonly_ready": False,
            "canary_review_ready": False,
            "next_action": "restore live lock",
            "locks": {
                "dry_run_only": False,
                "can_submit_live": True,
                "live_trading_enabled": False,
                "live_order_enabled": False,
                "live_cancel_enabled": False,
            },
            "checks": {"keychain_ok": True, "okx_readonly_ok": True},
        }
        try:
            manage.verify_import_readiness(timeout_seconds=1)
            raise AssertionError("verify_import_readiness should fail when live submit is open")
        except SystemExit as exc:
            assert "live submit lock" in str(exc)
    finally:
        manage.wait_for_http = original_wait
        manage.readiness_payload = original_readiness


def test_readiness_snapshot_history_is_sanitized() -> None:
    spec = importlib.util.spec_from_file_location("manage_24x7", Path("scripts/manage_24x7.py"))
    assert spec and spec.loader
    manage = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(manage)

    original_file = manage.READINESS_SNAPSHOT_FILE
    temp_file = app.CACHE_DIR / "test-readiness-snapshots.jsonl"
    if temp_file.exists():
        temp_file.unlink()
    try:
        manage.READINESS_SNAPSHOT_FILE = temp_file
        payload = {
            "status": "canary_review_ready",
            "stage": "manual_canary_review",
            "label": "人工Canary审核",
            "readonly_ready": True,
            "canary_review_ready": True,
            "next_action": "api_secret=secret-value signature=raw-signature",
            "blockers": [],
            "locks": {"dry_run_only": True, "can_submit_live": False, "live_trading_enabled": False, "live_order_enabled": False, "live_cancel_enabled": False},
            "checks": {"keychain_ok": True, "okx_readonly_ok": True, "no_real_submitted_orders": True},
            "latest_shadow_order": {"type": "shadow_live_order", "api_secret": "secret-value", "signature": "raw-signature", "dry_run_only": True, "can_submit_live": False},
            "top_task": {"id": "review_canary", "title": "复核Canary", "status": "ready", "command": "token=token-value", "dry_run_only": True, "can_submit_live": False},
            "health_status": "ok",
            "warnings": [],
            "critical": [],
            "updated_at": "2026-06-06T00:00:00+00:00",
        }
        entry = manage.append_readiness_snapshot(payload, source="test")
        history = manage.read_readiness_snapshots(limit=5)
        rendered = json.dumps(history, ensure_ascii=False).lower()
        assert entry["status"] == "canary_review_ready"
        assert history["count"] == 1
        assert history["rows"][0]["locks"]["dry_run_only"] is True
        assert history["rows"][0]["locks"]["can_submit_live"] is False
        assert "secret-value" not in rendered
        assert "raw-signature" not in rendered
        assert "token-value" not in rendered
        assert "<redacted>" in rendered
    finally:
        manage.READINESS_SNAPSHOT_FILE = original_file
        if temp_file.exists():
            temp_file.unlink()


def test_readiness_command_records_snapshot() -> None:
    spec = importlib.util.spec_from_file_location("manage_24x7", Path("scripts/manage_24x7.py"))
    assert spec and spec.loader
    manage = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(manage)

    original_file = manage.READINESS_SNAPSHOT_FILE
    original_payload = manage.readiness_payload
    temp_file = app.CACHE_DIR / "test-readiness-command-snapshots.jsonl"
    if temp_file.exists():
        temp_file.unlink()
    try:
        manage.READINESS_SNAPSHOT_FILE = temp_file
        manage.readiness_payload = lambda _health=None: {  # type: ignore[assignment]
            "status": "missing_credentials",
            "stage": "missing_credentials",
            "label": "缺少OKX密钥",
            "readonly_ready": False,
            "canary_review_ready": False,
            "next_action": "python3 scripts/manage_24x7.py import-secrets --restart",
            "blockers": ["缺少 OKX API Key / Secret / Passphrase"],
            "locks": {"dry_run_only": True, "can_submit_live": False, "live_trading_enabled": False, "live_order_enabled": False, "live_cancel_enabled": False},
            "checks": {"keychain_ok": False, "okx_readonly_ok": False, "live_submit_locked": True},
            "latest_shadow_order": {"type": "shadow_live_order", "would_submit": False, "dry_run_only": True, "can_submit_live": False},
            "top_task": {"id": "import_okx_keychain", "title": "导入 OKX Keychain", "status": "blocked", "dry_run_only": True, "can_submit_live": False},
            "health_status": "warning",
            "warnings": ["okx_credentials: missing_credentials"],
            "critical": [],
            "updated_at": "2026-06-06T00:00:00+00:00",
        }
        args = type("Args", (), {"json": False, "record": True, "source": "test"})()
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            manage.print_readiness(args)
        history = manage.read_readiness_snapshots(limit=5)
        assert "recorded readiness snapshot" in output.getvalue()
        assert history["count"] == 1
        assert history["latest"]["source"] == "test"
        assert history["latest"]["status"] == "missing_credentials"
    finally:
        manage.READINESS_SNAPSHOT_FILE = original_file
        manage.readiness_payload = original_payload
        if temp_file.exists():
            temp_file.unlink()


def test_watchdog_readiness_snapshot_auto_records_with_dedupe() -> None:
    spec = importlib.util.spec_from_file_location("manage_24x7", Path("scripts/manage_24x7.py"))
    assert spec and spec.loader
    manage = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(manage)

    original_file = manage.READINESS_SNAPSHOT_FILE
    original_payload = manage.readiness_payload
    temp_file = app.CACHE_DIR / "test-watchdog-readiness-snapshots.jsonl"
    if temp_file.exists():
        temp_file.unlink()
    payloads = [
        {
            "status": "missing_credentials",
            "stage": "missing_credentials",
            "label": "缺少OKX密钥",
            "readonly_ready": False,
            "canary_review_ready": False,
            "next_action": "api_secret=secret-value",
            "blockers": ["缺少 OKX API Key / Secret / Passphrase"],
            "locks": {"dry_run_only": True, "can_submit_live": False, "live_trading_enabled": False, "live_order_enabled": False, "live_cancel_enabled": False},
            "checks": {"keychain_ok": False, "okx_readonly_ok": False, "shadow_order_locked": True, "no_real_submitted_orders": True},
            "latest_shadow_order": {"type": "shadow_live_order", "would_submit": False, "dry_run_only": True, "can_submit_live": False},
            "top_task": {"id": "import_okx_keychain", "title": "导入 OKX Keychain", "status": "blocked", "dry_run_only": True, "can_submit_live": False},
            "health_status": "warning",
            "warnings": ["okx_credentials: missing_credentials"],
            "critical": [],
            "updated_at": "2026-06-06T00:00:00+00:00",
        },
        {
            "status": "readonly_failed",
            "stage": "waiting_signal",
            "label": "只读失败",
            "readonly_ready": False,
            "canary_review_ready": False,
            "next_action": "检查 OKX 权限",
            "blockers": ["OKX只读失败"],
            "locks": {"dry_run_only": True, "can_submit_live": False, "live_trading_enabled": False, "live_order_enabled": False, "live_cancel_enabled": False},
            "checks": {"keychain_ok": True, "okx_readonly_ok": False, "shadow_order_locked": True, "no_real_submitted_orders": True},
            "latest_shadow_order": {"type": "shadow_live_order", "would_submit": False, "dry_run_only": True, "can_submit_live": False},
            "top_task": {"id": "fix_okx_readonly", "title": "修复OKX只读", "status": "blocked", "dry_run_only": True, "can_submit_live": False},
            "health_status": "warning",
            "warnings": ["okx_readonly: permission_denied"],
            "critical": [],
            "updated_at": "2026-06-06T00:01:00+00:00",
        },
    ]
    calls = {"index": 0}
    try:
        manage.READINESS_SNAPSHOT_FILE = temp_file
        manage.readiness_payload = lambda _health=None: payloads[calls["index"]]  # type: ignore[assignment]
        state: dict[str, object] = {}
        first = manage.maybe_record_watchdog_readiness_snapshot(state, now=1000)
        second = manage.maybe_record_watchdog_readiness_snapshot(state, now=1010)
        third = manage.maybe_record_watchdog_readiness_snapshot(state, now=1000 + manage.READINESS_SNAPSHOT_WATCHDOG_INTERVAL_SECONDS + 1)
        calls["index"] = 1
        fourth = manage.maybe_record_watchdog_readiness_snapshot(state, now=1020)
        history = manage.read_readiness_snapshots(limit=10)
        rendered = json.dumps(history, ensure_ascii=False).lower()
        assert first and first["source"] == "watchdog"
        assert second is None
        assert third and third["status"] == "missing_credentials"
        assert fourth and fourth["status"] == "readonly_failed"
        assert history["count"] == 3
        assert "secret-value" not in rendered
        assert "<redacted>" in rendered
    finally:
        manage.READINESS_SNAPSHOT_FILE = original_file
        manage.readiness_payload = original_payload
        if temp_file.exists():
            temp_file.unlink()


def test_readiness_payload_reuses_supplied_health_payload() -> None:
    spec = importlib.util.spec_from_file_location("manage_24x7", Path("scripts/manage_24x7.py"))
    assert spec and spec.loader
    manage = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(manage)

    original_collect = manage.collect_health
    original_http = manage.http_request
    now = "2026-06-06T00:00:00+00:00"
    supplied_health = {
        "ok": True,
        "status": "ok",
        "warnings": [],
        "critical": [],
        "checks": [
            {"name": "okx_readonly", "ok": True, "detail": "readonly_ok"},
            {"name": "no_real_submitted_orders", "ok": True, "detail": "no submitted exchange order"},
        ],
    }

    def fake_http(url: str, timeout: float = 8.0):
        if url.endswith("/api/automation/status"):
            return True, {
                "heartbeat_fresh": True,
                "readiness": {"stage": "manual_canary_review", "label": "人工Canary审核", "next_action": "复核"},
                "task_board": {"top_task": {"id": "review_canary", "status": "ready"}},
                "preflight_history": {
                    "latest": {
                        "time": now,
                        "summary": {
                            "shadow_order": {
                                "present": True,
                                "type": "shadow_live_order",
                                "would_submit": False,
                                "dry_run_only": True,
                                "can_submit_live": False,
                            }
                        },
                    }
                },
            }, ""
        if url.endswith("/api/execution/config"):
            return True, {
                "okx_configured": True,
                "okx_keychain": {"configured": True},
                "connector_status": {"dry_run_only": True, "can_submit_live": False},
                "live_trading_enabled": False,
                "live_order_enabled": False,
                "live_cancel_enabled": False,
            }, ""
        return False, {}, f"unexpected URL {url}"

    try:
        manage.collect_health = lambda: (_ for _ in ()).throw(AssertionError("collect_health should not be called"))  # type: ignore[assignment]
        manage.http_request = fake_http
        payload = manage.readiness_payload(supplied_health)
        assert payload["status"] == "canary_review_ready"
        assert payload["readonly_ready"] is True
        assert payload["canary_review_ready"] is True
        assert payload["checks"]["okx_readonly_ok"] is True
        assert payload["checks"]["no_real_submitted_orders"] is True
    finally:
        manage.collect_health = original_collect
        manage.http_request = original_http


def test_secrets_status_payload() -> None:
    spec = importlib.util.spec_from_file_location("manage_24x7", Path("scripts/manage_24x7.py"))
    assert spec and spec.loader
    manage = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(manage)

    present = {
        (manage.OKX_KEYCHAIN_SERVICE, "OKX_API_KEY"),
        (manage.OKX_KEYCHAIN_SERVICE, "OKX_API_SECRET"),
        (manage.OKX_KEYCHAIN_SERVICE, "OKX_API_PASSPHRASE"),
        (manage.AI4TRADE_KEYCHAIN_SERVICE, "AI4TRADE_TOKEN"),
    }
    original_get = manage.keychain_get
    try:
        manage.keychain_get = lambda service, account: "value" if (service, account) in present else ""
        payload = manage.secrets_status_payload()
        assert payload["okx"]["configured"] is True
        assert payload["okx"]["keys"]["OKX_API_KEY"] is True
        assert payload["ai4trade"]["configured"] is True
        assert payload["ai4trade"]["keys"]["AI4TRADE_AGENT_ID"] is False
    finally:
        manage.keychain_get = original_get


def test_evidence_bundle_payload_summarizes_locks_and_redacts() -> None:
    spec = importlib.util.spec_from_file_location("manage_24x7", Path("scripts/manage_24x7.py"))
    assert spec and spec.loader
    manage = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(manage)

    original_collect = manage.collect_health
    original_readiness = manage.readiness_payload
    original_history = manage.read_readiness_snapshots
    original_secrets = manage.secrets_status_payload
    original_services = manage.service_status_payload
    original_shadow = manage.execution_ledger_shadow_status
    original_submitted = manage.execution_ledger_has_live_submit
    try:
        manage.collect_health = lambda: {  # type: ignore[assignment]
            "ok": True,
            "status": "warning",
            "critical": [],
            "warnings": ["okx_readonly: signature=raw-signature"],
            "checks": [
                {"name": "paper_loop_running", "ok": True, "severity": "critical", "detail": "paper.running=true", "data": {}},
                {"name": "no_real_submitted_orders", "ok": True, "severity": "critical", "detail": "no submitted exchange order", "data": {}},
                {"name": "account_equity_source", "ok": True, "severity": "warning", "detail": "source=okx_readonly equity=10", "data": {}},
                {"name": "account_equity_history", "ok": True, "severity": "warning", "detail": "2 rows", "data": {}},
                {"name": "okx_keychain", "ok": True, "severity": "warning", "detail": "Keychain credentials present", "data": {}},
                {"name": "okx_readonly", "ok": True, "severity": "warning", "detail": "readonly_ok token=raw-token", "data": {}},
            ],
            "updated_at": "2026-06-06T00:00:00+00:00",
        }
        manage.readiness_payload = lambda _health=None: {  # type: ignore[assignment]
            "status": "waiting_ready_signal",
            "readonly_ready": True,
            "canary_review_ready": False,
            "stage": "waiting_signal",
            "label": "等待信号",
            "next_action": "api_secret=secret-value signature=raw-signature",
            "blockers": [],
            "top_task": {"id": "watch_market", "title": "观察信号", "status": "running"},
            "locks": {
                "dry_run_only": True,
                "can_submit_live": False,
                "live_trading_enabled": False,
                "live_order_enabled": False,
                "live_cancel_enabled": False,
            },
            "checks": {
                "keychain_ok": True,
                "okx_readonly_ok": True,
                "heartbeat_fresh": True,
                "shadow_order_locked": True,
                "no_real_submitted_orders": True,
                "live_submit_locked": True,
                "live_env_locked": True,
            },
            "latest_shadow_order": {
                "type": "shadow_live_order",
                "would_submit": False,
                "dry_run_only": True,
                "can_submit_live": False,
                "blocked_reason": "passphrase=secret-passphrase",
            },
        }
        manage.read_readiness_snapshots = lambda limit=10: {  # type: ignore[assignment]
            "count": 1,
            "latest": {"status": "waiting_ready_signal", "next_action": "api_secret=secret-value"},
            "rows": [{"status": "waiting_ready_signal", "next_action": "api_secret=secret-value"}],
            "path": "snapshots.jsonl",
        }
        manage.secrets_status_payload = lambda: {  # type: ignore[assignment]
            "okx": {
                "service": "okx-perp-bot",
                "configured": True,
                "keys": {"OKX_API_KEY": True, "OKX_API_SECRET": True, "OKX_API_PASSPHRASE": True},
                "detail": "API_KEY:有 · API_SECRET:有 · API_PASSPHRASE:有",
            },
            "ai4trade": {
                "service": "ai4trade",
                "configured": True,
                "keys": {"AI4TRADE_TOKEN": True, "AI4TRADE_AGENT_ID": False, "AI4TRADE_AGENT_NAME": False},
                "detail": "TOKEN:有",
            },
        }
        manage.service_status_payload = lambda names=None: {  # type: ignore[assignment]
            "ok": True,
            "count": 5,
            "services": [{"name": "backend", "active": True}],
            "updated_at": "2026-06-06T00:00:00+00:00",
        }
        manage.execution_ledger_shadow_status = lambda: {  # type: ignore[assignment]
            "present": True,
            "ok": True,
            "locked": True,
            "payload_hash_ok": True,
            "detail": "live_submit_rejected token=raw-token",
            "latest": {"event": "live_submit_rejected", "blocked_reason": "signature=raw-signature"},
        }
        manage.execution_ledger_has_live_submit = lambda: (False, None)  # type: ignore[assignment]

        payload = manage.evidence_bundle_payload()
        assert payload["summary"]["safe_to_keep_running"] is True
        assert payload["summary"]["ready_for_okx_readonly_validation"] is True
        assert payload["summary"]["ready_for_real_submit"] is False
        assert payload["locks"]["dry_run_only"] is True
        assert payload["locks"]["can_submit_live"] is False
        assert payload["credential_presence"][0]["items"][0]["present"] is True
        rendered = json.dumps(payload, ensure_ascii=False)
        assert "secret-value" not in rendered
        assert "raw-signature" not in rendered
        assert "secret-passphrase" not in rendered
        assert "raw-token" not in rendered
    finally:
        manage.collect_health = original_collect
        manage.readiness_payload = original_readiness
        manage.read_readiness_snapshots = original_history
        manage.secrets_status_payload = original_secrets
        manage.service_status_payload = original_services
        manage.execution_ledger_shadow_status = original_shadow
        manage.execution_ledger_has_live_submit = original_submitted


def test_evidence_bundle_write_uses_sanitized_json() -> None:
    spec = importlib.util.spec_from_file_location("manage_24x7", Path("scripts/manage_24x7.py"))
    assert spec and spec.loader
    manage = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(manage)

    temp_dir = app.CACHE_DIR / "test-evidence-bundle"
    original_dir = manage.EVIDENCE_BUNDLE_DIR
    try:
        manage.EVIDENCE_BUNDLE_DIR = temp_dir
        payload = manage.sanitize_for_log({"next_action": "api_secret=secret-value", "locks": {"dry_run_only": True, "can_submit_live": False}})
        path = manage.write_evidence_bundle(payload)
        text = path.read_text(encoding="utf-8")
        assert path.exists()
        assert "secret-value" not in text
        assert "api_secret=<redacted>" in text
        assert '"dry_run_only": true' in text
    finally:
        manage.EVIDENCE_BUNDLE_DIR = original_dir
        for path in temp_dir.glob("*"):
            path.unlink()
        if temp_dir.exists():
            temp_dir.rmdir()


def test_pre_live_gate_blocks_readonly_without_okx_keychain() -> None:
    spec = importlib.util.spec_from_file_location("manage_24x7", Path("scripts/manage_24x7.py"))
    assert spec and spec.loader
    manage = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(manage)

    health = {
        "checks": [
            {"name": "paper_loop_running", "ok": True, "detail": "paper.running=true", "severity": "critical"},
            {"name": "no_real_submitted_orders", "ok": True, "detail": "no submitted exchange order", "severity": "critical"},
            {"name": "execution_shadow_recent", "ok": True, "detail": "updated 10s ago", "severity": "warning"},
            {"name": "automation_task_board_evidence", "ok": True, "detail": "watchdog task evidence ok", "severity": "warning"},
            {"name": "ai4trade_history_readonly_policy", "ok": True, "detail": "trade endpoints locked", "severity": "critical"},
            {"name": "ai4trade_signal_alignment", "ok": True, "detail": "signals=3 · ai4trade_bridge=locked · can_submit_live=False", "severity": "warning"},
            {"name": "okx_keychain", "ok": False, "detail": "keychain_missing", "severity": "warning"},
            {"name": "okx_readonly", "ok": False, "detail": "missing_credentials", "severity": "warning"},
            {"name": "account_equity_source", "ok": True, "detail": "source=paper_loop expected=paper_loop equity=10", "severity": "warning"},
        ],
    }
    readiness = {
        "status": "missing_credentials",
        "next_action": "python3 scripts/manage_24x7.py import-secrets --restart",
        "locks": {
            "dry_run_only": True,
            "can_submit_live": False,
            "live_trading_enabled": False,
            "live_order_enabled": False,
            "live_cancel_enabled": False,
        },
        "checks": {
            "keychain_ok": False,
            "okx_readonly_ok": False,
            "no_real_submitted_orders": True,
            "shadow_order_locked": True,
            "heartbeat_fresh": True,
        },
    }
    payload = manage.pre_live_gate_payload("readonly", health_payload=health, readiness=readiness, services={"ok": True, "count": 5})
    blocker_names = {row["name"] for row in payload["blockers"]}
    assert payload["status"] == "no_go"
    assert "okx_keychain" in blocker_names
    assert "okx_readonly" in blocker_names
    assert "okx_equity_source" in blocker_names
    assert "live_submit_locked" not in blocker_names
    assert any(row["name"] == "automation_task_board_evidence" and row["ok"] for row in payload["checks"])
    assert any(row["name"] == "ai4trade_signal_alignment" and row["ok"] for row in payload["checks"])
    assert payload["locks"]["can_submit_live"] is False


def test_pre_live_gate_keeps_live_submit_blocked_by_policy() -> None:
    spec = importlib.util.spec_from_file_location("manage_24x7", Path("scripts/manage_24x7.py"))
    assert spec and spec.loader
    manage = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(manage)

    health = {
        "checks": [
            {"name": "paper_loop_running", "ok": True, "detail": "paper.running=true", "severity": "critical"},
            {"name": "no_real_submitted_orders", "ok": True, "detail": "no submitted exchange order", "severity": "critical"},
            {"name": "execution_shadow_recent", "ok": True, "detail": "updated 10s ago", "severity": "warning"},
            {"name": "automation_task_board_evidence", "ok": True, "detail": "watchdog task evidence ok", "severity": "warning"},
            {"name": "ai4trade_history_readonly_policy", "ok": True, "detail": "trade endpoints locked", "severity": "critical"},
            {"name": "ai4trade_signal_alignment", "ok": True, "detail": "signals=3 · ai4trade_bridge=locked · can_submit_live=False", "severity": "warning"},
            {"name": "okx_keychain", "ok": True, "detail": "Keychain credentials present", "severity": "warning"},
            {"name": "okx_readonly", "ok": True, "detail": "readonly_ok", "severity": "warning"},
            {"name": "account_equity_source", "ok": True, "detail": "source=okx_readonly expected=okx_readonly equity=10", "severity": "warning"},
            {"name": "automation_heartbeat_fresh", "ok": True, "detail": "updated 10s ago", "severity": "warning"},
        ],
    }
    readiness = {
        "status": "canary_review_ready",
        "canary_review_ready": True,
        "next_action": "人工复核 Canary payload",
        "locks": {
            "dry_run_only": True,
            "can_submit_live": False,
            "live_trading_enabled": False,
            "live_order_enabled": False,
            "live_cancel_enabled": False,
        },
        "checks": {
            "keychain_ok": True,
            "okx_readonly_ok": True,
            "no_real_submitted_orders": True,
            "shadow_order_locked": True,
            "heartbeat_fresh": True,
        },
    }
    readonly_payload = manage.pre_live_gate_payload("readonly", health_payload=health, readiness=readiness, services={"ok": True, "count": 5})
    canary_payload = manage.pre_live_gate_payload("canary", health_payload=health, readiness=readiness, services={"ok": True, "count": 5})
    payload = manage.pre_live_gate_payload("live-submit", health_payload=health, readiness=readiness, services={"ok": True, "count": 5})
    assert readonly_payload["status"] == "go"
    assert readonly_payload["ok"] is True
    assert any(row["name"] == "automation_task_board_evidence" and row["ok"] for row in readonly_payload["checks"])
    assert canary_payload["status"] == "go"
    assert canary_payload["ok"] is True
    blocker_names = {row["name"] for row in payload["blockers"]}
    assert payload["status"] == "no_go"
    assert blocker_names == {"manual_live_unlock_review"}
    assert payload["locks"]["dry_run_only"] is True
    assert payload["locks"]["can_submit_live"] is False


def test_shadow_order_evidence_is_locked_and_redacted() -> None:
    old_values = {key: os.environ.get(key) for key in app.OKX_ENV_KEYS}
    try:
        os.environ["OKX_API_KEY"] = "shadow-key-1234"
        os.environ["OKX_API_SECRET"] = "shadow-secret"
        os.environ["OKX_API_PASSPHRASE"] = "shadow-pass"
        payload = {
            "instId": "BTC-USDT-SWAP",
            "tdMode": "isolated",
            "side": "buy",
            "ordType": "market",
            "sz": "1",
            "clOrdId": "qs-shadow-test",
        }
        evidence = app.okx_shadow_order_evidence(
            {"ok": True, "payload": payload},
            {
                "allow_submit": False,
                "decision": "仅差实盘锁",
                "blocked_reasons": ["当前仍保持真实下单总锁关闭。"],
                "checks": [
                    {
                        "name": "实盘总开关",
                        "passed": False,
                        "severity": "live_lock",
                        "status": "live_lock",
                        "action": "当前仍保持真实下单总锁关闭。",
                    }
                ],
            },
            submit_mode="standard",
            source="unit_test",
        )
        assert evidence["would_submit"] is False
        assert evidence["submitted"] is False
        assert evidence["dry_run_only"] is True
        assert evidence["can_submit_live"] is False
        assert evidence["payload_sha256"]
        assert evidence["client_order_id"] == "qs-shadow-test"
        assert evidence["final_gate"]["live_locks"][0]["name"] == "实盘总开关"
        text = json.dumps(evidence, ensure_ascii=False)
        assert "shadow-secret" not in text
        assert "shadow-pass" not in text
        assert "shadow-key-1234" not in text
    finally:
        for key, value in old_values.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value


def test_automation_summary_includes_shadow_order() -> None:
    result = {
        "mode": "dry_run",
        "intent_fingerprint": "abc123",
        "guard": {"decision": "仅 dry-run", "allow_dry_run": True, "allow_live": False},
        "final_gate": {"decision": "仅差实盘锁"},
        "order_intent": {"side": "long", "notional": 10},
        "okx_order": {"ok": True, "status": "ready"},
        "okx": {"position_count": 0},
        "equity_source": "okx_readonly",
        "shadow_order": {
            "type": "shadow_live_order",
            "would_submit": False,
            "dry_run_only": True,
            "can_submit_live": False,
            "payload_ready": True,
            "payload_sha256": "abc",
            "client_order_id": "qs-test",
            "blocked_reason": "secret=must-not-leak",
            "final_gate": {"decision": "仅差实盘锁"},
        },
    }
    summary = app.automation_result_summary(result)
    shadow = summary["shadow_order"]
    assert shadow["present"] is True
    assert shadow["would_submit"] is False
    assert shadow["dry_run_only"] is True
    assert shadow["can_submit_live"] is False
    assert shadow["payload_sha256"] == "abc"
    assert shadow["client_order_id"] == "qs-test"
    assert "must-not-leak" not in json.dumps(summary, ensure_ascii=False)
    history_entry = app.automation_preflight_history_entry(
        source="unit",
        state="preflight_passed",
        signal_hash="sig",
        signal={"inst_id": "BTC-USDT-SWAP", "bar": "15m", "status": "ready"},
        summary=summary,
    )
    assert history_entry["summary"]["shadow_order"]["present"] is True
    assert history_entry["summary"]["shadow_order"]["can_submit_live"] is False


def test_manage_shadow_status_reads_latest_ledger_evidence() -> None:
    spec = importlib.util.spec_from_file_location("manage_24x7", Path("scripts/manage_24x7.py"))
    assert spec and spec.loader
    manage = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(manage)

    temp_dir = app.CACHE_DIR / "test-manage-shadow"
    temp_file = temp_dir / "execution-orders.jsonl"
    original_cache = manage.CACHE_DIR
    try:
        temp_dir.mkdir(exist_ok=True)
        temp_file.write_text(
            json.dumps(
                {
                    "time": "2026-06-06T00:00:00+00:00",
                    "event": "dry_run",
                    "status": "candidate",
                    "shadow_order": {
                        "type": "shadow_live_order",
                        "would_submit": False,
                        "dry_run_only": True,
                        "can_submit_live": False,
                        "payload_ready": True,
                        "payload_sha256": "hash",
                    },
                },
                ensure_ascii=False,
            )
            + "\n",
            encoding="utf-8",
        )
        manage.CACHE_DIR = temp_dir
        status = manage.execution_ledger_shadow_status()
        assert status["present"] is True
        assert status["ok"] is True
        assert status["locked"] is True
        assert status["payload_hash_ok"] is True
        assert status["latest"]["payload_sha256"] == "hash"
    finally:
        manage.CACHE_DIR = original_cache
        if temp_file.exists():
            temp_file.unlink()
        if temp_dir.exists():
            temp_dir.rmdir()


def test_manage_readiness_payload_summarizes_go_no_go() -> None:
    spec = importlib.util.spec_from_file_location("manage_24x7", Path("scripts/manage_24x7.py"))
    assert spec and spec.loader
    manage = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(manage)

    locked_shadow = {
        "present": True,
        "type": "shadow_live_order",
        "would_submit": False,
        "dry_run_only": True,
        "can_submit_live": False,
        "payload_ready": True,
        "payload_sha256": "hash",
    }
    base_automation = {
        "heartbeat_fresh": True,
        "readiness": {"stage": "manual_canary_review", "label": "人工Canary审核", "blockers": [], "next_action": "复核"},
        "task_board": {"top_task": {"id": "manual_canary_review", "title": "人工 Canary 审核", "status": "review"}},
        "preflight_history": {"latest": {"summary": {"shadow_order": locked_shadow}}},
        "event_history": {"latest": {"preflight": {"shadow_order": locked_shadow}}},
    }
    ready_config = {
        "okx_configured": True,
        "okx_keychain": {"configured": True},
        "connector_status": {"dry_run_only": True, "can_submit_live": False},
        "live_trading_enabled": False,
        "live_order_enabled": False,
        "live_cancel_enabled": False,
    }
    ready_health = {
        "ok": True,
        "status": "ok",
        "warnings": [],
        "critical": [],
        "checks": [
            {"name": "okx_readonly", "ok": True, "detail": "readonly_ok"},
            {"name": "no_real_submitted_orders", "ok": True, "detail": "none"},
        ],
    }
    original_collect = manage.collect_health
    original_http = manage.http_request
    try:
        manage.collect_health = lambda: ready_health  # type: ignore[assignment]
        manage.http_request = lambda url, timeout=8: (True, ready_config if "execution/config" in url else base_automation, "")  # type: ignore[assignment]
        ready = manage.readiness_payload()
        assert ready["status"] == "canary_review_ready"
        assert ready["readonly_ready"] is True
        assert ready["canary_review_ready"] is True
        assert ready["checks"]["shadow_order_locked"] is True
        assert ready["checks"]["live_env_locked"] is True

        missing_config = {
            **ready_config,
            "okx_configured": False,
            "okx_keychain": {"configured": False},
        }
        missing_health = {
            **ready_health,
            "status": "warning",
            "warnings": ["okx_credentials: missing_credentials"],
            "checks": [
                {"name": "okx_readonly", "ok": False, "detail": "missing_credentials"},
                {"name": "no_real_submitted_orders", "ok": True, "detail": "none"},
            ],
        }
        missing_automation = {
            **base_automation,
            "readiness": {"stage": "missing_credentials", "label": "缺少OKX密钥", "blockers": ["缺少密钥"], "next_action": "导入密钥"},
            "task_board": {"top_task": {"id": "import_okx_keychain", "title": "导入 OKX Keychain", "status": "blocked", "command": "python3 scripts/manage_24x7.py import-secrets --restart"}},
        }
        manage.collect_health = lambda: missing_health  # type: ignore[assignment]
        manage.http_request = lambda url, timeout=8: (True, missing_config if "execution/config" in url else missing_automation, "")  # type: ignore[assignment]
        missing = manage.readiness_payload()
        assert missing["status"] == "missing_credentials"
        assert missing["readonly_ready"] is False
        assert missing["canary_review_ready"] is False
        assert missing["top_task"]["id"] == "import_okx_keychain"
    finally:
        manage.collect_health = original_collect  # type: ignore[assignment]
        manage.http_request = original_http  # type: ignore[assignment]


def test_manage_tasks_command_formats_task_board() -> None:
    spec = importlib.util.spec_from_file_location("manage_24x7", Path("scripts/manage_24x7.py"))
    assert spec and spec.loader
    manage = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(manage)

    original_http = manage.http_request
    try:
        manage.http_request = lambda _url, timeout=8: (  # type: ignore[assignment]
            True,
            {
                "count": 1,
                "critical_count": 0,
                "blocked_count": 1,
                "stage": "missing_credentials",
                "state": "waiting_ready_signal",
                "top_task": {"id": "import_okx_keychain", "title": "导入 OKX Keychain", "status": "blocked"},
                "tasks": [
                    {
                        "id": "import_okx_keychain",
                        "title": "导入 OKX Keychain",
                        "status": "blocked",
                        "detail": "缺少 OKX 密钥",
                        "command": "python3 scripts/manage_24x7.py import-secrets --restart",
                    }
                ],
            },
            "",
        )
        args = type("Args", (), {"json": False, "write": False})()
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            manage.print_tasks(args)
        text = output.getvalue()
        assert "automation tasks: 1" in text
        assert "top task: import_okx_keychain" in text
        assert "import-secrets --restart" in text
    finally:
        manage.http_request = original_http


def test_manage_tasks_command_writes_task_board_evidence() -> None:
    spec = importlib.util.spec_from_file_location("manage_24x7", Path("scripts/manage_24x7.py"))
    assert spec and spec.loader
    manage = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(manage)

    original_http = manage.http_request
    original_write = manage.write_evidence_payload
    written: list[tuple[dict, str]] = []
    try:
        manage.http_request = lambda _url, timeout=8: (  # type: ignore[assignment]
            True,
            {
                "count": 1,
                "critical_count": 0,
                "blocked_count": 1,
                "stage": "missing_credentials",
                "state": "waiting_ready_signal",
                "top_task": {"id": "import_okx_keychain", "title": "导入 OKX Keychain", "status": "blocked"},
                "tasks": [
                    {
                        "id": "import_okx_keychain",
                        "title": "导入 OKX Keychain",
                        "status": "blocked",
                        "detail": "缺少 OKX 密钥",
                        "command": "python3 scripts/manage_24x7.py import-secrets --restart",
                        "api_secret": "must-not-leak",
                    }
                ],
            },
            "",
        )

        def fake_write(payload: dict, prefix: str) -> Path:
            written.append((payload, prefix))
            return Path("/tmp/automation-task-board-test.json")

        manage.write_evidence_payload = fake_write  # type: ignore[assignment]
        args = type("Args", (), {"json": False, "write": True})()
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            manage.print_tasks(args)
        text = output.getvalue()
        assert "wrote automation task evidence" in text
        assert written[0][1] == "automation-task-board"
        assert written[0][0]["top_task"]["id"] == "import_okx_keychain"
        rendered = json.dumps(written[0][0], ensure_ascii=False).lower()
        assert "must-not-leak" not in rendered
        assert "<redacted>" in rendered
    finally:
        manage.http_request = original_http
        manage.write_evidence_payload = original_write


def test_manage_task_action_posts_receipt() -> None:
    spec = importlib.util.spec_from_file_location("manage_24x7", Path("scripts/manage_24x7.py"))
    assert spec and spec.loader
    manage = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(manage)

    calls: list[dict[str, object]] = []
    original_post = manage.post_json
    try:
        def fake_post(url: str, payload: dict[str, object], timeout: float = 8.0):
            calls.append({"url": url, "payload": payload, "timeout": timeout})
            return True, {"ok": True, "entry": {"task_id": payload["task_id"], "status": payload["status"], "dry_run_only": True, "can_submit_live": False}}, ""

        manage.post_json = fake_post
        args = type("Args", (), {"task_id": "import_okx_keychain", "action": "acknowledged", "status": None, "note": "noted", "json": False})()
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            manage.record_task_action(args)
        assert calls
        assert calls[0]["url"] == "http://127.0.0.1:8765/api/automation/task-action"
        assert calls[0]["payload"]["task_id"] == "import_okx_keychain"
        assert "dry_run_only=True" in output.getvalue()
    finally:
        manage.post_json = original_post


def test_manage_live_lock_test_rejects_submit_path() -> None:
    spec = importlib.util.spec_from_file_location("manage_24x7", Path("scripts/manage_24x7.py"))
    assert spec and spec.loader
    manage = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(manage)

    calls: list[dict[str, object]] = []
    original_post = manage.post_json
    try:
        def fake_post(url: str, payload: dict[str, object], timeout: float = 12.0):
            calls.append({"url": url, "payload": payload, "timeout": timeout})
            return True, {
                "submitted": False,
                "decision": "真实提交已锁定",
                "submit_mode": "standard",
                "blocked_reasons": ["未开启时拒绝真实提交。"],
                "shadow_order": {"type": "shadow_live_order", "would_submit": False, "dry_run_only": True, "can_submit_live": False},
                "connector_attempt": {"connector": {"can_submit_live": False}},
            }, ""

        manage.post_json = fake_post
        args = type("Args", (), {"confirmation": "", "use_canary": False, "intent_json": None, "skip_readiness_record": True, "json": False})()
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            manage.print_live_lock_test(args)
        assert calls[0]["url"] == "http://127.0.0.1:8765/api/execution/live-submit"
        assert calls[0]["payload"]["confirmation"] == ""
        assert "ok=True" in output.getvalue()
        assert "submitted=False" in output.getvalue()
    finally:
        manage.post_json = original_post


def test_manage_live_lock_test_fails_if_submitted() -> None:
    spec = importlib.util.spec_from_file_location("manage_24x7", Path("scripts/manage_24x7.py"))
    assert spec and spec.loader
    manage = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(manage)

    original_post = manage.post_json
    try:
        manage.post_json = lambda _url, _payload, timeout=12.0: (  # type: ignore[assignment]
            True,
            {
                "submitted": True,
                "decision": "真实提交已发送",
                "shadow_order": {},
                "connector_attempt": {"connector": {"can_submit_live": True}},
            },
            "",
        )
        args = type("Args", (), {"confirmation": "CONFIRM_LIVE_TRADE", "use_canary": False, "intent_json": None, "skip_readiness_record": True, "json": True})()
        try:
            with contextlib.redirect_stdout(io.StringIO()):
                manage.print_live_lock_test(args)
            raise AssertionError("live lock test must fail when submitted=true")
        except SystemExit as exc:
            assert "live submit lock test failed" in str(exc)
    finally:
        manage.post_json = original_post


def test_manage_live_lock_test_records_readiness_snapshot() -> None:
    spec = importlib.util.spec_from_file_location("manage_24x7", Path("scripts/manage_24x7.py"))
    assert spec and spec.loader
    manage = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(manage)

    original_post = manage.post_json
    original_record = manage.record_live_lock_readiness_snapshot
    recorded: list[str] = []
    try:
        manage.post_json = lambda _url, _payload, timeout=12.0: (  # type: ignore[assignment]
            True,
            {
                "submitted": False,
                "decision": "真实提交已锁定",
                "blocked_reasons": ["locked"],
                "shadow_order": {"type": "shadow_live_order", "would_submit": False, "dry_run_only": True, "can_submit_live": False},
                "connector_attempt": {"connector": {"can_submit_live": False}},
            },
            "",
        )
        manage.record_live_lock_readiness_snapshot = lambda source: recorded.append(source) or {"source": source, "status": "missing_credentials", "time": "2026-06-06T00:00:00+00:00"}
        args = type("Args", (), {"confirmation": "", "use_canary": False, "intent_json": None, "skip_readiness_record": False, "json": False})()
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            manage.print_live_lock_test(args)
        assert recorded == ["live_lock_test"]
        assert "recorded readiness snapshot" in output.getvalue()
    finally:
        manage.post_json = original_post
        manage.record_live_lock_readiness_snapshot = original_record


def test_watchdog_live_lock_test_runs_when_shadow_stale() -> None:
    spec = importlib.util.spec_from_file_location("manage_24x7", Path("scripts/manage_24x7.py"))
    assert spec and spec.loader
    manage = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(manage)

    calls: list[dict[str, object]] = []
    original_post = manage.post_json
    original_notify = manage.notify
    original_record = manage.record_live_lock_readiness_snapshot
    notifications: list[tuple[str, str]] = []
    try:
        def fake_post(url: str, payload: dict[str, object], timeout: float = 12.0):
            calls.append({"url": url, "payload": payload, "timeout": timeout})
            return True, {
                "submitted": False,
                "decision": "真实提交已锁定",
                "shadow_order": {"type": "shadow_live_order", "would_submit": False, "dry_run_only": True, "can_submit_live": False},
                "connector_attempt": {"connector": {"can_submit_live": False}},
            }, ""

        manage.post_json = fake_post
        manage.notify = lambda title, message: notifications.append((title, message))
        manage.record_live_lock_readiness_snapshot = lambda source: {"source": source, "status": "missing_credentials", "time": "2026-06-06T00:00:00+00:00"}
        state: dict[str, object] = {}
        health = {"checks": [{"name": "execution_shadow_recent", "ok": False, "detail": "stale"}]}
        summary = manage.maybe_run_watchdog_live_lock_test(state, health, now=1000)
        assert summary and summary["ok"] is True
        assert calls[0]["payload"]["confirmation"] == ""
        assert calls[0]["payload"]["source"] == "watchdog_live_lock_test"
        assert state["live_lock_test_ok"] is True
        assert state["live_lock_test_readiness_snapshot_status"] == "missing_credentials"
        assert notifications == []
    finally:
        manage.post_json = original_post
        manage.notify = original_notify
        manage.record_live_lock_readiness_snapshot = original_record


def test_watchdog_live_lock_test_skips_when_shadow_recent() -> None:
    spec = importlib.util.spec_from_file_location("manage_24x7", Path("scripts/manage_24x7.py"))
    assert spec and spec.loader
    manage = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(manage)

    original_post = manage.post_json
    try:
        manage.post_json = lambda _url, _payload, timeout=12.0: (_ for _ in ()).throw(AssertionError("post_json should not be called"))  # type: ignore[assignment]
        state: dict[str, object] = {}
        health = {"checks": [{"name": "execution_shadow_recent", "ok": True, "detail": "fresh"}]}
        assert manage.maybe_run_watchdog_live_lock_test(state, health, now=1000) is None
    finally:
        manage.post_json = original_post


def test_doctor_includes_history_checks() -> None:
    spec = importlib.util.spec_from_file_location("manage_24x7", Path("scripts/manage_24x7.py"))
    assert spec and spec.loader
    manage = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(manage)

    now = "2026-06-06T00:00:00+00:00"
    original_http_request = manage.http_request
    original_port_open = manage.port_open
    original_ledger = manage.execution_ledger_has_live_submit
    original_shadow = manage.execution_ledger_shadow_status
    original_time = manage.time.time
    original_readiness_file = manage.READINESS_SNAPSHOT_FILE
    original_watchdog_file = manage.WATCHDOG_STATE_FILE
    temp_readiness_file = app.CACHE_DIR / "test-doctor-readiness-snapshots.jsonl"
    temp_watchdog_file = app.CACHE_DIR / "test-doctor-watchdog-state.json"
    temp_task_evidence_file = app.CACHE_DIR / "test-doctor-task-board-evidence.json"
    temp_readiness_file.write_text(
        json.dumps(
            {
                "time": now,
                "source": "test",
                "status": "missing_credentials",
                "locks": {"dry_run_only": True, "can_submit_live": False},
                "checks": {"keychain_ok": False, "okx_readonly_ok": False},
            },
            ensure_ascii=False,
        )
        + "\n",
        encoding="utf-8",
    )
    temp_task_evidence_file.write_text(
        json.dumps(
            {
                "watchdog_trigger": {
                    "top_task_id": "import_okx_keychain",
                    "top_task_title": "导入 OKX Keychain",
                    "top_task_status": "blocked",
                    "recorded_at": now,
                },
                "top_task": {"id": "import_okx_keychain", "title": "导入 OKX Keychain"},
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    temp_watchdog_file.write_text(
        json.dumps(
            {
                "market_refresh_last_run": 1770000000.0 - 600,
                "market_refresh_error": "",
                "market_refresh_last_summary": {
                    "ok": True,
                    "status": "ok",
                    "task_id": "task-refresh-watchdog",
                    "recommended_before": 4,
                    "recommended_after": 3,
                    "stale_after": 8,
                    "written_path": "/tmp/market-data-refresh-watchdog.json",
                },
                "automation_top_task_evidence_path": str(temp_task_evidence_file),
                "automation_top_task_evidence_error": "",
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    def fake_http(url: str, timeout: float = 5.0):
        if url.endswith("/api/data/status"):
            return True, {
                "rows": [
                    {
                        "inst_id": "BTC-USDT-SWAP",
                        "bar": "15m",
                        "count": 300,
                        "is_stale": True,
                        "recommended_refresh": True,
                        "refresh_priority": 90,
                        "refresh_cost_label": "约 1 次请求",
                    }
                ],
                "cache_dir": ".cache",
                "portfolio_result_cache": {"count": 0},
            }, ""
        if url.endswith("/api/paper/status"):
            return True, {"running": True, "updated_at": now}, ""
        if "/api/paper/equity-history" in url:
            return True, {
                "source": "paper_loop",
                "source_label": "模拟盘权益",
                "count": 1,
                "latest": {"time": now, "slot": now, "source": "paper_loop", "equity": 10.0},
                "rows": [{"time": now, "slot": now, "source": "paper_loop", "equity": 10.0}],
                "fallback_reason": "missing_credentials",
                "anchor_date": "2026-06-06",
                "interval_seconds": 900,
            }, ""
        if url.endswith("/api/execution/config"):
            return True, {
                "connector_status": {"dry_run_only": True, "can_submit_live": False},
                "live_submit_available": False,
                "live_trading_enabled": False,
                "live_order_enabled": False,
                "live_cancel_enabled": False,
                "okx_configured": False,
                "okx_keychain": {"configured": False, "keys": {}},
            }, ""
        if url.endswith("/api/automation/status"):
            return True, {
                "policy": {"dry_run_only": True, "can_submit_live": False},
                "signal_ready": False,
                "preflight_current": False,
                "state": "waiting_ready_signal",
                "next_action": "等待下一条 ready 信号",
                "heartbeat_age_seconds": 1,
                "readiness": {"stage": "missing_credentials", "label": "缺少OKX密钥", "next_action": "导入密钥"},
                "heartbeat_history": {"count": 1, "latest": {"time": now, "state": "waiting_ready_signal", "dry_run_only": True, "can_submit_live": False}},
                "preflight_history": {"count": 1, "latest": {"time": now, "state": "manual_preflight_blocked", "dry_run_only": True, "can_submit_live": False}},
                "event_history": {"count": 1, "latest": {"time": now, "stage": "missing_credentials", "dry_run_only": True, "can_submit_live": False}},
                "task_board": {
                    "count": 1,
                    "critical_count": 0,
                    "blocked_count": 1,
                    "top_task": {"id": "import_okx_keychain", "title": "导入 OKX Keychain"},
                    "tasks": [{"id": "import_okx_keychain", "title": "导入 OKX Keychain", "status": "blocked", "dry_run_only": True, "can_submit_live": False}],
                },
            }, ""
        if url.endswith("/api/okx/diagnostics"):
            return True, {
                "readonly_ok": False,
                "category": "missing_credentials",
                "history": {"count": 1, "latest": {"time": now, "category": "missing_credentials", "connector": {"dry_run_only": True, "can_submit_live": False}}},
            }, ""
        if url == "http://127.0.0.1:5173/":
            return True, "<title>Quant Studio</title>", ""
        if "/api/ai4trade/health" in url:
            return True, {
                "configured": True,
                "policy": {
                    "execution_allowed": False,
                    "trade_endpoints_locked": True,
                    "copy_trade_locked": True,
                    "publish_locked": True,
                    "okx_bridge": "disabled; AI4Trade can only annotate signals and market context.",
                },
                "history": {"count": 1, "latest": {"time": now, "signals": {"summary": {"count": 2}}, "policy": {"trade_endpoints_locked": True}}},
            }, ""
        return False, {}, f"unexpected URL {url}"

    try:
        manage.http_request = fake_http
        manage.port_open = lambda _host, _port, timeout=1.0: True
        manage.execution_ledger_has_live_submit = lambda: (False, None)
        manage.execution_ledger_shadow_status = lambda: {
            "present": True,
            "ok": True,
            "locked": True,
            "payload_hash_ok": True,
            "payload_ready": True,
            "detail": "dry_run · would_submit=False dry_run_only=True can_submit_live=False payload_hash=present",
            "latest": {"time": now, "event": "dry_run", "shadow_type": "shadow_live_order", "payload_sha256": "abc"},
        }
        manage.READINESS_SNAPSHOT_FILE = temp_readiness_file
        manage.WATCHDOG_STATE_FILE = temp_watchdog_file
        manage.time.time = lambda: 1770000000.0
        payload = manage.collect_health()
        checks = {row["name"]: row for row in payload["checks"]}
        assert checks["watchdog_market_refresh"]["ok"] is True
        assert "recommended 4->3" in checks["watchdog_market_refresh"]["detail"]
        assert checks["automation_heartbeat_history"]["ok"] is True
        assert checks["automation_history_live_lock"]["ok"] is True
        assert checks["automation_preflight_history"]["ok"] is True
        assert checks["account_equity_history"]["ok"] is True
        assert checks["account_equity_source"]["ok"] is True
        assert checks["account_equity_fresh"]["ok"] is True
        assert checks["account_equity_anchor_fixed"]["ok"] is True
        assert checks["account_equity_interval_15m"]["ok"] is True
        assert checks["account_equity_after_anchor"]["ok"] is True
        assert checks["automation_event_history"]["ok"] is True
        assert checks["automation_event_live_lock"]["ok"] is True
        assert checks["readiness_snapshot_history"]["ok"] is True
        assert checks["readiness_snapshot_fresh"]["ok"] is True
        assert checks["readiness_snapshot_live_lock"]["ok"] is True
        assert checks["automation_task_board"]["ok"] is True
        assert checks["automation_task_board_evidence"]["ok"] is True
        assert checks["automation_task_safety"]["ok"] is True
        assert checks["okx_diagnostics_history"]["ok"] is True
        assert checks["okx_history_live_lock"]["ok"] is True
        assert checks["ai4trade_history"]["ok"] is True
        assert checks["ai4trade_history_fresh"]["ok"] is True
        assert checks["ai4trade_history_readonly_policy"]["ok"] is True
        assert checks["ai4trade_signal_alignment"]["ok"] is True
        assert checks["execution_shadow_order"]["ok"] is True
        assert checks["execution_shadow_recent"]["ok"] is True
        assert checks["execution_shadow_live_lock"]["ok"] is True
        assert checks["execution_shadow_payload_hash"]["ok"] is True
    finally:
        manage.http_request = original_http_request
        manage.port_open = original_port_open
        manage.execution_ledger_has_live_submit = original_ledger
        manage.execution_ledger_shadow_status = original_shadow
        manage.READINESS_SNAPSHOT_FILE = original_readiness_file
        manage.WATCHDOG_STATE_FILE = original_watchdog_file
        manage.time.time = original_time
        if temp_readiness_file.exists():
            temp_readiness_file.unlink()
        if temp_watchdog_file.exists():
            temp_watchdog_file.unlink()
        if temp_task_evidence_file.exists():
            temp_task_evidence_file.unlink()


def test_automation_task_board_evidence_status_rejects_missing_or_mismatch() -> None:
    spec = importlib.util.spec_from_file_location("manage_24x7", Path("scripts/manage_24x7.py"))
    assert spec and spec.loader
    manage = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(manage)

    missing = manage.automation_task_board_evidence_status({}, "import_okx_keychain")
    assert missing["ok"] is False
    assert "missing watchdog task evidence path" in missing["detail"]

    temp_task_evidence_file = app.CACHE_DIR / "test-task-board-evidence-mismatch.json"
    original_time = manage.time.time
    try:
        temp_task_evidence_file.write_text(
            json.dumps(
                {
                    "watchdog_trigger": {
                        "top_task_id": "old_task",
                        "top_task_title": "旧任务",
                        "top_task_status": "blocked",
                        "recorded_at": "2026-06-06T00:00:00+00:00",
                    },
                    "top_task": {"id": "old_task"},
                },
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )
        manage.time.time = lambda: 1770000000.0
        mismatch = manage.automation_task_board_evidence_status(
            {"automation_top_task_evidence_path": str(temp_task_evidence_file), "automation_top_task_evidence_error": ""},
            "import_okx_keychain",
        )
        assert mismatch["ok"] is False
        assert "watchdog task evidence mismatch" in mismatch["detail"]
        assert mismatch["data"]["trigger_top_task_id"] == "old_task"
    finally:
        manage.time.time = original_time
        if temp_task_evidence_file.exists():
            temp_task_evidence_file.unlink()


def test_doctor_refreshes_stale_ai4trade_history() -> None:
    spec = importlib.util.spec_from_file_location("manage_24x7", Path("scripts/manage_24x7.py"))
    assert spec and spec.loader
    manage = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(manage)

    current = "2026-06-06T01:00:00+00:00"
    stale = "2026-06-06T00:00:00+00:00"
    current_ts = manage.parse_time(current)
    assert current_ts is not None
    calls: list[str] = []
    original_http_request = manage.http_request
    original_port_open = manage.port_open
    original_ledger = manage.execution_ledger_has_live_submit
    original_shadow = manage.execution_ledger_shadow_status
    original_time = manage.time.time
    original_readiness_file = manage.READINESS_SNAPSHOT_FILE
    temp_readiness_file = app.CACHE_DIR / "test-doctor-ai4trade-refresh-snapshots.jsonl"
    temp_readiness_file.write_text(
        json.dumps(
            {
                "time": current,
                "source": "test",
                "status": "missing_credentials",
                "locks": {"dry_run_only": True, "can_submit_live": False},
                "checks": {"keychain_ok": False, "okx_readonly_ok": False},
            },
            ensure_ascii=False,
        )
        + "\n",
        encoding="utf-8",
    )

    def fresh_history(state: str = "waiting_ready_signal") -> dict[str, object]:
        return {"count": 1, "latest": {"time": current, "state": state, "dry_run_only": True, "can_submit_live": False}}

    def fake_http(url: str, timeout: float = 5.0):
        calls.append(url)
        if url.endswith("/api/paper/status"):
            return True, {"running": True, "updated_at": current}, ""
        if "/api/paper/equity-history" in url:
            return True, {
                "source": "paper_loop",
                "source_label": "模拟盘权益",
                "count": 1,
                "latest": {"time": current, "slot": current, "source": "paper_loop", "equity": 10.0},
                "rows": [{"time": current, "slot": current, "source": "paper_loop", "equity": 10.0}],
                "anchor_date": "2026-06-06",
                "interval_seconds": 900,
            }, ""
        if url.endswith("/api/execution/config"):
            return True, {
                "connector_status": {"dry_run_only": True, "can_submit_live": False},
                "live_submit_available": False,
                "live_trading_enabled": False,
                "live_order_enabled": False,
                "live_cancel_enabled": False,
                "okx_configured": False,
                "okx_keychain": {"configured": False, "keys": {}},
            }, ""
        if url.endswith("/api/automation/status"):
            return True, {
                "policy": {"dry_run_only": True, "can_submit_live": False},
                "signal_ready": False,
                "preflight_current": False,
                "state": "waiting_ready_signal",
                "next_action": "等待下一条 ready 信号",
                "heartbeat_age_seconds": 1,
                "readiness": {"stage": "missing_credentials", "label": "缺少OKX密钥", "next_action": "导入密钥"},
                "heartbeat_history": fresh_history(),
                "preflight_history": fresh_history("manual_preflight_blocked"),
                "event_history": {"count": 1, "latest": {"time": current, "stage": "missing_credentials", "dry_run_only": True, "can_submit_live": False}},
                "task_board": {
                    "count": 1,
                    "critical_count": 0,
                    "top_task": {"id": "import_okx_keychain", "title": "导入 OKX Keychain"},
                    "tasks": [{"id": "import_okx_keychain", "title": "导入 OKX Keychain", "status": "blocked"}],
                },
            }, ""
        if url.endswith("/api/okx/diagnostics"):
            return True, {
                "readonly_ok": False,
                "category": "missing_credentials",
                "history": {"count": 1, "latest": {"time": current, "category": "missing_credentials", "connector": {"dry_run_only": True, "can_submit_live": False}}},
            }, ""
        if url == "http://127.0.0.1:5173/":
            return True, "<title>Quant Studio</title>", ""
        if "/api/ai4trade/health" in url:
            return True, {
                "configured": True,
                "policy": {
                    "execution_allowed": False,
                    "trade_endpoints_locked": True,
                    "copy_trade_locked": True,
                    "publish_locked": True,
                    "okx_bridge": "disabled; AI4Trade can only annotate signals and market context.",
                },
                "history": {"count": 1, "latest": {"time": stale, "signals": {"summary": {"count": 1}}, "policy": {"trade_endpoints_locked": True}}},
            }, ""
        if "/api/ai4trade/status" in url:
            return True, {
                "configured": True,
                "policy": {
                    "execution_allowed": False,
                    "trade_endpoints_locked": True,
                    "copy_trade_locked": True,
                    "publish_locked": True,
                    "okx_bridge": "disabled; AI4Trade can only annotate signals and market context.",
                },
                "history": {"count": 2, "latest": {"time": current, "signals": {"summary": {"count": 3}}, "policy": {"trade_endpoints_locked": True}}},
            }, ""
        return False, {}, f"unexpected URL {url}"

    try:
        manage.http_request = fake_http
        manage.port_open = lambda _host, _port, timeout=1.0: True
        manage.execution_ledger_has_live_submit = lambda: (False, None)
        manage.execution_ledger_shadow_status = lambda: {
            "present": True,
            "ok": True,
            "locked": True,
            "payload_hash_ok": True,
            "payload_ready": True,
            "detail": "dry_run · would_submit=False dry_run_only=True can_submit_live=False payload_hash=present",
            "latest": {"time": current, "event": "dry_run", "shadow_type": "shadow_live_order", "payload_sha256": "abc"},
        }
        manage.READINESS_SNAPSHOT_FILE = temp_readiness_file
        manage.time.time = lambda: current_ts
        payload = manage.collect_health()
        checks = {row["name"]: row for row in payload["checks"]}
        assert any("/api/ai4trade/status" in url for url in calls)
        assert checks["ai4trade_history_refresh"]["ok"] is True
        assert checks["ai4trade_history_fresh"]["ok"] is True
        assert "signals=3" in checks["ai4trade_history"]["detail"]
        assert checks["ai4trade_history_readonly_policy"]["ok"] is True
        assert checks["ai4trade_signal_alignment"]["ok"] is True
    finally:
        manage.http_request = original_http_request
        manage.port_open = original_port_open
        manage.execution_ledger_has_live_submit = original_ledger
        manage.execution_ledger_shadow_status = original_shadow
        manage.READINESS_SNAPSHOT_FILE = original_readiness_file
        manage.time.time = original_time
        if temp_readiness_file.exists():
            temp_readiness_file.unlink()


def test_paper_equity_history_snapshots() -> None:
    original_file = app.PAPER_EQUITY_FILE
    original_status = app.okx_credentials_status
    temp_file = app.CACHE_DIR / "test-paper-equity.jsonl"
    if temp_file.exists():
        temp_file.unlink()
    try:
        app.PAPER_EQUITY_FILE = temp_file
        app.okx_credentials_status = lambda: {"configured": False, "keys": {}, "simulated": False}  # type: ignore[assignment]
        state = app.PaperState(
            running=True,
            inst_id="BTC-USDT-SWAP",
            bar="15m",
            equity=10.0,
            peak_equity=10.0,
            day_start_equity=10.0,
            day_key="2026-06-06",
            day_trades=0,
            updated_at="2026-06-06T00:01:00+00:00",
            trades=[],
        )
        first = app.record_paper_equity_snapshot(state, source="paper_loop", timestamp=state.updated_at)
        duplicate = app.record_paper_equity_snapshot(state, source="paper_loop", timestamp=state.updated_at)
        state.equity = 10.25
        state.peak_equity = 10.25
        changed = app.record_paper_equity_snapshot(state, source="paper_loop", timestamp="2026-06-06T00:05:00+00:00")
        state.equity = 10.5
        state.peak_equity = 10.5
        next_slot = app.record_paper_equity_snapshot(state, source="paper_loop", timestamp="2026-06-06T00:16:00+00:00")
        history = app.read_paper_equity_history(10, "2026-06-06T00:00:00+00:00")
        assert first["written"] is True
        assert duplicate["written"] is False
        assert changed["written"] is True
        assert next_slot["written"] is True
        assert history["count"] == 2
        assert history["rows"][0]["slot"] == "2026-06-06T00:00:00+00:00"
        assert history["rows"][0]["equity"] == 10.25
        assert history["rows"][1]["slot"] == "2026-06-06T00:15:00+00:00"
        assert history["latest"]["equity"] == 10.5
        assert history["source"] == "paper_loop"
        assert history["fallback_reason"] == "missing_credentials"
    finally:
        app.PAPER_EQUITY_FILE = original_file
        app.okx_credentials_status = original_status  # type: ignore[assignment]
        if temp_file.exists():
            temp_file.unlink()


def test_account_equity_history_prefers_okx_readonly() -> None:
    original_account_file = app.ACCOUNT_EQUITY_FILE
    original_paper_file = app.PAPER_EQUITY_FILE
    original_status = app.okx_credentials_status
    original_account = app.okx_account_readonly
    temp_account = app.CACHE_DIR / "test-account-equity.jsonl"
    temp_paper = app.CACHE_DIR / "test-account-paper-equity.jsonl"
    for path in (temp_account, temp_paper):
        if path.exists():
            path.unlink()
    try:
        app.ACCOUNT_EQUITY_FILE = temp_account
        app.PAPER_EQUITY_FILE = temp_paper
        app.okx_credentials_status = lambda: {"configured": True, "keys": {}, "simulated": False}  # type: ignore[assignment]
        app.okx_account_readonly = lambda: {  # type: ignore[assignment]
            "ok": True,
            "configured": True,
            "readonly_scope": "account_balance",
            "total_equity_usd": 42.25,
            "adjusted_equity_usd": 42.0,
            "isolated_equity_usd": 0,
            "details": [{"ccy": "USDT", "equity": 42.25, "available_balance": 42.0, "u_pnl": 0}],
            "updated_at": "2026-06-06T00:00:00+00:00",
        }
        history = app.read_paper_equity_history(10, "2026-06-06T00:00:00+00:00")
        assert history["source"] == "okx_readonly"
        assert history["source_label"] == "OKX只读账户权益"
        assert history["readonly_ok"] is True
        assert history["count"] == 1
        assert history["latest"]["source"] == "okx_readonly"
        assert history["latest"]["equity"] == 42.25
        assert history["current_snapshot"]["written"] is True
        rendered = json.dumps(history, ensure_ascii=False).lower()
        assert "api_secret" not in rendered
        assert "passphrase" not in rendered
        assert "signature" not in rendered
    finally:
        app.ACCOUNT_EQUITY_FILE = original_account_file
        app.PAPER_EQUITY_FILE = original_paper_file
        app.okx_credentials_status = original_status  # type: ignore[assignment]
        app.okx_account_readonly = original_account  # type: ignore[assignment]
        for path in (temp_account, temp_paper):
            if path.exists():
                path.unlink()


def test_automation_preflight_history_is_sanitized() -> None:
    original_file = app.AUTOMATION_PREFLIGHT_FILE
    original_env = {
        "OKX_API_KEY": os.environ.get("OKX_API_KEY"),
        "OKX_API_SECRET": os.environ.get("OKX_API_SECRET"),
        "OKX_API_PASSPHRASE": os.environ.get("OKX_API_PASSPHRASE"),
    }
    temp_file = app.CACHE_DIR / "test-automation-preflight.jsonl"
    if temp_file.exists():
        temp_file.unlink()
    try:
        app.AUTOMATION_PREFLIGHT_FILE = temp_file
        os.environ["OKX_API_KEY"] = "key-should-not-leak"
        os.environ["OKX_API_SECRET"] = "secret-should-not-leak"
        os.environ["OKX_API_PASSPHRASE"] = "passphrase-should-not-leak"
        first = app.append_automation_preflight_history(
            source="paper_loop",
            state="preflight_passed",
            signal_hash="hash-a",
            signal={
                "inst_id": "BTC-USDT-SWAP",
                "status": "ready",
                "side": "buy",
                "notional": 10,
                "api_secret": "ignored",
                "signature": "ignored",
            },
            summary={
                "mode": "dry_run",
                "has_intent": True,
                "side": "buy",
                "notional": 10,
                "guard_decision": "仅 dry-run",
                "allow_dry_run": True,
                "allow_live": True,
                "final_gate_status": "locked",
                "okx_order_ready": True,
            },
        )
        second = app.append_automation_preflight_history(
            source="manual",
            state="manual_preflight_error",
            signal_hash="hash-b",
            signal={"inst_id": "BTC-USDT-SWAP", "status": "ready"},
            error="api_secret=secret-should-not-leak signature=raw-signature passphrase=passphrase-should-not-leak",
        )
        history = app.read_automation_preflight_history(10)
        rendered = json.dumps(history, ensure_ascii=False).lower()
        assert first["dry_run_only"] is True
        assert first["can_submit_live"] is False
        assert second["error"] == "api_secret=<redacted> signature=<redacted> passphrase=<redacted>"
        assert history["count"] == 2
        assert history["rows"][0]["state"] == "manual_preflight_error"
        assert history["rows"][1]["state"] == "preflight_passed"
        assert "secret-should-not-leak" not in rendered
        assert "passphrase-should-not-leak" not in rendered
        assert "raw-signature" not in rendered
        assert "api_secret" not in history["rows"][0]["signal"]
        assert "signature" not in history["rows"][0]["signal"]
    finally:
        app.AUTOMATION_PREFLIGHT_FILE = original_file
        for key, value in original_env.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value
        if temp_file.exists():
            temp_file.unlink()


def test_automation_stage_event_history_is_deduped_and_sanitized() -> None:
    original_state_file = app.AUTOMATION_STATE_FILE
    original_event_file = app.AUTOMATION_EVENT_FILE
    original_env = {
        "OKX_API_KEY": os.environ.get("OKX_API_KEY"),
        "OKX_API_SECRET": os.environ.get("OKX_API_SECRET"),
        "OKX_API_PASSPHRASE": os.environ.get("OKX_API_PASSPHRASE"),
    }
    temp_state = app.CACHE_DIR / "test-automation-stage-state.json"
    temp_events = app.CACHE_DIR / "test-automation-events.jsonl"
    for path in (temp_state, temp_events):
        if path.exists():
            path.unlink()
    try:
        app.AUTOMATION_STATE_FILE = temp_state
        app.AUTOMATION_EVENT_FILE = temp_events
        os.environ["OKX_API_SECRET"] = "stage-secret"
        app.save_automation_state(
            {
                "state": "waiting_ready_signal",
                "last_signal_hash": "signal-a",
                "last_preflight_hash": "signal-a",
                "last_signal": {
                    "inst_id": "BTC-USDT-SWAP",
                    "bar": "15m",
                    "status": "ready",
                    "decision": "api_secret=stage-secret",
                    "side": "buy",
                },
                "last_preflight": {
                    "mode": "dry_run",
                    "guard_decision": "signature=stage-secret",
                    "allow_dry_run": True,
                    "allow_live": False,
                    "final_gate_status": "locked",
                    "updated_at": "2026-06-06T00:00:00+00:00",
                },
                "heartbeat_count": 3,
            }
        )
        readiness = {
            "stage": "manual_canary_review",
            "label": "人工Canary审核",
            "next_action": "api_secret=stage-secret",
            "blockers": ["passphrase=stage-secret"],
        }
        policy = {"dry_run_only": True, "can_submit_live": False}
        first = app.automation_record_stage_event(readiness, policy, source="test")
        second = app.automation_record_stage_event(readiness, policy, source="test")
        current = app.load_automation_state()
        app.save_automation_state(
            {
                **current,
                "last_preflight": {
                    **current["last_preflight"],
                    "updated_at": "2026-06-06T00:15:00+00:00",
                },
            }
        )
        third = app.automation_record_stage_event(readiness, policy, source="test")
        history = app.read_automation_event_history(10)
        rendered = json.dumps(history, ensure_ascii=False).lower()
        assert first["written"] is True
        assert second["written"] is False
        assert third["written"] is True
        assert history["count"] == 2
        assert history["rows"][0]["stage"] == "manual_canary_review"
        assert history["rows"][0]["preflight"]["updated_at"] == "2026-06-06T00:15:00+00:00"
        assert history["rows"][0]["dry_run_only"] is True
        assert history["rows"][0]["can_submit_live"] is False
        assert "stage-secret" not in rendered
        assert "<redacted>" in rendered
    finally:
        app.AUTOMATION_STATE_FILE = original_state_file
        app.AUTOMATION_EVENT_FILE = original_event_file
        for key, value in original_env.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value
        for path in (temp_state, temp_events):
            if path.exists():
                path.unlink()


def test_automation_task_board_prioritizes_next_action_and_safety() -> None:
    original_status = app.okx_credentials_status
    try:
        app.okx_credentials_status = lambda: {"configured": False, "keys": {}, "simulated": False}  # type: ignore[assignment]
        missing = app.automation_task_board(
            {"state": "waiting_ready_signal"},
            {"stage": "missing_credentials", "label": "缺少OKX密钥", "next_action": "导入密钥", "blockers": ["缺少密钥"]},
            {"dry_run_only": True, "can_submit_live": False},
            signal_ready=False,
            preflight_current=False,
            heartbeat_fresh=True,
            event_history={"count": 1},
            data_cache={"rows": [{"inst_id": "SOL-USDT-SWAP", "bar": "15m", "count": 8722, "recommended_refresh": True, "refresh_cost_label": "约 86 次请求"}]},
        )
        assert missing["blocked_count"] == 1
        assert missing["critical_count"] == 0
        assert missing["top_task"]["id"] == "import_okx_keychain"
        assert missing["top_task"]["can_submit_live"] is False
        assert any(task["id"] == "refresh_market_data" for task in missing["tasks"])

        app.okx_credentials_status = lambda: {"configured": True, "keys": {}, "simulated": False}  # type: ignore[assignment]
        waiting = app.automation_task_board(
            {"state": "waiting_ready_signal"},
            {"stage": "waiting_signal", "label": "等待信号", "next_action": "等待", "blockers": []},
            {"dry_run_only": True, "can_submit_live": False},
            signal_ready=False,
            preflight_current=False,
            heartbeat_fresh=True,
            event_history={"count": 1},
            data_cache={"rows": [{"inst_id": "BTC-USDT-SWAP", "bar": "15m", "count": 26002, "recommended_refresh": True, "refresh_cost_label": "约 259 次请求"}]},
        )
        assert waiting["top_task"]["id"] == "refresh_market_data"
        assert waiting["top_task"]["dry_run_only"] is True
        assert waiting["top_task"]["can_submit_live"] is False

        unsafe = app.automation_task_board(
            {"state": "waiting_ready_signal"},
            {"stage": "waiting_signal", "label": "等待信号", "next_action": "等待", "blockers": []},
            {"dry_run_only": False, "can_submit_live": True},
            signal_ready=False,
            preflight_current=False,
            heartbeat_fresh=True,
            event_history={"count": 1},
            data_cache={"rows": [{"inst_id": "BTC-USDT-SWAP", "bar": "15m", "count": 26002, "recommended_refresh": True}]},
        )
        assert unsafe["critical_count"] == 1
        assert unsafe["top_task"]["id"] == "restore_live_lock"
        assert unsafe["top_task"]["can_submit_live"] is True
    finally:
        app.okx_credentials_status = original_status  # type: ignore[assignment]


def test_automation_task_action_receipts_are_sanitized() -> None:
    original_file = app.AUTOMATION_TASK_ACTION_FILE
    original_env = {
        "OKX_API_KEY": os.environ.get("OKX_API_KEY"),
        "OKX_API_SECRET": os.environ.get("OKX_API_SECRET"),
        "OKX_API_PASSPHRASE": os.environ.get("OKX_API_PASSPHRASE"),
    }
    temp_file = app.CACHE_DIR / "test-automation-task-actions.jsonl"
    if temp_file.exists():
        temp_file.unlink()
    try:
        app.AUTOMATION_TASK_ACTION_FILE = temp_file
        os.environ["OKX_API_SECRET"] = "task-secret"
        result = app.append_automation_task_action(
            {
                "task_id": "import_okx_keychain",
                "action": "acknowledged",
                "status": "noted",
                "source": "test",
                "note": "api_secret=task-secret",
            }
        )
        history = app.read_automation_task_actions(10)
        rendered = json.dumps(history, ensure_ascii=False).lower()
        assert result["ok"] is True
        assert result["entry"]["task_id"] == "import_okx_keychain"
        assert result["entry"]["dry_run_only"] is True
        assert result["entry"]["can_submit_live"] is False
        assert history["count"] == 1
        assert "task-secret" not in rendered
        assert "<redacted>" in rendered

        missing = app.append_automation_task_action({"action": "acknowledged"})
        assert missing["ok"] is False
    finally:
        app.AUTOMATION_TASK_ACTION_FILE = original_file
        for key, value in original_env.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value
        if temp_file.exists():
            temp_file.unlink()


def test_automation_heartbeat_history_is_persisted() -> None:
    original_state_file = app.AUTOMATION_STATE_FILE
    original_history_file = app.AUTOMATION_HEARTBEAT_FILE
    original_interval = app.AUTOMATION_HEARTBEAT_INTERVAL_SECONDS
    temp_state = app.CACHE_DIR / "test-automation-state.json"
    temp_history = app.CACHE_DIR / "test-automation-heartbeat.jsonl"
    for path in (temp_state, temp_history):
        if path.exists():
            path.unlink()
    try:
        app.AUTOMATION_STATE_FILE = temp_state
        app.AUTOMATION_HEARTBEAT_FILE = temp_history
        app.AUTOMATION_HEARTBEAT_INTERVAL_SECONDS = 0
        first = app.automation_record_heartbeat(
            {
                "running": True,
                "updated_at": "2026-06-06T00:00:00+00:00",
                "inst_id": "BTC-USDT-SWAP",
                "bar": "15m",
                "equity": 10.0,
                "api_secret": "must-not-leak",
            },
            {"status": "blocked", "decision": "等待"},
            source="test",
        )
        second = app.automation_record_heartbeat(
            {
                "running": True,
                "updated_at": "2026-06-06T00:01:00+00:00",
                "inst_id": "ETH-USDT-SWAP",
                "bar": "15m",
                "equity": 10.2,
            },
            {"status": "ready", "decision": "ready"},
            source="test",
        )
        history = app.read_automation_heartbeat_history(10)
        rendered = json.dumps(history, ensure_ascii=False).lower()
        assert first["heartbeat_count"] == 1
        assert second["heartbeat_count"] == 2
        assert history["count"] == 2
        assert history["rows"][0]["inst_id"] == "ETH-USDT-SWAP"
        assert history["rows"][1]["inst_id"] == "BTC-USDT-SWAP"
        assert history["rows"][0]["dry_run_only"] is True
        assert history["rows"][0]["can_submit_live"] is False
        assert "must-not-leak" not in rendered
        assert "api_secret" not in rendered
    finally:
        app.AUTOMATION_STATE_FILE = original_state_file
        app.AUTOMATION_HEARTBEAT_FILE = original_history_file
        app.AUTOMATION_HEARTBEAT_INTERVAL_SECONDS = original_interval
        for path in (temp_state, temp_history):
            if path.exists():
                path.unlink()


def test_okx_diagnostics_history_missing_credentials() -> None:
    original_file = app.OKX_DIAGNOSTICS_FILE
    original_status = app.okx_credentials_status
    temp_file = app.CACHE_DIR / "test-okx-diagnostics.jsonl"
    if temp_file.exists():
        temp_file.unlink()
    try:
        app.OKX_DIAGNOSTICS_FILE = temp_file
        app.okx_credentials_status = lambda: {  # type: ignore[assignment]
            "configured": False,
            "keys": {"OKX_API_KEY": False, "OKX_API_SECRET": False, "OKX_API_PASSPHRASE": False},
            "base_url": "https://www.okx.com",
            "simulated": False,
            "api_secret": "must-not-leak",
        }
        result = app.okx_diagnostics()
        history = app.read_okx_diagnostics_history(10)
        rendered = json.dumps(history, ensure_ascii=False).lower()
        assert result["category"] == "missing_credentials"
        assert result["history"]["count"] == 1
        assert history["count"] == 1
        assert history["rows"][0]["category"] == "missing_credentials"
        assert history["rows"][0]["readonly_ok"] is False
        assert history["rows"][0]["connector"]["dry_run_only"] is True
        assert history["rows"][0]["connector"]["can_submit_live"] is False
        assert "must-not-leak" not in rendered
    finally:
        app.OKX_DIAGNOSTICS_FILE = original_file
        app.okx_credentials_status = original_status  # type: ignore[assignment]
        if temp_file.exists():
            temp_file.unlink()


def test_ai4trade_history_is_sanitized() -> None:
    original_file = app.AI4TRADE_HISTORY_FILE
    temp_file = app.CACHE_DIR / "test-ai4trade-history.jsonl"
    if temp_file.exists():
        temp_file.unlink()
    try:
        app.AI4TRADE_HISTORY_FILE = temp_file
        result = {
            "ok": True,
            "configured": True,
            "credentials": {
                "agent_id": "agent-1",
                "agent_name": "QuantAgent",
                "token_present": True,
                "token_redacted": "tok...123",
                "_token": "must-not-leak",
            },
            "heartbeat": {"ok": True, "message_count": 2, "task_count": 1, "error": "token=must-not-leak"},
            "signals": {"ok": True, "summary": {"count": 3}, "rows": [{"content": "do not persist"}]},
            "market_intel": {"overview_ok": True, "news_ok": False, "category": "crypto"},
            "policy": {"trade_endpoints_locked": True, "copy_trade_locked": True, "publish_locked": True},
            "next_action": "read only",
            "updated_at": "2026-06-06T00:00:00+00:00",
        }
        entry = app.append_ai4trade_history(result)
        history = app.read_ai4trade_history(10)
        rendered = json.dumps(history, ensure_ascii=False).lower()
        assert entry["agent"]["name"] == "QuantAgent"
        assert entry["heartbeat"]["message_count"] == 2
        assert entry["signals"]["summary"]["count"] == 3
        assert entry["policy"]["trade_endpoints_locked"] is True
        assert history["count"] == 1
        assert "must-not-leak" not in rendered
        assert "do not persist" not in rendered
        assert "_token" not in rendered
    finally:
        app.AI4TRADE_HISTORY_FILE = original_file
        if temp_file.exists():
            temp_file.unlink()


def test_readiness_snapshot_api_history_is_sanitized() -> None:
    original_file = app.READINESS_SNAPSHOT_FILE
    temp_file = app.CACHE_DIR / "test-app-readiness-snapshots.jsonl"
    if temp_file.exists():
        temp_file.unlink()
    try:
        app.READINESS_SNAPSHOT_FILE = temp_file
        temp_file.write_text(
            json.dumps(
                {
                    "time": "2026-06-06T00:00:00+00:00",
                    "source": "test",
                    "status": "canary_review_ready",
                    "readonly_ready": True,
                    "canary_review_ready": True,
                    "next_action": "token=token-value",
                    "locks": {"dry_run_only": True, "can_submit_live": False},
                    "checks": {"keychain_ok": True, "okx_readonly_ok": True},
                    "latest_shadow_order": {"api_secret": "secret-value", "signature": "raw-signature"},
                },
                ensure_ascii=False,
            )
            + "\n",
            encoding="utf-8",
        )
        history = app.read_readiness_snapshot_history(10)
        rendered = json.dumps(history, ensure_ascii=False).lower()
        assert history["count"] == 1
        assert history["latest"]["status"] == "canary_review_ready"
        assert history["latest"]["locks"]["dry_run_only"] is True
        assert history["latest"]["locks"]["can_submit_live"] is False
        assert "secret-value" not in rendered
        assert "raw-signature" not in rendered
        assert "token-value" not in rendered
        assert "<redacted>" in rendered
    finally:
        app.READINESS_SNAPSHOT_FILE = original_file
        if temp_file.exists():
            temp_file.unlink()


def test_execution_config_exposes_live_locks() -> None:
    config = app.execution_config()
    assert config["dry_run_only"] is True
    assert config["can_submit_live"] is False
    assert config["can_cancel_live"] is False
    assert config["live_trading_enabled"] is False
    assert config["live_order_enabled"] is False
    assert config["live_cancel_enabled"] is False


def test_high_cost_cache_is_not_auto_recommended() -> None:
    row = app.annotate_cache_refresh_priority(
        {
            "inst_id": "BTC-USDT-SWAP",
            "bar": "5m",
            "count": 26002,
            "candles": 26002,
            "is_stale": True,
            "latest_closed_age_seconds": 3600,
            "stale_after_seconds": 900,
            "covered_by_fresh_cache": False,
        }
    )
    assert row["is_stale"] is True
    assert row["high_refresh_cost"] is True
    assert row["refresh_estimated_requests"] > row["max_auto_refresh_estimated_requests"]
    assert row["recommended_refresh"] is False
    assert "自动刷新成本高" in row["refresh_reasons"]


def test_refresh_stale_candle_cache_skips_high_cost_by_default() -> None:
    original_cache_status = app.cache_status
    original_refresh = app.refresh_candle_cache
    captured: list[dict] = []
    rows = [
        {
            "inst_id": "ETH-USDT-SWAP",
            "bar": "15m",
            "count": 300,
            "is_stale": True,
            "covered_by_fresh_cache": False,
            "high_refresh_cost": False,
            "recommended_refresh": True,
            "refresh_priority": 80,
        },
        {
            "inst_id": "BTC-USDT-SWAP",
            "bar": "5m",
            "count": 26002,
            "is_stale": True,
            "covered_by_fresh_cache": False,
            "high_refresh_cost": True,
            "recommended_refresh": False,
            "refresh_priority": 46,
            "refresh_cost_label": "约 259 次请求",
        },
        {
            "inst_id": "SOL-USDT-SWAP",
            "bar": "15m",
            "count": 1200,
            "is_stale": True,
            "covered_by_fresh_cache": True,
            "high_refresh_cost": False,
            "recommended_refresh": False,
            "refresh_priority": 8,
        },
    ]

    def fake_refresh(payload: dict) -> dict:
        captured.append(payload)
        return {"ok": len(payload["rows"]), "failed": 0, "results": payload["rows"], "progress": {}, "cache": {}}

    try:
        app.cache_status = lambda: {"rows": rows}  # type: ignore[assignment]
        app.refresh_candle_cache = fake_refresh  # type: ignore[assignment]
        result = app.refresh_stale_candle_cache({"max_items": 4})
        assert captured[-1]["mode"] == "stale"
        assert [row["inst_id"] for row in captured[-1]["rows"]] == ["ETH-USDT-SWAP"]
        assert result["skipped_high_cost"] == 1
        assert result["skipped_high_cost_rows"][0]["inst_id"] == "BTC-USDT-SWAP"
        assert result["skipped_covered"] == 1
        assert result["include_high_cost"] is False

        result_with_manual = app.refresh_stale_candle_cache({"max_items": 4, "include_high_cost": True})
        assert [row["inst_id"] for row in captured[-1]["rows"]] == ["ETH-USDT-SWAP", "BTC-USDT-SWAP"]
        assert result_with_manual["skipped_high_cost"] == 0
        assert result_with_manual["include_high_cost"] is True
    finally:
        app.cache_status = original_cache_status  # type: ignore[assignment]
        app.refresh_candle_cache = original_refresh  # type: ignore[assignment]


def test_manage_compact_cache_status_tracks_high_cost_manual_rows() -> None:
    spec = importlib.util.spec_from_file_location("manage_24x7", Path("scripts/manage_24x7.py"))
    assert spec and spec.loader
    manage = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(manage)

    payload = manage.compact_cache_status(
        {
            "rows": [
                {"inst_id": "BTC-USDT-SWAP", "bar": "5m", "count": 26002, "is_stale": True, "high_refresh_cost": True},
                {"inst_id": "ETH-USDT-SWAP", "bar": "15m", "count": 300, "is_stale": True, "recommended_refresh": True},
                {"inst_id": "SOL-USDT-SWAP", "bar": "15m", "count": 300, "is_stale": False},
            ],
            "cache_dir": ".cache",
        }
    )
    assert payload["summary"]["high_cost_stale"] == 1
    assert payload["summary"]["recommended"] == 1
    assert payload["top_stale"][0]["high_refresh_cost"] is True


def main() -> None:
    test_keychain_persist_mock()
    test_keychain_persist_requires_readback_verification()
    test_automation_readiness_stages()
    test_automation_readiness_summary_go_no_go()
    test_automation_status_pre_live_gates_keep_submit_locked()
    test_watchdog_stage_notifications_dedupe()
    test_watchdog_task_notifications_dedupe()
    test_watchdog_market_refresh_is_throttled_and_lock_guarded()
    test_ai4trade_signal_alignment_requires_live_lock()
    test_automation_ai4trade_alignment_status_requires_bridge_and_lock()
    test_latest_recent_backtest_evidence_status_reads_launchd_evidence()
    test_import_secrets_restart_flag()
    test_import_secrets_keychain_verify_summary()
    test_import_secrets_restart_runs_post_verify_after_write()
    test_verify_import_readiness_fails_if_live_lock_opens()
    test_readiness_snapshot_history_is_sanitized()
    test_readiness_command_records_snapshot()
    test_watchdog_readiness_snapshot_auto_records_with_dedupe()
    test_readiness_payload_reuses_supplied_health_payload()
    test_secrets_status_payload()
    test_evidence_bundle_payload_summarizes_locks_and_redacts()
    test_evidence_bundle_write_uses_sanitized_json()
    test_pre_live_gate_blocks_readonly_without_okx_keychain()
    test_pre_live_gate_keeps_live_submit_blocked_by_policy()
    test_shadow_order_evidence_is_locked_and_redacted()
    test_automation_summary_includes_shadow_order()
    test_manage_shadow_status_reads_latest_ledger_evidence()
    test_manage_readiness_payload_summarizes_go_no_go()
    test_manage_tasks_command_formats_task_board()
    test_manage_tasks_command_writes_task_board_evidence()
    test_manage_task_action_posts_receipt()
    test_manage_live_lock_test_rejects_submit_path()
    test_manage_live_lock_test_fails_if_submitted()
    test_manage_live_lock_test_records_readiness_snapshot()
    test_watchdog_live_lock_test_runs_when_shadow_stale()
    test_watchdog_live_lock_test_skips_when_shadow_recent()
    test_doctor_includes_history_checks()
    test_automation_task_board_evidence_status_rejects_missing_or_mismatch()
    test_doctor_refreshes_stale_ai4trade_history()
    test_paper_equity_history_snapshots()
    test_account_equity_history_prefers_okx_readonly()
    test_automation_preflight_history_is_sanitized()
    test_automation_stage_event_history_is_deduped_and_sanitized()
    test_automation_task_board_prioritizes_next_action_and_safety()
    test_automation_task_action_receipts_are_sanitized()
    test_automation_heartbeat_history_is_persisted()
    test_okx_diagnostics_history_missing_credentials()
    test_ai4trade_history_is_sanitized()
    test_readiness_snapshot_api_history_is_sanitized()
    test_execution_config_exposes_live_locks()
    test_high_cost_cache_is_not_auto_recommended()
    test_refresh_stale_candle_cache_skips_high_cost_by_default()
    test_manage_compact_cache_status_tracks_high_cost_manual_rows()
    print("OK automation safety tests passed")


if __name__ == "__main__":
    main()
