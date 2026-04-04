"""
v4.2 통합 백테스트
기존 단타봇 실적(DB) + ORCA/JST BTC 변동 구간 추가 거래 시뮬레이션

목적: v4.0 대비 v4.2의 개선 효과 측정
"""

import requests
import time
import json
import sqlite3
from datetime import datetime
from collections import defaultdict

UPBIT_REST = "https://api.upbit.com/v1"
DAYS = 30
UNIT = 15


def fetch_candles(market, unit, count=200, to=None):
    params = {"market": market, "count": min(count, 200)}
    if to:
        params["to"] = to
    try:
        r = requests.get(f"{UPBIT_REST}/candles/minutes/{unit}", params=params, timeout=10)
        r.raise_for_status()
        return r.json()
    except:
        return []


def fetch_all_candles(market, days, unit):
    all_c = []
    to = None
    target = days * 24 * 60 // unit
    while len(all_c) < target:
        c = fetch_candles(market, unit=unit, count=200, to=to)
        if not c:
            break
        all_c.extend(c)
        to = c[-1]["candle_date_time_kst"]
        time.sleep(0.12)
    all_c.sort(key=lambda x: x["candle_date_time_kst"])
    seen = set()
    return [c for c in all_c if not (c["candle_date_time_kst"] in seen or seen.add(c["candle_date_time_kst"]))]


def sim_trade(candles, entry_idx, tp, sl, trail_act, trail_dist, max_bars):
    ep = candles[entry_idx]["trade_price"]
    tp_p = ep * (1 + tp / 100)
    sl_p = ep * (1 - sl / 100)
    highest = ep
    trail_on = False

    for i in range(entry_idx + 1, min(entry_idx + max_bars + 1, len(candles))):
        h, l = candles[i]["high_price"], candles[i]["low_price"]
        if l <= sl_p:
            return {"result": "SL", "pnl_pct": -sl, "bars": i - entry_idx}
        if h >= tp_p:
            return {"result": "TP", "pnl_pct": tp, "bars": i - entry_idx}
        if h > highest:
            highest = h
        if (highest / ep - 1) * 100 >= trail_act:
            trail_on = True
        if trail_on:
            ts = highest * (1 - trail_dist / 100)
            if l <= ts:
                return {"result": "TRAIL", "pnl_pct": round((ts / ep - 1) * 100, 2), "bars": i - entry_idx}

    xp = candles[min(entry_idx + max_bars, len(candles) - 1)]["trade_price"]
    return {"result": "TIME", "pnl_pct": round((xp / ep - 1) * 100, 2), "bars": max_bars}


def sim_exception_trades(btc_candles, alt_candles, btc_time_map, coin_name, btc_cond,
                          alt_min_ret=0.2, tp=3.0, sl=2.0, trail_act=2.1, trail_dist=1.0, max_bars=6):
    """BTC 변동 구간 예외 코인의 추가 거래 시뮬레이션"""
    trades = []
    last_exit = -4

    for i in range(2, len(alt_candles)):
        kst = alt_candles[i]["candle_date_time_kst"]
        hour = int(kst[11:13])
        if hour < 8 or hour >= 23:
            continue
        if i - last_exit < 2:
            continue

        btc_idx = btc_time_map.get(kst)
        if btc_idx is None or btc_idx < 2:
            continue

        btc_ret = (btc_candles[btc_idx]["trade_price"] / btc_candles[btc_idx - 1]["trade_price"] - 1) * 100

        # BTC 안정 구간이면 스킵 (기존 봇이 이미 커버)
        if abs(btc_ret) <= 0.25:
            continue

        # BTC 변동 방향 조건 체크
        if not btc_cond(btc_ret):
            continue

        # ±1.0% 이내만
        if abs(btc_ret) > 1.0:
            continue

        alt_ret = (alt_candles[i]["trade_price"] / alt_candles[i - 1]["trade_price"] - 1) * 100
        if alt_ret < alt_min_ret:
            continue

        r = sim_trade(alt_candles, i, tp, sl, trail_act, trail_dist, max_bars)
        r["coin"] = coin_name
        r["kst"] = kst
        r["btc_ret"] = round(btc_ret, 3)
        r["alt_ret"] = round(alt_ret, 3)
        r["source"] = "v4.2_exception"
        trades.append(r)
        last_exit = i + r["bars"]

    return trades


