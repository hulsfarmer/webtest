"""MarketSignal - 시장 주요 뉴스 수집 + AI 점수화
네이버 금융 주요뉴스 → Claude Haiku로 시장 영향 점수 + 관련 종목 매핑
06:00 KST 기준으로 수집
"""
import json
import os
import re
import urllib.request
from datetime import datetime

# Claude API
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
HAIKU_MODEL = "claude-haiku-4-5-20251001"

CACHE_FILE = os.path.join(os.path.dirname(__file__) or ".", "market_news_cache.json")
CACHE_MAX_AGE_HOURS = 20  # 06:00 → 다음날 06:00


def fetch_naver_headlines(count=10):
    """네이버 금융 주요뉴스 헤드라인 수집"""
    try:
        url = "https://finance.naver.com/news/mainnews.naver"
        req = urllib.request.Request(url, headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
        })
        with urllib.request.urlopen(req, timeout=15) as resp:
            raw = resp.read()
        html = raw.decode("euc-kr", errors="ignore")

        titles = re.findall(
            r'<dd class="articleSubject">\s*<a[^>]*>([^<]+)</a>', html
        )
        headlines = [t.strip() for t in titles[:count] if t.strip()]
        print(f"[시장뉴스] {len(headlines)}개 헤드라인 수집")
        return headlines
    except Exception as e:
        print(f"[시장뉴스] 네이버 뉴스 수집 실패: {e}")
        return []


def score_news_with_ai(headlines):
    """Claude Haiku로 뉴스 점수화 + 관련 종목 매핑"""
    if not headlines:
        return []
    if not ANTHROPIC_API_KEY:
        # API 키 없으면 .env에서 읽기
        env_path = os.path.join(os.path.dirname(__file__) or ".", ".env")
        if os.path.exists(env_path):
            with open(env_path) as f:
                for line in f:
                    if line.startswith("ANTHROPIC_API_KEY="):
                        key = line.strip().split("=", 1)[1].strip().strip('"').strip("'")
                        if key:
                            return _call_haiku(headlines, key)
        print("[시장뉴스] ANTHROPIC_API_KEY 없음 — AI 점수화 건너뜀")
        return _fallback_score(headlines)

    return _call_haiku(headlines, ANTHROPIC_API_KEY)


def _call_haiku(headlines, api_key):
    """Claude Haiku API 호출"""
    news_text = "\n".join(f"{i+1}. {h}" for i, h in enumerate(headlines))

    prompt = f"""다음은 오늘의 한국 금융 주요 뉴스 헤드라인입니다.
각 뉴스에 대해 JSON 배열로 답해주세요.

뉴스:
{news_text}

각 뉴스마다:
1. "summary": 한줄 요약 (20자 이내)
2. "score": 코스피 영향 점수 (-5=매우부정 ~ +5=매우긍정, 0=중립)
3. "stocks": 관련 종목 코드 배열 (예: ["005930","000660"]). 없으면 빈 배열.
4. "stock_impact": 관련 종목에 대한 추가 점수 (-5 ~ +5). 없으면 0.

상위 5개만 중요도 순으로 선별해서 답해주세요.
JSON 배열만 출력하세요. 다른 텍스트 없이."""

    body = json.dumps({
        "model": HAIKU_MODEL,
        "max_tokens": 1024,
        "messages": [{"role": "user", "content": prompt}],
    }).encode("utf-8")

    try:
        req = urllib.request.Request(
            "https://api.anthropic.com/v1/messages",
            data=body,
            headers={
                "Content-Type": "application/json",
                "x-api-key": api_key,
                "anthropic-version": "2023-06-01",
            },
        )
        with urllib.request.urlopen(req, timeout=30) as resp:
            result = json.loads(resp.read().decode("utf-8"))

        text = result.get("content", [{}])[0].get("text", "")
        # JSON 추출
        match = re.search(r'\[.*\]', text, re.DOTALL)
        if match:
            news_items = json.loads(match.group())
            print(f"[시장뉴스] AI 점수화 완료: {len(news_items)}개")
            return news_items
        else:
            print(f"[시장뉴스] AI 응답 파싱 실패")
            return _fallback_score(headlines[:5])

    except Exception as e:
        print(f"[시장뉴스] AI 호출 실패: {e}")
        return _fallback_score(headlines[:5])


