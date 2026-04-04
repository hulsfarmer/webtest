"""
반대 성격 봇 백테스트: 현재 단타봇이 거래하지 않는 구간 분석
- BTC 15분 변동률 > ±0.25% (변동 구간)에서 모멘텀/브레이크아웃 전략

15분봉 기반으로 30일 분석
"""

import requests
import time
from datetime import datetime
from collections import defaultdict

UPBIT_REST = "https://api.upbit.com/v1"

COINS = [
    "KRW-XRP", "KRW-ETH", "KRW-SOL", "KRW-RAY", "KRW-SEI",
    "KRW-TAO", "KRW-ONT", "KRW-MINA", "KRW-DOGE", "KRW-KERNEL",
    "KRW-DKA", "KRW-DRIFT", "KRW-ALGO", "KRW-G", "KRW-ONG",
    "KRW-TRUMP", "KRW-ORCA", "KRW-CHZ", "KRW-SHIB",
]

BTC_VOLATILE_THRESHOLD = 0.25  # ±0.25% in 15min


def fetch_candles(market: str, unit: int, count: int = 200, to: str = None) -> list:
    params = {"market": market, "count": min(count, 200)}
    if to:
        params["to"] = to
    try:
        r = requests.get(f"{UPBIT_REST}/candles/minutes/{unit}", params=params, timeout=10)
        r.raise_for_status()
        return r.json()
    except Exception as e:
        print(f"  API 에러 ({market}): {e}")
        return []


def fetch_all_candles(market: str, days: int, unit: int) -> list:
    all_candles = []
    to = None
    target_count = days * 24 * 60 // unit

    while len(all_candles) < target_count:
        candles = fetch_candles(market, unit=unit, count=200, to=to)
        if not candles:
            break
        all_candles.extend(candles)
        to = candles[-1]["candle_date_time_kst"]
        time.sleep(0.12)

    all_candles.sort(key=lambda c: c["candle_date_time_kst"])
    # 중복 제거
    seen = set()
    unique = []
    for c in all_candles:
        key = c["candle_date_time_kst"]
        if key not in seen:
            seen.add(key)
            unique.append(c)
    return unique


def simulate_trade_15m(candles: list, entry_idx: int,
                       tp_pct: float, sl_pct: float,
                       trail_act_pct: float, trail_dist_pct: float,
                       max_hold_bars: int) -> dict:
    """15분봉 기반 시뮬레이션"""
    entry_price = candles[entry_idx]["trade_price"]
    tp_price = entry_price * (1 + tp_pct / 100)
    sl_price = entry_price * (1 - sl_pct / 100)
    trail_active = False
    highest = entry_price

    for i in range(entry_idx + 1, min(entry_idx + max_hold_bars + 1, len(candles))):
        high = candles[i]["high_price"]
        low = candles[i]["low_price"]

        if low <= sl_price:
            return {"result": "SL", "pnl_pct": -sl_pct, "bars": i - entry_idx, "exit_idx": i}

        if high >= tp_price:
            return {"result": "TP", "pnl_pct": tp_pct, "bars": i - entry_idx, "exit_idx": i}

        if high > highest:
            highest = high

        if (highest / entry_price - 1) * 100 >= trail_act_pct:
            trail_active = True

        if trail_active:
            trail_stop = highest * (1 - trail_dist_pct / 100)
            if low <= trail_stop:
                pnl = (trail_stop / entry_price - 1) * 100
                return {"result": "TRAIL", "pnl_pct": round(pnl, 2), "bars": i - entry_idx, "exit_idx": i}

    exit_price = candles[min(entry_idx + max_hold_bars, len(candles) - 1)]["trade_price"]
    pnl = (exit_price / entry_price - 1) * 100
    return {"result": "TIME", "pnl_pct": round(pnl, 2), "bars": max_hold_bars,
            "exit_idx": min(entry_idx + max_hold_bars, len(candles) - 1)}