def print_stats(label, trades, capital=500_000, fee_pct=0.05):
    if not trades:
        print(f"  {label}: 거래 없음")
        return

    total_pnl_pct = sum(t["pnl_pct"] for t in trades)
    fee_total_pct = len(trades) * fee_pct * 2
    net_pnl_pct = total_pnl_pct - fee_total_pct
    wins = sum(1 for t in trades if t["pnl_pct"] > 0)
    wr = wins / len(trades) * 100

    net_won = net_pnl_pct / 100 * capital

    by_result = defaultdict(lambda: {"n": 0, "p": 0.0})
    for t in trades:
        by_result[t["result"]]["n"] += 1
        by_result[t["result"]]["p"] += t["pnl_pct"]

    print(f"  {label}")
    print(f"    거래: {len(trades)}건 | 승률: {wr:.1f}% ({wins}승 {len(trades)-wins}패)")
    print(f"    총PnL: {total_pnl_pct:+.2f}% | 수수료: -{fee_total_pct:.1f}% | 순수익: {net_pnl_pct:+.2f}%")
    print(f"    50만원 기준: {net_won:+,.0f}원 | 일평균: {net_won/30:+,.0f}원/일")

    result_str = " | ".join(f"{r}:{d['n']}건({d['p']:+.1f}%)" for r, d in sorted(by_result.items()))
    print(f"    {result_str}")


