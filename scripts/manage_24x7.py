#!/usr/bin/env python3
from __future__ import annotations

import argparse
import getpass
import json
import os
import plistlib
import re
import shutil
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = Path(__file__).resolve()
UI_DIR = ROOT / "quant-studio-ui"
CACHE_DIR = ROOT / ".cache"
LAUNCHD_LOG_DIR = CACHE_DIR / "launchd"
WATCHDOG_STATE_FILE = LAUNCHD_LOG_DIR / "watchdog-state.json"
READINESS_SNAPSHOT_FILE = LAUNCHD_LOG_DIR / "readiness-snapshots.jsonl"
EVIDENCE_BUNDLE_DIR = LAUNCHD_LOG_DIR / "evidence"
LAUNCH_AGENTS_DIR = Path.home() / "Library" / "LaunchAgents"
LAUNCHD_DOMAIN = f"gui/{os.getuid()}"

PATH_ENV = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
OKX_KEYCHAIN_SERVICE = "okx-perp-bot"
AI4TRADE_KEYCHAIN_SERVICE = "ai4trade"
OKX_KEYS = ("OKX_API_KEY", "OKX_API_SECRET", "OKX_API_PASSPHRASE")
AI4TRADE_KEYS = ("AI4TRADE_TOKEN", "AI4TRADE_AGENT_ID", "AI4TRADE_AGENT_NAME")
SAFETY_LOCK_KEYS = ("LIVE_TRADING_ENABLED", "OKX_LIVE_ORDER_ENABLED", "OKX_LIVE_CANCEL_ENABLED")
SENSITIVE_FIELD_FRAGMENTS = ("secret", "passphrase", "signature", "api_key", "apikey", "token")
READINESS_SNAPSHOT_WATCHDOG_INTERVAL_SECONDS = 15 * 60
MARKET_REFRESH_WATCHDOG_INTERVAL_SECONDS = 30 * 60
EXECUTION_SHADOW_RECENT_SECONDS = 6 * 60 * 60
RECENT_BACKTEST_EVIDENCE_FRESH_SECONDS = 6 * 60 * 60
HISTORY_FRESH_SECONDS = 30 * 60
PRE_LIVE_GATE_PHASES = ("readonly", "canary", "live-submit")
RECENT_BACKTEST_DEFAULTS: dict[str, Any] = {
    "symbols": ["BTC-USDT-SWAP", "ETH-USDT-SWAP", "SOL-USDT-SWAP"],
    "instId": "BTC-USDT-SWAP",
    "bar": "15m",
    "trend_bar": "1H",
    "history_hours": 2160,
    "initial_equity": 10,
    "risk_pct": 0.10,
    "leverage": 75,
    "min_leverage": 5,
    "adaptive_leverage": True,
    "adaptive_trade_management": True,
    "adaptive_risk": True,
    "loss_streak_risk_decay": 0.30,
    "drawdown_risk_sensitivity": 3.2,
    "min_adaptive_risk_factor": 0.22,
    "absolute_min_risk_factor": 0.08,
    "max_margin_pct": 0.7,
    "margin_pct_per_trade": 0.7,
    "max_leverage": 75,
    "maintenance_margin_rate": 0.005,
    "min_liq_buffer_pct": 0.003,
    "strategy_mode": "louie_price_action",
    "lookback": 8,
    "atr_period": 14,
    "atr_stop_mult": 1.9,
    "take_profit_rr": 3.0,
    "min_body_ratio": 0.45,
    "min_adx": 18,
    "min_breakout_atr": 0.15,
    "min_sweep_atr": 0.15,
    "use_regime_filter": True,
    "require_next_confirmation": False,
    "prefer_cache": True,
    "offline_mode": True,
    "enable_risk_circuit_breaker": True,
    "max_daily_loss_pct": 0.12,
    "max_loss_streak_stop": 4,
    "max_account_drawdown_pct": 0.30,
    "max_atr_pct": 0.012,
    "max_strategy_drawdown": 0.35,
    "cooldown_bars": 4,
    "time_exit_bars": 0,
    "time_exit_min_rr": 0.25,
    "loss_streak_pause_bars": 0,
    "max_daily_trades": 1,
    "min_signal_score": 0.55,
    "second_trade_allowed_kinds": None,
    "second_trade_side": "any",
    "cost_model": "okx_aggressive",
    "fee_rate": 0.0005,
    "maker_fee_rate": 0.0002,
    "taker_fee_rate": 0.0005,
    "entry_order_type": "taker",
    "take_profit_order_type": "maker",
    "stop_order_type": "taker",
    "slippage_pct": 0.0002,
    "use_multi_take_profit": False,
    "tp1_share_pct": 0.4,
    "tp2_share_pct": 0.3,
    "move_stop_to_breakeven_after_tp1": True,
    "trend_adx": 24,
    "range_adx": 18,
    "max_risk_atr": 3,
    "adx_period": 14,
    "trend_fast": 50,
    "trend_slow": 120,
    "max_surprise_prior_run_atr": 3.2,
    "max_surprise_confirm_extension_atr": 1.0,
    "max_surprise_confirm_retrace_atr": 0.95,
    "trade_louie_trend_regime": False,
    "trade_louie_breakout_tests": True,
    "trade_louie_delayed_sweeps": True,
    "min_louie_breakout_adx": 32,
    "breakout_risk_factor": 0.35,
    "enable_breakout_guard": True,
    "breakout_guard_window": 8,
    "breakout_guard_min_samples": 4,
    "breakout_guard_max_loss_rate": 0.65,
    "breakout_guard_risk_multiplier": 0.70,
    "block_eth_longs": True,
    "block_delayed_sweep_in_chaos": False,
    "block_long_in_chaos": False,
    "block_breakout_against_trend": True,
    "short_trend_risk_factor": 0.70,
    "limit": 300,
}

SERVICES: dict[str, dict[str, Any]] = {
    "backend": {
        "label": "com.okxperpbot.backend",
        "log": "backend.log",
        "port": 8765,
        "url": "http://127.0.0.1:8765/api/paper/status",
    },
    "frontend": {
        "label": "com.okxperpbot.frontend",
        "log": "frontend.log",
        "port": 5173,
        "url": "http://127.0.0.1:5173/",
    },
    "ai4trade": {
        "label": "com.okxperpbot.ai4trade",
        "log": "ai4trade.log",
        "port": 8766,
        "url": "http://127.0.0.1:8766/api/ai4trade/health",
    },
    "caffeinate": {
        "label": "com.okxperpbot.caffeinate",
        "log": "caffeinate.log",
        "port": None,
        "url": None,
    },
    "watchdog": {
        "label": "com.okxperpbot.watchdog",
        "log": "watchdog.log",
        "port": None,
        "url": None,
    },
}
DEFAULT_SERVICE_ORDER = ("backend", "frontend", "ai4trade", "caffeinate", "watchdog")


class Health:
    def __init__(self) -> None:
        self.checks: list[dict[str, Any]] = []
        self.critical: list[str] = []
        self.warnings: list[str] = []

    def add(self, name: str, ok: bool, detail: str = "", *, severity: str = "critical", data: dict[str, Any] | None = None) -> None:
        row = {
            "name": name,
            "ok": bool(ok),
            "severity": severity,
            "detail": detail,
            "data": data or {},
        }
        self.checks.append(row)
        if ok:
            return
        if severity == "warning":
            self.warnings.append(f"{name}: {detail}")
        else:
            self.critical.append(f"{name}: {detail}")

    def payload(self) -> dict[str, Any]:
        return {
            "ok": not self.critical,
            "status": "ok" if not self.critical and not self.warnings else "warning" if not self.critical else "critical",
            "critical": self.critical,
            "warnings": self.warnings,
            "checks": self.checks,
            "updated_at": now_iso(),
        }


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def ensure_dirs() -> None:
    CACHE_DIR.mkdir(exist_ok=True)
    LAUNCHD_LOG_DIR.mkdir(parents=True, exist_ok=True)
    LAUNCH_AGENTS_DIR.mkdir(parents=True, exist_ok=True)


def is_sensitive_key(key: str) -> bool:
    normalized = key.lower().replace("-", "_")
    return any(fragment in normalized for fragment in SENSITIVE_FIELD_FRAGMENTS)


def redact_text(value: str) -> str:
    patterns = (
        r"(?i)(api[_-]?key|api[_-]?secret|passphrase|signature|token)=([^\s,&}]+)",
        r"(?i)(\"(?:api[_-]?key|api[_-]?secret|passphrase|signature|token)\"\s*:\s*\")([^\"]+)(\")",
    )
    redacted = value
    redacted = re.sub(patterns[0], lambda match: f"{match.group(1)}=<redacted>", redacted)
    redacted = re.sub(patterns[1], lambda match: f"{match.group(1)}<redacted>{match.group(3)}", redacted)
    return redacted


def sanitize_for_log(value: Any) -> Any:
    if isinstance(value, dict):
        sanitized: dict[str, Any] = {}
        for key, item in value.items():
            if is_sensitive_key(str(key)):
                sanitized[key] = "<redacted>" if item not in (None, "", False) else item
            else:
                sanitized[key] = sanitize_for_log(item)
        return sanitized
    if isinstance(value, list):
        return [sanitize_for_log(item) for item in value]
    if isinstance(value, str):
        return redact_text(value)
    return value


def service_names(args: argparse.Namespace) -> list[str]:
    requested = getattr(args, "services", None) or list(DEFAULT_SERVICE_ORDER)
    names = []
    for name in requested:
        if name not in SERVICES:
            raise SystemExit(f"Unknown service: {name}")
        names.append(name)
    return names


def plist_path(name: str) -> Path:
    return LAUNCH_AGENTS_DIR / f"{SERVICES[name]['label']}.plist"


def launch_target(name: str) -> str:
    return f"{LAUNCHD_DOMAIN}/{SERVICES[name]['label']}"


def launchctl(*args: str, check: bool = False) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["/bin/launchctl", *args],
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        check=check,
    )


def write_plist(name: str) -> Path:
    ensure_dirs()
    service = SERVICES[name]
    log_path = LAUNCHD_LOG_DIR / str(service["log"])
    if name == "watchdog":
        program_args = [sys.executable, str(SCRIPT), "run-watchdog"]
    else:
        program_args = [sys.executable, str(SCRIPT), "run-service", name]
    payload = {
        "Label": service["label"],
        "ProgramArguments": program_args,
        "WorkingDirectory": str(ROOT),
        "RunAtLoad": True,
        "KeepAlive": True,
        "ThrottleInterval": 10,
        "StandardOutPath": str(log_path),
        "StandardErrorPath": str(log_path),
        "EnvironmentVariables": {
            "PATH": PATH_ENV,
            "PYTHONUNBUFFERED": "1",
            "VITE_API_BASE_URL": "http://127.0.0.1:8765",
            "QUANT_STUDIO_URL": "http://127.0.0.1:5173/",
        },
    }
    path = plist_path(name)
    with path.open("wb") as handle:
        plistlib.dump(payload, handle, sort_keys=False)
    return path


def bootout(name: str) -> None:
    path = plist_path(name)
    attempts = [
        [LAUNCHD_DOMAIN, str(path)],
        [launch_target(name)],
    ]
    for attempt in attempts:
        launchctl("bootout", *attempt, check=False)


def bootstrap(name: str) -> None:
    path = plist_path(name)
    if not path.exists():
        write_plist(name)
    result = launchctl("bootstrap", LAUNCHD_DOMAIN, str(path), check=False)
    if result.returncode != 0 and "already bootstrapped" not in result.stdout.lower():
        raise SystemExit(result.stdout.strip() or f"launchctl bootstrap failed: {name}")


def kickstart(name: str) -> None:
    result = launchctl("kickstart", "-k", launch_target(name), check=False)
    if result.returncode != 0:
        print(result.stdout.strip())


def install(args: argparse.Namespace) -> None:
    ensure_dirs()
    for name in service_names(args):
        path = write_plist(name)
        print(f"wrote {path}")
        if not args.no_start:
            bootout(name)
            bootstrap(name)
            kickstart(name)
            print(f"started {SERVICES[name]['label']}")


def uninstall(args: argparse.Namespace) -> None:
    for name in service_names(args):
        bootout(name)
        path = plist_path(name)
        if path.exists() and not args.keep_plists:
            path.unlink()
            print(f"removed {path}")
        else:
            print(f"unloaded {SERVICES[name]['label']}")


def start(args: argparse.Namespace) -> None:
    for name in service_names(args):
        bootstrap(name)
        kickstart(name)
        print(f"started {SERVICES[name]['label']}")


def stop(args: argparse.Namespace) -> None:
    for name in reversed(service_names(args)):
        bootout(name)
        print(f"stopped {SERVICES[name]['label']}")


def restart(args: argparse.Namespace) -> None:
    for name in reversed(service_names(args)):
        bootout(name)
    for name in service_names(args):
        bootstrap(name)
        kickstart(name)
        print(f"restarted {SERVICES[name]['label']}")


def print_status(args: argparse.Namespace) -> None:
    payload = service_status_payload(service_names(args))
    for row in payload["services"]:
        label = row["label"]
        print(f"{label:30} loaded={row['loaded']!s:<5} state={row['state']:<12} pid={row['pid']:<8} port={row['port_state']:<6} log={row['log']}")


def service_status_payload(names: list[str] | None = None) -> dict[str, Any]:
    rows: list[dict[str, Any]] = []
    for name in names or list(DEFAULT_SERVICE_ORDER):
        if name not in SERVICES:
            continue
        label = SERVICES[name]["label"]
        result = launchctl("print", launch_target(name), check=False)
        loaded = result.returncode == 0
        pid = "-"
        state = "not-loaded"
        if loaded:
            for line in result.stdout.splitlines():
                stripped = line.strip()
                if stripped.startswith("pid ="):
                    pid = stripped.split("=", 1)[1].strip()
                if stripped.startswith("state ="):
                    state = stripped.split("=", 1)[1].strip()
        port = SERVICES[name].get("port")
        port_state = "n/a" if not port else "open" if port_open("127.0.0.1", int(port), timeout=0.5) else "closed"
        active = bool(loaded and state == "active" and (port_state in {"open", "n/a"}))
        rows.append(
            {
                "name": name,
                "label": label,
                "loaded": loaded,
                "active": active,
                "state": state,
                "pid": pid,
                "port": port,
                "port_state": port_state,
                "log": str(LAUNCHD_LOG_DIR / SERVICES[name]["log"]),
            }
        )
    return {
        "ok": all(row["active"] for row in rows),
        "count": len(rows),
        "services": rows,
        "updated_at": now_iso(),
    }


def keychain_get(service: str, account: str) -> str:
    result = subprocess.run(
        ["/usr/bin/security", "find-generic-password", "-s", service, "-a", account, "-w"],
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
    )
    return result.stdout.strip() if result.returncode == 0 else ""


def keychain_set(service: str, account: str, value: str) -> None:
    subprocess.run(
        ["/usr/bin/security", "add-generic-password", "-s", service, "-a", account, "-w", value, "-U"],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
        text=True,
        check=True,
    )


def keychain_presence(service: str, keys: tuple[str, ...]) -> dict[str, bool]:
    return {key: bool(keychain_get(service, key)) for key in keys}


def keychain_presence_detail(keys: dict[str, bool]) -> str:
    return " · ".join(f"{key.replace('OKX_', '').replace('AI4TRADE_', '')}:{'有' if value else '无'}" for key, value in keys.items())


