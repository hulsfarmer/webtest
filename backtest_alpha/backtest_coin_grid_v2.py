#!/usr/bin/env python3
"""
코인 그리드봇 백테스트 v2 (개선판)
개선사항:
1. 추세 필터: BTC MA20 위일 때만 매수 허용
2. 그리드 리밸런싱: 가격이 그리드 범위 이탈 시 재설정
3. 전체 손절: 총자산 -8% 시 전 포지션 청산 후 대기
4. 횡보 코인 추가: XRP, DOGE 등 횡보성 코인 테스트
5. 하락장 방어: 추세 하락 시 매수 중단 + 보유분 단계 청산
"""

import json
import os
import time
import urllib.request
import urllib.error

CACHE_DIR = os.path.expanduser("~/backtest_cache/grid")
CANDLE_DAYS = 90
CANDLE_UNIT = 60
FEE_RATE = 0.001  # 편도 0.1%
MA_PERIOD = 20  # 추세 필터용 MA

SCENARIOS = {
    # === 기본 (v1 대비 개선) ===
    "A": {
        "name": "BTC 1.5% 15단+추세필터",
        "market": "KRW-BTC",
        "capital": 1_000_000,
        "grid_pct": 0.015,
        "grid_count": 15,
        "trend_filter": True,
        "rebalance": False,
        "total_sl": None,
    },
    "B": {
        "name": "BTC 2% 10단+추세+리밸",
        "market": "KRW-BTC",
        "capital": 1_000_000,
        "grid_pct": 0.02,
        "grid_count": 10,
        "trend_filter": True,
        "rebalance": True,
        "total_sl": None,
    },
    "C": {
        "name": "BTC 2% 10단+추세+SL8%",
        "market": "KRW-BTC",
        "capital": 1_000_000,
        "grid_pct": 0.02,
        "grid_count": 10,
        "trend_filter": True,
        "rebalance": False,
        "total_sl": 0.08,
    },
    "D": {
        "name": "BTC 2% 10단+추세+리밸+SL",
        "market": "KRW-BTC",
        "capital": 1_000_000,
        "grid_pct": 0.02,
        "grid_count": 10,
        "trend_filter": True,
        "rebalance": True,
        "total_sl": 0.08,
    },
    # === ETH ===
    "E": {
        "name": "ETH 2% 15단+추세+리밸+SL",
        "market": "KRW-ETH",
        "capital": 1_000_000,
        "grid_pct": 0.02,
        "grid_count": 15,
        "trend_filter": True,
        "rebalance": True,
        "total_sl": 0.08,
    },
    # === 횡보 코인 ===
    "F": {
        "name": "XRP 2% 15단+추세+리밸+SL",
        "market": "KRW-XRP",
        "capital": 1_000_000,
        "grid_pct": 0.02,
        "grid_count": 15,
        "trend_filter": True,
        "rebalance": True,
        "total_sl": 0.08,
    },
    "G": {
        "name": "DOGE 3% 10단+추세+리밸+SL",
        "market": "KRW-DOGE",
        "capital": 1_000_000,
        "grid_pct": 0.03,
        "grid_count": 10,
        "trend_filter": True,
        "rebalance": True,
        "total_sl": 0.08,
    },
    # === 멀티코인 ===
    "H": {
        "name": "BTC+ETH+XRP 2% 8단+풀옵션",
        "markets": ["KRW-BTC", "KRW-ETH", "KRW-XRP"],
        "capital": 1_000_000,
        "grid_pct": 0.02,
        "grid_count": 8,
        "trend_filter": True,
        "rebalance": True,
        "total_sl": 0.08,
    },
    # === v1 원본 비교용 (개선 없음) ===
    "Z": {
        "name": "BTC 2% 10단 (v1 원본)",
        "market": "KRW-BTC",
        "capital": 1_000_000,
        "grid_pct": 0.02,
        "grid_count": 10,
        "trend_filter": False,
        "rebalance": False,
        "total_sl": None,
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


def calc_ma(candles, idx, period=20):
    """idx 시점의 종가 MA 계산"""
    if idx < period - 1:
        return None
    total = sum(candles[i]["trade_price"] for i in range(idx - period + 1, idx + 1))
    return total / period


class GridBotV2:
    """개선된 그리드봇 시뮬레이터"""

    def __init__(self, market, capital, grid_pct, grid_count, base_price,
                 trend_filter=False, rebalance=False, total_sl=None):
        self.market = market
        self.grid_pct = grid_pct
        self.grid_count = grid_count
        self.initial_capital = capital
        self.capital_per_grid = capital / grid_count
        self.cash = capital
        self.trades = []
        self.trend_filter = trend_filter
        self.rebalance = rebalance
        self.total_sl = total_sl
        self.paused = False  # 추세 하락 or 손절 후 대기
        self.sl_triggered = False
        self.rebalance_count = 0

        self._setup_grid(base_price)

        self.holdings = {}
        self.realized_pnl = 0

    def _setup_grid(self, base_price):
        """그리드 레벨 (재)설정"""
        self.base_price = base_price
        half = self.grid_count // 2
        self.grid_levels = []
        for i in range(-half, half + 1):
            level = base_price * (1 + self.grid_pct * i)
            self.grid_levels.append(level)
        self.grid_levels.sort()
        self.grid_low = self.grid_levels[0]
        self.grid_high = self.grid_levels[-1]

    def _force_close_all(self, price, t, reason="sl"):
        """전 포지션 강제 청산"""
        for i in list(self.holdings.keys()):
            h = self.holdings[i]
            proceeds = h["qty"] * price * (1 - FEE_RATE)
            cost = h["qty"] * h["buy_price"]
            pnl = proceeds - cost
            self.realized_pnl += pnl
            self.cash += proceeds
            self.trades.append({
                "time": t, "side": "sell", "price": price,
                "qty": h["qty"], "pnl": pnl, "grid": i, "reason": reason,
            })
        self.holdings.clear()

    def process_candle(self, candle, btc_ma=None, btc_price=None):
        low = candle["low_price"]
        high = candle["high_price"]
        close = candle["trade_price"]
        t = candle["candle_date_time_kst"]

        # 추세 필터: BTC 가격 < MA20 이면 매수 중단
        trend_ok = True
        if self.trend_filter and btc_ma is not None and btc_price is not None:
            trend_ok = btc_price > btc_ma

        # 전체 손절 체크
        if self.total_sl and not self.sl_triggered:
            equity = self.get_equity(close)
            if equity < self.initial_capital * (1 - self.total_sl):
                self._force_close_all(close, t, "total_sl")
                self.sl_triggered = True
                self.paused = True
                return

        # 손절 후 복귀 조건: 추세 복귀 시 재시작
        if self.sl_triggered and trend_ok:
            self.sl_triggered = False
            self.paused = False
            # 리밸런싱: 현재가 기준으로 그리드 재설정
            self._setup_grid(close)
            self.capital_per_grid = self.cash / self.grid_count

        if self.paused:
            return

        # 리밸런싱: 가격이 그리드 범위 40% 이상 이탈 시 재설정
        if self.rebalance:
            grid_range = self.grid_high - self.grid_low
            if close < self.grid_low - grid_range * 0.4 or close > self.grid_high + grid_range * 0.4:
                self._force_close_all(close, t, "rebalance")
                self._setup_grid(close)
                self.capital_per_grid = self.cash / self.grid_count
                self.rebalance_count += 1
                return

        # 추세 하락 시: 기존 보유분 매도만 처리, 신규 매수 차단
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
                    self.trades.append({
                        "time": t, "side": "sell", "price": sell_price,
                        "qty": h["qty"], "pnl": pnl, "grid": i, "reason": "grid",
                    })
                    del self.holdings[i]
            else:
                # 미보유 → 레벨에서 매수 (추세 OK일 때만)
                if trend_ok and low <= level and self.cash >= self.capital_per_grid:
                    buy_price = level
                    cost = self.capital_per_grid
                    qty = (cost * (1 - FEE_RATE)) / buy_price
                    self.holdings[i] = {"qty": qty, "buy_price": buy_price}
                    self.cash -= cost
                    self.trades.append({
                        "time": t, "side": "buy", "price": buy_price,
                        "qty": qty, "grid": i, "reason": "grid",
                    })

    def get_equity(self, current_price):
        unrealized = sum(h["qty"] * current_price for h in self.holdings.values())
        return self.cash + unrealized

    def get_unrealized_pnl(self, current_price):
        return sum(
            h["qty"] * (current_price - h["buy_price"]) for h in self.holdings.values()
        )


def run_single(scenario_key, scenario, candle_data, btc_candles):
    markets = scenario.get("markets", [scenario.get("market")])
    capital = scenario["capital"]
    grid_pct = scenario["grid_pct"]
    grid_count = scenario["grid_count"]
    trend_filter = scenario.get("trend_filter", False)
    rebalance = scenario.get("rebalance", False)
    total_sl = scenario.get("total_sl", None)

    cap_per = capital / len(markets) if len(markets) > 1 else capital

    # BTC MA 사전 계산 (추세 필터용)
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
        bots[market] = GridBotV2(
            market, cap_per, grid_pct, grid_count, base_price,
            trend_filter=trend_filter, rebalance=rebalance, total_sl=total_sl
        )

    # 타임라인
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

    for t in timeline:
        btc_ma_val = None
        btc_price_val = None
        if t in btc_ma_map:
            btc_ma_val, btc_price_val = btc_ma_map[t]

        for market in markets:
            if t in time_idx[market]:
                cidx = time_idx[market][t]
                bots[market].process_candle(
                    candle_data[market][cidx],
                    btc_ma=btc_ma_val, btc_price=btc_price_val
                )

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
    opts = []
    if scenario.get("trend_filter"): opts.append("추세필터")
    if scenario.get("rebalance"): opts.append("리밸런싱")
    if scenario.get("total_sl"): opts.append(f"SL{scenario['total_sl']*100:.0f}%")
    print(f"  그리드: {scenario['grid_pct']*100}% × {scenario['grid_count']}단 | {', '.join(opts) if opts else '없음'}")
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
    total_rebalance = 0
    for market in markets:
        bot = bots[market]
        all_trades.extend(bot.trades)
        total_realized += bot.realized_pnl
        last_candle = candle_data[market][-1]
        total_unrealized += bot.get_unrealized_pnl(last_candle["trade_price"])
        total_rebalance += bot.rebalance_count

    sells = [t for t in all_trades if t["side"] == "sell"]
    buys = [t for t in all_trades if t["side"] == "buy"]
    grid_sells = [t for t in sells if t.get("reason") == "grid"]
    sl_sells = [t for t in sells if t.get("reason") == "total_sl"]
    rebal_sells = [t for t in sells if t.get("reason") == "rebalance"]

    months = CANDLE_DAYS / 30
    monthly_pnl = total_realized / months
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
    print(f"  매수       : {len(buys)}건 | 그리드매도: {len(grid_sells)}건")
    if sl_sells:
        print(f"  손절청산   : {len(sl_sells)}건")
    if rebal_sells:
        print(f"  리밸청산   : {rebal_sells}건 | 리밸횟수: {total_rebalance}")
    if grid_sells:
        avg_sell_pnl = sum(t["pnl"] for t in grid_sells) / len(grid_sells)
        print(f"  건당 평균   : {avg_sell_pnl:+,.0f}원 (그리드 매도)")

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
            reason = t.get("reason", "")
            print(f"    {t['time'][:13]} | @{t['price']:>12,.0f} | {t['pnl']:>+8,.0f}원 | {reason}")

    return {
        "key": key, "name": scenario["name"],
        "ret": ret, "realized": total_realized, "unrealized": total_unrealized,
        "mdd": max_dd, "buys": len(buys), "sells": len(grid_sells),
        "monthly": monthly_pnl, "monthly_pct": monthly_pct,
        "equity": final_equity, "rebalance": total_rebalance,
    }


def main():
    print("=" * 60)
    print("  코인 그리드봇 v2 백테스트 (90일)")
    print("  개선: 추세필터 + 리밸런싱 + 전체손절")
    print("=" * 60)

    os.makedirs(CACHE_DIR, exist_ok=True)

    # 데이터 수집 (BTC는 항상 필요 — 추세 필터)
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
        if candles and len(candles) > 60:
            candle_data[market] = candles
            start_p = candles[60]["trade_price"]
            end_p = candles[-1]["trade_price"]
            chg = (end_p / start_p - 1) * 100
            print(f"{len(candles)}봉 | {start_p:,.0f} → {end_p:,.0f} ({chg:+.1f}%)")
        else:
            print("스킵")

    btc_candles = candle_data.get("KRW-BTC")

    # BTC 추세 통계
    if btc_candles:
        above_ma = 0
        total_check = 0
        for idx in range(MA_PERIOD, len(btc_candles)):
            ma = calc_ma(btc_candles, idx, MA_PERIOD)
            if ma and btc_candles[idx]["trade_price"] > ma:
                above_ma += 1
            total_check += 1
        print(f"\n  BTC MA{MA_PERIOD} 위 비율: {above_ma}/{total_check} ({above_ma/total_check*100:.0f}%)")

    # 시나리오 실행
    results = []
    for key in sorted(SCENARIOS.keys()):
        scenario = SCENARIOS[key]
        markets = scenario.get("markets", [scenario.get("market")])
        if not all(m in candle_data for m in markets):
            print(f"\n시나리오 {key}: 데이터 부족, 스킵")
            continue
        bots, equity, timeline = run_single(key, scenario, candle_data, btc_candles)
        result = print_result(key, scenario, bots, equity, timeline, candle_data)
        results.append(result)

    # 비교
    print(f"\n\n{'═'*70}")
    print(f"  최종 비교")
    print(f"{'═'*70}")
    print(f"  {'시나리오':<35s} {'수익률':>7s} {'실현':>10s} {'월수익':>10s} {'MDD':>6s} {'매도':>5s} {'리밸':>4s}")
    print(f"  {'─'*65}")
    for r in results:
        label = f"{r['key']}.{r['name']}"
        print(f"  {label:<35s} {r['ret']:>+6.1f}% {r['realized']:>+9,.0f} {r['monthly']:>+9,.0f} {r['mdd']:>5.1f}% {r['sells']:>4}건 {r['rebalance']:>3}")

    # v1 원본 vs 개선 비교
    z = next((r for r in results if r["key"] == "Z"), None)
    if z:
        print(f"\n  ── v1 원본(Z) 대비 개선 ──")
        for r in results:
            if r["key"] != "Z" and "BTC" in r["name"]:
                diff_ret = r["ret"] - z["ret"]
                diff_mdd = r["mdd"] - z["mdd"]
                print(f"    {r['key']}: 수익률 {diff_ret:+.1f}%p, MDD {diff_mdd:+.1f}%p, 실현 {r['realized'] - z['realized']:+,.0f}원")

    tradeable = [r for r in results if r["sells"] > 0]
    if tradeable:
        best = max(tradeable, key=lambda x: x["realized"])
        print(f"\n  >>> BEST (실현수익): {best['key']} ({best['name']})")
        print(f"      실현 {best['realized']:+,.0f}원 | 월 {best['monthly']:+,.0f}원 ({best['monthly_pct']:+.1f}%/월)")
        print(f"      MDD {best['mdd']:.1f}% | 리밸런싱 {best['rebalance']}회")

    # 가장 방어적인 시나리오
    if results:
        safest = min(results, key=lambda x: x["mdd"])
        print(f"\n  >>> SAFEST (최저MDD): {safest['key']} ({safest['name']})")
        print(f"      MDD {safest['mdd']:.1f}% | 수익률 {safest['ret']:+.1f}% | 실현 {safest['realized']:+,.0f}원")

    print(f"\n{'═'*70}")
    print("완료!")


if __name__ == "__main__":
    main()
