"""MarketSignal - 경제 지표 현황판 v3.0
FRED CSV (API 키 불필요) + 환율 실시간 API
미국 + 한국 주요 지표 + 시장 영향력 점수 (0~100)
"""
import csv
import json
import io
import os
import subprocess
import urllib.request
import urllib.error
from datetime import datetime, timedelta

# ============================================================
# FRED 시리즈 정의
# ============================================================
FRED_INDICATORS = [
    # ── 미국 ──
    {
        "id": "DFEDTARU",
        "name": "미국 기준금리",
        "emoji": "🏦",
        "format": "percent",  # 상한만 표시
        "explain": "미국 중앙은행(연준)이 설정한 금리 범위",
        "impact_high": "금리 높음 → 돈 빌리기 비쌈 → 주식시장 부담",
        "impact_low": "금리 낮음 → 돈 빌리기 쉬움 → 주식시장 호재",
        "good_direction": "down",
        "weight": 10,  # 매크로 (6~8주 변동)
        "category": "미국",
        # 점수 매핑: (값, 점수) — 선형보간
        "score_map": [(3.0, 90), (3.5, 70), (4.0, 50), (4.5, 30), (5.0, 10)],
    },
    {
        "id": "CPIAUCSL",
        "name": "미국 소비자물가(CPI)",
        "emoji": "🛒",
        "format": "yoy",  # YoY% 계산
        "explain": "미국 물건값이 1년간 얼마나 올랐는지",
        "impact_high": "물가 상승 → 금리 인상 지속 → 코스피 하락 압력",
        "impact_low": "물가 안정 → 금리 인하 기대 → 코스피 상승 기대",
        "good_direction": "down",
        "weight": 7,  # 매크로 (월 1회)
        "category": "미국",
        "score_map": [(1.5, 95), (2.0, 80), (2.5, 65), (3.0, 50), (3.5, 35), (4.0, 20), (5.0, 5)],
    },
    {
        "id": "UNRATE",
        "name": "미국 실업률",
        "emoji": "👷",
        "format": "percent",
        "explain": "미국에서 일자리를 구하지 못한 사람의 비율",
        "impact_high": "실업률 높음 → 경기 둔화 → 금리 인하 기대",
        "impact_low": "실업률 낮음 → 경기 과열 가능 → 금리 인상 우려",
        "good_direction": "neutral",
        "weight": 4,  # 매크로 (월 1회)
        "category": "미국",
        # 적정 실업률 3.5~4.5%가 건강한 경제
        "score_map": [(3.0, 60), (3.5, 75), (4.0, 70), (4.5, 55), (5.0, 40), (6.0, 20)],
    },
    {
        "id": "A191RL1Q225SBEA",
        "name": "미국 GDP 성장률",
        "emoji": "📊",
        "format": "percent",
        "explain": "미국 경제가 얼마나 성장하고 있는지 (분기별)",
        "impact_high": "성장률 높음 → 경제 탄탄 → 기업 실적 기대",
        "impact_low": "성장률 낮음 → 경기 둔화 우려 → 주식시장 불안",
        "good_direction": "up",
        "weight": 4,  # 매크로 (분기 1회)
        "category": "미국",
        "score_map": [(-1.0, 5), (0.0, 25), (1.0, 50), (2.0, 70), (3.0, 85), (4.0, 75), (5.0, 60)],
    },
    {
        "id": "DGS10",
        "name": "미국 10년 국채금리",
        "emoji": "📈",
        "format": "percent",
        "explain": "미국 정부가 10년간 빌릴 때 금리 (시장금리의 기준)",
        "impact_high": "국채금리 상승 → 주식 매력 감소 → 코스피 하락 압력",
        "impact_low": "국채금리 하락 → 주식 매력 증가 → 코스피 상승 기대",
        "good_direction": "down",
        "weight": 10,
        "category": "미국",
        "score_map": [(3.0, 85), (3.5, 70), (4.0, 55), (4.5, 40), (5.0, 25)],
    },
    {
        "id": "PCEPILFE",
        "name": "근원 PCE 물가",
        "emoji": "🎯",
        "format": "yoy",
        "explain": "연준이 가장 중시하는 물가지표 (식품·에너지 제외)",
        "impact_high": "2%보다 높으면 → 금리 인하 어려움",
        "impact_low": "2%에 가까워지면 → 금리 인하 기대",
        "good_direction": "down",
        "weight": 5,  # 매크로 (월 1회)
        "category": "미국",
        "score_map": [(1.5, 95), (2.0, 80), (2.5, 60), (3.0, 40), (3.5, 25), (4.0, 10)],
    },
    {
        "id": "VIXCLS",
        "name": "VIX 공포지수",
        "emoji": "😱",
        "format": "percent",
        "explain": "시장의 불안감 수치 (높을수록 공포, 낮을수록 안심)",
        "impact_high": "VIX 높음 → 시장 불안 → 외국인 매도 → 코스피 하락",
        "impact_low": "VIX 낮음 → 시장 안정 → 외국인 매수 → 코스피 상승",
        "good_direction": "down",
        "weight": 10,  # 실시간
        "category": "미국",
        "score_map": [(12, 95), (15, 85), (20, 65), (25, 45), (30, 25), (40, 10)],
    },
    # ── 한국 ──
    {
        "id": "IRSTCI01KRM156N",
        "name": "한국 시장금리",
        "emoji": "🇰🇷",
        "format": "percent",
        "explain": "한국 단기금리 (한국은행 기준금리와 연동)",
        "impact_high": "금리 높음 → 대출 부담 → 소비 위축 → 주식시장 부담",
        "impact_low": "금리 낮음 → 소비 촉진 → 주식시장 호재",
        "good_direction": "down",
        "weight": 5,
        "category": "한국",
        "score_map": [(2.0, 85), (2.5, 70), (3.0, 55), (3.5, 40), (4.0, 25)],
    },
]

