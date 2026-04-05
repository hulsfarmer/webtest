#!/usr/bin/env python3
"""
코인 스윙봇 v5.1-v2 백테스트
- 시나리오 D 베이스 (대양봉 2~8%, TP 5/10/15%, SL 5%)
- 트레일링스탑 + 타임스탑 추가
- 코인 특화(ONT, ONG, ZETA) vs 전체 비교
"""

import json
import os
import time
import urllib.request
import urllib.error
from datetime import datetime
from collections import defaultdict

# ═══ 설정 ═══
CACHE_DIR = os.path.expanduser("~/backtest_cache/coin_swing_v51")
INITIAL_CAPITAL = 1_000_000
MAX_POSITIONS = 3
FEE_RATE = 0.001
SLIPPAGE = 0.001
CANDLE_DAYS = 90
CANDLE_UNIT = 60

# 공통 진입 조건
RSI_MIN = 50
VOL_SURGE = 1.5
BTC_FILTER = True

SCENARIOS = {
    "D": {
        "name": "D 원본 (기준선)",
        "big_candle_min": 0.02, "big_candle_max": 0.08,
        "tp1_pct": 0.05, "tp2_pct": 0.10, "tp3_pct": 0.15,
        "sl_pct": 0.05,
        "tp1_sell": 1/3, "tp2_sell": 1/2,
        "trailing": False, "time_stop": 0,
        "coin_filter": None,
    },
    "E": {
        "name": "D + 트레일링 + 48h타임스탑",
        "big_candle_min": 0.02, "big_candle_max": 0.08,
        "tp1_pct": 0.05, "tp2_pct": 0.10, "tp3_pct": 0.15,
        "sl_pct": 0.05,
        "tp1_sell": 1/3, "tp2_sell": 1/2,
        "trailing": True, "trail_activate": 0.03, "trail_distance": 0.025,
        "time_stop": 48,
        "coin_filter": None,
    },
    "F": {
        "name": "D + 트레일링 + 72h타임스탑",
        "big_candle_min": 0.02, "big_candle_max": 0.08,
        "tp1_pct": 0.05, "tp2_pct": 0.10, "tp3_pct": 0.15,
        "sl_pct": 0.05,
        "tp1_sell": 1/3, "tp2_sell": 1/2,
        "trailing": True, "trail_activate": 0.03, "trail_distance": 0.025,
        "time_stop": 72,
        "coin_filter": None,
    },
    "G": {
        "name": "특화3종(ONT/ONG/ZETA) + 트레일링48h",
        "big_candle_min": 0.02, "big_candle_max": 0.08,
        "tp1_pct": 0.05, "tp2_pct": 0.10, "tp3_pct": 0.15,
        "sl_pct": 0.05,
        "tp1_sell": 1/3, "tp2_sell": 1/2,
        "trailing": True, "trail_activate": 0.03, "trail_distance": 0.025,
        "time_stop": 48,
        "coin_filter": ["KRW-ONT", "KRW-ONG", "KRW-ZETA"],
    },
    "H": {
        "name": "특화3종 + 완화진입(RSI45,볼1.2배)",
        "big_candle_min": 0.015, "big_candle_max": 0.08,
        "tp1_pct": 0.05, "tp2_pct": 0.10, "tp3_pct": 0.15,
        "sl_pct": 0.05,
        "tp1_sell": 1/3, "tp2_sell": 1/2,
        "trailing": True, "trail_activate": 0.03, "trail_distance": 0.025,
        "time_stop": 48,
        "coin_filter": ["KRW-ONT", "KRW-ONG", "KRW-ZETA"],
        "rsi_min_override": 45, "vol_surge_override": 1.2,
    },
    "I": {
        "name": "특화5종(+ZBT/ETH) + 트레일링48h",
        "big_candle_min": 0.02, "big_candle_max": 0.08,
        "tp1_pct": 0.05, "tp2_pct": 0.10, "tp3_pct": 0.15,
        "sl_pct": 0.05,
        "tp1_sell": 1/3, "tp2_sell": 1/2,
        "trailing": True, "trail_activate": 0.03, "trail_distance": 0.025,
        "time_stop": 48,
        "coin_filter": ["KRW-ONT", "KRW-ONG", "KRW-ZETA", "KRW-ZBT", "KRW-ETH"],
    },
}


