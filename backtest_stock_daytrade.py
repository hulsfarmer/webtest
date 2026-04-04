"""
주식 단타 전략 비교 백테스트
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
evo_bot DB (251종목, 2년 일봉) 기반

전략:
A. 거래대금 급증 + 양봉: 거래대금 5일 평균 3배 + 당일 양봉 + 등락률 2~10%
B. 갭 상승 매수: 시가 > 전일 종가×1.02 + 거래대금 급증
C. 장대양봉 익일 매수: 전일 +5~10% 양봉 → 익일 시가 매수 (기존 스윙 단축)
D. KOSPI 하락일 역행 매수: KOSPI -0.5% 이상 하락인데 +2% 이상 오른 종목
E. 거래대금 폭증 돌파: 거래대금 10배 이상 + 신고가 근접

청산: 당일 종가 청산 (일봉 기준)
수수료: 0.015% × 2 (매수+매도)
"""

import sqlite3
import json
from collections import defaultdict

DB_PATH = "/Users/familyhuls/evo_bot.db"  # 로컬 복사본 사용
COMMISSION = 0.00015 * 2  # 편도 0.015% × 2
MIN_TRADING_VALUE = 5_000_000_000  # 최소 거래대금 50억


def load_data():
    """DB에서 데이터 로드"""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row

    # 일봉
    prices = defaultdict(list)
    for r in conn.execute("SELECT * FROM daily_prices ORDER BY stock_code, date"):
        prices[r["stock_code"]].append(dict(r))

    # KOSPI 지수
    kospi = {}
    for r in conn.execute("SELECT date, close, change_pct FROM index_daily WHERE index_code='KOSPI' ORDER BY date"):
        kospi[r["date"]] = {"close": r["close"], "chg": r["change_pct"]}

    # 종목 정보
    stocks = {}
    for r in conn.execute("SELECT code, name, sector FROM stocks"):
        stocks[r["code"]] = {"name": r["name"], "sector": r["sector"]}

    conn.close()
    return prices, kospi, stocks


def calc_avg_tv(days_list, idx, period=5):
    """과거 N일 평균 거래대금"""
    if idx < period:
        return 0
    vals = [days_list[i]["trading_value"] for i in range(idx - period, idx)]
    return sum(vals) / period if vals else 0


def calc_ma(days_list, idx, period=20, field="close"):
    """이동평균"""
    if idx < period:
        return 0
    return sum(days_list[i][field] for i in range(idx - period, idx)) / period


def calc_highest(days_list, idx, period=60):
    """N일 최고가"""
    if idx < period:
        return float('inf')
    return max(days_list[i]["high"] for i in range(idx - period, idx))


def strategy_a(days, idx):
    """A. 거래대금 급증 + 양봉"""
    d = days[idx]
    if d["trading_value"] < MIN_TRADING_VALUE:
        return False

    avg_tv = calc_avg_tv(days, idx, 5)
    if avg_tv <= 0:
        return False

    tv_ratio = d["trading_value"] / avg_tv
    if tv_ratio < 3.0:
        return False

    # 양봉 + 등락률 2~10%
    if d["close"] <= d["open"]:
        return False

    prev_close = days[idx - 1]["close"]
    if prev_close <= 0:
        return False
    change_pct = (d["close"] / prev_close - 1) * 100
    if change_pct < 2.0 or change_pct > 10.0:
        return False

    return True


def strategy_b(days, idx):
    """B. 갭 상승 매수"""
    d = days[idx]
    if idx < 5:
        return False

    prev_close = days[idx - 1]["close"]
    if prev_close <= 0:
        return False

    # 시가 갭업 2% 이상
    gap = (d["open"] / prev_close - 1) * 100
    if gap < 2.0:
        return False

    # 거래대금 급증
    avg_tv = calc_avg_tv(days, idx, 5)
    if avg_tv <= 0:
        return False
    if d["trading_value"] / avg_tv < 2.0:
        return False

    if d["trading_value"] < MIN_TRADING_VALUE:
        return False

    return True


def strategy_c(days, idx):
    """C. 장대양봉 익일 매수"""
    if idx < 2:
        return False

    prev = days[idx - 1]
    prev_prev = days[idx - 2]

    if prev_prev["close"] <= 0:
        return False

    # 전일 장대양봉 +5~10%
    prev_change = (prev["close"] / prev_prev["close"] - 1) * 100
    if prev_change < 5.0 or prev_change > 10.0:
        return False

    # 전일 양봉
    if prev["close"] <= prev["open"]:
        return False

    # 전일 거래대금 충분
    if prev["trading_value"] < MIN_TRADING_VALUE:
        return False

    return True