# 환율 (별도 API)
EXCHANGE_RATE_CONFIG = {
    "name": "원/달러 환율",
    "emoji": "💵",
    "explain": "1달러에 한국 원화가 얼마인지 (높을수록 원화 약세)",
    "impact_high": "환율 상승(원화 약세) → 외국인 매도 → 코스피 하락 압력",
    "impact_low": "환율 하락(원화 강세) → 외국인 매수 → 코스피 상승 기대",
    "good_direction": "down",
    "weight": 10,  # 실시간
    "category": "한국",
    "score_map": [(1200, 90), (1300, 70), (1400, 50), (1450, 40), (1500, 25), (1550, 15)],
}

CACHE_FILE = os.path.join(os.path.dirname(__file__) or ".", "indicators_cache.json")
CACHE_MAX_AGE_HOURS = 20  # 06:00 갱신 → 다음날 06:00 전까지 유지


def _fetch_stooq(symbol):
    """stooq.com에서 지수 종가 + 전일 종가 가져오기 (전일대비 등락률 계산용)"""
    try:
        from datetime import datetime, timedelta
        end = datetime.now()
        start = end - timedelta(days=10)
        d1 = start.strftime("%Y%m%d")
        d2 = end.strftime("%Y%m%d")
        url = f"https://stooq.com/q/d/l/?s={symbol}&d1={d1}&d2={d2}&i=d"
        req = urllib.request.Request(url, headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
        })
        with urllib.request.urlopen(req, timeout=15) as resp:
            text = resp.read().decode("utf-8")
        data_lines = text.strip().split("\n")
        if len(data_lines) < 2:
            return None
        header = data_lines[0].split(",")
        rows = []
        for line in data_lines[1:]:
            vals = line.split(",")
            if len(vals) >= len(header):
                rows.append(dict(zip(header, vals)))
        if not rows:
            return None
        latest = rows[-1]
        close = latest.get("Close", "N/D")
        date = latest.get("Date", "N/D")
        if close == "N/D" or date == "N/D":
            return None
        result = {
            "close": float(close),
            "date": date,
            "open": float(latest.get("Open", 0)),
            "high": float(latest.get("High", 0)),
            "low": float(latest.get("Low", 0)),
        }
        if len(rows) >= 2:
            prev = rows[-2]
            pc = prev.get("Close", "N/D")
            if pc != "N/D":
                result["prev_close"] = float(pc)
        return result
    except Exception as e:
        print(f"[지표] stooq {symbol} 실패: {e}")
        return None




def _fetch_yahoo(symbol):
    """Yahoo Finance v8에서 지수 최신 종가 가져오기 (stooq보다 빠름)"""
    try:
        url = f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}?interval=1d&range=5d"
        req = urllib.request.Request(url, headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
            "Accept": "application/json"
        })
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        result = data["chart"]["result"][0]
        timestamps = result["timestamp"]
        closes = result["indicators"]["quote"][0]["close"]
        valid = [(t, c) for t, c in zip(timestamps, closes) if c is not None]
        if not valid:
            return None
        latest_ts, latest_close = valid[-1]
        from datetime import timezone
        latest_date = __import__("datetime").datetime.fromtimestamp(latest_ts, tz=timezone.utc).strftime("%Y-%m-%d")
        res = {"close": round(latest_close, 4), "date": latest_date}
        if len(valid) >= 2:
            res["prev_close"] = round(valid[-2][1], 4)
        else:
            res["prev_close"] = latest_close
        return res
    except Exception as e:
        print(f"[지표] Yahoo {symbol} 실패: {e}")
        return None

