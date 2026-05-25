from __future__ import annotations

from typing import Any

from core.indicators import (
    candle_body_ratio,
    close_location,
    highest,
    lowest,
    market_regime,
)


def is_bull_signal_bar(candle: dict[str, Any], min_body_ratio: float) -> bool:
    return candle["close"] > candle["open"] and candle_body_ratio(candle) >= min_body_ratio and close_location(candle) >= 0.62


def is_bear_signal_bar(candle: dict[str, Any], min_body_ratio: float) -> bool:
    return candle["close"] < candle["open"] and candle_body_ratio(candle) >= min_body_ratio and close_location(candle) <= 0.38


def counter_trend_pullback_count(candles: list[dict[str, Any]], i: int, side: str, max_bars: int = 6) -> int:
    count = 0
    for j in range(i - 1, max(i - max_bars - 1, -1), -1):
        candle = candles[j]
        if side == "long":
            is_pullback = candle["close"] < candle["open"] or candle["close"] < candles[j - 1]["close"]
        else:
            is_pullback = candle["close"] > candle["open"] or candle["close"] > candles[j - 1]["close"]
        if not is_pullback:
            break
        count += 1
    return count


def recent_swing_lows(candles: list[dict[str, Any]], start: int, end: int) -> list[float]:
    lows = []
    for j in range(max(start + 1, 1), min(end - 1, len(candles) - 1)):
        if candles[j]["low"] < candles[j - 1]["low"] and candles[j]["low"] <= candles[j + 1]["low"]:
            lows.append(candles[j]["low"])
    return lows


def recent_swing_highs(candles: list[dict[str, Any]], start: int, end: int) -> list[float]:
    highs = []
    for j in range(max(start + 1, 1), min(end - 1, len(candles) - 1)):
        if candles[j]["high"] > candles[j - 1]["high"] and candles[j]["high"] >= candles[j + 1]["high"]:
            highs.append(candles[j]["high"])
    return highs


def make_price_action_signal(
    side: str,
    kind: str,
    cur: dict[str, Any],
    risk: float,
    take_profit_rr: float,
    level: float,
    trend: str,
    regime: str,
    atr: float,
) -> dict[str, Any]:
    if side == "long":
        stop = cur["close"] - risk
        take_profit = cur["close"] + risk * take_profit_rr
    else:
        stop = cur["close"] + risk
        take_profit = cur["close"] - risk * take_profit_rr
    return {
        "side": side,
        "kind": kind,
        "entry": cur["close"],
        "stop": stop,
        "take_profit": take_profit,
        "level": level,
        "trend": trend,
        "regime": regime,
        "atr": atr,
        "adx": cur.get("adx"),
    }


