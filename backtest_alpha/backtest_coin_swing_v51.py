#!/usr/bin/env python3
"""
코인 스윙봇 v5.1 백테스트
- 주식 스윙봇 v5.1 로직을 코인(업비트 1시간봉)에 적용
- 대양봉 + MA정배열 + RSI + 거래량서지 + 3단계 분할익절
- BTC 필터 추가
"""

import json
import os
import time
import urllib.request
import urllib.error
from datetime import datetime, timedelta
from collections import defaultdict

# ═══ 설정 ═══
CACHE_DIR = os.path.expanduser("~/backtest_cache/coin_swing_v51")
INITIAL_CAPITAL = 1_000_000
MAX_POSITIONS = 3
FEE_RATE = 0.001          # 편도 0.1%
SLIPPAGE = 0.001           # 0.1%
CANDLE_DAYS = 90           # 90일 데이터
CANDLE_UNIT = 60           # 1시간봉

# ─── v5.1 코인 적용 파라미터 ───
# 시나리오 A: 원본 v5.1 비율 유지 (7/14/21%)
# 시나리오 B: 코인 축소형 (5/10/15%)
# 시나리오 C: ATR 기반 동적
SCENARIOS = {
    "A": {
        "name": "v5.1 원본비율 (7/14/21%)",
        "big_candle_min": 0.03, "big_candle_max": 0.10,
        "tp1_pct": 0.07, "tp2_pct": 0.14, "tp3_pct": 0.21,
        "sl_pct": 0.07,
        "tp1_sell": 1/3, "tp2_sell": 1/2,  # 1차: 1/3, 2차: 1/2
        "use_atr_sl": False,
    },
    "B": {
        "name": "코인 축소형 (5/10/15%)",
        "big_candle_min": 0.03, "big_candle_max": 0.10,
        "tp1_pct": 0.05, "tp2_pct": 0.10, "tp3_pct": 0.15,
        "sl_pct": 0.05,
        "tp1_sell": 1/3, "tp2_sell": 1/2,
        "use_atr_sl": False,
    },
    "C": {
        "name": "ATR 동적 SL (7/14/21%)",
        "big_candle_min": 0.03, "big_candle_max": 0.10,
        "tp1_pct": 0.07, "tp2_pct": 0.14, "tp3_pct": 0.21,
        "sl_pct": 0.07,  # fallback
        "tp1_sell": 1/3, "tp2_sell": 1/2,
        "use_atr_sl": True, "atr_sl_mult": 2.0,
    },
    "D": {
        "name": "대양봉 완화 (2~8%, 5/10/15%)",
        "big_candle_min": 0.02, "big_candle_max": 0.08,
        "tp1_pct": 0.05, "tp2_pct": 0.10, "tp3_pct": 0.15,
        "sl_pct": 0.05,
        "tp1_sell": 1/3, "tp2_sell": 1/2,
        "use_atr_sl": False,
    },
}

# 공통 조건
RSI_MIN = 50
VOL_SURGE = 1.5
BTC_FILTER = True  # BTC가 MA20 위일 때만 진입


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

def calc_atr(highs, lows, closes, period=14):
    if len(closes) < period + 1:
        return None
    trs = []
    for i in range(-period, 0):
        tr = max(highs[i] - lows[i], abs(highs[i] - closes[i-1]), abs(lows[i] - closes[i-1]))
        trs.append(tr)
    return sum(trs) / period


# ═══ BTC 필터 ═══
def build_btc_filter(btc_candles):
    """BTC 종가가 MA20 위인 시간대 세트 반환"""
    btc_ok = set()
    for i in range(20, len(btc_candles)):
        closes = [btc_candles[j]["trade_price"] for j in range(i-19, i+1)]
        ma20 = sum(closes) / 20
        if btc_candles[i]["trade_price"] > ma20:
            btc_ok.add(btc_candles[i]["candle_date_time_kst"])
    return btc_ok


