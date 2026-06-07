from __future__ import annotations

import sys
import os
from pathlib import Path
from datetime import datetime, timedelta, timezone


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import app  # noqa: E402


def reset_tasks() -> None:
    with app.TASK_CONDITION:
        app.TASKS.clear()
        app.TASK_QUEUE.clear()


def test_task_fingerprint_is_stable() -> None:
    left = app.task_fingerprint("data_refresh", {"max_items": 4, "stale": True})
    right = app.task_fingerprint("data_refresh", {"stale": True, "max_items": 4})
    assert left == right


def test_enqueue_task_dedupes_active_duplicate() -> None:
    original_start = app.start_task_worker
    app.start_task_worker = lambda: None
    try:
        reset_tasks()
        params = {"stale": True, "max_items": 4, "recommended_only": True}
        first = app.enqueue_task("data_refresh", params)
        second = app.enqueue_task("data_refresh", dict(params))
        assert second["id"] == first["id"]
        assert second["deduped"] is True
        assert second["deduped_reason"] == "active_duplicate"
        assert second["deduped_count"] == 1
        assert len(app.TASK_QUEUE) == 1
    finally:
        app.start_task_worker = original_start
        reset_tasks()


def test_execution_order_lifecycle_preview_and_reject() -> None:
    now = datetime(2026, 6, 3, 12, 0, tzinfo=timezone.utc)
    preview = app.execution_order_lifecycle(
        {
            "time": (now - timedelta(seconds=30)).isoformat(),
            "event": "dry_run",
            "status": "candidate",
            "okx_order": {"payload": {"clOrdId": "qs-test", "ordType": "market"}},
        },
        now=now,
    )
    rejected = app.execution_order_lifecycle(
        {
            "time": (now - timedelta(seconds=30)).isoformat(),
            "event": "live_submit_rejected",
            "status": "rejected",
            "rejection_reasons": ["locked"],
        },
        now=now,
    )
    assert preview["phase"] == "preview"
    assert preview["checks"][1]["status"] == "pass"
    assert rejected["phase"] == "blocked"
    assert rejected["next_action"] == "locked"


def test_execution_order_lifecycle_timeout_requires_cancel() -> None:
    now = datetime(2026, 6, 3, 12, 0, tzinfo=timezone.utc)
    lifecycle = app.execution_order_lifecycle(
        {
            "time": (now - timedelta(seconds=180)).isoformat(),
            "event": "live_submitted",
            "status": "submitted",
            "timeout_seconds": 120,
            "exchange_order_id": "ord-1",
            "okx_order": {"payload": {"clOrdId": "qs-test", "ordType": "limit"}},
        },
        now=now,
    )
    assert lifecycle["phase"] == "cancel_due"
    assert lifecycle["expired"] is True
    assert any(row["name"] == "撤单保护" and row["status"] == "fail" for row in lifecycle["checks"])


def test_system_recommendations_include_execution_blockers() -> None:
    rows = app.system_recommendations(
        stale_count=0,
        recommended_count=0,
        files={
            "paper_state": {"exists": True},
            "execution_orders": {"exists": True},
        },
        tasks={"active_count": 0},
        okx_status={"configured": True},
        connector_health={"signature_ready": True},
        execution={"blocked_count": 1, "tracking_count": 0, "latest_action": "cancel required"},
    )
    assert rows[0]["area"] == "执行"
    assert rows[0]["title"] == "处理执行生命周期阻断"
    assert rows[0]["action"] == "cancel required"