def louie_price_action_signal(
    candles: list[dict[str, Any]],
    i: int,
    params: dict[str, Any],
    trend: str,
    prior_high: float,
    prior_low: float,
    atr: float,
    regime: str,
) -> dict[str, Any] | None:
    cur = candles[i]
    prev = candles[i - 1]
    lookback = int(params.get("lookback", 24))
    min_body_ratio = float(params.get("min_body_ratio", 0.45))
    take_profit_rr = float(params.get("take_profit_rr", 1.8))
    atr_stop_mult = float(params.get("atr_stop_mult", 1.4))
    min_breakout_atr = float(params.get("min_breakout_atr", 0.25))
    min_sweep_atr = float(params.get("min_sweep_atr", 0.35))
    max_risk_atr = float(params.get("max_risk_atr", 3.0))
    retest_tolerance = float(params.get("retest_tolerance", 0.0015))
    surprise_atr = float(params.get("surprise_atr", 1.15))
    surprise_volume_mult = float(params.get("surprise_volume_mult", 1.15))
    max_surprise_prior_run_atr = float(params.get("max_surprise_prior_run_atr", 3.2))
    trade_trend_regime = bool(params.get("trade_louie_trend_regime", True))
    trade_breakout_tests = bool(params.get("trade_louie_breakout_tests", True))
    trade_delayed_sweeps = bool(params.get("trade_louie_delayed_sweeps", True))
    min_breakout_adx = float(params.get("min_louie_breakout_adx", 32))

    def capped_signal(side: str, kind: str, structural_risk: float, level: float) -> dict[str, Any] | None:
        risk = max(structural_risk, atr * atr_stop_mult, cur["close"] * 0.002)
        if risk > atr * max_risk_atr:
            return None
        return make_price_action_signal(side, kind, cur, risk, take_profit_rr, level, trend, regime, atr)

    long_signal = is_bull_signal_bar(cur, min_body_ratio)
    short_signal = is_bear_signal_bar(cur, min_body_ratio)

    # Trend pullback continuation: count a short pullback, then require a signal bar through the prior bar.
    if trade_trend_regime and trend == "long" and regime == "trend" and long_signal:
        pullback_bars = counter_trend_pullback_count(candles, i, "long")
        recent_trigger = max(c["high"] for c in candles[max(0, i - 4) : i])
        volume_ok = cur.get("volume_ma") is None or cur["volume"] >= cur["volume_ma"] * 0.9
        if 2 <= pullback_bars <= 6 and cur["close"] > recent_trigger and volume_ok:
            pullback_low = min(c["low"] for c in candles[i - pullback_bars : i + 1])
            return capped_signal("long", "louie_pullback_signal_bar", cur["close"] - pullback_low, recent_trigger)

    if trade_trend_regime and trend == "short" and regime == "trend" and short_signal:
        pullback_bars = counter_trend_pullback_count(candles, i, "short")
        recent_trigger = min(c["low"] for c in candles[max(0, i - 4) : i])
        volume_ok = cur.get("volume_ma") is None or cur["volume"] >= cur["volume_ma"] * 0.9
        if 2 <= pullback_bars <= 6 and cur["close"] < recent_trigger and volume_ok:
            pullback_high = max(c["high"] for c in candles[i - pullback_bars : i + 1])
            return capped_signal("short", "louie_pullback_signal_bar", pullback_high - cur["close"], recent_trigger)

    # Breakout test: previous close breaks structure, current bar retests the level and closes back in breakout direction.
    broke_up = prev["close"] > prior_high and prev["close"] - prior_high >= atr * min_breakout_atr
    breakout_quality_ok = cur.get("adx") is not None and cur["adx"] >= min_breakout_adx
    if trade_breakout_tests and breakout_quality_ok and broke_up and cur["low"] <= prior_high * (1 + retest_tolerance) and long_signal and cur["close"] > prior_high:
        structural_risk = cur["close"] - min(cur["low"], prior_high * (1 - retest_tolerance))
        return capped_signal("long", "louie_breakout_test", structural_risk, prior_high)

    broke_down = prev["close"] < prior_low and prior_low - prev["close"] >= atr * min_breakout_atr
    if trade_breakout_tests and breakout_quality_ok and broke_down and cur["high"] >= prior_low * (1 - retest_tolerance) and short_signal and cur["close"] < prior_low:
        structural_risk = max(cur["high"], prior_low * (1 + retest_tolerance)) - cur["close"]
        return capped_signal("short", "louie_breakout_test", structural_risk, prior_low)

    # Surprise bar: unusually strong directional candle that also breaks recent structure or agrees with trend.
    candle_range = cur["high"] - cur["low"]
    surprise_volume_ok = cur.get("volume_ma") is None or cur["volume"] >= cur["volume_ma"] * surprise_volume_mult
    if trade_trend_regime and regime == "trend" and surprise_volume_ok and candle_range >= atr * surprise_atr and candle_body_ratio(cur) >= max(min_body_ratio, 0.58):
        if long_signal and cur["close"] > prior_high:
            prior_run = (cur["close"] - candles[max(0, i - 8)]["close"]) / atr
            if prior_run <= max_surprise_prior_run_atr:
                signal = capped_signal("long", "louie_surprise_bar", cur["close"] - cur["low"], cur["high"])
                return {**signal, "prior_run_atr": prior_run} if signal else None
        if short_signal and cur["close"] < prior_low:
            prior_run = (candles[max(0, i - 8)]["close"] - cur["close"]) / atr
            if prior_run <= max_surprise_prior_run_atr:
                signal = capped_signal("short", "louie_surprise_bar", cur["high"] - cur["close"], cur["low"])
                return {**signal, "prior_run_atr": prior_run} if signal else None

    # Sweep reversal: wait for liquidity sweep through the range extreme, then require a strong opposite close.
    if trend == "neutral" and regime != "trend":
        swept_low = cur["low"] < prior_low and cur["close"] > prior_low and prior_low - cur["low"] >= atr * min_sweep_atr
        if swept_low and long_signal:
            return capped_signal("long", "louie_sweep_reversal", cur["close"] - cur["low"], prior_low)

        swept_high = cur["high"] > prior_high and cur["close"] < prior_high and cur["high"] - prior_high >= atr * min_sweep_atr
        if swept_high and short_signal:
            return capped_signal("short", "louie_sweep_reversal", cur["high"] - cur["close"], prior_high)

    # Delayed sweep reversal: the sweep happens first, then the next bar reclaims/rejects the level.
    if trade_delayed_sweeps and trend == "neutral" and regime != "trend":
        prev_swept_low = prev["low"] < prior_low and prior_low - prev["low"] >= atr * min_sweep_atr
        if prev_swept_low and long_signal and cur["close"] > prior_low and cur["low"] > prev["low"]:
            return capped_signal("long", "louie_delayed_sweep_reversal", cur["close"] - min(prev["low"], cur["low"]), prior_low)

        prev_swept_high = prev["high"] > prior_high and prev["high"] - prior_high >= atr * min_sweep_atr
        if prev_swept_high and short_signal and cur["close"] < prior_high and cur["high"] < prev["high"]:
            return capped_signal("short", "louie_delayed_sweep_reversal", max(prev["high"], cur["high"]) - cur["close"], prior_high)

    # Wedge reversal: three pushes into a level, followed by a strong opposite signal bar after a sweep.
    swing_start = max(0, i - lookback - 4)
    lows = recent_swing_lows(candles, swing_start, i + 1)
    highs = recent_swing_highs(candles, swing_start, i + 1)
    if trend == "neutral" and regime != "trend" and len(lows) >= 3:
        last_lows = lows[-3:]
        three_pushes_down = last_lows[0] > last_lows[1] > last_lows[2]
        swept_low = cur["low"] < min(last_lows[:-1]) and min(last_lows[:-1]) - cur["low"] >= atr * min_sweep_atr
        if three_pushes_down and swept_low and long_signal:
            return capped_signal("long", "louie_wedge_reversal", cur["close"] - cur["low"], cur["high"])

    if trend == "neutral" and regime != "trend" and len(highs) >= 3:
        last_highs = highs[-3:]
        three_pushes_up = last_highs[0] < last_highs[1] < last_highs[2]
        swept_high = cur["high"] > max(last_highs[:-1]) and cur["high"] - max(last_highs[:-1]) >= atr * min_sweep_atr
        if three_pushes_up and swept_high and short_signal:
            return capped_signal("short", "louie_wedge_reversal", cur["high"] - cur["close"], cur["low"])

    return None


