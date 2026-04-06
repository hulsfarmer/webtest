#!/usr/bin/env python3
"""
코인 그리드봇 백테스트 — 2025년 포함 (365일)
2025-04 ~ 2026-04 전체 기간으로 횡보/상승/하락 모두 포함
"""

import json
import os
import time
import urllib.request
import urllib.error

CACHE_DIR = os.path.expanduser("~/backtest_cache/grid")
CANDLE_DAYS = 365
CANDLE_UNIT = 60
FEE_RATE = 0.001
MA_PERIOD = 20

SCENARIOS = {
    "A": {
        "name": "BTC 1.5% 15단 (원본)",
        "market": "KRW-BTC",
        "capital": 1_000_000,
        "grid_pct": 0.015,
        "grid_count": 15,
        "trend_filter": False,
    },
    "B": {
        "name": "BTC 2% 10단 (원본)",
        "market": "KRW-BTC",
        "capital": 1_000_000,
        "grid_pct": 0.02,
        "grid_count": 10,
        "trend_filter": False,
    },
    "C": {
        "name": "BTC 1.5% 15단+추세필터",
        "market": "KRW-BTC",
        "capital": 1_000_000,
        "grid_pct": 0.015,
        "grid_count": 15,
        "trend_filter": True,
    },
    "D": {
        "name": "BTC 2% 10단+추세필터",
        "market": "KRW-BTC",
        "capital": 1_000_000,
        "grid_pct": 0.02,
        "grid_count": 10,
        "trend_filter": True,
    },
    "E": {
        "name": "ETH 2% 15단 (원본)",
        "market": "KRW-ETH",
        "capital": 1_000_000,
        "grid_pct": 0.02,
        "grid_count": 15,
        "trend_filter": False,
    },
    "F": {
        "name": "ETH 2% 15단+추세필터",
        "market": "KRW-ETH",
        "capital": 1_000_000,
        "grid_pct": 0.02,
        "grid_count": 15,
        "trend_filter": True,
    },
    "G": {
        "name": "XRP 2% 15단 (원본)",
        "market": "KRW-XRP",
        "capital": 1_000_000,
        "grid_pct": 0.02,
        "grid_count": 15,
        "trend_filter": False,
    },
    "H": {
        "name": "XRP 2% 15단+추세필터",
        "market": "KRW-XRP",
        "capital": 1_000_000,
        "grid_pct": 0.02,
        "grid_count": 15,
        "trend_filter": True,
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


def fetch_candles(market, days=365):
    cache_file = os.path.join(CACHE_DIR, f"{market.replace('-','_')}_60m_{days}d.json")
    if os.path.exists(cache_file):
        mtime = os.path.getmtime(cache_file)
        if time.time() - mtime < 86400:
            with open(cache_file) as f:
                data = json.load(f)
                if len(data) > 1000:
                    return data

    total_candles = days * 24
    all_candles = []
    to = None

    while len(all_candles) < total_candles:
        count = min(200, total_candles - len(all_candles))
        url = f"https://api.upbit.com/v1/candles/minutes/{CANDLE_UNIT}?market={market}&count={count}"
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
        if len(all_candles) % 2000 == 0:
            print(f"{len(all_candles)}...", end=" ", flush=True)

    all_candles.sort(key=lambda x: x["candle_date_time_kst"])

    os.makedirs(CACHE_DIR, exist_ok=True)
    with open(cache_file, "w") as f:
        json.dump(all_candles, f)
    return all_candles


def calc_ma(candles, idx, period=20):
    if idx < period - 1:
        return None
    total = sum(candles[i]["trade_price"] for i in range(idx - period + 1, idx + 1))
    return total / period


class GridBot:
    def __init__(self, market, capital, grid_pct, grid_count, base_price, trend_filter=False):
        self.market = market
        self.grid_pct = grid_pct
        self.grid_count = grid_count
        self.initial_capital = capital
        self.capital_per_grid = capital / grid_count
        self.cash = capital
        self.trades = []
        self.trend_filter = trend_filter

        half = grid_count // 2
        self.grid_levels = []
        for i in range(-half, half + 1):
            level = base_price * (1 + grid_pct * i)
            self.grid_levels.append(level)
        self.grid_levels.sort()

        self.holdings = {}
        self.realized_pnl = 0

    def process_candle(self, candle, btc_ma=None, btc_price=None):
        low = candle["low_price"]
        high = candle["high_price"]
        t = candle["candle_date_time_kst"]

        trend_ok = True
        if self.trend_filter and btc_ma is not None and btc_price is not None:
            trend_ok = btc_price > btc_ma

        for i, level in enumerate(self.grid_levels):
            if i in self.holdings:
                sell_level = level * (1 + self.grid_pct)
                if high >= sell_level:
                    h = self.holdings[i]
                    proceeds = h["qty"] * sell_level * (1 - FEE_RATE)
                    cost = h["qty"] * h["buy_price"]
                    pnl = proceeds - cost
                    self.realized_pnl += pnl
                    self.cash += proceeds
                    self.trades.append({
                        "time": t, "side": "sell", "price": sell_level,
                        "qty": h["qty"], "pnl": pnl, "grid": i,
                    })
                    del self.holdings[i]
            else:
                if trend_ok and low <= level and self.cash >= self.capital_per_grid:
                    buy_price = level
                    cost = self.capital_per_grid
                    qty = (cost * (1 - FEE_RATE)) / buy_price
                    self.holdings[i] = {"qty": qty, "buy_price": buy_price}
                    self.cash -= cost
                    self.trades.append({
                        "time": t, "side": "buy", "price": buy_price,
                        "qty": qty, "grid": i,
                    })

    def get_equity(self, current_price):
        unrealized = sum(h["qty"] * current_price for h in self.holdings.values())
        return self.cash + unrealized

    def get_unrealized_pnl(self, current_price):
        return sum(
            h["qty"] * (current_price - h["buy_price"]) for h in self.holdings.values()
        )


def run_single(scenario, candle_data, btc_candles):
    markets = scenario.get("markets", [scenario.get("market")])
    capital = scenario["capital"]
    grid_pct = scenario["grid_pct"]
    grid_count = scenario["grid_count"]
    trend_filter = scenario.get("trend_filter", False)

    cap_per = capital / len(markets) if len(markets) > 1 else capital

    btc_ma_map = {}
    if btc_candles:
        for idx, c in enumerate(btc_candles):
            t = c["candle_date_time_kst"]
            ma = calc_ma(btc_candles, idx, MA_PERIOD)
            btc_ma_map[t] = (ma, c["trade_price"])

    bots = {}
    for market in markets:
        candles = candle_data[market]
        base_price = candles[60]["trade_price"] if len(candles) > 60 else candles[0]["trade_price"]
        bots[market] = GridBot(market, cap_per, grid_pct, grid_count, base_price, trend_filter)

    equity_list = []
    all_times = set()
    time_idx = {}
    for market in markets:
        time_idx[market] = {}
        for idx, c in enumerate(candle_data[market]):
            t = c["candle_date_time_kst"]
            all_times.add(t)
            time_idx[market][t] = idx

    timeline = sorted(all_times)

    # 분기별 에쿼티 기록
    quarterly = {}

    for t in timeline:
        btc_ma_val, btc_price_val = btc_ma_map.get(t, (None, None))

        for market in markets:
            if t in time_idx[market]:
                cidx = time_idx[market][t]
                bots[market].process_candle(candle_data[market][cidx], btc_ma_val, btc_price_val)

        total_eq = 0
        for market in markets:
            if t in time_idx[market]:
                cidx = time_idx[market][t]
                total_eq += bots[market].get_equity(candle_data[market][cidx]["trade_price"])
            else:
                total_eq += bots[market].cash
        equity_list.append(total_eq)

        # 월별 스냅샷
        month = t[:7]  # YYYY-MM
        quarterly[month] = total_eq

    return bots, equity_list, timeline, quarterly


def print_result(key, scenario, bots, equity_list, timeline, candle_data, quarterly):
    markets = scenario.get("markets", [scenario.get("market")])
    capital = scenario["capital"]

    print(f"\n{'━'*60}")
    print(f"  시나리오 {key}: {scenario['name']}")
    tf = "+추세필터" if scenario.get("trend_filter") else ""
    print(f"  그리드: {scenario['grid_pct']*100}% × {scenario['grid_count']}단 {tf}")
    print(f"{'━'*60}")

    final_equity = equity_list[-1] if equity_list else capital
    ret = (final_equity / capital - 1) * 100

    peak = equity_list[0] if equity_list else capital
    max_dd = 0
    for eq in equity_list:
        if eq > peak:
            peak = eq
        dd = (peak - eq) / peak * 100
        if dd > max_dd:
            max_dd = dd

    all_trades = []
    total_realized = 0
    total_unrealized = 0
    for market in markets:
        bot = bots[market]
        all_trades.extend(bot.trades)
        total_realized += bot.realized_pnl
        last_candle = candle_data[market][-1]
        total_unrealized += bot.get_unrealized_pnl(last_candle["trade_price"])

    sells = [t for t in all_trades if t["side"] == "sell"]
    buys = [t for t in all_trades if t["side"] == "buy"]

    months = CANDLE_DAYS / 30
    monthly_pnl = total_realized / months
    monthly_pct = monthly_pnl / capital * 100

    price_changes = {}
    for market in markets:
        c = candle_data[market]
        start_p = c[60]["trade_price"] if len(c) > 60 else c[0]["trade_price"]
        end_p = c[-1]["trade_price"]
        price_changes[market] = (end_p / start_p - 1) * 100

    print(f"  최종 자본  : {final_equity:>12,.0f}원 ({ret:+.1f}%)")
    print(f"  실현 손익  : {total_realized:>+12,.0f}원")
    print(f"  미실현     : {total_unrealized:>+12,.0f}원")
    print(f"  월 환산    : {monthly_pnl:>+12,.0f}원 ({monthly_pct:+.1f}%/월)")
    print(f"  MDD        : {max_dd:.1f}%")
    print(f"  매수       : {len(buys)}건 | 매도: {len(sells)}건")
    if sells:
        avg_sell_pnl = sum(t["pnl"] for t in sells) / len(sells)
        print(f"  건당 평균   : {avg_sell_pnl:+,.0f}원")

    for market in markets:
        bot = bots[market]
        nm = market.replace("KRW-", "")
        print(f"  {nm} 보유: {len(bot.holdings)}/{scenario['grid_count']} | 가격변동: {price_changes[market]:+.1f}%")

    # 월별 에쿼티
    print(f"\n  ─ 월별 에쿼티 ────────────────────")
    prev = capital
    for month in sorted(quarterly.keys()):
        eq = quarterly[month]
        chg = (eq / prev - 1) * 100 if prev > 0 else 0
        total_chg = (eq / capital - 1) * 100
        print(f"    {month} | {eq:>10,.0f}원 | 월{chg:>+5.1f}% | 누적{total_chg:>+6.1f}%")
        prev = eq

    return {
        "key": key, "name": scenario["name"],
        "ret": ret, "realized": total_realized, "unrealized": total_unrealized,
        "mdd": max_dd, "buys": len(buys), "sells": len(sells),
        "monthly": monthly_pnl, "monthly_pct": monthly_pct,
        "equity": final_equity,
    }


def main():
    print("=" * 60)
    print("  코인 그리드봇 백테스트 (365일, 2025~2026)")
    print("=" * 60)

    os.makedirs(CACHE_DIR, exist_ok=True)

    need_markets = {"KRW-BTC"}
    for s in SCENARIOS.values():
        if "markets" in s:
            need_markets.update(s["markets"])
        else:
            need_markets.add(s["market"])

    candle_data = {}
    for market in sorted(need_markets):
        print(f"  {market} 수집...", end=" ", flush=True)
        candles = fetch_candles(market, CANDLE_DAYS)
        if candles and len(candles) > 100:
            candle_data[market] = candles
            start_p = candles[60]["trade_price"]
            end_p = candles[-1]["trade_price"]
            chg = (end_p / start_p - 1) * 100
            start_t = candles[0]["candle_date_time_kst"][:10]
            end_t = candles[-1]["candle_date_time_kst"][:10]
            print(f"{len(candles)}봉 | {start_t}~{end_t} | {start_p:,.0f} → {end_p:,.0f} ({chg:+.1f}%)")
        else:
            print("스킵")

    btc_candles = candle_data.get("KRW-BTC")

    if btc_candles:
        above = sum(1 for i in range(MA_PERIOD, len(btc_candles))
                     if calc_ma(btc_candles, i, MA_PERIOD) and
                     btc_candles[i]["trade_price"] > calc_ma(btc_candles, i, MA_PERIOD))
        total = len(btc_candles) - MA_PERIOD
        print(f"\n  BTC MA{MA_PERIOD} 위 비율: {above}/{total} ({above/total*100:.0f}%)")

    results = []
    for key in sorted(SCENARIOS.keys()):
        scenario = SCENARIOS[key]
        markets = scenario.get("markets", [scenario.get("market")])
        if not all(m in candle_data for m in markets):
            print(f"\n시나리오 {key}: 데이터 부족, 스킵")
            continue
        bots, equity, timeline, quarterly = run_single(scenario, candle_data, btc_candles)
        result = print_result(key, scenario, bots, equity, timeline, candle_data, quarterly)
        results.append(result)

    print(f"\n\n{'═'*70}")
    print(f"  최종 비교 (365일)")
    print(f"{'═'*70}")
    print(f"  {'시나리오':<30s} {'수익률':>7s} {'실현':>10s} {'월수익':>10s} {'MDD':>6s} {'매도':>5s}")
    print(f"  {'─'*65}")
    for r in results:
        label = f"{r['key']}.{r['name']}"
        print(f"  {label:<30s} {r['ret']:>+6.1f}% {r['realized']:>+9,.0f} {r['monthly']:>+9,.0f} {r['mdd']:>5.1f}% {r['sells']:>4}건")

    # 추세필터 효과 비교
    pairs = [("A", "C"), ("B", "D"), ("E", "F"), ("G", "H")]
    print(f"\n  ── 추세필터 효과 ──")
    for orig, filt in pairs:
        r_orig = next((r for r in results if r["key"] == orig), None)
        r_filt = next((r for r in results if r["key"] == filt), None)
        if r_orig and r_filt:
            coin = r_orig["name"].split()[0]
            print(f"    {coin}: 원본 {r_orig['ret']:+.1f}% MDD{r_orig['mdd']:.0f}% → 필터 {r_filt['ret']:+.1f}% MDD{r_filt['mdd']:.0f}% | 실현 {r_orig['realized']:+,.0f} → {r_filt['realized']:+,.0f}")

    if results:
        best = max(results, key=lambda x: x["realized"])
        print(f"\n  >>> BEST (실현수익): {best['key']} ({best['name']})")
        print(f"      실현 {best['realized']:+,.0f}원 | 월 {best['monthly']:+,.0f}원 ({best['monthly_pct']:+.1f}%/월) | MDD {best['mdd']:.1f}%")

        safest = min(results, key=lambda x: x["mdd"])
        print(f"\n  >>> SAFEST: {safest['key']} ({safest['name']})")
        print(f"      MDD {safest['mdd']:.1f}% | 수익률 {safest['ret']:+.1f}% | 실현 {safest['realized']:+,.0f}원")

    print(f"\n{'═'*70}")
    print("완료!")


if __name__ == "__main__":
    main()