# ═══ 업비트 API ═══
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


def get_top_coins(n=20):
    cache_file = os.path.join(CACHE_DIR, "top_coins.json")
    if os.path.exists(cache_file):
        mtime = os.path.getmtime(cache_file)
        if time.time() - mtime < 86400:
            with open(cache_file) as f:
                return json.load(f)

    print("거래대금 상위 코인 조회...")
    markets = upbit_get("https://api.upbit.com/v1/market/all?is_details=false")
    if not markets:
        return []
    krw_markets = [m["market"] for m in markets if m["market"].startswith("KRW-")]
    time.sleep(0.15)

    all_tickers = []
    for i in range(0, len(krw_markets), 50):
        batch = krw_markets[i:i+50]
        tickers = upbit_get(f"https://api.upbit.com/v1/ticker?markets={','.join(batch)}")
        if tickers:
            all_tickers.extend(tickers)
        time.sleep(0.15)

    all_tickers.sort(key=lambda x: x.get("acc_trade_price_24h", 0), reverse=True)
    top = [t["market"] for t in all_tickers[:n]]

    with open(cache_file, "w") as f:
        json.dump(top, f)
    print(f"  상위 {len(top)}개: {', '.join(c.replace('KRW-','') for c in top)}")
    return top


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


# ═══ 지표 ═══
def calc_ma(closes, period):
    if len(closes) < period:
        return None
    return sum(closes[-period:]) / period

def calc_rsi(closes, period=14):
    if len(closes) < period + 1:
        return None
    gains, losses = [], []
    for i in range(-period, 0):
        diff = closes[i] - closes[i - 1]
        gains.append(max(diff, 0))
        losses.append(max(-diff, 0))
    avg_gain = sum(gains) / period
    avg_loss = sum(losses) / period
    if avg_loss == 0:
        return 100
    return 100 - 100 / (1 + avg_gain / avg_loss)


def build_btc_filter(btc_candles):
    btc_ok = set()
    for i in range(20, len(btc_candles)):
        closes = [btc_candles[j]["trade_price"] for j in range(i-19, i+1)]
        ma20 = sum(closes) / 20
        if btc_candles[i]["trade_price"] > ma20:
            btc_ok.add(btc_candles[i]["candle_date_time_kst"])
    return btc_ok


# ═══ 포지션 ═══
class Position:
    def __init__(self, market, date, price, capital_alloc, entry_idx):
        self.market = market
        self.date = date
        self.price = price
        self.initial_value = capital_alloc
        self.qty = capital_alloc / price
        self.remaining_qty = self.qty
        self.tp1_done = False
        self.tp2_done = False
        self.entry_idx = entry_idx
        # 트레일링
        self.highest = price
        self.trailing_active = False