def trend_breakout_signal(
    candles: list[dict[str, Any]],
    i: int,
    params: dict[str, Any],
    trend: str,
    prior_high: float,
    prior_low: float,
    atr: float,
    regime: str,
) -> dict[str, Any] | None:
    cur = candles[i]
    prev = candles[i - 1]
    min_body_ratio = float(params.get("trend_min_body_ratio", max(0.55, float(params.get("min_body_ratio", 0.45)))))
    take_profit_rr = float(params.get("take_profit_rr", 2.4))
    atr_stop_mult = float(params.get("atr_stop_mult", 1.8))
    min_breakout_atr = float(params.get("min_breakout_atr", 0.20))
    max_risk_atr = float(params.get("max_risk_atr", 3.0))
    min_adx = float(params.get("trend_breakout_adx", max(36, float(params.get("min_adx", 18)))))
    if trend not in {"long", "short"} or regime != "trend" or (cur.get("adx") or 0) < min_adx:
        return None

    def capped(side: str, structural_risk: float, level: float) -> dict[str, Any] | None:
        risk = max(structural_risk, atr * atr_stop_mult, cur["close"] * 0.002)
        if risk > atr * max_risk_atr:
            return None
        return make_price_action_signal(side, "trend_donchian_breakout", cur, risk, take_profit_rr, level, trend, regime, atr)

    if trend == "long":
        fresh_break = prev["close"] <= prior_high and cur["close"] > prior_high
        size_ok = cur["close"] - prior_high >= atr * min_breakout_atr
        if fresh_break and size_ok and is_bull_signal_bar(cur, min_body_ratio):
            structural_risk = cur["close"] - min(cur["low"], prior_high)
            return capped("long", structural_risk, prior_high)
    else:
        fresh_break = prev["close"] >= prior_low and cur["close"] < prior_low
        size_ok = prior_low - cur["close"] >= atr * min_breakout_atr
        if fresh_break and size_ok and is_bear_signal_bar(cur, min_body_ratio):
            structural_risk = max(cur["high"], prior_low) - cur["close"]
            return capped("short", structural_risk, prior_low)
    return None


