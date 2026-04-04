"""
패턴 봇 백테스트: 업비트 전체 코인 대상
BTC 변동 구간에서 각 코인의 행동 패턴을 분류

패턴 유형:
1. 독립형: BTC 변동에도 자체 흐름 유지
2. 역행형: BTC와 반대로 움직임
3. 추종형: BTC 따라감 (패턴 봇 대상 X)
4. 증폭형: BTC보다 더 크게 움직임

각 유형별로 수익성 있는 전략이 있는지 검증
"""

import requests
import time
import json
import numpy as np
from datetime import datetime
from collections import defaultdict

UPBIT_REST = "https://api.upbit.com/v1"
DAYS = 30
UNIT = 15  # 15분봉


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
        time.sleep(0.11)
    all_c.sort(key=lambda x: x["candle_date_time_kst"])
    seen = set()
    return [c for c in all_c if not (c["candle_date_time_kst"] in seen or seen.add(c["candle_date_time_kst"]))]


def get_all_krw_markets():
    """업비트 전체 KRW 마켓 조회"""
    try:
        r = requests.get(f"{UPBIT_REST}/market/all", timeout=10)
        markets = r.json()
        return [m["market"] for m in markets if m["market"].startswith("KRW-") and m["market"] != "KRW-BTC"]
    except:
        return []


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


def analyze_coin_pattern(btc_rets, alt_rets):
    """
    BTC 변동 시 알트코인 행동 패턴 분석
    btc_rets, alt_rets: 같은 시간의 15분 수익률 리스트
    """
    if len(btc_rets) < 20:
        return None

    btc = np.array(btc_rets)
    alt = np.array(alt_rets)

    # 상관계수
    corr = np.corrcoef(btc, alt)[0, 1] if np.std(btc) > 0 and np.std(alt) > 0 else 0

    # BTC 상승 변동 시 알트 행동
    btc_up = btc > 0.25
    btc_down = btc < -0.25
    btc_stable = np.abs(btc) <= 0.25

    # BTC 상승 시 알트 평균 수익률
    alt_when_btc_up = alt[btc_up].mean() if btc_up.sum() > 5 else 0
    alt_when_btc_down = alt[btc_down].mean() if btc_down.sum() > 5 else 0
    alt_when_btc_stable = alt[btc_stable].mean() if btc_stable.sum() > 5 else 0

    # BTC 상승 시 알트 양봉 비율
    alt_up_when_btc_up = (alt[btc_up] > 0).mean() if btc_up.sum() > 5 else 0.5
    alt_up_when_btc_down = (alt[btc_down] > 0).mean() if btc_down.sum() > 5 else 0.5

    # 베타 (BTC 대비 민감도)
    beta = np.cov(btc, alt)[0, 1] / np.var(btc) if np.var(btc) > 0 else 0

    # 알트 자체 변동성
    alt_vol = np.std(alt)

    # 패턴 분류
    if corr < -0.1 and alt_up_when_btc_down > 0.55:
        pattern = "역행형"
    elif abs(corr) < 0.15 and abs(beta) < 0.3:
        pattern = "독립형"
    elif corr > 0.3 and abs(beta) > 1.5:
        pattern = "증폭형"
    elif corr > 0.3:
        pattern = "추종형"
    else:
        pattern = "약추종"

    return {
        "corr": round(corr, 3),
        "beta": round(beta, 2),
        "pattern": pattern,
        "alt_vol": round(alt_vol, 3),
        "btc_up_count": int(btc_up.sum()),
        "btc_down_count": int(btc_down.sum()),
        "alt_mean_btc_up": round(alt_when_btc_up, 3),
        "alt_mean_btc_down": round(alt_when_btc_down, 3),
        "alt_mean_btc_stable": round(alt_when_btc_stable, 3),
        "alt_uprate_btc_up": round(alt_up_when_btc_up, 3),
        "alt_uprate_btc_down": round(alt_up_when_btc_down, 3),
    }