def main():
    DAYS = 30
    UNIT = 15  # 15분봉

    print("=" * 70)
    print(f"🔄 반대 성격 봇 백테스트 — BTC 변동 구간 모멘텀 전략")
    print(f"  분석 기간: 최근 {DAYS}일 | 캔들: {UNIT}분봉")
    print(f"  BTC 변동 기준: ±{BTC_VOLATILE_THRESHOLD}%")
    print("=" * 70)

    # 1. BTC 15분봉 수집
    print(f"\n📡 BTC {UNIT}분봉 수집 중...")
    btc_candles = fetch_all_candles("KRW-BTC", days=DAYS, unit=UNIT)
    print(f"  BTC 캔들: {len(btc_candles)}개 ({btc_candles[0]['candle_date_time_kst'][:10]} ~ {btc_candles[-1]['candle_date_time_kst'][:10]})")

    # 2. BTC 15분 수익률 계산 (15분봉이라 lookback=1이 곧 15분)
    print("\n📊 BTC 15분 변동률 분석...")
    volatile_indices = []  # (idx, ret_15m, direction)
    stable_count = 0

    for i in range(1, len(btc_candles)):
        price_now = btc_candles[i]["trade_price"]
        price_prev = btc_candles[i - 1]["trade_price"]
        ret = (price_now / price_prev - 1) * 100

        if abs(ret) > BTC_VOLATILE_THRESHOLD:
            direction = "UP" if ret > 0 else "DOWN"
            volatile_indices.append((i, ret, direction))
        else:
            stable_count += 1

    total = len(btc_candles) - 1
    print(f"  전체 바: {total}")
    print(f"  변동 바 (|ret| > {BTC_VOLATILE_THRESHOLD}%): {len(volatile_indices)} ({len(volatile_indices)/total*100:.1f}%)")
    print(f"  안정 바: {stable_count} ({stable_count/total*100:.1f}%)")

    up_v = [v for v in volatile_indices if v[2] == "UP"]
    down_v = [v for v in volatile_indices if v[2] == "DOWN"]
    print(f"    ↑ 상승: {len(up_v)} | ↓ 하락: {len(down_v)}")

    if volatile_indices:
        rets = [abs(v[1]) for v in volatile_indices]
        print(f"    변동률 범위: {min(rets):.2f}% ~ {max(rets):.2f}%")
        print(f"    평균 변동률: {sum(rets)/len(rets):.2f}%")

    # 변동 구간이 없으면 기준 완화
    if len(volatile_indices) < 10:
        print("\n⚠️  변동 구간이 너무 적음. 기준을 ±0.15%로 완화하여 추가 분석...")
        for i in range(1, len(btc_candles)):
            price_now = btc_candles[i]["trade_price"]
            price_prev = btc_candles[i - 1]["trade_price"]
            ret = (price_now / price_prev - 1) * 100
            if 0.15 < abs(ret) <= BTC_VOLATILE_THRESHOLD:
                direction = "UP" if ret > 0 else "DOWN"
                volatile_indices.append((i, ret, direction))
        volatile_indices.sort(key=lambda x: x[0])
        print(f"  완화 후 변동 바: {len(volatile_indices)}")

    if not volatile_indices:
        print("\n❌ 분석할 변동 구간 없음. 종료.")
        return

    # BTC 시간 맵
    btc_time_map = {}
    btc_volatile_times = set()
    for i, c in enumerate(btc_candles):
        btc_time_map[c["candle_date_time_kst"]] = i
    for idx, ret, direction in volatile_indices:
        btc_volatile_times.add(btc_candles[idx]["candle_date_time_kst"])

    # 3. 전략 정의
    strategies = {
        "A_모멘텀추종": {
            "desc": "BTC 변동 시 같은 방향으로 움직이는 알트 매수 (순방향 모멘텀)",
            "cond": lambda btc_ret, alt_ret: (btc_ret > 0 and alt_ret > 0.3) or (btc_ret < 0 and alt_ret < -0.3),
            "direction": lambda btc_ret: "long" if btc_ret > 0 else "short",
            "tp": 2.0, "sl": 1.0, "trail_act": 1.5, "trail_dist": 0.6, "max_bars": 4,
            "trades": [],
        },
        "B_BTC상승_알트매수": {
            "desc": "BTC 15분 상승(>0.25%) 시, 알트도 상승 중이면 매수",
            "cond": lambda btc_ret, alt_ret: btc_ret > BTC_VOLATILE_THRESHOLD and alt_ret > 0.2,
            "direction": lambda btc_ret: "long",
            "tp": 2.5, "sl": 1.5, "trail_act": 2.0, "trail_dist": 0.8, "max_bars": 4,
            "trades": [],
        },
        "C_BTC하락_알트역행": {
            "desc": "BTC 하락 시, 역행하여 상승하는 알트 매수 (강한 독립성)",
            "cond": lambda btc_ret, alt_ret: btc_ret < -BTC_VOLATILE_THRESHOLD and alt_ret > 0.3,
            "direction": lambda btc_ret: "long",
            "tp": 3.0, "sl": 1.5, "trail_act": 2.0, "trail_dist": 1.0, "max_bars": 6,
            "trades": [],
        },
        "D_변동폭확대": {
            "desc": "BTC 변동(어느 방향이든) 시, 알트 변동폭 큰 종목 매수",
            "cond": lambda btc_ret, alt_ret: abs(btc_ret) > BTC_VOLATILE_THRESHOLD and alt_ret > 0.5,
            "direction": lambda btc_ret: "long",
            "tp": 3.0, "sl": 2.0, "trail_act": 2.0, "trail_dist": 1.0, "max_bars": 4,
            "trades": [],
        },
    }

    # 4. 알트코인 데이터 수집 + 분석
    print(f"\n📡 알트코인 데이터 수집 + 분석... ({len(COINS)}개)")

    for coin in COINS:
        print(f"  {coin}...", end=" ", flush=True)
        alt_candles = fetch_all_candles(coin, days=DAYS, unit=UNIT)
        print(f"{len(alt_candles)}개", end="")

        if len(alt_candles) < 50:
            print(" (부족, 스킵)")
            continue

        alt_time_map = {}
        for i, c in enumerate(alt_candles):
            alt_time_map[c["candle_date_time_kst"]] = i

        coin_trades = 0
        last_exit_idx = -10

        for i in range(2, len(alt_candles)):
            kst = alt_candles[i]["candle_date_time_kst"]

            # 08~23시만
            hour = int(kst[11:13])
            if hour < 8:
                continue

            # BTC 변동 구간인지 확인
            if kst not in btc_volatile_times:
                continue

            # 쿨다운 (2바 = 30분)
            if i - last_exit_idx < 2:
                continue

            btc_idx = btc_time_map.get(kst)
            if btc_idx is None:
                continue

            # BTC 15분 수익률
            btc_ret = (btc_candles[btc_idx]["trade_price"] /
                       btc_candles[btc_idx - 1]["trade_price"] - 1) * 100

            # 알트 15분 수익률
            alt_ret = (alt_candles[i]["trade_price"] /
                       alt_candles[i - 1]["trade_price"] - 1) * 100

            for name, strat in strategies.items():
                if not strat["cond"](btc_ret, alt_ret):
                    continue

                # 롱만 지원 (업비트 현물)
                if strat["direction"](btc_ret) != "long":
                    continue

                result = simulate_trade_15m(
                    alt_candles, i,
                    tp_pct=strat["tp"], sl_pct=strat["sl"],
                    trail_act_pct=strat["trail_act"], trail_dist_pct=strat["trail_dist"],
                    max_hold_bars=strat["max_bars"]
                )
                result["coin"] = coin
                result["kst"] = kst
                result["btc_ret"] = round(btc_ret, 3)
                result["alt_ret"] = round(alt_ret, 3)
                strat["trades"].append(result)
                last_exit_idx = result["exit_idx"]
                coin_trades += 1
                break

        print(f" → {coin_trades}건")

    # 5. 결과 출력
    print("\n" + "=" * 70)
    print("📈 백테스트 결과")
    print("=" * 70)

    for name, strat in strategies.items():
        trades = strat["trades"]
        print(f"\n{'─' * 60}")
        print(f"전략 {name}")
        print(f"  {strat['desc']}")
        print(f"  TP: +{strat['tp']}% | SL: -{strat['sl']}% | 트레일: +{strat['trail_act']}% 활성")
        print(f"  최대 보유: {strat['max_bars']}바 ({strat['max_bars']*15}분)")
        print(f"{'─' * 60}")

        if not trades:
            print("  거래 없음")
            continue

        total_pnl = sum(t["pnl_pct"] for t in trades)
        wins = sum(1 for t in trades if t["pnl_pct"] > 0)
        losses = len(trades) - wins
        wr = wins / len(trades) * 100
        avg_pnl = total_pnl / len(trades)

        by_result = defaultdict(lambda: {"count": 0, "pnl": 0.0})
        for t in trades:
            by_result[t["result"]]["count"] += 1
            by_result[t["result"]]["pnl"] += t["pnl_pct"]

        # 코인별 성과
        by_coin = defaultdict(lambda: {"count": 0, "pnl": 0.0, "wins": 0})
        for t in trades:
            by_coin[t["coin"]]["count"] += 1
            by_coin[t["coin"]]["pnl"] += t["pnl_pct"]
            if t["pnl_pct"] > 0:
                by_coin[t["coin"]]["wins"] += 1

        print(f"  거래: {len(trades)}건 | 승률: {wr:.1f}% ({wins}승 {losses}패)")
        print(f"  총 수익률: {total_pnl:+.2f}% | 건당 평균: {avg_pnl:+.2f}%")

        # 50만원 기준 PnL 추정
        est_pnl = total_pnl / 100 * 500_000
        print(f"  50만원 기준 추정 PnL: {est_pnl:+,.0f}원 (30일)")
        print(f"  일평균: {est_pnl/30:+,.0f}원/일")

        print(f"\n  청산 유형:")
        for r, d in sorted(by_result.items()):
            print(f"    {r:6s}: {d['count']:3d}건, {d['pnl']:+.2f}%")

        # 코인별 Top/Bottom
        coin_sorted = sorted(by_coin.items(), key=lambda x: x[1]["pnl"], reverse=True)
        print(f"\n  코인별 성과 (상위 5):")
        for coin, d in coin_sorted[:5]:
            wr_c = d["wins"] / d["count"] * 100 if d["count"] > 0 else 0
            print(f"    {coin:12s}: {d['count']:2d}건, 승률 {wr_c:.0f}%, PnL {d['pnl']:+.2f}%")

        if len(coin_sorted) > 5:
            print(f"  코인별 성과 (하위 3):")
            for coin, d in coin_sorted[-3:]:
                wr_c = d["wins"] / d["count"] * 100 if d["count"] > 0 else 0
                print(f"    {coin:12s}: {d['count']:2d}건, 승률 {wr_c:.0f}%, PnL {d['pnl']:+.2f}%")

        # Best/Worst
        trades_sorted = sorted(trades, key=lambda t: t["pnl_pct"], reverse=True)
        print(f"\n  🏆 Best 3:")
        for t in trades_sorted[:3]:
            print(f"    {t['kst'][:16]} {t['coin']:12s} pnl={t['pnl_pct']:+.2f}% btc={t['btc_ret']:+.2f}% alt={t['alt_ret']:+.2f}% ({t['result']})")
        print(f"  💀 Worst 3:")
        for t in trades_sorted[-3:]:
            print(f"    {t['kst'][:16]} {t['coin']:12s} pnl={t['pnl_pct']:+.2f}% btc={t['btc_ret']:+.2f}% alt={t['alt_ret']:+.2f}% ({t['result']})")

    # 6. 전체 요약
    print("\n" + "=" * 70)
    print("📋 전체 요약")
    print("=" * 70)

    all_trades = []
    for name, strat in strategies.items():
        for t in strat["trades"]:
            t["strategy"] = name
        all_trades.extend(strat["trades"])

    if all_trades:
        total = sum(t["pnl_pct"] for t in all_trades)
        wins = sum(1 for t in all_trades if t["pnl_pct"] > 0)
        print(f"전체 거래: {len(all_trades)}건 | 승률: {wins/len(all_trades)*100:.1f}%")
        print(f"총 수익률: {total:+.2f}% | 건당 평균: {total/len(all_trades):+.2f}%")
        print(f"50만원 기준 추정: {total/100*500_000:+,.0f}원 (30일)")

        # 날짜별 거래 분포
        by_date = defaultdict(lambda: {"count": 0, "pnl": 0.0})
        for t in all_trades:
            date = t["kst"][:10]
            by_date[date]["count"] += 1
            by_date[date]["pnl"] += t["pnl_pct"]

        print(f"\n날짜별 거래:")
        for date in sorted(by_date.keys()):
            d = by_date[date]
            print(f"  {date}: {d['count']:3d}건, {d['pnl']:+.2f}%")
    else:
        print("거래 없음 — BTC가 최근 30일간 매우 안정적이었을 수 있음")

    # 7. BTC 변동 구간 히스토리
    print(f"\n📊 BTC 변동 구간 일별 분포:")
    vol_by_date = defaultdict(lambda: {"count": 0, "max_ret": 0})
    for idx, ret, direction in volatile_indices:
        date = btc_candles[idx]["candle_date_time_kst"][:10]
        vol_by_date[date]["count"] += 1
        if abs(ret) > abs(vol_by_date[date]["max_ret"]):
            vol_by_date[date]["max_ret"] = ret

    for date in sorted(vol_by_date.keys()):
        d = vol_by_date[date]
        print(f"  {date}: 변동 바 {d['count']:3d}개, 최대 {d['max_ret']:+.2f}%")

    print("\n✅ 백테스트 완료")


if __name__ == "__main__":
    main()
