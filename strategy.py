import pandas as pd
import numpy as np
from market import get_minute_chart
from config import (
    TARGET_PROFIT_RATE, STOP_LOSS_RATE,
    TRAILING_TRIGGER_1, TRAILING_STEP_1,
    TRAILING_TRIGGER_2, TRAILING_STEP_2,
)


def calc_rsi(prices: pd.Series, period: int = 14) -> float:
    """RSI 계산"""
    delta = prices.diff()
    gain = delta.clip(lower=0).rolling(window=period).mean()
    loss = (-delta.clip(upper=0)).rolling(window=period).mean()
    rs = gain / loss.replace(0, np.nan)
    rsi = 100 - (100 / (1 + rs))
    return rsi.iloc[-1] if not rsi.empty else 50.0


def calc_macd(prices: pd.Series):
    """MACD 계산 → (macd, signal, histogram)"""
    ema12 = prices.ewm(span=12, adjust=False).mean()
    ema26 = prices.ewm(span=26, adjust=False).mean()
    macd = ema12 - ema26
    signal = macd.ewm(span=9, adjust=False).mean()
    hist = macd - signal
    return macd.iloc[-1], signal.iloc[-1], hist.iloc[-1]


def calc_bollinger(prices: pd.Series, period: int = 20):
    """볼린저밴드 계산 → (upper, mid, lower, %B)"""
    mid = prices.rolling(window=period).mean()
    std = prices.rolling(window=period).std()
    upper = mid + 2 * std
    lower = mid - 2 * std
    current = prices.iloc[-1]
    pct_b = (current - lower.iloc[-1]) / (upper.iloc[-1] - lower.iloc[-1] + 1e-9)
    return upper.iloc[-1], mid.iloc[-1], lower.iloc[-1], pct_b


def _get_volume_cum_weight(hour: int, minute: int) -> float:
    """
    시간대별 누적 거래량 비중 (한국 시장 특성 반영).
    장 초반(09:00-10:00)에 전체 거래량의 ~30%가 집중되므로,
    단순 시간 비례 추정 대신 실제 분포 기반으로 하루 거래량을 추정.
    """
    elapsed = (hour - 9) * 60 + minute  # 09:00 기준 경과 분
    # (경과분, 누적비중) — 한국 시장 평균 거래량 분포
    breakpoints = [
        (0,   0.00),   # 09:00
        (60,  0.30),   # 10:00 (30%)
        (120, 0.45),   # 11:00 (+15%)
        (180, 0.55),   # 12:00 (+10%)
        (240, 0.63),   # 13:00 (+8%)
        (300, 0.75),   # 14:00 (+12%)
        (360, 0.90),   # 15:00 (+15%)
        (390, 1.00),   # 15:30 (+10%)
    ]
    for i in range(len(breakpoints) - 1):
        if elapsed <= breakpoints[i + 1][0]:
            t0, w0 = breakpoints[i]
            t1, w1 = breakpoints[i + 1]
            return w0 + (w1 - w0) * (elapsed - t0) / (t1 - t0)
    return 1.0


