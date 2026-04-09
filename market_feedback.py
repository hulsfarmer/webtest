"""MarketSignal - 시장 점수 피드백 시스템
매일 시장 점수(예측)와 실제 코스피 등락(결과)을 기록하고,
상관관계를 계산하여 신뢰도를 축적한다.
포스트모템: 예측이 틀린 원인을 분석하여 개선 데이터를 축적한다.
"""
import sqlite3
import json
import os
from datetime import datetime, timedelta
from config import DB_PATH


def init_feedback_db():
    """피드백 테이블 생성"""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("""
        CREATE TABLE IF NOT EXISTS market_feedback (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            date TEXT NOT NULL UNIQUE,
            -- 아침 6시 예측값
            market_score INTEGER DEFAULT 0,
            market_label TEXT DEFAULT '',
            news_score INTEGER DEFAULT 0,
            nasdaq_pct REAL DEFAULT 0,
            sp500_pct REAL DEFAULT 0,
            -- 장 마감 후 실제값
            kospi_close REAL DEFAULT 0,
            kospi_change_pct REAL DEFAULT 0,
            kosdaq_close REAL DEFAULT 0,
            kosdaq_change_pct REAL DEFAULT 0,
            -- 피드백
            prediction_direction TEXT DEFAULT '',
            actual_direction TEXT DEFAULT '',
            correct INTEGER DEFAULT 0,
            -- 메타
            created_at TEXT,
            validated_at TEXT
        )
    """)
    # 포스트모템 테이블
    conn.execute("""
        CREATE TABLE IF NOT EXISTS prediction_postmortem (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            date TEXT NOT NULL UNIQUE,
            correct INTEGER DEFAULT 0,
            market_score INTEGER DEFAULT 0,
            news_score INTEGER DEFAULT 0,
            kospi_change_pct REAL DEFAULT 0,
            -- 지표별 기여 분석
            indicator_breakdown TEXT DEFAULT '[]',
            -- 오류 분류
            error_type TEXT DEFAULT '',
            error_factors TEXT DEFAULT '[]',
            -- 핵심 교훈
            lesson TEXT DEFAULT '',
            -- 누적 통계 스냅샷
            cumulative_accuracy REAL DEFAULT 0,
            cumulative_correlation REAL DEFAULT 0,
            created_at TEXT
        )
    """)
    conn.commit()
    conn.close()


def record_prediction(date, market_score, market_label, news_score,
                      nasdaq_pct=0, sp500_pct=0):
    """아침 6시: 시장 점수 예측 기록"""
    conn = sqlite3.connect(DB_PATH)
    # 복합 점수: 시장 지표(70%) + 뉴스(30%) — 뉴스도 방향 예측에 반영
    combo = round(market_score * 0.7 + news_score * 0.3)
    # 보합 기준 48~52로 좁힘 (기존 45~55에서 보합함정 4/6 오류 발생)
    if combo >= 52:
        direction = "상승"
    elif combo <= 48:
        direction = "하락"
    else:
        direction = "보합"

    conn.execute("""
        INSERT OR REPLACE INTO market_feedback
        (date, market_score, market_label, news_score,
         nasdaq_pct, sp500_pct, prediction_direction, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    """, (date, market_score, market_label, news_score,
          nasdaq_pct, sp500_pct, direction, datetime.now().isoformat()))
    conn.commit()
    conn.close()
    print(f"[피드백] {date} 예측 기록: 시장={market_score}점({market_label}), "
          f"뉴스={news_score}점, 방향={direction}")


def record_actual(date, kospi_close, kospi_change_pct,
                  kosdaq_close=0, kosdaq_change_pct=0):
    """장 마감 후: 실제 결과 기록"""
    conn = sqlite3.connect(DB_PATH)

    # 실제 방향
    if kospi_change_pct > 0.3:
        actual = "상승"
    elif kospi_change_pct < -0.3:
        actual = "하락"
    else:
        actual = "보합"

    # 예측 방향 가져오기
    row = conn.execute(
        "SELECT prediction_direction FROM market_feedback WHERE date=?",
        (date,)
    ).fetchone()

    correct = 0
    if row:
        pred = row[0]
        # 방향 일치 또는 보합끼리
        if pred == actual:
            correct = 1
        elif pred == "보합" or actual == "보합":
            correct = 0  # 보합은 중립 처리
        else:
            correct = 0

    conn.execute("""
        UPDATE market_feedback
        SET kospi_close=?, kospi_change_pct=?,
            kosdaq_close=?, kosdaq_change_pct=?,
            actual_direction=?, correct=?, validated_at=?
        WHERE date=?
    """, (kospi_close, kospi_change_pct,
          kosdaq_close, kosdaq_change_pct,
          actual, correct, datetime.now().isoformat(), date))
    conn.commit()
    conn.close()
    print(f"[피드백] {date} 실제 기록: 코스피 {kospi_change_pct:+.2f}% ({actual}), "
          f"예측 {'적중' if correct else '실패'}")


