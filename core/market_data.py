from __future__ import annotations

import http.client
import json
import socket
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


OKX_BASE_URL = "https://www.okx.com"
PROXY_OPENER = urllib.request.build_opener()
DIRECT_OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))
CANDLE_CACHE_TTL_SECONDS = 900

BAR_MS = {
    "1m": 60_000,
    "3m": 3 * 60_000,
    "5m": 5 * 60_000,
    "15m": 15 * 60_000,
    "30m": 30 * 60_000,
    "1H": 60 * 60_000,
    "2H": 2 * 60 * 60_000,
    "4H": 4 * 60 * 60_000,
    "6H": 6 * 60 * 60_000,
    "12H": 12 * 60 * 60_000,
    "1D": 24 * 60 * 60_000,
}


class MarketDataStore:
    def __init__(self, cache_dir: Path) -> None:
        self.cache_dir = cache_dir
        self._candle_cache: dict[tuple[str, str, int], tuple[float, list[dict[str, Any]]]] = {}
        self._last_candle_fetch: dict[tuple[str, str, int], dict[str, Any]] = {}
        self._lock = threading.Lock()
        self.cache_dir.mkdir(exist_ok=True)

    def fetch_candles(self, inst_id: str, bar: str, limit: int = 300) -> list[dict[str, Any]]:
        raw = okx_get(
            "/api/v5/market/candles",
            {"instId": inst_id, "bar": bar, "limit": max(1, min(limit, 300))},
        )
        candles = parse_candles(raw)
        candles.reverse()
        return candles

    def last_candle_fetch(self, inst_id: str, bar: str, count: int) -> dict[str, Any] | None:
        with self._lock:
            meta = self._last_candle_fetch.get((inst_id, bar, count))
        return dict(meta) if meta else None

    def candle_cache_file(self, inst_id: str, bar: str, count: int) -> Path:
        safe_inst_id = inst_id.replace("/", "_")
        safe_bar = bar.replace("/", "_")
        return self.cache_dir / f"{safe_inst_id}-{safe_bar}-{count}.json"

    def covering_candle_cache_files(self, inst_id: str, bar: str, count: int) -> list[tuple[int, Path]]:
        safe_inst_id = inst_id.replace("/", "_")
        safe_bar = bar.replace("/", "_")
        prefix = f"{safe_inst_id}-{safe_bar}-"
        candidates: list[tuple[int, Path]] = []
        for candidate in self.cache_dir.glob(f"{prefix}*.json"):
            count_text = candidate.stem.removeprefix(prefix)
            if count_text.isdigit() and int(count_text) >= count:
                candidates.append((int(count_text), candidate))
        return sorted(candidates, key=lambda item: item[0])

    def read_candle_file(self, path: Path, count: int) -> tuple[list[dict[str, Any]], float]:
        cache_updated_at = path.stat().st_mtime
        candles = json.loads(path.read_text(encoding="utf-8"))[-count:]
        return candles, cache_updated_at

    def read_covering_candle_cache(
        self,
        inst_id: str,
        bar: str,
        count: int,
        *,
        allow_stale: bool = False,
        skip_path: Path | None = None,
    ) -> tuple[list[dict[str, Any]], Path, int, bool, float] | None:
        for cover_count, candidate in self.covering_candle_cache_files(inst_id, bar, count):
            if skip_path is not None and candidate == skip_path:
                continue
            candles, cache_updated_at = self.read_candle_file(candidate, count)
            is_stale = candle_cache_is_stale(candles, bar, cache_updated_at)
            if allow_stale or not is_stale:
                return candles, candidate, cover_count, is_stale, cache_updated_at
        return None

    def read_candle_cache(self, inst_id: str, bar: str, count: int, allow_stale: bool = False) -> list[dict[str, Any]] | None:
        key = (inst_id, bar, count)
        with self._lock:
            cached = self._candle_cache.get(key)
        if cached:
            cached_at, candles = cached
            is_stale = candle_cache_is_stale(candles, bar, cached_at)
            if allow_stale or not is_stale:
                self.record_candle_fetch(inst_id, bar, count, "stale-memory-cache" if is_stale else "memory-cache", candles)
                return candles

        path = self.candle_cache_file(inst_id, bar, count)
        source = "disk-cache"
        cover_count = count
        if path.exists():
            candles, cache_updated_at = self.read_candle_file(path, count)
            is_stale = candle_cache_is_stale(candles, bar, cache_updated_at)
            if is_stale and not allow_stale:
                covered = self.read_covering_candle_cache(inst_id, bar, count, skip_path=path)
                if covered is None:
                    return None
                candles, path, cover_count, is_stale, cache_updated_at = covered
                source = "covered-disk-cache"
        else:
            covered = self.read_covering_candle_cache(inst_id, bar, count, allow_stale=allow_stale)
            if covered is None:
                return None
            candles, path, cover_count, is_stale, cache_updated_at = covered
            source = "covered-disk-cache" if cover_count > count else "disk-cache"
        if not allow_stale and is_stale:
            return None
        source = "stale-disk-cache" if is_stale else "disk-cache"
        if not is_stale and cover_count > count:
            source = "covered-disk-cache"
        with self._lock:
            self._candle_cache[key] = (cache_updated_at, candles)
        self.record_candle_fetch(
            inst_id,
            bar,
            count,
            source,
            candles,
            cache_file=path,
            cache_updated_at=cache_updated_at,
            cover_count=cover_count if cover_count > count else None,
        )
        return candles

    def write_candle_cache(self, inst_id: str, bar: str, count: int, candles: list[dict[str, Any]]) -> None:
        key = (inst_id, bar, count)
        path = self.candle_cache_file(inst_id, bar, count)
        with self._lock:
            self._candle_cache[key] = (time.time(), candles)
        path.write_text(json.dumps(candles, ensure_ascii=False), encoding="utf-8")
        self.record_candle_fetch(inst_id, bar, count, "okx-live", candles, cache_file=path, cache_updated_at=path.stat().st_mtime)

    def delete_candle_cache(self, inst_id: str, bar: str, count: int) -> dict[str, Any]:
        key = (inst_id, bar, count)
        path = self.candle_cache_file(inst_id, bar, count)
        if not path.resolve().is_relative_to(self.cache_dir.resolve()):
            raise ValueError("cache path escapes cache dir")
        size_bytes = path.stat().st_size if path.exists() else 0
        if path.exists():
            path.unlink()
        with self._lock:
            self._candle_cache.pop(key, None)
            self._last_candle_fetch.pop(key, None)
        return {"path": str(path), "size_bytes": size_bytes, "deleted": True}

    def fetch_historical_candles(
        self,
        inst_id: str,
        bar: str,
        count: int,
        *,
        prefer_cache: bool = False,
        offline_mode: bool = False,
    ) -> list[dict[str, Any]]:
        if offline_mode:
            stale = self.read_candle_cache(inst_id, bar, count, allow_stale=True)
            if stale is not None:
                return stale
            raise RuntimeError(f"No cached candles for {inst_id} {bar} count={count}. Run data warmup first.")

        if prefer_cache:
            cached = self.read_candle_cache(inst_id, bar, count)
            if cached is not None:
                return cached

        if count <= 300:
            try:
                candles = self.fetch_candles(inst_id, bar, count)
                self.write_candle_cache(inst_id, bar, count, candles)
                return candles
            except Exception:
                stale = self.read_candle_cache(inst_id, bar, count, allow_stale=True)
                if stale is not None:
                    self.record_candle_fetch(inst_id, bar, count, "okx-error-stale-cache", stale, error="live fetch failed")
                    return stale
                raise

        try:
            collected = self.fetch_candles(inst_id, bar, 300)
            seen = {candle["ts"] for candle in collected}
            oldest_ts = min(seen) if seen else None

            while len(collected) < count and oldest_ts is not None:
                raw = okx_get(
                    "/api/v5/market/history-candles",
                    {"instId": inst_id, "bar": bar, "limit": 100, "after": oldest_ts},
                )
                batch = parse_candles(raw)
                if not batch:
                    break
                new_items = [candle for candle in batch if candle["ts"] not in seen]
                if not new_items:
                    break
                collected.extend(new_items)
                seen.update(candle["ts"] for candle in new_items)
                oldest_ts = min(candle["ts"] for candle in new_items)
                time.sleep(0.12)

            candles = dedupe_sort_candles(collected)[-count:]
            self.write_candle_cache(inst_id, bar, count, candles)
            return candles
        except Exception:
            stale = self.read_candle_cache(inst_id, bar, count, allow_stale=True)
            if stale is not None:
                self.record_candle_fetch(inst_id, bar, count, "okx-error-stale-cache", stale, error="live fetch failed")
                return stale
            raise

    def record_candle_fetch(
        self,
        inst_id: str,
        bar: str,
        count: int,
        source: str,
        candles: list[dict[str, Any]],
        *,
        cache_file: Path | None = None,
        cache_updated_at: float | None = None,
        cover_count: int | None = None,
        error: str | None = None,
    ) -> None:
        meta = {
            "inst_id": inst_id,
            "bar": bar,
            "count": count,
            "source": source,
            "fetched_at": datetime.now(timezone.utc).isoformat(),
            "cache_file": str(cache_file) if cache_file else None,
            "cache_updated_at": datetime.fromtimestamp(cache_updated_at, tz=timezone.utc).isoformat() if cache_updated_at else None,
            "cover_count": cover_count,
            "error": error,
            **candle_freshness(candles, bar),
        }
        with self._lock:
            self._last_candle_fetch[(inst_id, bar, count)] = meta

    def status(self, limit: int = 100) -> dict[str, Any]:
        rows = []
        for path in sorted(self.cache_dir.glob("*.json"), key=lambda item: item.stat().st_mtime, reverse=True):
            parts = path.stem.rsplit("-", 2)
            if len(parts) != 3:
                continue
            inst_id, bar, count_text = parts
            try:
                candles = json.loads(path.read_text(encoding="utf-8"))
                first = candles[0]["time"] if candles else None
                last = candles[-1]["time"] if candles else None
                freshness = candle_freshness(candles, bar)
            except Exception:
                candles = []
                first = None
                last = None
                freshness = {"latest_closed": None, "latest_closed_age_seconds": None, "is_stale": True}
            rows.append(
                {
                    "inst_id": inst_id,
                    "bar": bar,
                    "count": int(count_text) if count_text.isdigit() else count_text,
                    "candles": len(candles),
                    "first": first,
                    "last": last,
                    "latest_closed": freshness.get("latest_closed"),
                    "latest_closed_age_seconds": freshness.get("latest_closed_age_seconds"),
                    "stale_after_seconds": freshness.get("stale_after_seconds"),
                    "is_stale": freshness.get("is_stale"),
                    "updated_at": datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc).isoformat(),
                    "size_bytes": path.stat().st_size,
                }
            )
        annotate_cache_coverage(rows)
        return {"cache_dir": str(self.cache_dir), "files": len(rows), "rows": rows[:limit]}