def _fetch_naver_index_history(code, count=3):
    """네이버 금융 일별 시세에서 최근 종가 가져오기 (전일 종가 정확)"""
    import re
    try:
        url = f"https://finance.naver.com/sise/sise_index_day.naver?code={code}&page=1"
        req = urllib.request.Request(url, headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
        })
        with urllib.request.urlopen(req, timeout=15) as resp:
            html = resp.read().decode("euc-kr", errors="ignore")
        dates = re.findall(r'<td class="date">([\d.]+)</td>', html)
        values = re.findall(r'<td class="number_1">([\d,.]+)</td>', html)
        results = []
        for i, (d, v) in enumerate(zip(dates[:count], values[:count])):
            date_str = d.replace(".", "-")
            val = float(v.replace(",", ""))
            results.append({"date": date_str, "value": val})
        return results
    except Exception as e:
        print(f"[지표] 네이버 {code} 일별 실패: {e}")
        return []


def _fetch_market_indices():
    """시장 지수 수집: Yahoo(나스닥/S&P) + 네이버(코스피/코스닥)"""
    indices = []

    # 미국 지수 - Yahoo Finance (stooq보다 최신 데이터)
    yahoo_symbols = [
        ("^IXIC", "나스닥", "🇺🇸"),
        ("^GSPC", "S&P 500", "🇺🇸"),
    ]
    stooq_fallback = {"^IXIC": "^ndq", "^GSPC": "^spx"}

    for symbol, name, emoji in yahoo_symbols:
        data = _fetch_yahoo(symbol)
        if not data:
            data = _fetch_stooq(stooq_fallback.get(symbol, symbol))
        if data:
            prev_close = data.get("prev_close", data.get("open", data["close"]))
            change = round(data["close"] - prev_close, 2)
            change_pct = round(change / prev_close * 100, 2) if prev_close else 0
            indices.append({
                "name": name,
                "emoji": emoji,
                "value": data["close"],
                "change": change,
                "change_pct": change_pct,
                "date": data["date"],
            })

    # 코스피 - 네이버 (stooq 1일 지연 문제로 전환)
    kospi_rows = _fetch_naver_index_history("KOSPI", 2)
    if kospi_rows:
        latest = kospi_rows[0]
        prev = kospi_rows[1] if len(kospi_rows) >= 2 else None
        change = round(latest["value"] - prev["value"], 2) if prev else 0
        change_pct = round(change / prev["value"] * 100, 2) if prev and prev["value"] else 0
        indices.append({
            "name": "코스피",
            "emoji": "🇰🇷",
            "value": latest["value"],
            "change": change,
            "change_pct": change_pct,
            "date": latest["date"],
        })

    # 코스닥 - 네이버
    kosdaq_rows = _fetch_naver_index_history("KOSDAQ", 2)
    if kosdaq_rows:
        latest = kosdaq_rows[0]
        prev = kosdaq_rows[1] if len(kosdaq_rows) >= 2 else None
        change = round(latest["value"] - prev["value"], 2) if prev else 0
        change_pct = round(change / prev["value"] * 100, 2) if prev and prev["value"] else 0
        indices.append({
            "name": "코스닥",
            "emoji": "🇰🇷",
            "value": latest["value"],
            "change": change,
            "change_pct": change_pct,
            "date": latest["date"],
        })

    return indices


def build_indices_html(indices=None):
    """시장 지수 HTML 바 생성"""
    if indices is None:
        indices = _fetch_market_indices()
    if not indices:
        return ""

    cards = ""
    for idx in indices:
        val = idx["value"]
        chg = idx["change"]
        pct = idx["change_pct"]

        if chg > 0:
            color = "#e53e3e"
            arrow = "▲"
            sign = "+"
        elif chg < 0:
            color = "#3182ce"
            arrow = "▼"
            sign = ""
        else:
            color = "#718096"
            arrow = "−"
            sign = ""

        # 날짜 표시
        try:
            dt = datetime.strptime(idx["date"], "%Y-%m-%d")
            date_str = f"{dt.month}/{dt.day}"
        except Exception:
            date_str = idx["date"]

        # 포맷
        if val >= 10000:
            val_str = f"{val:,.0f}"
        else:
            val_str = f"{val:,.2f}"

        cards += f"""
            <div style="flex:1; min-width:140px; background:#fff; border-radius:8px; padding:12px; text-align:center; border:1px solid #e2e8f0;">
                <div style="font-size:0.8em; color:#718096;">{idx['emoji']} {idx['name']}</div>
                <div style="font-size:1.2em; font-weight:700; color:#1a365d; margin:4px 0;">{val_str}</div>
                <div style="font-size:0.85em; color:{color}; font-weight:600;">{arrow} {sign}{chg:,.2f} ({sign}{pct:.2f}%)</div>
                <div style="font-size:0.7em; color:#a0aec0;">{date_str} 종가</div>
            </div>"""

    return f"""
    <div style="display:flex; gap:10px; flex-wrap:wrap; margin-bottom:15px;">
        {cards}
    </div>
"""