def _fallback_score(headlines):
    """AI 없이 키워드 기반 간단 점수화"""
    positive_kw = ["상승", "급등", "강세", "호재", "인하", "반등", "신고가", "매수"]
    negative_kw = ["하락", "급락", "약세", "악재", "인상", "폭락", "위기", "매도", "공포"]

    results = []
    for h in headlines[:5]:
        score = 0
        for kw in positive_kw:
            if kw in h:
                score += 1
        for kw in negative_kw:
            if kw in h:
                score -= 1
        score = max(-5, min(5, score))
        results.append({
            "summary": h[:20],
            "score": score,
            "stocks": [],
            "stock_impact": 0,
        })
    return results




# ── 지정학적/글로벌 리스크 뉴스 ──

GEO_KEYWORDS = [
    "전쟁", "미사일", "폭격", "침공", "군사", "핵",
    "관세", "무역전쟁", "제재", "보복관세", "수출규제",
    "트럼프", "바이든", "시진핑", "푸틴",
    "OPEC", "유가", "원유", "금값",
    "디폴트", "부도", "금융위기", "뱅크런", "서킷브레이커",
    "팬데믹", "봉쇄", "록다운",
    "war", "missile", "tariff", "sanction", "invasion",
]

GEO_POSITIVE_KW = ["휴전", "평화", "합의", "해제", "완화", "협상타결", "정전"]
GEO_NEGATIVE_KW = ["전쟁", "미사일", "침공", "폭격", "핵", "제재", "보복", "위기",
                    "디폴트", "부도", "봉쇄", "서킷브레이커", "war", "invasion", "sanction"]

# ── 코스피 시총 상위 종목 뉴스 ──

KOSPI_HEAVYWEIGHTS = [
    ("005930", "삼성전자", 20),    # ~20% of KOSPI
    ("000660", "SK하이닉스", 8),   # ~8%
    ("005380", "현대차", 4),       # ~4%
    ("207940", "삼성바이오로직스", 3),
    ("000270", "기아", 3),
    ("373220", "LG에너지솔루션", 3),
]


def fetch_heavyweight_news():
    """코스피 시총 상위 종목의 뉴스를 DB에서 수집 (매일 06:00 이미 수집됨)"""
    import sqlite3
    from config import DB_PATH
    from datetime import timedelta
    
    all_news = []
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    
    # 오늘 또는 어제 수집된 뉴스 가져오기
    today = datetime.now().strftime("%Y-%m-%d")
    yesterday = (datetime.now() - timedelta(days=1)).strftime("%Y-%m-%d")
    
    for code, name, weight in KOSPI_HEAVYWEIGHTS:
        rows = conn.execute("""
            SELECT title FROM news 
            WHERE stock_code=? AND date >= ?
            ORDER BY date DESC LIMIT 3
        """, (code, yesterday)).fetchall()
        
        for r in rows:
            all_news.append({
                "stock": name,
                "code": code,
                "weight": weight,
                "headline": r["title"],
            })
    
    conn.close()
    
    if all_news:
        print(f"[대형주뉴스] DB에서 {len(all_news)}개 뉴스 (상위 {len(KOSPI_HEAVYWEIGHTS)}종목)")
    return all_news


def score_heavyweight_news(hw_news):
    """대형주 뉴스 키워드 점수화 (비중 가중)"""
    if not hw_news:
        return 0, []
    
    positive_kw = ["상승", "급등", "신고가", "호재", "매수", "실적개선",
                    "수주", "흑자", "배당", "자사주", "합의", "수출증가"]
    negative_kw = ["하락", "급락", "악재", "매도", "적자", "실적부진",
                    "파업", "소송", "리콜", "감산", "하향", "하회",
                    "공매도", "외국인매도", "경고", "위기"]
    
    scored = []
    for item in hw_news:
        h = item["headline"]
        score = 0
        for kw in positive_kw:
            if kw in h:
                score += 1
        for kw in negative_kw:
            if kw in h:
                score -= 1
        score = max(-5, min(5, score))
        # 비중 가중: 삼성(20%)은 기아(3%)보다 영향 큼
        weighted_score = score * (item["weight"] / 10)  # 삼성: x2, 하이닉스: x0.8
        scored.append({
            "stock": item["stock"],
            "headline": h,
            "raw_score": score,
            "weighted_score": weighted_score,
        })
    
    if not scored:
        return 0, []
    
    avg = sum(s["weighted_score"] for s in scored) / len(scored)
    return avg, scored


