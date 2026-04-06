#!/usr/bin/env python3
"""
코인 변동성 돌파봇
- 래리 윌리엄스 변동성 돌파 전략 변형
- 당일 시가 + 전일 변동폭 × k 돌파 시 매수
- 다음 날 00:00 KST 시가 매도
- BTC MA5 추세 필터
"""

import os
import sys
import time
import json
import sqlite3
import logging
from datetime import datetime, timedelta
from pathlib import Path

import pyupbit
from dotenv import load_dotenv

load_dotenv()

from config import (
    UPBIT_ACCESS_KEY, UPBIT_SECRET_KEY, PAPER_TRADING,
    TARGET_COINS, MAX_POSITIONS, POSITION_SIZE_RATIO,
    SCAN_INTERVAL_SEC, SELL_HOUR_KST, SL_PCT,
    K_VALUE, BTC_MA_PERIOD,
    DB_PATH, LOG_PATH, INITIAL_CAPITAL,
)
from strategy import get_btc_filter, get_breakout_targets, check_breakout, check_sell

# ─── 로깅 ───
logger = logging.getLogger("vb")
logger.setLevel(logging.INFO)
logger.propagate = False
if not logger.handlers:
    fmt = logging.Formatter("%(asctime)s [%(levelname)s] %(message)s")
    sh = logging.StreamHandler()
    sh.setFormatter(fmt)
    fh = logging.FileHandler(LOG_PATH, encoding="utf-8")
    fh.setFormatter(fmt)
    logger.addHandler(sh)
    logger.addHandler(fh)

# ─── 업비트 ───
upbit = None
if UPBIT_ACCESS_KEY and UPBIT_SECRET_KEY:
    try:
        upbit = pyupbit.Upbit(UPBIT_ACCESS_KEY, UPBIT_SECRET_KEY)
        logger.info("업비트 API 연결 성공")
    except Exception as e:
        logger.error(f"API 연결 실패: {e}")

MODE = "모의거래" if PAPER_TRADING else "실거래"
logger.info(f"변동성 돌파봇 시작 | {MODE}")
logger.info(f"대상: {', '.join(c.replace('KRW-','') for c in TARGET_COINS)}")
logger.info(f"k={K_VALUE} | BTC MA{BTC_MA_PERIOD} 필터 | MAX_POS={MAX_POSITIONS} | SL={SL_PCT*100}%")