def calc_reliability():
    """축적된 데이터로 신뢰도 계산"""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    rows = conn.execute("""
        SELECT * FROM market_feedback
        WHERE validated_at IS NOT NULL
        ORDER BY date DESC
    """).fetchall()
    conn.close()

    if len(rows) < 5:
        return {
            "days": len(rows),
            "min_required": 10,
            "ready": False,
            "message": f"데이터 부족 ({len(rows)}/10일). 계속 축적 중..."
        }

    total = len(rows)
    correct = sum(1 for r in rows if r["correct"])
    accuracy = round(correct / total * 100, 1) if total else 0

    # 최근 10일 정확도
    recent = rows[:10]
    recent_correct = sum(1 for r in recent if r["correct"])
    recent_acc = round(recent_correct / len(recent) * 100, 1) if recent else 0

    # 상관관계: market_score vs kospi_change_pct
    scores = [r["market_score"] for r in rows]
    changes = [r["kospi_change_pct"] for r in rows]
    correlation = _pearson(scores, changes)

    # 신뢰도 판정
    ready = total >= 10 and accuracy >= 60 and abs(correlation) >= 0.3

    result = {
        "days": total,
        "accuracy": accuracy,
        "recent_accuracy": recent_acc,
        "correlation": round(correlation, 3),
        "ready": ready,
        "message": "",
    }

    if ready:
        result["message"] = (f"신뢰도 확보! {total}일 중 {accuracy}% 적중, "
                             f"상관계수 {correlation:.3f}. 종목 점수 반영 가능.")
    else:
        reasons = []
        if total < 10:
            reasons.append(f"데이터 {total}/10일")
        if accuracy < 60:
            reasons.append(f"정확도 {accuracy}%<60%")
        if abs(correlation) < 0.3:
            reasons.append(f"상관계수 {abs(correlation):.3f}<0.3")
        result["message"] = f"아직 미달: {', '.join(reasons)}"

    return result


def get_feedback_summary():
    """피드백 요약 (대시보드/인덱스 페이지용)"""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    rows = conn.execute("""
        SELECT * FROM market_feedback
        WHERE validated_at IS NOT NULL
        ORDER BY date DESC LIMIT 20
    """).fetchall()
    conn.close()

    if not rows:
        return None

    reliability = calc_reliability()

    recent = []
    for r in rows[:7]:
        recent.append({
            "date": r["date"],
            "score": r["market_score"],
            "pred": r["prediction_direction"],
            "actual": r["actual_direction"],
            "kospi_pct": r["kospi_change_pct"],
            "correct": bool(r["correct"]),
        })

    return {
        "reliability": reliability,
        "recent": recent,
    }


def _pearson(x, y):
    """피어슨 상관계수 계산"""
    n = len(x)
    if n < 3:
        return 0
    mx = sum(x) / n
    my = sum(y) / n
    sx = sum((xi - mx) ** 2 for xi in x) ** 0.5
    sy = sum((yi - my) ** 2 for yi in y) ** 0.5
    if sx == 0 or sy == 0:
        return 0
    cov = sum((xi - mx) * (yi - my) for xi, yi in zip(x, y))
    return cov / (sx * sy)


# ── 포스트모템 분석 ──

