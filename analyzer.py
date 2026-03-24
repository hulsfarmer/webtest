"""MarketSignal - AI News Analyzer v3.0 (market-aware + price-aware + 3-tier filter)"""
import json
import time
from datetime import datetime
from anthropic import Anthropic
from database import (get_conn, insert_score, get_prev_score,
                      get_category_weights, get_price_snapshot)
from config import ANTHROPIC_API_KEY, TOP_100_STOCKS


client = Anthropic(api_key=ANTHROPIC_API_KEY)


def get_technical_penalty(price_data):
    """Calculate automatic overheat penalty based on price data.
    Returns (total_penalty, warning_label) tuple.

    Rules:
    - 5d return > 20%: -15 (extreme rally, likely priced-in)
    - 5d return > 10%: -10 (strong rally, partially priced-in)
    - RSI > 80: -15 (extreme overbought)
    - RSI > 70: -10 (overbought)
    - Volume ratio > 3x AND RSI > 70: -10 (speculative frenzy)
    - 20d return > 30%: -10 (extended move)
    """
    if not price_data:
        return 0, ""

    penalty = 0
    warnings = []

    r5d = price_data.get("change_rate_5d", 0) or price_data.get("r5d", 0)
    r20d = price_data.get("change_rate_20d", 0) or price_data.get("r20d", 0)
    rsi = price_data.get("rsi_14", 50) or price_data.get("rsi", 50)
    vol_ratio = price_data.get("volume_ratio", 1.0) or price_data.get("vol_ratio", 1.0)

    # 5-day return overheat
    if r5d > 20:
        penalty += 15
        warnings.append(f"5일 +{r5d:.1f}% 급등 (재료소멸 위험)")
    elif r5d > 10:
        penalty += 10
        warnings.append(f"5일 +{r5d:.1f}% 상승 (차익실현 주의)")

    # RSI overbought
    if rsi > 80:
        penalty += 15
        warnings.append(f"RSI {rsi:.0f} 극과매수")
    elif rsi > 70:
        penalty += 10
        warnings.append(f"RSI {rsi:.0f} 과매수")

    # Speculative frenzy (high volume + overbought)
    if vol_ratio > 3.0 and rsi > 70:
        penalty += 10
        warnings.append(f"거래량 {vol_ratio:.1f}배 + 과매수 (투기적 과열)")

    # Extended 20-day move
    if r20d > 30:
        penalty += 10
        warnings.append(f"20일 +{r20d:.1f}% 급등 (조정 가능)")

    # Cap at 40
    penalty = min(penalty, 40)
    warning_label = " | ".join(warnings) if warnings else ""

    return penalty, warning_label


def _build_price_context(price_data):
    """Build price context string for AI prompt"""
    if not price_data:
        return ""

    price = price_data.get("current_price", 0) or price_data.get("price", 0)
    r1d = price_data.get("change_rate_1d", 0) or price_data.get("r1d", 0)
    r5d = price_data.get("change_rate_5d", 0) or price_data.get("r5d", 0)
    r20d = price_data.get("change_rate_20d", 0) or price_data.get("r20d", 0)
    rsi = price_data.get("rsi_14", 50) or price_data.get("rsi", 50)
    vol_ratio = price_data.get("volume_ratio", 1.0) or price_data.get("vol_ratio", 1.0)

    context = f"""
[현재 주가 데이터]
- 현재가: {price:,}원
- 전일비: {r1d:+.1f}%
- 5일 수익률: {r5d:+.1f}%
- 20일 수익률: {r20d:+.1f}%
- RSI(14): {rsi:.0f}
- 거래량 비율(오늘/20일평균): {vol_ratio:.1f}배
"""

    # Add interpretation hints
    hints = []
    if r5d > 15:
        hints.append("- 5일간 15% 이상 급등한 종목은 호재가 이미 주가에 반영(재료 소멸)되었을 가능성이 높습니다.")
    if rsi > 70:
        hints.append(f"- RSI {rsi:.0f}은 과매수 영역입니다. 단기 조정 가능성을 고려하세요.")
    if vol_ratio > 3:
        hints.append(f"- 거래량이 평소의 {vol_ratio:.1f}배로 급증했습니다. 투기적 과열 신호일 수 있습니다.")
    if r20d > 30:
        hints.append(f"- 20일간 {r20d:.0f}% 상승은 과도합니다. 뉴스가 긍정적이더라도 이미 반영된 재료일 수 있습니다.")

    if hints:
        context += "\n[해석 가이드]\n" + "\n".join(hints)

    return context