def _fetch_fred_csv(series_id, months_back=15):
    """FRED CSV 가져오기 — curl + tmpfile (urllib은 Oracle Cloud에서 타임아웃)"""
    start = (datetime.now() - timedelta(days=months_back * 30)).strftime("%Y-%m-%d")
    url = f"https://fred.stlouisfed.org/graph/fredgraph.csv?id={series_id}&cosd={start}"
    tmpfile = f"/tmp/fred_{series_id}.csv"
    try:
        os.system(f'curl -s -m 45 -o {tmpfile} "{url}"')
        if not os.path.exists(tmpfile) or os.path.getsize(tmpfile) < 10:
            print(f"[지표] FRED {series_id}: 빈 응답")
            return []
        with open(tmpfile, "r") as f:
            text = f.read()
        os.remove(tmpfile)
        if "DATE" not in text and "observation_date" not in text:
            print(f"[지표] FRED {series_id}: 유효하지 않은 응답")
            return []
        # 헤더가 observation_date인 경우 DATE로 통일
        text = text.replace("observation_date", "DATE")
        rows = []
        for row in csv.DictReader(io.StringIO(text)):
            val = row.get(series_id, ".")
            if val and val != ".":
                try:
                    rows.append({"date": row.get("DATE", ""), "value": float(val)})
                except ValueError:
                    pass
        return rows
    except Exception as e:
        print(f"[지표] FRED {series_id} 실패: {e}")
        return []


def _fetch_exchange_rate():
    """USD/KRW 환율 — 3단계 폴백"""
    # 1차: fawazahmed0 (하루 수회 업데이트, 안정적)
    try:
        url = "https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json"
        req = urllib.request.Request(url, headers={
            "User-Agent": "Mozilla/5.0 (compatible; MarketSignal/1.0)"
        })
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        krw = data.get("usd", {}).get("krw")
        date_str = data.get("date", datetime.now().strftime("%Y-%m-%d"))
        if krw:
            print(f"[지표] 환율(fawazahmed0): {krw:.1f}원 ({date_str})")
            return {"value": round(krw, 1), "date": date_str}
    except Exception as e:
        print(f"[지표] 환율(fawazahmed0) 실패: {e}")

    # 2차: open.er-api.com (하루 1회)
    try:
        url = "https://open.er-api.com/v6/latest/USD"
        req = urllib.request.Request(url, headers={
            "User-Agent": "Mozilla/5.0 (compatible; MarketSignal/1.0)"
        })
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        krw = data.get("rates", {}).get("KRW")
        update_date = data.get("time_last_update_utc", "")
        try:
            dt = datetime.strptime(update_date[:16], "%a, %d %b %Y")
            date_str = dt.strftime("%Y-%m-%d")
        except Exception:
            date_str = datetime.now().strftime("%Y-%m-%d")
        if krw:
            print(f"[지표] 환율(er-api): {krw:.1f}원 ({date_str})")
            return {"value": round(krw, 1), "date": date_str}
    except Exception as e:
        print(f"[지표] 환율(er-api) 실패: {e}")

    # 3차: FRED (며칠 지연)
    rows = _fetch_fred_csv("DEXKOUS", 2)
    if rows:
        return {"value": rows[-1]["value"], "date": rows[-1]["date"]}
    return None


def _interpolate_score(value, score_map):
    """score_map에서 선형보간으로 점수 산출 (0~100)"""
    if not score_map:
        return 50
    # 범위 밖
    if value <= score_map[0][0]:
        return score_map[0][1]
    if value >= score_map[-1][0]:
        return score_map[-1][1]
    # 선형보간
    for i in range(len(score_map) - 1):
        v1, s1 = score_map[i]
        v2, s2 = score_map[i + 1]
        if v1 <= value <= v2:
            ratio = (value - v1) / (v2 - v1) if v2 != v1 else 0
            return round(s1 + (s2 - s1) * ratio)
    return 50


def get_cached_indices():
    """캐시에서 시장 지수만 꺼내기"""
    cached = _load_cache()
    if cached:
        return cached.get("indices", [])
    return []


