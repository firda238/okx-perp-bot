from __future__ import annotations

from typing import Any


def ema(values: list[float], period: int) -> list[float | None]:
    if period <= 1:
        return values[:]
    result: list[float | None] = [None] * len(values)
    if len(values) < period:
        return result
    seed = sum(values[:period]) / period
    result[period - 1] = seed
    multiplier = 2 / (period + 1)
    last = seed
    for i in range(period, len(values)):
        last = values[i] * multiplier + last * (1 - multiplier)
        result[i] = last
    return result


def rolling_average(values: list[float], period: int) -> list[float | None]:
    result: list[float | None] = [None] * len(values)
    if period <= 1:
        return values[:]
    total = 0.0
    for i, value in enumerate(values):
        total += value
        if i >= period:
            total -= values[i - period]
        if i >= period - 1:
            result[i] = total / period
    return result


def enrich_candles(candles: list[dict[str, Any]], params: dict[str, Any]) -> list[dict[str, Any]]:
    atr_period = int(params.get("atr_period", 14))
    adx_period = int(params.get("adx_period", 14))
    volume_period = int(params.get("volume_period", 20))
    closes = [c["close"] for c in candles]
    highs = [c["high"] for c in candles]
    lows = [c["low"] for c in candles]

    true_ranges: list[float] = []
    plus_dm: list[float] = []
    minus_dm: list[float] = []
    for i, candle in enumerate(candles):
        if i == 0:
            true_ranges.append(candle["high"] - candle["low"])
            plus_dm.append(0)
            minus_dm.append(0)
            continue
        high_move = highs[i] - highs[i - 1]
        low_move = lows[i - 1] - lows[i]
        true_ranges.append(max(highs[i] - lows[i], abs(highs[i] - closes[i - 1]), abs(lows[i] - closes[i - 1])))
        plus_dm.append(high_move if high_move > low_move and high_move > 0 else 0)
        minus_dm.append(low_move if low_move > high_move and low_move > 0 else 0)

    atr_values = rolling_average(true_ranges, atr_period)
    plus_di = [None] * len(candles)
    minus_di = [None] * len(candles)
    dx = [None] * len(candles)
    plus_dm_avg = rolling_average(plus_dm, adx_period)
    minus_dm_avg = rolling_average(minus_dm, adx_period)
    atr_for_adx = rolling_average(true_ranges, adx_period)
    for i in range(len(candles)):
        if atr_for_adx[i] and atr_for_adx[i] > 0 and plus_dm_avg[i] is not None and minus_dm_avg[i] is not None:
            plus_di[i] = 100 * plus_dm_avg[i] / atr_for_adx[i]
            minus_di[i] = 100 * minus_dm_avg[i] / atr_for_adx[i]
            total = plus_di[i] + minus_di[i]
            dx[i] = 100 * abs(plus_di[i] - minus_di[i]) / total if total else 0

    numeric_dx = [0 if value is None else value for value in dx]
    adx_values = rolling_average(numeric_dx, adx_period)
    volume_ma = rolling_average([c["volume"] for c in candles], volume_period)

    enriched = []
    for i, candle in enumerate(candles):
        enriched.append(
            {
                **candle,
                "atr": atr_values[i],
                "adx": adx_values[i],
                "volume_ma": volume_ma[i],
            }
        )
    return enriched


def build_trend_context(candles: list[dict[str, Any]], params: dict[str, Any]) -> dict[int, str]:
    fast_period = int(params.get("trend_fast", 50))
    slow_period = int(params.get("trend_slow", 120))
    closes = [c["close"] for c in candles]
    fast = ema(closes, fast_period)
    slow = ema(closes, slow_period)
    trend_by_ts: dict[int, str] = {}
    last = "neutral"
    for i, candle in enumerate(candles):
        if fast[i] is not None and slow[i] is not None:
            if fast[i] > slow[i] and candle["close"] > fast[i]:
                last = "long"
            elif fast[i] < slow[i] and candle["close"] < fast[i]:
                last = "short"
            else:
                last = "neutral"
        trend_by_ts[candle["ts"]] = last
    return trend_by_ts


def trend_for_ts(trend_by_ts: dict[int, str], ts: int) -> str:
    trend = "neutral"
    for trend_ts in sorted(trend_by_ts):
        if trend_ts <= ts:
            trend = trend_by_ts[trend_ts]
        else:
            break
    return trend


def highest(candles: list[dict[str, Any]], start: int, end: int) -> float:
    return max(c["high"] for c in candles[start:end])


def lowest(candles: list[dict[str, Any]], start: int, end: int) -> float:
    return min(c["low"] for c in candles[start:end])


def market_regime(candle: dict[str, Any], params: dict[str, Any]) -> str:
    adx = candle.get("adx")
    atr = candle.get("atr")
    if adx is None or atr is None or atr <= 0:
        return "unknown"
    trend_adx = float(params.get("trend_adx", 24))
    range_adx = float(params.get("range_adx", 18))
    if adx >= trend_adx:
        return "trend"
    if adx <= range_adx:
        return "range"
    return "chaos"


def candle_body_ratio(candle: dict[str, Any]) -> float:
    span = max(candle["high"] - candle["low"], 1e-9)
    return abs(candle["close"] - candle["open"]) / span


def close_location(candle: dict[str, Any]) -> float:
    span = max(candle["high"] - candle["low"], 1e-9)
    return (candle["close"] - candle["low"]) / span