def analyze_stock_news(stock_code, stock_name_kr, news_list,
                       category_weights=None, price_data=None,
                       market_context=None):
    """Analyze news for a single stock (v3.0: market-aware + price-aware)"""
    if not news_list:
        return {
            "score": 50,
            "positive": 0,
            "negative": 0,
            "neutral": 0,
            "key_news": "",
            "comment": "뉴스 없음",
            "categories": [],
        }

    news_text = ""
    for i, n in enumerate(news_list, 1):
        news_text += f"{i}. {n['title']}\n"
        if n.get("summary"):
            news_text += f"   {n['summary'][:150]}\n"

    weight_info = ""
    if category_weights:
        weight_info = "\n카테고리별 가중치 (과거 정확도 기반):\n"
        for cat, w in sorted(category_weights.items(), key=lambda x: -x[1])[:10]:
            weight_info += f"  - {cat}: {w:.2f}\n"

    price_context = _build_price_context(price_data)

    # 시장 컨텍스트 문자열 생성
    market_ctx = ""
    if market_context:
        ms = market_context.get("market_score", 50)
        ml = market_context.get("market_label", "중립")
        nasdaq = market_context.get("nasdaq_pct", 0)
        vix = market_context.get("vix", 0)
        mode = market_context.get("market_mode", "중립장")
        if ms >= 60:
            tone = f"시장 환경이 우호적({ms}점, {ml})이므로 개별 호재의 상승 탄력을 인정하되, 과열 여부는 주의하세요."
        elif ms <= 40:
            tone = f"시장이 부정적({ms}점, {ml})인 약세장입니다. 이 종목의 호재가 시장 하락 압력을 이길 만큼 강력한지 엄격하게 평가하세요."
        else:
            tone = f"시장 환경은 중립({ms}점)입니다. 개별 종목의 뉴스 자체에 집중하세요."
        market_ctx = f"""
[현재 시장 환경] {mode}
- 시장 영향력 점수: {ms}점 ({ml})
- 전일 나스닥: {nasdaq:+.2f}%
- VIX: {vix:.1f}
- {tone}
"""

    prompt = f"""당신은 한국 주식 뉴스 분석 전문가입니다.
아래는 [{stock_name_kr}]에 대한 오늘의 뉴스와 주가 데이터입니다.
{market_ctx}
{news_text}
{price_context}
{weight_info}

중요 원칙:
1. 주가가 이미 크게 올랐다면(5일 +10% 이상), 긍정 뉴스는 "이미 반영된 재료"일 가능성이 높습니다.
2. RSI 70 이상은 과매수 영역으로, 추가 상승 여력이 제한적입니다.
3. "과거에 올랐다"는 뉴스는 미래 상승을 의미하지 않습니다. 오히려 차익실현 매물이 나올 수 있습니다.
4. 뉴스의 "방향"뿐 아니라, 아직 주가에 반영되지 않은 "새로운 정보"인지 판단하세요.

다음 JSON 형식으로 분석해주세요:
{{
  "score": 1~100 정수 (50=중립, 70+=긍정, 30-=부정),
  "positive": 긍정 뉴스 수,
  "negative": 부정 뉴스 수,
  "neutral": 중립 뉴스 수,
  "key_news": "가장 영향력 있는 뉴스 한 줄 요약",
  "comment": "내일 주가에 미칠 영향 2~3문장 (주가 데이터 고려)",
  "categories": ["실적", "수주", "규제"] 등 뉴스 카테고리 목록
}}

점수 기준:
- 80~100: 매우 긍정적 (대형 호재, 실적 대폭 개선, 아직 반영 안 된 것)
- 60~79: 긍정적 (수주, 신사업, 호실적)
- 40~59: 중립 (일반 뉴스, 혼재, 이미 반영된 재료)
- 20~39: 부정적 (실적 악화, 소송, 규제)
- 1~19: 매우 부정적 (대형 악재, 사고)

JSON만 출력하세요."""

    try:
        response = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=500,
            messages=[{"role": "user", "content": prompt}],
        )
        text = response.content[0].text.strip()

        if "```" in text:
            text = text.split("```")[1]
            if text.startswith("json"):
                text = text[4:]
        text = text.strip()

        result = json.loads(text)
        result["score"] = max(1, min(100, int(result.get("score", 50))))
        return result

    except json.JSONDecodeError:
        print(f"  [JSON error] {stock_name_kr}")
        return {"score": 50, "positive": 0, "negative": 0, "neutral": len(news_list),
                "key_news": "", "comment": "분석 실패", "categories": []}
    except Exception as e:
        print(f"  [API error] {stock_name_kr}: {e}")
        return {"score": 50, "positive": 0, "negative": 0, "neutral": len(news_list),
                "key_news": "", "comment": f"API 오류: {str(e)[:50]}", "categories": []}