# ═══ 포지션 ═══
class Position:
    def __init__(self, market, date, price, capital_alloc, atr):
        self.market = market
        self.date = date
        self.price = price
        self.initial_value = capital_alloc
        self.qty = capital_alloc / price
        self.remaining_qty = self.qty
        self.atr = atr
        self.tp1_done = False
        self.tp2_done = False


# ═══ 백테스트 엔진 ═══
def run_backtest(scenario_key, scenario, coin_data, btc_ok_times):
    capital = INITIAL_CAPITAL
    positions = []  # list of Position
    trades = []
    equity_list = []

    # 타임라인 (BTC 제외)
    all_times = set()
    for market, candles in coin_data.items():
        if market == "KRW-BTC":
            continue
        for c in candles:
            all_times.add(c["candle_date_time_kst"])
    timeline = sorted(all_times)

    # 시간 → 인덱스 매핑
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
    use_atr_sl = scenario["use_atr_sl"]
    atr_sl_mult = scenario.get("atr_sl_mult", 2.0)

    for t in timeline:
        # (1) 기존 포지션 청산 체크
        closed = []
        for pos in positions:
            if pos.market not in coin_time_idx or t not in coin_time_idx[pos.market]:
                continue
            cidx = coin_time_idx[pos.market][t]
            candle = coin_data[pos.market][cidx]
            cur = candle["trade_price"]
            high = candle["high_price"]
            low = candle["low_price"]
            pnl_pct = (cur - pos.price) / pos.price

            # SL 체크
            if use_atr_sl and pos.atr:
                effective_sl = (pos.atr * atr_sl_mult) / pos.price
            else:
                effective_sl = sl_pct

            low_pnl = (low - pos.price) / pos.price
            if low_pnl <= -effective_sl:
                exit_price = pos.price * (1 - effective_sl)
                sell_qty = pos.remaining_qty
                proceeds = sell_qty * exit_price * (1 - FEE_RATE)
                cost_basis = sell_qty * pos.price
                pnl = proceeds - cost_basis
                capital += proceeds
                trades.append(dict(market=pos.market, entry_date=pos.date, exit_date=t,
                    entry_price=pos.price, exit_price=exit_price, qty=sell_qty,
                    pnl=pnl, pnl_pct=-effective_sl, reason="손절"))
                closed.append(pos)
                continue

            # TP3: 전량
            high_pnl = (high - pos.price) / pos.price
            if high_pnl >= tp3_pct and pos.remaining_qty > 0:
                exit_price = pos.price * (1 + tp3_pct)
                sell_qty = pos.remaining_qty
                proceeds = sell_qty * exit_price * (1 - FEE_RATE)
                cost_basis = sell_qty * pos.price
                pnl = proceeds - cost_basis
                capital += proceeds
                trades.append(dict(market=pos.market, entry_date=pos.date, exit_date=t,
                    entry_price=pos.price, exit_price=exit_price, qty=sell_qty,
                    pnl=pnl, pnl_pct=tp3_pct, reason="3차익절"))
                closed.append(pos)
                continue

            # TP2: 1/2 매도
            if high_pnl >= tp2_pct and not pos.tp2_done and pos.remaining_qty > 0:
                sell_qty = pos.remaining_qty * scenario["tp2_sell"]
                exit_price = pos.price * (1 + tp2_pct)
                proceeds = sell_qty * exit_price * (1 - FEE_RATE)
                cost_basis = sell_qty * pos.price
                pnl = proceeds - cost_basis
                capital += proceeds
                trades.append(dict(market=pos.market, entry_date=pos.date, exit_date=t,
                    entry_price=pos.price, exit_price=exit_price, qty=sell_qty,
                    pnl=pnl, pnl_pct=tp2_pct, reason="2차익절"))
                pos.remaining_qty -= sell_qty
                pos.tp2_done = True
                if pos.remaining_qty <= 0:
                    closed.append(pos)
                    continue

            # TP1: 1/3 매도
            if high_pnl >= tp1_pct and not pos.tp1_done and pos.remaining_qty > 0:
                sell_qty = pos.remaining_qty * scenario["tp1_sell"]
                exit_price = pos.price * (1 + tp1_pct)
                proceeds = sell_qty * exit_price * (1 - FEE_RATE)
                cost_basis = sell_qty * pos.price
                pnl = proceeds - cost_basis
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

        # (2) 신규 진입 스캔
        if len(positions) < MAX_POSITIONS:
            # BTC 필터
            if BTC_FILTER and t not in btc_ok_times:
                # 에쿼티 기록
                pos_val = sum(p.remaining_qty * _get_price(coin_data, coin_time_idx, p.market, t) for p in positions)
                equity_list.append(capital + pos_val)
                continue

            held = {p.market for p in positions}
            candidates = []

            for market, candles in coin_data.items():
                if market == "KRW-BTC" or market in held:
                    continue
                if market not in coin_time_idx or t not in coin_time_idx[market]:
                    continue
                cidx = coin_time_idx[market][t]
                if cidx < 65:
                    continue

                c = candles[cidx]
                close = c["trade_price"]
                open_ = c["opening_price"]
                high = c["high_price"]
                vol = c["candle_acc_trade_volume"]

                if open_ <= 0 or close <= 0:
                    continue

                # 대양봉 체크 (시가 대비 등락률)
                change = (close - open_) / open_
                if not (big_min <= change <= big_max):
                    continue

                # 양봉 필수
                if close <= open_:
                    continue

                # MA 정배열 (20 > 60)
                closes = [candles[j]["trade_price"] for j in range(cidx - 64, cidx + 1)]
                ma20 = calc_ma(closes, 20)
                ma60 = calc_ma(closes, 60)
                if ma20 is None or ma60 is None or ma20 <= ma60:
                    continue

                # RSI > 50
                rsi = calc_rsi(closes, 14)
                if rsi is None or rsi < RSI_MIN:
                    continue

                # 거래량 서지 1.5배
                vols = [candles[j]["candle_acc_trade_volume"] for j in range(cidx - 20, cidx + 1)]
                vol_avg = sum(vols[:-1]) / 20 if len(vols) >= 21 else 0
                if vol_avg <= 0 or vol < vol_avg * VOL_SURGE:
                    continue

                # ATR
                highs = [candles[j]["high_price"] for j in range(cidx - 14, cidx + 1)]
                lows = [candles[j]["low_price"] for j in range(cidx - 14, cidx + 1)]
                cls = [candles[j]["trade_price"] for j in range(cidx - 14, cidx + 1)]
                atr = calc_atr(highs, lows, cls, 14)

                score = change * 100 + rsi * 0.1
                candidates.append((market, close, atr, score, change, rsi))

            if candidates:
                candidates.sort(key=lambda x: -x[3])
                slots = MAX_POSITIONS - len(positions)
                for market, price, atr, _, chg, rsi in candidates[:slots]:
                    alloc = min(capital * 0.90 / max(1, slots), capital * 0.45)
                    if alloc < 50000:
                        continue
                    entry_price = price * (1 + SLIPPAGE)
                    cost = alloc  # capital to allocate
                    if cost > capital:
                        continue
                    capital -= cost
                    positions.append(Position(market, t, entry_price, cost, atr))

        # 에쿼티 기록
        pos_val = sum(p.remaining_qty * _get_price(coin_data, coin_time_idx, p.market, t) for p in positions)
        equity_list.append(capital + pos_val)

    # 강제 청산 잔여 포지션
    for pos in positions:
        last_price = _get_last_price(coin_data, pos.market)
        if last_price:
            sell_qty = pos.remaining_qty
            proceeds = sell_qty * last_price * (1 - FEE_RATE)
            cost_basis = sell_qty * pos.price
            pnl = proceeds - cost_basis
            pnl_pct = (last_price - pos.price) / pos.price
            capital += proceeds
            trades.append(dict(market=pos.market, entry_date=pos.date, exit_date="강제청산",
                entry_price=pos.price, exit_price=last_price, qty=sell_qty,
                pnl=pnl, pnl_pct=pnl_pct, reason="강제청산"))

    return trades, equity_list


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
    print(f"{'━'*60}")

    if not trades:
        print("  거래 없음 (조건이 너무 엄격)")
        return {"key": key, "trades": 0}

    total_pnl = sum(t["pnl"] for t in trades)
    final_capital = INITIAL_CAPITAL + total_pnl
    ret = (final_capital / INITIAL_CAPITAL - 1) * 100

    wins = [t for t in trades if t["pnl"] > 0]
    losses = [t for t in trades if t["pnl"] <= 0]
    wr = len(wins) / len(trades) * 100

    avg_win = sum(t["pnl_pct"] for t in wins) / len(wins) * 100 if wins else 0
    avg_loss = sum(t["pnl_pct"] for t in losses) / len(losses) * 100 if losses else 0

    gross_win = sum(t["pnl"] for t in wins)
    gross_loss = abs(sum(t["pnl"] for t in losses))
    pf = gross_win / gross_loss if gross_loss > 0 else 999

    # MDD
    if equity_list:
        peak = equity_list[0]
        max_dd = 0
        for eq in equity_list:
            if eq > peak:
                peak = eq
            dd = (peak - eq) / peak * 100
            if dd > max_dd:
                max_dd = dd
    else:
        max_dd = 0

    # 월 환산
    monthly_pnl = total_pnl / 3  # 약 3개월
    monthly_pct = monthly_pnl / INITIAL_CAPITAL * 100

    print(f"  최종 자본  : {final_capital:>12,.0f}원 ({ret:+.1f}%)")
    print(f"  총 손익    : {total_pnl:>+12,.0f}원")
    print(f"  월 환산    : {monthly_pnl:>+12,.0f}원 ({monthly_pct:+.1f}%/월)")
    print(f"  거래 수    : {len(trades)}건")
    print(f"  승률       : {wr:.1f}%")
    print(f"  평균 수익  : {avg_win:+.2f}%")
    print(f"  평균 손실  : {avg_loss:+.2f}%")
    print(f"  수익팩터   : {pf:.2f}")
    print(f"  MDD        : {max_dd:.1f}%")

    # 청산 유형별
    print(f"\n  ─ 청산 유형 ─────────────────────")
    reasons = defaultdict(list)
    for t in trades:
        reasons[t["reason"]].append(t)
    for reason in ["1차익절", "2차익절", "3차익절", "손절", "강제청산"]:
        if reason in reasons:
            grp = reasons[reason]
            grp_pnl = sum(t["pnl"] for t in grp)
            print(f"    {reason:<8}: {len(grp):>3}건 | {grp_pnl:>+10,.0f}원")

    # 코인별 성과
    print(f"\n  ─ 코인별 성과 ───────────────────")
    coin_stats = defaultdict(lambda: {"count": 0, "pnl": 0, "wins": 0})
    for t in trades:
        coin_stats[t["market"]]["count"] += 1
        coin_stats[t["market"]]["pnl"] += t["pnl"]
        if t["pnl"] > 0:
            coin_stats[t["market"]]["wins"] += 1
    sorted_coins = sorted(coin_stats.items(), key=lambda x: x[1]["pnl"], reverse=True)
    for market, s in sorted_coins[:10]:
        nm = market.replace("KRW-", "")
        wr_c = s["wins"] / s["count"] * 100 if s["count"] > 0 else 0
        print(f"    {nm:8s}: {s['count']:>3}건, 승률 {wr_c:.0f}%, PnL {s['pnl']:>+10,.0f}원")

    # 최근 거래
    print(f"\n  ─ 최근 거래 10건 ────────────────")
    for t in trades[-10:]:
        nm = t["market"].replace("KRW-", "")
        ep = t["entry_date"][:13] if isinstance(t["entry_date"], str) else str(t["entry_date"])[:13]
        xp = t["exit_date"][:13] if isinstance(t["exit_date"], str) else str(t["exit_date"])[:13]
        print(f"    {nm:6s} {ep} → {xp} | {t['pnl_pct']*100:>+6.2f}% {t['pnl']:>+9,.0f}원 ({t['reason']})")

    return {"key": key, "name": scenario["name"], "trades": len(trades),
            "pnl": total_pnl, "ret": ret, "wr": wr, "pf": pf, "mdd": max_dd,
            "monthly": monthly_pnl, "monthly_pct": monthly_pct}