def analyze_prediction(date):
    """예측과 실제의 차이 원인을 분석하여 postmortem 테이블에 저장"""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row

    row = conn.execute(
        "SELECT * FROM market_feedback WHERE date=? AND validated_at IS NOT NULL",
        (date,)
    ).fetchone()
    if not row:
        conn.close()
        return None

    # 주말 체크
    d = datetime.strptime(date, "%Y-%m-%d")
    if d.weekday() >= 5:
        conn.close()
        return None

    market_score = row["market_score"]
    news_score = row["news_score"]
    kospi_pct = row["kospi_change_pct"]
    nasdaq_pct = row["nasdaq_pct"]
    sp500_pct = row["sp500_pct"]
    correct = row["correct"]
    pred = row["prediction_direction"]
    actual = row["actual_direction"]

    # ── 1. 지표별 기여 분석 (캐시에서 당일 지표 복원 시도) ──
    indicator_breakdown = _analyze_indicators_for_date(
        market_score, news_score, nasdaq_pct, sp500_pct, kospi_pct
    )

    # ── 2. 오류 분류 ──
    error_type, error_factors = _classify_error(
        correct, market_score, news_score, kospi_pct,
        nasdaq_pct, sp500_pct, pred, actual
    )

    # ── 3. 교훈 도출 ──
    lesson = _derive_lesson(error_type, error_factors, market_score,
                            news_score, kospi_pct, nasdaq_pct, pred, actual)

    # ── 4. 누적 통계 ──
    reliability = calc_reliability()
    cum_acc = reliability.get("accuracy", 0)
    cum_corr = reliability.get("correlation", 0)

    # 저장
    conn.execute("""
        INSERT OR REPLACE INTO prediction_postmortem
        (date, correct, market_score, news_score, kospi_change_pct,
         indicator_breakdown, error_type, error_factors, lesson,
         cumulative_accuracy, cumulative_correlation, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (date, correct, market_score, news_score, kospi_pct,
          json.dumps(indicator_breakdown, ensure_ascii=False),
          error_type,
          json.dumps(error_factors, ensure_ascii=False),
          lesson, cum_acc, cum_corr, datetime.now().isoformat()))
    conn.commit()
    conn.close()

    print(f"[포스트모템] {date}: {error_type}")
    if error_factors:
        for f in error_factors:
            print(f"  - {f}")
    print(f"  교훈: {lesson}")

    return {
        "date": date, "correct": correct,
        "error_type": error_type, "error_factors": error_factors,
        "lesson": lesson,
    }


def _analyze_indicators_for_date(market_score, news_score, nasdaq_pct, sp500_pct, kospi_pct):
    """지표별 기여도 분석 — 어떤 지표가 맞고/틀렸는지"""
    breakdown = []

    # 나스닥 신호 vs 실제
    nasdaq_signal = "긍정" if nasdaq_pct > 0.3 else ("부정" if nasdaq_pct < -0.3 else "중립")
    actual_signal = "상승" if kospi_pct > 0.3 else ("하락" if kospi_pct < -0.3 else "보합")
    nasdaq_correct = (nasdaq_pct > 0 and kospi_pct > 0) or (nasdaq_pct < 0 and kospi_pct < 0)
    breakdown.append({
        "name": "나스닥", "weight": 20, "signal": nasdaq_signal,
        "value": nasdaq_pct, "correct": nasdaq_correct,
        "note": f"나스닥 {nasdaq_pct:+.2f}% → 코스피 {kospi_pct:+.2f}%"
    })

    # S&P 500 신호
    sp_signal = "긍정" if sp500_pct > 0.3 else ("부정" if sp500_pct < -0.3 else "중립")
    sp_correct = (sp500_pct > 0 and kospi_pct > 0) or (sp500_pct < 0 and kospi_pct < 0)
    breakdown.append({
        "name": "S&P500", "weight": 15, "signal": sp_signal,
        "value": sp500_pct, "correct": sp_correct,
        "note": f"S&P500 {sp500_pct:+.2f}% → 코스피 {kospi_pct:+.2f}%"
    })

    # 뉴스 점수 신호
    news_signal = "긍정" if news_score > 55 else ("부정" if news_score < 45 else "중립")
    news_correct = (news_score > 55 and kospi_pct > 0.3) or \
                   (news_score < 45 and kospi_pct < -0.3) or \
                   (45 <= news_score <= 55 and abs(kospi_pct) <= 0.3)
    breakdown.append({
        "name": "뉴스점수", "weight": 0, "signal": news_signal,
        "value": news_score, "correct": news_correct,
        "note": f"뉴스 {news_score}점, 실제 {actual_signal}"
    })

    # 종합 점수 vs 실제 방향
    score_signal = "상승" if market_score >= 55 else ("하락" if market_score <= 45 else "보합")
    score_correct = (score_signal == actual_signal)
    breakdown.append({
        "name": "종합점수", "weight": 100, "signal": score_signal,
        "value": market_score, "correct": score_correct,
        "note": f"종합 {market_score}점({score_signal}) vs 실제 {actual_signal}"
    })

    return breakdown


def _classify_error(correct, market_score, news_score, kospi_pct,
                    nasdaq_pct, sp500_pct, pred, actual):
    """오류 유형 분류"""
    if correct:
        return "적중", []

    factors = []

    # 1. 보합 함정: 점수가 45~55에 갇혀 큰 변동 놓침
    if pred == "보합" and abs(kospi_pct) > 1.5:
        factors.append(f"보합함정: 점수 {market_score}(중립대)인데 코스피 {kospi_pct:+.2f}% 큰 변동")

    # 2. 한국 독자 요인: 미국 양호한데 코스피 역행
    if nasdaq_pct > 0.5 and kospi_pct < -1:
        factors.append(f"한국독자하락: 나스닥 {nasdaq_pct:+.2f}%인데 코스피 {kospi_pct:+.2f}%")
    elif nasdaq_pct < -0.5 and kospi_pct > 1:
        factors.append(f"한국독자상승: 나스닥 {nasdaq_pct:+.2f}%인데 코스피 {kospi_pct:+.2f}%")

    # 3. 뉴스 점수 오도: 뉴스 긍정인데 하락 (또는 반대)
    if news_score > 60 and kospi_pct < -1:
        factors.append(f"뉴스과대평가: 뉴스 {news_score}점(긍정)인데 코스피 {kospi_pct:+.2f}%")
    elif news_score < 40 and kospi_pct > 1:
        factors.append(f"뉴스과소평가: 뉴스 {news_score}점(부정)인데 코스피 {kospi_pct:+.2f}%")

    # 4. 매크로 지표 둔감: 점수가 일일 변동을 반영 못함
    score_delta = abs(market_score - 50)
    actual_delta = abs(kospi_pct)
    if score_delta < 8 and actual_delta > 2:
        factors.append(f"매크로둔감: 점수 변동폭 {score_delta}인데 실제 변동 {actual_delta:.1f}%")

    # 5. 방향 반전: 예측과 정반대
    if (pred == "상승" and actual == "하락") or (pred == "하락" and actual == "상승"):
        factors.append(f"방향반전: 예측 {pred} → 실제 {actual}")

    # 오류 유형 결정
    if not factors:
        error_type = "경미한오차"
    elif any("보합함정" in f for f in factors):
        error_type = "보합함정"
    elif any("한국독자" in f for f in factors):
        error_type = "한국독자요인"
    elif any("뉴스" in f for f in factors):
        error_type = "뉴스오도"
    elif any("매크로둔감" in f for f in factors):
        error_type = "매크로둔감"
    elif any("방향반전" in f for f in factors):
        error_type = "방향반전"
    else:
        error_type = "복합오류"

    return error_type, factors


def _derive_lesson(error_type, error_factors, market_score, news_score,
                   kospi_pct, nasdaq_pct, pred, actual):
    """오류 유형별 개선 방향 도출"""
    if error_type == "적중":
        if abs(kospi_pct) > 3:
            return f"큰 변동({kospi_pct:+.2f}%)을 정확히 예측 — 이 패턴 유지"
        return "예측 적중"

    lessons = {
        "보합함정": "점수 45~55 구간이 너무 넓음. 나스닥/환율 등 실시간 지표를 더 반영하거나, 보합 기준을 48~52로 좁히는 것 검토",
        "한국독자요인": "미국 지수와 코스피가 역행 — 환율, 외국인 수급, 한국 정책 뉴스 등 한국 독자 팩터 반영 필요",
        "뉴스오도": "뉴스 점수가 실제 시장 방향과 불일치 — AI 뉴스 평가 프롬프트 개선 또는 뉴스 가중치 하향 필요",
        "매크로둔감": "FRED 매크로 지표(CPI/GDP/실업률)는 월/분기 업데이트라 일일 변동 반영 불가. 실시간 지표(나스닥/VIX/환율) 가중치 상향 필요",
        "방향반전": "예측과 정반대 결과. 지표 구조적 한계일 수 있음 — 최근 오답 패턴 분석 필요",
        "복합오류": "여러 요인이 겹침. 개별 팩터를 분리하여 가중치 재조정 필요",
    }
    return lessons.get(error_type, "분석 필요")


def get_improvement_insights():
    """누적된 포스트모템에서 개선 인사이트 도출"""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    rows = conn.execute("""
        SELECT * FROM prediction_postmortem ORDER BY date
    """).fetchall()
    conn.close()

    if not rows:
        return {"total": 0, "message": "아직 포스트모템 데이터가 없습니다"}

    total = len(rows)
    correct_count = sum(1 for r in rows if r["correct"])
    incorrect = [r for r in rows if not r["correct"]]

    # 오류 유형별 빈도
    error_counts = {}
    for r in incorrect:
        et = r["error_type"]
        error_counts[et] = error_counts.get(et, 0) + 1

    # 오류 유형별 정렬
    sorted_errors = sorted(error_counts.items(), key=lambda x: x[1], reverse=True)

    # 뉴스 점수 유효성
    news_correct = 0
    news_total = 0
    for r in rows:
        ns = r["news_score"]
        kp = r["kospi_change_pct"]
        if ns > 55 and kp > 0.3:
            news_correct += 1
        elif ns < 45 and kp < -0.3:
            news_correct += 1
        elif 45 <= ns <= 55 and abs(kp) <= 0.3:
            news_correct += 1
        news_total += 1
    news_acc = round(news_correct / news_total * 100, 1) if news_total else 0

    # 나스닥 추종률
    nasdaq_follow = 0
    nasdaq_total = 0
    for r in rows:
        breakdown = json.loads(r["indicator_breakdown"]) if r["indicator_breakdown"] else []
        for b in breakdown:
            if b.get("name") == "나스닥":
                nasdaq_total += 1
                if b.get("correct"):
                    nasdaq_follow += 1
    nasdaq_rate = round(nasdaq_follow / nasdaq_total * 100, 1) if nasdaq_total else 0

    # 가장 큰 미스 (절대 오차 기준)
    biggest_miss = None
    max_gap = 0
    for r in rows:
        if not r["correct"]:
            expected_dir = 1 if r["market_score"] >= 55 else (-1 if r["market_score"] <= 45 else 0)
            actual_dir = 1 if r["kospi_change_pct"] > 0 else -1
            gap = abs(r["kospi_change_pct"])
            if expected_dir != actual_dir and gap > max_gap:
                max_gap = gap
                biggest_miss = r["date"]

    # 정확도 추이 (5일 이동평균)
    accuracy_trend = []
    for i in range(4, total):
        window = rows[i-4:i+1]
        win_correct = sum(1 for r in window if r["correct"])
        accuracy_trend.append({
            "date": rows[i]["date"],
            "accuracy_5d": round(win_correct / 5 * 100, 1)
        })

    # 권장사항
    recommendations = []
    if sorted_errors:
        top_error = sorted_errors[0][0]
        count = sorted_errors[0][1]
        if top_error == "보합함정":
            recommendations.append(f"가장 많은 오류: 보합함정({count}회) → 보합 기준을 48~52로 좁히거나, 실시간 지표 비중 상향")
        elif top_error == "한국독자요인":
            recommendations.append(f"가장 많은 오류: 한국독자요인({count}회) → 원/달러 일변동, 외국인 수급 데이터 추가 반영")
        elif top_error == "뉴스오도":
            recommendations.append(f"가장 많은 오류: 뉴스오도({count}회) → AI 뉴스 평가 정확도 {news_acc}%, 프롬프트 개선 필요")
        elif top_error == "매크로둔감":
            recommendations.append(f"가장 많은 오류: 매크로둔감({count}회) → 매크로 지표 가중치 하향, 실시간 지표 상향")

    if news_acc < 50:
        recommendations.append(f"뉴스 점수 정확도 {news_acc}% (50% 미만) → 뉴스 점수의 시장점수 반영 가중치를 줄이거나, 뉴스 평가 AI 프롬프트 개선")
    if nasdaq_rate > 70:
        recommendations.append(f"나스닥 추종률 {nasdaq_rate}% → 나스닥 가중치가 적절")
    elif nasdaq_rate < 50:
        recommendations.append(f"나스닥 추종률 {nasdaq_rate}% (50% 미만) → 한국 독자 요인이 크므로 나스닥 가중치 하향 검토")

    return {
        "total": total,
        "correct": correct_count,
        "accuracy": round(correct_count / total * 100, 1),
        "error_distribution": sorted_errors,
        "news_accuracy": news_acc,
        "nasdaq_follow_rate": nasdaq_rate,
        "biggest_miss": biggest_miss,
        "accuracy_trend": accuracy_trend[-5:] if accuracy_trend else [],
        "recommendations": recommendations,
    }


def backfill_postmortems():
    """기존 데이터에 대해 포스트모템 소급 실행"""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    rows = conn.execute("""
        SELECT date FROM market_feedback
        WHERE validated_at IS NOT NULL
        ORDER BY date
    """).fetchall()
    conn.close()

    count = 0
    for r in rows:
        result = analyze_prediction(r["date"])
        if result:
            count += 1
    print(f"[포스트모템] {count}일 소급 분석 완료")
    return count


# ── main.py에서 호출할 헬퍼 ──

def feedback_on_morning(indicators, indices, scored_news):
    """아침 파이프라인에서 호출: 예측 기록"""
    from economic_indicators import calc_market_score
    from market_news import get_market_news_score

    today = datetime.now().strftime("%Y-%m-%d")
    score, label, _ = calc_market_score(indicators)
    news_score = get_market_news_score(scored_news) if scored_news else 50

    # 나스닥/S&P 등락률 추출
    nasdaq_pct = 0
    sp500_pct = 0
    for idx in (indices or []):
        if idx.get("name") == "나스닥":
            nasdaq_pct = idx.get("change_pct", 0)
        elif idx.get("name") == "S&P 500":
            sp500_pct = idx.get("change_pct", 0)

    record_prediction(today, score, label, news_score, nasdaq_pct, sp500_pct)


def feedback_on_close():
    """장 마감 후 호출: 실제 코스피/코스닥 종가 기록 (네이버 우선)"""
    # 주말(토/일) 스킵 — 시장 데이터 없음
    if datetime.now().weekday() >= 5:
        print("[피드백] 주말 — 스킵")
        return {"ready": False, "message": "주말 스킵"}

    from economic_indicators import _fetch_naver_index_history

    today = datetime.now().strftime("%Y-%m-%d")

    # 코스피 (네이버 - 당일 데이터 빠름)
    kospi_rows = _fetch_naver_index_history("KOSPI", 3)
    kospi_close = 0
    kospi_pct = 0
    if kospi_rows:
        kospi_close = kospi_rows[0]["value"]
        if len(kospi_rows) >= 2 and kospi_rows[1]["value"]:
            kospi_pct = round(
                (kospi_rows[0]["value"] - kospi_rows[1]["value"])
                / kospi_rows[1]["value"] * 100, 2)
        print(f"  코스피: {kospi_close:,.2f} ({kospi_pct:+.2f}%) [{kospi_rows[0]['date']}]")

    # 코스닥 (네이버)
    kosdaq_rows = _fetch_naver_index_history("KOSDAQ", 3)
    kosdaq_close = 0
    kosdaq_pct = 0
    if kosdaq_rows:
        kosdaq_close = kosdaq_rows[0]["value"]
        if len(kosdaq_rows) >= 2 and kosdaq_rows[1]["value"]:
            kosdaq_pct = round(
                (kosdaq_rows[0]["value"] - kosdaq_rows[1]["value"])
                / kosdaq_rows[1]["value"] * 100, 2)
        print(f"  코스닥: {kosdaq_close:,.2f} ({kosdaq_pct:+.2f}%) [{kosdaq_rows[0]['date']}]")

    record_actual(today, kospi_close, kospi_pct, kosdaq_close, kosdaq_pct)

    # 포스트모템 분석
    try:
        pm = analyze_prediction(today)
        if pm:
            print(f"[포스트모템] {today}: {pm['error_type']}")
    except Exception as pe:
        print(f"[포스트모템] 분석 실패: {pe}")

    # 신뢰도 체크
    rel = calc_reliability()
    print(f"[피드백] 신뢰도: {rel['message']}")
    return rel


if __name__ == "__main__":
    import sys
    init_feedback_db()
    print("[피드백] 테이블 생성 완료")

    if len(sys.argv) > 1 and sys.argv[1] == "backfill":
        # 기존 데이터 소급 분석
        backfill_postmortems()
        insights = get_improvement_insights()
        print(f"\n{'='*50}")
        print(f"  포스트모템 인사이트")
        print(f"{'='*50}")
        print(json.dumps(insights, indent=2, ensure_ascii=False))
    else:
        rel = calc_reliability()
        print(f"신뢰도: {rel}")