def fetch_all_indicators():
    """모든 주요 지표 현재값 + 시장 점수 가져오기"""
    cached = _load_cache()
    if cached:
        print(f"[지표] 캐시 사용 ({cached.get('cached_at', '?')})")
        return cached.get("indicators", [])

    print("[지표] FRED + 환율 API에서 최신 데이터 수집 중...")
    results = []

    for ind in FRED_INDICATORS:
        if ind["format"] == "yoy":
            rows = _fetch_fred_csv(ind["id"], 15)
            if len(rows) < 13:
                continue
            latest = rows[-1]["value"]
            year_ago = rows[-13]["value"]
            if year_ago == 0:
                continue
            yoy = round((latest - year_ago) / year_ago * 100, 1)
            display_val = f"{yoy}%"
            raw_value = yoy
            latest_date = rows[-1]["date"]
            # 이전달 YoY
            trend_val = None
            if len(rows) >= 14:
                prev_latest = rows[-2]["value"]
                prev_year = rows[-14]["value"]
                if prev_year > 0:
                    prev_yoy = round((prev_latest - prev_year) / prev_year * 100, 1)
                    trend_val = round(yoy - prev_yoy, 1)

        elif ind["format"] == "percent":
            # VIX, 10년 국채금리는 Yahoo Finance에서 실시간 데이터 (FRED 1일 지연 문제)
            yahoo_map = {"VIXCLS": "^VIX", "DGS10": "^TNX"}
            yahoo_sym = yahoo_map.get(ind["id"])
            if yahoo_sym:
                ydata = _fetch_yahoo(yahoo_sym)
                if ydata:
                    raw_value = ydata["close"]
                    display_val = f"{raw_value:.2f}%"
                    latest_date = ydata["date"]
                    trend_val = None
                    if "prev_close" in ydata:
                        trend_val = round(raw_value - ydata["prev_close"], 3)
                    print(f"[지표] Yahoo {yahoo_sym}: {raw_value:.2f}% ({latest_date})")
                else:
                    rows = _fetch_fred_csv(ind["id"], 3)
                    if not rows:
                        continue
                    raw_value = rows[-1]["value"]
                    display_val = f"{raw_value:.2f}%"
                    latest_date = rows[-1]["date"]
                    trend_val = None
                    if len(rows) >= 2:
                        trend_val = round(raw_value - rows[-2]["value"], 2)
            else:
                rows = _fetch_fred_csv(ind["id"], 3)
                if not rows:
                    continue
                raw_value = rows[-1]["value"]
                display_val = f"{raw_value:.2f}%"
                latest_date = rows[-1]["date"]
                trend_val = None
                if len(rows) >= 2:
                    trend_val = round(raw_value - rows[-2]["value"], 2)
        else:
            continue

        # 추세 아이콘
        trend_icon = "➡️"
        trend_label = "유지"
        if trend_val is not None:
            if trend_val > 0.05:
                trend_icon = "⬆️"
                trend_label = "상승"
            elif trend_val < -0.05:
                trend_icon = "⬇️"
                trend_label = "하락"

        # 코스피 영향 판단
        kospi_impact = ""
        if ind["good_direction"] == "down":
            kospi_impact = "코스피 긍정적" if (trend_val or 0) < -0.05 else ("코스피 부담" if (trend_val or 0) > 0.05 else "")
        elif ind["good_direction"] == "up":
            kospi_impact = "코스피 긍정적" if (trend_val or 0) > 0.05 else ("코스피 부담" if (trend_val or 0) < -0.05 else "")

        # 개별 점수
        score = _interpolate_score(raw_value, ind.get("score_map", []))

        results.append({
            "id": ind["id"],
            "name": ind["name"],
            "emoji": ind["emoji"],
            "category": ind.get("category", "미국"),
            "value": display_val,
            "raw_value": raw_value,
            "date": latest_date,
            "trend_icon": trend_icon,
            "trend_label": trend_label,
            "trend_val": trend_val,
            "explain": ind["explain"],
            "impact_high": ind["impact_high"],
            "impact_low": ind["impact_low"],
            "kospi_impact": kospi_impact,
            "score": score,
            "weight": ind.get("weight", 10),
        })

    # 환율 추가 (실시간)
    fx = _fetch_exchange_rate()
    if fx:
        cfg = EXCHANGE_RATE_CONFIG
        fx_val = fx["value"]
        score = _interpolate_score(fx_val, cfg["score_map"])

        # FRED 폴백으로 추세 계산
        fred_rows = _fetch_fred_csv("DEXKOUS", 2)
        trend_val = None
        if len(fred_rows) >= 2:
            trend_val = round(fx_val - fred_rows[-2]["value"], 1)

        trend_icon = "➡️"
        trend_label = "유지"
        if trend_val is not None:
            if trend_val > 1:
                trend_icon = "⬆️"
                trend_label = "상승"
            elif trend_val < -1:
                trend_icon = "⬇️"
                trend_label = "하락"

        kospi_impact = ""
        if trend_val is not None:
            kospi_impact = "코스피 부담" if trend_val > 1 else ("코스피 긍정적" if trend_val < -1 else "")

        results.append({
            "id": "USDKRW",
            "name": cfg["name"],
            "emoji": cfg["emoji"],
            "category": cfg["category"],
            "value": f"{fx_val:,.0f}원",
            "raw_value": fx_val,
            "date": fx["date"],
            "trend_icon": trend_icon,
            "trend_label": trend_label,
            "trend_val": trend_val,
            "explain": cfg["explain"],
            "impact_high": cfg["impact_high"],
            "impact_low": cfg["impact_low"],
            "kospi_impact": kospi_impact,
            "score": score,
            "weight": cfg["weight"],
        })

    # 시장 지수도 함께 수집 + 캐시
    indices = _fetch_market_indices()

    # 나스닥/S&P500 등락률을 점수에 반영
    # 전일 미국 시장이 올랐으면 → 코스피 긍정, 내렸으면 → 코스피 부담
    index_score_map = {
        "나스닥": 20,   # 실시간 (가장 높은 가중치)
        "S&P 500": 15,  # 실시간
    }
    for idx in indices:
        name = idx["name"]
        if name not in index_score_map:
            continue
        pct = idx.get("change_pct", 0)
        # 등락률 → 점수 변환: -3%=10, -1%=30, 0%=50, +1%=70, +3%=90
        if pct <= -3:
            score = 10
        elif pct >= 3:
            score = 90
        else:
            score = round(50 + pct * 20 / 3 * 10 / 20 * 3)  # 선형
            score = max(5, min(95, round(50 + pct * 13.3)))

        kospi_impact = ""
        if pct > 0.3:
            kospi_impact = "코스피 긍정적"
        elif pct < -0.3:
            kospi_impact = "코스피 부담"

        results.append({
            "id": f"INDEX_{name}",
            "name": f"{name} 등락",
            "emoji": idx["emoji"],
            "category": "미국",
            "value": f"{pct:+.2f}%",
            "raw_value": pct,
            "date": idx["date"],
            "trend_icon": "⬆️" if pct > 0 else ("⬇️" if pct < 0 else "➡️"),
            "trend_label": "상승" if pct > 0.1 else ("하락" if pct < -0.1 else "보합"),
            "trend_val": pct,
            "explain": f"전일 {name} 종가 등락률 → 다음날 코스피에 직접 영향",
            "impact_high": f"{name} 상승 → 코스피 동반 상승 기대",
            "impact_low": f"{name} 하락 → 코스피 동반 하락 압력",
            "kospi_impact": kospi_impact,
            "score": score,
            "weight": index_score_map[name],
        })

    if results:
        _save_cache(results, indices)
        print(f"[지표] {len(results)}개 지표 + {len(indices)}개 지수 수집 완료")

    return results


