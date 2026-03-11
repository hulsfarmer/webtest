import time
import schedule
import pytz
import json
import os
from datetime import datetime, date, time as dtime

from market import scan_candidates, get_stock_price, get_balance, get_kospi_status, get_kospi_minute_ma, get_avg_daily_volume
from strategy import select_best_stock, calc_target_stop, should_sell, update_trailing_stop
from order import buy_market_order, sell_market_order, get_filled_price
from telegram_bot import (
    notify_buy, notify_sell, notify_daily_report,
    notify_no_trade, notify_error, send_message
)
from config import FORCE_SELL_TIME, MAX_TRADES_PER_DAY, DAILY_BUDGET

TRADES_FILE = "trades.json"
KST = pytz.timezone("Asia/Seoul")

# 당일 거래 상태
state = {
    "position": None,         # 현재 보유 포지션
    "trades": [],             # 당일 완료된 거래 내역
    "trade_count": 0,         # 당일 거래 횟수
    "daily_profit": 0,        # 당일 누적 손익
    "today": None,            # 당일 날짜
    "market_safe": True,      # 코스피 필터 통과 여부
    "volume_baselines": {},   # {stock_code: avg_daily_vol} — 아침 스캔 캐시
    "blocked_codes": set()    # 당일 손절 종목 → 재매수 금지
}


def save_trade(trade: dict):
    """거래 내역을 trades.json에 누적 저장"""
    history = []
    if os.path.exists(TRADES_FILE):
        with open(TRADES_FILE, "r") as f:
            history = json.load(f)
    history.append(trade)
    with open(TRADES_FILE, "w") as f:
        json.dump(history, f, ensure_ascii=False, indent=2)


def recover_position():
    """
    봇 재시작 시 실제 보유 종목을 조회해 포지션 복구.
    재시작으로 state가 초기화돼도 미매도 종목을 놓치지 않도록 함.
    """
    try:
        holdings = get_balance()["holdings"]
        if not holdings:
            return
        h = holdings[0]  # 봇은 단일 종목만 보유
        code      = h.get("pdno", "")
        name      = h.get("prdt_name", "")
        qty       = int(h.get("hldg_qty", 0))
        buy_price = int(float(h.get("pchs_avg_pric", 0)))
        if qty <= 0 or not code:
            return
        target, stop = calc_target_stop(buy_price)
        state["position"] = {
            "code": code, "name": name, "qty": qty,
            "buy_price": buy_price, "target": target, "stop": stop,
            "buy_time": "재시작 복구", "order_no": "미확인",
            "trailing_active": False
        }
        msg = f"⚠️ <b>포지션 복구</b>\n{name}({code}) {qty}주 @ {buy_price:,}원\n목표: {target:,} | 손절: {stop:,}"
        print(f"[MAIN] 포지션 복구: {name}({code}) {qty}주 매수가 {buy_price:,}원")
        send_message(msg)
    except Exception as e:
        print(f"[MAIN] 포지션 복구 오류: {e}")


def reset_daily_state():
    """매일 초기화"""
    state["position"] = None
    state["trades"] = []
    state["trade_count"] = 0
    state["daily_profit"] = 0
    state["today"] = date.today().isoformat()
    state["market_safe"] = True
    state["volume_baselines"] = {}
    state["blocked_codes"] = set()
    print(f"\n{'='*50}")
    print(f"[MAIN] {state['today']} 트레이딩 봇 시작")
    print(f"{'='*50}\n")
    send_message(f"🚀 <b>트레이딩 봇 시작</b>\n날짜: {state['today']}")


def morning_scan():
    """장 시작 전 종목 스캐닝 + 코스피 필터 체크 (08:50)"""
    print(f"\n[{now()}] 종목 스캐닝 시작...")

    # 코스피 등락률로 당일 매매 허용 여부 판단
    kospi = get_kospi_status()
    state["market_safe"] = kospi["is_safe"]
    if not kospi["is_safe"]:
        msg = f"코스피 {kospi['change_rate']:+.2f}% — 당일 매매 중단"
        notify_no_trade(msg)
        send_message(f"⚠️ <b>시장 필터 발동</b>\n{msg}")
        return

    try:
        candidates = scan_candidates()  # 아침 스캔은 잔고 조회로 자동 처리
        if not candidates:
            notify_no_trade("스캐닝 결과 적합 종목 없음")
        else:
            # 전일 평균 거래량 캐시 (거래량 폭발 비교 기준값)
            baselines = {}
            for c in candidates:
                avg_vol = get_avg_daily_volume(c["code"])
                baselines[c["code"]] = avg_vol
                print(f"[SCAN] {c['name']} 전일 평균 거래량: {avg_vol:,.0f}")
            state["volume_baselines"] = baselines

            names = ", ".join([f"{c['name']}({c['code']})" for c in candidates[:5]])
            send_message(f"🔍 <b>후보 종목</b>\n{names}\n\n09:30 이후 매수 신호 분석 시작")
    except Exception as e:
        notify_error(f"스캐닝 오류: {e}")