# ═══ 백테스트 엔진 ═══
def run_backtest(scenario, coin_data, btc_ok_times):
    capital = INITIAL_CAPITAL
    positions = []
    trades = []
    equity_list = []

    coin_filter = scenario.get("coin_filter")
    rsi_min = scenario.get("rsi_min_override", RSI_MIN)
    vol_surge = scenario.get("vol_surge_override", VOL_SURGE)

    use_trailing = scenario.get("trailing", False)
    trail_activate = scenario.get("trail_activate", 0.03)
    trail_distance = scenario.get("trail_distance", 0.025)
    time_stop = scenario.get("time_stop", 0)

    # 타임라인
    all_times = set()
    for market, candles in coin_data.items():
        if market == "KRW-BTC":
            continue
        if coin_filter and market not in coin_filter:
            continue
        for c in candles:
            all_times.add(c["candle_date_time_kst"])
    timeline = sorted(all_times)

    coin_time_idx = {}
    for market, candles in coin_data.items():
        tmap = {}
        for idx, c in enumerate(candles):
            tmap[c["candle_date_time_kst"]] = idx
        coin_time_idx[market] = tmap

    tp1_pct = scenario["tp1_pct"]
    tp2_pct = scenario["tp2_pct"]
    tp3_pct = scenario["tp3_pct"]
    sl_pct = scenario["sl_pct"]
    big_min = scenario["big_candle_min"]
    big_max = scenario["big_candle_max"]

    for t_idx, t in enumerate(timeline):
        # (1) 청산 체크
        closed = []
        for pos in positions:
            if pos.market not in coin_time_idx or t not in coin_time_idx[pos.market]:
                continue
            cidx = coin_time_idx[pos.market][t]
            candle = coin_data[pos.market][cidx]
            cur = candle["trade_price"]
            high = candle["high_price"]
            low = candle["low_price"]

            low_pnl = (low - pos.price) / pos.price
            high_pnl = (high - pos.price) / pos.price
            cur_pnl = (cur - pos.price) / pos.price
            bars_held = t_idx - pos.entry_idx

            # 트레일링 업데이트
            if use_trailing and high > pos.highest:
                pos.highest = high
            if use_trailing and high_pnl >= trail_activate:
                pos.trailing_active = True

            # SL
            if low_pnl <= -sl_pct:
                exit_price = pos.price * (1 - sl_pct)
                capital += _close_position(pos, exit_price, -sl_pct, t, "손절", trades)
                closed.append(pos)
                continue

            # 트레일링 스탑
            if use_trailing and pos.trailing_active:
                trail_stop_price = pos.highest * (1 - trail_distance)
                if low <= trail_stop_price:
                    exit_price = trail_stop_price
                    pnl_pct = (exit_price - pos.price) / pos.price
                    capital += _close_position(pos, exit_price, pnl_pct, t, "트레일링", trades)
                    closed.append(pos)
                    continue

            # 타임스탑
            if time_stop > 0 and bars_held >= time_stop:
                exit_price = cur
                capital += _close_position(pos, exit_price, cur_pnl, t, "타임스탑", trades)
                closed.append(pos)
                continue

            # TP3
            if high_pnl >= tp3_pct and pos.remaining_qty > 0:
                exit_price = pos.price * (1 + tp3_pct)
                capital += _close_position(pos, exit_price, tp3_pct, t, "3차익절", trades)
                closed.append(pos)
                continue

            # TP2
            if high_pnl >= tp2_pct and not pos.tp2_done and pos.remaining_qty > 0:
                sell_qty = pos.remaining_qty * scenario["tp2_sell"]
                exit_price = pos.price * (1 + tp2_pct)
                proceeds = sell_qty * exit_price * (1 - FEE_RATE)
                pnl = proceeds - sell_qty * pos.price
                capital += proceeds
                trades.append(dict(market=pos.market, entry_date=pos.date, exit_date=t,
                    entry_price=pos.price, exit_price=exit_price, qty=sell_qty,
                    pnl=pnl, pnl_pct=tp2_pct, reason="2차익절"))
                pos.remaining_qty -= sell_qty
                pos.tp2_done = True
                if pos.remaining_qty <= 0:
                    closed.append(pos)
                    continue

            # TP1
            if high_pnl >= tp1_pct and not pos.tp1_done and pos.remaining_qty > 0:
                sell_qty = pos.remaining_qty * scenario["tp1_sell"]
                exit_price = pos.price * (1 + tp1_pct)
                proceeds = sell_qty * exit_price * (1 - FEE_RATE)
                pnl = proceeds - sell_qty * pos.price
                capital += proceeds
                trades.append(dict(market=pos.market, entry_date=pos.date, exit_date=t,
                    entry_price=pos.price, exit_price=exit_price, qty=sell_qty,
                    pnl=pnl, pnl_pct=tp1_pct, reason="1차익절"))
                pos.remaining_qty -= sell_qty
                pos.tp1_done = True
                if pos.remaining_qty <= 0:
                    closed.append(pos)
                    continue

        for pos in closed:
            positions.remove(pos)

        # (2) 진입
        if len(positions) < MAX_POSITIONS:
            if BTC_FILTER and t not in btc_ok_times:
                pos_val = sum(p.remaining_qty * _get_price(coin_data, coin_time_idx, p.market, t) for p in positions)
                equity_list.append(capital + pos_val)
                continue

            held = {p.market for p in positions}
            candidates = []

            for market, candles in coin_data.items():
                if market == "KRW-BTC" or market in held:
                    continue
                if coin_filter and market not in coin_filter:
                    continue
                if market not in coin_time_idx or t not in coin_time_idx[market]:
                    continue
                cidx = coin_time_idx[market][t]
                if cidx < 65:
                    continue

                c = candles[cidx]
                close = c["trade_price"]
                open_ = c["opening_price"]
                vol = c["candle_acc_trade_volume"]

                if open_ <= 0 or close <= 0:
                    continue

                change = (close - open_) / open_
                if not (big_min <= change <= big_max):
                    continue
                if close <= open_:
                    continue

                closes = [candles[j]["trade_price"] for j in range(cidx - 64, cidx + 1)]
                ma20 = calc_ma(closes, 20)
                ma60 = calc_ma(closes, 60)
                if ma20 is None or ma60 is None or ma20 <= ma60:
                    continue

                rsi = calc_rsi(closes, 14)
                if rsi is None or rsi < rsi_min:
                    continue

                vols = [candles[j]["candle_acc_trade_volume"] for j in range(cidx - 20, cidx + 1)]
                vol_avg = sum(vols[:-1]) / 20 if len(vols) >= 21 else 0
                if vol_avg <= 0 or vol < vol_avg * vol_surge:
                    continue

                score = change * 100 + rsi * 0.1
                candidates.append((market, close, score, rsi))

            if candidates:
                candidates.sort(key=lambda x: -x[2])
                slots = MAX_POSITIONS - len(positions)
                for market, price, _, _ in candidates[:slots]:
                    alloc = min(capital * 0.90 / max(1, slots), capital * 0.45)
                    if alloc < 50000:
                        continue
                    entry_price = price * (1 + SLIPPAGE)
                    if alloc > capital:
                        continue
                    capital -= alloc
                    positions.append(Position(market, t, entry_price, alloc, t_idx))

        pos_val = sum(p.remaining_qty * _get_price(coin_data, coin_time_idx, p.market, t) for p in positions)
        equity_list.append(capital + pos_val)

    # 강제 청산
    for pos in positions:
        last_price = _get_last_price(coin_data, pos.market)
        if last_price:
            proceeds = pos.remaining_qty * last_price * (1 - FEE_RATE)
            pnl = proceeds - pos.remaining_qty * pos.price
            pnl_pct = (last_price - pos.price) / pos.price
            capital += proceeds
            trades.append(dict(market=pos.market, entry_date=pos.date, exit_date="강제청산",
                entry_price=pos.price, exit_price=last_price, qty=pos.remaining_qty,
                pnl=pnl, pnl_pct=pnl_pct, reason="강제청산"))

    return trades, equity_list


