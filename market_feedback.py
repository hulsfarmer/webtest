"""MarketSignal - 시장 점수 피드백 시스템
매일 시장 점수(예측)와 실제 코스피 등락(결과)을 기록하고,
상관관계를 계산하여 신뢰도를 축적한다.
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
    conn.commit()
    conn.close()


def record_prediction(date, market_score, market_label, news_score,
                      nasdaq_pct=0, sp500_pct=0):
    """아침 6시: 시장 점수 예측 기록"""
    conn = sqlite3.connect(DB_PATH)
    # 방향 예측: 점수 55+ = 상승, 45- = 하락, 중간 = 보합
    if market_score >= 55:
        direction = "상승"
    elif market_score <= 45:
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

    # 신뢰도 체크
    rel = calc_reliability()
    print(f"[피드백] 신뢰도: {rel['message']}")
    return rel


if __name__ == "__main__":
    init_feedback_db()
    print("[피드백] 테이블 생성 완료")

    # 테스트: 현재 신뢰도
    rel = calc_reliability()
    print(f"신뢰도: {rel}")
