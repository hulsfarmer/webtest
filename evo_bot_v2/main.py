"""
자가진화 트레이딩 봇 v1.0 — 메인 실행 파일
스스로 패턴을 발견하고, 검증하고, 진화하는 봇
"""
import sys
import os
import time
import schedule
import pytz
from datetime import datetime, time as dtime

# 경로 설정
sys.path.insert(0, os.path.dirname(__file__))
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import evo_config
from database import init_db, get_conn
from collector import collect_initial_data, collect_daily
from discoverer import discover_patterns
from trader import PaperTrader
from evolver import evolve

# 텔레그램
try:
    from telegram_bot import send_message
except:
    def send_message(msg): print(f"[TG] {msg}")

KST = pytz.timezone("Asia/Seoul")


def is_market_open():
    now_kst = datetime.now(KST)
    if now_kst.weekday() >= 5:
        return False
    t = now_kst.time()
    return dtime(9, 0) <= t <= dtime(15, 30)


def is_weekday():
    return datetime.now(KST).weekday() < 5


def initial_setup():
    """최초 실행: DB 생성 + 초기 데이터 수집 + 패턴 발견"""
    print("🧬 자가진화 트레이딩 봇 — 초기 설정 시작\n")

    # DB 초기화
    init_db()

    # 데이터 존재 여부 체크
    conn = get_conn()
    count = conn.execute("SELECT COUNT(*) as cnt FROM daily_prices").fetchone()["cnt"]
    conn.close()

    if count < 100:
        print("[설정] 데이터 부족 — 초기 수집 시작...")
        collect_initial_data()

        print("\n[설정] 초기 패턴 발견 시작...")
        discover_patterns()
    else:
        print(f"[설정] 기존 데이터 {count}건 발견 — 초기 수집 스킵")

    print("\n✅ 초기 설정 완료!")


def job_daily_collect():
    """매일 장 마감 후: 데이터 수집 + 피처 계산"""
    if not is_weekday():
        return
    print(f"\n{'='*40}")
    print(f"  📥 일일 데이터 수집 ({datetime.now(KST).strftime('%Y-%m-%d')})")
    print(f"{'='*40}")
    try:
        collect_daily()
    except Exception as e:
        print(f"[오류] 일일 수집 실패: {e}")
        send_message(f"⚠️ 자가진화봇 일일 수집 오류: {e}")


def job_scan_trade():
    """장중: 매매 신호 스캔"""
    if not is_market_open():
        return
    try:
        trader = PaperTrader()
        trader.scan_and_trade()
    except Exception as e:
        print(f"[오류] 스캔/매매 실패: {e}")


def job_monitor():
    """장중: 포지션 모니터링"""
    if not is_market_open():
        return
    try:
        trader = PaperTrader()
        trader.monitor_positions()
    except Exception as e:
        print(f"[오류] 모니터링 실패: {e}")


def job_daily_report():
    """매일: 일일 리포트 + 스냅샷"""
    if not is_weekday():
        return
    try:
        trader = PaperTrader()
        trader.save_snapshot()

        conn = get_conn()
        # 요약 통계
        stats = conn.execute("""
            SELECT COUNT(*) as cnt,
                   SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END) as wins,
                   COALESCE(SUM(pnl), 0) as total_pnl
            FROM trades WHERE status='closed'
        """).fetchone()

        active = conn.execute(
            "SELECT COUNT(*) as cnt FROM rules WHERE status IN ('active','candidate')"
        ).fetchone()["cnt"]
        retired = conn.execute(
            "SELECT COUNT(*) as cnt FROM rules WHERE status='retired'"
        ).fetchone()["cnt"]

        open_trades = conn.execute(
            "SELECT stock_name, buy_price FROM trades WHERE status='open'"
        ).fetchall()

        conn.close()

        trade_count = stats["cnt"] or 0
        win_rate = ((stats["wins"] or 0) / trade_count * 100) if trade_count > 0 else 0
        total_pnl = stats["total_pnl"] or 0

        pos_info = "없음"
        if open_trades:
            pos_info = ", ".join(f"{t['stock_name']}" for t in open_trades)

        msg = (f"📊 <b>자가진화봇 일일리포트</b>\n"
               f"자본: {trader.capital:,}원\n"
               f"보유: {pos_info}\n"
               f"총거래: {trade_count}회 | 승률: {win_rate:.0f}%\n"
               f"총PnL: {total_pnl:+,}원\n"
               f"활성규칙: {active}개 | 폐기: {retired}개\n"
               f"Phase: {evo_config.CURRENT_PHASE}")
        send_message(msg)
        print(msg.replace("<b>", "").replace("</b>", ""))

    except Exception as e:
        print(f"[오류] 일일 리포트 실패: {e}")


def job_weekly_evolve():
    """매주 토요일: 진화 실행"""
    try:
        evolve()
        send_message("🧬 <b>자가진화봇 주간 진화 완료</b>\n상세는 대시보드에서 확인")
    except Exception as e:
        print(f"[오류] 진화 실패: {e}")
        send_message(f"⚠️ 자가진화봇 진화 오류: {e}")


def run():
    """메인 실행 루프"""
    initial_setup()

    # 스케줄 등록
    schedule.every().day.at("15:40").do(job_daily_collect)     # 장 마감 후 수집
    schedule.every().day.at("09:40").do(job_scan_trade)        # 장 시작 후 스캔
    schedule.every().day.at("13:00").do(job_scan_trade)        # 오후 스캔
    schedule.every(10).minutes.do(job_monitor)                  # 포지션 모니터링
    schedule.every().day.at("15:25").do(job_daily_report)       # 일일 리포트
    schedule.every().saturday.at("10:00").do(job_weekly_evolve) # 주간 진화

    print("\n" + "=" * 55)
    print("  🧬 자가진화 트레이딩 봇 v1.0")
    print(f"  자본: {evo_config.INITIAL_CAPITAL:,}원 (가상거래)")
    print(f"  Phase: {evo_config.CURRENT_PHASE}")
    print(f"  대시보드: http://0.0.0.0:{evo_config.DASHBOARD_PORT}")
    print("  스케줄:")
    print("    09:40, 13:00  매매 스캔")
    print("    10분마다      포지션 모니터링")
    print("    15:25         일일 리포트")
    print("    15:40         데이터 수집")
    print("    토요일 10:00  주간 진화")
    print("=" * 55)

    send_message("🧬 <b>자가진화 트레이딩 봇 v1.0 시작</b>\n"
                 f"자본: {evo_config.INITIAL_CAPITAL:,}원 (가상)\n"
                 f"Phase: {evo_config.CURRENT_PHASE}\n"
                 f"스스로 패턴을 발견하고 진화합니다")

    # 재시작 시 즉시 포지션 모니터링 (손절 지연 방지)
    if is_market_open():
        job_monitor()    # 기존 포지션 먼저 체크 (손절/청산)
        job_scan_trade() # 신규 진입 스캔

    while True:
        schedule.run_pending()
        time.sleep(30)


if __name__ == "__main__":
    # 대시보드 별도 프로세스로 실행
    import threading
    try:
        from dashboard import create_app
        app = create_app()
        dash_thread = threading.Thread(
            target=lambda: app.run(
                host=evo_config.DASHBOARD_HOST,
                port=evo_config.DASHBOARD_PORT,
                debug=False,
                use_reloader=False
            ),
            daemon=True
        )
        dash_thread.start()
        print(f"[대시보드] http://0.0.0.0:{evo_config.DASHBOARD_PORT} 시작")
    except Exception as e:
        print(f"[대시보드] 시작 실패 (봇은 정상 작동): {e}")

    run()