def _close_position(pos, exit_price, pnl_pct, t, reason, trades):
    """전량 청산 → proceeds 반환"""
    sell_qty = pos.remaining_qty
    proceeds = sell_qty * exit_price * (1 - FEE_RATE)
    pnl = proceeds - sell_qty * pos.price
    trades.append(dict(market=pos.market, entry_date=pos.date, exit_date=t,
        entry_price=pos.price, exit_price=exit_price, qty=sell_qty,
        pnl=pnl, pnl_pct=pnl_pct, reason=reason))
    pos.remaining_qty = 0
    return proceeds

def _get_price(coin_data, coin_time_idx, market, t):
    if market in coin_time_idx and t in coin_time_idx[market]:
        cidx = coin_time_idx[market][t]
        return coin_data[market][cidx]["trade_price"]
    return 0

def _get_last_price(coin_data, market):
    if market in coin_data and coin_data[market]:
        return coin_data[market][-1]["trade_price"]
    return None


# ═══ 결과 출력 ═══
def print_result(key, scenario, trades, equity_list):
    print(f"\n{'━'*60}")
    print(f"  시나리오 {key}: {scenario['name']}")
    if scenario.get("coin_filter"):
        print(f"  대상: {', '.join(c.replace('KRW-','') for c in scenario['coin_filter'])}")
    print(f"{'━'*60}")

    if not trades:
        print("  거래 없음")
        return {"key": key, "trades": 0}

    total_pnl = sum(t["pnl"] for t in trades)
    final = INITIAL_CAPITAL + total_pnl
    ret = (final / INITIAL_CAPITAL - 1) * 100

    wins = [t for t in trades if t["pnl"] > 0]
    losses = [t for t in trades if t["pnl"] <= 0]
    wr = len(wins) / len(trades) * 100

    avg_win = sum(t["pnl_pct"] for t in wins) / len(wins) * 100 if wins else 0
    avg_loss = sum(t["pnl_pct"] for t in losses) / len(losses) * 100 if losses else 0

    gross_win = sum(t["pnl"] for t in wins)
    gross_loss = abs(sum(t["pnl"] for t in losses))
    pf = gross_win / gross_loss if gross_loss > 0 else 999

    if equity_list:
        peak = equity_list[0]
        max_dd = 0
        for eq in equity_list:
            if eq > peak: peak = eq
            dd = (peak - eq) / peak * 100
            if dd > max_dd: max_dd = dd
    else:
        max_dd = 0

    monthly_pnl = total_pnl / 3
    monthly_pct = monthly_pnl / INITIAL_CAPITAL * 100

    print(f"  최종 자본  : {final:>12,.0f}원 ({ret:+.1f}%)")
    print(f"  총 손익    : {total_pnl:>+12,.0f}원")
    print(f"  월 환산    : {monthly_pnl:>+12,.0f}원 ({monthly_pct:+.1f}%/월)")
    print(f"  거래 수    : {len(trades)}건")
    print(f"  승률       : {wr:.1f}%")
    print(f"  평균 수익  : {avg_win:+.2f}%")
    print(f"  평균 손실  : {avg_loss:+.2f}%")
    print(f"  수익팩터   : {pf:.2f}")
    print(f"  MDD        : {max_dd:.1f}%")

    print(f"\n  ─ 청산 유형 ─────────────────────")
    reasons = defaultdict(list)
    for t in trades:
        reasons[t["reason"]].append(t)
    for reason in ["1차익절", "2차익절", "3차익절", "손절", "트레일링", "타임스탑", "강제청산"]:
        if reason in reasons:
            grp = reasons[reason]
            grp_pnl = sum(t["pnl"] for t in grp)
            grp_wins = sum(1 for t in grp if t["pnl"] > 0)
            grp_wr = grp_wins / len(grp) * 100
            print(f"    {reason:<8}: {len(grp):>3}건 | {grp_pnl:>+10,.0f}원 | 승률 {grp_wr:.0f}%")

    print(f"\n  ─ 코인별 ────────────────────────")
    coin_stats = defaultdict(lambda: {"count": 0, "pnl": 0, "wins": 0})
    for t in trades:
        coin_stats[t["market"]]["count"] += 1
        coin_stats[t["market"]]["pnl"] += t["pnl"]
        if t["pnl"] > 0: coin_stats[t["market"]]["wins"] += 1
    for market, s in sorted(coin_stats.items(), key=lambda x: x[1]["pnl"], reverse=True):
        nm = market.replace("KRW-", "")
        cwr = s["wins"] / s["count"] * 100 if s["count"] > 0 else 0
        print(f"    {nm:8s}: {s['count']:>3}건, 승률 {cwr:.0f}%, PnL {s['pnl']:>+10,.0f}원")

    print(f"\n  ─ 최근 10건 ─────────────────────")
    for t in trades[-10:]:
        nm = t["market"].replace("KRW-", "")
        ep = t["entry_date"][:13] if isinstance(t["entry_date"], str) else ""
        xp = t["exit_date"][:13] if isinstance(t["exit_date"], str) else ""
        print(f"    {nm:6s} {ep} → {xp} | {t['pnl_pct']*100:>+6.2f}% {t['pnl']:>+9,.0f}원 ({t['reason']})")

    return {"key": key, "name": scenario["name"], "trades": len(trades),
            "pnl": total_pnl, "ret": ret, "wr": wr, "pf": pf, "mdd": max_dd,
            "monthly": monthly_pnl, "monthly_pct": monthly_pct}


