#!/usr/bin/env python3
"""
코인 변동성 돌파 백테스트
- 래리 윌리엄스 전략 변형
- 당일 시가 + 전일 변동폭 × k 돌파 시 매수
- 다음 날 시가 매도 (또는 트레일링)
- 업비트 일봉 기준, 365일
"""

import json
import os
import time
import urllib.request
import urllib.error

CACHE_DIR = os.path.expanduser("~/backtest_cache/vb")
CANDLE_DAYS = 365
FEE_RATE = 0.001  # 편도 0.1%

# 테스트할 코인
COINS = ["KRW-BTC", "KRW-ETH", "KRW-XRP", "KRW-SOL", "KRW-DOGE",
         "KRW-AVAX", "KRW-LINK", "KRW-DOT", "KRW-ADA", "KRW-MATIC"]

SCENARIOS = {
    "A": {
        "name": "k=0.5 기본",
        "k": 0.5,
        "capital": 1_000_000,
        "coins": ["KRW-BTC", "KRW-ETH"],
        "max_positions": 2,
        "btc_filter": False,
        "trailing": False,
    },
    "B": {
        "name": "k=0.5 BTC필터",
        "k": 0.5,
        "capital": 1_000_000,
        "coins": ["KRW-BTC", "KRW-ETH"],
        "max_positions": 2,
        "btc_filter": True,
        "trailing": False,
    },
    "C": {
        "name": "k=0.5 트레일링3%",
        "k": 0.5,
        "capital": 1_000_000,
        "coins": ["KRW-BTC", "KRW-ETH"],
        "max_positions": 2,
        "btc_filter": False,
        "trailing": True,
        "trail_pct": 0.03,
    },
    "D": {
        "name": "k=0.5 BTC필터+트레일",
        "k": 0.5,
        "capital": 1_000_000,
        "coins": ["KRW-BTC", "KRW-ETH"],
        "max_positions": 2,
        "btc_filter": True,
        "trailing": True,
        "trail_pct": 0.03,
    },
    "E": {
        "name": "k=0.6 5코인",
        "k": 0.6,
        "capital": 1_000_000,
        "coins": ["KRW-BTC", "KRW-ETH", "KRW-XRP", "KRW-SOL", "KRW-DOGE"],
        "max_positions": 3,
        "btc_filter": True,
        "trailing": False,
    },
    "F": {
        "name": "k=0.4 5코인 공격적",
        "k": 0.4,
        "capital": 1_000_000,
        "coins": ["KRW-BTC", "KRW-ETH", "KRW-XRP", "KRW-SOL", "KRW-DOGE"],
        "max_positions": 3,
        "btc_filter": True,
        "trailing": False,
    },
    "G": {
        "name": "k=0.5 5코인+트레일",
        "k": 0.5,
        "capital": 1_000_000,
        "coins": ["KRW-BTC", "KRW-ETH", "KRW-XRP", "KRW-SOL", "KRW-DOGE"],
        "max_positions": 3,
        "btc_filter": True,
        "trailing": True,
        "trail_pct": 0.03,
    },
    "H": {
        "name": "k=0.5 10코인 분산",
        "k": 0.5,
        "capital": 1_000_000,
        "coins": COINS,
        "max_positions": 5,
        "btc_filter": True,
        "trailing": False,
    },
    "I": {
        "name": "k=0.5 10코인+트레일",
        "k": 0.5,
        "capital": 1_000_000,
        "coins": COINS,
        "max_positions": 5,
        "btc_filter": True,
        "trailing": True,
        "trail_pct": 0.03,
    },
}