# ============================================================
# 시장 영향력 점수 (0~100)
# ============================================================
def calc_market_score(indicators):
    """가중 평균으로 시장 영향력 종합 점수 산출"""
    if not indicators:
        return 50, "데이터 부족"

    total_weight = sum(ind["weight"] for ind in indicators)
    if total_weight == 0:
        return 50, "데이터 부족"

    weighted_sum = sum(ind["score"] * ind["weight"] for ind in indicators)
    score = round(weighted_sum / total_weight)

    # 종합 판단
    if score >= 75:
        label = "매우 긍정적"
        detail = "물가 안정 + 금리 인하 기대 → 코스피 상승 환경"
    elif score >= 60:
        label = "다소 긍정적"
        detail = "대체로 우호적이나 일부 부담 요인 존재"
    elif score >= 45:
        label = "중립"
        detail = "긍정·부정 요인이 혼재, 개별 종목 선별 중요"
    elif score >= 30:
        label = "다소 부정적"
        detail = "금리·물가 부담이 있는 환경, 방어적 투자 권장"
    else:
        label = "매우 부정적"
        detail = "높은 금리 + 물가 상승 → 코스피 하락 압력 큼"

    return score, label, detail


# ============================================================
# HTML 생성
# ============================================================
def build_indicators_html(indicators=None, compact=False):
    """경제 지표 현황판 HTML (compact=True: 홈페이지, False: 일일포스트)"""
    if indicators is None:
        indicators = fetch_all_indicators()

    if not indicators:
        return ""

    score, label, detail = calc_market_score(indicators)

    # 점수 게이지 색상
    if score >= 60:
        gauge_color = "#38a169"
        gauge_bg = "#f0fff4"
    elif score >= 45:
        gauge_color = "#dd6b20"
        gauge_bg = "#fffaf0"
    else:
        gauge_color = "#e53e3e"
        gauge_bg = "#fff5f5"

    # 시장 지수 바 (캐시 우선, 없으면 실시간)
    try:
        indices = get_cached_indices() or _fetch_market_indices()
        indices_html = build_indices_html(indices)
    except Exception:
        indices_html = ""

    # 기준 시간 (캐시 생성 시간 또는 현재)
    cached = _load_cache()
    if cached and cached.get("cached_at"):
        try:
            ct = datetime.fromisoformat(cached["cached_at"])
            time_str = f"{ct.month}월 {ct.day}일 오전 {ct.hour}시 기준" if ct.hour < 12 else f"{ct.month}월 {ct.day}일 오후 {ct.hour - 12}시 기준"
        except Exception:
            time_str = ""
    else:
        now = datetime.now()
        time_str = f"{now.month}월 {now.day}일 오전 {now.hour}시 기준" if now.hour < 12 else f"{now.month}월 {now.day}일 오후 {now.hour - 12}시 기준"

    html = f"""
    <div class="section" id="indicators">
        <h2>📊 경제 지표 현황 <span style="font-size:0.55em; font-weight:400; color:#a0aec0;">{time_str}</span></h2>
"""

    # 시장 지수 (나스닥, S&P500, 코스피, 코스닥)
    html += indices_html

    # 시장 영향력 점수 게이지
    html += f"""
        <div style="background:{gauge_bg}; border:2px solid {gauge_color}; border-radius:12px; padding:20px; margin-bottom:15px; text-align:center;">
            <div style="font-size:0.9em; color:#718096; margin-bottom:5px;">시장 영향력 점수</div>
            <div style="font-size:2.5em; font-weight:800; color:{gauge_color};">{score}<span style="font-size:0.4em; font-weight:400;">점</span></div>
            <div style="font-size:1.1em; font-weight:600; color:{gauge_color}; margin:3px 0;">{label}</div>
            <div style="font-size:0.85em; color:#4a5568;">{detail}</div>
            <div style="margin-top:10px; background:#e2e8f0; border-radius:10px; height:10px; overflow:hidden;">
                <div style="background:{gauge_color}; height:100%; width:{score}%; border-radius:10px; transition:width 0.5s;"></div>
            </div>
            <div style="display:flex; justify-content:space-between; font-size:0.7em; color:#a0aec0; margin-top:3px;">
                <span>0 (매우 부정)</span><span>50 (중립)</span><span>100 (매우 긍정)</span>
            </div>
        </div>
"""

    if not compact:
        html += """
        <div style="background:#ebf8ff; border:1px solid #bee3f8; border-radius:8px; padding:14px; margin-bottom:15px; font-size:0.9em; color:#2c5282;">
            <b>이 숫자들이 왜 중요할까?</b><br>
            미국 경제 지표 → 금리 방향 결정 → 한국 주식시장 영향<br>
            특히 <b>기준금리</b>·<b>물가(CPI)</b>·<b>환율</b>이 코스피에 가장 큰 영향을 줍니다.
        </div>
"""

    # 카테고리별 분리
    us_indicators = [i for i in indicators if i["category"] == "미국"]
    kr_indicators = [i for i in indicators if i["category"] == "한국"]

    for category, inds in [("🇺🇸 미국", us_indicators), ("🇰🇷 한국", kr_indicators)]:
        if not inds:
            continue

        html += f"""
        <div style="margin-bottom:12px;">
            <div style="font-weight:600; color:#2d3748; font-size:0.95em; margin-bottom:8px; padding-left:4px;">{category}</div>
            <div style="display:grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap:10px;">
"""
        for ind in inds:
            # 추세 색상
            trend_color = "#718096"
            if ind["trend_label"] == "상승":
                trend_color = "#e53e3e"
            elif ind["trend_label"] == "하락":
                trend_color = "#3182ce"

            # 코스피 영향 뱃지
            impact_badge = ""
            if ind["kospi_impact"]:
                if "긍정" in ind["kospi_impact"]:
                    impact_badge = '<span style="background:#f0fff4; color:#38a169; font-size:0.7em; padding:2px 6px; border-radius:8px; margin-left:5px;">긍정</span>'
                else:
                    impact_badge = '<span style="background:#fff5f5; color:#e53e3e; font-size:0.7em; padding:2px 6px; border-radius:8px; margin-left:5px;">부담</span>'

            # 날짜를 "M/D 기준" 형태로
            date_display = ind.get("date", "")
            try:
                dt = datetime.strptime(date_display, "%Y-%m-%d")
                date_display = f"{dt.month}/{dt.day} 기준"
            except Exception:
                date_display = date_display + " 기준" if date_display else ""

            # 개별 점수 바
            ind_score = ind.get("score", 50)
            bar_color = "#38a169" if ind_score >= 60 else ("#dd6b20" if ind_score >= 40 else "#e53e3e")

            # 변화량
            trend_detail = ""
            if ind["trend_val"] is not None and abs(ind["trend_val"]) > 0.01:
                sign = "+" if ind["trend_val"] > 0 else ""
                trend_detail = f' ({sign}{ind["trend_val"]})'

            html += f"""
                <div style="background:#fff; border-radius:8px; border:1px solid #e2e8f0; padding:14px; box-shadow:0 1px 2px rgba(0,0,0,0.05);">
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <span style="font-weight:600; color:#2d3748; font-size:0.88em;">{ind['emoji']} {ind['name']}</span>
                        {impact_badge}
                    </div>
                    <div style="font-size:1.35em; font-weight:700; color:#1a365d; margin:6px 0 3px;">
                        {ind['value']}
                        <span style="color:{trend_color}; font-size:0.55em;">{ind['trend_icon']} {ind['trend_label']}{trend_detail}</span>
                    </div>
                    <div style="background:#e2e8f0; border-radius:4px; height:5px; margin:6px 0;">
                        <div style="background:{bar_color}; height:100%; width:{ind_score}%; border-radius:4px;"></div>
                    </div>
                    <div style="display:flex; justify-content:space-between; font-size:0.75em; color:#a0aec0;">
                        <span>{date_display}</span>
                        <span>{ind_score}점</span>
                    </div>
"""
            if not compact:
                html += f'                    <div style="font-size:0.8em; color:#718096; margin-top:5px; padding-top:5px; border-top:1px solid #f0f0f0;">{ind["explain"]}</div>\n'

            html += "                </div>\n"

        html += "            </div>\n        </div>\n"

    # 점수 산출 설명
    if not compact:
        html += """
        <div style="font-size:0.8em; color:#a0aec0; margin-top:10px; text-align:center;">
            * 시장 영향력 점수 = 각 지표의 코스피 영향도를 가중 평균 (0~100점)<br>
            * 데이터: FRED (미국 연준) + fawazahmed0 (환율) | 각 지표별 기준일 표시
        </div>
"""

    html += "    </div>\n"
    return html