def get_heavyweight_score():
    """대형주 뉴스 종합 점수 (0~100 스케일)"""
    hw_news = fetch_heavyweight_news()
    if not hw_news:
        return 50, []
    
    avg_score, scored = score_heavyweight_news(hw_news)
    # weighted avg is roughly -10 ~ +10 → 0~100
    hw_score = round(50 + avg_score * 5)
    hw_score = max(0, min(100, hw_score))
    
    print(f"[대형주뉴스] 종합 점수: {hw_score} (가중평균 {avg_score:+.1f})")
    return hw_score, scored




def fetch_geopolitical_news():
    """구글 뉴스 RSS에서 지정학적 리스크 뉴스 수집"""
    import xml.etree.ElementTree as ET
    
    geo_headlines = []
    
    # 한국어 구글 뉴스: 주요 키워드별 검색
    search_queries = [
        "전쟁+주식시장",
        "관세+코스피",
        "지정학+리스크",
        "글로벌+위기+증시",
    ]
    
    for query in search_queries:
        try:
            encoded_q = urllib.request.quote(query, safe="+")
            url = f"https://news.google.com/rss/search?q={encoded_q}&hl=ko&gl=KR&ceid=KR:ko"
            req = urllib.request.Request(url, headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
            })
            with urllib.request.urlopen(req, timeout=10) as resp:
                xml_text = resp.read().decode("utf-8")
            root = ET.fromstring(xml_text)
            items = root.findall(".//item/title")
            for item in items[:3]:  # 쿼리당 3개
                title = item.text or ""
                # 키워드 매칭 확인
                if any(kw in title for kw in GEO_KEYWORDS):
                    if title not in geo_headlines:
                        geo_headlines.append(title)
        except Exception as e:
            print(f"[지정학] 구글뉴스 검색 실패 ({query}): {e}")
            continue
    
    if not geo_headlines:
        return []
    
    print(f"[지정학] {len(geo_headlines)}개 지정학적 뉴스 감지")
    return geo_headlines[:5]  # 최대 5개


def score_geopolitical_news(geo_headlines):
    """지정학적 뉴스를 키워드 기반으로 점수화 (API 비용 없음)"""
    if not geo_headlines:
        return 0, []
    
    scored = []
    for h in geo_headlines:
        score = 0
        for kw in GEO_NEGATIVE_KW:
            if kw in h.lower():
                score -= 2
        for kw in GEO_POSITIVE_KW:
            if kw in h.lower():
                score += 2
        score = max(-5, min(5, score))
        scored.append({"headline": h, "score": score})
    
    # 평균 점수 (-5 ~ +5)
    avg_score = sum(s["score"] for s in scored) / len(scored) if scored else 0
    return avg_score, scored


def get_geopolitical_risk_score():
    """지정학적 리스크 점수 반환 (0~100 스케일, 50=중립)
    뉴스가 없으면 50(중립) 반환."""
    headlines = fetch_geopolitical_news()
    if not headlines:
        return 50, []
    
    avg_score, scored = score_geopolitical_news(headlines)
    # -5~+5 → 0~100
    risk_score = round(50 + avg_score * 10)
    risk_score = max(0, min(100, risk_score))
    
    print(f"[지정학] 리스크 점수: {risk_score} (뉴스 {len(scored)}개, 평균 {avg_score:+.1f})")
    return risk_score, scored