def trend_pullback_signal(
    candles: list[dict[str, Any]],
    i: int,
    params: dict[str, Any],
    trend: str,
    atr: float,
    regime: str,
) -> dict[str, Any] | None:
    cur = candles[i]
    min_body_ratio = float(params.get("trend_min_body_ratio", max(0.55, float(params.get("min_body_ratio", 0.45)))))
    take_profit_rr = float(params.get("take_profit_rr", 2.4))
    atr_stop_mult = float(params.get("atr_stop_mult", 1.8))
    max_risk_atr = float(params.get("max_risk_atr", 3.0))
    min_adx = float(params.get("trend_pullback_adx", max(30, float(params.get("min_adx", 18)))))
    min_pullback = int(params.get("min_pullback_bars", 2))
    max_pullback = int(params.get("max_pullback_bars", 8))
    if trend not in {"long", "short"} or regime != "trend" or (cur.get("adx") or 0) < min_adx:
        return None

    def capped(side: str, structural_risk: float, level: float) -> dict[str, Any] | None:
        risk = max(structural_risk, atr * atr_stop_mult, cur["close"] * 0.002)
        if risk > atr * max_risk_atr:
            return None
        return make_price_action_signal(side, "trend_pullback_continuation", cur, risk, take_profit_rr, level, trend, regime, atr)

    if trend == "long" and is_bull_signal_bar(cur, min_body_ratio):
        pullback_bars = counter_trend_pullback_count(candles, i, "long", max_pullback)
        trigger = max(c["high"] for c in candles[max(0, i - 4) : i])
        if min_pullback <= pullback_bars <= max_pullback and cur["close"] > trigger:
            pullback_low = min(c["low"] for c in candles[i - pullback_bars : i + 1])
            return capped("long", cur["close"] - pullback_low, trigger)

    if trend == "short" and is_bear_signal_bar(cur, min_body_ratio):
        pullback_bars = counter_trend_pullback_count(candles, i, "short", max_pullback)
        trigger = min(c["low"] for c in candles[max(0, i - 4) : i])
        if min_pullback <= pullback_bars <= max_pullback and cur["close"] < trigger:
            pullback_high = max(c["high"] for c in candles[i - pullback_bars : i + 1])
            return capped("short", pullback_high - cur["close"], trigger)

    return None