# ============================================================
# 홈페이지용 간단 요약 (점수 + 핵심 3개)
# ============================================================
def build_index_summary_html(indicators=None):
    """홈페이지용 초간단 요약: 점수 + 핵심 지표 3개"""
    if indicators is None:
        indicators = fetch_all_indicators()

    if not indicators:
        return ""

    score, label, detail = calc_market_score(indicators)

    # 점수 색상
    if score >= 60:
        color = "#38a169"
    elif score >= 45:
        color = "#dd6b20"
    else:
        color = "#e53e3e"

    # 핵심 지표 3개 (기준금리, 환율, CPI)
    key_ids = ["DFEDTARU", "USDKRW", "CPIAUCSL"]
    key_inds = [i for i in indicators if i["id"] in key_ids]

    key_html = ""
    for ind in key_inds:
        key_html += f'<span style="margin:0 10px; color:#2d3748; font-size:0.9em;">{ind["emoji"]} {ind["name"]}: <b>{ind["value"]}</b></span>'

    return f"""
    <div style="background:#fff; border:2px solid {color}; border-radius:12px; padding:18px; margin:15px 0; text-align:center; box-shadow:0 2px 6px rgba(0,0,0,0.06);">
        <div style="font-size:0.85em; color:#718096;">시장 영향력 점수</div>
        <div style="font-size:2em; font-weight:800; color:{color}; margin:3px 0;">{score}<span style="font-size:0.4em; font-weight:400;">점</span> — {label}</div>
        <div style="font-size:0.85em; color:#4a5568; margin-bottom:8px;">{detail}</div>
        <div style="display:flex; justify-content:center; flex-wrap:wrap; gap:5px;">
            {key_html}
        </div>
    </div>
"""