def fetch_and_score_news():
    """전체 프로세스: 수집 → 점수화 → 캐시"""
    # 캐시 확인
    cached = _load_cache()
    if cached:
        print(f"[시장뉴스] 캐시 사용 ({cached.get('cached_at', '?')})")
        scored = cached.get("news", [])
        headlines = cached.get("headlines", [])
        # 지정학 + 대형주 뉴스는 캐시와 별개로 항상 수집
        try:
            geo_score, geo_items = get_geopolitical_risk_score()
            if geo_items:
                scored = [n for n in scored if not n.get("geo")]
                for g in geo_items:
                    scored.append({
                        "summary": g["headline"][:30],
                        "score": g["score"],
                        "stocks": [],
                        "stock_impact": 0,
                        "geo": True,
                    })
        except Exception as ge:
            print(f"[지정학] 수집 실패: {ge}")
        
        try:
            hw_score, hw_items = get_heavyweight_score()
            if hw_items:
                scored = [n for n in scored if not n.get("heavyweight")]
                for h in hw_items:
                    scored.append({
                        "summary": f"[{h['stock']}] {h['headline'][:25]}",
                        "score": max(-5, min(5, round(h["weighted_score"]))),
                        "stocks": [],
                        "stock_impact": 0,
                        "heavyweight": True,
                    })
        except Exception as he:
            print(f"[대형주뉴스] 수집 실패: {he}")
        
        return scored, headlines

    headlines = fetch_naver_headlines(10)
    if not headlines:
        return [], []

    scored = score_news_with_ai(headlines)

    # 캐시 저장
    _save_cache(scored, headlines)

    # 지정학적 뉴스 수집
    try:
        geo_score, geo_items = get_geopolitical_risk_score()
        if geo_items:
            for g in geo_items:
                scored.append({
                    "summary": g["headline"][:30],
                    "score": g["score"],
                    "stocks": [],
                    "stock_impact": 0,
                    "geo": True,
                })
    except Exception as ge:
        print(f"[지정학] 수집 실패: {ge}")

    # 대형주 뉴스 수집
    try:
        hw_score, hw_items = get_heavyweight_score()
        if hw_items:
            for h in hw_items:
                scored.append({
                    "summary": f"[{h['stock']}] {h['headline'][:25]}",
                    "score": max(-5, min(5, round(h["weighted_score"]))),
                    "stocks": [],
                    "stock_impact": 0,
                    "heavyweight": True,
                })
    except Exception as he:
        print(f"[대형주뉴스] 수집 실패: {he}")

    return scored, headlines


def get_market_news_score(scored_news):
    """시장 뉴스 종합 점수 (0~100 스케일) — 지정학 + 대형주 뉴스 가중 반영"""
    if not scored_news:
        return 50  # 중립

    # 일반/지정학/대형주 뉴스 분리
    regular = [n for n in scored_news if not n.get("geo") and not n.get("heavyweight")]
    geo = [n for n in scored_news if n.get("geo")]
    hw = [n for n in scored_news if n.get("heavyweight")]
    
    regular_avg = sum(n.get("score", 0) for n in regular) / len(regular) if regular else 0
    geo_avg = sum(n.get("score", 0) for n in geo) / len(geo) if geo else 0
    hw_avg = sum(n.get("score", 0) for n in hw) / len(hw) if hw else 0
    
    # 가중 결합: 일반(50%) + 대형주(30%) + 지정학(20%)
    weights = {"regular": 50, "geo": 0, "hw": 0}
    if geo:
        weights["geo"] = 20
        weights["regular"] = 40 if hw else 50
    if hw:
        weights["hw"] = 30
        weights["regular"] = 50 - weights["geo"]  # 남는 비중
    
    total_w = weights["regular"] + weights["geo"] + weights["hw"]
    combined = (regular_avg * weights["regular"] + geo_avg * weights["geo"] + hw_avg * weights["hw"]) / total_w if total_w > 0 else regular_avg
    
    score = round(50 + combined * 10)
    return max(0, min(100, score))


def get_stock_adjustments(scored_news):
    """뉴스 기반 종목별 점수 조정값 반환 {stock_code: adjustment}"""
    adjustments = {}
    for n in scored_news:
        stocks = n.get("stocks", [])
        impact = n.get("stock_impact", 0)
        if not stocks or impact == 0:
            continue
        for code in stocks:
            code = str(code).strip()
            if code:
                adjustments[code] = adjustments.get(code, 0) + impact
    # 최대 ±10 제한
    return {k: max(-10, min(10, v)) for k, v in adjustments.items()}