def parse_env_file(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.exists():
        return values
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip('"').strip("'")
    return values


def import_secrets(args: argparse.Namespace) -> None:
    source_values: dict[str, str] = {}
    if args.from_env_file:
        source_values.update(parse_env_file(Path(args.from_env_file).expanduser()))
    if args.from_process_env:
        for key in (*OKX_KEYS, *AI4TRADE_KEYS):
            if os.environ.get(key):
                source_values[key] = os.environ[key]

    written: list[str] = []
    for key in OKX_KEYS:
        existing = keychain_get(OKX_KEYCHAIN_SERVICE, key)
        value = source_values.get(key, "")
        if not value and not args.no_prompt:
            prompt = f"{key} ({'keep existing' if existing else 'blank to skip'}): "
            value = getpass.getpass(prompt).strip()
        if value:
            keychain_set(OKX_KEYCHAIN_SERVICE, key, value)
            written.append(key)

    for key in AI4TRADE_KEYS:
        existing = keychain_get(AI4TRADE_KEYCHAIN_SERVICE, key)
        value = source_values.get(key, "")
        if not value and not args.no_prompt:
            prompt = f"{key} ({'keep existing' if existing else 'blank to skip'}): "
            value = getpass.getpass(prompt).strip()
        if value:
            keychain_set(AI4TRADE_KEYCHAIN_SERVICE, key, value)
            written.append(key)

    if written:
        print(f"imported {len(written)} keychain item(s): {', '.join(written)}")
    else:
        print("no secrets imported")
    okx_presence = keychain_presence(OKX_KEYCHAIN_SERVICE, OKX_KEYS)
    ai4trade_presence = keychain_presence(AI4TRADE_KEYCHAIN_SERVICE, AI4TRADE_KEYS)
    okx_configured = all(okx_presence.values())
    ai4trade_token_present = bool(ai4trade_presence.get("AI4TRADE_TOKEN"))
    print(f"keychain verify OKX: {'configured' if okx_configured else 'missing'} · {keychain_presence_detail(okx_presence)}")
    print(f"keychain verify AI4Trade: {'token_present' if ai4trade_token_present else 'missing_token'} · {keychain_presence_detail(ai4trade_presence)}")
    if any(key in written for key in OKX_KEYS) and not okx_configured:
        missing = [key for key, present in okx_presence.items() if not present]
        raise SystemExit(f"partial OKX keychain import; missing: {', '.join(missing)}")
    if args.restart:
        restart_services = ["backend", "ai4trade", "watchdog"]
        print(f"restarting services to load keychain: {', '.join(restart_services)}")
        restart(argparse.Namespace(services=restart_services))
    should_verify = (getattr(args, "verify", False) or (args.restart and bool(written))) and not getattr(args, "skip_verify", False)
    if should_verify:
        verify_import_readiness()


def apply_keychain_env(env: dict[str, str]) -> dict[str, str]:
    for key in OKX_KEYS:
        value = keychain_get(OKX_KEYCHAIN_SERVICE, key)
        if value:
            env[key] = value
    for key in AI4TRADE_KEYS:
        value = keychain_get(AI4TRADE_KEYCHAIN_SERVICE, key)
        if value:
            env[key] = value
    return env


def executable(name: str) -> str:
    path = shutil.which(name, path=PATH_ENV)
    if not path:
        raise SystemExit(f"Cannot find executable: {name}")
    return path


def run_service(args: argparse.Namespace) -> None:
    name = args.name
    if name not in SERVICES or name == "watchdog":
        raise SystemExit(f"Unsupported service: {name}")
    ensure_dirs()
    env = os.environ.copy()
    env["PATH"] = PATH_ENV
    env["PYTHONUNBUFFERED"] = "1"
    env["VITE_API_BASE_URL"] = "http://127.0.0.1:8765"
    env["QUANT_STUDIO_URL"] = "http://127.0.0.1:5173/"
    for key in SAFETY_LOCK_KEYS:
        env[key] = "0"
    apply_keychain_env(env)

    cwd = ROOT
    if name == "backend":
        command = [sys.executable, str(ROOT / "app.py")]
    elif name == "frontend":
        cwd = UI_DIR
        vite_js = UI_DIR / "node_modules" / "vite" / "bin" / "vite.js"
        if vite_js.exists():
            command = [executable("node"), str(vite_js), "--host", "127.0.0.1", "--port", "5173"]
        else:
            command = [executable("npm"), "run", "dev", "--", "--host", "127.0.0.1", "--port", "5173"]
    elif name == "ai4trade":
        command = [sys.executable, str(ROOT / "scripts" / "ai4trade_readonly_server.py"), "--host", "127.0.0.1", "--port", "8766"]
    elif name == "caffeinate":
        command = ["/usr/bin/caffeinate", "-ims"]
    else:
        raise SystemExit(f"Unsupported service: {name}")

    print(f"{now_iso()} exec {name}: {' '.join(command)}", flush=True)
    os.chdir(cwd)
    os.execve(command[0], command, env)


def http_request(url: str, timeout: float = 5.0) -> tuple[bool, Any, str]:
    try:
        with urllib.request.urlopen(url, timeout=timeout) as response:
            body = response.read().decode("utf-8", errors="replace")
            content_type = response.headers.get("Content-Type", "")
            if "json" in content_type:
                return True, json.loads(body) if body else {}, ""
            return True, body, ""
    except urllib.error.HTTPError as exc:
        return False, {}, f"HTTP {exc.code}"
    except Exception as exc:
        return False, {}, str(exc)


def wait_for_http(url: str, *, timeout_seconds: float = 45.0, poll_seconds: float = 1.0) -> tuple[bool, Any, str]:
    deadline = time.time() + timeout_seconds
    last_error = ""
    while time.time() < deadline:
        ok, payload, error = http_request(url, timeout=min(5.0, max(1.0, poll_seconds + 1.0)))
        if ok:
            return True, payload, ""
        last_error = error
        time.sleep(poll_seconds)
    return False, {}, last_error or f"timeout after {timeout_seconds:.0f}s"


def port_open(host: str, port: int, timeout: float = 1.0) -> bool:
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False


def parse_time(value: str | None) -> float | None:
    if not value:
        return None
    try:
        normalized = value.replace("Z", "+00:00")
        return datetime.fromisoformat(normalized).timestamp()
    except ValueError:
        return None


def history_latest(history: Any) -> tuple[int, dict[str, Any], float | None]:
    if not isinstance(history, dict):
        return 0, {}, None
    rows = history.get("rows") if isinstance(history.get("rows"), list) else []
    latest = history.get("latest") if isinstance(history.get("latest"), dict) else (rows[0] if rows and isinstance(rows[0], dict) else {})
    count = int(history.get("count") or len(rows) or (1 if latest else 0))
    latest_ts = parse_time((latest.get("time") or latest.get("slot")) if isinstance(latest, dict) else None)
    age = max(0, time.time() - latest_ts) if latest_ts else None
    return count, latest if isinstance(latest, dict) else {}, age


def _safe_int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def ai4trade_signal_alignment(
    ai4trade: dict[str, Any] | None,
    ai_latest: dict[str, Any] | None,
    ai_history_count: int,
    automation: dict[str, Any] | None,
    config: dict[str, Any] | None,
) -> tuple[bool, str, dict[str, Any]]:
    ai4trade = ai4trade if isinstance(ai4trade, dict) else {}
    ai_latest = ai_latest if isinstance(ai_latest, dict) else {}
    automation = automation if isinstance(automation, dict) else {}
    config = config if isinstance(config, dict) else {}

    policy = ai4trade.get("policy") if isinstance(ai4trade.get("policy"), dict) else {}
    latest_policy = ai_latest.get("policy") if isinstance(ai_latest.get("policy"), dict) else {}
    signals = ai_latest.get("signals") if isinstance(ai_latest.get("signals"), dict) else {}
    signal_summary = signals.get("summary") if isinstance(signals.get("summary"), dict) else {}
    signal_count = _safe_int(signal_summary.get("count"))

    automation_policy = automation.get("policy") if isinstance(automation.get("policy"), dict) else {}
    connector = config.get("connector_status") if isinstance(config.get("connector_status"), dict) else {}
    local_dry_run = bool(automation_policy.get("dry_run_only") and connector.get("dry_run_only"))
    local_can_submit = bool(
        automation_policy.get("can_submit_live")
        or connector.get("can_submit_live")
        or config.get("live_submit_available")
    )
    local_live_locked = bool(local_dry_run and not local_can_submit)

    trade_locked = bool(policy.get("trade_endpoints_locked") and latest_policy.get("trade_endpoints_locked", True))
    copy_locked = bool(policy.get("copy_trade_locked") and latest_policy.get("copy_trade_locked", True))
    publish_locked = bool(policy.get("publish_locked") and latest_policy.get("publish_locked", True))
    execution_allowed = bool(policy.get("execution_allowed"))
    okx_bridge = str(policy.get("okx_bridge") or latest_policy.get("okx_bridge") or "")
    bridge_disabled = "disabled" in okx_bridge.lower()
    bridge_locked = bool(trade_locked and copy_locked and publish_locked and not execution_allowed and bridge_disabled)

    configured = bool(ai4trade.get("configured") or ai_latest.get("configured"))
    has_history = int(ai_history_count or 0) > 0
    has_signals = signal_count > 0
    ok = bool(configured and has_history and has_signals and bridge_locked and local_live_locked)
    automation_state = str(automation.get("state") or "-")
    detail = (
        f"signals={signal_count} · automation={automation_state} · "
        f"ai4trade_bridge={'locked' if bridge_locked else 'unlocked'} · "
        f"can_submit_live={local_can_submit}"
    )
    data = {
        "configured": configured,
        "history_count": int(ai_history_count or 0),
        "signal_count": signal_count,
        "symbols": signal_summary.get("symbols") if isinstance(signal_summary.get("symbols"), list) else [],
        "types": signal_summary.get("types") if isinstance(signal_summary.get("types"), list) else [],
        "automation_state": automation_state,
        "automation_stage": ((automation.get("readiness") or {}).get("stage") if isinstance(automation.get("readiness"), dict) else None),
        "bridge_locked": bridge_locked,
        "trade_endpoints_locked": trade_locked,
        "copy_trade_locked": copy_locked,
        "publish_locked": publish_locked,
        "execution_allowed": execution_allowed,
        "okx_bridge": okx_bridge,
        "local_live_locked": local_live_locked,
        "local_dry_run": local_dry_run,
        "local_can_submit": local_can_submit,
    }
    return ok, detail, data


def execution_ledger_has_live_submit() -> tuple[bool, dict[str, Any] | None]:
    path = CACHE_DIR / "execution-orders.jsonl"
    if not path.exists():
        return False, None
    try:
        lines = path.read_text(encoding="utf-8").splitlines()[-1000:]
    except OSError:
        return False, None
    for line in reversed(lines):
        try:
            row = json.loads(line)
        except json.JSONDecodeError:
            continue
        if row.get("event") == "live_submitted" or row.get("status") == "submitted" or row.get("submitted") is True:
            return True, {
                "time": row.get("time"),
                "event": row.get("event"),
                "status": row.get("status"),
                "inst_id": row.get("inst_id"),
                "exchange_order_id": row.get("exchange_order_id"),
            }
    return False, None


def execution_ledger_shadow_status(limit: int = 1000) -> dict[str, Any]:
    path = CACHE_DIR / "execution-orders.jsonl"
    if not path.exists():
        return {
            "present": False,
            "ok": False,
            "detail": "execution ledger missing",
            "latest": None,
        }
    try:
        lines = path.read_text(encoding="utf-8").splitlines()[-max(1, min(limit, 5000)) :]
    except OSError as exc:
        return {
            "present": False,
            "ok": False,
            "detail": str(exc),
            "latest": None,
        }
    latest: dict[str, Any] | None = None
    for line in reversed(lines):
        try:
            row = json.loads(line)
        except json.JSONDecodeError:
            continue
        if row.get("event") in {"dry_run", "live_submit_rejected"}:
            latest = row
            break
    if latest is None:
        return {
            "present": False,
            "ok": False,
            "detail": "no dry-run or live-submit-rejected ledger row",
            "latest": None,
        }
    shadow = latest.get("shadow_order") if isinstance(latest.get("shadow_order"), dict) else {}
    shadow_present = bool(shadow.get("type") == "shadow_live_order")
    locked = bool(shadow.get("would_submit") is False and shadow.get("dry_run_only") is True and shadow.get("can_submit_live") is False)
    payload_ready = bool(shadow.get("payload_ready"))
    payload_hash_ok = bool(shadow.get("payload_sha256")) or not payload_ready
    ok = bool(shadow_present and locked and payload_hash_ok)
    return {
        "present": shadow_present,
        "ok": ok,
        "locked": locked,
        "payload_hash_ok": payload_hash_ok,
        "payload_ready": payload_ready,
        "detail": (
            f"{latest.get('event')} · would_submit={shadow.get('would_submit')} "
            f"dry_run_only={shadow.get('dry_run_only')} can_submit_live={shadow.get('can_submit_live')} "
            f"payload_hash={'present' if shadow.get('payload_sha256') else 'not_required' if not payload_ready else 'missing'}"
        ),
        "latest": {
            "time": latest.get("time"),
            "event": latest.get("event"),
            "status": latest.get("status"),
            "intent_fingerprint": latest.get("intent_fingerprint"),
            "shadow_type": shadow.get("type"),
            "client_order_id": shadow.get("client_order_id"),
            "payload_sha256": shadow.get("payload_sha256"),
            "blocked_reason": shadow.get("blocked_reason"),
        },
    }


def automation_task_board_evidence_status(state: dict[str, Any], top_task_id: str | None) -> dict[str, Any]:
    data: dict[str, Any] = {
        "expected_top_task_id": top_task_id,
        "path": state.get("automation_top_task_evidence_path") or "",
        "state_error": state.get("automation_top_task_evidence_error") or "",
    }
    if not top_task_id:
        return {"ok": True, "detail": "no top task evidence required", "data": data}

    path_value = str(data["path"] or "")
    if not path_value:
        return {"ok": False, "detail": f"missing watchdog task evidence path · top={top_task_id}", "data": data}

    path = Path(path_value).expanduser()
    data["path"] = str(path)
    if not path.exists():
        return {"ok": False, "detail": f"watchdog task evidence file missing · top={top_task_id}", "data": data}

    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        data["parse_error"] = str(exc)
        return {"ok": False, "detail": f"watchdog task evidence invalid json · top={top_task_id}", "data": data}

    trigger = payload.get("watchdog_trigger") if isinstance(payload, dict) else {}
    if not isinstance(trigger, dict):
        trigger = {}
    payload_top = payload.get("top_task") if isinstance(payload, dict) and isinstance(payload.get("top_task"), dict) else {}
    recorded_at = trigger.get("recorded_at")
    recorded_ts = parse_time(recorded_at)
    age_seconds = max(0.0, time.time() - recorded_ts) if recorded_ts is not None else None
    trigger_top_task_id = trigger.get("top_task_id")
    data.update(
        {
            "trigger_top_task_id": trigger_top_task_id,
            "trigger_top_task_title": trigger.get("top_task_title"),
            "trigger_top_task_status": trigger.get("top_task_status"),
            "payload_top_task_id": payload_top.get("id"),
            "recorded_at": recorded_at,
            "age_seconds": age_seconds,
        }
    )

    state_error = str(data.get("state_error") or "")
    if state_error:
        return {"ok": False, "detail": f"watchdog task evidence error · top={top_task_id} · {state_error}", "data": data}
    if trigger_top_task_id != top_task_id:
        return {
            "ok": False,
            "detail": f"watchdog task evidence mismatch · expected={top_task_id} actual={trigger_top_task_id or '-'}",
            "data": data,
        }
    age_detail = f" · age={age_seconds:.0f}s" if age_seconds is not None else ""
    return {"ok": True, "detail": f"watchdog task evidence ok · top={top_task_id}{age_detail}", "data": data}


def collect_health() -> dict[str, Any]:
    health = Health()
    watchdog_state = load_watchdog_state()

    for name in ("backend", "frontend", "ai4trade"):
        port = int(SERVICES[name]["port"])
        health.add(f"{name}_port", port_open("127.0.0.1", port), f"127.0.0.1:{port}")

    ok, data_status, error = http_request("http://127.0.0.1:8765/api/data/status", timeout=8)
    health.add("data_status_http", ok, error or "HTTP ok")
    if ok and isinstance(data_status, dict):
        rows = data_status.get("rows") if isinstance(data_status.get("rows"), list) else []
        stale_rows = [row for row in rows if isinstance(row, dict) and row.get("is_stale")]
        recommended_rows = [row for row in rows if isinstance(row, dict) and row.get("recommended_refresh")]
        high_cost_rows = [
            row
            for row in stale_rows
            if row.get("high_refresh_cost") and not row.get("covered_by_fresh_cache")
        ]
        strategy_symbols = {"BTC-USDT-SWAP", "ETH-USDT-SWAP", "SOL-USDT-SWAP"}
        strategy_bars = {"15m", "1H"}
        strategy_core_rows = [
            row
            for row in rows
            if isinstance(row, dict)
            and row.get("inst_id") in strategy_symbols
            and row.get("bar") in strategy_bars
            and not row.get("covered_by_fresh_cache")
        ]
        strategy_stale = [row for row in strategy_core_rows if row.get("is_stale")]
        strategy_recommended = [row for row in strategy_core_rows if row.get("recommended_refresh")]
        top_recommended = recommended_rows[0] if recommended_rows and isinstance(recommended_rows[0], dict) else {}
        data_detail = (
            f"{len(rows)} caches · {len(stale_rows)} stale · {len(recommended_rows)} recommended"
            + (f" · {len(high_cost_rows)} manual-long" if high_cost_rows else "")
            + (
                f" · top={top_recommended.get('inst_id')} {top_recommended.get('bar')} {top_recommended.get('count') or top_recommended.get('candles')}"
                if top_recommended
                else ""
            )
        )
        health.add(
            "data_cache_recommended_refresh",
            len(recommended_rows) == 0,
            data_detail,
            severity="warning",
            data={
                "total": len(rows),
                "stale": len(stale_rows),
                "recommended": len(recommended_rows),
                "high_cost_stale": len(high_cost_rows),
                "top_recommended": {
                    "inst_id": top_recommended.get("inst_id"),
                    "bar": top_recommended.get("bar"),
                    "count": top_recommended.get("count") or top_recommended.get("candles"),
                    "refresh_cost_label": top_recommended.get("refresh_cost_label"),
                }
                if top_recommended
                else {},
            },
        )
        top_high_cost = high_cost_rows[0] if high_cost_rows and isinstance(high_cost_rows[0], dict) else {}
        health.add(
            "data_cache_high_cost_manual_refresh",
            True,
            (
                f"{len(high_cost_rows)} high-cost stale rows require explicit single-row refresh"
                if high_cost_rows
                else "no high-cost stale rows pending"
            ),
            severity="warning",
            data={
                "high_cost_stale": len(high_cost_rows),
                "max_auto_refresh_estimated_requests": data_status.get("summary", {}).get("max_auto_refresh_estimated_requests")
                if isinstance(data_status.get("summary"), dict)
                else None,
                "top_high_cost": {
                    "inst_id": top_high_cost.get("inst_id"),
                    "bar": top_high_cost.get("bar"),
                    "count": top_high_cost.get("count") or top_high_cost.get("candles"),
                    "refresh_cost_label": top_high_cost.get("refresh_cost_label"),
                }
                if top_high_cost
                else {},
            },
        )
        strategy_detail = f"{len(strategy_core_rows)} core rows · {len(strategy_stale)} stale · {len(strategy_recommended)} recommended"
        health.add(
            "data_cache_strategy_core",
            len(strategy_recommended) == 0,
            strategy_detail,
            severity="warning",
            data={
                "core_rows": len(strategy_core_rows),
                "stale": len(strategy_stale),
                "recommended": len(strategy_recommended),
            },
        )
        refresh_summary = watchdog_state.get("market_refresh_last_summary") if isinstance(watchdog_state.get("market_refresh_last_summary"), dict) else {}
        refresh_error = str(watchdog_state.get("market_refresh_error") or "")
        last_run = float(watchdog_state.get("market_refresh_last_run", 0) or 0)
        refresh_age = max(0.0, time.time() - last_run) if last_run else None
        refresh_fresh = refresh_age is not None and refresh_age <= MARKET_REFRESH_WATCHDOG_INTERVAL_SECONDS * 2 + 300
        if len(recommended_rows) == 0:
            refresh_ok = True
            refresh_detail = "no recommended public cache refresh pending"
        elif refresh_summary:
            refresh_ok = bool(refresh_summary.get("ok")) and refresh_fresh and not refresh_error
            age_label = f"{refresh_age:.0f}s ago" if refresh_age is not None else "unknown age"
            refresh_detail = (
                f"last watchdog refresh {age_label} · "
                f"recommended {refresh_summary.get('recommended_before')}->{refresh_summary.get('recommended_after')} · "
                f"task={refresh_summary.get('task_id') or '-'}"
            )
            if refresh_error:
                refresh_detail += f" · error={refresh_error}"
        else:
            refresh_ok = False
            refresh_detail = f"no watchdog market refresh evidence yet · recommended={len(recommended_rows)}"
        health.add(
            "watchdog_market_refresh",
            refresh_ok,
            refresh_detail,
            severity="warning",
            data={
                "recommended": len(recommended_rows),
                "last_run_age_seconds": refresh_age,
                "last_summary": refresh_summary,
                "error": refresh_error,
                "interval_seconds": MARKET_REFRESH_WATCHDOG_INTERVAL_SECONDS,
            },
        )
    backtest_evidence = recent_backtest_evidence_status()
    health.add(
        "recent_backtest_evidence",
        bool(backtest_evidence.get("ok")),
        str(backtest_evidence.get("detail") or "recent backtest evidence unavailable"),
        severity="warning",
        data={key: value for key, value in backtest_evidence.items() if key not in {"ok", "detail"}},
    )

    ok, paper, error = http_request("http://127.0.0.1:8765/api/paper/status", timeout=5)
    health.add("paper_status_http", ok, error or "HTTP ok")
    if ok and isinstance(paper, dict):
        running = bool(paper.get("running"))
        health.add("paper_loop_running", running, "paper.running=true" if running else "paper.running=false")
        updated_ts = parse_time(paper.get("updated_at"))
        if updated_ts:
            age = max(0, time.time() - updated_ts)
            health.add("paper_loop_fresh", age <= 180, f"updated {age:.0f}s ago", severity="warning")
        if paper.get("last_error"):
            health.add("paper_last_error", False, str(paper.get("last_error")))

    ok, config, error = http_request("http://127.0.0.1:8765/api/execution/config", timeout=5)
    health.add("execution_config_http", ok, error or "HTTP ok")
    if ok and isinstance(config, dict):
        connector = config.get("connector_status") or {}
        health.add("dry_run_only", bool(connector.get("dry_run_only")), f"dry_run_only={connector.get('dry_run_only')}")
        health.add("live_submit_locked", not bool(connector.get("can_submit_live") or config.get("live_submit_available")), f"can_submit_live={connector.get('can_submit_live')}")
        for key in ("live_trading_enabled", "live_order_enabled", "live_cancel_enabled"):
            health.add(key, not bool(config.get(key)), f"{key}={config.get(key)}")
        health.add("okx_credentials", bool(config.get("okx_configured")), "OKX credentials present" if config.get("okx_configured") else "missing_credentials", severity="warning")
        keychain = config.get("okx_keychain") or {}
        keychain_keys = keychain.get("keys") or {}
        keychain_detail = "Keychain credentials present" if keychain.get("configured") else "keychain_missing"
        if keychain_keys:
            keychain_detail = f"{keychain_detail} · " + " · ".join(f"{key.replace('OKX_', '')}:{'有' if ok else '无'}" for key, ok in keychain_keys.items())
        health.add("okx_keychain", bool(keychain.get("configured")), keychain_detail, severity="warning")

    ok, equity_history, error = http_request("http://127.0.0.1:8765/api/paper/equity-history?limit=4", timeout=8)
    health.add("account_equity_history_http", ok, error or "HTTP ok")
    if ok and isinstance(equity_history, dict):
        equity_count, equity_latest, equity_age = history_latest(equity_history)
        source = equity_history.get("source") or "-"
        source_label = equity_history.get("source_label") or source
        expected_source = "okx_readonly" if isinstance(config, dict) and config.get("okx_configured") else "paper_loop"
        detail = (
            f"{equity_count} rows · latest {equity_age:.0f}s ago · source={source_label}"
            if equity_age is not None
            else f"{equity_count} rows · source={source_label}"
        )
        health.add("account_equity_history", equity_count > 0, detail, severity="warning")
        health.add(
            "account_equity_source",
            source == expected_source,
            f"source={source} expected={expected_source} equity={equity_latest.get('equity')}",
            severity="warning",
        )
        anchor_date = str(equity_history.get("anchor_date") or "")
        interval_seconds = int(equity_history.get("interval_seconds") or 0)
        health.add("account_equity_anchor_fixed", anchor_date == "2026-06-06", f"anchor_date={anchor_date or '-'}")
        health.add("account_equity_interval_15m", interval_seconds == 900, f"interval_seconds={interval_seconds}")
        anchor_ts = parse_time(f"{anchor_date}T00:00:00+00:00") if anchor_date else None
        latest_ts = parse_time(equity_latest.get("slot") or equity_latest.get("time")) if equity_latest else None
        if anchor_ts is not None and latest_ts is not None:
            health.add("account_equity_after_anchor", latest_ts >= anchor_ts, f"latest_slot={equity_latest.get('slot') or equity_latest.get('time')}")
        if equity_age is not None:
            health.add("account_equity_fresh", equity_age <= 1800, f"updated {equity_age:.0f}s ago", severity="warning")

    ok, automation, error = http_request("http://127.0.0.1:8765/api/automation/status", timeout=8)
    health.add("automation_status_http", ok, error or "HTTP ok")
    if ok and isinstance(automation, dict):
        policy = automation.get("policy") or {}
        health.add("automation_live_lock", bool(policy.get("dry_run_only") and not policy.get("can_submit_live")), f"can_submit_live={policy.get('can_submit_live')}")
        signal_ready = bool(automation.get("signal_ready"))
        preflight_current = bool(automation.get("preflight_current"))
        running = automation.get("state") == "preflight_running"
        detail = automation.get("next_action") or automation.get("state") or "-"
        health.add("automation_preflight_current", (not signal_ready) or preflight_current or running, detail, severity="warning")
        heartbeat_age = automation.get("heartbeat_age_seconds")
        if heartbeat_age is None:
            health.add("automation_heartbeat_fresh", False, "no heartbeat yet", severity="warning")
        else:
            health.add("automation_heartbeat_fresh", float(heartbeat_age) <= 180, f"updated {float(heartbeat_age):.0f}s ago", severity="warning")
        readiness = automation.get("readiness") or {}
        stage = readiness.get("stage") or "unknown"
        label = readiness.get("label") or stage
        next_action = readiness.get("next_action") or automation.get("next_action") or "-"
        health.add(
            "automation_stage",
            True,
            f"{label} ({stage}) · {next_action}",
            severity="warning",
            data={"stage": stage, "label": label, "next_action": next_action},
        )
        heartbeat_history_count, heartbeat_latest, heartbeat_history_age = history_latest(automation.get("heartbeat_history"))
        heartbeat_detail = (
            f"{heartbeat_history_count} rows · latest {heartbeat_history_age:.0f}s ago · state={heartbeat_latest.get('state')}"
            if heartbeat_history_age is not None
            else f"{heartbeat_history_count} rows"
        )
        health.add("automation_heartbeat_history", heartbeat_history_count > 0, heartbeat_detail, severity="warning")
        if heartbeat_latest:
            history_locked = bool(heartbeat_latest.get("dry_run_only") and not heartbeat_latest.get("can_submit_live"))
            health.add("automation_history_live_lock", history_locked, f"can_submit_live={heartbeat_latest.get('can_submit_live')}")
        preflight_history_count, preflight_latest, _preflight_age = history_latest(automation.get("preflight_history"))
        preflight_detail = f"{preflight_history_count} rows · latest_state={preflight_latest.get('state') or '-'}"
        health.add("automation_preflight_history", preflight_history_count > 0, preflight_detail, severity="warning")
        event_history_count, event_latest, event_history_age = history_latest(automation.get("event_history"))
        event_detail = (
            f"{event_history_count} rows · latest {event_history_age:.0f}s ago · stage={event_latest.get('stage')}"
            if event_history_age is not None
            else f"{event_history_count} rows"
        )
        health.add("automation_event_history", event_history_count > 0, event_detail, severity="warning")
        if event_latest:
            event_locked = bool(event_latest.get("dry_run_only") and not event_latest.get("can_submit_live"))
            health.add("automation_event_live_lock", event_locked, f"can_submit_live={event_latest.get('can_submit_live')}")
        task_board = automation.get("task_board") if isinstance(automation.get("task_board"), dict) else {}
        top_task = task_board.get("top_task") if isinstance(task_board.get("top_task"), dict) else {}
        task_count = int(task_board.get("count") or len(task_board.get("tasks") or []))
        health.add(
            "automation_task_board",
            task_count > 0,
            f"{task_count} tasks · top={top_task.get('id') or '-'} · {top_task.get('title') or '-'}",
            severity="warning",
            data={
                "top_task_id": top_task.get("id"),
                "top_task_title": top_task.get("title"),
                "top_task_status": top_task.get("status"),
                "top_task_action": top_task.get("action"),
                "top_task_command": top_task.get("command"),
                "task_count": task_count,
            },
        )
        task_evidence = automation_task_board_evidence_status(watchdog_state, top_task.get("id"))
        health.add(
            "automation_task_board_evidence",
            bool(task_evidence.get("ok")),
            str(task_evidence.get("detail") or "watchdog task evidence unavailable"),
            severity="warning",
            data=task_evidence.get("data") if isinstance(task_evidence.get("data"), dict) else {},
        )
        critical_count = int(task_board.get("critical_count") or 0)
        health.add("automation_task_safety", critical_count == 0, f"critical_count={critical_count}")

    readiness_history = read_readiness_snapshots(limit=1)
    readiness_latest = readiness_history.get("latest") if isinstance(readiness_history.get("latest"), dict) else {}
    readiness_latest_ts = parse_time(readiness_latest.get("time")) if readiness_latest else None
    readiness_age = max(0, time.time() - readiness_latest_ts) if readiness_latest_ts else None
    readiness_detail = (
        f"{readiness_history.get('count', 0)} rows · latest {readiness_age:.0f}s ago · status={readiness_latest.get('status')}"
        if readiness_age is not None
        else f"{readiness_history.get('count', 0)} rows"
    )
    health.add("readiness_snapshot_history", bool(readiness_latest), readiness_detail, severity="warning")
    if readiness_age is not None:
        health.add("readiness_snapshot_fresh", readiness_age <= HISTORY_FRESH_SECONDS, f"updated {readiness_age:.0f}s ago", severity="warning")
    if readiness_latest:
        locks = readiness_latest.get("locks") if isinstance(readiness_latest.get("locks"), dict) else {}
        health.add(
            "readiness_snapshot_live_lock",
            bool(locks.get("dry_run_only") and not locks.get("can_submit_live")),
            f"can_submit_live={locks.get('can_submit_live')}",
        )

    ok, diagnostics, error = http_request("http://127.0.0.1:8765/api/okx/diagnostics", timeout=12)
    if ok and isinstance(diagnostics, dict):
        readonly_ok = bool(diagnostics.get("readonly_ok"))
        category = diagnostics.get("category") or "unknown"
        health.add("okx_readonly", readonly_ok, "readonly_ok" if readonly_ok else category, severity="warning")
        okx_history_count, okx_latest, okx_history_age = history_latest(diagnostics.get("history"))
        okx_detail = (
            f"{okx_history_count} rows · latest {okx_history_age:.0f}s ago · category={okx_latest.get('category')}"
            if okx_history_age is not None
            else f"{okx_history_count} rows"
        )
        health.add("okx_diagnostics_history", okx_history_count > 0, okx_detail, severity="warning")
        okx_connector = okx_latest.get("connector") if isinstance(okx_latest.get("connector"), dict) else {}
        if okx_connector:
            health.add("okx_history_live_lock", not bool(okx_connector.get("can_submit_live")), f"can_submit_live={okx_connector.get('can_submit_live')}")
    else:
        health.add("okx_readonly", False, error or "diagnostics unavailable", severity="warning")

    ok, frontend, error = http_request("http://127.0.0.1:5173/", timeout=5)
    frontend_ok = bool(ok and isinstance(frontend, str) and "Quant Studio" in frontend)
    health.add("frontend_homepage", frontend_ok, "Quant Studio served" if frontend_ok else error or "unexpected homepage")

    ai4trade_payload: dict[str, Any] = {}
    ai_latest: dict[str, Any] = {}
    ai_history_count = 0
    ok, ai4trade, error = http_request(str(SERVICES["ai4trade"]["url"]), timeout=5)
    health.add("ai4trade_status_http", ok, error or "HTTP ok")
    if ok and isinstance(ai4trade, dict):
        ai4trade_payload = ai4trade
        health.add("ai4trade_readonly_policy", bool((ai4trade.get("policy") or {}).get("trade_endpoints_locked")), "trade endpoints locked")
        health.add("ai4trade_configured", bool(ai4trade.get("configured")), "configured" if ai4trade.get("configured") else "missing token", severity="warning")
        ai_history_count, ai_latest, ai_history_age = history_latest(ai4trade.get("history"))
        if bool(ai4trade.get("configured")) and (ai_history_age is None or ai_history_age > HISTORY_FRESH_SECONDS):
            refresh_ok, refreshed, refresh_error = http_request("http://127.0.0.1:8766/api/ai4trade/status?signals_limit=12&news_limit=4", timeout=15)
            refresh_locked = bool(isinstance(refreshed, dict) and (refreshed.get("policy") or {}).get("trade_endpoints_locked"))
            health.add(
                "ai4trade_history_refresh",
                bool(refresh_ok and refresh_locked),
                "refreshed read-only status" if refresh_ok else refresh_error or "refresh unavailable",
                severity="warning",
            )
            if refresh_ok and isinstance(refreshed, dict):
                ai4trade = refreshed
                ai4trade_payload = refreshed
                ai_history_count, ai_latest, ai_history_age = history_latest(ai4trade.get("history"))
        ai_detail = (
            f"{ai_history_count} rows · latest {ai_history_age:.0f}s ago · signals={((ai_latest.get('signals') or {}).get('summary') or {}).get('count')}"
            if ai_history_age is not None
            else f"{ai_history_count} rows"
        )
        health.add("ai4trade_history", ai_history_count > 0, ai_detail, severity="warning")
        if ai_history_age is not None:
            health.add("ai4trade_history_fresh", ai_history_age <= HISTORY_FRESH_SECONDS, f"updated {ai_history_age:.0f}s ago", severity="warning")
        ai_policy = ai_latest.get("policy") if isinstance(ai_latest.get("policy"), dict) else {}
        if ai_policy:
            health.add("ai4trade_history_readonly_policy", bool(ai_policy.get("trade_endpoints_locked")), "trade endpoints locked")
    alignment_ok, alignment_detail, alignment_data = ai4trade_signal_alignment(
        ai4trade_payload,
        ai_latest,
        ai_history_count,
        automation if isinstance(automation, dict) else {},
        config if isinstance(config, dict) else {},
    )
    health.add("ai4trade_signal_alignment", alignment_ok, alignment_detail, severity="warning", data=alignment_data)

    has_live_submit, row = execution_ledger_has_live_submit()
    health.add("no_real_submitted_orders", not has_live_submit, "no submitted exchange order" if not row else json.dumps(row, ensure_ascii=False))
    shadow_status = execution_ledger_shadow_status()
    health.add(
        "execution_shadow_order",
        bool(shadow_status.get("present")),
        shadow_status.get("detail") or "shadow order evidence unavailable",
        severity="warning",
        data=shadow_status.get("latest") if isinstance(shadow_status.get("latest"), dict) else {},
    )
    if shadow_status.get("present"):
        latest = shadow_status.get("latest") if isinstance(shadow_status.get("latest"), dict) else {}
        latest_ts = parse_time(latest.get("time")) if latest else None
        latest_age = max(0, time.time() - latest_ts) if latest_ts else None
        if latest_age is not None:
            health.add(
                "execution_shadow_recent",
                latest_age <= EXECUTION_SHADOW_RECENT_SECONDS,
                f"updated {latest_age:.0f}s ago · event={latest.get('event') or '-'}",
                severity="warning",
            )
        else:
            health.add("execution_shadow_recent", False, "latest shadow evidence has no timestamp", severity="warning")
        health.add(
            "execution_shadow_live_lock",
            bool(shadow_status.get("locked")),
            shadow_status.get("detail") or "shadow live lock unavailable",
        )
        health.add(
            "execution_shadow_payload_hash",
            bool(shadow_status.get("payload_hash_ok")),
            shadow_status.get("detail") or "payload hash unavailable",
            severity="warning",
        )
    return health.payload()


def print_doctor(args: argparse.Namespace) -> None:
    payload = collect_health()
    if args.json:
        print(json.dumps(payload, ensure_ascii=False, indent=2))
    else:
        print(f"doctor status: {payload['status']} ({payload['updated_at']})")
        for row in payload["checks"]:
            marker = "OK" if row["ok"] else "WARN" if row["severity"] == "warning" else "FAIL"
            print(f"{marker:4} {row['name']}: {row['detail']}")
        if payload["critical"]:
            print("\ncritical:")
            for item in payload["critical"]:
                print(f"- {item}")
        if payload["warnings"]:
            print("\nwarnings:")
            for item in payload["warnings"]:
                print(f"- {item}")
    if payload["critical"]:
        raise SystemExit(1)


def print_stage(args: argparse.Namespace) -> None:
    ok, automation, error = http_request("http://127.0.0.1:8765/api/automation/status", timeout=8)
    if not ok or not isinstance(automation, dict):
        raise SystemExit(error or "automation status unavailable")
    config_ok, config, config_error = http_request("http://127.0.0.1:8765/api/execution/config", timeout=5)
    if not config_ok or not isinstance(config, dict):
        config = {"error": config_error or "execution config unavailable"}
    readiness = automation.get("readiness") or {}
    keychain = config.get("okx_keychain") or {}
    connector = config.get("connector_status") or automation.get("policy") or {}
    heartbeat_age = automation.get("heartbeat_age_seconds")
    payload = {
        "stage": readiness.get("stage"),
        "label": readiness.get("label"),
        "next_action": readiness.get("next_action"),
        "blockers": readiness.get("blockers") or [],
        "automation_state": automation.get("state"),
        "heartbeat_fresh": automation.get("heartbeat_fresh"),
        "heartbeat_age_seconds": heartbeat_age,
        "heartbeat_count": automation.get("heartbeat_count"),
        "keychain": keychain,
        "dry_run_only": connector.get("dry_run_only"),
        "can_submit_live": connector.get("can_submit_live"),
        "okx_configured": config.get("okx_configured"),
    }
    if args.json:
        print(json.dumps(payload, ensure_ascii=False, indent=2))
        return
    print(f"automation stage: {payload['label'] or '-'} ({payload['stage'] or '-'})")
    print(f"next action: {payload['next_action'] or '-'}")
    if payload["blockers"]:
        print("blockers:")
        for item in payload["blockers"]:
            print(f"- {item}")
    keychain_keys = keychain.get("keys") or {}
    keychain_detail = " · ".join(f"{key.replace('OKX_', '')}:{'有' if value else '无'}" for key, value in keychain_keys.items()) or "-"
    print(f"keychain: {'configured' if keychain.get('configured') else 'missing'} · {keychain.get('service') or '-'} · {keychain_detail}")
    age_text = "-" if heartbeat_age is None else f"{float(heartbeat_age):.0f}s"
    print(f"heartbeat: fresh={payload['heartbeat_fresh']} age={age_text} count={payload['heartbeat_count']}")
    print(f"locks: dry_run_only={payload['dry_run_only']} can_submit_live={payload['can_submit_live']}")


def automation_task_board_payload() -> dict[str, Any]:
    ok, payload, error = http_request("http://127.0.0.1:8765/api/automation/task-board", timeout=8)
    if not ok or not isinstance(payload, dict):
        raise RuntimeError(error or "automation task board unavailable")
    return sanitize_for_log(payload)


def print_tasks(args: argparse.Namespace) -> None:
    try:
        payload = automation_task_board_payload()
    except RuntimeError as exc:
        raise SystemExit(str(exc)) from exc
    written_path = write_evidence_payload(payload, "automation-task-board") if getattr(args, "write", False) else None
    if written_path:
        payload["written_path"] = str(written_path)
    if args.json:
        print(json.dumps(payload, ensure_ascii=False, indent=2))
        return
    tasks = payload.get("tasks") if isinstance(payload.get("tasks"), list) else []
    top = payload.get("top_task") if isinstance(payload.get("top_task"), dict) else (tasks[0] if tasks and isinstance(tasks[0], dict) else {})
    print(f"automation tasks: {payload.get('count', len(tasks))} · stage={payload.get('stage') or '-'} · state={payload.get('state') or '-'}")
    if top:
        print(f"top task: {top.get('id') or '-'} · {top.get('title') or '-'} · {top.get('status') or '-'}")
    print(f"safety: critical={payload.get('critical_count', 0)} blocked={payload.get('blocked_count', 0)}")
    for row in tasks:
        if not isinstance(row, dict):
            continue
        command = f" · {row.get('command')}" if row.get("command") else ""
        print(f"- {row.get('status') or '-'} · {row.get('title') or row.get('id') or '-'}: {row.get('detail') or '-'}{command}")
    if written_path:
        print(f"wrote automation task evidence: {written_path}")


def health_check(payload: dict[str, Any], name: str) -> dict[str, Any]:
    for row in payload.get("checks") or []:
        if isinstance(row, dict) and row.get("name") == name:
            return row
    return {"name": name, "ok": False, "detail": "missing check", "data": {}}


def shadow_lock_ok(shadow: dict[str, Any] | None) -> bool:
    if not isinstance(shadow, dict) or not shadow:
        return False
    return bool(
        shadow.get("present", True)
        and shadow.get("would_submit") is False
        and shadow.get("dry_run_only") is True
        and shadow.get("can_submit_live") is False
        and not bool(shadow.get("submitted"))
    )


def readiness_payload(health_payload: dict[str, Any] | None = None) -> dict[str, Any]:
    health = health_payload if isinstance(health_payload, dict) else collect_health()
    ok, automation, automation_error = http_request("http://127.0.0.1:8765/api/automation/status", timeout=8)
    if not ok or not isinstance(automation, dict):
        automation = {"error": automation_error or "automation status unavailable"}
    config_ok, config, config_error = http_request("http://127.0.0.1:8765/api/execution/config", timeout=5)
    if not config_ok or not isinstance(config, dict):
        config = {"error": config_error or "execution config unavailable"}
    readiness = automation.get("readiness") if isinstance(automation.get("readiness"), dict) else {}
    task_board = automation.get("task_board") if isinstance(automation.get("task_board"), dict) else {}
    top_task = task_board.get("top_task") if isinstance(task_board.get("top_task"), dict) else {}
    latest_preflight = automation.get("preflight_history", {}).get("latest") if isinstance(automation.get("preflight_history"), dict) else {}
    latest_event = automation.get("event_history", {}).get("latest") if isinstance(automation.get("event_history"), dict) else {}
    preflight_shadow = (latest_preflight.get("summary") or {}).get("shadow_order") if isinstance(latest_preflight, dict) else {}
    event_shadow = (latest_event.get("preflight") or {}).get("shadow_order") if isinstance(latest_event, dict) else {}
    shadow = preflight_shadow if isinstance(preflight_shadow, dict) and preflight_shadow else event_shadow if isinstance(event_shadow, dict) else {}
    connector = config.get("connector_status") if isinstance(config.get("connector_status"), dict) else {}
    keychain = config.get("okx_keychain") if isinstance(config.get("okx_keychain"), dict) else {}
    live_submit_locked = bool(connector.get("dry_run_only") and not connector.get("can_submit_live"))
    live_env_locked = not any(bool(config.get(key)) for key in ("live_trading_enabled", "live_order_enabled", "live_cancel_enabled"))
    readonly_ok = bool(health_check(health, "okx_readonly").get("ok"))
    keychain_ok = bool(keychain.get("configured") or config.get("okx_configured"))
    shadow_ok = shadow_lock_ok(shadow)
    no_submitted = bool(health_check(health, "no_real_submitted_orders").get("ok"))
    heartbeat_fresh = bool(automation.get("heartbeat_fresh"))
    stage = readiness.get("stage")
    blockers = list(readiness.get("blockers") or [])
    if not keychain_ok:
        status = "missing_credentials"
        next_action = top_task.get("command") or "python3 scripts/manage_24x7.py import-secrets --restart"
    elif not readonly_ok:
        status = "readonly_failed"
        next_action = "运行 OKX 只读诊断并检查权限/IP/签名。"
    elif not (live_submit_locked and live_env_locked):
        status = "live_lock_unsafe"
        next_action = "恢复 LIVE_TRADING_ENABLED=0 / OKX_LIVE_ORDER_ENABLED=0 / OKX_LIVE_CANCEL_ENABLED=0。"
    elif not shadow_ok:
        status = "shadow_evidence_missing"
        next_action = "运行 /api/automation/preflight 生成 shadow_order 锁定证据。"
    elif stage == "manual_canary_review":
        status = "canary_review_ready"
        next_action = "人工复核 Canary payload、账户权益、真实持仓和执行账本。"
    elif stage == "waiting_signal":
        status = "waiting_ready_signal"
        next_action = readiness.get("next_action") or "等待下一条 ready 信号。"
    else:
        status = stage or "review_required"
        next_action = readiness.get("next_action") or top_task.get("action") or "-"
    readonly_ready = bool(keychain_ok and readonly_ok and live_submit_locked and live_env_locked)
    canary_review_ready = bool(readonly_ready and shadow_ok and no_submitted and heartbeat_fresh and stage == "manual_canary_review")
    return {
        "ok": bool(health.get("ok") and live_submit_locked and live_env_locked and no_submitted),
        "status": status,
        "readonly_ready": readonly_ready,
        "canary_review_ready": canary_review_ready,
        "stage": stage,
        "label": readiness.get("label"),
        "next_action": next_action,
        "blockers": blockers,
        "top_task": top_task,
        "locks": {
            "dry_run_only": connector.get("dry_run_only"),
            "can_submit_live": connector.get("can_submit_live"),
            "live_trading_enabled": config.get("live_trading_enabled"),
            "live_order_enabled": config.get("live_order_enabled"),
            "live_cancel_enabled": config.get("live_cancel_enabled"),
        },
        "checks": {
            "keychain_ok": keychain_ok,
            "okx_readonly_ok": readonly_ok,
            "heartbeat_fresh": heartbeat_fresh,
            "shadow_order_locked": shadow_ok,
            "no_real_submitted_orders": no_submitted,
            "live_submit_locked": live_submit_locked,
            "live_env_locked": live_env_locked,
        },
        "latest_shadow_order": shadow,
        "health_status": health.get("status"),
        "warnings": health.get("warnings") or [],
        "critical": health.get("critical") or [],
        "updated_at": now_iso(),
    }


def readiness_snapshot_entry(payload: dict[str, Any], *, source: str = "manual") -> dict[str, Any]:
    top_task = payload.get("top_task") if isinstance(payload.get("top_task"), dict) else {}
    snapshot = {
        "time": now_iso(),
        "source": source,
        "status": payload.get("status"),
        "stage": payload.get("stage"),
        "label": payload.get("label"),
        "readonly_ready": bool(payload.get("readonly_ready")),
        "canary_review_ready": bool(payload.get("canary_review_ready")),
        "next_action": payload.get("next_action"),
        "blockers": payload.get("blockers") or [],
        "locks": payload.get("locks") if isinstance(payload.get("locks"), dict) else {},
        "checks": payload.get("checks") if isinstance(payload.get("checks"), dict) else {},
        "latest_shadow_order": payload.get("latest_shadow_order") if isinstance(payload.get("latest_shadow_order"), dict) else {},
        "top_task": {
            "id": top_task.get("id"),
            "title": top_task.get("title"),
            "status": top_task.get("status"),
            "command": top_task.get("command"),
            "dry_run_only": top_task.get("dry_run_only"),
            "can_submit_live": top_task.get("can_submit_live"),
        },
        "health_status": payload.get("health_status"),
        "warning_count": len(payload.get("warnings") or []),
        "critical_count": len(payload.get("critical") or []),
        "payload_updated_at": payload.get("updated_at"),
    }
    return sanitize_for_log(snapshot)


def append_readiness_snapshot(payload: dict[str, Any] | None = None, *, source: str = "manual") -> dict[str, Any]:
    ensure_dirs()
    source_payload = payload if isinstance(payload, dict) else readiness_payload()
    entry = readiness_snapshot_entry(source_payload, source=source)
    with READINESS_SNAPSHOT_FILE.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(entry, ensure_ascii=False, sort_keys=True) + "\n")
    return entry