def test_execution_order_action_records_manual_receipts() -> None:
    original_file = app.EXECUTION_ORDER_FILE
    temp_file = app.CACHE_DIR / "test-execution-orders.jsonl"
    app.EXECUTION_ORDER_FILE = temp_file
    try:
        if temp_file.exists():
            temp_file.unlink()
        source = {
            "event": "live_submitted",
            "status": "submitted",
            "intent_fingerprint": "fp-1",
            "inst_id": "BTC-USDT-SWAP",
            "side": "long",
            "notional": 10,
            "okx_order": {"payload": {"clOrdId": "qs-test", "ordType": "limit"}},
            "exchange_order_id": "ord-1",
        }
        query = app.execution_order_action({"action": "query", "source": source})
        cancel = app.execution_order_action({"action": "cancel", "source": source})
        fill = app.execution_order_action({"action": "fill", "source": source, "fill_px": 100, "fill_sz": 1})
        rows = app.read_execution_orders(10)["rows"]
        assert query["row"]["event"] == "order_status_check"
        assert query["row"]["adapter_preview"]["endpoint"] == "GET /api/v5/trade/order"
        assert query["row"]["adapter_preview"]["dry_run_only"] is True
        assert cancel["row"]["lifecycle"]["phase"] == "cancelled"
        assert cancel["row"]["adapter_preview"]["endpoint"] == "POST /api/v5/trade/cancel-order"
        assert fill["row"]["lifecycle"]["phase"] == "filled"
        assert fill["row"]["adapter_preview"]["mode"] == "manual_receipt_only"
        assert len(rows) == 3
    finally:
        app.EXECUTION_ORDER_FILE = original_file
        if temp_file.exists():
            temp_file.unlink()


def test_execution_order_action_can_query_and_request_cancel_via_live_adapter() -> None:
    original_file = app.EXECUTION_ORDER_FILE
    original_private_request = app.okx_private_request
    temp_file = app.CACHE_DIR / "test-execution-live-actions.jsonl"
    calls: list[dict] = []
    source = {
        "event": "live_submitted",
        "status": "submitted",
        "intent_fingerprint": "fp-live-action",
        "inst_id": "BTC-USDT-SWAP",
        "side": "long",
        "notional": 10,
        "okx_order": {"payload": {"instId": "BTC-USDT-SWAP", "clOrdId": "qs-live-action", "ordType": "limit"}},
        "exchange_order_id": "ord-live-action",
    }
    try:
        app.EXECUTION_ORDER_FILE = temp_file
        if temp_file.exists():
            temp_file.unlink()

        def fake_private_request(method: str, request_path: str, payload=None, **kwargs):
            calls.append({"method": method, "request_path": request_path, "payload": payload})
            if method == "GET":
                return {
                    "ok": True,
                    "payload": {"code": "0", "data": [{"ordId": "ord-live-action", "clOrdId": "qs-live-action", "state": "live"}]},
                }
            return {
                "ok": True,
                "payload": {"code": "0", "data": [{"ordId": "ord-live-action", "clOrdId": "qs-live-action", "sCode": "0"}]},
            }

        app.okx_private_request = fake_private_request
        query = app.execution_order_action({"action": "query", "source": source, "submit_live_query": True})
        cancel = app.execution_order_action({"action": "cancel", "source": source, "submit_live_cancel": True})
        assert query["row"]["event"] == "order_status_live_query"
        assert query["row"]["status"] == "open"
        assert query["row"]["exchange_order_id"] == "ord-live-action"
        assert cancel["row"]["event"] == "order_cancel_submitted"
        assert cancel["row"]["status"] == "cancel_requested"
        assert cancel["row"]["lifecycle"]["phase"] == "cancel_requested"
        assert cancel["row"]["lifecycle"]["cancelled"] is False
        assert calls[0]["method"] == "GET"
        assert calls[0]["request_path"].startswith("/api/v5/trade/order?")
        assert calls[1] == {
            "method": "POST",
            "request_path": "/api/v5/trade/cancel-order",
            "payload": {"instId": "BTC-USDT-SWAP", "ordId": "ord-live-action"},
        }
    finally:
        app.EXECUTION_ORDER_FILE = original_file
        app.okx_private_request = original_private_request
        if temp_file.exists():
            temp_file.unlink()