def trading_loop():
    """
    장중 매매 루프 (09:30 ~ 15:20, 1분마다 실행).
    09:00~09:30 개장 직후 변동성 구간은 진입하지 않음.
    """
    if not is_market_open():
        return

    if not state["market_safe"]:
        return

    try:
        # ── 보유 포지션 없음 → 매수 기회 탐색 ──
        if state["position"] is None:
            if state["trade_count"] >= MAX_TRADES_PER_DAY:
                return

            # 코스피 분봉 MA20 기반 동적 진입 기준 결정
            kospi_ma = get_kospi_minute_ma()
            score_threshold = kospi_ma["score_threshold"]
            if score_threshold >= 999:
                print(f"[{now()}] 코스피 MA 필터 발동 — 매매 중단")
                return

            # 예수금 전액 기준으로 후보 스캐닝
            available_cash = get_balance()["available_cash"]
            candidates = scan_candidates(available_cash=available_cash)

            # 당일 손절 종목 제외 (재매수 금지)
            blocked = state["blocked_codes"]
            if blocked:
                before = len(candidates)
                candidates = [c for c in candidates if c["code"] not in blocked]
                filtered = before - len(candidates)
                if filtered > 0:
                    print(f"[MAIN] 손절 종목 {filtered}개 제외: {blocked}")

            # volume_baselines 미캐시 종목 즉시 보완 (봇 재시작 등으로 아침 스캔 놓친 경우)
            for c in candidates:
                if c["code"] not in state["volume_baselines"]:
                    state["volume_baselines"][c["code"]] = get_avg_daily_volume(c["code"])

            best = select_best_stock(candidates, threshold=score_threshold,
                                     volume_baselines=state["volume_baselines"])
            if best is None:
                return

            qty = int(available_cash * 0.95 / best["price"])
            if qty < 1:
                print(f"[{now()}] 가용 현금 부족 ({available_cash:,}원) — 매수 건너뜀")
                return

            code = best["code"]
            name = best["name"]

            result = buy_market_order(code, qty)
            if not result["success"]:
                return

            # 실제 체결 평균가 조회 (최대 10초 대기)
            order_no = result["order_no"]
            filled_price = get_filled_price(order_no, code, max_wait=10)
            if filled_price is None:
                # 체결가 조회 실패 시 현재가로 fallback
                filled_price = get_stock_price(code)["price"]
                print(f"[MAIN] 체결가 조회 실패 → 현재가 {filled_price:,}원으로 대체")

            target, stop = calc_target_stop(filled_price)

            state["position"] = {
                "code": code,
                "name": name,
                "qty": qty,
                "buy_price": filled_price,
                "target": target,
                "stop": stop,
                "buy_time": now(),
                "order_no": order_no,
                "trailing_active": False
            }
            state["trade_count"] += 1

            notify_buy(name, code, filled_price, qty, target, stop)
            print(f"[{now()}] 매수: {name} 체결가 {filled_price:,}원 × {qty}주 | 목표: {target:,} | 손절: {stop:,}")

        # ── 보유 포지션 있음 → 트레일링 스톱 갱신 + 매도 조건 체크 ──
        else:
            pos = state["position"]
            current_price = get_stock_price(pos["code"])["price"]

            # 트레일링 스톱 갱신 (수익 구간 진입 시 손절가 상향)
            pos = update_trailing_stop(pos, current_price)
            state["position"] = pos

            sell_flag, reason = should_sell(current_price, pos["buy_price"], pos["target"], pos["stop"])

            if sell_flag:
                result = sell_market_order(pos["code"], pos["qty"])
                if result["success"]:
                    # 실제 매도 체결 평균가 조회
                    sell_order_no = result["order_no"]
                    filled_sell_price = get_filled_price(sell_order_no, pos["code"], max_wait=10)
                    if filled_sell_price is None:
                        filled_sell_price = get_stock_price(pos["code"])["price"]
                        print(f"[MAIN] 매도 체결가 조회 실패 → 현재가 {filled_sell_price:,}원으로 대체")

                    profit = (filled_sell_price - pos["buy_price"]) * pos["qty"]
                    profit_rate = (filled_sell_price - pos["buy_price"]) / pos["buy_price"] * 100
                    state["daily_profit"] += profit

                    trade = {
                        "date": state["today"],
                        "name": pos["name"],
                        "code": pos["code"],
                        "qty": pos["qty"],
                        "buy_price": pos["buy_price"],
                        "sell_price": filled_sell_price,
                        "profit": profit,
                        "profit_rate": round(profit_rate, 2),
                        "buy_time": pos["buy_time"],
                        "sell_time": now(),
                        "reason": reason,
                        "trailing_used": pos.get("trailing_active", False),
                        "budget": DAILY_BUDGET
                    }
                    state["trades"].append(trade)
                    save_trade(trade)
                    notify_sell(pos["name"], pos["code"], pos["buy_price"], filled_sell_price, pos["qty"], reason)
                    print(f"[{now()}] 매도: {pos['name']} 체결가 {filled_sell_price:,}원 | "
                          f"손익: {profit:+,}원 ({profit_rate:+.2f}%) | {reason}")

                    # 손절 시 당일 재매수 금지
                    if "손절" in reason:
                        state["blocked_codes"].add(pos["code"])
                        print(f"[MAIN] {pos['name']}({pos['code']}) 당일 재매수 금지 등록")

                    state["position"] = None

    except Exception as e:
        print(f"[{now()}] 트레이딩 오류: {e}")
        notify_error(str(e))