def utc_ms_to_iso(ts_ms: int) -> str:
    return datetime.fromtimestamp(ts_ms / 1000, tz=timezone.utc).isoformat()


def okx_get(path: str, params: dict[str, Any]) -> dict[str, Any]:
    query = urllib.parse.urlencode(params)
    url = f"{OKX_BASE_URL}{path}?{query}"
    req = urllib.request.Request(url, headers={"User-Agent": "okx-perp-bot/0.1"})
    last_error: Exception | None = None
    for opener in [PROXY_OPENER, DIRECT_OPENER]:
        for attempt in range(3):
            try:
                with opener.open(req, timeout=20) as response:
                    return json.loads(response.read().decode("utf-8"))
            except (urllib.error.URLError, TimeoutError, socket.timeout, http.client.IncompleteRead, http.client.RemoteDisconnected) as exc:
                last_error = exc
                if attempt < 2:
                    time.sleep(0.8 * (attempt + 1))
                    continue
                break
    raise RuntimeError(f"OKX request failed after retries: {last_error}")


def parse_candles(raw: dict[str, Any]) -> list[dict[str, Any]]:
    if raw.get("code") != "0":
        raise RuntimeError(raw.get("msg") or "OKX returned an error")

    candles = []
    for row in raw.get("data", []):
        candles.append(
            {
                "ts": int(row[0]),
                "time": utc_ms_to_iso(int(row[0])),
                "open": float(row[1]),
                "high": float(row[2]),
                "low": float(row[3]),
                "close": float(row[4]),
                "volume": float(row[5]),
                "confirm": row[8] == "1",
            }
        )
    return candles