def backtest_pattern_strategy(btc_candles, alt_candles, btc_time_map, scenario):
    """특정 시나리오로 백테스트"""
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
        alt_ret = (alt_candles[i]["trade_price"] / alt_candles[i - 1]["trade_price"] - 1) * 100

        # 시나리오 조건 체크
        if not scenario["cond"](btc_ret, alt_ret):
            continue

        r = sim_trade(alt_candles, i,
                      tp=scenario["tp"], sl=scenario["sl"],
                      trail_act=scenario["trail_act"], trail_dist=scenario["trail_dist"],
                      max_bars=scenario["max_bars"])
        r["kst"] = kst
        r["btc_ret"] = round(btc_ret, 3)
        r["alt_ret"] = round(alt_ret, 3)
        trades.append(r)
        last_exit = i + r["bars"]

    return trades


def main():
    print("=" * 70)
    print("🔍 패턴 봇 — 업비트 전체 코인 패턴 분석")
    print(f"  기간: {DAYS}일 | 캔들: {UNIT}분봉")
    print("=" * 70)

    # 1. 전체 KRW 마켓 조회
    all_markets = get_all_krw_markets()
    print(f"\n📡 업비트 KRW 마켓: {len(all_markets)}개")

    # 2. BTC 데이터 수집
    print(f"\n📡 BTC 데이터 수집...")
    btc_candles = fetch_all_candles("KRW-BTC", DAYS, UNIT)
    print(f"  BTC: {len(btc_candles)}개 ({btc_candles[0]['candle_date_time_kst'][:10]} ~ {btc_candles[-1]['candle_date_time_kst'][:10]})")

    btc_time_map = {}
    btc_rets_map = {}  # kst → ret
    for i, c in enumerate(btc_candles):
        btc_time_map[c["candle_date_time_kst"]] = i
        if i > 0:
            ret = (c["trade_price"] / btc_candles[i - 1]["trade_price"] - 1) * 100
            btc_rets_map[c["candle_date_time_kst"]] = ret

    # 3. 전체 코인 패턴 분석
    print(f"\n📡 전체 코인 패턴 분석 중... ({len(all_markets)}개)")
    coin_patterns = {}
    coin_candles = {}

    for idx, market in enumerate(all_markets):
        name = market.replace("KRW-", "")
        print(f"  [{idx+1}/{len(all_markets)}] {name}...", end=" ", flush=True)

        alt_candles = fetch_all_candles(market, DAYS, UNIT)
        if len(alt_candles) < 500:
            print("데이터 부족, 스킵")
            continue

        coin_candles[market] = alt_candles
        print(f"{len(alt_candles)}개", end=" ")

        # BTC-알트 수익률 매칭
        btc_rets = []
        alt_rets = []
        for j in range(1, len(alt_candles)):
            kst = alt_candles[j]["candle_date_time_kst"]
            if kst in btc_rets_map:
                btc_rets.append(btc_rets_map[kst])
                alt_ret = (alt_candles[j]["trade_price"] / alt_candles[j - 1]["trade_price"] - 1) * 100
                alt_rets.append(alt_ret)

        pattern = analyze_coin_pattern(btc_rets, alt_rets)
        if pattern:
            coin_patterns[market] = pattern
            print(f"→ {pattern['pattern']} (상관:{pattern['corr']}, 베타:{pattern['beta']})")
        else:
            print("분석 불가")

    # 4. 패턴별 분류 출력
    print("\n" + "=" * 70)
    print("📊 패턴 분류 결과")
    print("=" * 70)

    by_pattern = defaultdict(list)
    for market, p in coin_patterns.items():
        by_pattern[p["pattern"]].append((market, p))

    for pat_name in ["역행형", "독립형", "증폭형", "추종형", "약추종"]:
        coins = by_pattern.get(pat_name, [])
        print(f"\n🏷️  {pat_name}: {len(coins)}개")
        if not coins:
            continue

        # 정렬: 역행형은 BTC하락시 알트상승률 순, 독립형은 상관계수 절대값 순
        if pat_name == "역행형":
            coins.sort(key=lambda x: x[1]["alt_uprate_btc_down"], reverse=True)
        elif pat_name == "독립형":
            coins.sort(key=lambda x: abs(x[1]["corr"]))
        else:
            coins.sort(key=lambda x: x[1]["corr"], reverse=True)

        print(f"  {'코인':12s} {'상관':>6s} {'베타':>6s} {'BTC↑시ALT평균':>12s} {'BTC↓시ALT평균':>12s} {'BTC↑시양봉%':>10s} {'BTC↓시양봉%':>10s}")
        for market, p in coins[:20]:
            name = market.replace("KRW-", "")
            print(f"  {name:12s} {p['corr']:+6.3f} {p['beta']:+6.2f} {p['alt_mean_btc_up']:+12.3f}% {p['alt_mean_btc_down']:+12.3f}% {p['alt_uprate_btc_up']*100:9.1f}% {p['alt_uprate_btc_down']*100:9.1f}%")

    # 5. 패턴별 백테스트
    print("\n" + "=" * 70)
    print("📈 패턴별 백테스트")
    print("=" * 70)

    # 시나리오 정의
    scenarios = {
        "독립형_BTC상승시매수": {
            "desc": "BTC 상승 변동(>+0.25%) 시, 독립형 코인 매수 (ORCA 패턴)",
            "cond": lambda btc, alt: btc > 0.25 and alt > 0.2,
            "tp": 3.0, "sl": 2.0, "trail_act": 2.1, "trail_dist": 1.0, "max_bars": 6,
        },
        "독립형_BTC하락시매수": {
            "desc": "BTC 하락 변동(<-0.25%) 시, 독립형 코인 매수 (안정적이니까)",
            "cond": lambda btc, alt: btc < -0.25 and alt > 0.1,
            "tp": 2.0, "sl": 1.5, "trail_act": 1.5, "trail_dist": 0.8, "max_bars": 4,
        },
        "역행형_BTC하락시매수": {
            "desc": "BTC 하락 변동(<-0.25%) 시, 역행형 코인 매수 (역방향 모멘텀)",
            "cond": lambda btc, alt: btc < -0.25 and alt > 0.3,
            "tp": 3.0, "sl": 1.5, "trail_act": 2.0, "trail_dist": 1.0, "max_bars": 6,
        },
        "역행형_BTC상승시매수": {
            "desc": "BTC 상승 변동(>+0.25%) 시, 역행형 코인도 상승하면 매수",
            "cond": lambda btc, alt: btc > 0.25 and alt > 0.3,
            "tp": 3.0, "sl": 1.5, "trail_act": 2.0, "trail_dist": 1.0, "max_bars": 6,
        },
    }

    # 패턴-시나리오 매핑
    pattern_scenario_map = {
        "독립형": ["독립형_BTC상승시매수", "독립형_BTC하락시매수"],
        "역행형": ["역행형_BTC하락시매수", "역행형_BTC상승시매수"],
    }

    results_summary = []

    for pat_name, scenario_names in pattern_scenario_map.items():
        target_coins = [m for m, p in coin_patterns.items() if p["pattern"] == pat_name]
        if not target_coins:
            continue

        print(f"\n{'─' * 60}")
        print(f"🏷️  {pat_name} ({len(target_coins)}개 코인)")
        print(f"{'─' * 60}")

        for sc_name in scenario_names:
            sc = scenarios[sc_name]
            print(f"\n  전략: {sc_name}")
            print(f"  {sc['desc']}")

            # 코인별 백테스트
            coin_results = []
            for market in target_coins:
                if market not in coin_candles:
                    continue
                trades = backtest_pattern_strategy(btc_candles, coin_candles[market], btc_time_map, sc)
                if not trades:
                    continue

                total_pnl = sum(t["pnl"] for t in trades)
                fee = len(trades) * 0.1
                net = total_pnl - fee
                wins = sum(1 for t in trades if t["pnl"] > 0)
                wr = wins / len(trades) * 100
                coin_results.append({
                    "market": market,
                    "trades": trades,
                    "n": len(trades),
                    "wr": wr,
                    "net": net,
                    "per_trade": net / len(trades) if trades else 0,
                })

            if not coin_results:
                print("  거래 없음")
                continue

            coin_results.sort(key=lambda x: x["net"], reverse=True)

            # 전체 요약
            all_trades = []
            for cr in coin_results:
                all_trades.extend(cr["trades"])
            total_net = sum(cr["net"] for cr in coin_results)
            total_n = sum(cr["n"] for cr in coin_results)
            total_wins = sum(1 for t in all_trades if t["pnl"] > 0)

            print(f"\n  전체: {total_n}건, 승률 {total_wins/total_n*100:.1f}%, 순PnL {total_net:+.1f}%")

            # 수익 코인
            profit_coins = [cr for cr in coin_results if cr["net"] > 0]
            loss_coins = [cr for cr in coin_results if cr["net"] <= 0]

            print(f"\n  🟢 수익 코인 ({len(profit_coins)}개):")
            for cr in profit_coins[:15]:
                name = cr["market"].replace("KRW-", "")
                p = coin_patterns[cr["market"]]
                print(f"    {name:10s}: {cr['n']:3d}건, 승률 {cr['wr']:.0f}%, 순PnL {cr['net']:+6.1f}%, 건당 {cr['per_trade']:+.3f}% (상관:{p['corr']:+.2f})")

                results_summary.append({
                    "pattern": pat_name,
                    "scenario": sc_name,
                    "coin": cr["market"],
                    "n": cr["n"],
                    "wr": cr["wr"],
                    "net": cr["net"],
                    "per_trade": cr["per_trade"],
                    "corr": p["corr"],
                })

            print(f"\n  🔴 손실 코인 ({len(loss_coins)}개):")
            for cr in loss_coins[:10]:
                name = cr["market"].replace("KRW-", "")
                print(f"    {name:10s}: {cr['n']:3d}건, 승률 {cr['wr']:.0f}%, 순PnL {cr['net']:+6.1f}%")

            # 수익 코인만으로 합산
            if profit_coins:
                pc_trades = []
                for cr in profit_coins:
                    pc_trades.extend(cr["trades"])
                pc_net = sum(cr["net"] for cr in profit_coins)
                pc_wins = sum(1 for t in pc_trades if t["pnl"] > 0)
                print(f"\n  ✅ 수익 코인만 합산: {len(pc_trades)}건, 승률 {pc_wins/len(pc_trades)*100:.1f}%, 순PnL {pc_net:+.1f}%")
                print(f"     50만원 기준: {pc_net/100*500_000:+,.0f}원/30일, 일평균 {pc_net/100*500_000/30:+,.0f}원")

    # 6. 최종 요약 — 패턴 봇 후보
    print("\n" + "=" * 70)
    print("📋 최종 요약 — 패턴 봇 후보")
    print("=" * 70)

    if results_summary:
        # 건당 수익 기준 정렬
        results_summary.sort(key=lambda x: x["per_trade"], reverse=True)

        print(f"\n수익성 있는 종목-시나리오 조합 (건당 > 0, 최소 5건):")
        print(f"{'패턴':8s} {'시나리오':24s} {'코인':10s} {'건수':>4s} {'승률':>5s} {'순PnL':>7s} {'건당':>7s}")
        good_combos = [r for r in results_summary if r["per_trade"] > 0 and r["n"] >= 5]
        for r in good_combos:
            name = r["coin"].replace("KRW-", "")
            print(f"{r['pattern']:8s} {r['scenario']:24s} {name:10s} {r['n']:4d} {r['wr']:5.1f}% {r['net']:+7.1f}% {r['per_trade']:+7.3f}%")

        if good_combos:
            total_net = sum(r["net"] for r in good_combos)
            total_n = sum(r["n"] for r in good_combos)
            print(f"\n합산: {total_n}건, 순PnL {total_net:+.1f}%")
            print(f"50만원 기준: {total_net/100*500_000:+,.0f}원/30일, 일평균 {total_net/100*500_000/30:+,.0f}원")

    # 결과 저장
    output = {
        "analysis_date": datetime.now().strftime("%Y-%m-%d %H:%M"),
        "days": DAYS,
        "total_coins_analyzed": len(coin_patterns),
        "patterns": {p: len(coins) for p, coins in by_pattern.items()},
        "profitable_combos": [r for r in results_summary if r["per_trade"] > 0 and r["n"] >= 5],
        "coin_patterns": {m: p for m, p in coin_patterns.items()},
    }
    with open("pattern_bot_analysis.json", "w") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)
    print(f"\n💾 분석 결과 저장: pattern_bot_analysis.json")
    print("\n✅ 분석 완료")


if __name__ == "__main__":
    main()
