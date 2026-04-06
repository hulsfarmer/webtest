"""코인 변동성 돌파봇 — 전략 로직"""
import logging
import time
from typing import Optional, List, Dict, Tuple
import pyupbit

from config import (
    TARGET_COINS, BTC_TICKER,
    K_VALUE, BTC_MA_PERIOD, SL_PCT,
)

logger = logging.getLogger("vb")


def get_btc_filter() -> bool:
    """BTC 일봉 종가 > MA5 확인"""
    try:
        df = pyupbit.get_ohlcv(BTC_TICKER, interval="day", count=BTC_MA_PERIOD + 2)
        if df is None or len(df) < BTC_MA_PERIOD + 1:
            logger.warning("BTC 일봉 데이터 부족, 필터 통과시킴")
            return True

        closes = df["close"].tolist()
        # 당일 봉은 미완성이므로 전일까지로 MA 계산
        # closes[-1]은 오늘(진행중), closes[-2]는 어제 완성
        ma = sum(closes[-(BTC_MA_PERIOD + 1):-1]) / BTC_MA_PERIOD
        current = closes[-1]  # 현재가 (오늘 진행중 봉의 종가 = 현재가)

        passed = current > ma
        logger.info(f"BTC 필터: {current:,.0f} vs MA{BTC_MA_PERIOD} {ma:,.0f} -> {'통과' if passed else '차단'}")
        return passed
    except Exception as e:
        logger.error(f"BTC 필터 에러: {e}")
        return True


def get_breakout_targets() -> Dict[str, dict]:
    """
    각 코인의 오늘 돌파 타겟 계산.
    타겟 = 오늘 시가 + 전일 변동폭 × k
    Returns: {market: {"target": float, "open": float, "prev_range": float}}
    """
    targets = {}

    for market in TARGET_COINS:
        try:
            df = pyupbit.get_ohlcv(market, interval="day", count=3)
            time.sleep(0.12)

            if df is None or len(df) < 2:
                continue

            # df.iloc[-1] = 오늘 (진행 중)
            # df.iloc[-2] = 어제 (완성)
            yesterday = df.iloc[-2]
            today = df.iloc[-1]

            prev_range = yesterday["high"] - yesterday["low"]
            today_open = today["open"]

            if prev_range <= 0 or today_open <= 0:
                continue

            target = today_open + prev_range * K_VALUE

            targets[market] = {
                "target": target,
                "open": today_open,
                "prev_range": prev_range,
                "prev_range_pct": prev_range / yesterday["close"] * 100,
            }

        except Exception as e:
            logger.error(f"{market} 타겟 계산 에러: {e}")
            continue

    return targets


def check_breakout(targets: Dict[str, dict], held_markets: set) -> List[Dict]:
    """
    현재가가 돌파 타겟을 넘었는지 확인.
    Returns: 돌파 신호 리스트 (강도 순)
    """
    signals = []

    markets_to_check = [m for m in targets if m not in held_markets]
    if not markets_to_check:
        return signals

    try:
        prices = pyupbit.get_current_price(markets_to_check)
        if prices is None:
            return signals
        if isinstance(prices, (int, float)):
            prices = {markets_to_check[0]: prices}
    except Exception as e:
        logger.error(f"현재가 조회 에러: {e}")
        return signals

    for market in markets_to_check:
        if market not in prices or prices[market] is None:
            continue

        current = prices[market]
        t = targets[market]

        if current >= t["target"]:
            strength = (current - t["target"]) / t["prev_range"] if t["prev_range"] > 0 else 0
            pct_above_open = (current - t["open"]) / t["open"] * 100

            signals.append({
                "market": market,
                "price": current,
                "target": t["target"],
                "open": t["open"],
                "strength": strength,
                "pct_above_open": pct_above_open,
                "prev_range_pct": t["prev_range_pct"],
            })
            nm = market.replace("KRW-", "")
            logger.info(f"  돌파! {nm} | 현재 {current:,.0f} >= 타겟 {t['target']:,.0f} | "
                       f"시가대비 +{pct_above_open:.1f}% | 강도 {strength:.2f}")

    signals.sort(key=lambda x: x["strength"], reverse=True)
    return signals


def check_sell(pos: dict) -> Tuple[Optional[str], Optional[float]]:
    """
    포지션 매도 체크.
    Returns: (reason, exit_price) or (None, None)
    """
    market = pos["market"]
    entry_price = pos["entry_price"]

    try:
        current_price = pyupbit.get_current_price(market)
        if current_price is None:
            return None, None
    except Exception:
        return None, None

    pnl_pct = (current_price - entry_price) / entry_price

    # 손절
    if pnl_pct <= -SL_PCT:
        return "손절", current_price

    return None, None