def read_readiness_snapshots(limit: int = 20) -> dict[str, Any]:
    if not READINESS_SNAPSHOT_FILE.exists():
        return {"count": 0, "latest": None, "rows": [], "path": str(READINESS_SNAPSHOT_FILE)}
    rows: list[dict[str, Any]] = []
    try:
        lines = READINESS_SNAPSHOT_FILE.read_text(encoding="utf-8").splitlines()
    except OSError:
        return {"count": 0, "latest": None, "rows": [], "path": str(READINESS_SNAPSHOT_FILE)}
    for line in lines[-max(1, min(limit, 500)) :]:
        try:
            row = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(row, dict):
            rows.append(sanitize_for_log(row))
    rows = list(reversed(rows))
    return {
        "count": len(lines),
        "latest": rows[0] if rows else None,
        "rows": rows,
        "path": str(READINESS_SNAPSHOT_FILE),
    }


def readiness_snapshot_identity(entry: dict[str, Any]) -> str:
    locks = entry.get("locks") if isinstance(entry.get("locks"), dict) else {}
    checks = entry.get("checks") if isinstance(entry.get("checks"), dict) else {}
    top_task = entry.get("top_task") if isinstance(entry.get("top_task"), dict) else {}
    payload = {
        "status": entry.get("status"),
        "stage": entry.get("stage"),
        "readonly_ready": bool(entry.get("readonly_ready")),
        "canary_review_ready": bool(entry.get("canary_review_ready")),
        "dry_run_only": locks.get("dry_run_only"),
        "can_submit_live": locks.get("can_submit_live"),
        "live_trading_enabled": locks.get("live_trading_enabled"),
        "live_order_enabled": locks.get("live_order_enabled"),
        "live_cancel_enabled": locks.get("live_cancel_enabled"),
        "keychain_ok": checks.get("keychain_ok"),
        "okx_readonly_ok": checks.get("okx_readonly_ok"),
        "shadow_order_locked": checks.get("shadow_order_locked"),
        "no_real_submitted_orders": checks.get("no_real_submitted_orders"),
        "top_task_id": top_task.get("id"),
        "top_task_status": top_task.get("status"),
    }
    return json.dumps(payload, ensure_ascii=False, sort_keys=True)