def strategy_d(days, idx, kospi):
    """D. KOSPI 하락일 역행 매수"""
    d = days[idx]
    date = d["date"]

    if date not in kospi:
        return False

    # KOSPI -0.5% 이상 하락
    kospi_chg = kospi[date]["chg"]
    if kospi_chg > -0.5:
        return False

    # 해당 종목 +2% 이상 상승
    if idx < 1:
        return False
    prev_close = days[idx - 1]["close"]
    if prev_close <= 0:
        return False
    change = (d["close"] / prev_close - 1) * 100
    if change < 2.0:
        return False

    # 거래대금
    if d["trading_value"] < MIN_TRADING_VALUE:
        return False

    return True


def strategy_e(days, idx):
    """E. 거래대금 폭증 + 신고가 근접"""
    d = days[idx]
    if idx < 60:
        return False

    if d["trading_value"] < MIN_TRADING_VALUE:
        return False

    avg_tv = calc_avg_tv(days, idx, 5)
    if avg_tv <= 0:
        return False
    if d["trading_value"] / avg_tv < 10.0:
        return False

    # 60일 신고가의 95% 이상
    highest = calc_highest(days, idx, 60)
    if d["high"] < highest * 0.95:
        return False

    # 양봉
    if d["close"] <= d["open"]:
        return False

    return True


def simulate_daytrade(d, entry_type="open"):
    """
    당일 단타 시뮬레이션
    entry_type:
      "open" → 시가 매수, 종가 매도
      "mid"  → (시가+고가)/2 매수 추정, 종가 매도
    """
    if entry_type == "open":
        entry = d["open"]
    else:
        entry = (d["open"] + d["high"]) / 2

    if entry <= 0:
        return None

    exit_price = d["close"]
    pnl_pct = (exit_price / entry - 1) * 100 - COMMISSION * 100
    return {
        "pnl_pct": round(pnl_pct, 2),
        "entry": entry,
        "exit": exit_price,
    }


def simulate_nextday(days, idx):
    """
    당일 신호 → 익일 시가 매수 → 익일 종가 매도
    """
    if idx + 1 >= len(days):
        return None

    next_d = days[idx + 1]
    entry = next_d["open"]
    if entry <= 0:
        return None

    exit_price = next_d["close"]

    # 간단한 TP/SL (익일 고가/저가로 체크)
    tp_price = entry * 1.03  # +3%
    sl_price = entry * 0.985  # -1.5%

    if next_d["low"] <= sl_price:
        pnl_pct = -1.5 - COMMISSION * 100
    elif next_d["high"] >= tp_price:
        pnl_pct = 3.0 - COMMISSION * 100
    else:
        pnl_pct = (exit_price / entry - 1) * 100 - COMMISSION * 100

    return {
        "pnl_pct": round(pnl_pct, 2),
        "entry": entry,
        "exit": exit_price,
    }