def candle_signal(
    candles: list[dict[str, Any]],
    i: int,
    params: dict[str, Any],
    trend: str = "neutral",
) -> dict[str, Any] | None:
    lookback = int(params.get("lookback", 24))
    retest_tolerance = float(params.get("retest_tolerance", 0.0015))
    min_body_ratio = float(params.get("min_body_ratio", 0.45))
    strategy_mode = params.get("strategy_mode", "trend_price_action")
    min_adx = float(params.get("min_adx", 18))
    require_volume = bool(params.get("require_volume", False))
    atr_stop_mult = float(params.get("atr_stop_mult", 1.4))
    take_profit_rr = float(params.get("take_profit_rr", 1.8))
    min_breakout_atr = float(params.get("min_breakout_atr", 0.25))
    min_sweep_atr = float(params.get("min_sweep_atr", 0.35))
    max_risk_atr = float(params.get("max_risk_atr", 3.0))
    use_regime_filter = bool(params.get("use_regime_filter", False)) or strategy_mode in {"adaptive_price_action", "louie_price_action", "regime_multi_strategy"}
    if i < lookback + 2:
        return None

    prev = candles[i - 1]
    cur = candles[i]
    atr = cur.get("atr")
    if atr is None or atr <= 0:
        return None
    regime = market_regime(cur, params)
    if strategy_mode == "trend_price_action":
        if trend == "neutral":
            return None
        if cur.get("adx") is None or cur["adx"] < min_adx:
            return None
        if require_volume and cur.get("volume_ma") and cur["volume"] < cur["volume_ma"]:
            return None

    prior_high = highest(candles, i - lookback - 1, i - 1)
    prior_low = lowest(candles, i - lookback - 1, i - 1)
    body = abs(cur["close"] - cur["open"])
    span = max(cur["high"] - cur["low"], 1e-9)
    strong_body = body / span >= min_body_ratio

    if strategy_mode == "louie_price_action":
        return louie_price_action_signal(candles, i, params, trend, prior_high, prior_low, atr, regime)

    if strategy_mode == "trend_breakout":
        return trend_breakout_signal(candles, i, params, trend, prior_high, prior_low, atr, regime)

    if strategy_mode == "trend_pullback":
        return trend_pullback_signal(candles, i, params, trend, atr, regime)

    if strategy_mode == "regime_multi_strategy":
        if regime == "trend" and trend in {"long", "short"}:
            return (
                trend_pullback_signal(candles, i, params, trend, atr, regime)
                or trend_breakout_signal(candles, i, params, trend, prior_high, prior_low, atr, regime)
            )
        return louie_price_action_signal(candles, i, params, "neutral", prior_high, prior_low, atr, regime)

    broke_up = prev["close"] > prior_high
    breakout_up_size = prev["close"] - prior_high
    retested_up = cur["low"] <= prior_high * (1 + retest_tolerance)
    confirmed_up = cur["close"] > prior_high and cur["close"] > cur["open"] and strong_body
    if (
        broke_up
        and breakout_up_size >= atr * min_breakout_atr
        and retested_up
        and confirmed_up
        and (not use_regime_filter or regime == "trend")
        and strategy_allows_side(strategy_mode, trend, "long")
    ):
        structural_risk = cur["close"] - min(cur["low"], prior_high * (1 - retest_tolerance))
        risk = max(structural_risk, atr * atr_stop_mult, cur["close"] * 0.002)
        if risk > atr * max_risk_atr:
            return None
        return {
            "side": "long",
            "kind": "breakout_retest",
            "entry": cur["close"],
            "stop": cur["close"] - risk,
            "take_profit": cur["close"] + risk * take_profit_rr,
            "level": prior_high,
            "trend": trend,
            "regime": regime,
            "atr": atr,
            "adx": cur.get("adx"),
        }

    broke_down = prev["close"] < prior_low
    breakout_down_size = prior_low - prev["close"]
    retested_down = cur["high"] >= prior_low * (1 - retest_tolerance)
    confirmed_down = cur["close"] < prior_low and cur["close"] < cur["open"] and strong_body
    if (
        broke_down
        and breakout_down_size >= atr * min_breakout_atr
        and retested_down
        and confirmed_down
        and (not use_regime_filter or regime == "trend")
        and strategy_allows_side(strategy_mode, trend, "short")
    ):
        structural_risk = max(cur["high"], prior_low * (1 + retest_tolerance)) - cur["close"]
        risk = max(structural_risk, atr * atr_stop_mult, cur["close"] * 0.002)
        if risk > atr * max_risk_atr:
            return None
        return {
            "side": "short",
            "kind": "breakout_retest",
            "entry": cur["close"],
            "stop": cur["close"] + risk,
            "take_profit": cur["close"] - risk * take_profit_rr,
            "level": prior_low,
            "trend": trend,
            "regime": regime,
            "atr": atr,
            "adx": cur.get("adx"),
        }

    swept_high = cur["high"] > prior_high and cur["close"] < prior_high and cur["close"] < cur["open"] and strong_body
    sweep_high_size = cur["high"] - prior_high
    if (
        swept_high
        and sweep_high_size >= atr * min_sweep_atr
        and (not use_regime_filter or regime == "range")
        and strategy_allows_side(strategy_mode, trend, "short")
    ):
        risk = max(cur["high"] - cur["close"], atr * atr_stop_mult, cur["close"] * 0.002)
        if risk > atr * max_risk_atr:
            return None
        return {
            "side": "short",
            "kind": "false_breakout",
            "entry": cur["close"],
            "stop": cur["close"] + risk,
            "take_profit": cur["close"] - risk * take_profit_rr,
            "level": prior_high,
            "trend": trend,
            "regime": regime,
            "atr": atr,
            "adx": cur.get("adx"),
        }

    swept_low = cur["low"] < prior_low and cur["close"] > prior_low and cur["close"] > cur["open"] and strong_body
    sweep_low_size = prior_low - cur["low"]
    if (
        swept_low
        and sweep_low_size >= atr * min_sweep_atr
        and (not use_regime_filter or regime == "range")
        and strategy_allows_side(strategy_mode, trend, "long")
    ):
        risk = max(cur["close"] - cur["low"], atr * atr_stop_mult, cur["close"] * 0.002)
        if risk > atr * max_risk_atr:
            return None
        return {
            "side": "long",
            "kind": "false_breakout",
            "entry": cur["close"],
            "stop": cur["close"] - risk,
            "take_profit": cur["close"] + risk * take_profit_rr,
            "level": prior_low,
            "trend": trend,
            "regime": regime,
            "atr": atr,
            "adx": cur.get("adx"),
        }

    return None


