"""피처 엔진 v2.0 — 원시 데이터에서 트레이딩 피처 계산 (중복 조건 정리)"""
import numpy as np


def compute_features(prices, kospi_map=None):
    """
    일봉 데이터 리스트 -> 각 날짜별 피처 딕셔너리 리스트
    prices: [{"date", "open", "high", "low", "close", "volume"}, ...]
    kospi_map: {"YYYYMMDD": {"close": float, "change_pct": float}}
    """
    if len(prices) < 21:
        return []

    closes = np.array([p["close"] for p in prices], dtype=float)
    volumes = np.array([p["volume"] for p in prices], dtype=float)
    highs = np.array([p["high"] for p in prices], dtype=float)
    lows = np.array([p["low"] for p in prices], dtype=float)
    opens = np.array([p["open"] for p in prices], dtype=float)

    results = []
    start_idx = min(60, len(prices) - 1)
    # 최소 20일 데이터부터 시작 (MA20 계산 가능)
    start_idx = max(20, start_idx)

    for i in range(start_idx, len(prices)):
        date = prices[i]["date"]

        c = closes[i]
        c_prev = closes[i - 1] if i > 0 else c

        # -- 이동평균 --
        ma5 = np.mean(closes[max(0,i-4):i+1])
        ma10 = np.mean(closes[max(0,i-9):i+1])
        ma20 = np.mean(closes[max(0,i-19):i+1])
        ma60 = np.mean(closes[max(0,i-59):i+1]) if i >= 59 else ma20

        # -- 가격 vs 이동평균 (%) --
        price_vs_ma5 = (c - ma5) / ma5 * 100
        price_vs_ma20 = (c - ma20) / ma20 * 100
        price_vs_ma60 = (c - ma60) / ma60 * 100

        # -- MA 정배열 점수 (0~3) --
        ma_alignment = 0
        if ma5 > ma10: ma_alignment += 1
        if ma10 > ma20: ma_alignment += 1
        if ma20 > ma60: ma_alignment += 1

        # -- 등락률 --
        change_1d = (c - closes[i-1]) / closes[i-1] * 100 if i >= 1 else 0
        change_3d = (c - closes[i-3]) / closes[i-3] * 100 if i >= 3 else 0
        change_5d = (c - closes[i-5]) / closes[i-5] * 100 if i >= 5 else 0
        change_10d = (c - closes[i-10]) / closes[i-10] * 100 if i >= 10 else 0
        change_20d = (c - closes[i-20]) / closes[i-20] * 100 if i >= 20 else 0

        # -- RSI (14일) --
        rsi = _calc_rsi(closes[:i+1], 14)

        # -- 거래량 비율 --
        avg_vol_20 = np.mean(volumes[i-20:i]) if i >= 20 else np.mean(volumes[:i])
        vol_ratio = volumes[i] / avg_vol_20 if avg_vol_20 > 0 else 1

        # -- 거래량 추세 (5일 평균 vs 20일 평균) --
        avg_vol_5 = np.mean(volumes[i-4:i+1])
        vol_trend = avg_vol_5 / avg_vol_20 if avg_vol_20 > 0 else 1

        # -- 변동성 (10일 ATR 비율) --
        atr_10 = np.mean(highs[i-9:i+1] - lows[i-9:i+1])
        volatility = atr_10 / c * 100 if c > 0 else 0

        # -- 캔들 패턴 --
        body = c - opens[i]
        candle_body_pct = body / opens[i] * 100 if opens[i] > 0 else 0
        upper_shadow = (highs[i] - max(c, opens[i])) / c * 100 if c > 0 else 0
        lower_shadow = (min(c, opens[i]) - lows[i]) / c * 100 if c > 0 else 0
        is_bullish = 1 if c > opens[i] else 0

        # -- 연속 양봉/음봉 --
        consecutive_up = 0
        for j in range(i, max(i-10, -1), -1):
            if closes[j] > opens[j]:
                consecutive_up += 1
            else:
                break

        consecutive_down = 0
        for j in range(i, max(i-10, -1), -1):
            if closes[j] < opens[j]:
                consecutive_down += 1
            else:
                break

        # -- 고점/저점 대비 --
        high_20 = np.max(highs[i-19:i+1])
        low_20 = np.min(lows[i-19:i+1])
        from_high_20 = (c - high_20) / high_20 * 100
        from_low_20 = (c - low_20) / low_20 * 100

        # -- 코스피 관련 --
        kospi_change_1d = 0
        kospi_change_5d = 0
        kospi_above_ma20 = 0
        if kospi_map and date in kospi_map:
            kospi_change_1d = kospi_map[date].get("change_pct", 0)
            # 코스피 5일 변화 (간략)
            dates_sorted = sorted(kospi_map.keys())
            idx = dates_sorted.index(date) if date in dates_sorted else -1
            if idx >= 5:
                kospi_5d_ago = kospi_map[dates_sorted[idx-5]]["close"]
                kospi_now = kospi_map[date]["close"]
                kospi_change_5d = (kospi_now - kospi_5d_ago) / kospi_5d_ago * 100
            if idx >= 20:
                kospi_ma20 = np.mean([kospi_map[dates_sorted[j]]["close"]
                                      for j in range(idx-19, idx+1)])
                kospi_above_ma20 = 1 if kospi_map[date]["close"] > kospi_ma20 else 0

        # -- 피처 딕셔너리 --
        features = {
            # 이동평균
            "price_vs_ma5": round(price_vs_ma5, 2),
            "price_vs_ma20": round(price_vs_ma20, 2),
            "price_vs_ma60": round(price_vs_ma60, 2),
            "ma_alignment": ma_alignment,

            # 등락률
            "change_1d": round(change_1d, 2),
            "change_3d": round(change_3d, 2),
            "change_5d": round(change_5d, 2),
            "change_10d": round(change_10d, 2),
            "change_20d": round(change_20d, 2),

            # 모멘텀
            "rsi": round(rsi, 1),

            # 거래량
            "vol_ratio": round(vol_ratio, 2),
            "vol_trend": round(vol_trend, 2),

            # 변동성
            "volatility": round(volatility, 2),

            # 캔들
            "candle_body_pct": round(candle_body_pct, 2),
            "upper_shadow": round(upper_shadow, 2),
            "lower_shadow": round(lower_shadow, 2),
            "is_bullish": is_bullish,
            "consecutive_up": consecutive_up,
            "consecutive_down": consecutive_down,

            # 위치
            "from_high_20": round(from_high_20, 2),
            "from_low_20": round(from_low_20, 2),

            # 코스피
            "kospi_change_1d": round(kospi_change_1d, 2),
            "kospi_change_5d": round(kospi_change_5d, 2),
            "kospi_above_ma20": kospi_above_ma20,
        }

        results.append({"date": date, "features": features})

    return results