# ═══ 메인 ═══
def main():
    print("=" * 60)
    print("  코인 스윙봇 v5.1-v2 백테스트")
    print("  트레일링/타임스탑 + 코인 특화 비교")
    print("=" * 60)
    print(f"자본: {INITIAL_CAPITAL:,}원 | MAX: {MAX_POSITIONS}포지션")
    print(f"데이터: 업비트 1시간봉 {CANDLE_DAYS}일")
    print()

    os.makedirs(CACHE_DIR, exist_ok=True)

    # 데이터 수집
    coins = get_top_coins(20)
    if not coins:
        print("코인 목록 실패!")
        return
    # 특화 코인이 목록에 없으면 추가
    for extra in ["KRW-ONT", "KRW-ONG", "KRW-ZETA", "KRW-ZBT", "KRW-ETH", "KRW-BTC"]:
        if extra not in coins:
            coins.append(extra)

    print(f"\n{len(coins)}개 코인 수집...")
    coin_data = {}
    for i, market in enumerate(coins):
        print(f"  [{i+1}/{len(coins)}] {market}...", end=" ", flush=True)
        candles = fetch_candles(market, CANDLE_DAYS)
        if candles and len(candles) > 60:
            coin_data[market] = candles
            print(f"{len(candles)}봉")
        else:
            print("스킵")
    print(f"수집 완료: {len(coin_data)}개")

    btc_ok = set()
    if BTC_FILTER and "KRW-BTC" in coin_data:
        btc_ok = build_btc_filter(coin_data["KRW-BTC"])
        total_btc = len(coin_data["KRW-BTC"])
        print(f"\nBTC 필터: {len(btc_ok)}/{total_btc}봉 진입 허용 ({len(btc_ok)/total_btc*100:.0f}%)")

    # 시나리오 실행
    results = []
    for key in sorted(SCENARIOS.keys()):
        scenario = SCENARIOS[key]
        trd, eq = run_backtest(scenario, coin_data, btc_ok)
        result = print_result(key, scenario, trd, eq)
        results.append(result)

    # 비교 테이블
    print(f"\n\n{'═'*70}")
    print(f"  최종 비교 테이블")
    print(f"{'═'*70}")
    print(f"  {'시나리오':<34s} {'거래':>4s} {'수익률':>8s} {'승률':>6s} {'PF':>6s} {'MDD':>6s} {'월수익':>10s}")
    print(f"  {'─'*66}")
    for r in results:
        if r["trades"] == 0:
            label = f"{r['key']}.{SCENARIOS[r['key']]['name']}"
            print(f"  {label:<34s} {'0':>3}건  {'—':>6s} {'—':>6s} {'—':>6s} {'—':>6s} {'—':>10s}")
        else:
            label = f"{r['key']}.{r['name']}"
            print(f"  {label:<34s} {r['trades']:>3}건 {r['ret']:>+7.1f}% {r['wr']:>5.1f}% {r['pf']:>5.2f} {r['mdd']:>5.1f}% {r['monthly']:>+9,.0f}원")

    tradeable = [r for r in results if r.get("trades", 0) > 0]
    if tradeable:
        best = max(tradeable, key=lambda x: x["pnl"])
        print(f"\n  >>> BEST: 시나리오 {best['key']} ({best['name']})")
        print(f"      수익 {best['pnl']:+,.0f}원 | 월 {best['monthly']:+,.0f}원 ({best['monthly_pct']:+.1f}%/월)")

        # 승률/PF 기준 BEST
        best_wr = max(tradeable, key=lambda x: x["wr"])
        best_pf = max(tradeable, key=lambda x: x["pf"])
        if best_wr["key"] != best["key"]:
            print(f"  >>> 승률 BEST: {best_wr['key']} ({best_wr['wr']:.1f}%)")
        if best_pf["key"] != best["key"]:
            print(f"  >>> PF BEST: {best_pf['key']} (PF {best_pf['pf']:.2f})")

    print(f"\n{'═'*70}")
    print("완료!")


if __name__ == "__main__":
    main()