def test_execution_lifecycle_system_status_uses_latest_order_event() -> None:
    original_file = app.EXECUTION_ORDER_FILE
    temp_file = app.CACHE_DIR / "test-execution-lifecycle-system.jsonl"
    app.EXECUTION_ORDER_FILE = temp_file
    try:
        if temp_file.exists():
            temp_file.unlink()
        app.append_execution_order(
            {
                "event": "live_submitted",
                "status": "submitted",
                "time": "2026-06-03T11:55:00+00:00",
                "timeout_seconds": 1,
                "intent_fingerprint": "fp-2",
                "exchange_order_id": "ord-2",
            }
        )
        app.execution_order_action(
            {
                "action": "cancel",
                "source": {
                    "event": "live_submitted",
                    "status": "submitted",
                    "intent_fingerprint": "fp-2",
                    "exchange_order_id": "ord-2",
                },
            }
        )
        summary = app.execution_lifecycle_system_status()
        assert summary["current_orders"] == 1
        assert summary["blocked_count"] == 0
        assert summary["phases"]["cancelled"] == 1
    finally:
        app.EXECUTION_ORDER_FILE = original_file
        if temp_file.exists():
            temp_file.unlink()


def test_okx_private_request_preview_redacts_credentials() -> None:
    old_values = {key: os.environ.get(key) for key in app.OKX_ENV_KEYS}
    try:
        os.environ["OKX_API_KEY"] = "test-api-key-1234"
        os.environ["OKX_API_SECRET"] = "test-secret"
        os.environ["OKX_API_PASSPHRASE"] = "test-pass"
        preview = app.okx_private_request_preview("POST", "/api/v5/trade/order", {"instId": "BTC-USDT-SWAP", "sz": "1"})
        assert preview["ok"] is True
        assert preview["signature_ready"] is True
        assert preview["headers"]["OK-ACCESS-KEY"] == "***1234"
        assert "test-api-key" not in str(preview)
        assert preview["body_sha256"]
    finally:
        for key, value in old_values.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value


def test_okx_get_blocks_non_readonly_private_path() -> None:
    old_values = {key: os.environ.get(key) for key in app.OKX_ENV_KEYS}
    try:
        os.environ["OKX_API_KEY"] = "readonly-key-1234"
        os.environ["OKX_API_SECRET"] = "readonly-secret"
        os.environ["OKX_API_PASSPHRASE"] = "readonly-pass"
        result = app.okx_get("/api/v5/trade/orders-pending")
        assert result["ok"] is False
        assert result["category"] == "unsupported_private_path"
        assert result["request_preview"]["readonly_allowed"] is False
        assert "readonly-secret" not in str(result)
        assert "readonly-pass" not in str(result)
    finally:
        for key, value in old_values.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value


def test_final_submission_gate_blocks_order_above_live_notional_cap() -> None:
    intent = {
        "id": "intent-cap",
        "notional": 25,
        "margin_used": 1,
    }
    gate = app.final_submission_gate(
        intent,
        {"allow_dry_run": True, "decision": "仅 dry-run"},
        {"ok": True, "total_equity_usd": 100},
        {"ok": True, "count": 0},
        {"validation": {"ok": True, "status": "valid", "message": "ok"}},
        {"ok": True, "status": "ready"},
        {
            "min_live_equity_usd": 10,
            "live_margin_buffer_mult": 1.2,
            "max_live_order_notional_usd": 10,
            "canary_order_notional_usd": 2,
        },
        data_quality={"ok": True, "status": "fresh"},
    )
    cap_check = next(row for row in gate["checks"] if row["name"] == "单笔名义上限")
    canary_check = next(row for row in gate["checks"] if row["name"] == "Canary试运行")
    assert cap_check["passed"] is False
    assert canary_check["passed"] is True
    assert gate["order_notional"] == 25
    assert gate["max_live_order_notional_usd"] == 10