def maybe_record_watchdog_readiness_snapshot(state: dict[str, Any], *, now: float | None = None, health_payload: dict[str, Any] | None = None) -> dict[str, Any] | None:
    now = time.time() if now is None else now
    payload = readiness_payload(health_payload)
    entry = readiness_snapshot_entry(payload, source="watchdog")
    identity = readiness_snapshot_identity(entry)
    last_identity = state.get("readiness_snapshot_identity")
    last_recorded = float(state.get("readiness_snapshot_recorded_at", 0) or 0)
    should_record = identity != last_identity or now - last_recorded >= READINESS_SNAPSHOT_WATCHDOG_INTERVAL_SECONDS
    if not should_record:
        return None
    recorded = append_readiness_snapshot(payload, source="watchdog")
    state["readiness_snapshot_identity"] = identity
    state["readiness_snapshot_recorded_at"] = now
    state["readiness_snapshot_status"] = recorded.get("status")
    state["readiness_snapshot_updated_at"] = recorded.get("time")
    return recorded


def maybe_run_watchdog_live_lock_test(state: dict[str, Any], health_payload: dict[str, Any], *, now: float | None = None) -> dict[str, Any] | None:
    now = time.time() if now is None else now
    recent_row = health_check(health_payload, "execution_shadow_recent")
    has_recent_shadow = bool(recent_row.get("ok"))
    last_attempt = float(state.get("live_lock_test_attempted_at", 0) or 0)
    if has_recent_shadow:
        return None
    if now - last_attempt < 15 * 60:
        return None
    payload = {
        "confirmation": "",
        "use_canary": False,
        "source": "watchdog_live_lock_test",
    }
    summary = live_lock_test_request(payload)
    state["live_lock_test_attempted_at"] = now
    state["live_lock_test_updated_at"] = now_iso()
    state["live_lock_test_ok"] = bool(summary.get("ok"))
    state["live_lock_test_submitted"] = bool(summary.get("submitted"))
    state["live_lock_test_decision"] = summary.get("decision")
    state["live_lock_test_error"] = summary.get("error") or ""
    if summary.get("ok"):
        snapshot = record_live_lock_readiness_snapshot("watchdog_live_lock_test")
        state["live_lock_test_readiness_snapshot_at"] = snapshot.get("time")
        state["live_lock_test_readiness_snapshot_status"] = snapshot.get("status")
    if not summary.get("ok"):
        notify("OKX Quant Live Lock", f"live-lock-test failed: submitted={summary.get('submitted')} can_submit_live={summary.get('can_submit_live')}")
    return summary