def bar_to_ms(bar: str) -> int:
    if bar not in BAR_MS:
        raise ValueError(f"Unsupported bar: {bar}")
    return BAR_MS[bar]


def candle_freshness(candles: list[dict[str, Any]], bar: str) -> dict[str, Any]:
    now_ms = int(time.time() * 1000)
    latest = candles[-1] if candles else None
    closed = [candle for candle in candles if candle.get("confirm")]
    latest_closed = closed[-1] if closed else latest
    closed_end_ms = latest_closed["ts"] + bar_to_ms(bar) if latest_closed else None
    age_seconds = max(0, (now_ms - closed_end_ms) / 1000) if closed_end_ms is not None else None
    stale_after_seconds = max(15 * 60, 2 * bar_to_ms(bar) / 1000)
    return {
        "first": candles[0]["time"] if candles else None,
        "last": latest["time"] if latest else None,
        "last_confirm": latest.get("confirm") if latest else None,
        "latest_closed": latest_closed["time"] if latest_closed else None,
        "latest_closed_age_seconds": age_seconds,
        "stale_after_seconds": stale_after_seconds,
        "is_stale": age_seconds is None or age_seconds > stale_after_seconds,
    }


def candle_cache_is_stale(candles: list[dict[str, Any]], bar: str, cached_at: float | None = None) -> bool:
    freshness = candle_freshness(candles, bar)
    if freshness.get("is_stale"):
        return True
    if cached_at is None:
        return False
    return time.time() - cached_at > max(CANDLE_CACHE_TTL_SECONDS, 12 * 60 * 60, 24 * bar_to_ms(bar) / 1000)