def test_canary_order_preview_scales_payload_to_target_notional() -> None:
    intent = {
        "id": "intent-canary",
        "inst_id": "BTC-USDT-SWAP",
        "side": "long",
        "order_type": "taker",
        "entry": 100,
        "stop": 95,
        "take_profit": 110,
        "qty": 0.25,
        "notional": 25,
        "margin_used": 1,
        "planned_risk": 1.25,
    }
    rules = {
        "ok": True,
        "inst_id": "BTC-USDT-SWAP",
        "state": "live",
        "contract_value": 0.01,
        "min_size": 1,
        "lot_size": 1,
        "tick_size": 0.1,
    }
    preview = app.canary_order_preview(
        intent,
        rules,
        {"canary_order_notional_usd": 2, "max_live_order_notional_usd": 10},
        "fp-canary",
    )
    assert preview["ok"] is True
    assert preview["target_notional"] == 2.0
    assert preview["scale_factor"] == 0.08
    assert preview["intent"]["qty"] == 0.02
    assert preview["okx_order"]["payload"]["sz"] == "2"
    assert preview["okx_order"]["payload"]["clOrdId"].endswith("c")


def test_submit_live_order_locked_canary_uses_scaled_payload() -> None:
    original_rules = app.okx_instrument_rules
    original_account = app.okx_account_readonly
    original_positions = app.okx_positions_readonly
    original_orders_file = app.EXECUTION_ORDER_FILE
    original_audit_file = app.PAPER_AUDIT_FILE
    old_values = {key: os.environ.get(key) for key in app.OKX_ENV_KEYS}
    temp_orders = app.CACHE_DIR / "test-canary-submit-orders.jsonl"
    temp_audit = app.CACHE_DIR / "test-canary-submit-audit.jsonl"
    intent = {
        "id": "intent-live-canary",
        "inst_id": "BTC-USDT-SWAP",
        "bar": "15m",
        "side": "long",
        "order_type": "taker",
        "entry": 100,
        "stop": 95,
        "take_profit": 110,
        "qty": 0.25,
        "notional": 25,
        "margin_used": 1,
        "planned_risk": 1.25,
    }
    rules = {
        "ok": True,
        "inst_id": "BTC-USDT-SWAP",
        "state": "live",
        "contract_value": 0.01,
        "min_size": 1,
        "lot_size": 1,
        "tick_size": 0.1,
    }
    try:
        app.EXECUTION_ORDER_FILE = temp_orders
        app.PAPER_AUDIT_FILE = temp_audit
        for path in (temp_orders, temp_audit):
            if path.exists():
                path.unlink()
        os.environ["OKX_API_KEY"] = "canary-key-1111"
        os.environ["OKX_API_SECRET"] = "canary-secret"
        os.environ["OKX_API_PASSPHRASE"] = "canary-pass"
        app.okx_instrument_rules = lambda inst_id, inst_type="SWAP": rules
        app.okx_account_readonly = lambda: {"ok": True, "configured": True, "total_equity_usd": 100}
        app.okx_positions_readonly = lambda params=None: {"ok": True, "configured": True, "positions": [], "count": 0}
        result = app.submit_live_order_locked(
            {
                "order_intent": intent,
                "guard": {"allow_live": False, "allow_dry_run": True, "decision": "仅 dry-run"},
                "data_quality": {"ok": True, "status": "fresh"},
                "confirmation": "CONFIRM_LIVE_TRADE",
                "use_canary": True,
                "canary_order_notional_usd": 2,
                "max_live_order_notional_usd": 10,
                "min_live_equity_usd": 10,
                "live_margin_buffer_mult": 1.2,
            }
        )
        cap_check = next(row for row in result["final_gate"]["checks"] if row["name"] == "单笔名义上限")
        canary_check = next(row for row in result["checks"] if row["name"] == "Canary payload")
        assert result["submit_mode"] == "canary"
        assert result["submitted"] is False
        assert result["connector_attempt"]["submitted"] is False
        assert result["connector_attempt"]["request_preview"]["dry_run_only"] is True
        assert result["shadow_order"]["type"] == "shadow_live_order"
        assert result["shadow_order"]["would_submit"] is False
        assert result["shadow_order"]["dry_run_only"] is True
        assert result["shadow_order"]["can_submit_live"] is False
        assert result["shadow_order"]["client_order_id"] == result["okx_order"]["payload"]["clOrdId"]
        assert result["shadow_order"]["payload_sha256"]
        assert "canary-secret" not in str(result["shadow_order"])
        assert "canary-pass" not in str(result["shadow_order"])
        assert result["order_intent"]["notional"] == 2.0
        assert result["okx_order"]["payload"]["sz"] == "2"
        assert result["intent_fingerprint"].endswith("c")
        assert cap_check["passed"] is True
        assert canary_check["passed"] is True
        rows = app.read_execution_orders(10)["rows"]
        assert rows[0]["submit_mode"] == "canary"
        assert rows[0]["okx_order"]["payload"]["sz"] == "2"
        assert rows[0]["shadow_order"]["dry_run_only"] is True
        assert rows[0]["shadow_order"]["payload_sha256"] == result["shadow_order"]["payload_sha256"]
    finally:
        app.okx_instrument_rules = original_rules
        app.okx_account_readonly = original_account
        app.okx_positions_readonly = original_positions
        app.EXECUTION_ORDER_FILE = original_orders_file
        app.PAPER_AUDIT_FILE = original_audit_file
        for path in (temp_orders, temp_audit):
            if path.exists():
                path.unlink()
        for key, value in old_values.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value