def main():
    print("=" * 70)
    print("📊 주식 단타 전략 비교 백테스트")
    print("  251종목, 2년 일봉 데이터")
    print("=" * 70)

    print("\n📡 데이터 로드 중...")
    prices, kospi, stocks = load_data()
    print(f"  종목: {len(prices)}개, KOSPI: {len(kospi)}일")

    strategies = {
        "A_거래대금급증양봉": {"func": strategy_a, "desc": "거래대금 5일평균 3배 + 양봉 + 등락률 2~10%"},
        "B_갭상승매수": {"func": strategy_b, "desc": "시가 갭업 2%+ + 거래대금 2배"},
        "C_장대양봉익일": {"func": strategy_c, "desc": "전일 +5~10% 장대양봉 → 익일 매수"},
        "D_KOSPI하락역행": {"func": strategy_d, "desc": "KOSPI -0.5%+ 하락일에 +2%+ 상승 종목"},
        "E_거래대금폭증신고가": {"func": strategy_e, "desc": "거래대금 10배+ + 60일 신고가 근접"},
    }

    # 시뮬레이션 유형
    sim_types = {
        "당일시가→종가": lambda days, idx: simulate_daytrade(days[idx], "open"),
        "익일시가→종가(TP3/SL1.5)": lambda days, idx: simulate_nextday(days, idx),
    }

    # 백테스트 실행
    for strat_name, strat in strategies.items():
        print(f"\n{'━' * 60}")
        print(f"전략 {strat_name}")
        print(f"  {strat['desc']}")
        print(f"{'━' * 60}")

        for sim_name, sim_func in sim_types.items():
            trades = []
            by_year = defaultdict(lambda: {"n": 0, "pnl": 0.0, "wins": 0})
            by_stock = defaultdict(lambda: {"n": 0, "pnl": 0.0, "wins": 0})

            for code, days in prices.items():
                for idx in range(60, len(days)):
                    # 전략 조건 체크
                    if strat_name == "D_KOSPI하락역행":
                        if not strat["func"](days, idx, kospi):
                            continue
                    else:
                        if not strat["func"](days, idx):
                            continue

                    result = sim_func(days, idx)
                    if result is None:
                        continue

                    result["code"] = code
                    result["date"] = days[idx]["date"]
                    result["name"] = stocks.get(code, {}).get("name", code)
                    trades.append(result)

                    year = days[idx]["date"][:4]
                    by_year[year]["n"] += 1
                    by_year[year]["pnl"] += result["pnl_pct"]
                    if result["pnl_pct"] > 0:
                        by_year[year]["wins"] += 1

                    by_stock[code]["n"] += 1
                    by_stock[code]["pnl"] += result["pnl_pct"]
                    if result["pnl_pct"] > 0:
                        by_stock[code]["wins"] += 1

            if not trades:
                print(f"\n  [{sim_name}] 거래 없음")
                continue

            total_pnl = sum(t["pnl_pct"] for t in trades)
            wins = sum(1 for t in trades if t["pnl_pct"] > 0)
            wr = wins / len(trades) * 100
            avg_pnl = total_pnl / len(trades)

            # 100만원 기준 추정 (건당 33만원, 동시 3포지션)
            est_monthly = total_pnl / 100 * 333_000 / 24  # 24개월

            print(f"\n  [{sim_name}]")
            print(f"    거래: {len(trades)}건 | 승률: {wr:.1f}% | 건당: {avg_pnl:+.2f}%")
            print(f"    총PnL: {total_pnl:+.1f}% | 100만원 기준 월평균: {est_monthly:+,.0f}원")

            # 연도별
            print(f"    연도별:")
            for y in sorted(by_year.keys()):
                d = by_year[y]
                yr_wr = d["wins"] / d["n"] * 100 if d["n"] > 0 else 0
                print(f"      {y}: {d['n']:4d}건, 승률 {yr_wr:.1f}%, PnL {d['pnl']:+.1f}%")

            # 상위/하위 종목
            stock_sorted = sorted(by_stock.items(), key=lambda x: x[1]["pnl"], reverse=True)
            print(f"    상위 5 종목:")
            for code, d in stock_sorted[:5]:
                name = stocks.get(code, {}).get("name", code)
                wr_s = d["wins"] / d["n"] * 100 if d["n"] > 0 else 0
                print(f"      {name:12s} ({code}): {d['n']:3d}건, 승률 {wr_s:.0f}%, PnL {d['pnl']:+.1f}%")

            # PnL 분포
            pnls = [t["pnl_pct"] for t in trades]
            pnls.sort()
            print(f"    PnL 분포: 최소 {pnls[0]:+.1f}% / 중간 {pnls[len(pnls)//2]:+.1f}% / 최대 {pnls[-1]:+.1f}%")

    # 전략 요약 비교
    print("\n" + "=" * 70)
    print("📋 전략 요약 비교")
    print("=" * 70)
    print(f"{'전략':24s} {'시뮬':20s} {'건수':>5s} {'승률':>6s} {'건당':>7s} {'월추정':>10s}")
    print(f"{'-'*75}")

    for strat_name, strat in strategies.items():
        for sim_name, sim_func in sim_types.items():
            trades = []
            for code, days in prices.items():
                for idx in range(60, len(days)):
                    if strat_name == "D_KOSPI하락역행":
                        if not strat["func"](days, idx, kospi):
                            continue
                    else:
                        if not strat["func"](days, idx):
                            continue
                    result = sim_func(days, idx)
                    if result:
                        trades.append(result)

            if trades:
                total = sum(t["pnl_pct"] for t in trades)
                wins = sum(1 for t in trades if t["pnl_pct"] > 0)
                wr = wins / len(trades) * 100
                avg = total / len(trades)
                monthly = total / 100 * 333_000 / 24
                print(f"{strat_name:24s} {sim_name:20s} {len(trades):5d} {wr:5.1f}% {avg:+6.2f}% {monthly:+10,.0f}원")

    print("\n✅ 백테스트 완료")


if __name__ == "__main__":
    main()
