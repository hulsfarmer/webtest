#!/usr/bin/env python3
"""
코인 스윙봇 v5.1 — 메인 루프
- 주식 스윙봇 v5.1 로직 코인 적용
- 5종 특화 (ONT, ONG, ZETA, ZBT, ETH)
- 트레일링스탑 + 48h 타임스탑
"""

import os
import sys
import time
import json
import sqlite3
import logging
from datetime import datetime
from pathlib import Path

import pyupbit
from dotenv import load_dotenv

# .env 로드
load_dotenv()

from config import (
    UPBIT_ACCESS_KEY, UPBIT_SECRET_KEY, PAPER_TRADING,
    TARGET_COINS, MAX_POSITIONS, POSITION_SIZE_RATIO,
    SCAN_INTERVAL_SEC, PRICE_CHECK_SEC,
    SL_PCT, TRAIL_ACTIVATE, TRAIL_DISTANCE, TIME_STOP_HOURS,
    DB_PATH, LOG_PATH, DASHBOARD_PORT,
)
from strategy import check_btc_filter, scan_entry_signals, check_exit, get_updated_trailing

# ─── 로깅 ───
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler(LOG_PATH, encoding="utf-8"),
    ],
)
logger = logging.getLogger("swing")

# ─── 업비트 클라이언트 ───
upbit = None
if UPBIT_ACCESS_KEY and UPBIT_SECRET_KEY:
    try:
        upbit = pyupbit.Upbit(UPBIT_ACCESS_KEY, UPBIT_SECRET_KEY)
        logger.info("업비트 API 연결 성공")
    except Exception as e:
        logger.error(f"API 연결 실패: {e}")

MODE = "모의거래" if PAPER_TRADING else "실거래"
logger.info(f"코인 스윙봇 v5.1 시작 | {MODE}")
logger.info(f"대상: {', '.join(c.replace('KRW-','') for c in TARGET_COINS)}")
logger.info(f"MAX_POSITIONS={MAX_POSITIONS} | SL={SL_PCT*100}% | 트레일링={TRAIL_ACTIVATE*100}%/{TRAIL_DISTANCE*100}% | 타임스탑={TIME_STOP_HOURS}h")


# ─── DB ───
def init_db():
    conn = sqlite3.connect(DB_PATH)
    conn.execute("""CREATE TABLE IF NOT EXISTS positions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        market TEXT NOT NULL,
        entry_price REAL NOT NULL,
        quantity REAL NOT NULL,
        entry_time TEXT NOT NULL,
        highest_price REAL NOT NULL,
        trailing_active INTEGER DEFAULT 0,
        status TEXT DEFAULT 'open'
    )""")
    conn.execute("""CREATE TABLE IF NOT EXISTS trades (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        market TEXT NOT NULL,
        entry_price REAL NOT NULL,
        exit_price REAL NOT NULL,
        quantity REAL NOT NULL,
        entry_time TEXT NOT NULL,
        exit_time TEXT NOT NULL,
        pnl REAL NOT NULL,
        pnl_pct REAL NOT NULL,
        reason TEXT NOT NULL
    )""")
    conn.execute("""CREATE TABLE IF NOT EXISTS bot_state (
        key TEXT PRIMARY KEY,
        value TEXT
    )""")
    conn.commit()
    conn.close()


def get_open_positions() -> list:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    rows = conn.execute("SELECT * FROM positions WHERE status='open'").fetchall()
    conn.close()
    return [dict(r) for r in rows]


def add_position(market, entry_price, quantity, entry_time):
    conn = sqlite3.connect(DB_PATH)
    conn.execute(
        "INSERT INTO positions (market, entry_price, quantity, entry_time, highest_price, trailing_active, status) VALUES (?,?,?,?,?,0,'open')",
        (market, entry_price, quantity, entry_time, entry_price),
    )
    conn.commit()
    conn.close()
    logger.info(f"포지션 추가: {market} | {entry_price:,.0f}원 × {quantity:.6f}")