def test_submit_live_order_locked_can_submit_when_dual_live_locks_enabled() -> None:
    original_rules = app.okx_instrument_rules
    original_account = app.okx_account_readonly
    original_positions = app.okx_positions_readonly
    original_private_request = app.okx_private_request
    original_live_enabled = app.LIVE_TRADING_ENABLED
    original_order_enabled = app.OKX_LIVE_ORDER_ENABLED
    original_orders_file = app.EXECUTION_ORDER_FILE
    original_audit_file = app.PAPER_AUDIT_FILE
    old_values = {key: os.environ.get(key) for key in app.OKX_ENV_KEYS}
    temp_orders = app.CACHE_DIR / "test-live-submit-orders.jsonl"
    temp_audit = app.CACHE_DIR / "test-live-submit-audit.jsonl"
    calls: list[dict] = []
    intent = {
        "id": "intent-live-submit",
        "inst_id": "BTC-USDT-SWAP",
        "bar": "15m",
        "side": "long",
        "order_type": "taker",
        "entry": 100,
        "stop": 95,
        "take_profit": 110,
        "qty": 0.1,
        "notional": 10,
        "margin_used": 1,
        "planned_risk": 0.5,
    }
    rules = {
        "ok": True,
        "inst_id": "BTC-USDT-SWAP",
        "state": "live",
        "contract_value": 0.01,
        "min_size": 1,
        "lot_size": 1,
        "tick_size": 0.1,
    }
    try:
        app.EXECUTION_ORDER_FILE = temp_orders
        app.PAPER_AUDIT_FILE = temp_audit
        for path in (temp_orders, temp_audit):
            if path.exists():
                path.unlink()
        for key, value in {
            "OKX_API_KEY": "live-key-2222",
            "OKX_API_SECRET": "live-secret",
            "OKX_API_PASSPHRASE": "live-pass",
        }.items():
            os.environ[key] = value
        app.LIVE_TRADING_ENABLED = True
        app.OKX_LIVE_ORDER_ENABLED = True
        app.okx_instrument_rules = lambda inst_id, inst_type="SWAP": rules
        app.okx_account_readonly = lambda: {"ok": True, "configured": True, "total_equity_usd": 100}
        app.okx_positions_readonly = lambda params=None: {"ok": True, "configured": True, "positions": [], "count": 0}

        def fake_private_request(method: str, request_path: str, payload=None, **kwargs):
            calls.append({"method": method, "request_path": request_path, "payload": payload})
            return {
                "ok": True,
                "configured": True,
                "payload": {"code": "0", "data": [{"ordId": "ord-live-1", "clOrdId": payload.get("clOrdId"), "sCode": "0"}]},
                "request_preview": app.okx_private_request_preview(method, request_path, payload),
            }

        app.okx_private_request = fake_private_request
        result = app.submit_live_order_locked(
            {
                "order_intent": intent,
                "guard": {"allow_live": True, "allow_dry_run": True, "decision": "允许实盘"},
                "data_quality": {"ok": True, "status": "fresh"},
                "confirmation": "CONFIRM_LIVE_TRADE",
                "max_live_order_notional_usd": 10,
                "canary_order_notional_usd": 10,
                "min_live_equity_usd": 10,
                "live_margin_buffer_mult": 1.2,
            }
        )
        rows = app.read_execution_orders(10)["rows"]
        assert result["ok"] is True
        assert result["submitted"] is True
        assert result["connector_attempt"]["mode"] == "live_submit"
        assert result["connector_attempt"]["exchange_order_id"] == "ord-live-1"
        assert calls == [{"method": "POST", "request_path": "/api/v5/trade/order", "payload": result["okx_order"]["payload"]}]
        assert rows[0]["event"] == "live_submitted"
        assert rows[0]["status"] == "submitted"
        assert rows[0]["exchange_order_id"] == "ord-live-1"
    finally:
        app.okx_instrument_rules = original_rules
        app.okx_account_readonly = original_account
        app.okx_positions_readonly = original_positions
        app.okx_private_request = original_private_request
        app.LIVE_TRADING_ENABLED = original_live_enabled
        app.OKX_LIVE_ORDER_ENABLED = original_order_enabled
        app.EXECUTION_ORDER_FILE = original_orders_file
        app.PAPER_AUDIT_FILE = original_audit_file
        for path in (temp_orders, temp_audit):
            if path.exists():
                path.unlink()
        for key, value in old_values.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value