def build_news_html(scored_news=None, headlines=None, compact=False):
    """시장 뉴스 HTML 섹션"""
    if scored_news is None:
        scored_news, headlines = fetch_and_score_news()

    if not scored_news:
        return ""

    market_score = get_market_news_score(scored_news)

    # 캐시 시간
    cached = _load_cache()
    time_str = ""
    if cached and cached.get("cached_at"):
        try:
            ct = datetime.fromisoformat(cached["cached_at"])
            ampm = "오전" if ct.hour < 12 else "오후"
            h = ct.hour if ct.hour < 12 else ct.hour - 12
            time_str = f"{ct.month}월 {ct.day}일 {ampm} {h}시"
        except Exception:
            pass

    html = f"""
    <div class="section" id="news">
        <h2>📰 시장 주요 뉴스 <span style="font-size:0.55em; font-weight:400; color:#a0aec0;">{time_str} 기준</span></h2>
"""

    if not compact:
        # 뉴스 종합 판단
        if market_score >= 60:
            mood = "긍정적"
            mood_color = "#38a169"
        elif market_score >= 45:
            mood = "중립"
            mood_color = "#dd6b20"
        else:
            mood = "부정적"
            mood_color = "#e53e3e"

        html += f"""
        <div style="background:#fff; border-radius:8px; border:1px solid #e2e8f0; padding:12px; margin-bottom:12px; text-align:center;">
            <span style="color:#718096; font-size:0.85em;">뉴스 분위기</span>
            <span style="color:{mood_color}; font-weight:700; font-size:1.1em; margin-left:8px;">{mood}</span>
            <span style="color:#a0aec0; font-size:0.8em; margin-left:5px;">({market_score}점)</span>
        </div>
"""

    for n in scored_news:
        score = n.get("score", 0)
        summary = n.get("summary", "")

        if score >= 2:
            badge = '<span style="background:#f0fff4; color:#38a169; font-size:0.75em; padding:2px 8px; border-radius:10px;">긍정</span>'
        elif score <= -2:
            badge = '<span style="background:#fff5f5; color:#e53e3e; font-size:0.75em; padding:2px 8px; border-radius:10px;">부정</span>'
        elif score > 0:
            badge = '<span style="background:#f0fff4; color:#38a169; font-size:0.75em; padding:2px 8px; border-radius:10px;">소폭 긍정</span>'
        elif score < 0:
            badge = '<span style="background:#fff5f5; color:#e53e3e; font-size:0.75em; padding:2px 8px; border-radius:10px;">소폭 부정</span>'
        else:
            badge = '<span style="background:#edf2f7; color:#718096; font-size:0.75em; padding:2px 8px; border-radius:10px;">중립</span>'

        # 관련 종목
        stocks = n.get("stocks", [])
        stock_html = ""
        if stocks and not compact:
            stock_tags = " ".join(f'<span style="background:#edf2f7; color:#4a5568; font-size:0.7em; padding:1px 5px; border-radius:4px;">{s}</span>' for s in stocks[:3])
            stock_html = f'<div style="margin-top:4px;">{stock_tags}</div>'

        html += f"""
        <div style="background:#fff; border-radius:8px; border:1px solid #e2e8f0; padding:12px; margin-bottom:8px;">
            <div style="display:flex; align-items:center; gap:8px;">
                {badge}
                <span style="color:#2d3748; font-size:0.9em;">{summary}</span>
            </div>
            {stock_html}
        </div>
"""

    html += "    </div>\n"
    return html


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


def _save_cache(scored_news, headlines):
    try:
        data = {
            "cached_at": datetime.now().isoformat(),
            "news": scored_news,
            "headlines": headlines,
        }
        with open(CACHE_FILE, "w") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"[시장뉴스] 캐시 저장 실패: {e}")


if __name__ == "__main__":
    scored, headlines = fetch_and_score_news()
    print("\n=== 시장 뉴스 ===")
    for n in scored:
        s = n.get("score", 0)
        sign = "+" if s > 0 else ""
        print(f"  [{sign}{s}] {n.get('summary', '')}  종목: {n.get('stocks', [])}")
    print(f"\n뉴스 종합: {get_market_news_score(scored)}점")