def maybe_run_watchdog_market_refresh(state: dict[str, Any], health_payload: dict[str, Any], *, now: float | None = None) -> dict[str, Any] | None:
    now = time.time() if now is None else now
    last_run = float(state.get("market_refresh_last_run", 0) or 0)
    if now - last_run < MARKET_REFRESH_WATCHDOG_INTERVAL_SECONDS:
        return None
    if health_payload.get("critical"):
        return None

    data_row = health_check(health_payload, "data_cache_recommended_refresh")
    data = data_row.get("data") if isinstance(data_row.get("data"), dict) else {}
    recommended = int(data.get("recommended") or 0)
    if data_row.get("ok") or recommended <= 0:
        return None

    live_submit_locked = bool(health_check(health_payload, "live_submit_locked").get("ok"))
    live_env_locked = all(
        bool(health_check(health_payload, name).get("ok"))
        for name in ("dry_run_only", "live_trading_enabled", "live_order_enabled", "live_cancel_enabled")
    )
    if not live_submit_locked or not live_env_locked:
        state["market_refresh_last_skip"] = "live_lock_not_healthy"
        state["market_refresh_last_skip_at"] = now_iso()
        return None

    payload = market_data_refresh_payload(max_items=1, recommended_only=True, timeout_seconds=90, poll_seconds=2)
    written_path = write_evidence_payload(payload, "market-data-refresh-watchdog")
    after = ((payload.get("cache_after") or {}).get("status") or {}).get("summary") if isinstance((payload.get("cache_after") or {}).get("status"), dict) else {}
    summary = {
        "ok": bool(payload.get("ok")),
        "status": payload.get("status"),
        "task_id": (payload.get("task") or {}).get("id") if isinstance(payload.get("task"), dict) else None,
        "recommended_before": recommended,
        "recommended_after": after.get("recommended"),
        "stale_after": after.get("stale"),
        "written_path": str(written_path),
        "ran_at": now_iso(),
    }
    state["market_refresh_last_run"] = now
    state["market_refresh_last_summary"] = summary
    return summary


def print_readiness(args: argparse.Namespace) -> None:
    payload = readiness_payload()
    recorded = append_readiness_snapshot(payload, source=getattr(args, "source", "manual")) if getattr(args, "record", False) else None
    if args.json:
        if recorded:
            payload["recorded_snapshot"] = recorded
        print(json.dumps(payload, ensure_ascii=False, indent=2))
        return
    print(f"readiness: {payload['status']} ({payload['updated_at']})")
    print(f"readonly_ready={payload['readonly_ready']} canary_review_ready={payload['canary_review_ready']}")
    locks = payload.get("locks") or {}
    print(
        "locks: "
        f"dry_run_only={locks.get('dry_run_only')} "
        f"can_submit_live={locks.get('can_submit_live')} "
        f"live_trading_enabled={locks.get('live_trading_enabled')} "
        f"live_order_enabled={locks.get('live_order_enabled')} "
        f"live_cancel_enabled={locks.get('live_cancel_enabled')}"
    )
    checks = payload.get("checks") or {}
    print(
        "checks: "
        + " · ".join(f"{key}={value}" for key, value in checks.items())
    )
    shadow = payload.get("latest_shadow_order") if isinstance(payload.get("latest_shadow_order"), dict) else {}
    if shadow:
        print(
            "shadow: "
            f"would_submit={shadow.get('would_submit')} "
            f"dry_run_only={shadow.get('dry_run_only')} "
            f"can_submit_live={shadow.get('can_submit_live')} "
            f"payload_hash={'present' if shadow.get('payload_sha256') else 'not_required' if not shadow.get('payload_ready') else 'missing'}"
        )
    if payload.get("top_task"):
        task = payload["top_task"]
        print(f"top task: {task.get('id')} · {task.get('title')} · {task.get('status')}")
    print(f"next action: {payload.get('next_action') or '-'}")
    if payload.get("warnings"):
        print("warnings:")
        for item in payload["warnings"]:
            print(f"- {item}")
    if recorded:
        print(f"recorded readiness snapshot: {READINESS_SNAPSHOT_FILE} · {recorded.get('status')} · {recorded.get('time')}")


def print_readiness_history(args: argparse.Namespace) -> None:
    payload = read_readiness_snapshots(limit=int(args.limit))
    if args.json:
        print(json.dumps(payload, ensure_ascii=False, indent=2))
        return
    rows = payload.get("rows") if isinstance(payload.get("rows"), list) else []
    print(f"readiness snapshots: {payload.get('count', 0)} · {payload.get('path')}")
    if not rows:
        print("- no snapshots recorded")
        return
    for row in rows:
        if not isinstance(row, dict):
            continue
        locks = row.get("locks") if isinstance(row.get("locks"), dict) else {}
        checks = row.get("checks") if isinstance(row.get("checks"), dict) else {}
        print(
            f"- {row.get('time') or '-'} · {row.get('source') or '-'} · {row.get('status') or '-'} "
            f"· readonly={row.get('readonly_ready')} canary={row.get('canary_review_ready')} "
            f"· dry_run_only={locks.get('dry_run_only')} can_submit_live={locks.get('can_submit_live')} "
            f"· keychain={checks.get('keychain_ok')} okx_readonly={checks.get('okx_readonly_ok')}"
        )


def verify_import_readiness(timeout_seconds: float = 45.0) -> dict[str, Any]:
    print("post-import verify: waiting for backend execution config...")
    ok, config, error = wait_for_http("http://127.0.0.1:8765/api/execution/config", timeout_seconds=timeout_seconds)
    if not ok or not isinstance(config, dict):
        raise SystemExit(f"post-import verify failed: execution config unavailable ({error})")
    connector = config.get("connector_status") if isinstance(config.get("connector_status"), dict) else {}
    print(
        "post-import config: "
        f"okx_configured={config.get('okx_configured')} "
        f"dry_run_only={connector.get('dry_run_only')} "
        f"can_submit_live={connector.get('can_submit_live')} "
        f"live_submit_available={config.get('live_submit_available')}"
    )
    payload = readiness_payload()
    locks = payload.get("locks") if isinstance(payload.get("locks"), dict) else {}
    checks = payload.get("checks") if isinstance(payload.get("checks"), dict) else {}
    print(
        "post-import readiness: "
        f"status={payload.get('status')} "
        f"readonly_ready={payload.get('readonly_ready')} "
        f"canary_review_ready={payload.get('canary_review_ready')} "
        f"keychain_ok={checks.get('keychain_ok')} "
        f"okx_readonly_ok={checks.get('okx_readonly_ok')}"
    )
    print(
        "post-import locks: "
        f"dry_run_only={locks.get('dry_run_only')} "
        f"can_submit_live={locks.get('can_submit_live')} "
        f"live_trading_enabled={locks.get('live_trading_enabled')} "
        f"live_order_enabled={locks.get('live_order_enabled')} "
        f"live_cancel_enabled={locks.get('live_cancel_enabled')}"
    )
    if not bool(locks.get("dry_run_only")) or bool(locks.get("can_submit_live")):
        raise SystemExit("post-import safety failure: live submit lock is not closed")
    if any(bool(locks.get(key)) for key in ("live_trading_enabled", "live_order_enabled", "live_cancel_enabled")):
        raise SystemExit("post-import safety failure: live environment flag is enabled")
    if payload.get("next_action"):
        print(f"post-import next action: {payload.get('next_action')}")
    snapshot = append_readiness_snapshot(payload, source="post_import_verify")
    print(f"post-import snapshot: {READINESS_SNAPSHOT_FILE} · {snapshot.get('status')} · {snapshot.get('time')}")
    return payload


def post_json(url: str, payload: dict[str, Any], timeout: float = 8.0) -> tuple[bool, Any, str]:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            text = response.read().decode("utf-8", errors="replace")
            return True, json.loads(text) if text else {}, ""
    except urllib.error.HTTPError as exc:
        text = exc.read().decode("utf-8", errors="replace")
        try:
            parsed = json.loads(text) if text else {}
        except json.JSONDecodeError:
            parsed = {"raw": text}
        return False, parsed, f"HTTP {exc.code}"
    except Exception as exc:
        return False, {}, str(exc)


def get_local_json(path: str, timeout: float = 8.0) -> tuple[bool, Any, str]:
    return http_request(f"http://127.0.0.1:8765{path}", timeout=timeout)


def poll_backend_task(task_id: str, *, timeout_seconds: float = 120.0, poll_seconds: float = 2.0) -> dict[str, Any]:
    deadline = time.time() + max(0.0, timeout_seconds)
    latest: dict[str, Any] = {}
    last_error = ""
    while True:
        query = urllib.parse.urlencode({"id": task_id})
        ok, task, error = get_local_json(f"/api/task?{query}", timeout=8)
        if ok and isinstance(task, dict):
            latest = task
            status = str(task.get("status") or "")
            if status in {"completed", "failed", "cancelled"}:
                return {"finished": True, "task": task, "error": ""}
        else:
            last_error = error or "task unavailable"
        if time.time() >= deadline:
            return {"finished": False, "task": latest, "error": last_error or "timeout"}
        time.sleep(max(0.25, poll_seconds))


def compact_cache_status(payload: Any) -> dict[str, Any]:
    if not isinstance(payload, dict):
        return {"ok": False, "rows": [], "summary": {}}
    rows = payload.get("rows") if isinstance(payload.get("rows"), list) else []
    stale_rows = [row for row in rows if isinstance(row, dict) and row.get("is_stale")]
    recommended_rows = [row for row in rows if isinstance(row, dict) and row.get("recommended_refresh")]
    high_cost_rows = [
        row
        for row in stale_rows
        if row.get("high_refresh_cost") and not row.get("covered_by_fresh_cache")
    ]
    fresh_rows = [row for row in rows if isinstance(row, dict) and not row.get("is_stale")]
    return {
        "ok": True,
        "summary": {
            "rows": len(rows),
            "fresh": len(fresh_rows),
            "stale": len(stale_rows),
            "recommended": len(recommended_rows),
            "high_cost_stale": len(high_cost_rows),
            "cache_dir": payload.get("cache_dir"),
            "portfolio_result_cache": payload.get("portfolio_result_cache") if isinstance(payload.get("portfolio_result_cache"), dict) else {},
        },
        "top_stale": [
            {
                "inst_id": row.get("inst_id"),
                "bar": row.get("bar"),
                "count": row.get("count") or row.get("candles"),
                "latest_closed": row.get("latest_closed"),
                "refresh_priority": row.get("refresh_priority"),
                "recommended_refresh": row.get("recommended_refresh"),
                "high_refresh_cost": row.get("high_refresh_cost"),
                "refresh_cost_label": row.get("refresh_cost_label"),
            }
            for row in stale_rows[:12]
            if isinstance(row, dict)
        ],
    }


def market_data_refresh_payload(
    *,
    max_items: int = 4,
    recommended_only: bool = True,
    include_high_cost: bool = False,
    timeout_seconds: float = 120.0,
    poll_seconds: float = 2.0,
) -> dict[str, Any]:
    before_ok, before_status, before_error = get_local_json("/api/data/status", timeout=10)
    config_ok, config, config_error = get_local_json("/api/execution/config", timeout=8)
    connector = config.get("connector_status") if isinstance(config, dict) and isinstance(config.get("connector_status"), dict) else {}
    locks = {
        "dry_run_only": connector.get("dry_run_only"),
        "can_submit_live": connector.get("can_submit_live"),
        "live_trading_enabled": config.get("live_trading_enabled") if isinstance(config, dict) else None,
        "live_order_enabled": config.get("live_order_enabled") if isinstance(config, dict) else None,
        "live_cancel_enabled": config.get("live_cancel_enabled") if isinstance(config, dict) else None,
    }
    task_params = {
        "stale": True,
        "recommended_only": bool(recommended_only),
        "include_high_cost": bool(include_high_cost),
        "max_items": max(1, min(int(max_items), 12)),
    }
    task_ok, task_payload, task_error = post_json(
        "http://127.0.0.1:8765/api/tasks",
        {"type": "data_refresh", "params": task_params},
        timeout=10,
    )
    task_id = task_payload.get("id") if isinstance(task_payload, dict) else None
    poll_result: dict[str, Any] = {"finished": False, "task": {}, "error": task_error or "task enqueue failed"}
    if task_ok and task_id:
        poll_result = poll_backend_task(str(task_id), timeout_seconds=timeout_seconds, poll_seconds=poll_seconds)
    progress_ok, progress, progress_error = get_local_json("/api/data/refresh-progress", timeout=8)
    after_ok, after_status, after_error = get_local_json("/api/data/status", timeout=10)
    task = poll_result.get("task") if isinstance(poll_result.get("task"), dict) else {}
    result = task.get("result") if isinstance(task.get("result"), dict) else {}
    failed_count = int(result.get("failed") or (task.get("progress") or {}).get("failed") or 0)
    task_status = str(task.get("status") or ("queued" if task_ok else "failed"))
    live_submit_locked = bool(locks.get("dry_run_only") and not locks.get("can_submit_live"))
    live_env_locked = not any(bool(locks.get(key)) for key in ("live_trading_enabled", "live_order_enabled", "live_cancel_enabled"))
    ok = bool(task_ok and poll_result.get("finished") and task_status == "completed" and live_submit_locked and live_env_locked)
    status = "ok" if ok and failed_count == 0 else "warning"
    payload = {
        "generated_at": now_iso(),
        "ok": ok,
        "status": status,
        "purpose": "public_market_data_refresh_evidence",
        "request": {
            "max_items": task_params["max_items"],
            "recommended_only": task_params["recommended_only"],
            "include_high_cost": task_params["include_high_cost"],
            "timeout_seconds": timeout_seconds,
            "poll_seconds": poll_seconds,
        },
        "task": {
            "enqueue_ok": bool(task_ok),
            "enqueue_error": task_error,
            "id": task_id,
            "status": task_status,
            "finished": bool(poll_result.get("finished")),
            "poll_error": poll_result.get("error"),
            "progress": task.get("progress") if isinstance(task.get("progress"), dict) else {},
            "result_summary": {
                "batch_id": result.get("batch_id"),
                "mode": result.get("mode"),
                "ok": result.get("ok"),
                "failed": result.get("failed"),
                "skipped_due_to_active_refresh": result.get("skipped_due_to_active_refresh"),
                "skipped_covered": result.get("skipped_covered"),
                "skipped_high_cost": result.get("skipped_high_cost"),
                "include_high_cost": result.get("include_high_cost"),
            },
            "results": result.get("results") if isinstance(result.get("results"), list) else [],
        },
        "data_refresh_progress": {
            "ok": bool(progress_ok),
            "error": progress_error,
            "payload": progress if isinstance(progress, dict) else {},
        },
        "cache_before": {
            "ok": bool(before_ok),
            "error": before_error,
            "status": compact_cache_status(before_status),
        },
        "cache_after": {
            "ok": bool(after_ok),
            "error": after_error,
            "status": compact_cache_status(after_status),
        },
        "runtime": {
            "execution_config_ok": bool(config_ok),
            "execution_config_error": config_error,
            "locks": locks,
            "live_submit_locked": live_submit_locked,
            "live_env_locked": live_env_locked,
        },
    }
    return sanitize_for_log(payload)