def main():
    print("=" * 70)
    print("📊 v4.2 통합 백테스트")
    print(f"  기간: {DAYS}일 | {UNIT}분봉")
    print("=" * 70)

    # 1. 기존 봇 실적 (DB에서 가져오기 — 로컬 백테스트 데이터 사용)
    # backtest_daytrade_filter.py의 TRADES_RAW에서 v4.0 필터 적용
    print("\n📡 데이터 수집...")

    btc_candles = fetch_all_candles("KRW-BTC", DAYS, UNIT)
    print(f"  BTC: {len(btc_candles)}개")

    btc_time_map = {}
    for i, c in enumerate(btc_candles):
        btc_time_map[c["candle_date_time_kst"]] = i

    # ORCA 데이터
    print(f"  ORCA...", end=" ", flush=True)
    orca_candles = fetch_all_candles("KRW-ORCA", DAYS, UNIT)
    print(f"{len(orca_candles)}개")

    # JST 데이터
    print(f"  JST...", end=" ", flush=True)
    jst_candles = fetch_all_candles("KRW-JST", DAYS, UNIT)
    print(f"{len(jst_candles)}개")

    # 2. 기존 봇 실적 (DB 102건 중 v4.0 필터 통과분)
    # v4.0 필터: CS>=80, 블랙리스트(TAO,ETH,BLUR,DRIFT), 00-08시 차단
    print("\n" + "=" * 70)
    print("📊 기존 봇 실적 (v4.0 기준, DB 거래)")
    print("=" * 70)

    # DB에서 실제 거래 데이터 로드 (3/31 ~ 4/4, 112건)
    # v4.0은 4/3 15:40부터 적용. 그 이전 거래는 v3.0 이하 조건
    # 공정한 비교를 위해 v4.0 필터를 전체 거래에 소급 적용

    BLACKLIST = {"TAO", "ETH", "BLUR", "DRIFT"}

    # backtest_daytrade_filter.py의 102건 데이터 사용
    import importlib.util
    spec = importlib.util.spec_from_file_location("bt", "/Users/familyhuls/backtest_daytrade_filter.py")
    bt = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(bt)
    all_db_trades = bt.TRADES_RAW

    # v4.0 필터 적용
    v40_trades = []
    for t in all_db_trades:
        # 블랙리스트
        if t["name"] in BLACKLIST:
            continue
        # CS >= 80
        if t["cs_now"] < 80:
            continue
        # 00-08시 차단
        hour = int(t["entry_time"].split(":")[0])
        if hour < 8:
            continue
        v40_trades.append(t)

    v40_pnl = sum(t["pnl"] for t in v40_trades)
    v40_wins = sum(1 for t in v40_trades if t["pnl"] > 0)
    v40_wr = v40_wins / len(v40_trades) * 100 if v40_trades else 0

    print(f"\n  v4.0 필터 적용 결과 (102건 → {len(v40_trades)}건):")
    print(f"    거래: {len(v40_trades)}건 | 승률: {v40_wr:.1f}% ({v40_wins}승 {len(v40_trades)-v40_wins}패)")
    print(f"    총PnL: {v40_pnl:+,}원")

    by_result_v40 = defaultdict(lambda: {"n": 0, "p": 0})
    for t in v40_trades:
        by_result_v40[t["result"]]["n"] += 1
        by_result_v40[t["result"]]["p"] += t["pnl"]
    for r, d in sorted(by_result_v40.items()):
        print(f"      {r:6s}: {d['n']:3d}건, {d['p']:+,}원")

    # 날짜별
    by_date_v40 = defaultdict(lambda: {"n": 0, "p": 0})
    for t in v40_trades:
        by_date_v40[t["date"]]["n"] += 1
        by_date_v40[t["date"]]["p"] += t["pnl"]
    print(f"\n    날짜별:")
    for d in sorted(by_date_v40.keys()):
        dd = by_date_v40[d]
        print(f"      {d}: {dd['n']:2d}건, {dd['p']:+,}원")

    # 3. ORCA 추가 거래 시뮬레이션
    print("\n" + "=" * 70)
    print("📊 v4.1 추가: ORCA (BTC 상승 변동 시)")
    print("=" * 70)

    orca_trades = sim_exception_trades(
        btc_candles, orca_candles, btc_time_map, "ORCA",
        btc_cond=lambda ret: ret > 0.25,  # BTC 상승만
        alt_min_ret=0.2,
        tp=3.0, sl=2.0, trail_act=2.1, trail_dist=1.0, max_bars=6
    )
    print_stats("ORCA (BTC 상승 변동 시 진입)", orca_trades)

    # 4. JST 추가 거래 시뮬레이션
    print("\n" + "=" * 70)
    print("📊 v4.2 추가: JST (BTC 하락 변동 시)")
    print("=" * 70)

    jst_trades = sim_exception_trades(
        btc_candles, jst_candles, btc_time_map, "JST",
        btc_cond=lambda ret: ret < -0.25,  # BTC 하락만
        alt_min_ret=0.1,
        tp=2.0, sl=1.5, trail_act=1.5, trail_dist=0.8, max_bars=4
    )
    print_stats("JST (BTC 하락 변동 시 진입)", jst_trades)

    # 5. 통합 비교
    print("\n" + "=" * 70)
    print("📊 버전별 비교")
    print("=" * 70)

    # v4.0 기준 (5일 실적 기반 30일 추정)
    days_in_db = len(set(t["date"] for t in v40_trades))
    v40_daily = v40_pnl / days_in_db if days_in_db > 0 else 0
    v40_monthly = v40_daily * 30

    # ORCA 추가분 (30일 실제)
    orca_net_pct = sum(t["pnl_pct"] for t in orca_trades) - len(orca_trades) * 0.1 if orca_trades else 0
    orca_net_won = orca_net_pct / 100 * 500_000

    # JST 추가분 (30일 실제)
    jst_net_pct = sum(t["pnl_pct"] for t in jst_trades) - len(jst_trades) * 0.1 if jst_trades else 0
    jst_net_won = jst_net_pct / 100 * 500_000

    print(f"\n  {'버전':10s} {'거래':>5s} {'승률':>6s} {'30일 추정':>12s} {'일평균':>10s}")
    print(f"  {'-'*50}")
    print(f"  {'v4.0 기존':10s} {len(v40_trades):5d}건 {v40_wr:5.1f}% {v40_monthly:+12,.0f}원 {v40_daily:+10,.0f}원")

    if orca_trades:
        orca_wins = sum(1 for t in orca_trades if t["pnl_pct"] > 0)
        orca_wr = orca_wins / len(orca_trades) * 100
        print(f"  {'+ ORCA':10s} {len(orca_trades):5d}건 {orca_wr:5.1f}% {orca_net_won:+12,.0f}원 {orca_net_won/30:+10,.0f}원")

    if jst_trades:
        jst_wins = sum(1 for t in jst_trades if t["pnl_pct"] > 0)
        jst_wr = jst_wins / len(jst_trades) * 100
        print(f"  {'+ JST':10s} {len(jst_trades):5d}건 {jst_wr:5.1f}% {jst_net_won:+12,.0f}원 {jst_net_won/30:+10,.0f}원")

    total_monthly = v40_monthly + orca_net_won + jst_net_won
    total_trades = len(v40_trades) + len(orca_trades) + len(jst_trades)
    print(f"  {'-'*50}")
    print(f"  {'v4.2 합계':10s} {total_trades:5d}건 {'':6s} {total_monthly:+12,.0f}원 {total_monthly/30:+10,.0f}원")

    # 개선 효과
    if v40_monthly != 0:
        improvement = (total_monthly - v40_monthly) / abs(v40_monthly) * 100
        print(f"\n  📈 v4.0 → v4.2 개선: {total_monthly - v40_monthly:+,.0f}원/월 ({improvement:+.1f}%)")
    else:
        print(f"\n  📈 ORCA+JST 추가 수익: {orca_net_won + jst_net_won:+,.0f}원/월")

    # 6. 거래 상세 (ORCA + JST)
    all_new = orca_trades + jst_trades
    if all_new:
        print(f"\n" + "=" * 70)
        print(f"📋 ORCA + JST 추가 거래 상세 ({len(all_new)}건)")
        print(f"=" * 70)

        all_new.sort(key=lambda t: t["kst"])
        by_date = defaultdict(lambda: {"trades": [], "pnl": 0.0})
        for t in all_new:
            d = t["kst"][:10]
            by_date[d]["trades"].append(t)
            by_date[d]["pnl"] += t["pnl_pct"]

        for d in sorted(by_date.keys()):
            dd = by_date[d]
            fee = len(dd["trades"]) * 0.1
            net = dd["pnl"] - fee
            print(f"\n  {d}: {len(dd['trades'])}건, 순PnL {net:+.2f}%")
            for t in dd["trades"]:
                print(f"    {t['kst'][11:16]} {t['coin']:6s} btc={t['btc_ret']:+.2f}% alt={t['alt_ret']:+.2f}% → {t['result']:5s} {t['pnl_pct']:+.2f}%")

    print("\n✅ 백테스트 완료")


if __name__ == "__main__":
    main()
