"""
반대 봇 v2: 전략 B 최적화
BTC 15분 상승(>0.25%) 시, 알트코인 매수

튜닝 포인트:
1. 코인 필터 (수익 코인만)
2. TP/SL 비율 조정
3. 진입 조건 강화 (alt_ret 최소값, 거래량)
4. 시간대 필터
5. BTC 변동 강도별 분류
"""

import requests
import time
import itertools
from datetime import datetime
from collections import defaultdict

UPBIT_REST = "https://api.upbit.com/v1"

# 전체 코인 (v1 결과 기반으로 그룹화)
GOOD_COINS = ["KRW-DKA", "KRW-RAY", "KRW-MINA", "KRW-SOL", "KRW-TAO"]
NEUTRAL_COINS = ["KRW-ETH", "KRW-KERNEL", "KRW-G", "KRW-ONT", "KRW-ALGO",
                 "KRW-DRIFT", "KRW-TRUMP", "KRW-DOGE", "KRW-CHZ", "KRW-SHIB", "KRW-ONG"]
BAD_COINS = ["KRW-SEI", "KRW-XRP", "KRW-ORCA"]

ALL_COINS = GOOD_COINS + NEUTRAL_COINS + BAD_COINS


def fetch_candles(market, unit, count=200, to=None):
    params = {"market": market, "count": min(count, 200)}
    if to:
        params["to"] = to
    try:
        r = requests.get(f"{UPBIT_REST}/candles/minutes/{unit}", params=params, timeout=10)
        r.raise_for_status()
        return r.json()
    except Exception as e:
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
            return {"result": "SL", "pnl": -sl, "bars": i - entry_idx}
        if h >= tp_p:
            return {"result": "TP", "pnl": tp, "bars": i - entry_idx}
        if h > highest:
            highest = h
        if (highest / ep - 1) * 100 >= trail_act:
            trail_on = True
        if trail_on:
            ts = highest * (1 - trail_dist / 100)
            if l <= ts:
                return {"result": "TRAIL", "pnl": round((ts / ep - 1) * 100, 2), "bars": i - entry_idx}

    xp = candles[min(entry_idx + max_bars, len(candles) - 1)]["trade_price"]
    return {"result": "TIME", "pnl": round((xp / ep - 1) * 100, 2), "bars": max_bars}


def run_backtest(btc_candles, alt_data, coins, btc_min_ret=0.25, alt_min_ret=0.2,
                 tp=2.5, sl=1.5, trail_act=2.0, trail_dist=0.8, max_bars=4,
                 hour_start=8, hour_end=23, btc_max_ret=999, cooldown=2):
    """단일 백테스트 실행"""
    # BTC 변동 시간 맵
    btc_time_map = {}
    btc_ret_map = {}
    for i, c in enumerate(btc_candles):
        btc_time_map[c["candle_date_time_kst"]] = i
        if i > 0:
            ret = (c["trade_price"] / btc_candles[i-1]["trade_price"] - 1) * 100
            if btc_min_ret < ret <= btc_max_ret:  # 상승만
                btc_ret_map[c["candle_date_time_kst"]] = ret

    trades = []
    for coin in coins:
        alt_candles = alt_data.get(coin, [])
        if len(alt_candles) < 50:
            continue

        last_exit = -cooldown * 2
        for i in range(2, len(alt_candles)):
            kst = alt_candles[i]["candle_date_time_kst"]
            hour = int(kst[11:13])
            if hour < hour_start or hour >= hour_end:
                continue
            if i - last_exit < cooldown:
                continue
            if kst not in btc_ret_map:
                continue

            alt_ret = (alt_candles[i]["trade_price"] / alt_candles[i-1]["trade_price"] - 1) * 100
            if alt_ret < alt_min_ret:
                continue

            r = sim_trade(alt_candles, i, tp, sl, trail_act, trail_dist, max_bars)
            r["coin"] = coin
            r["kst"] = kst
            r["btc_ret"] = round(btc_ret_map[kst], 3)
            r["alt_ret"] = round(alt_ret, 3)
            trades.append(r)
            last_exit = i + r["bars"]

    return trades


def print_result(label, trades, fee_pct=0.05):
    """결과 출력 (수수료 포함)"""
    if not trades:
        print(f"  {label}: 거래 없음")
        return 0

    total_pnl = sum(t["pnl"] for t in trades)
    fee_total = len(trades) * fee_pct * 2  # 매수+매도
    net_pnl = total_pnl - fee_total
    wins = sum(1 for t in trades if t["pnl"] > 0)
    wr = wins / len(trades) * 100

    by_result = defaultdict(lambda: {"n": 0, "p": 0.0})
    for t in trades:
        by_result[t["result"]]["n"] += 1
        by_result[t["result"]]["p"] += t["pnl"]

    print(f"  {label}")
    print(f"    거래: {len(trades)}건 | 승률: {wr:.1f}% | 총: {total_pnl:+.1f}% | 수수료: -{fee_total:.1f}% | 순수익: {net_pnl:+.1f}%")
    print(f"    건당: {net_pnl/len(trades):+.3f}% | 50만 기준: {net_pnl/100*500_000:+,.0f}원/30일 | 일평균: {net_pnl/100*500_000/30:+,.0f}원")

    result_str = " | ".join(f"{r}:{d['n']}건({d['p']:+.1f}%)" for r, d in sorted(by_result.items()))
    print(f"    {result_str}")
    return net_pnl


