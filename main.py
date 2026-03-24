"""MarketSignal v3.2 - Main Entry Point
모든 파이프라인 06:00 KST 통합 실행
전일 뉴스 + 경제 지표 + 시장 지수 + AI 분석 → 블로그 발행
"""
import sys
import os
import time
import schedule
import threading
from datetime import datetime, timedelta
from http.server import HTTPServer, SimpleHTTPRequestHandler
import functools

sys.path.insert(0, os.path.dirname(__file__))

from database import init_db
from collector import collect_all_news, collect_all_prices
from analyzer import analyze_all_stocks
from publisher import generate_daily_post
from validator import validate_yesterday_scores
from config import BLOG_DIR
from economic_indicators import fetch_all_indicators
from market_news import fetch_and_score_news
from market_feedback import init_feedback_db, feedback_on_morning, feedback_on_close


def job_morning_pipeline():
    """06:00 KST - 전체 파이프라인 (전일 기준)
    1. 경제 지표 + 시장 지수 갱신
    2. 시장 뉴스 수집 + AI 점수화
    3. 종목별 뉴스 수집 (전일)
    4. 가격 데이터 수집
    5. AI 분석 (지표 + 뉴스 + 가격 종합)
    6. 블로그 발행
    """
    # 전일 날짜 (06:00 기준이므로 어제의 데이터)
    yesterday = (datetime.now() - timedelta(days=1)).strftime("%Y-%m-%d")

    print(f"\n{'='*55}")
    print(f"  MarketSignal v3.2 Morning Pipeline")
    print(f"  {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"  대상 날짜: {yesterday} (전일)")
    print(f"{'='*55}\n")

    try:
        # Step 1: 경제 지표 + 시장 지수
        print("[1/6] 경제 지표 + 시장 지수 갱신...")
        for cache_name in ["indicators_cache.json", "market_news_cache.json"]:
            cache_path = os.path.join(os.path.dirname(__file__) or ".", cache_name)
            if os.path.exists(cache_path):
                os.remove(cache_path)
        indicators = fetch_all_indicators()
        print(f"  → {len(indicators)}개 지표 수집 완료")

        # Step 2: 시장 뉴스 + AI 점수화
        print("\n[2/6] 시장 주요 뉴스 수집 + AI 점수화...")
        scored_news, headlines = fetch_and_score_news()
        print(f"  → {len(scored_news)}개 뉴스 점수화 완료")

        # Step 3: 종목별 뉴스 수집
        print("\n[3/6] 종목별 뉴스 수집...")
        collect_all_news()

        # Step 4: 가격 데이터
        print("\n[4/6] 가격 데이터 수집...")
        collect_all_prices()

        # Step 5: AI 분석
        print("\n[5/6] AI 분석 (지표 + 뉴스 + 가격 종합)...")
        analyze_all_stocks()

        # Step 6: 블로그 발행
        print("\n[6/6] 블로그 발행...")
        generate_daily_post()

        # Step 7: 시장 점수 피드백 기록 (예측)
        print("\n[7/7] 시장 점수 피드백 기록...")
        try:
            from economic_indicators import get_cached_indices
            cached_indices = get_cached_indices()
            feedback_on_morning(indicators, cached_indices, scored_news)
        except Exception as fe:
            print(f"  피드백 기록 실패: {fe}")

        print(f"\n{'='*55}")
        print(f"  Pipeline complete! ({yesterday} 기준)")
        print(f"{'='*55}\n")

    except Exception as e:
        print(f"[ERROR] Pipeline failed: {e}")
        import traceback
        traceback.print_exc()


def job_validate():
    """09:10 KST - 전일 점수 검증 (실제 주가 변동과 비교)"""
    now = datetime.now().strftime("%H:%M")
    print(f"\n[Validator] Starting validation ({now})")
    try:
        validate_yesterday_scores()
    except Exception as e:
        print(f"[ERROR] Validation failed: {e}")


def job_feedback_close():
    """16:00 KST - 장 마감 후 실제 코스피 등락 기록 + 신뢰도 계산"""
    print(f"\n[피드백] 장 마감 실제값 기록 ({datetime.now().strftime('%H:%M')})")
    try:
        rel = feedback_on_close()
        if rel.get("ready"):
            print(f"[피드백] ★ 신뢰도 확보! → 종목 점수 반영 검토 가능")
    except Exception as e:
        print(f"[ERROR] 피드백 기록 실패: {e}")


def start_blog_server():
    """Start simple HTTP server for blog"""
    handler = functools.partial(SimpleHTTPRequestHandler, directory=BLOG_DIR)
    server = HTTPServer(("0.0.0.0", 8082), handler)
    print(f"[Blog] http://0.0.0.0:8082")
    server.serve_forever()


def run():
    """Main run loop"""
    init_db()

    # 피드백 DB 초기화
    init_feedback_db()

    # Schedule (KST — server timezone is Asia/Seoul)
    schedule.every().day.at("06:00").do(job_morning_pipeline)
    schedule.every().day.at("09:10").do(job_validate)
    schedule.every().day.at("16:00").do(job_feedback_close)

    print("\n" + "=" * 55)
    print("  MarketSignal v3.2")
    print("  All-in-One Morning Pipeline (06:00 KST)")
    print("  Schedule:")
    print("    06:00  전체 파이프라인 (지표+뉴스+분석+발행)")
    print("    09:10  전일 점수 검증")
    print("    16:00  시장 점수 피드백 (실제값 기록)")
    print(f"  Blog: http://0.0.0.0:8082")
    print("=" * 55)

    # Auto-run if started between 06:00~08:00
    now_kst = datetime.now().hour
    if 6 <= now_kst <= 8:
        print("\n[Auto] 06:00~08:00 범위 — 파이프라인 자동 실행...")
        job_morning_pipeline()

    while True:
        schedule.run_pending()
        time.sleep(30)


if __name__ == "__main__":
    blog_thread = threading.Thread(target=start_blog_server, daemon=True)
    blog_thread.start()
    run()