# ─── DB ───
def init_db():
    conn = sqlite3.connect(DB_PATH)
    conn.execute("""CREATE TABLE IF NOT EXISTS positions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        market TEXT NOT NULL,
        entry_price REAL NOT NULL,
        quantity REAL NOT NULL,
        entry_time TEXT NOT NULL,
        target_price REAL NOT NULL,
        open_price REAL NOT NULL,
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


def add_position(market, entry_price, quantity, entry_time, target_price, open_price):
    conn = sqlite3.connect(DB_PATH)
    conn.execute(
        "INSERT INTO positions (market, entry_price, quantity, entry_time, target_price, open_price, status) "
        "VALUES (?,?,?,?,?,?,'open')",
        (market, entry_price, quantity, entry_time, target_price, open_price),
    )
    conn.commit()
    conn.close()
    logger.info(f"포지션 추가: {market} | @{entry_price:,.0f} × {quantity:.6f} | 타겟 {target_price:,.0f}")


def close_position(pos_id, exit_price, reason):
    conn = sqlite3.connect(DB_PATH)
    pos = conn.execute("SELECT * FROM positions WHERE id=?", (pos_id,)).fetchone()
    if pos is None:
        conn.close()
        return

    entry_price = pos[2]
    quantity = pos[3]
    entry_time = pos[4]
    market = pos[1]

    pnl_pct = (exit_price - entry_price) / entry_price
    pnl = quantity * (exit_price - entry_price)

    conn.execute("UPDATE positions SET status='closed' WHERE id=?", (pos_id,))
    conn.execute(
        "INSERT INTO trades (market, entry_price, exit_price, quantity, entry_time, exit_time, pnl, pnl_pct, reason) "
        "VALUES (?,?,?,?,?,?,?,?,?)",
        (market, entry_price, exit_price, quantity, entry_time, datetime.now().isoformat(), pnl, pnl_pct, reason),
    )
    conn.commit()
    conn.close()
    logger.info(f"청산: {market} | {entry_price:,.0f}->{exit_price:,.0f} | {pnl_pct*100:+.2f}% | {pnl:+,.0f}원 | {reason}")


def get_capital() -> float:
    if PAPER_TRADING:
        conn = sqlite3.connect(DB_PATH)
        row = conn.execute("SELECT value FROM bot_state WHERE key='paper_capital'").fetchone()
        conn.close()
        if row:
            return float(row[0])
        return INITIAL_CAPITAL
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


# ─── 매매 ───
def execute_buy(market, price, capital_alloc, target_price, open_price):
    if PAPER_TRADING:
        qty = capital_alloc / price
        logger.info(f"[모의] 매수 {market} | {capital_alloc:,.0f}원 | {qty:.6f}개 | @{price:,.0f}")
        add_position(market, price, qty, datetime.now().isoformat(), target_price, open_price)
        cap = get_capital()
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
                actual_price = pyupbit.get_current_price(market) or price
                actual_qty = capital_alloc / actual_price
                add_position(market, actual_price, actual_qty, datetime.now().isoformat(), target_price, open_price)
                return True
            else:
                err = result.get("error", {}).get("message", "?") if result else "응답없음"
                logger.error(f"매수 실패 {market}: {err}")
                return False
        except Exception as e:
            logger.error(f"매수 에러 {market}: {e}")
            return False


def execute_sell(pos, exit_price, reason):
    market = pos["market"]
    quantity = pos["quantity"]

    if PAPER_TRADING:
        proceeds = quantity * exit_price
        logger.info(f"[모의] 매도 {market} | {quantity:.6f}개 | @{exit_price:,.0f}")
        close_position(pos["id"], exit_price, reason)
        cap = get_capital()
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
                err = result.get("error", {}).get("message", "?") if result else "응답없음"
                logger.error(f"매도 실패 {market}: {err}")
                return False
        except Exception as e:
            logger.error(f"매도 에러 {market}: {e}")
            return False


# ─── 메인 루프 ───
def main():
    init_db()

    if PAPER_TRADING:
        conn = sqlite3.connect(DB_PATH)
        row = conn.execute("SELECT value FROM bot_state WHERE key='paper_capital'").fetchone()
        conn.close()
        if row is None:
            update_paper_capital(INITIAL_CAPITAL)
            logger.info(f"모의거래 초기 자본: {INITIAL_CAPITAL:,}원")

    # 오늘의 돌파 타겟 캐시
    targets = {}
    targets_date = None
    btc_ok = False
    btc_check_time = 0

    logger.info("메인 루프 시작")

    while True:
        try:
            now = datetime.now()
            today_str = now.strftime("%Y-%m-%d")

            # ─── 1) 날짜 변경 → 기존 포지션 전량 매도 + 타겟 재계산 ───
            if targets_date != today_str:
                logger.info(f"=== 새 날짜: {today_str} ===")

                # 전일 포지션 매도 (다음 날 시가 매도 원칙)
                positions = get_open_positions()
                for pos in positions:
                    try:
                        cur = pyupbit.get_current_price(pos["market"])
                        if cur:
                            execute_sell(pos, cur, "익일매도")
                    except Exception as e:
                        logger.error(f"매도 에러: {e}")

                # 타겟 재계산
                time.sleep(1)
                targets = get_breakout_targets()
                targets_date = today_str
                btc_check_time = 0  # BTC 필터 재확인 필요

                for market, t in targets.items():
                    nm = market.replace("KRW-", "")
                    logger.info(f"  {nm}: 시가 {t['open']:,.0f} | 타겟 {t['target']:,.0f} | "
                               f"전일변동 {t['prev_range_pct']:.1f}%")

            # ─── 2) BTC 필터 (10분마다 갱신) ───
            if time.time() - btc_check_time > 600:
                btc_ok = get_btc_filter()
                btc_check_time = time.time()

            # ─── 3) 포지션 손절 체크 ───
            positions = get_open_positions()
            for pos in positions:
                reason, exit_price = check_sell(pos)
                if reason and exit_price:
                    execute_sell(pos, exit_price, reason)

            # ─── 4) 돌파 진입 체크 ───
            positions = get_open_positions()
            if btc_ok and len(positions) < MAX_POSITIONS and targets:
                held = {p["market"] for p in positions}
                signals = check_breakout(targets, held)

                if signals:
                    slots = MAX_POSITIONS - len(positions)
                    capital = get_capital()

                    for sig in signals[:slots]:
                        alloc = capital * POSITION_SIZE_RATIO
                        if alloc < 5000:
                            logger.info(f"자본 부족: {capital:,.0f}원")
                            break

                        current_price = sig["price"]
                        nm = sig["market"].replace("KRW-", "")
                        logger.info(f"진입: {nm} | @{current_price:,.0f} | "
                                   f"시가대비 +{sig['pct_above_open']:.1f}% | 강도 {sig['strength']:.2f}")

                        if execute_buy(sig["market"], current_price, alloc, sig["target"], sig["open"]):
                            capital = get_capital()
                            # 매수 후 같은 코인 타겟 제거 (중복 진입 방지)
                            if sig["market"] in targets:
                                del targets[sig["market"]]

            # 상태 저장
            save_state("last_heartbeat", now.isoformat())
            save_state("positions_count", str(len(get_open_positions())))
            save_state("btc_filter", "on" if btc_ok else "off")
            save_state("targets_date", today_str)

            time.sleep(SCAN_INTERVAL_SEC)

        except KeyboardInterrupt:
            logger.info("종료 요청")
            break
        except Exception as e:
            logger.error(f"메인 루프 에러: {e}", exc_info=True)
            time.sleep(30)


if __name__ == "__main__":
    main()