def main():
    DAYS = 30
    UNIT = 15
    print("=" * 70)
    print("🔄 반대 봇 v2 — 전략 B 최적화")
    print(f"  {DAYS}일 | {UNIT}분봉")
    print("=" * 70)

    # 데이터 수집
    print("\n📡 데이터 수집...")
    btc_candles = fetch_all_candles("KRW-BTC", DAYS, UNIT)
    print(f"  BTC: {len(btc_candles)}개")

    alt_data = {}
    for coin in ALL_COINS:
        print(f"  {coin}...", end=" ", flush=True)
        alt_data[coin] = fetch_all_candles(coin, DAYS, UNIT)
        print(f"{len(alt_data[coin])}개")

    # ── 1단계: 코인 필터 효과 ──
    print("\n" + "=" * 70)
    print("📊 1단계: 코인 필터 효과")
    print("=" * 70)

    base_params = dict(btc_min_ret=0.25, alt_min_ret=0.2, tp=2.5, sl=1.5,
                       trail_act=2.0, trail_dist=0.8, max_bars=4)

    t_all = run_backtest(btc_candles, alt_data, ALL_COINS, **base_params)
    t_good = run_backtest(btc_candles, alt_data, GOOD_COINS, **base_params)
    t_good_neutral = run_backtest(btc_candles, alt_data, GOOD_COINS + NEUTRAL_COINS, **base_params)
    t_no_bad = run_backtest(btc_candles, alt_data, [c for c in ALL_COINS if c not in BAD_COINS], **base_params)

    print_result("전체 코인 (19개)", t_all)
    print_result("GOOD만 (5개: DKA,RAY,MINA,SOL,TAO)", t_good)
    print_result("GOOD+NEUTRAL (16개, BAD 제외)", t_no_bad)

    # ── 개별 코인 성과 ──
    print(f"\n  개별 코인 성과:")
    coin_stats = []
    for coin in ALL_COINS:
        t = run_backtest(btc_candles, alt_data, [coin], **base_params)
        if t:
            net = sum(tt["pnl"] for tt in t) - len(t) * 0.1
            wins = sum(1 for tt in t if tt["pnl"] > 0)
            coin_stats.append((coin, len(t), wins/len(t)*100, net))
    coin_stats.sort(key=lambda x: x[3], reverse=True)
    for coin, n, wr, net in coin_stats:
        tag = "🟢" if net > 0 else "🔴"
        print(f"    {tag} {coin:12s}: {n:2d}건, 승률 {wr:.0f}%, 순PnL {net:+.1f}%")

    # ── 2단계: TP/SL 그리드 서치 ──
    print("\n" + "=" * 70)
    print("📊 2단계: TP/SL 최적화 (GOOD 코인 기준)")
    print("=" * 70)

    # 수익 코인 결정 (위에서 순수익 > 0인 코인)
    profit_coins = [c for c, n, wr, net in coin_stats if net > 0]
    if not profit_coins:
        profit_coins = GOOD_COINS
    print(f"  수익 코인: {profit_coins}")

    best_net = -9999
    best_params = {}
    results = []

    for tp in [1.5, 2.0, 2.5, 3.0]:
        for sl in [0.7, 1.0, 1.5, 2.0]:
            for max_bars in [2, 4, 6, 8]:
                t = run_backtest(btc_candles, alt_data, profit_coins,
                                 btc_min_ret=0.25, alt_min_ret=0.2,
                                 tp=tp, sl=sl, trail_act=tp*0.7, trail_dist=sl*0.5,
                                 max_bars=max_bars)
                if not t:
                    continue
                total = sum(tt["pnl"] for tt in t)
                fee = len(t) * 0.1
                net = total - fee
                wins = sum(1 for tt in t if tt["pnl"] > 0)
                wr = wins / len(t) * 100

                results.append({
                    "tp": tp, "sl": sl, "max_bars": max_bars,
                    "n": len(t), "wr": wr, "net": net, "per_trade": net/len(t)
                })
                if net > best_net:
                    best_net = net
                    best_params = {"tp": tp, "sl": sl, "max_bars": max_bars,
                                   "trail_act": round(tp*0.7, 1), "trail_dist": round(sl*0.5, 1)}

    # 상위 10개 조합 출력
    results.sort(key=lambda x: x["net"], reverse=True)
    print(f"\n  상위 10 조합:")
    print(f"  {'TP':>4s} {'SL':>4s} {'바':>3s} {'건수':>4s} {'승률':>5s} {'순PnL':>8s} {'건당':>7s}")
    for r in results[:10]:
        print(f"  {r['tp']:4.1f} {r['sl']:4.1f} {r['max_bars']:3d} {r['n']:4d} {r['wr']:5.1f}% {r['net']:+8.1f}% {r['per_trade']:+7.3f}%")

    print(f"\n  🏆 최적 파라미터: {best_params}")

    # ── 3단계: 진입 조건 최적화 ──
    print("\n" + "=" * 70)
    print("📊 3단계: 진입 조건 최적화 (최적 TP/SL 기준)")
    print("=" * 70)

    best_tp = best_params.get("tp", 2.5)
    best_sl = best_params.get("sl", 1.0)
    best_bars = best_params.get("max_bars", 4)
    best_trail_act = best_params.get("trail_act", 1.5)
    best_trail_dist = best_params.get("trail_dist", 0.5)

    entry_results = []
    for alt_min in [0.1, 0.2, 0.3, 0.5, 0.7]:
        for btc_min in [0.25, 0.35, 0.5]:
            for btc_max in [1.0, 2.0, 999]:
                t = run_backtest(btc_candles, alt_data, profit_coins,
                                 btc_min_ret=btc_min, btc_max_ret=btc_max,
                                 alt_min_ret=alt_min,
                                 tp=best_tp, sl=best_sl,
                                 trail_act=best_trail_act, trail_dist=best_trail_dist,
                                 max_bars=best_bars)
                if not t or len(t) < 5:
                    continue
                total = sum(tt["pnl"] for tt in t)
                fee = len(t) * 0.1
                net = total - fee
                wins = sum(1 for tt in t if tt["pnl"] > 0)
                entry_results.append({
                    "alt_min": alt_min, "btc_min": btc_min, "btc_max": btc_max,
                    "n": len(t), "wr": wins/len(t)*100, "net": net
                })

    entry_results.sort(key=lambda x: x["net"], reverse=True)
    print(f"\n  상위 10 진입 조건:")
    print(f"  {'ALT최소':>7s} {'BTC최소':>7s} {'BTC최대':>7s} {'건수':>4s} {'승률':>5s} {'순PnL':>8s}")
    for r in entry_results[:10]:
        btc_max_str = f"{r['btc_max']:.1f}" if r['btc_max'] < 100 else "무제한"
        print(f"  {r['alt_min']:7.1f}% {r['btc_min']:7.2f}% {btc_max_str:>7s} {r['n']:4d} {r['wr']:5.1f}% {r['net']:+8.1f}%")

    # ── 4단계: 최종 최적 조합 상세 분석 ──
    print("\n" + "=" * 70)
    print("📊 4단계: 최종 최적 조합 상세 분석")
    print("=" * 70)

    if entry_results:
        best_entry = entry_results[0]
        final_trades = run_backtest(
            btc_candles, alt_data, profit_coins,
            btc_min_ret=best_entry["btc_min"], btc_max_ret=best_entry["btc_max"],
            alt_min_ret=best_entry["alt_min"],
            tp=best_tp, sl=best_sl,
            trail_act=best_trail_act, trail_dist=best_trail_dist,
            max_bars=best_bars
        )

        print(f"\n  최종 조건:")
        print(f"    코인: {profit_coins}")
        print(f"    BTC 15분 수익률: +{best_entry['btc_min']:.2f}% ~ +{best_entry['btc_max'] if best_entry['btc_max']<100 else '무제한'}%")
        print(f"    알트 15분 수익률: > +{best_entry['alt_min']:.1f}%")
        print(f"    TP: +{best_tp}% | SL: -{best_sl}% | 트레일: +{best_trail_act}% 활성, -{best_trail_dist}%")
        print(f"    최대 보유: {best_bars}바 ({best_bars*15}분)")

        print_result("최종 결과", final_trades)

        # 날짜별 분포
        by_date = defaultdict(lambda: {"n": 0, "pnl": 0.0})
        for t in final_trades:
            d = t["kst"][:10]
            by_date[d]["n"] += 1
            by_date[d]["pnl"] += t["pnl"]

        print(f"\n  날짜별:")
        for d in sorted(by_date.keys()):
            dd = by_date[d]
            fee = dd["n"] * 0.1
            print(f"    {d}: {dd['n']:2d}건, 순PnL {dd['pnl']-fee:+.1f}%")

        # 코인별
        by_coin = defaultdict(lambda: {"n": 0, "pnl": 0.0, "w": 0})
        for t in final_trades:
            by_coin[t["coin"]]["n"] += 1
            by_coin[t["coin"]]["pnl"] += t["pnl"]
            if t["pnl"] > 0:
                by_coin[t["coin"]]["w"] += 1

        print(f"\n  코인별:")
        for coin, d in sorted(by_coin.items(), key=lambda x: x[1]["pnl"], reverse=True):
            fee = d["n"] * 0.1
            wr = d["w"] / d["n"] * 100
            print(f"    {coin:12s}: {d['n']:2d}건, 승률 {wr:.0f}%, 순PnL {d['pnl']-fee:+.1f}%")

    print("\n✅ 최적화 완료")


if __name__ == "__main__":
    main()