# ═══ 메인 ═══
def main():
    print("=" * 60)
    print("  코인 스윙봇 v5.1 백테스트")
    print("  (주식 v5.1 로직 → 코인 적용)")
    print("=" * 60)
    print(f"자본: {INITIAL_CAPITAL:,}원 | MAX: {MAX_POSITIONS}포지션")
    print(f"공통: MA20>MA60 + RSI>{RSI_MIN} + 거래량 {VOL_SURGE}배 + 양봉")
    print(f"BTC 필터: {'ON' if BTC_FILTER else 'OFF'} (BTC > MA20)")
    print(f"데이터: 업비트 1시간봉 {CANDLE_DAYS}일")
    print()

    os.makedirs(CACHE_DIR, exist_ok=True)

    # 1. 코인 목록 (BTC 포함)
    coins = get_top_coins(20)
    if not coins:
        print("코인 목록 조회 실패!")
        return
    if "KRW-BTC" not in coins:
        coins.insert(0, "KRW-BTC")

    # 2. 데이터 수집
    print(f"\n{len(coins)}개 코인 1시간봉 {CANDLE_DAYS}일 수집...")
    coin_data = {}
    for i, market in enumerate(coins):
        print(f"  [{i+1}/{len(coins)}] {market}...", end=" ", flush=True)
        candles = fetch_candles(market, CANDLE_DAYS)
        if candles and len(candles) > 60:
            coin_data[market] = candles
            print(f"{len(candles)}봉")
        else:
            print("스킵")

    print(f"수집 완료: {len(coin_data)}개 코인")

    # 3. BTC 필터 구축
    btc_ok = set()
    if BTC_FILTER and "KRW-BTC" in coin_data:
        btc_ok = build_btc_filter(coin_data["KRW-BTC"])
        total_btc = len(coin_data["KRW-BTC"])
        print(f"\nBTC 필터: {len(btc_ok)}/{total_btc}봉 진입 허용 ({len(btc_ok)/total_btc*100:.0f}%)")

    # 4. 시나리오별 실행
    results = []
    for key in sorted(SCENARIOS.keys()):
        scenario = SCENARIOS[key]
        trades, equity = run_backtest(key, scenario, coin_data, btc_ok)
        result = print_result(key, scenario, trades, equity)
        results.append(result)

    # 5. 비교 테이블
    print(f"\n\n{'═'*60}")
    print(f"  최종 비교")
    print(f"{'═'*60}")
    print(f"  {'시나리오':<28s} {'거래':>5s} {'수익률':>8s} {'승률':>6s} {'PF':>6s} {'MDD':>6s} {'월수익':>10s}")
    print(f"  {'─'*56}")
    for r in results:
        if r["trades"] == 0:
            print(f"  {r['key']}.{SCENARIOS[r['key']]['name']:<26s} {'0건':>5s}  {'—':>6s} {'—':>6s} {'—':>6s} {'—':>6s} {'—':>10s}")
        else:
            label = f"{r['key']}.{r['name']}"
            print(f"  {label:<28s} {r['trades']:>3}건 {r['ret']:>+7.1f}% {r['wr']:>5.1f}% {r['pf']:>5.2f} {r['mdd']:>5.1f}% {r['monthly']:>+9,.0f}원")

    tradeable = [r for r in results if r.get("trades", 0) > 0]
    if tradeable:
        best = max(tradeable, key=lambda x: x["pnl"])
        print(f"\n  >>> BEST: 시나리오 {best['key']} ({best['name']})")
        print(f"      수익 {best['pnl']:+,.0f}원 | 월 {best['monthly']:+,.0f}원 ({best['monthly_pct']:+.1f}%/월)")
    else:
        print("\n  모든 시나리오에서 거래 없음. 시장이 조건에 맞지 않았을 수 있음.")

    print(f"\n{'═'*60}")
    print("완료!")


if __name__ == "__main__":
    main()