def _get_market_context():
    """현재 시장 환경 컨텍스트 로드 (경제 지표 + 뉴스)"""
    try:
        from economic_indicators import fetch_all_indicators, calc_market_score, get_cached_indices
        from market_news import get_market_news_score, fetch_and_score_news

        indicators = fetch_all_indicators()
        score, label, detail = calc_market_score(indicators)

        # 나스닥 등락률, VIX 추출
        nasdaq_pct = 0
        vix = 0
        for ind in indicators:
            if ind.get("id") == "INDEX_나스닥":
                nasdaq_pct = ind.get("raw_value", 0)
            elif ind.get("id") == "VIXCLS":
                vix = ind.get("raw_value", 0)

        # 뉴스 점수
        try:
            scored_news, _ = fetch_and_score_news()
            news_score = get_market_news_score(scored_news)
        except Exception:
            news_score = 50

        # 3단계 시장 모드
        if score > 70:
            mode = "강세장 (Risk-On)"
            market_adj = 5  # 보너스
        elif score < 40:
            mode = "약세장 (Risk-Off)"
            market_adj = -15  # 패널티
        else:
            mode = "중립장 (Neutral)"
            market_adj = 0

        return {
            "market_score": score,
            "market_label": label,
            "nasdaq_pct": nasdaq_pct,
            "vix": vix,
            "news_score": news_score,
            "market_mode": mode,
            "market_adj": market_adj,
        }
    except Exception as e:
        print(f"  [시장 컨텍스트 로드 실패] {e}")
        return None


def analyze_all_stocks():
    """Analyze news for all 100 stocks (v3.0: market-aware + price-aware)"""
    today = datetime.now().strftime("%Y-%m-%d")
    conn = get_conn()

    category_weights = get_category_weights(conn)

    # 시장 환경 로드
    market_context = _get_market_context()
    market_adj = 0
    if market_context:
        market_adj = market_context.get("market_adj", 0)
        ms = market_context.get("market_score", 50)
        mode = market_context.get("market_mode", "중립장")
        print(f"  시장 환경: {ms}점 ({mode}), 종목 조정: {market_adj:+d}점")

    # Load today's news per stock
    stock_news = {}
    for code, name_en, name_kr in TOP_100_STOCKS:
        rows = conn.execute("""
            SELECT title, summary, source, url FROM news
            WHERE stock_code = ? AND date = ?
            ORDER BY collected_at DESC LIMIT 5
        """, (code, today)).fetchall()
        stock_news[code] = [dict(r) for r in rows]

    print(f"\n[MarketSignal] AI Analysis v3.0 started ({today})")
    print(f"  Stocks: {len(TOP_100_STOCKS)}, Model: Claude Haiku")
    print(f"  Features: market context + price context + 3-tier filter\n")

    scored_count = 0
    penalized_count = 0

    for i, (code, name_en, name_kr) in enumerate(TOP_100_STOCKS):
        news_list = stock_news.get(code, [])
        prev_score = get_prev_score(conn, code, today)

        # Get price data for context
        price_data = get_price_snapshot(conn, code, today)

        # AI analysis with market + price context
        result = analyze_stock_news(code, name_kr, news_list, category_weights,
                                    price_data, market_context)

        raw_score = result["score"]

        # Apply overheat penalty
        penalty, warning_label = get_technical_penalty(price_data)

        # Apply market filter (3-tier)
        total_adj = penalty - market_adj  # penalty is subtracted, market_adj is added
        final_score = max(1, min(100, raw_score - penalty + market_adj))

        if penalty > 0 or market_adj != 0:
            penalized_count += 1
            adj_str = f" market={market_adj:+d}" if market_adj else ""
            print(f"  [{name_kr}] raw={raw_score} penalty=-{penalty}{adj_str} final={final_score} ({warning_label})")

        insert_score(
            conn, code, today,
            score=final_score,
            prev_score=prev_score,
            pos=result.get("positive", 0),
            neg=result.get("negative", 0),
            neu=result.get("neutral", 0),
            key_news=result.get("key_news", ""),
            ai_comment=result.get("comment", ""),
            warning_label=warning_label,
            raw_score=raw_score,
            penalty=penalty,
        )

        # Save categories
        for cat in result.get("categories", []):
            conn.execute("""
                INSERT OR IGNORE INTO category_weights (category, weight, sample_count, updated_at)
                VALUES (?, 1.0, 0, ?)
            """, (cat, datetime.now().isoformat()))

        scored_count += 1

        if (i + 1) % 20 == 0:
            conn.commit()
            print(f"  -> {i+1}/{len(TOP_100_STOCKS)} analyzed")

        time.sleep(0.5)

    conn.commit()
    conn.close()
    print(f"\n[MarketSignal] Analysis done: {scored_count} stocks scored")
    print(f"  Overheat penalty applied: {penalized_count} stocks")
    return scored_count


if __name__ == "__main__":
    analyze_all_stocks()