def _load_cache():
    try:
        if not os.path.exists(CACHE_FILE):
            return None
        with open(CACHE_FILE, "r") as f:
            data = json.load(f)
        cached_at = datetime.fromisoformat(data.get("cached_at", "2000-01-01"))
        if (datetime.now() - cached_at).total_seconds() > CACHE_MAX_AGE_HOURS * 3600:
            return None
        return data
    except Exception:
        return None


def _save_cache(indicators, indices=None):
    try:
        data = {
            "cached_at": datetime.now().isoformat(),
            "indicators": indicators,
            "indices": indices or [],
        }
        with open(CACHE_FILE, "w") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"[지표] 캐시 저장 실패: {e}")


if __name__ == "__main__":
    # 캐시 삭제하고 테스트
    if os.path.exists(CACHE_FILE):
        os.remove(CACHE_FILE)
    indicators = fetch_all_indicators()
    print("\n=== 지표 현황 ===")
    for ind in indicators:
        print(f"{ind['emoji']} {ind['name']}: {ind['value']} {ind['trend_icon']} | 점수: {ind['score']}점 | {ind['kospi_impact']}")
    score, label, detail = calc_market_score(indicators)
    print(f"\n🎯 종합 점수: {score}점 — {label}")
    print(f"   {detail}")
