#!/usr/bin/env python3
"""
코인 그리드봇 백테스트
- BTC/ETH 대상, 업비트 1시간봉
- 가격 구간별 그리드 매수/매도
- 횡보장에서 수익, 추세장 비교
"""

import json
import os
import time
import urllib.request
import urllib.error
from collections import defaultdict

CACHE_DIR = os.path.expanduser("~/backtest_cache/grid")
CANDLE_DAYS = 90
CANDLE_UNIT = 60
FEE_RATE = 0.001  # 편도 0.1%

SCENARIOS = {
    "A": {
        "name": "BTC 1.0% 그리드 20단",
        "market": "KRW-BTC",
        "capital": 1_000_000,
        "grid_pct": 0.01,
        "grid_count": 20,
    },
    "B": {
        "name": "BTC 1.5% 그리드 15단",
        "market": "KRW-BTC",
        "capital": 1_000_000,
        "grid_pct": 0.015,
        "grid_count": 15,
    },
    "C": {
        "name": "BTC 2.0% 그리드 10단",
        "market": "KRW-BTC",
        "capital": 1_000_000,
        "grid_pct": 0.02,
        "grid_count": 10,
    },
    "D": {
        "name": "ETH 2.0% 그리드 15단",
        "market": "KRW-ETH",
        "capital": 1_000_000,
        "grid_pct": 0.02,
        "grid_count": 15,
    },
    "E": {
        "name": "ETH 3.0% 그리드 10단",
        "market": "KRW-ETH",
        "capital": 1_000_000,
        "grid_pct": 0.03,
        "grid_count": 10,
    },
    "F": {
        "name": "BTC+ETH 2.0% 10단씩",
        "markets": ["KRW-BTC", "KRW-ETH"],
        "capital": 1_000_000,
        "grid_pct": 0.02,
        "grid_count": 10,
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


def fetch_candles(market, days=90):
    cache_file = os.path.join(CACHE_DIR, f"{market.replace('-','_')}_60m_{days}d.json")
    if os.path.exists(cache_file):
        mtime = os.path.getmtime(cache_file)
        if time.time() - mtime < 86400:
            with open(cache_file) as f:
                data = json.load(f)
                if len(data) > 100:
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

    all_candles.sort(key=lambda x: x["candle_date_time_kst"])

    with open(cache_file, "w") as f:
        json.dump(all_candles, f)
    return all_candles


class GridBot:
    """단일 코인 그리드봇 시뮬레이터"""

    def __init__(self, market, capital, grid_pct, grid_count, base_price):
        self.market = market
        self.grid_pct = grid_pct
        self.grid_count = grid_count
        self.capital_per_grid = capital / grid_count
        self.cash = capital
        self.trades = []

        # 그리드 레벨 생성 (base_price 기준 위아래 균등)
        half = grid_count // 2
        self.grid_levels = []
        for i in range(-half, half + 1):
            level = base_price * (1 + grid_pct * i)
            self.grid_levels.append(level)
        self.grid_levels.sort()

        # 각 그리드별 보유 상태: buy_price → (qty, buy_price)
        self.holdings = {}  # grid_index → {"qty": float, "buy_price": float}
        self.total_invested = 0
        self.realized_pnl = 0

    def process_candle(self, candle):
        low = candle["low_price"]
        high = candle["high_price"]
        close = candle["trade_price"]
        t = candle["candle_date_time_kst"]

        # 각 그리드 레벨 체크
        for i, level in enumerate(self.grid_levels):
            if i in self.holdings:
                # 보유 중 → 한 단계 위 레벨에서 매도
                sell_level = level * (1 + self.grid_pct)
                if high >= sell_level:
                    h = self.holdings[i]
                    sell_price = sell_level
                    proceeds = h["qty"] * sell_price * (1 - FEE_RATE)
                    cost = h["qty"] * h["buy_price"]
                    pnl = proceeds - cost
                    self.realized_pnl += pnl
                    self.cash += proceeds
                    self.total_invested -= cost
                    self.trades.append({
                        "time": t,
                        "side": "sell",
                        "price": sell_price,
                        "qty": h["qty"],
                        "pnl": pnl,
                        "grid": i,
                    })
                    del self.holdings[i]
            else:
                # 미보유 → 레벨에서 매수
                if low <= level and self.cash >= self.capital_per_grid:
                    buy_price = level
                    cost = self.capital_per_grid
                    qty = (cost * (1 - FEE_RATE)) / buy_price
                    self.holdings[i] = {"qty": qty, "buy_price": buy_price}
                    self.cash -= cost
                    self.total_invested += cost
                    self.trades.append({
                        "time": t,
                        "side": "buy",
                        "price": buy_price,
                        "qty": qty,
                        "grid": i,
                    })

    def get_equity(self, current_price):
        unrealized = sum(
            h["qty"] * current_price for h in self.holdings.values()
        )
        return self.cash + unrealized

    def get_unrealized_pnl(self, current_price):
        return sum(
            h["qty"] * (current_price - h["buy_price"]) for h in self.holdings.values()
        )


def run_single(scenario_key, scenario, candle_data):
    markets = scenario.get("markets", [scenario.get("market")])
    capital = scenario["capital"]
    grid_pct = scenario["grid_pct"]
    grid_count = scenario["grid_count"]

    if len(markets) > 1:
        cap_per = capital / len(markets)
    else:
        cap_per = capital

    bots = {}
    for market in markets:
        candles = candle_data[market]
        # 초기 가격: 첫 봉 종가 기준
        base_price = candles[60]["trade_price"] if len(candles) > 60 else candles[0]["trade_price"]
        bots[market] = GridBot(market, cap_per, grid_pct, grid_count, base_price)

    # 시뮬레이션
    equity_list = []
    # 타임라인 (모든 마켓 공통)
    all_times = set()
    time_idx = {}
    for market in markets:
        time_idx[market] = {}
        for idx, c in enumerate(candle_data[market]):
            t = c["candle_date_time_kst"]
            all_times.add(t)
            time_idx[market][t] = idx

    timeline = sorted(all_times)

    for t in timeline:
        for market in markets:
            if t in time_idx[market]:
                cidx = time_idx[market][t]
                bots[market].process_candle(candle_data[market][cidx])

        # 에쿼티 계산
        total_eq = 0
        for market in markets:
            if t in time_idx[market]:
                cidx = time_idx[market][t]
                cur_price = candle_data[market][cidx]["trade_price"]
                total_eq += bots[market].get_equity(cur_price)
            else:
                total_eq += bots[market].cash
        equity_list.append(total_eq)

    return bots, equity_list, timeline


def print_result(key, scenario, bots, equity_list, timeline, candle_data):
    markets = scenario.get("markets", [scenario.get("market")])
    capital = scenario["capital"]

    print(f"\n{'━'*60}")
    print(f"  시나리오 {key}: {scenario['name']}")
    print(f"  그리드: {scenario['grid_pct']*100}% × {scenario['grid_count']}단")
    print(f"{'━'*60}")

    final_equity = equity_list[-1] if equity_list else capital
    ret = (final_equity / capital - 1) * 100

    # MDD
    peak = equity_list[0] if equity_list else capital
    max_dd = 0
    for eq in equity_list:
        if eq > peak:
            peak = eq
        dd = (peak - eq) / peak * 100
        if dd > max_dd:
            max_dd = dd

    # 거래 통계
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

    monthly_pnl = total_realized / 3  # 3개월
    monthly_pct = monthly_pnl / capital * 100

    # 코인 가격 변동
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
    print(f"  매수       : {len(buys)}건")
    print(f"  매도(완결)  : {len(sells)}건")
    if sells:
        avg_sell_pnl = sum(t["pnl"] for t in sells) / len(sells)
        print(f"  건당 평균   : {avg_sell_pnl:+,.0f}원")

    for market in markets:
        bot = bots[market]
        nm = market.replace("KRW-", "")
        holding_count = len(bot.holdings)
        print(f"  {nm} 보유그리드: {holding_count}/{scenario['grid_count']} | 가격변동: {price_changes[market]:+.1f}%")

    # 최근 매도 5건
    recent_sells = [t for t in all_trades if t["side"] == "sell"][-5:]
    if recent_sells:
        print(f"\n  ─ 최근 매도 ─────────────────────")
        for t in recent_sells:
            print(f"    {t['time'][:13]} | @{t['price']:>12,.0f} | {t['pnl']:>+8,.0f}원")

    return {
        "key": key, "name": scenario["name"],
        "ret": ret, "realized": total_realized, "unrealized": total_unrealized,
        "mdd": max_dd, "buys": len(buys), "sells": len(sells),
        "monthly": monthly_pnl, "monthly_pct": monthly_pct,
        "equity": final_equity,
    }


def main():
    print("=" * 60)
    print("  코인 그리드봇 백테스트 (90일)")
    print("=" * 60)

    os.makedirs(CACHE_DIR, exist_ok=True)

    # 데이터 수집
    need_markets = set()
    for s in SCENARIOS.values():
        if "markets" in s:
            need_markets.update(s["markets"])
        else:
            need_markets.add(s["market"])

    candle_data = {}
    for market in sorted(need_markets):
        print(f"  {market} 수집...", end=" ", flush=True)
        candles = fetch_candles(market, CANDLE_DAYS)
        if candles and len(candles) > 60:
            candle_data[market] = candles
            start_p = candles[60]["trade_price"]
            end_p = candles[-1]["trade_price"]
            chg = (end_p / start_p - 1) * 100
            print(f"{len(candles)}봉 | {start_p:,.0f} → {end_p:,.0f} ({chg:+.1f}%)")
        else:
            print("스킵")

    # 시나리오 실행
    results = []
    for key in sorted(SCENARIOS.keys()):
        scenario = SCENARIOS[key]
        markets = scenario.get("markets", [scenario.get("market")])
        if not all(m in candle_data for m in markets):
            print(f"\n시나리오 {key}: 데이터 부족, 스킵")
            continue
        bots, equity, timeline = run_single(key, scenario, candle_data)
        result = print_result(key, scenario, bots, equity, timeline, candle_data)
        results.append(result)

    # 비교
    print(f"\n\n{'═'*65}")
    print(f"  최종 비교")
    print(f"{'═'*65}")
    print(f"  {'시나리오':<30s} {'수익률':>7s} {'실현':>10s} {'월수익':>10s} {'MDD':>6s} {'매도':>5s}")
    print(f"  {'─'*60}")
    for r in results:
        label = f"{r['key']}.{r['name']}"
        print(f"  {label:<30s} {r['ret']:>+6.1f}% {r['realized']:>+9,.0f} {r['monthly']:>+9,.0f} {r['mdd']:>5.1f}% {r['sells']:>4}건")

    tradeable = [r for r in results if r["sells"] > 0]
    if tradeable:
        best = max(tradeable, key=lambda x: x["realized"])
        print(f"\n  >>> BEST (실현수익): {best['key']} ({best['name']})")
        print(f"      실현 {best['realized']:+,.0f}원 | 월 {best['monthly']:+,.0f}원 ({best['monthly_pct']:+.1f}%/월)")

    print(f"\n{'═'*65}")
    print("완료!")


if __name__ == "__main__":
    main()