def test_okx_private_connector_health_is_safe_and_dry_run_only() -> None:
    old_values = {key: os.environ.get(key) for key in app.OKX_ENV_KEYS}
    try:
        os.environ["OKX_API_KEY"] = "health-api-key-5678"
        os.environ["OKX_API_SECRET"] = "health-secret"
        os.environ["OKX_API_PASSPHRASE"] = "health-pass"
        health = app.okx_private_connector_health(
            {
                "readonly_ok": True,
                "category": "readonly_ok",
                "steps": [{"name": "credentials", "ok": True}, {"name": "account_balance", "ok": True}],
            }
        )
        assert health["ok"] is True
        assert health["status"] == "pass"
        assert health["dry_run_only"] is True
        assert health["can_submit_live"] is False
        assert health["order_request_preview"]["headers"]["OK-ACCESS-KEY"] == "***5678"
        assert "health-secret" not in str(health)
        assert "health-pass" not in str(health)
    finally:
        for key, value in old_values.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value


def test_okx_private_connector_health_reflects_live_order_unlock() -> None:
    original_live_enabled = app.LIVE_TRADING_ENABLED
    original_order_enabled = app.OKX_LIVE_ORDER_ENABLED
    old_values = {key: os.environ.get(key) for key in app.OKX_ENV_KEYS}
    try:
        os.environ["OKX_API_KEY"] = "health-api-key-9012"
        os.environ["OKX_API_SECRET"] = "health-secret"
        os.environ["OKX_API_PASSPHRASE"] = "health-pass"
        app.LIVE_TRADING_ENABLED = True
        app.OKX_LIVE_ORDER_ENABLED = True
        health = app.okx_private_connector_health(
            {
                "readonly_ok": True,
                "category": "readonly_ok",
                "steps": [{"name": "credentials", "ok": True}, {"name": "account_balance", "ok": True}],
            }
        )
        assert health["dry_run_only"] is False
        assert health["can_submit_live"] is True
        assert health["trade_submit_locked"] is False
    finally:
        app.LIVE_TRADING_ENABLED = original_live_enabled
        app.OKX_LIVE_ORDER_ENABLED = original_order_enabled
        for key, value in old_values.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value