def upbit_get(url, max_retries=3):
    for attempt in range(max_retries):
        try:
            req = urllib.request.Request(url, headers={"Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=10) as resp:
                return json.loads(resp.read().decode())
        except urllib.error.HTTPError as e:
            if e.code == 429:
                time.sleep(3)
            else:
                time.sleep(1)
        except Exception:
            time.sleep(1)
    return None


def fetch_daily_candles(market, days=365):
    cache_file = os.path.join(CACHE_DIR, f"{market.replace('-','_')}_daily_{days}d.json")
    if os.path.exists(cache_file):
        mtime = os.path.getmtime(cache_file)
        if time.time() - mtime < 86400:
            with open(cache_file) as f:
                data = json.load(f)
                if len(data) > 100:
                    return data

    all_candles = []
    to = None
    while len(all_candles) < days:
        count = min(200, days - len(all_candles))
        url = f"https://api.upbit.com/v1/candles/days?market={market}&count={count}"
        if to:
            url += f"&to={to}"
        data = upbit_get(url)
        if not data:
            break
        all_candles.extend(data)
        if len(data) < count:
            break
        to = data[-1]["candle_date_time_kst"]
        time.sleep(0.15)

    all_candles.sort(key=lambda x: x["candle_date_time_kst"])

    with open(cache_file, "w") as f:
        json.dump(all_candles, f)
    return all_candles


def calc_ma(prices, idx, period):
    if idx < period - 1:
        return None
    return sum(prices[idx - period + 1:idx + 1]) / period


def run_scenario(scenario, candle_data):
    k = scenario["k"]
    capital = scenario["capital"]
    coins = scenario["coins"]
    max_pos = scenario["max_positions"]
    btc_filter = scenario["btc_filter"]
    use_trailing = scenario.get("trailing", False)
    trail_pct = scenario.get("trail_pct", 0.03)

    cash = capital
    trades = []
    equity_history = []

    # BTC 일봉 MA5 계산 (추세 필터)
    btc_candles = candle_data.get("KRW-BTC", [])
    btc_closes = [c["trade_price"] for c in btc_candles]
    btc_dates = {c["candle_date_time_kst"][:10]: i for i, c in enumerate(btc_candles)}

    # 전체 타임라인 (일 단위)
    all_dates = set()
    date_candles = {}  # {market: {date: candle}}
    for market in coins:
        date_candles[market] = {}
        for c in candle_data.get(market, []):
            d = c["candle_date_time_kst"][:10]
            all_dates.add(d)
            date_candles[market][d] = c

    timeline = sorted(all_dates)

    # 포지션 관리
    positions = []  # [{"market", "entry_price", "qty", "entry_date", "high_since"}]

    for day_idx, today in enumerate(timeline):
        if day_idx < 2:
            equity_history.append(cash)
            continue

        yesterday = timeline[day_idx - 1]

        # BTC 필터
        btc_ok = True
        if btc_filter and today in btc_dates:
            bi = btc_dates[today]
            ma5 = calc_ma(btc_closes, bi, 5)
            if ma5 and btc_closes[bi] < ma5:
                btc_ok = False

        # 1) 기존 포지션 청산 (다음 날 시가 매도)
        closed = []
        for pos in positions:
            market = pos["market"]
            if today not in date_candles[market]:
                continue

            today_candle = date_candles[market][today]
            open_price = today_candle["opening_price"]
            high_price = today_candle["high_price"]

            if use_trailing:
                # 트레일링: 당일 고가 추적, 고가 대비 -trail_pct 이하로 떨어지면 청산
                if high_price > pos["high_since"]:
                    pos["high_since"] = high_price

                trail_stop = pos["high_since"] * (1 - trail_pct)

                # 당일 저가가 트레일 스탑 이하 → 청산
                if today_candle["low_price"] <= trail_stop:
                    exit_price = trail_stop
                    proceeds = pos["qty"] * exit_price * (1 - FEE_RATE)
                    cost = pos["qty"] * pos["entry_price"]
                    pnl = proceeds - cost
                    pnl_pct = (exit_price / pos["entry_price"] - 1) * 100
                    cash += proceeds
                    trades.append({
                        "market": market, "entry_date": pos["entry_date"],
                        "exit_date": today, "entry_price": pos["entry_price"],
                        "exit_price": exit_price, "pnl": pnl, "pnl_pct": pnl_pct,
                        "reason": "trail",
                    })
                    closed.append(pos)
                # 3일 이상 보유 시 강제 청산
                elif day_idx - pos.get("day_idx", day_idx) >= 3:
                    exit_price = today_candle["trade_price"]
                    proceeds = pos["qty"] * exit_price * (1 - FEE_RATE)
                    cost = pos["qty"] * pos["entry_price"]
                    pnl = proceeds - cost
                    pnl_pct = (exit_price / pos["entry_price"] - 1) * 100
                    cash += proceeds
                    trades.append({
                        "market": market, "entry_date": pos["entry_date"],
                        "exit_date": today, "entry_price": pos["entry_price"],
                        "exit_price": exit_price, "pnl": pnl, "pnl_pct": pnl_pct,
                        "reason": "time",
                    })
                    closed.append(pos)
            else:
                # 기본: 다음 날 시가 매도
                exit_price = open_price
                proceeds = pos["qty"] * exit_price * (1 - FEE_RATE)
                cost = pos["qty"] * pos["entry_price"]
                pnl = proceeds - cost
                pnl_pct = (exit_price / pos["entry_price"] - 1) * 100
                cash += proceeds
                trades.append({
                    "market": market, "entry_date": pos["entry_date"],
                    "exit_date": today, "entry_price": pos["entry_price"],
                    "exit_price": exit_price, "pnl": pnl, "pnl_pct": pnl_pct,
                    "reason": "next_open",
                })
                closed.append(pos)

        for c in closed:
            positions.remove(c)

        # 2) 신규 진입
        if btc_ok and len(positions) < max_pos:
            # 각 코인의 돌파 신호 체크
            signals = []
            for market in coins:
                if today not in date_candles[market] or yesterday not in date_candles[market]:
                    continue
                # 이미 보유 중이면 스킵
                if any(p["market"] == market for p in positions):
                    continue

                yest = date_candles[market][yesterday]
                tod = date_candles[market][today]

                prev_range = yest["high_price"] - yest["low_price"]
                target = tod["opening_price"] + prev_range * k

                # 당일 고가가 타겟 이상 → 돌파
                if tod["high_price"] >= target and prev_range > 0:
                    # 변동폭 대비 돌파 강도
                    strength = (tod["high_price"] - target) / prev_range
                    signals.append({
                        "market": market,
                        "entry_price": target,
                        "strength": strength,
                    })

            # 돌파 강도 순 정렬
            signals.sort(key=lambda x: x["strength"], reverse=True)

            slots = max_pos - len(positions)
            for sig in signals[:slots]:
                pos_size = cash / (slots - len([s for s in signals[:slots] if s == sig]) + 1)
                pos_size = min(pos_size, cash * 0.5)  # 최대 50%씩
                if pos_size < 10000:
                    continue
                entry_price = sig["entry_price"]
                qty = (pos_size * (1 - FEE_RATE)) / entry_price
                cash -= pos_size
                positions.append({
                    "market": sig["market"],
                    "entry_price": entry_price,
                    "qty": qty,
                    "entry_date": today,
                    "high_since": entry_price,
                    "day_idx": day_idx,
                })

        # 에쿼티
        total_eq = cash
        for pos in positions:
            market = pos["market"]
            if today in date_candles[market]:
                cur = date_candles[market][today]["trade_price"]
            else:
                cur = pos["entry_price"]
            total_eq += pos["qty"] * cur
        equity_history.append(total_eq)

    # 미청산 포지션 강제 청산
    last_day = timeline[-1]
    for pos in positions:
        market = pos["market"]
        if last_day in date_candles[market]:
            exit_price = date_candles[market][last_day]["trade_price"]
        else:
            exit_price = pos["entry_price"]
        proceeds = pos["qty"] * exit_price * (1 - FEE_RATE)
        cost = pos["qty"] * pos["entry_price"]
        pnl = proceeds - cost
        pnl_pct = (exit_price / pos["entry_price"] - 1) * 100
        cash += proceeds
        trades.append({
            "market": market, "entry_date": pos["entry_date"],
            "exit_date": last_day, "entry_price": pos["entry_price"],
            "exit_price": exit_price, "pnl": pnl, "pnl_pct": pnl_pct,
            "reason": "force_close",
        })
    positions.clear()

    return trades, equity_history, timeline


def print_result(key, scenario, trades, equity_history, candle_data):
    capital = scenario["capital"]

    print(f"\n{'━'*60}")
    print(f"  시나리오 {key}: {scenario['name']}")
    opts = [f"k={scenario['k']}"]
    opts.append(f"{len(scenario['coins'])}코인")
    opts.append(f"max{scenario['max_positions']}")
    if scenario["btc_filter"]: opts.append("BTC필터")
    if scenario.get("trailing"): opts.append(f"트레일{scenario['trail_pct']*100:.0f}%")
    print(f"  {' | '.join(opts)}")
    print(f"{'━'*60}")

    final = equity_history[-1] if equity_history else capital
    ret = (final / capital - 1) * 100

    # MDD
    peak = equity_history[0] if equity_history else capital
    max_dd = 0
    for eq in equity_history:
        if eq > peak:
            peak = eq
        dd = (peak - eq) / peak * 100
        if dd > max_dd:
            max_dd = dd

    total_pnl = sum(t["pnl"] for t in trades)
    wins = [t for t in trades if t["pnl"] > 0]
    losses = [t for t in trades if t["pnl"] <= 0]
    win_rate = len(wins) / len(trades) * 100 if trades else 0

    avg_win = sum(t["pnl"] for t in wins) / len(wins) if wins else 0
    avg_loss = sum(t["pnl"] for t in losses) / len(losses) if losses else 0
    pf = abs(sum(t["pnl"] for t in wins) / sum(t["pnl"] for t in losses)) if losses and sum(t["pnl"] for t in losses) != 0 else 999

    months = CANDLE_DAYS / 30
    monthly = total_pnl / months
    monthly_pct = monthly / capital * 100

    print(f"  최종 자본  : {final:>12,.0f}원 ({ret:+.1f}%)")
    print(f"  총 손익    : {total_pnl:>+12,.0f}원")
    print(f"  월 환산    : {monthly:>+12,.0f}원 ({monthly_pct:+.1f}%/월)")
    print(f"  MDD        : {max_dd:.1f}%")
    print(f"  거래       : {len(trades)}건 (승률 {win_rate:.0f}%)")
    print(f"  평균 승/패  : {avg_win:+,.0f} / {avg_loss:+,.0f}")
    print(f"  수익팩터   : {pf:.2f}")

    # 코인별 성과
    coin_stats = {}
    for t in trades:
        m = t["market"].replace("KRW-", "")
        if m not in coin_stats:
            coin_stats[m] = {"pnl": 0, "count": 0, "wins": 0}
        coin_stats[m]["pnl"] += t["pnl"]
        coin_stats[m]["count"] += 1
        if t["pnl"] > 0:
            coin_stats[m]["wins"] += 1

    if len(coin_stats) > 1:
        print(f"\n  ─ 코인별 ────────────────────────")
        for coin, st in sorted(coin_stats.items(), key=lambda x: x[1]["pnl"], reverse=True):
            wr = st["wins"] / st["count"] * 100 if st["count"] else 0
            print(f"    {coin:>5s}: {st['pnl']:>+10,.0f}원 ({st['count']}건, 승률{wr:.0f}%)")

    # 최근 거래 5건
    recent = trades[-5:]
    if recent:
        print(f"\n  ─ 최근 거래 ─────────────────────")
        for t in recent:
            nm = t["market"].replace("KRW-", "")
            print(f"    {t['exit_date'][:10]} {nm:>5s} | {t['pnl_pct']:>+5.1f}% | {t['pnl']:>+8,.0f}원 | {t['reason']}")

    return {
        "key": key, "name": scenario["name"],
        "ret": ret, "pnl": total_pnl, "mdd": max_dd,
        "trades": len(trades), "win_rate": win_rate, "pf": pf,
        "monthly": monthly, "monthly_pct": monthly_pct,
        "equity": final,
    }


def main():
    print("=" * 60)
    print("  코인 변동성 돌파 백테스트 (365일)")
    print("  래리 윌리엄스 전략 변형")
    print("=" * 60)

    os.makedirs(CACHE_DIR, exist_ok=True)

    # 필요한 코인 수집
    need = set()
    for s in SCENARIOS.values():
        need.update(s["coins"])

    candle_data = {}
    for market in sorted(need):
        print(f"  {market} 수집...", end=" ", flush=True)
        candles = fetch_daily_candles(market, CANDLE_DAYS)
        if candles and len(candles) > 30:
            candle_data[market] = candles
            start_p = candles[0]["trade_price"]
            end_p = candles[-1]["trade_price"]
            chg = (end_p / start_p - 1) * 100
            print(f"{len(candles)}일 | {start_p:,.0f} → {end_p:,.0f} ({chg:+.1f}%)")
        else:
            print("스킵")

    # 시나리오 실행
    results = []
    for key in sorted(SCENARIOS.keys()):
        scenario = SCENARIOS[key]
        if not all(m in candle_data for m in scenario["coins"]):
            print(f"\n시나리오 {key}: 데이터 부족, 스킵")
            continue
        trades, equity, timeline = run_scenario(scenario, candle_data)
        result = print_result(key, scenario, trades, equity, candle_data)
        results.append(result)

    # 비교
    print(f"\n\n{'═'*75}")
    print(f"  최종 비교")
    print(f"{'═'*75}")
    print(f"  {'시나리오':<28s} {'수익률':>7s} {'총PnL':>10s} {'월수익':>10s} {'MDD':>6s} {'승률':>5s} {'PF':>5s} {'거래':>5s}")
    print(f"  {'─'*70}")
    for r in results:
        label = f"{r['key']}.{r['name']}"
        print(f"  {label:<28s} {r['ret']:>+6.1f}% {r['pnl']:>+9,.0f} {r['monthly']:>+9,.0f} {r['mdd']:>5.1f}% {r['win_rate']:>4.0f}% {r['pf']:>4.1f} {r['trades']:>4}건")

    if results:
        best = max(results, key=lambda x: x["pnl"])
        print(f"\n  >>> BEST (수익): {best['key']} ({best['name']})")
        print(f"      수익 {best['pnl']:+,.0f}원 | 월 {best['monthly']:+,.0f}원 ({best['monthly_pct']:+.1f}%/월)")
        print(f"      MDD {best['mdd']:.1f}% | 승률 {best['win_rate']:.0f}% | PF {best['pf']:.2f}")

        safest = min([r for r in results if r["pnl"] > 0] or results, key=lambda x: x["mdd"])
        if safest["key"] != best["key"]:
            print(f"\n  >>> SAFEST: {safest['key']} ({safest['name']})")
            print(f"      MDD {safest['mdd']:.1f}% | 수익 {safest['pnl']:+,.0f}원 | 승률 {safest['win_rate']:.0f}%")

    print(f"\n{'═'*75}")
    print("완료!")


if __name__ == "__main__":
    main()