def annotate_cache_coverage(rows: list[dict[str, Any]]) -> None:
    fresh_by_market: dict[tuple[str, str], list[dict[str, Any]]] = {}
    for row in rows:
        if not row.get("is_stale"):
            fresh_by_market.setdefault((str(row.get("inst_id")), str(row.get("bar"))), []).append(row)
    for candidates in fresh_by_market.values():
        candidates.sort(key=lambda item: int(item.get("count") or item.get("candles") or 0))

    for row in rows:
        row["covered_by_fresh_cache"] = False
        row["covered_by_count"] = None
        row["coverage_note"] = None
        if not row.get("is_stale"):
            continue
        count = int(row.get("count") or row.get("candles") or 0)
        candidates = fresh_by_market.get((str(row.get("inst_id")), str(row.get("bar"))), [])
        cover = next((candidate for candidate in candidates if int(candidate.get("count") or candidate.get("candles") or 0) >= count), None)
        if cover:
            row["covered_by_fresh_cache"] = True
            row["covered_by_count"] = cover.get("count")
            row["coverage_note"] = f"可由 {cover.get('count')} 根新鲜缓存切片"


def needed_candle_count(bar: str, history_hours: float, warmup_candles: int) -> int:
    window = int(history_hours * 60 * 60 * 1000 / bar_to_ms(bar)) + 2
    return max(window + warmup_candles, warmup_candles + 2)


def dedupe_sort_candles(candles: list[dict[str, Any]]) -> list[dict[str, Any]]:
    by_ts = {candle["ts"]: candle for candle in candles}
    return [by_ts[ts] for ts in sorted(by_ts)]