def strategy_allows_side(strategy_mode: str, trend: str, side: str) -> bool:
    if strategy_mode in {"raw_price_action", "adaptive_price_action", "louie_price_action", "regime_multi_strategy"}:
        return True
    return trend == side


def uses_trend_context(strategy_mode: str) -> bool:
    return strategy_mode in {"trend_price_action", "louie_price_action", "trend_breakout", "trend_pullback", "regime_multi_strategy"}


def confirm_signal(signal: dict[str, Any], candle: dict[str, Any], params: dict[str, Any]) -> dict[str, Any] | None:
    if not bool(params.get("require_next_confirmation", False)):
        return signal

    if signal["side"] == "long":
        confirms_direction = candle["close"] > candle["open"] and candle["close"] > signal["level"]
        invalidated = candle["low"] <= signal["stop"]
    else:
        confirms_direction = candle["close"] < candle["open"] and candle["close"] < signal["level"]
        invalidated = candle["high"] >= signal["stop"]

    if invalidated or not confirms_direction:
        return None

    if signal.get("kind") == "louie_surprise_bar":
        atr = signal.get("atr")
        if atr:
            max_extension = float(params.get("max_surprise_confirm_extension_atr", 1.0))
            max_retrace = float(params.get("max_surprise_confirm_retrace_atr", 0.95))
            if signal["side"] == "long":
                extension = (candle["close"] - signal["level"]) / atr
                retrace = (candle["high"] - candle["close"]) / atr
            else:
                extension = (signal["level"] - candle["close"]) / atr
                retrace = (candle["close"] - candle["low"]) / atr
            if extension > max_extension or retrace > max_retrace:
                return None

    entry = candle["close"]
    risk = abs(signal["entry"] - signal["stop"])
    if signal["side"] == "long":
        stop = min(signal["stop"], candle["low"])
        risk = max(entry - stop, risk)
        take_profit = entry + risk * float(params.get("take_profit_rr", 1.8))
    else:
        stop = max(signal["stop"], candle["high"])
        risk = max(stop - entry, risk)
        take_profit = entry - risk * float(params.get("take_profit_rr", 1.8))

    atr = candle.get("atr") or signal.get("atr")
    if atr and risk > atr * float(params.get("max_risk_atr", 3.0)):
        return None

    return {
        **signal,
        "entry": entry,
        "stop": stop,
        "take_profit": take_profit,
        "confirmed_time": candle["time"],
        "confirmed_ts": candle["ts"],
    }


def estimated_liquidation_price(entry: float, side: str, leverage: float, maintenance_margin_rate: float) -> float | None:
    if leverage <= 1:
        return None
    liquidation_move = max(0.0, 1 / leverage - maintenance_margin_rate)
    if liquidation_move <= 0:
        return entry
    if side == "long":
        return entry * (1 - liquidation_move)
    return entry * (1 + liquidation_move)