def print_market_data_refresh(args: argparse.Namespace) -> None:
    payload = market_data_refresh_payload(
        max_items=int(args.max_items),
        recommended_only=not bool(args.all_stale),
        include_high_cost=bool(args.include_high_cost),
        timeout_seconds=float(args.timeout),
        poll_seconds=float(args.poll),
    )
    written_path = write_evidence_payload(payload, "market-data-refresh") if args.write else None
    if written_path:
        payload["written_path"] = str(written_path)
    if args.json:
        print(json.dumps(payload, ensure_ascii=False, indent=2))
        return
    task = payload.get("task") if isinstance(payload.get("task"), dict) else {}
    before = ((payload.get("cache_before") or {}).get("status") or {}).get("summary") if isinstance((payload.get("cache_before") or {}).get("status"), dict) else {}
    after = ((payload.get("cache_after") or {}).get("status") or {}).get("summary") if isinstance((payload.get("cache_after") or {}).get("status"), dict) else {}
    runtime = payload.get("runtime") if isinstance(payload.get("runtime"), dict) else {}
    locks = runtime.get("locks") if isinstance(runtime.get("locks"), dict) else {}
    print(f"market data refresh: {payload.get('status')} ({payload.get('generated_at')})")
    print(
        "task: "
        f"id={task.get('id') or '-'} status={task.get('status') or '-'} finished={task.get('finished')} "
        f"ok={(task.get('result_summary') or {}).get('ok')} failed={(task.get('result_summary') or {}).get('failed')}"
    )
    print(
        "cache: "
        f"before stale={before.get('stale')} recommended={before.get('recommended')} high_cost={before.get('high_cost_stale')} · "
        f"after stale={after.get('stale')} recommended={after.get('recommended')} high_cost={after.get('high_cost_stale')}"
    )
    print(
        "locks: "
        f"dry_run_only={locks.get('dry_run_only')} "
        f"can_submit_live={locks.get('can_submit_live')} "
        f"live_trading_enabled={locks.get('live_trading_enabled')} "
        f"live_order_enabled={locks.get('live_order_enabled')} "
        f"live_cancel_enabled={locks.get('live_cancel_enabled')}"
    )
    if task.get("poll_error"):
        print(f"poll: {task.get('poll_error')}")
    if written_path:
        print(f"wrote market data evidence: {written_path}")


def record_task_action(args: argparse.Namespace) -> None:
    payload = {
        "task_id": args.task_id,
        "action": args.action,
        "status": args.status or args.action,
        "note": args.note or "",
        "source": "manage_24x7",
    }
    ok, result, error = post_json("http://127.0.0.1:8765/api/automation/task-action", payload, timeout=8)
    if args.json:
        print(json.dumps(result if isinstance(result, dict) else {"ok": ok, "error": error}, ensure_ascii=False, indent=2))
    else:
        entry = (result or {}).get("entry") if isinstance(result, dict) else {}
        if ok and isinstance(entry, dict):
            print(f"recorded task action: {entry.get('task_id')} · {entry.get('status')} · dry_run_only={entry.get('dry_run_only')} can_submit_live={entry.get('can_submit_live')}")
        else:
            print(error or (result or {}).get("error") or "task action failed")
    if not ok:
        raise SystemExit(1)


def live_lock_test_payload(args: argparse.Namespace) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "confirmation": args.confirmation or "",
        "use_canary": bool(args.use_canary),
        "source": "manage_24x7_live_lock_test",
    }
    if args.intent_json:
        try:
            parsed = json.loads(args.intent_json)
        except json.JSONDecodeError as exc:
            raise SystemExit(f"invalid --intent-json: {exc}") from exc
        if not isinstance(parsed, dict):
            raise SystemExit("--intent-json must decode to an object")
        payload["order_intent"] = parsed
    return payload


def live_lock_test_request(payload: dict[str, Any]) -> dict[str, Any]:
    ok, result, error = post_json("http://127.0.0.1:8765/api/execution/live-submit", payload, timeout=12)
    if not isinstance(result, dict):
        result = {"ok": ok, "error": error or "unexpected live-submit response"}
    shadow = result.get("shadow_order") if isinstance(result.get("shadow_order"), dict) else {}
    connector_attempt = result.get("connector_attempt") if isinstance(result.get("connector_attempt"), dict) else {}
    connector = connector_attempt.get("connector") if isinstance(connector_attempt.get("connector"), dict) else shadow.get("connector") if isinstance(shadow.get("connector"), dict) else {}
    submitted = bool(result.get("submitted"))
    shadow_locked = bool(
        shadow
        and shadow.get("would_submit") is False
        and shadow.get("dry_run_only") is True
        and shadow.get("can_submit_live") is False
    )
    connector_locked = not bool(connector.get("can_submit_live"))
    lock_ok = bool(ok and not submitted and shadow_locked and connector_locked)
    summary = {
        "ok": lock_ok,
        "http_ok": ok,
        "submitted": submitted,
        "decision": result.get("decision"),
        "submit_mode": result.get("submit_mode"),
        "shadow_locked": shadow_locked,
        "connector_locked": connector_locked,
        "dry_run_only": shadow.get("dry_run_only"),
        "can_submit_live": shadow.get("can_submit_live"),
        "blocked_reasons": result.get("blocked_reasons") or [],
        "shadow_order": shadow,
        "connector_attempt": connector_attempt,
        "error": error or result.get("error"),
    }
    return summary


def record_live_lock_readiness_snapshot(source: str) -> dict[str, Any]:
    return append_readiness_snapshot(source=source)


def print_live_lock_test(args: argparse.Namespace) -> None:
    summary = live_lock_test_request(live_lock_test_payload(args))
    snapshot = None
    if summary.get("ok") and not getattr(args, "skip_readiness_record", False):
        snapshot = record_live_lock_readiness_snapshot("live_lock_test")
        summary["readiness_snapshot"] = {
            "status": snapshot.get("status"),
            "time": snapshot.get("time"),
            "source": snapshot.get("source"),
        }
    if args.json:
        print(json.dumps(sanitize_for_log(summary), ensure_ascii=False, indent=2))
    else:
        print(
            "live lock test: "
            f"ok={summary['ok']} submitted={summary['submitted']} decision={summary['decision'] or '-'} "
            f"dry_run_only={summary['dry_run_only']} can_submit_live={summary['can_submit_live']}"
        )
        if summary["blocked_reasons"]:
            print("blocked reasons:")
            for item in summary["blocked_reasons"][:8]:
                print(f"- {item}")
        if snapshot:
            print(f"recorded readiness snapshot: {READINESS_SNAPSHOT_FILE} · {snapshot.get('status')} · {snapshot.get('time')}")
    if not summary["ok"]:
        raise SystemExit("live submit lock test failed")


def secrets_status_payload() -> dict[str, Any]:
    okx_presence = keychain_presence(OKX_KEYCHAIN_SERVICE, OKX_KEYS)
    ai4trade_presence = keychain_presence(AI4TRADE_KEYCHAIN_SERVICE, AI4TRADE_KEYS)
    return {
        "okx": {
            "service": OKX_KEYCHAIN_SERVICE,
            "configured": all(okx_presence.values()),
            "keys": okx_presence,
            "detail": keychain_presence_detail(okx_presence),
        },
        "ai4trade": {
            "service": AI4TRADE_KEYCHAIN_SERVICE,
            "configured": bool(ai4trade_presence.get("AI4TRADE_TOKEN")),
            "keys": ai4trade_presence,
            "detail": keychain_presence_detail(ai4trade_presence),
        },
        "updated_at": now_iso(),
    }


def print_secrets_status(args: argparse.Namespace) -> None:
    payload = secrets_status_payload()
    if args.json:
        print(json.dumps(payload, ensure_ascii=False, indent=2))
        return
    okx = payload["okx"]
    ai4trade = payload["ai4trade"]
    print(f"OKX Keychain: {'configured' if okx['configured'] else 'missing'} · {okx['service']} · {okx['detail']}")
    print(f"AI4Trade Keychain: {'token_present' if ai4trade['configured'] else 'missing_token'} · {ai4trade['service']} · {ai4trade['detail']}")