def score_stock(stock_code: str, today_acml_vol: int = 0, avg_daily_vol: float = 0) -> dict:
    """
    종목 점수 산출 (0~100점).
    전략: 대시세 초입 포착 — MA20 필터 + 거래량 500%+ + 장대양봉 + 고점 돌파.

    실전 기법 반영:
    - 거래량 500%(5배) 이상 폭발 = 세력 매집 / 대시세 신호
    - 장대양봉 (당일 시가 대비 2%+ 상승) = 강한 매수세
    - MA20 위 = 상승 추세 유지 확인
    - 목표: 조건 충족 즉시 진입 → +1.5% 익절

    점수 구성 (최대 100점):
    1. MA20 필터 (15점) — 하락 추세 제외 (필수)
    2. 거래량 폭발 (0~40점) — 5배=40, 3배=25, 2배=10
    3. 장대양봉 (0~25점) — 당일 시가 대비 상승률
    4. 고점 돌파 (0~15점) — 세션 고점 돌파 여부
    5. RSI 강세 (0~5점) — 과매수 시 감점

    거래량 비교 방식:
    - today_acml_vol + avg_daily_vol 제공 시: 일간 누적 거래량 기준 (주력)
    - 미제공 시: 분봉 거래량 비교로 fallback
    """
    df = get_minute_chart(stock_code, minutes=60)
    if df.empty or len(df) < 20:
        return {"code": stock_code, "score": 0, "reason": "데이터 부족"}

    prices  = df["close"].astype(float)
    volumes = df["volume"].astype(float)
    opens   = df["open"].astype(float)
    score   = 0
    reasons = []

    current  = prices.iloc[-1]
    day_open = opens.iloc[0]  # 첫 분봉 시가 = 당일 시가 근사

    # 1. MA20 필터 — 분봉 MA20 위에 있어야 진입 (하락 추세 배제)
    ma20 = prices.rolling(20).mean()
    if pd.isna(ma20.iloc[-1]) or current < ma20.iloc[-1]:
        return {"code": stock_code, "score": 0, "reason": "MA20 하단 — 하락 추세 제외"}
    score += 15
    reasons.append(f"MA20 상단")

    # 2. 거래량 폭발 (0~40점) — 일간 누적 거래량 기준 (분봉 API 신뢰도 낮아 일간 우선)
    if today_acml_vol > 0 and avg_daily_vol > 0:
        # 오늘 누적 거래량을 하루 기준으로 환산 후 전일 평균과 비교
        import pytz
        from datetime import datetime as _dt
        kst = pytz.timezone("Asia/Seoul")
        now_kst = _dt.now(kst)
        cum_weight = _get_volume_cum_weight(now_kst.hour, now_kst.minute)
        proj_daily_vol = today_acml_vol / max(0.01, cum_weight)
        vol_ratio = proj_daily_vol / avg_daily_vol
        vol_label = "일간"
    else:
        avg_vol   = volumes.iloc[:-1].mean()
        last_vol  = volumes.iloc[-1]
        vol_ratio = last_vol / avg_vol if avg_vol > 0 else 0
        vol_label = "분봉"

    if vol_ratio >= 5.0:
        score += 40
        reasons.append(f"거래량 대폭발({vol_ratio:.1f}배, 대시세)[{vol_label}]")
    elif vol_ratio >= 3.0:
        score += 25
        reasons.append(f"거래량 폭발({vol_ratio:.1f}배)[{vol_label}]")
    elif vol_ratio >= 2.0:
        score += 10
        reasons.append(f"거래량 증가({vol_ratio:.1f}배)[{vol_label}]")
    else:
        reasons.append(f"거래량 미흡({vol_ratio:.1f}배)[{vol_label}]")

    # 3. 장대양봉 (0~25점) — 당일 시가 대비 현재가 상승률
    if day_open > 0:
        day_gain = (current - day_open) / day_open
        if day_gain >= 0.03:
            score += 25
            reasons.append(f"장대양봉(+{day_gain*100:.1f}%)")
        elif day_gain >= 0.02:
            score += 20
            reasons.append(f"양봉(+{day_gain*100:.1f}%)")
        elif day_gain >= 0.01:
            score += 10
            reasons.append(f"소양봉(+{day_gain*100:.1f}%)")
        else:
            reasons.append(f"음봉/보합({day_gain*100:+.1f}%)")

    # 4. 세션 고점 돌파 (0~15점) — 신고가 돌파 시 추가 점수
    session_high = prices.iloc[:-1].max()
    if current > session_high:
        score += 15
        reasons.append(f"세션 고점 돌파")
    elif current > session_high * 0.995:
        score += 8
        reasons.append(f"고점 근접")

    # 4-1. 윗꼬리 저항 감점 — 당일 고가 대비 2% 이상 밀린 경우
    day_high = df["high"].astype(float).max()
    if day_high > 0:
        pullback_rate = (day_high - current) / day_high
        if pullback_rate >= 0.02:
            score -= 15
            reasons.append(f"윗꼬리 저항(-{pullback_rate*100:.1f}% 밀림)")

    # 5. RSI (0~5점, 과매수 시 감점)
    rsi = calc_rsi(prices)
    if 50 <= rsi <= 70:
        score += 5
        reasons.append(f"RSI 강세({rsi:.1f})")
    elif rsi > 75:
        score -= 10
        reasons.append(f"RSI 과매수 감점({rsi:.1f})")

    return {
        "code":      stock_code,
        "score":     score,
        "rsi":       rsi,
        "vol_ratio": round(vol_ratio, 2),
        "reason":    " | ".join(reasons),
    }