def adapt_signal_to_market(signal: dict[str, Any], params: dict[str, Any]) -> dict[str, Any]:
    if not bool(params.get("adaptive_trade_management", True)):
        return signal

    atr = signal.get("atr") or 0
    entry = signal["entry"]
    risk = abs(entry - signal["stop"])
    if atr <= 0 or entry <= 0 or risk <= 0:
        return signal

    base_rr = float(params.get("take_profit_rr", 2.8))
    adx = float(signal.get("adx") or 0)
    atr_pct = atr / entry
    kind = signal.get("kind", "")
    regime = signal.get("regime", "")
    rr = base_rr

    if regime == "trend" and adx >= 30 and kind in {"louie_surprise_bar", "louie_pullback_signal_bar", "trend_pullback_continuation", "trend_donchian_breakout"}:
        rr += 0.45
    if regime == "trend" and adx >= 38:
        rr += 0.25
    if atr_pct >= 0.01:
        rr -= 0.35
    if regime != "trend":
        rr = min(rr, 2.2)

    rr = max(1.6, min(rr, 3.6))
    if signal["side"] == "long":
        take_profit = entry + risk * rr
    else:
        take_profit = entry - risk * rr

    risk_factor = 0.75
    if regime == "trend" and adx >= 30:
        risk_factor += 0.2
    if kind in {"louie_surprise_bar", "louie_pullback_signal_bar", "trend_pullback_continuation", "trend_donchian_breakout"}:
        risk_factor += 0.1
    if kind == "louie_breakout_test":
        risk_factor *= float(params.get("breakout_risk_factor", 0.55))
    if regime != "trend":
        risk_factor -= 0.25
    if atr_pct >= 0.01:
        risk_factor -= 0.2
    risk_factor = max(0.35, min(risk_factor, 1.0))
    if signal.get("trend") == "short":
        risk_factor *= max(0.05, min(float(params.get("short_trend_risk_factor", 1.0)), 1.5))
    return {**signal, "take_profit": take_profit, "adaptive_rr": rr, "risk_factor": risk_factor}


def signal_score(signal: dict[str, Any]) -> float:
    kind_bonus = {
        "trend_pullback_continuation": 0.14,
        "trend_donchian_breakout": 0.10,
        "louie_wedge_reversal": 0.16,
        "louie_sweep_reversal": 0.12,
        "louie_delayed_sweep_reversal": 0.10,
        "louie_breakout_test": 0.06,
    }.get(signal.get("kind"), 0)
    adx = float(signal.get("adx") or 0)
    rr = float(signal.get("adaptive_rr") or 0)
    risk_factor = float(signal.get("risk_factor") or 0)
    atr = float(signal.get("atr") or 0)
    entry = float(signal.get("entry") or 1)
    atr_pct = atr / max(entry, 1e-9)
    return kind_bonus + risk_factor + rr * 0.08 + min(adx, 60) / 200 - atr_pct * 4


def signal_filter_reason(signal: dict[str, Any], params: dict[str, Any]) -> str | None:
    kind = signal.get("kind")
    side = signal.get("side")
    trend = signal.get("trend")
    regime = signal.get("regime")
    inst_id = signal.get("inst_id")

    if bool(params.get("block_delayed_sweep_in_chaos", False)) and kind == "louie_delayed_sweep_reversal" and regime == "chaos":
        return "过滤混沌行情延迟扫损反转"
    if bool(params.get("block_long_in_chaos", False)) and side == "long" and regime == "chaos":
        return "过滤混沌行情做多"
    if bool(params.get("block_breakout_against_trend", False)) and kind == "louie_breakout_test":
        if (side == "long" and trend == "short") or (side == "short" and trend == "long"):
            return "过滤逆趋势突破测试"
    if bool(params.get("block_eth_longs", False)) and inst_id == "ETH-USDT-SWAP" and side == "long":
        return "过滤 ETH 做多"
    return None


def apply_breakout_guard(signal: dict[str, Any], params: dict[str, Any], breakout_history: list[float]) -> dict[str, Any]:
    if signal.get("kind") != "louie_breakout_test" or not bool(params.get("enable_breakout_guard", False)):
        return signal
    window = max(1, int(params.get("breakout_guard_window", 6)))
    min_samples = max(1, int(params.get("breakout_guard_min_samples", 4)))
    max_loss_rate = float(params.get("breakout_guard_max_loss_rate", 0.65))
    multiplier = max(0.05, min(float(params.get("breakout_guard_risk_multiplier", 0.55)), 1.0))
    recent = breakout_history[-window:]
    if len(recent) < min_samples:
        return signal
    loss_rate = sum(1 for pnl in recent if pnl <= 0) / len(recent)
    if loss_rate < max_loss_rate:
        return signal
    guarded = dict(signal)
    guarded["risk_factor"] = float(guarded.get("risk_factor", 1.0)) * multiplier
    guarded["breakout_guard_active"] = True
    guarded["breakout_guard_loss_rate"] = loss_rate
    return guarded