def _calc_rsi(closes, period=14):
    """RSI 계산"""
    if len(closes) < period + 1:
        return 50.0
    deltas = np.diff(closes[-(period+1):])
    gains = np.where(deltas > 0, deltas, 0)
    losses = np.where(deltas < 0, -deltas, 0)
    avg_gain = np.mean(gains)
    avg_loss = np.mean(losses)
    if avg_loss == 0:
        return 100.0
    rs = avg_gain / avg_loss
    return round(100 - (100 / (1 + rs)), 1)


# -- 조건 정의 v2.0 (중복/상관 높은 조건 제거) --
# 제거: "가격>MA20" (가격>MA20+3%만 유지)
# 제거: "RSI>50" (RSI>60 유지)
# 변경: "RSI<30" -> "RSI<40"
# 제거: "거래량1.5배", "거래량3배" (2배, 5배만 유지)
CONDITION_TEMPLATES = [
    # 이동평균
    ("price_vs_ma5", ">", 0, "가격>MA5"),
    ("price_vs_ma5", "<", 0, "가격<MA5"),
    # ("price_vs_ma20", ">", 0, "가격>MA20"),  # v2: 제거 (MA20+3%와 상관 높음)
    ("price_vs_ma20", "<", 0, "가격<MA20"),
    ("price_vs_ma20", ">", 3, "가격>MA20+3%"),
    ("price_vs_ma60", ">", 0, "가격>MA60"),
    ("price_vs_ma60", "<", 0, "가격<MA60"),
    ("ma_alignment", ">=", 3, "MA완전정배열"),
    ("ma_alignment", ">=", 2, "MA정배열2+"),
    ("ma_alignment", "==", 0, "MA역배열"),

    # 등락률
    ("change_1d", ">", 2, "전일+2%이상"),
    ("change_1d", ">", 5, "전일+5%이상"),
    ("change_1d", "<", -2, "전일-2%이하"),
    ("change_3d", ">", 5, "3일+5%이상"),
    ("change_3d", "<", -5, "3일-5%이하"),
    ("change_5d", ">", 5, "5일+5%이상"),
    ("change_5d", ">", 10, "5일+10%이상"),
    ("change_5d", "<", -5, "5일-5%이하"),
    ("change_10d", ">", 10, "10일+10%이상"),
    ("change_20d", ">", 10, "20일+10%이상"),
    ("change_20d", ">", 20, "20일+20%이상"),
    ("change_20d", "<", -10, "20일-10%이하"),

    # RSI
    ("rsi", ">", 70, "RSI>70(과매수)"),
    # ("rsi", ">", 50, "RSI>50"),  # v2: 제거 (RSI>60와 상관 높음)
    ("rsi", "<", 40, "RSI<40(과매도)"),  # v2: 30->40으로 변경
    ("rsi", "<", 50, "RSI<50"),
    ("rsi", ">", 60, "RSI>60"),

    # 거래량
    # ("vol_ratio", ">", 1.5, "거래량1.5배"),  # v2: 제거 (2배와 상관 높음)
    ("vol_ratio", ">", 2, "거래량2배"),
    # ("vol_ratio", ">", 3, "거래량3배"),  # v2: 제거 (5배와 상관 높음)
    ("vol_ratio", ">", 5, "거래량5배"),
    ("vol_trend", ">", 1.5, "거래량추세증가"),
    ("vol_trend", "<", 0.7, "거래량추세감소"),

    # 변동성
    ("volatility", ">", 3, "고변동성"),
    ("volatility", "<", 1.5, "저변동성"),

    # 캔들
    ("is_bullish", "==", 1, "양봉"),
    ("is_bullish", "==", 0, "음봉"),
    ("candle_body_pct", ">", 3, "큰양봉(3%+)"),
    ("candle_body_pct", "<", -3, "큰음봉(-3%)"),
    ("consecutive_up", ">=", 3, "3연속양봉"),
    ("consecutive_up", ">=", 5, "5연속양봉"),
    ("lower_shadow", ">", 2, "긴아래꼬리"),

    # 위치
    ("from_high_20", ">", -3, "20일고점근접"),
    ("from_high_20", "<", -10, "20일고점-10%"),
    ("from_low_20", ">", 15, "20일저점+15%"),
    ("from_low_20", "<", 3, "20일저점근접"),

    # 코스피
    ("kospi_change_1d", ">", 0, "코스피양봉"),
    ("kospi_change_1d", "<", 0, "코스피음봉"),
    ("kospi_change_1d", ">", 1, "코스피+1%"),
    ("kospi_change_1d", "<", -1, "코스피-1%"),
    ("kospi_change_5d", ">", 2, "코스피5일+2%"),
    ("kospi_change_5d", "<", -2, "코스피5일-2%"),
    ("kospi_above_ma20", "==", 1, "코스피>MA20"),
    ("kospi_above_ma20", "==", 0, "코스피<MA20"),
]


def check_condition(features, condition):
    """단일 조건 체크"""
    feat_name, op, value, _ = condition
    feat_val = features.get(feat_name)
    if feat_val is None:
        return False
    if op == ">":
        return feat_val > value
    elif op == "<":
        return feat_val < value
    elif op == ">=":
        return feat_val >= value
    elif op == "<=":
        return feat_val <= value
    elif op == "==":
        return feat_val == value
    return False


def check_conditions(features, conditions):
    """복수 조건 모두 충족 여부"""
    return all(check_condition(features, c) for c in conditions)