def force_sell_all():
    """장 마감 전 강제 매도 (15:20)"""
    if state["position"] is None:
        return

    pos = state["position"]
    print(f"[{now()}] 강제 매도 실행: {pos['name']}")
    result = sell_market_order(pos["code"], pos["qty"])
    if result["success"]:
        sell_order_no = result["order_no"]
        filled_sell_price = get_filled_price(sell_order_no, pos["code"], max_wait=10)
        if filled_sell_price is None:
            filled_sell_price = get_stock_price(pos["code"])["price"]

        profit = (filled_sell_price - pos["buy_price"]) * pos["qty"]
        profit_rate = (filled_sell_price - pos["buy_price"]) / pos["buy_price"] * 100
        state["daily_profit"] += profit

        trade = {
            "date": state["today"],
            "name": pos["name"],
            "code": pos["code"],
            "qty": pos["qty"],
            "buy_price": pos["buy_price"],
            "sell_price": filled_sell_price,
            "profit": profit,
            "profit_rate": round(profit_rate, 2),
            "buy_time": pos["buy_time"],
            "sell_time": now(),
            "reason": "장 마감 강제 매도",
            "trailing_used": pos.get("trailing_active", False),
            "budget": DAILY_BUDGET
        }
        state["trades"].append(trade)
        save_trade(trade)
        notify_sell(pos["name"], pos["code"], pos["buy_price"], filled_sell_price, pos["qty"], "장 마감 강제 매도")
        state["position"] = None


def end_of_day_report():
    """장 마감 후 일일 결과 리포트 (15:35)"""
    today = state["today"] or date.today().isoformat()
    trades = state["trades"]

    if not trades:
        notify_no_trade("오늘 체결된 거래 없음")
    else:
        notify_daily_report(today, state["daily_profit"], trades)

    print(f"\n[{now()}] 오늘 거래 종료")
    print(f"  총 거래 횟수: {len(trades)}회")
    print(f"  총 손익: {state['daily_profit']:+,}원")


def weekly_analysis():
    """매주 금요일 15:40 자동 분석 리포트"""
    now_kst = datetime.now(KST)
    if now_kst.weekday() != 4:  # 4 = 금요일
        return
    print(f"\n[{now()}] 주간 분석 리포트 생성 중...")
    try:
        from analyze import load_trades, send_telegram_summary, analyze
        trades = load_trades()
        if not trades:
            send_message("📊 <b>주간 분석</b>\n이번 주 거래 내역이 없습니다.")
            return
        analyze()
        send_telegram_summary(trades)
        print(f"[{now()}] 주간 분석 완료 → 텔레그램 전송")
    except Exception as e:
        print(f"[{now()}] 주간 분석 오류: {e}")
        notify_error(f"주간 분석 오류: {e}")


def is_market_open() -> bool:
    """
    장 운영 시간 체크 (09:30 ~ 15:20).
    09:00~09:30 개장 직후 변동성 구간 진입 제외.
    """
    now_kst = datetime.now(KST)
    if now_kst.weekday() >= 5:  # 토/일
        return False
    t = now_kst.time()
    return dtime(9, 30) <= t <= dtime(15, 20)


def now() -> str:
    return datetime.now(KST).strftime("%H:%M:%S")


def run():
    """메인 실행"""
    schedule.every().day.at("08:45").do(reset_daily_state)
    schedule.every().day.at("08:50").do(morning_scan)
    schedule.every(1).minutes.do(trading_loop)
    schedule.every().day.at(FORCE_SELL_TIME).do(force_sell_all)
    schedule.every().day.at("15:35").do(end_of_day_report)
    schedule.every().day.at("15:40").do(weekly_analysis)

    print("=" * 50)
    print("  KIS 자동매매 봇 실행 중")
    print(f"  목표: +2.5% / 손절: -1.0%")
    print(f"  진입 시간: 09:30 이후 (개장 초 변동성 회피)")
    print("=" * 50)
    send_message("✅ <b>자동매매 봇 서버 시작</b>\n스케줄 등록 완료")

    if is_market_open():
        reset_daily_state()
        recover_position()   # 재시작 시 보유 종목 복구
        trading_loop()
    else:
        recover_position()   # 장외 시간에도 보유 종목 복구

    while True:
        schedule.run_pending()
        time.sleep(30)


if __name__ == "__main__":
    run()
