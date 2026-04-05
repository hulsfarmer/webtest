"""코인 스윙봇 v5.1 전략 — 진입/청산 로직"""
import logging
import time
from typing import Optional, List, Dict, Tuple
import pyupbit

from config import (
    TARGET_COINS, BTC_TICKER, BTC_FILTER,
    BIG_CANDLE_MIN, BIG_CANDLE_MAX, RSI_MIN, VOL_SURGE,
    SL_PCT, TRAIL_ACTIVATE, TRAIL_DISTANCE, TIME_STOP_HOURS,
)

logger = logging.getLogger("swing")


def calc_rsi(closes, period=14):
    if len(closes) < period + 1:
        return None
    gains, losses = [], []
    for i in range(-period, 0):
        diff = closes[i] - closes[i - 1]
        gains.append(max(diff, 0))
        losses.append(max(-diff, 0))
    avg_gain = sum(gains) / period
    avg_loss = sum(losses) / period
    if avg_loss == 0:
        return 100
    return 100 - 100 / (1 + avg_gain / avg_loss)


def calc_ma(values, period):
    if len(values) < period:
        return None
    return sum(values[-period:]) / period


def check_btc_filter() -> bool:
    """BTC가 MA20 위인지 확인"""
    if not BTC_FILTER:
        return True
    try:
        df = pyupbit.get_ohlcv(BTC_TICKER, interval="minute60", count=25)
        if df is None or len(df) < 20:
            logger.warning("BTC 데이터 부족, 필터 통과시킴")
            return True
        closes = df["close"].tolist()
        ma20 = calc_ma(closes, 20)
        current = closes[-1]
        passed = current > ma20
        logger.info(f"BTC 필터: {current:,.0f} vs MA20 {ma20:,.0f} → {'통과' if passed else '차단'}")
        return passed
    except Exception as e:
        logger.error(f"BTC 필터 에러: {e}")
        return True


def scan_entry_signals(held_markets: set) -> List[Dict]:
    """진입 신호 스캔 → 후보 리스트 반환"""
    candidates = []

    for market in TARGET_COINS:
        if market in held_markets:
            continue

        try:
            df = pyupbit.get_ohlcv(market, interval="minute60", count=65)
            time.sleep(0.15)

            if df is None or len(df) < 65:
                continue

            closes = df["close"].tolist()
            volumes = df["volume"].tolist()
            opens = df["open"].tolist()

            cur_close = closes[-1]
            cur_open = opens[-1]
            cur_vol = volumes[-1]

            if cur_open <= 0 or cur_close <= 0:
                continue

            # 대양봉 체크
            change = (cur_close - cur_open) / cur_open
            if not (BIG_CANDLE_MIN <= change <= BIG_CANDLE_MAX):
                continue

            # 양봉 필수
            if cur_close <= cur_open:
                continue

            # MA 정배열 (20 > 60)
            ma20 = calc_ma(closes, 20)
            ma60 = calc_ma(closes, 60)
            if ma20 is None or ma60 is None or ma20 <= ma60:
                continue

            # RSI > 50
            rsi = calc_rsi(closes, 14)
            if rsi is None or rsi < RSI_MIN:
                continue

            # 거래량 서지 1.5배
            vol_avg = calc_ma(volumes[:-1], 20)
            if vol_avg is None or vol_avg <= 0 or cur_vol < vol_avg * VOL_SURGE:
                continue

            score = change * 100 + rsi * 0.1
            candidates.append({
                "market": market,
                "price": cur_close,
                "change": change,
                "rsi": rsi,
                "vol_ratio": cur_vol / vol_avg,
                "ma20": ma20,
                "ma60": ma60,
                "score": score,
            })
            logger.info(f"  신호 발견: {market} | 양봉 {change*100:+.1f}% | RSI {rsi:.0f} | 거래량 {cur_vol/vol_avg:.1f}배")

        except Exception as e:
            logger.error(f"  {market} 스캔 에러: {e}")
            continue

    candidates.sort(key=lambda x: -x["score"])
    return candidates


def check_exit(pos: dict) -> Tuple[Optional[str], Optional[float]]:
    """
    포지션 청산 체크.
    Returns: (reason, exit_price) or (None, None)
    """
    market = pos["market"]
    entry_price = pos["entry_price"]
    highest = pos["highest_price"]
    trailing_active = pos["trailing_active"]

    try:
        current_price = pyupbit.get_current_price(market)
        if current_price is None:
            return None, None
    except Exception:
        return None, None

    pnl_pct = (current_price - entry_price) / entry_price

    # 1. 손절
    if pnl_pct <= -SL_PCT:
        return "손절", current_price

    # 2. 트레일링 업데이트
    new_highest = max(highest, current_price)
    new_trailing = trailing_active or (pnl_pct >= TRAIL_ACTIVATE)

    # 3. 트레일링 스탑 발동
    if new_trailing and new_highest > 0:
        trail_stop_price = new_highest * (1 - TRAIL_DISTANCE)
        if current_price <= trail_stop_price:
            return "트레일링", current_price

    # 4. 타임스탑
    import datetime
    now = datetime.datetime.now()
    entry_time = datetime.datetime.fromisoformat(pos["entry_time"])
    hours_held = (now - entry_time).total_seconds() / 3600
    if hours_held >= TIME_STOP_HOURS:
        return "타임스탑", current_price

    return None, None


def get_updated_trailing(pos: dict) -> Tuple[float, bool]:
    """현재가 기반으로 highest/trailing_active 업데이트"""
    try:
        current_price = pyupbit.get_current_price(pos["market"])
        if current_price is None:
            return pos["highest_price"], pos["trailing_active"]
    except Exception:
        return pos["highest_price"], pos["trailing_active"]

    new_highest = max(pos["highest_price"], current_price)
    pnl_pct = (current_price - pos["entry_price"]) / pos["entry_price"]
    new_trailing = pos["trailing_active"] or (pnl_pct >= TRAIL_ACTIVATE)
    return new_highest, new_trailing
