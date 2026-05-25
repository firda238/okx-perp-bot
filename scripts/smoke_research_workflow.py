#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path
import sys


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app import list_research_snapshots, save_research_snapshot, strategy_health


def assert_true(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def main() -> None:
    summary = {
        "initial_equity": 10.0,
        "final_equity": 12.4,
        "return_pct": 0.24,
        "max_drawdown": 0.08,
        "trades": 4,
        "win_rate": 0.5,
        "profit_factor": 1.8,
        "expectancy": 0.6,
        "max_consecutive_losses": 2,
    }
    trades = [
        {"pnl": 1.2, "side": "long"},
        {"pnl": -0.5, "side": "short"},
        {"pnl": 1.0, "side": "long"},
        {"pnl": -0.3, "side": "short"},
    ]
    by_symbol = [{"inst_id": "BTC-USDT-SWAP", "pnl": 1.4, "trades": 4}]

    health = strategy_health(summary, trades, by_symbol)
    assert_true(0 <= health["score"] <= 100, "health score must stay within 0..100")
    assert_true(health["grade"] in {"A", "B", "C", "D"}, "health grade must be normalized")

    saved_path: Path | None = None
    try:
        saved = save_research_snapshot(
            {
                "snapshot_mode": "quick",
                "snapshot_label": "smoke-research-workflow",
                "instId": "BTC-USDT-SWAP",
                "bar": "15m",
                "history_hours": 24,
                "initial_equity": 10,
                "provided_portfolio": {
                    "summary": summary,
                    "trades": trades,
                    "by_symbol": by_symbol,
                    "equity_curve": [],
                },
            }
        )
        saved_path = Path(saved["path"])
        assert_true(saved.get("ok") is True, "quick snapshot save should return ok")
        assert_true(saved["summary"].get("health_score") is not None, "quick snapshot result should include health")

        listed = list_research_snapshots(5)
        row = next((item for item in listed.get("rows", []) if item.get("file") == saved_path.name), None)
        assert_true(row is not None, "saved snapshot should appear in the research snapshot list")
        assert_true(row.get("health_score") is not None, "snapshot list should expose health score")
        assert_true(row.get("mode") == "quick", "snapshot list should preserve quick mode")

        print("research workflow smoke ok")
    finally:
        if saved_path and saved_path.exists():
            saved_path.unlink()


if __name__ == "__main__":
    main()
