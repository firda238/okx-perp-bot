from __future__ import annotations

import copy
import hashlib
import json
import threading
import time
from typing import Any


class ResultCache:
    def __init__(self, *, ttl_seconds: int = 60, max_items: int = 64, version: int = 1) -> None:
        self.ttl_seconds = ttl_seconds
        self.max_items = max_items
        self.version = version
        self._rows: dict[str, tuple[float, dict[str, Any]]] = {}
        self._lock = threading.Lock()

    def get(self, params: dict[str, Any]) -> dict[str, Any] | None:
        if params.get("disable_result_cache"):
            return None
        key = self._key(params)
        now = time.time()
        with self._lock:
            cached = self._rows.get(key)
            if not cached:
                return None
            cached_at, result = cached
            if now - cached_at > self.ttl_seconds:
                self._rows.pop(key, None)
                return None
            self._rows[key] = (cached_at, result)
        return copy.deepcopy(result)

    def set(self, params: dict[str, Any], result: dict[str, Any]) -> None:
        if params.get("disable_result_cache"):
            return
        key = self._key(params)
        with self._lock:
            self._rows[key] = (time.time(), copy.deepcopy(result))
            overflow = len(self._rows) - self.max_items
            if overflow <= 0:
                return
            oldest = sorted(self._rows.items(), key=lambda item: item[1][0])
            for old_key, _ in oldest[:overflow]:
                self._rows.pop(old_key, None)

    def status(self) -> dict[str, int]:
        with self._lock:
            items = len(self._rows)
        return {
            "items": items,
            "max_items": self.max_items,
            "ttl_seconds": self.ttl_seconds,
        }

    def _key(self, params: dict[str, Any]) -> str:
        payload = {"version": self.version, "params": params}
        encoded = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False, default=str).encode("utf-8")
        return hashlib.sha256(encoded).hexdigest()