def close_position(pos_id, exit_price, reason):
    conn = sqlite3.connect(DB_PATH)
    pos = conn.execute("SELECT * FROM positions WHERE id=?", (pos_id,)).fetchone()
    if pos is None:
        conn.close()
        return

    entry_price = pos[2]  # entry_price
    quantity = pos[3]     # quantity
    entry_time = pos[4]   # entry_time
    market = pos[1]       # market

    pnl_pct = (exit_price - entry_price) / entry_price
    pnl = quantity * (exit_price - entry_price)

    conn.execute("UPDATE positions SET status='closed' WHERE id=?", (pos_id,))
    conn.execute(
        "INSERT INTO trades (market, entry_price, exit_price, quantity, entry_time, exit_time, pnl, pnl_pct, reason) VALUES (?,?,?,?,?,?,?,?,?)",
        (market, entry_price, exit_price, quantity, entry_time, datetime.now().isoformat(), pnl, pnl_pct, reason),
    )
    conn.commit()
    conn.close()
    logger.info(f"청산: {market} | {entry_price:,.0f}→{exit_price:,.0f} | {pnl_pct*100:+.2f}% | {pnl:+,.0f}원 | {reason}")


def update_trailing(pos_id, highest, trailing_active):
    conn = sqlite3.connect(DB_PATH)
    conn.execute(
        "UPDATE positions SET highest_price=?, trailing_active=? WHERE id=?",
        (highest, 1 if trailing_active else 0, pos_id),
    )
    conn.commit()
    conn.close()


def get_total_capital() -> float:
    """현재 가용 자본 (원화 잔고)"""
    if PAPER_TRADING:
        conn = sqlite3.connect(DB_PATH)
        row = conn.execute("SELECT value FROM bot_state WHERE key='paper_capital'").fetchone()
        conn.close()
        if row:
            return float(row[0])
        return float(os.getenv("INITIAL_CAPITAL", "1000000"))
    else:
        if upbit:
            try:
                return float(upbit.get_balance("KRW") or 0)
            except Exception:
                return 0
        return 0


def update_paper_capital(amount):
    conn = sqlite3.connect(DB_PATH)
    conn.execute("INSERT OR REPLACE INTO bot_state (key, value) VALUES ('paper_capital', ?)", (str(amount),))
    conn.commit()
    conn.close()


def save_state(key, value):
    conn = sqlite3.connect(DB_PATH)
    conn.execute("INSERT OR REPLACE INTO bot_state (key, value) VALUES (?, ?)", (key, str(value)))
    conn.commit()
    conn.close()


# ─── 매매 실행 ───
def execute_buy(market, price, capital_alloc):
    """매수 실행"""
    if PAPER_TRADING:
        qty = capital_alloc / price
        logger.info(f"[모의] 매수 {market} | {capital_alloc:,.0f}원 | {qty:.6f}개 | @{price:,.0f}")
        add_position(market, price, qty, datetime.now().isoformat())
        # 자본 차감
        cap = get_total_capital()
        update_paper_capital(cap - capital_alloc)
        return True
    else:
        if upbit is None:
            logger.error("API 미연결")
            return False
        try:
            result = upbit.buy_market_order(market, capital_alloc)
            if result and "error" not in result:
                time.sleep(2)
                # 체결가 확인
                actual_price = pyupbit.get_current_price(market) or price
                actual_qty = capital_alloc / actual_price
                add_position(market, actual_price, actual_qty, datetime.now().isoformat())
                return True
            else:
                err = result.get("error", {}).get("message", "알 수 없음") if result else "응답 없음"
                logger.error(f"매수 실패 {market}: {err}")
                return False
        except Exception as e:
            logger.error(f"매수 에러 {market}: {e}")
            return False


def execute_sell(pos, exit_price, reason):
    """매도 실행"""
    market = pos["market"]
    quantity = pos["quantity"]

    if PAPER_TRADING:
        proceeds = quantity * exit_price
        logger.info(f"[모의] 매도 {market} | {quantity:.6f}개 | @{exit_price:,.0f}")
        close_position(pos["id"], exit_price, reason)
        cap = get_total_capital()
        update_paper_capital(cap + proceeds)
        return True
    else:
        if upbit is None:
            return False
        try:
            result = upbit.sell_market_order(market, quantity)
            if result and "error" not in result:
                time.sleep(2)
                actual_price = pyupbit.get_current_price(market) or exit_price
                close_position(pos["id"], actual_price, reason)
                return True
            else:
                err = result.get("error", {}).get("message", "알 수 없음") if result else "응답 없음"
                logger.error(f"매도 실패 {market}: {err}")
                return False
        except Exception as e:
            logger.error(f"매도 에러 {market}: {e}")
            return False


