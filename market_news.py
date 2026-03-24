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


def fetch_and_score_news():
    """전체 프로세스: 수집 → 점수화 → 캐시"""
    # 캐시 확인
    cached = _load_cache()
    if cached:
        print(f"[시장뉴스] 캐시 사용 ({cached.get('cached_at', '?')})")
        return cached.get("news", []), cached.get("headlines", [])

    headlines = fetch_naver_headlines(10)
    if not headlines:
        return [], []

    scored = score_news_with_ai(headlines)

    # 캐시 저장
    _save_cache(scored, headlines)

    return scored, headlines


def get_market_news_score(scored_news):
    """시장 뉴스 종합 점수 (0~100 스케일)"""
    if not scored_news:
        return 50  # 중립

    total = sum(n.get("score", 0) for n in scored_news)
    avg = total / len(scored_news)  # -5 ~ +5
    # -5~+5 → 0~100 변환
    score = round(50 + avg * 10)
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