def select_best_stock(candidates: list[dict], threshold: int = 60,
                      volume_baselines: dict = None) -> dict | None:
    """
    후보 종목 중 최고 점수 종목 선택.
    threshold 미만이면 매수 진행하지 않음.

    threshold는 코스피 MA20 상태에 따라 동적으로 결정됨:
        60  → 코스피 MA20 상단 (정상)
        75  → 코스피 MA20 하단 (경계)
        999 → 매매 중단

    volume_baselines: {stock_code: avg_daily_vol} — 아침 스캔 시 캐시한 전일 평균 거래량
    """
    if threshold >= 999:
        print("[STRATEGY] 코스피 필터: 매매 중단 (threshold=999)")
        return None

    if not candidates:
        print("[STRATEGY] 후보 종목 없음")
        return None

    baselines = volume_baselines or {}
    scored = []
    for c in candidates[:10]:  # 상위 10개만 분석
        today_acml_vol = c.get("volume", 0)
        avg_daily_vol  = baselines.get(c["code"], 0)
        result = score_stock(c["code"], today_acml_vol=today_acml_vol, avg_daily_vol=avg_daily_vol)
        result.update(c)
        scored.append(result)
        print(f"[STRATEGY] {c['name']}({c['code']}) 점수: {result['score']} - {result['reason']}")

    scored.sort(key=lambda x: x["score"], reverse=True)
    best = scored[0]

    if best["score"] < threshold:
        print(f"[STRATEGY] 최고 점수 {best['score']}점 - 매수 기준 미달 ({threshold}점 필요)")
        return None

    print(f"[STRATEGY] 선택 종목: {best['name']}({best['code']}) {best['score']}점 (기준: {threshold}점)")
    return best


def calc_target_stop(buy_price: int) -> tuple[int, int]:
    """
    목표가 / 초기 손절가 계산.
    buy_price는 실제 체결가이므로 슬리피지 추가 없이 그대로 기준으로 사용.
    목표: +2.5%, 손절: -1.0%
    """
    target = int(buy_price * (1 + TARGET_PROFIT_RATE))
    stop   = int(buy_price * (1 - STOP_LOSS_RATE))
    return target, stop


def update_trailing_stop(pos: dict, current_price: int) -> dict:
    """
    트레일링 스톱 업데이트.
    수익률 달성 단계에 따라 손절가를 상향 조정하여 수익을 보존.

    단계 1: 수익 1.0% 달성 → 손절가를 본전(0%)으로
    단계 2: 수익 1.5% 달성 → 손절가를 +0.5%로
    """
    buy_price = pos["buy_price"]
    profit_rate = (current_price - buy_price) / buy_price

    if profit_rate >= TRAILING_TRIGGER_2:
        new_stop = int(buy_price * (1 + TRAILING_STEP_2))
        if new_stop > pos["stop"]:
            old_stop = pos["stop"]
            pos["stop"] = new_stop
            pos["trailing_active"] = True
            print(f"[TRAIL] 손절가 상향: {old_stop:,} → {new_stop:,} (+{TRAILING_STEP_2*100:.1f}% 수익 보존)")

    elif profit_rate >= TRAILING_TRIGGER_1:
        new_stop = int(buy_price * (1 + TRAILING_STEP_1))
        if new_stop > pos["stop"]:
            old_stop = pos["stop"]
            pos["stop"] = new_stop
            pos["trailing_active"] = True
            print(f"[TRAIL] 손절가 본전 상향: {old_stop:,} → {new_stop:,}")

    return pos


def should_sell(current_price: int, buy_price: int, target: int, stop: int) -> tuple[bool, str]:
    """매도 조건 체크"""
    if current_price >= target:
        profit_rate = (current_price - buy_price) / buy_price * 100
        return True, f"목표가 달성 (+{profit_rate:.2f}%)"
    if current_price <= stop:
        loss_rate = (current_price - buy_price) / buy_price * 100
        return True, f"손절 ({loss_rate:.2f}%)"
    return False, ""