# ─── 대시보드 (별도 스레드) ───
def start_dashboard():
    import threading
    from dashboard import create_app
    app = create_app()

    def run():
        app.run(host="0.0.0.0", port=DASHBOARD_PORT, debug=False)

    t = threading.Thread(target=run, daemon=True)
    t.start()
    logger.info(f"대시보드 시작: http://0.0.0.0:{DASHBOARD_PORT}")


# ─── 메인 루프 ───
def main():
    init_db()

    # 모의거래 초기 자본 설정
    if PAPER_TRADING:
        conn = sqlite3.connect(DB_PATH)
        row = conn.execute("SELECT value FROM bot_state WHERE key='paper_capital'").fetchone()
        conn.close()
        if row is None:
            from config import INITIAL_CAPITAL
            update_paper_capital(INITIAL_CAPITAL)
            logger.info(f"모의거래 초기 자본: {INITIAL_CAPITAL:,}원")

    # 대시보드 시작
    try:
        start_dashboard()
    except Exception as e:
        logger.warning(f"대시보드 시작 실패: {e}")

    last_scan = 0

    logger.info("메인 루프 시작")
    while True:
        try:
            now = time.time()

            # ─── 1) 포지션 모니터링 (1분마다) ───
            positions = get_open_positions()
            for pos in positions:
                reason, exit_price = check_exit(pos)
                if reason and exit_price:
                    execute_sell(pos, exit_price, reason)
                else:
                    # 트레일링 업데이트
                    new_highest, new_trailing = get_updated_trailing(pos)
                    if new_highest != pos["highest_price"] or new_trailing != bool(pos["trailing_active"]):
                        update_trailing(pos["id"], new_highest, new_trailing)

            # ─── 2) 진입 스캔 (1시간마다) ───
            if now - last_scan >= SCAN_INTERVAL_SEC:
                last_scan = now
                positions = get_open_positions()

                if len(positions) >= MAX_POSITIONS:
                    logger.info(f"스캔 스킵: 포지션 {len(positions)}/{MAX_POSITIONS} 꽉 참")
                else:
                    logger.info("=" * 50)
                    logger.info("진입 스캔 시작")

                    # BTC 필터
                    if not check_btc_filter():
                        logger.info("BTC 필터 차단 — 진입 안 함")
                    else:
                        held = {p["market"] for p in positions}
                        candidates = scan_entry_signals(held)

                        if not candidates:
                            logger.info("신호 없음")
                        else:
                            slots = MAX_POSITIONS - len(positions)
                            capital = get_total_capital()

                            for cand in candidates[:slots]:
                                alloc = capital * POSITION_SIZE_RATIO
                                if alloc < 5000:
                                    logger.info(f"자본 부족: {capital:,.0f}원")
                                    break

                                current_price = pyupbit.get_current_price(cand["market"])
                                if current_price is None:
                                    continue

                                logger.info(f"진입: {cand['market']} | @{current_price:,.0f} | "
                                           f"양봉 {cand['change']*100:+.1f}% | RSI {cand['rsi']:.0f} | "
                                           f"거래량 {cand['vol_ratio']:.1f}배")

                                if execute_buy(cand["market"], current_price, alloc):
                                    capital = get_total_capital()

                    logger.info("스캔 완료")
                    logger.info("=" * 50)

            # 상태 저장
            save_state("last_heartbeat", datetime.now().isoformat())
            save_state("positions_count", str(len(get_open_positions())))

            time.sleep(PRICE_CHECK_SEC)

        except KeyboardInterrupt:
            logger.info("종료 요청")
            break
        except Exception as e:
            logger.error(f"메인 루프 에러: {e}", exc_info=True)
            time.sleep(30)


if __name__ == "__main__":
    main()