def test_okx_diagnostics_missing_credentials_includes_connector_health() -> None:
    old_values = {key: os.environ.get(key) for key in app.OKX_ENV_KEYS}
    try:
        for key in app.OKX_ENV_KEYS:
            os.environ.pop(key, None)
        diagnostics = app.okx_diagnostics()
        health = diagnostics["connector_health"]
        assert diagnostics["readonly_ok"] is False
        assert health["status"] == "missing_credentials"
        assert health["safe_to_query_private"] is False
        assert health["read_only_request_previews"][0]["signature_ready"] is False
    finally:
        for key, value in old_values.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value


def test_okx_diagnostics_success_includes_positions_and_order_query_preview() -> None:
    original_get = app.okx_get
    old_values = {key: os.environ.get(key) for key in app.OKX_ENV_KEYS}
    try:
        os.environ["OKX_API_KEY"] = "diag-key-9999"
        os.environ["OKX_API_SECRET"] = "diag-secret"
        os.environ["OKX_API_PASSPHRASE"] = "diag-pass"

        def fake_okx_get(request_path: str) -> dict:
            if request_path == "/api/v5/account/config":
                return {"ok": True, "configured": True, "payload": {"code": "0", "data": [{"acctLv": "2"}]}}
            if request_path == "/api/v5/account/balance":
                return {
                    "ok": True,
                    "configured": True,
                    "payload": {
                        "code": "0",
                        "data": [{"totalEq": "100", "adjEq": "98", "isoEq": "0", "details": []}],
                    },
                }
            if request_path == "/api/v5/account/positions?instType=SWAP":
                return {"ok": True, "configured": True, "payload": {"code": "0", "data": []}}
            raise AssertionError(f"unexpected request path: {request_path}")

        app.okx_get = fake_okx_get
        diagnostics = app.okx_diagnostics()
        step_names = [row["name"] for row in diagnostics["steps"]]
        preview = diagnostics["order_query_request_preview"]
        assert diagnostics["readonly_ok"] is True
        assert "account_positions" in step_names
        assert diagnostics["connector_health"]["can_submit_live"] is False
        assert diagnostics["connector_health"]["trade_submit_locked"] is True
        assert preview["method"] == "GET"
        assert preview["readonly_allowed"] is True
        assert "/api/v5/trade/order?" in preview["request_path"]
        assert "diag-secret" not in str(diagnostics)
        assert "diag-pass" not in str(diagnostics)
    finally:
        app.okx_get = original_get
        for key, value in old_values.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value


def test_system_status_includes_connector_health_without_live_submit() -> None:
    old_values = {key: os.environ.get(key) for key in app.OKX_ENV_KEYS}
    try:
        for key in app.OKX_ENV_KEYS:
            os.environ.pop(key, None)
        status = app.system_status()
        health = status["environment"]["connector_health"]
        assert health["status"] == "missing_credentials"
        assert health["dry_run_only"] is True
        assert health["can_submit_live"] is False
    finally:
        for key, value in old_values.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value


def main() -> None:
    test_task_fingerprint_is_stable()
    test_enqueue_task_dedupes_active_duplicate()
    test_execution_order_lifecycle_preview_and_reject()
    test_execution_order_lifecycle_timeout_requires_cancel()
    test_system_recommendations_include_execution_blockers()
    test_execution_order_action_records_manual_receipts()
    test_execution_order_action_can_query_and_request_cancel_via_live_adapter()
    test_execution_lifecycle_system_status_uses_latest_order_event()
    test_okx_private_request_preview_redacts_credentials()
    test_okx_get_blocks_non_readonly_private_path()
    test_final_submission_gate_blocks_order_above_live_notional_cap()
    test_canary_order_preview_scales_payload_to_target_notional()
    test_submit_live_order_locked_canary_uses_scaled_payload()
    test_submit_live_order_locked_can_submit_when_dual_live_locks_enabled()
    test_okx_private_connector_health_is_safe_and_dry_run_only()
    test_okx_private_connector_health_reflects_live_order_unlock()
    test_okx_diagnostics_missing_credentials_includes_connector_health()
    test_okx_diagnostics_success_includes_positions_and_order_query_preview()
    test_system_status_includes_connector_health_without_live_submit()
    print("OK task queue tests passed")


if __name__ == "__main__":
    main()