def credential_presence_rows(payload: dict[str, Any]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for group in ("okx", "ai4trade"):
        data = payload.get(group) if isinstance(payload.get(group), dict) else {}
        keys = data.get("keys") if isinstance(data.get("keys"), dict) else {}
        rows.append(
            {
                "group": group,
                "service": data.get("service"),
                "configured": bool(data.get("configured")),
                "items": [{"name": key, "present": bool(value)} for key, value in keys.items()],
                "detail": data.get("detail"),
            }
        )
    return rows


def evidence_health_details(health: dict[str, Any], names: tuple[str, ...]) -> dict[str, dict[str, Any]]:
    details: dict[str, dict[str, Any]] = {}
    for name in names:
        row = health_check(health, name)
        details[name] = {
            "ok": bool(row.get("ok")),
            "severity": row.get("severity"),
            "detail": row.get("detail"),
            "data": row.get("data") if isinstance(row.get("data"), dict) else {},
        }
    return details


def latest_evidence_payload(prefix: str) -> tuple[Path | None, dict[str, Any], float | None, str]:
    ensure_dirs()
    candidates = sorted(EVIDENCE_BUNDLE_DIR.glob(f"{prefix}-*.json"), key=lambda path: path.stat().st_mtime, reverse=True)
    for path in candidates:
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            return path, {}, None, f"failed to read {path.name}: {exc}"
        generated_ts = parse_time(str(payload.get("generated_at") or ""))
        mtime_ts = path.stat().st_mtime
        age = max(0, time.time() - (generated_ts or mtime_ts))
        return path, payload if isinstance(payload, dict) else {}, age, ""
    return None, {}, None, f"no {prefix} evidence found"


def recent_backtest_evidence_status() -> dict[str, Any]:
    path, payload, age, error = latest_evidence_payload("recent-backtest")
    portfolio = payload.get("portfolio") if isinstance(payload.get("portfolio"), dict) else {}
    portfolio_result = portfolio.get("result") if isinstance(portfolio.get("result"), dict) else {}
    summary = portfolio_result.get("summary") if isinstance(portfolio_result.get("summary"), dict) else {}
    health = portfolio_result.get("health") if isinstance(portfolio_result.get("health"), dict) else {}
    slices = payload.get("slices") if isinstance(payload.get("slices"), dict) else {}
    slices_result = slices.get("result") if isinstance(slices.get("result"), dict) else {}
    aggregate = slices_result.get("aggregate") if isinstance(slices_result.get("aggregate"), dict) else {}
    runtime = payload.get("runtime") if isinstance(payload.get("runtime"), dict) else {}
    locks_ok = bool(runtime.get("live_submit_locked") and runtime.get("live_env_locked"))
    age_ok = age is not None and age <= RECENT_BACKTEST_EVIDENCE_FRESH_SECONDS
    payload_ok = bool(payload.get("ok") and portfolio.get("ok") and slices.get("ok") and locks_ok)
    ok = bool(payload_ok and age_ok)
    age_label = f"{age:.0f}s ago" if age is not None else "unknown age"
    return_pct = summary.get("return_pct")
    detail = (
        f"latest {age_label} · return={return_pct if return_pct is not None else '-'} · "
        f"health={health.get('grade') or '-'} {health.get('score') if health.get('score') is not None else '-'} · "
        f"slices={aggregate.get('cases') if aggregate.get('cases') is not None else '-'} · locks={locks_ok}"
        if payload
        else error
    )
    return {
        "ok": ok,
        "detail": detail,
        "path": str(path) if path else "",
        "age_seconds": age,
        "fresh_seconds": RECENT_BACKTEST_EVIDENCE_FRESH_SECONDS,
        "payload_ok": payload_ok,
        "age_ok": age_ok,
        "locks_ok": locks_ok,
        "status": payload.get("status"),
        "generated_at": payload.get("generated_at"),
        "return_pct": return_pct,
        "final_equity": summary.get("final_equity"),
        "max_drawdown": summary.get("max_drawdown"),
        "trades": summary.get("trades"),
        "health_grade": health.get("grade"),
        "health_score": health.get("score"),
        "slice_cases": aggregate.get("cases"),
        "slice_positive_cases": aggregate.get("positive_cases"),
        "error": error,
    }


def recent_backtest_params(
    *,
    history_hours: float = 2160,
    slice_hours: float = 720,
    symbols: list[str] | None = None,
    offline_mode: bool = True,
    prefer_cache: bool = True,
) -> dict[str, Any]:
    params = dict(RECENT_BACKTEST_DEFAULTS)
    params["history_hours"] = history_hours
    params["slice_hours"] = slice_hours
    params["offline_mode"] = bool(offline_mode)
    params["prefer_cache"] = bool(prefer_cache)
    if symbols:
        params["symbols"] = symbols
    return params


def compact_portfolio_backtest_result(result: dict[str, Any]) -> dict[str, Any]:
    summary = result.get("summary") if isinstance(result.get("summary"), dict) else {}
    health = result.get("health") if isinstance(result.get("health"), dict) else {}
    curve = result.get("equity_curve") if isinstance(result.get("equity_curve"), list) else []
    trades = result.get("trades") if isinstance(result.get("trades"), list) else []
    return {
        "summary": summary,
        "health": health,
        "by_symbol": result.get("by_symbol") if isinstance(result.get("by_symbol"), list) else [],
        "cache": result.get("cache") if isinstance(result.get("cache"), dict) else {},
        "equity_points": len(curve),
        "latest_equity": curve[-1] if curve and isinstance(curve[-1], dict) else None,
        "latest_trade": trades[-1] if trades and isinstance(trades[-1], dict) else None,
    }


def compact_portfolio_slices_result(result: dict[str, Any]) -> dict[str, Any]:
    rows = result.get("results") if isinstance(result.get("results"), list) else []
    compact_rows: list[dict[str, Any]] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        compact_rows.append(
            {
                "slice": row.get("slice"),
                "window_start": row.get("window_start"),
                "window_end": row.get("window_end"),
                "summary": row.get("summary") if isinstance(row.get("summary"), dict) else {},
            }
        )
    return {
        "aggregate": result.get("aggregate") if isinstance(result.get("aggregate"), dict) else {},
        "results": compact_rows,
    }


def recent_backtest_payload(
    *,
    history_hours: float = 2160,
    slice_hours: float = 720,
    symbols: list[str] | None = None,
    offline_mode: bool = True,
    prefer_cache: bool = True,
    timeout: float = 90.0,
) -> dict[str, Any]:
    params = recent_backtest_params(
        history_hours=history_hours,
        slice_hours=slice_hours,
        symbols=symbols,
        offline_mode=offline_mode,
        prefer_cache=prefer_cache,
    )
    generated_at = now_iso()
    portfolio_ok, portfolio_result, portfolio_error = post_json(
        "http://127.0.0.1:8765/api/portfolio-backtest",
        params,
        timeout=timeout,
    )
    slices_ok, slices_result, slices_error = post_json(
        "http://127.0.0.1:8765/api/portfolio-slices",
        params,
        timeout=timeout,
    )
    paper_ok, paper_status, paper_error = http_request("http://127.0.0.1:8765/api/paper/status", timeout=8)
    config_ok, config, config_error = http_request("http://127.0.0.1:8765/api/execution/config", timeout=8)
    connector = config.get("connector_status") if isinstance(config, dict) and isinstance(config.get("connector_status"), dict) else {}
    locks = {
        "dry_run_only": connector.get("dry_run_only"),
        "can_submit_live": connector.get("can_submit_live"),
        "live_trading_enabled": config.get("live_trading_enabled") if isinstance(config, dict) else None,
        "live_order_enabled": config.get("live_order_enabled") if isinstance(config, dict) else None,
        "live_cancel_enabled": config.get("live_cancel_enabled") if isinstance(config, dict) else None,
    }
    live_submit_locked = bool(locks.get("dry_run_only") and not locks.get("can_submit_live"))
    live_env_locked = not any(bool(locks.get(key)) for key in ("live_trading_enabled", "live_order_enabled", "live_cancel_enabled"))
    payload = {
        "generated_at": generated_at,
        "ok": bool(portfolio_ok and slices_ok and live_submit_locked and live_env_locked),
        "status": "ok" if portfolio_ok and slices_ok and live_submit_locked and live_env_locked else "warning",
        "purpose": "recent_backtest_operational_evidence",
        "params": params,
        "portfolio": {
            "ok": bool(portfolio_ok),
            "error": portfolio_error,
            "result": compact_portfolio_backtest_result(portfolio_result) if isinstance(portfolio_result, dict) else {},
        },
        "slices": {
            "ok": bool(slices_ok),
            "error": slices_error,
            "result": compact_portfolio_slices_result(slices_result) if isinstance(slices_result, dict) else {},
        },
        "runtime": {
            "paper_status_ok": bool(paper_ok),
            "paper_error": paper_error,
            "paper_running": bool(isinstance(paper_status, dict) and paper_status.get("running")),
            "paper_equity": paper_status.get("equity") if isinstance(paper_status, dict) else None,
            "paper_updated_at": paper_status.get("updated_at") if isinstance(paper_status, dict) else None,
            "execution_config_ok": bool(config_ok),
            "execution_config_error": config_error,
            "locks": locks,
            "live_submit_locked": live_submit_locked,
            "live_env_locked": live_env_locked,
        },
    }
    return sanitize_for_log(payload)


def write_evidence_payload(payload: dict[str, Any], prefix: str) -> Path:
    ensure_dirs()
    EVIDENCE_BUNDLE_DIR.mkdir(parents=True, exist_ok=True)
    safe_prefix = re.sub(r"[^a-zA-Z0-9_.-]+", "-", prefix).strip("-") or "evidence"
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    path = EVIDENCE_BUNDLE_DIR / f"{safe_prefix}-{stamp}.json"
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return path


def evidence_bundle_payload(limit: int = 10, *, include_backtest: bool = False) -> dict[str, Any]:
    health = collect_health()
    readiness = readiness_payload(health)
    snapshot_history = read_readiness_snapshots(limit=limit)
    secrets = secrets_status_payload()
    services = service_status_payload()
    shadow = execution_ledger_shadow_status()
    has_live_submit, submitted_row = execution_ledger_has_live_submit()

    locks = readiness.get("locks") if isinstance(readiness.get("locks"), dict) else {}
    checks = readiness.get("checks") if isinstance(readiness.get("checks"), dict) else {}
    dry_run_only = bool(locks.get("dry_run_only"))
    can_submit_live = bool(locks.get("can_submit_live"))
    live_flags_enabled = [
        key
        for key in ("live_trading_enabled", "live_order_enabled", "live_cancel_enabled")
        if bool(locks.get(key))
    ]
    live_submit_locked = bool(dry_run_only and not can_submit_live)
    live_env_locked = not live_flags_enabled
    safety_critical = bool(has_live_submit or not live_submit_locked or not live_env_locked)
    service_ok = bool(services.get("ok"))
    paper_running = bool(health_check(health, "paper_loop_running").get("ok"))
    no_real_submitted_orders = bool(not has_live_submit and health_check(health, "no_real_submitted_orders").get("ok"))
    safe_to_keep_running = bool(not health.get("critical") and service_ok and paper_running and live_submit_locked and live_env_locked and no_real_submitted_orders)
    if safety_critical or health.get("critical"):
        status = "critical"
    elif health.get("warnings") or readiness.get("status") != "canary_review_ready":
        status = "warning"
    else:
        status = "ok"

    equity_details = evidence_health_details(
        health,
        (
            "account_equity_history",
            "account_equity_source",
            "account_equity_anchor_fixed",
            "account_equity_interval_15m",
            "account_equity_after_anchor",
            "account_equity_fresh",
        ),
    )
    automation_details = evidence_health_details(
        health,
        (
            "automation_stage",
            "automation_heartbeat_fresh",
            "automation_task_board",
            "automation_task_board_evidence",
            "readiness_snapshot_fresh",
            "execution_shadow_recent",
        ),
    )
    okx_details = evidence_health_details(
        health,
        (
            "okx_credentials",
            "okx_keychain",
            "okx_readonly",
            "okx_diagnostics_history",
        ),
    )
    data_details = evidence_health_details(
        health,
        (
            "data_status_http",
            "data_cache_recommended_refresh",
            "data_cache_strategy_core",
            "watchdog_market_refresh",
            "recent_backtest_evidence",
        ),
    )
    ai4trade_details = evidence_health_details(
        health,
        (
            "ai4trade_status_http",
            "ai4trade_configured",
            "ai4trade_history",
            "ai4trade_history_fresh",
            "ai4trade_history_readonly_policy",
            "ai4trade_signal_alignment",
        ),
    )

    bundle = {
        "generated_at": now_iso(),
        "summary": {
            "status": status,
            "safe_to_keep_running": safe_to_keep_running,
            "ready_for_okx_readonly_validation": bool(readiness.get("readonly_ready")),
            "ready_for_manual_canary_review": bool(readiness.get("canary_review_ready")),
            "ready_for_real_submit": False,
            "safety_critical": safety_critical,
            "service_ok": service_ok,
            "paper_running": paper_running,
            "no_real_submitted_orders": no_real_submitted_orders,
            "live_submit_locked": live_submit_locked,
            "live_env_locked": live_env_locked,
            "status_reason": readiness.get("status"),
            "next_action": readiness.get("next_action"),
        },
        "locks": {
            "dry_run_only": locks.get("dry_run_only"),
            "can_submit_live": locks.get("can_submit_live"),
            "live_trading_enabled": locks.get("live_trading_enabled"),
            "live_order_enabled": locks.get("live_order_enabled"),
            "live_cancel_enabled": locks.get("live_cancel_enabled"),
        },
        "readiness": {
            "status": readiness.get("status"),
            "stage": readiness.get("stage"),
            "label": readiness.get("label"),
            "readonly_ready": bool(readiness.get("readonly_ready")),
            "canary_review_ready": bool(readiness.get("canary_review_ready")),
            "checks": checks,
            "blockers": readiness.get("blockers") or [],
            "top_task": readiness.get("top_task") if isinstance(readiness.get("top_task"), dict) else {},
            "latest_shadow_order": readiness.get("latest_shadow_order") if isinstance(readiness.get("latest_shadow_order"), dict) else {},
        },
        "health": {
            "status": health.get("status"),
            "critical": health.get("critical") or [],
            "warnings": health.get("warnings") or [],
            "data": data_details,
            "equity": equity_details,
            "automation": automation_details,
            "okx": okx_details,
            "ai4trade": ai4trade_details,
        },
        "credential_presence": credential_presence_rows(secrets),
        "services": services,
        "readiness_snapshots": snapshot_history,
        "execution_ledger": {
            "has_real_submitted_order": has_live_submit,
            "submitted_order": submitted_row,
            "shadow_status": shadow,
        },
        "paths": {
            "readiness_snapshots": str(READINESS_SNAPSHOT_FILE),
            "execution_ledger": str(CACHE_DIR / "execution-orders.jsonl"),
            "evidence_dir": str(EVIDENCE_BUNDLE_DIR),
        },
    }
    if include_backtest:
        try:
            bundle["recent_backtest"] = recent_backtest_payload()
        except Exception as exc:
            bundle["recent_backtest"] = {
                "ok": False,
                "status": "warning",
                "error": str(exc),
                "generated_at": now_iso(),
            }
    return sanitize_for_log(bundle)


def write_evidence_bundle(payload: dict[str, Any]) -> Path:
    return write_evidence_payload(payload, "evidence")


def print_evidence_bundle(args: argparse.Namespace) -> None:
    payload = evidence_bundle_payload(limit=max(1, int(args.limit)), include_backtest=bool(getattr(args, "include_backtest", False)))
    written_path = write_evidence_bundle(payload) if args.write else None
    if written_path:
        payload["written_path"] = str(written_path)
    if args.json:
        print(json.dumps(payload, ensure_ascii=False, indent=2))
        return

    summary = payload.get("summary") if isinstance(payload.get("summary"), dict) else {}
    locks = payload.get("locks") if isinstance(payload.get("locks"), dict) else {}
    health = payload.get("health") if isinstance(payload.get("health"), dict) else {}
    equity = health.get("equity") if isinstance(health.get("equity"), dict) else {}
    okx = health.get("okx") if isinstance(health.get("okx"), dict) else {}
    execution = payload.get("execution_ledger") if isinstance(payload.get("execution_ledger"), dict) else {}
    shadow = execution.get("shadow_status") if isinstance(execution.get("shadow_status"), dict) else {}

    print(f"evidence bundle: {summary.get('status')} ({payload.get('generated_at')})")
    print(
        "runtime: "
        f"safe_to_keep_running={summary.get('safe_to_keep_running')} "
        f"service_ok={summary.get('service_ok')} paper_running={summary.get('paper_running')}"
    )
    print(
        "readiness: "
        f"okx_readonly={summary.get('ready_for_okx_readonly_validation')} "
        f"canary_review={summary.get('ready_for_manual_canary_review')} "
        f"real_submit={summary.get('ready_for_real_submit')} "
        f"reason={summary.get('status_reason')}"
    )
    print(
        "locks: "
        f"dry_run_only={locks.get('dry_run_only')} "
        f"can_submit_live={locks.get('can_submit_live')} "
        f"live_trading_enabled={locks.get('live_trading_enabled')} "
        f"live_order_enabled={locks.get('live_order_enabled')} "
        f"live_cancel_enabled={locks.get('live_cancel_enabled')}"
    )
    print(
        "equity: "
        f"{(equity.get('account_equity_source') or {}).get('detail') or '-'} · "
        f"{(equity.get('account_equity_history') or {}).get('detail') or '-'}"
    )
    print(
        "okx: "
        f"{(okx.get('okx_keychain') or {}).get('detail') or '-'} · "
        f"{(okx.get('okx_readonly') or {}).get('detail') or '-'}"
    )
    print(
        "execution: "
        f"no_real_submitted_orders={summary.get('no_real_submitted_orders')} "
        f"shadow_ok={shadow.get('ok')} · {shadow.get('detail') or '-'}"
    )
    if summary.get("next_action"):
        print(f"next action: {summary.get('next_action')}")
    if written_path:
        print(f"wrote evidence bundle: {written_path}")


def parse_symbol_list(value: str | None) -> list[str] | None:
    if not value:
        return None
    symbols = [item.strip() for item in value.split(",") if item.strip()]
    return symbols or None


def print_recent_backtest(args: argparse.Namespace) -> None:
    payload = recent_backtest_payload(
        history_hours=float(args.history_hours),
        slice_hours=float(args.slice_hours),
        symbols=parse_symbol_list(args.symbols),
        offline_mode=not bool(args.online),
        prefer_cache=not bool(args.no_cache),
        timeout=float(args.timeout),
    )
    written_path = write_evidence_payload(payload, "recent-backtest") if args.write else None
    if written_path:
        payload["written_path"] = str(written_path)
    if args.json:
        print(json.dumps(payload, ensure_ascii=False, indent=2))
        return

    portfolio = payload.get("portfolio") if isinstance(payload.get("portfolio"), dict) else {}
    portfolio_result = portfolio.get("result") if isinstance(portfolio.get("result"), dict) else {}
    summary = portfolio_result.get("summary") if isinstance(portfolio_result.get("summary"), dict) else {}
    health = portfolio_result.get("health") if isinstance(portfolio_result.get("health"), dict) else {}
    slices = payload.get("slices") if isinstance(payload.get("slices"), dict) else {}
    slices_result = slices.get("result") if isinstance(slices.get("result"), dict) else {}
    aggregate = slices_result.get("aggregate") if isinstance(slices_result.get("aggregate"), dict) else {}
    runtime = payload.get("runtime") if isinstance(payload.get("runtime"), dict) else {}
    locks = runtime.get("locks") if isinstance(runtime.get("locks"), dict) else {}

    print(f"recent backtest: {payload.get('status')} ({payload.get('generated_at')})")
    print(
        "portfolio: "
        f"return={float(summary.get('return_pct') or 0):.2%} "
        f"equity={float(summary.get('final_equity') or 0):.4f} "
        f"dd={float(summary.get('max_drawdown') or 0):.2%} "
        f"trades={summary.get('trades') or 0} "
        f"health={health.get('grade') or '-'} {health.get('score') or '-'}"
    )
    print(
        "slices: "
        f"cases={aggregate.get('cases') or 0} "
        f"positive={aggregate.get('positive_cases') or 0} "
        f"avg_return={float(aggregate.get('avg_return_pct') or 0):.2%} "
        f"worst_drawdown={float(aggregate.get('worst_drawdown') or 0):.2%}"
    )
    print(
        "runtime locks: "
        f"dry_run_only={locks.get('dry_run_only')} "
        f"can_submit_live={locks.get('can_submit_live')} "
        f"live_trading_enabled={locks.get('live_trading_enabled')} "
        f"live_order_enabled={locks.get('live_order_enabled')} "
        f"live_cancel_enabled={locks.get('live_cancel_enabled')}"
    )
    print(
        "paper: "
        f"running={runtime.get('paper_running')} "
        f"equity={runtime.get('paper_equity')} "
        f"updated_at={runtime.get('paper_updated_at') or '-'}"
    )
    if not portfolio.get("ok") or not slices.get("ok"):
        print(f"errors: portfolio={portfolio.get('error') or '-'} slices={slices.get('error') or '-'}")
    if written_path:
        print(f"wrote recent backtest evidence: {written_path}")


def gate_check(name: str, ok: bool, detail: str, *, severity: str = "blocker", evidence: dict[str, Any] | None = None) -> dict[str, Any]:
    return {
        "name": name,
        "ok": bool(ok),
        "severity": severity,
        "detail": detail,
        "evidence": evidence or {},
    }


def pre_live_gate_payload(
    phase: str = "readonly",
    *,
    health_payload: dict[str, Any] | None = None,
    readiness: dict[str, Any] | None = None,
    services: dict[str, Any] | None = None,
) -> dict[str, Any]:
    if phase not in PRE_LIVE_GATE_PHASES:
        raise SystemExit(f"unknown pre-live gate phase: {phase}")
    health = health_payload if isinstance(health_payload, dict) else collect_health()
    readiness_payload_data = readiness if isinstance(readiness, dict) else readiness_payload(health)
    service_status = services if isinstance(services, dict) else service_status_payload()
    locks = readiness_payload_data.get("locks") if isinstance(readiness_payload_data.get("locks"), dict) else {}
    readiness_checks = readiness_payload_data.get("checks") if isinstance(readiness_payload_data.get("checks"), dict) else {}
    rows: list[dict[str, Any]] = [
        gate_check("services_active", bool(service_status.get("ok")), f"{service_status.get('count', 0)} launchd services active"),
        gate_check("paper_loop_running", bool(health_check(health, "paper_loop_running").get("ok")), health_check(health, "paper_loop_running").get("detail") or "-"),
        gate_check("dry_run_only", bool(locks.get("dry_run_only")), f"dry_run_only={locks.get('dry_run_only')}"),
        gate_check("live_submit_locked", not bool(locks.get("can_submit_live")), f"can_submit_live={locks.get('can_submit_live')}"),
        gate_check(
            "live_env_locked",
            not any(bool(locks.get(key)) for key in ("live_trading_enabled", "live_order_enabled", "live_cancel_enabled")),
            f"live_trading_enabled={locks.get('live_trading_enabled')} live_order_enabled={locks.get('live_order_enabled')} live_cancel_enabled={locks.get('live_cancel_enabled')}",
        ),
        gate_check("no_real_submitted_orders", bool(readiness_checks.get("no_real_submitted_orders")), str(health_check(health, "no_real_submitted_orders").get("detail") or "-")),
        gate_check("execution_shadow_recent", bool(health_check(health, "execution_shadow_recent").get("ok")), str(health_check(health, "execution_shadow_recent").get("detail") or "-"), severity="warning"),
        gate_check("recent_backtest_evidence", bool(health_check(health, "recent_backtest_evidence").get("ok")), str(health_check(health, "recent_backtest_evidence").get("detail") or "-"), severity="warning"),
        gate_check("automation_task_board_evidence", bool(health_check(health, "automation_task_board_evidence").get("ok")), str(health_check(health, "automation_task_board_evidence").get("detail") or "-"), severity="warning"),
        gate_check("ai4trade_readonly_context", bool(health_check(health, "ai4trade_history_readonly_policy").get("ok")), str(health_check(health, "ai4trade_history_readonly_policy").get("detail") or "-"), severity="warning"),
        gate_check("ai4trade_signal_alignment", bool(health_check(health, "ai4trade_signal_alignment").get("ok")), str(health_check(health, "ai4trade_signal_alignment").get("detail") or "-"), severity="warning"),
    ]

    if phase in {"readonly", "canary", "live-submit"}:
        equity_source_detail = str(health_check(health, "account_equity_source").get("detail") or "")
        rows.extend(
            [
                gate_check("okx_keychain", bool(readiness_checks.get("keychain_ok")), str(health_check(health, "okx_keychain").get("detail") or "-")),
                gate_check("okx_readonly", bool(readiness_checks.get("okx_readonly_ok")), str(health_check(health, "okx_readonly").get("detail") or "-")),
                gate_check("okx_equity_source", "source=okx_readonly" in equity_source_detail, equity_source_detail or "-"),
            ]
        )

    if phase in {"canary", "live-submit"}:
        rows.extend(
            [
                gate_check("shadow_order_locked", bool(readiness_checks.get("shadow_order_locked")), "shadow order locked and not submitted"),
                gate_check("heartbeat_fresh", bool(readiness_checks.get("heartbeat_fresh")), str(health_check(health, "automation_heartbeat_fresh").get("detail") or "-")),
                gate_check("manual_canary_review_ready", bool(readiness_payload_data.get("canary_review_ready")), str(readiness_payload_data.get("status") or "-")),
            ]
        )

    if phase == "live-submit":
        rows.append(
            gate_check(
                "manual_live_unlock_review",
                False,
                "真实提交阶段仍需单独解锁代码路径和人工复核；当前 7x24 守护保持 dry-run/只读。",
            )
        )

    blockers = [row for row in rows if not row["ok"] and row["severity"] == "blocker"]
    warnings = [row for row in rows if not row["ok"] and row["severity"] == "warning"]
    status = "go" if not blockers else "no_go"
    payload = {
        "phase": phase,
        "status": status,
        "ok": status == "go",
        "blockers": blockers,
        "warnings": warnings,
        "checks": rows,
        "next_action": readiness_payload_data.get("next_action") or "review gate blockers",
        "readiness_status": readiness_payload_data.get("status"),
        "locks": locks,
        "generated_at": now_iso(),
    }
    return sanitize_for_log(payload)


def print_pre_live_gate(args: argparse.Namespace) -> None:
    payload = pre_live_gate_payload(args.phase)
    if args.json:
        print(json.dumps(payload, ensure_ascii=False, indent=2))
    else:
        print(f"pre-live gate: {payload['phase']} · {payload['status']} ({payload['generated_at']})")
        for row in payload.get("checks", []):
            marker = "OK" if row.get("ok") else "WARN" if row.get("severity") == "warning" else "BLOCK"
            print(f"{marker:5} {row.get('name')}: {row.get('detail')}")
        if payload.get("next_action"):
            print(f"next action: {payload.get('next_action')}")
    if payload.get("status") != "go" and not args.no_fail:
        raise SystemExit(1)


def load_watchdog_state() -> dict[str, Any]:
    if not WATCHDOG_STATE_FILE.exists():
        return {"alerts": {}}
    try:
        return json.loads(WATCHDOG_STATE_FILE.read_text(encoding="utf-8"))
    except Exception:
        return {"alerts": {}}


def save_watchdog_state(state: dict[str, Any]) -> None:
    ensure_dirs()
    tmp = WATCHDOG_STATE_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(WATCHDOG_STATE_FILE)


def notify(title: str, message: str) -> None:
    def esc(value: str) -> str:
        return value.replace("\\", "\\\\").replace('"', '\\"')

    script = f'display notification "{esc(message[:180])}" with title "{esc(title[:80])}"'
    subprocess.run(["/usr/bin/osascript", "-e", script], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def maybe_alert(payload: dict[str, Any]) -> None:
    issues = payload.get("critical", []) + payload.get("warnings", [])
    state = load_watchdog_state()
    alerts = state.setdefault("alerts", {})
    now = time.time()
    throttle_seconds = 15 * 60
    fresh_issues = []
    for issue in issues:
        key = issue.split(":", 1)[0]
        last = float(alerts.get(key, 0) or 0)
        if now - last >= throttle_seconds:
            alerts[key] = now
            fresh_issues.append(issue)
    if fresh_issues:
        title = "OKX Quant Watchdog"
        message = "; ".join(fresh_issues[:3])
        notify(title, message)
    stage_row = next((row for row in payload.get("checks", []) if row.get("name") == "automation_stage"), None)
    stage_data = (stage_row or {}).get("data") or {}
    stage = stage_data.get("stage")
    if stage and state.get("automation_stage") != stage:
        state["automation_stage"] = stage
        state["automation_stage_label"] = stage_data.get("label") or stage
        state["automation_stage_updated_at"] = now_iso()
        notify("OKX Quant Automation", f"{state['automation_stage_label']}: {stage_data.get('next_action') or '-'}")
    task_row = next((row for row in payload.get("checks", []) if row.get("name") == "automation_task_board"), None)
    task_data = (task_row or {}).get("data") or {}
    top_task_id = task_data.get("top_task_id")
    top_task_changed = bool(top_task_id and state.get("automation_top_task_id") != top_task_id)
    top_task_evidence_missing = bool(top_task_id and not state.get("automation_top_task_evidence_path"))
    if top_task_changed or top_task_evidence_missing:
        state["automation_top_task_id"] = top_task_id
        state["automation_top_task_title"] = task_data.get("top_task_title") or top_task_id
        state["automation_top_task_status"] = task_data.get("top_task_status")
        state["automation_top_task_updated_at"] = now_iso()
        action = task_data.get("top_task_command") or task_data.get("top_task_action") or "-"
        try:
            task_payload = sanitize_for_log(automation_task_board_payload())
            task_payload["watchdog_trigger"] = {
                "top_task_id": top_task_id,
                "top_task_title": state["automation_top_task_title"],
                "top_task_status": state["automation_top_task_status"],
                "recorded_at": state["automation_top_task_updated_at"],
            }
            written_path = write_evidence_payload(task_payload, "automation-task-board-watchdog")
            state["automation_top_task_evidence_path"] = str(written_path)
            state["automation_top_task_evidence_error"] = ""
        except Exception as exc:
            state["automation_top_task_evidence_error"] = str(exc)
            state["automation_top_task_evidence_error_at"] = now_iso()
            notify("OKX Quant Task Evidence", f"task-board evidence error: {str(exc)[:120]}")
        if top_task_changed:
            notify("OKX Quant Task", f"{state['automation_top_task_title']}: {action}")
    try:
        recorded = maybe_record_watchdog_readiness_snapshot(state, now=now, health_payload=payload)
        if recorded:
            state["readiness_snapshot_error"] = ""
    except Exception as exc:
        state["readiness_snapshot_error"] = str(exc)
        state["readiness_snapshot_error_at"] = now_iso()
    try:
        lock_summary = maybe_run_watchdog_live_lock_test(state, payload, now=now)
        if lock_summary:
            state["live_lock_test_error"] = "" if lock_summary.get("ok") else state.get("live_lock_test_error", "")
    except Exception as exc:
        state["live_lock_test_error"] = str(exc)
        state["live_lock_test_error_at"] = now_iso()
        notify("OKX Quant Live Lock", f"live-lock-test error: {str(exc)[:120]}")
    try:
        refresh_summary = maybe_run_watchdog_market_refresh(state, payload, now=now)
        if refresh_summary:
            state["market_refresh_error"] = "" if refresh_summary.get("ok") else state.get("market_refresh_error", "")
    except Exception as exc:
        state["market_refresh_error"] = str(exc)
        state["market_refresh_error_at"] = now_iso()
        notify("OKX Quant Data", f"market refresh error: {str(exc)[:120]}")
    save_watchdog_state(state)


def run_watchdog(_args: argparse.Namespace) -> None:
    ensure_dirs()
    print(f"{now_iso()} watchdog started", flush=True)
    while True:
        payload = collect_health()
        print(json.dumps(payload, ensure_ascii=False), flush=True)
        maybe_alert(payload)
        time.sleep(60)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Manage OKX Quant 24x7 launchd services.")
    sub = parser.add_subparsers(dest="command", required=True)

    def add_services(p: argparse.ArgumentParser) -> None:
        p.add_argument("services", nargs="*", help=f"services: {', '.join(DEFAULT_SERVICE_ORDER)}")

    p = sub.add_parser("install", help="write plists and bootstrap launchd services")
    add_services(p)
    p.add_argument("--no-start", action="store_true", help="only write plist files")
    p.set_defaults(func=install)

    p = sub.add_parser("uninstall", help="bootout launchd services and remove plists")
    add_services(p)
    p.add_argument("--keep-plists", action="store_true")
    p.set_defaults(func=uninstall)

    for command, fn in (("start", start), ("stop", stop), ("restart", restart), ("status", print_status)):
        p = sub.add_parser(command)
        add_services(p)
        p.set_defaults(func=fn)

    p = sub.add_parser("doctor", help="run local health checks")
    p.add_argument("--json", action="store_true")
    p.set_defaults(func=print_doctor)

    p = sub.add_parser("stage", help="show automation readiness stage and next blocker")
    p.add_argument("--json", action="store_true")
    p.set_defaults(func=print_stage)

    p = sub.add_parser("tasks", help="show automation task-board next actions")
    p.add_argument("--json", action="store_true")
    p.add_argument("--write", action="store_true", help="write task-board evidence JSON under .cache/launchd/evidence")
    p.set_defaults(func=print_tasks)

    p = sub.add_parser("readiness", help="show read-only live and manual Canary go/no-go evidence")
    p.add_argument("--json", action="store_true")
    p.add_argument("--record", action="store_true", help="append a sanitized readiness snapshot")
    p.add_argument("--source", default="manual", help="snapshot source label when --record is used")
    p.set_defaults(func=print_readiness)

    p = sub.add_parser("readiness-history", help="show recent sanitized readiness snapshots")
    p.add_argument("--json", action="store_true")
    p.add_argument("--limit", type=int, default=10)
    p.set_defaults(func=print_readiness_history)

    p = sub.add_parser("task-action", help="record an automation task action receipt")
    p.add_argument("task_id")
    p.add_argument("--action", default="acknowledged", choices=["acknowledged", "started", "done", "skipped", "noted"])
    p.add_argument("--status", help="optional receipt status; defaults to action")
    p.add_argument("--note", default="")
    p.add_argument("--json", action="store_true")
    p.set_defaults(func=record_task_action)

    p = sub.add_parser("live-lock-test", help="verify live-submit endpoint remains locked")
    p.add_argument("--confirmation", default="", help="optional confirmation phrase for negative-path testing")
    p.add_argument("--use-canary", action="store_true", help="exercise the canary payload branch without allowing network submission")
    p.add_argument("--intent-json", help="optional order_intent JSON object; omitted by default for the safest lock test")
    p.add_argument("--skip-readiness-record", action="store_true", help="do not append a readiness snapshot after a successful lock test")
    p.add_argument("--json", action="store_true")
    p.set_defaults(func=print_live_lock_test)

    p = sub.add_parser("secrets-status", help="show read-only Keychain credential presence")
    p.add_argument("--json", action="store_true")
    p.set_defaults(func=print_secrets_status)

    p = sub.add_parser("evidence-bundle", help="collect sanitized runtime, readiness, and live-lock evidence")
    p.add_argument("--json", action="store_true")
    p.add_argument("--write", action="store_true", help="write evidence JSON under .cache/launchd/evidence")
    p.add_argument("--limit", type=int, default=10, help="readiness snapshot rows to include")
    p.add_argument("--include-backtest", action="store_true", help="also run and embed recent portfolio backtest evidence")
    p.set_defaults(func=print_evidence_bundle)

    p = sub.add_parser("recent-backtest", help="run recent portfolio backtest and write operational evidence")
    p.add_argument("--json", action="store_true")
    p.add_argument("--write", action="store_true", help="write evidence JSON under .cache/launchd/evidence")
    p.add_argument("--history-hours", type=float, default=2160, help="portfolio window length; default 2160 hours")
    p.add_argument("--slice-hours", type=float, default=720, help="time-slice validation window; default 720 hours")
    p.add_argument("--symbols", help="comma-separated symbols; default BTC/ETH/SOL USDT swaps")
    p.add_argument("--online", action="store_true", help="allow backend to fetch fresh candles instead of offline cache mode")
    p.add_argument("--no-cache", action="store_true", help="ask backend not to prefer cached candle files")
    p.add_argument("--timeout", type=float, default=90, help="HTTP timeout per backtest request")
    p.set_defaults(func=print_recent_backtest)

    p = sub.add_parser("refresh-market-data", help="enqueue and poll public candle-cache refresh evidence")
    p.add_argument("--json", action="store_true")
    p.add_argument("--write", action="store_true", help="write evidence JSON under .cache/launchd/evidence")
    p.add_argument("--max-items", type=int, default=4, help="number of stale cache rows to refresh; max 12")
    p.add_argument("--all-stale", action="store_true", help="refresh stale rows even when not marked recommended")
    p.add_argument("--include-high-cost", action="store_true", help="explicitly include high-cost stale rows in this manual batch")
    p.add_argument("--timeout", type=float, default=120, help="seconds to wait for the background task")
    p.add_argument("--poll", type=float, default=2, help="task polling interval in seconds")
    p.set_defaults(func=print_market_data_refresh)

    p = sub.add_parser("pre-live-gate", help="run a strict GO/NO-GO gate for readonly, Canary, or live-submit readiness")
    p.add_argument("--phase", choices=PRE_LIVE_GATE_PHASES, default="readonly")
    p.add_argument("--json", action="store_true")
    p.add_argument("--no-fail", action="store_true", help="print NO-GO evidence without exiting nonzero")
    p.set_defaults(func=print_pre_live_gate)

    p = sub.add_parser("import-secrets", help="store OKX/AI4Trade credentials in macOS Keychain")
    p.add_argument("--from-env-file", help="read KEY=value pairs from a local env file")
    p.add_argument("--from-process-env", action="store_true", help="read credentials from current process environment")
    p.add_argument("--no-prompt", action="store_true", help="do not prompt for missing values")
    p.add_argument("--restart", action="store_true", help="restart backend/ai4trade/watchdog after importing secrets")
    p.add_argument("--verify", action="store_true", help="wait for backend and print post-import readiness evidence")
    p.add_argument("--skip-verify", action="store_true", help="skip automatic post-import readiness verification")
    p.set_defaults(func=import_secrets)

    p = sub.add_parser("run-service", help=argparse.SUPPRESS)
    p.add_argument("name")
    p.set_defaults(func=run_service)

    p = sub.add_parser("run-watchdog", help=argparse.SUPPRESS)
    p.set_defaults(func=run_watchdog)
    return parser


def main(argv: list[str] | None = None) -> None:
    parser = build_parser()
    args = parser.parse_args(argv)
    args.func(args)


if __name__ == "__main__":
    main()
