"""
Bear Hunter — 하락장 특화 봇
────────────────────────────────────────────────────────────
[하락장 감지]  KOSPI MA5 < MA20  OR  KOSPI 5일 수익률 < -3%
              조건 불충족 시 봇 대기 (테스타에 양보)

[전략 A — 낙폭과대 반등]
  사전 스크리닝 (08:50):
    · 5일 수익률 < -8%   (충분히 빠진 종목)
    · RSI(14) < 30       (과매도)
    · 20일 거래대금 평균 × 1.5배 이상 (바닥권 거래 폭발)
  장중 진입 (09:30~13:30):
    · 당일 현재가 > 전일 종가 × 1.01  (반등 시작 확인)
  청산:
    · 익절 +4%  /  손절 -2%  /  타임스탑 14:30

[전략 B — 변동성 돌파 (Larry Williams)]
  진입가 사전 계산 (08:50):
    · entry = 당일 시가 + (전일 고가 − 전일 저가) × 0.5
    · 대상: KOSPI 200 중 거래대금 상위 50종목
  장중 진입 (09:00~13:00):
    · 현재가 >= entry 돌파 시 즉시 매수
  청산:
    · 손절: 당일 시가 × 0.98  /  타임스탑 14:30

[포지션 관리]
  MAX_POSITIONS = 4  (A_MAX=2, B_MAX=2)
  포지션당 자본 25%
  일일 손실 -3% 도달 시 당일 거래 중단
  연속 손절 3회 시 당일 거래 중단
"""

import time, json, os, warnings
warnings.filterwarnings('ignore')

import schedule
import pytz
import pandas as pd
import numpy as np

from datetime import datetime, time as dtime
from auth import get_headers
from telegram_bot import send_message
from market import get_stock_price, get_kospi_daily_closes
from config import BASE_URL

# ════════════════════════════════════════════
# 설정
# ════════════════════════════════════════════
INITIAL_CAPITAL  = 1_000_000
MAX_POSITIONS    = 4
A_MAX            = 2          # 전략 A 최대 동시 포지션
B_MAX            = 2          # 전략 B 최대 동시 포지션
POS_PCT          = 0.25       # 포지션당 자본 비율
COMMISSION       = 0.0015     # 편도 수수료

A_TP_PCT         = 0.04       # 전략 A 익절 +4%
A_SL_PCT         = 0.02       # 전략 A 손절 -2%
B_SL_PCT         = 0.02       # 전략 B 손절 시가 -2%
B_K              = 0.5        # 변동성 돌파 계수
AMOUNT_SURGE     = 1.5        # 거래대금 배수 기준 (전략 A)
RSI_PERIOD       = 14
RSI_OVERSOLD     = 30
DROP5_THRESH     = -0.08      # 5일 낙폭 기준 -8%
BOUNCE_THRESH    = 0.01       # 당일 반등 확인 +1%

BEAR_MA_SHORT    = 5
BEAR_MA_LONG     = 20
BEAR_RET5_THRESH = -0.03      # 5일 수익률 < -3%

DAILY_LOSS_LIMIT = -0.03      # 일일 -3% 손실 시 중단
CONSEC_STOP_LIMIT = 3         # 연속 손절 N회 시 중단

FORCE_CLOSE_TIME = dtime(14, 30)
A_ENTRY_START    = dtime(9, 30)
A_ENTRY_END      = dtime(13, 30)
B_ENTRY_START    = dtime(9, 0)
B_ENTRY_END      = dtime(13, 0)

STATE_FILE  = "bear_hunter_state.json"
TRADES_FILE = "bear_hunter_trades.json"
KST         = pytz.timezone("Asia/Seoul")

# ════════════════════════════════════════════
# 전역 변수
# ════════════════════════════════════════════
state = {
    "capital":        INITIAL_CAPITAL,
    "positions":      {},   # code -> position dict (strategy 키 포함: 'A' or 'B')
    "total_pnl":      0,
    "trade_count":    0,
    "today_pnl":      0,
    "today_wins":     0,
    "today_losses":   0,
    "consec_stops":   0,
    "halt":           False,  # 당일 거래 중단 플래그
}

# 장 시작 전 사전 계산 결과
a_candidates = []   # [(code, name, prev_close, rsi, ret5, amount20), ...]
b_targets    = {}   # code -> {name, entry_price, open_price, sl_price}


# ════════════════════════════════════════════
# 상태 관리
# ════════════════════════════════════════════
def load_state():
    global state
    if os.path.exists(STATE_FILE):
        with open(STATE_FILE) as f:
            state = json.load(f)
        print(f"[복구] 자본: {state['capital']:,}원 | 포지션: {len(state['positions'])}개 | 총PnL: {state['total_pnl']:+,.0f}원")

def save_state():
    with open(STATE_FILE, "w") as f:
        json.dump(state, f, ensure_ascii=False, indent=2, default=str)

def save_trade(trade):
    history = []
    if os.path.exists(TRADES_FILE):
        with open(TRADES_FILE) as f:
            history = json.load(f)
    history.append(trade)
    with open(TRADES_FILE, "w") as f:
        json.dump(history, f, ensure_ascii=False, indent=2)

def now_kst():
    return datetime.now(KST)

def now_str():
    return now_kst().strftime("%Y-%m-%d %H:%M:%S")

def today_str():
    return now_kst().strftime("%Y-%m-%d")


# ════════════════════════════════════════════
# 일일 초기화 (자정 이후 첫 실행 시)
# ════════════════════════════════════════════
def reset_daily():
    state['today_pnl']    = 0
    state['today_wins']   = 0
    state['today_losses'] = 0
    state['consec_stops'] = 0
    state['halt']         = False
    save_state()
    print(f"[{now_str()}] 일일 초기화 완료")


# ════════════════════════════════════════════
# 유니버스 (KOSPI 200, 7일 캐시)
# ════════════════════════════════════════════
UNIVERSE_FILE = "bear_hunter_universe.json"

def load_universe():
    if os.path.exists(UNIVERSE_FILE):
        with open(UNIVERSE_FILE) as f:
            data = json.load(f)
        age = (datetime.now() - datetime.strptime(data["generated"], "%Y-%m-%d")).days
        if age < 7:
            print(f"[유니버스] {len(data['stocks'])}종목 로드 ({data['generated']})")
            return data["stocks"]
    return update_universe()

def update_universe():
    print("[유니버스] 갱신 중...")
    try:
        import FinanceDataReader as fdr
        kospi  = fdr.StockListing('KOSPI')[['Code','Name','Marcap']].dropna()
        kosdaq = fdr.StockListing('KOSDAQ')[['Code','Name','Marcap']].dropna()
        all_st = pd.concat([kospi, kosdaq]).sort_values('Marcap', ascending=False).head(200)
        stocks = [{"code": str(r['Code']).zfill(6), "name": r['Name']}
                  for _, r in all_st.iterrows()]
        data = {"generated": datetime.now().strftime("%Y-%m-%d"), "stocks": stocks}
        with open(UNIVERSE_FILE, "w") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        print(f"[유니버스] {len(stocks)}종목 저장")
        return stocks
    except Exception as e:
        print(f"[유니버스] 오류: {e}")
        return []


# ════════════════════════════════════════════
# 기술적 지표 계산
# ════════════════════════════════════════════
def calc_rsi(closes: pd.Series, period: int = 14) -> float:
    delta = closes.diff()
    gain  = delta.clip(lower=0).rolling(period).mean()
    loss  = (-delta.clip(upper=0)).rolling(period).mean()
    rs    = gain / loss.replace(0, np.nan)
    rsi   = 100 - (100 / (1 + rs))
    return float(rsi.iloc[-1]) if not pd.isna(rsi.iloc[-1]) else 50.0

def get_daily_df(code: str, days: int = 60) -> pd.DataFrame:
    """FDR 일봉 + KIS 당일 현재가"""
    import FinanceDataReader as fdr
    from datetime import timedelta
    start = (datetime.now() - timedelta(days=int(days * 1.8))).strftime('%Y-%m-%d')
    try:
        raw = fdr.DataReader(code, start)
        if raw is None or len(raw) == 0:
            return pd.DataFrame()
        raw.index = pd.to_datetime(raw.index)
        raw = raw.sort_index()
        today = pd.Timestamp(now_kst().strftime('%Y-%m-%d'))
        raw = raw[raw.index < today]   # 당일 미확정 제거
        df = raw[['Open','High','Low','Close','Volume']].rename(columns={
            'Open':'open','High':'high','Low':'low','Close':'close','Volume':'volume'
        }).copy()
        df['amount'] = df['close'] * df['volume']
        df = df.tail(days - 1).reset_index(drop=True)
    except Exception:
        return pd.DataFrame()

    # KIS 당일 현재가 추가
    try:
        p = get_stock_price(code)
        today_row = pd.DataFrame([{
            'open': p['open'], 'high': p['high'], 'low': p['low'],
            'close': p['price'], 'volume': p['volume'],
            'amount': p['price'] * p['volume'],
        }])
        df = pd.concat([df, today_row], ignore_index=True)
    except Exception:
        pass
    return df


# ════════════════════════════════════════════
# 하락장 감지
# ════════════════════════════════════════════
def is_bear_market() -> bool:
    closes = get_kospi_daily_closes(30)
    if len(closes) < BEAR_MA_LONG + 1:
        print("[하락장 감지] 데이터 부족 → 기본 BEAR 처리")
        return True
    s     = pd.Series(closes)
    ma5   = s.rolling(BEAR_MA_SHORT).mean().iloc[-1]
    ma20  = s.rolling(BEAR_MA_LONG).mean().iloc[-1]
    ret5  = (s.iloc[-1] - s.iloc[-6]) / s.iloc[-6]
    bear  = (ma5 < ma20) or (ret5 < BEAR_RET5_THRESH)
    print(f"[하락장 감지] KOSPI MA{BEAR_MA_SHORT}={ma5:.0f} MA{BEAR_MA_LONG}={ma20:.0f} "
          f"5일={ret5*100:+.1f}% → {'BEAR ✓' if bear else 'BULL (대기)'}")
    return bear


# ════════════════════════════════════════════
# 전략 A — 사전 스크리닝 (08:50)
# ════════════════════════════════════════════
def screen_a_candidates(universe: list) -> list:
    """
    낙폭과대 반등 후보 종목 스크리닝
    Returns: [(code, name, prev_close, rsi, ret5, amount20), ...]
    """
    print(f"[전략A] 후보 스크리닝 시작 ({len(universe)}종목)")
    candidates = []
    for stock in universe:
        code, name = stock['code'], stock['name']
        if code in state['positions']:
            continue
        try:
            df = get_daily_df(code, days=40)
            if len(df) < 22:
                continue

            closes   = df['close']
            amounts  = df['amount']
            ret5     = float((closes.iloc[-2] - closes.iloc[-7]) / closes.iloc[-7])
            rsi      = calc_rsi(closes.iloc[:-1])   # 전일까지 RSI
            amount20 = float(amounts.iloc[-21:-1].mean())   # 전일까지 20일 평균
            prev_close = float(closes.iloc[-2])

            if ret5 >= DROP5_THRESH:
                continue
            if rsi >= RSI_OVERSOLD:
                continue
            if amount20 <= 0:
                continue

            candidates.append((code, name, prev_close, rsi, ret5, amount20))
            print(f"  [A후보] {name}({code}) 5일={ret5*100:.1f}% RSI={rsi:.0f}")
        except Exception as e:
            continue

    print(f"[전략A] 후보 {len(candidates)}종목 확정")
    return candidates


# ════════════════════════════════════════════
# 전략 B — 진입가 사전 계산 (08:50)
# ════════════════════════════════════════════
def calc_b_targets(universe: list) -> dict:
    """
    변동성 돌파 진입가 계산
    Returns: {code: {name, entry_price, open_price, sl_price}}
    """
    print(f"[전략B] 진입가 계산 시작")
    targets = {}
    # 거래대금 상위 50종목 필터 (전일 기준)
    scored = []
    for stock in universe:
        code, name = stock['code'], stock['name']
        try:
            df = get_daily_df(code, days=10)
            if len(df) < 3:
                continue
            prev_amount = float(df['amount'].iloc[-2])
            scored.append((code, name, prev_amount, df))
        except Exception:
            continue

    scored.sort(key=lambda x: -x[2])
    top50 = scored[:50]

    for code, name, _, df in top50:
        if code in state['positions']:
            continue
        try:
            prev_high  = float(df['high'].iloc[-2])
            prev_low   = float(df['low'].iloc[-2])
            today_open = float(df['open'].iloc[-1])
            rng        = prev_high - prev_low
            if rng <= 0 or today_open <= 0:
                continue
            entry = today_open + rng * B_K
            sl    = today_open * (1 - B_SL_PCT)
            # 진입가가 이미 돌파됐으면 제외
            cur = float(df['close'].iloc[-1])
            if cur >= entry:
                continue
            targets[code] = {
                "name":        name,
                "entry_price": round(entry),
                "open_price":  round(today_open),
                "sl_price":    round(sl),
            }
        except Exception:
            continue

    print(f"[전략B] 진입 대기 {len(targets)}종목 (상위 50 중)")
    return targets


# ════════════════════════════════════════════
# 매수 (공통)
# ════════════════════════════════════════════
def a_count():
    return sum(1 for p in state['positions'].values() if p['strategy'] == 'A')

def b_count():
    return sum(1 for p in state['positions'].values() if p['strategy'] == 'B')

def paper_buy(code, name, price, sl, tp, strategy):
    if state['halt']:
        return False
    if len(state['positions']) >= MAX_POSITIONS:
        return False
    if strategy == 'A' and a_count() >= A_MAX:
        return False
    if strategy == 'B' and b_count() >= B_MAX:
        return False

    invest  = state['capital'] * POS_PCT
    shares  = int(invest / price)
    if shares <= 0:
        return False
    cost = shares * price * (1 + COMMISSION)
    if cost > state['capital']:
        return False

    state['capital'] -= cost
    state['positions'][code] = {
        "name":        name,
        "strategy":    strategy,
        "entry_price": price,
        "shares":      shares,
        "sl":          sl,
        "tp":          tp,       # None for Strategy B
        "entry_time":  now_str(),
        "entry_date":  today_str(),
    }
    save_state()

    tp_str = f"{tp:,}원" if tp else "없음(타임스탑)"
    print(f"[매수:{strategy}] {name}({code}) {shares}주 @ {price:,}원 | 손절:{sl:,} | 익절:{tp_str}")
    send_message(
        f"🐻 <b>BearHunter 매수 [{strategy}전략]</b>\n"
        f"{name} {shares}주 @ {price:,}원\n"
        f"손절: {sl:,}원 | 익절: {tp_str}"
    )
    return True


# ════════════════════════════════════════════
# 매도 (공통)
# ════════════════════════════════════════════
def paper_sell(code, reason):
    pos = state['positions'].get(code)
    if not pos:
        return

    try:
        current = get_stock_price(code)['price']
    except Exception:
        current = pos['entry_price']

    shares     = pos['shares']
    proceeds   = shares * current * (1 - COMMISSION)
    cost_basis = shares * pos['entry_price'] * (1 + COMMISSION)
    pnl        = proceeds - cost_basis
    pnl_pct    = (current - pos['entry_price']) / pos['entry_price'] * 100

    state['capital']      += proceeds
    state['total_pnl']    += pnl
    state['today_pnl']    += pnl
    state['trade_count']  += 1

    is_win = pnl >= 0
    if is_win:
        state['today_wins']  += 1
        state['consec_stops'] = 0
    else:
        state['today_losses'] += 1
        state['consec_stops'] += 1

    del state['positions'][code]
    save_state()
    save_trade({
        "date":        now_str(),
        "code":        code,
        "name":        pos['name'],
        "strategy":    pos['strategy'],
        "shares":      shares,
        "entry_price": pos['entry_price'],
        "exit_price":  current,
        "pnl":         round(pnl),
        "pnl_pct":     round(pnl_pct, 2),
        "reason":      reason,
    })

    sign  = "+" if pnl >= 0 else ""
    emoji = "✅" if pnl >= 0 else "❌"
    print(f"[매도:{pos['strategy']}] {pos['name']} | {reason} | {sign}{pnl_pct:.1f}% ({sign}{pnl:,.0f}원)")
    send_message(
        f"{emoji} <b>BearHunter 매도 [{pos['strategy']}전략]</b>\n"
        f"{pos['name']} | {reason}\n"
        f"PnL: {sign}{pnl:,.0f}원 ({sign}{pnl_pct:.1f}%)"
    )

    # 안전장치 체크
    daily_loss_rate = state['today_pnl'] / INITIAL_CAPITAL
    if daily_loss_rate <= DAILY_LOSS_LIMIT:
        state['halt'] = True
        save_state()
        print(f"[중단] 일일 손실 한도 도달 ({daily_loss_rate*100:.1f}%) → 당일 거래 중단")
        send_message(f"⛔ BearHunter 일일 손실 한도 도달 ({daily_loss_rate*100:.1f}%) → 중단")

    if state['consec_stops'] >= CONSEC_STOP_LIMIT:
        state['halt'] = True
        save_state()
        print(f"[중단] 연속 손절 {CONSEC_STOP_LIMIT}회 → 당일 거래 중단")
        send_message(f"⛔ BearHunter 연속 손절 {CONSEC_STOP_LIMIT}회 → 중단")


# ════════════════════════════════════════════
# 전략 A — 장중 진입 체크
# ════════════════════════════════════════════
def check_a_entries():
    if state['halt']:
        return
    if a_count() >= A_MAX:
        return

    now_t = now_kst().time()
    if not (A_ENTRY_START <= now_t <= A_ENTRY_END):
        return

    for code, name, prev_close, rsi, ret5, amount20 in a_candidates:
        if code in state['positions']:
            continue
        if a_count() >= A_MAX:
            break
        try:
            p       = get_stock_price(code)
            current = p['price']
            today_amount = current * p['volume']

            # 반등 확인: 현재가 > 전일 종가 × (1 + BOUNCE_THRESH)
            if current < prev_close * (1 + BOUNCE_THRESH):
                continue
            # 거래대금 급증 확인
            if today_amount < amount20 * AMOUNT_SURGE:
                continue

            tp = round(current * (1 + A_TP_PCT))
            sl = round(current * (1 - A_SL_PCT))
            paper_buy(code, name, current, sl, tp, 'A')

        except Exception as e:
            print(f"[전략A 진입체크] {code} 오류: {e}")


# ════════════════════════════════════════════
# 전략 B — 장중 돌파 체크
# ════════════════════════════════════════════
def check_b_entries():
    if state['halt']:
        return
    if b_count() >= B_MAX:
        return

    now_t = now_kst().time()
    if not (B_ENTRY_START <= now_t <= B_ENTRY_END):
        return

    for code, info in list(b_targets.items()):
        if code in state['positions']:
            continue
        if b_count() >= B_MAX:
            break
        try:
            current = get_stock_price(code)['price']
            if current >= info['entry_price']:
                tp = None   # Strategy B는 익절 없음 (타임스탑)
                paper_buy(code, info['name'], current, info['sl_price'], tp, 'B')
                del b_targets[code]   # 진입 완료 → 대기 목록 제거
        except Exception as e:
            print(f"[전략B 진입체크] {code} 오류: {e}")


# ════════════════════════════════════════════
# 포지션 모니터링
# ════════════════════════════════════════════
def monitor_positions():
    if not state['positions']:
        return

    now_t = now_kst().time()

    # 14:30 타임스탑 — 전체 강제청산
    if now_t >= FORCE_CLOSE_TIME:
        for code in list(state['positions'].keys()):
            paper_sell(code, "타임스탑 14:30")
        return

    for code in list(state['positions'].keys()):
        pos = state['positions'].get(code)
        if not pos:
            continue
        try:
            current = get_stock_price(code)['price']
        except Exception as e:
            print(f"[모니터] {code} 가격 오류: {e}")
            continue

        pnl_pct = (current - pos['entry_price']) / pos['entry_price'] * 100
        sign    = "+" if pnl_pct >= 0 else ""
        print(f"[모니터:{pos['strategy']}] {pos['name']} {sign}{pnl_pct:.1f}% "
              f"({pos['entry_price']:,}→{current:,})")

        # 손절
        if current <= pos['sl']:
            paper_sell(code, f"손절 {pnl_pct:.1f}%")
            continue

        # 전략 A 익절
        if pos['strategy'] == 'A' and pos['tp'] and current >= pos['tp']:
            paper_sell(code, f"익절 {pnl_pct:.1f}%")
            continue


# ════════════════════════════════════════════
# 사전 준비 (08:50 실행)
# ════════════════════════════════════════════
def pre_market_prep():
    global a_candidates, b_targets

    print(f"\n[{now_str()}] ─── BearHunter 사전 준비 ───")

    # 일일 초기화
    reset_daily()

    # 하락장 감지
    if not is_bear_market():
        print("[사전준비] 하락장 아님 → 오늘 봇 대기")
        state['halt'] = True
        save_state()
        send_message("🐻 BearHunter: 오늘은 하락장 조건 미충족 → 대기")
        return

    universe = load_universe()
    if not universe:
        print("[사전준비] 유니버스 없음")
        return

    # 전략 A 후보 스크리닝
    a_candidates = screen_a_candidates(universe)

    # 전략 B 진입가 계산 (장 시작 후 시가 확정 필요 → 09:05에 재계산)
    # 여기서는 전일 데이터로 range 계산, 시가는 09:05에 업데이트
    b_targets = calc_b_targets(universe)

    a_names = [c[1] for c in a_candidates[:5]]
    b_names = [v['name'] for v in list(b_targets.values())[:5]]
    print(f"[사전준비] A후보:{len(a_candidates)}개 B대기:{len(b_targets)}개")
    send_message(
        f"🐻 <b>BearHunter 사전준비 완료</b>\n"
        f"A후보: {len(a_candidates)}개 ({', '.join(a_names)}{'...' if len(a_candidates)>5 else ''})\n"
        f"B대기: {len(b_targets)}개 ({', '.join(b_names)}{'...' if len(b_targets)>5 else ''})"
    )


# ════════════════════════════════════════════
# B 진입가 재계산 (09:05 — 시가 확정 후)
# ════════════════════════════════════════════
def refresh_b_targets():
    global b_targets
    print(f"[{now_str()}] 전략B 진입가 재계산 (시가 확정 후)")
    universe = load_universe()
    if universe:
        b_targets = calc_b_targets(universe)
        print(f"[전략B] {len(b_targets)}종목 진입가 업데이트")


# ════════════════════════════════════════════
# 일일 리포트 (15:25)
# ════════════════════════════════════════════
def daily_report():
    win_rate = (state['today_wins'] / max(state['trade_count'], 1)) * 100
    msg = (
        f"\n{'='*50}\n"
        f"[BearHunter 일일리포트] {today_str()}\n"
        f"  자본:   {state['capital']:,}원\n"
        f"  오늘:   거래 {state['trade_count']}회 | PnL {state['today_pnl']:+,.0f}원\n"
        f"  승/패:  {state['today_wins']}승 {state['today_losses']}패 (승률 {win_rate:.0f}%)\n"
        f"  누적:   총PnL {state['total_pnl']:+,.0f}원\n"
        f"{'='*50}"
    )
    print(msg)
    send_message(
        f"📊 <b>BearHunter 일일리포트</b>\n"
        f"자본: {state['capital']:,}원\n"
        f"오늘 PnL: {state['today_pnl']:+,.0f}원\n"
        f"거래: {state['trade_count']}회 | 승률: {win_rate:.0f}%\n"
        f"누적 PnL: {state['total_pnl']:+,.0f}원"
    )


# ════════════════════════════════════════════
# 메인 루프
# ════════════════════════════════════════════
def main_loop():
    """장중 1분마다 실행: 진입 체크 + 포지션 모니터링"""
    now_t = now_kst().time()
    if dtime(9, 0) <= now_t <= dtime(14, 35):
        check_b_entries()
        check_a_entries()
        monitor_positions()


def run():
    load_state()
    load_universe()

    schedule.every().day.at("08:50").do(pre_market_prep)
    schedule.every().day.at("09:05").do(refresh_b_targets)
    schedule.every().day.at("15:25").do(daily_report)
    schedule.every().day.at("00:05").do(reset_daily)
    schedule.every(1).minutes.do(main_loop)

    print("=" * 60)
    print("  Bear Hunter — 하락장 특화 봇 (가상거래)")
    print("=" * 60)
    print(f"  자본: {state['capital']:,}원 | 최대포지션: {MAX_POSITIONS}개 (A:{A_MAX} B:{B_MAX})")
    print(f"  전략A: 낙폭과대 반등 (+4% 익절 / -2% 손절)")
    print(f"  전략B: 변동성 돌파 k={B_K} (-2% 손절 / 타임스탑 14:30)")
    print(f"  하락장 조건: KOSPI MA{BEAR_MA_SHORT}<MA{BEAR_MA_LONG} OR 5일<{BEAR_RET5_THRESH*100:.0f}%")
    print("=" * 60)

    send_message(
        "🐻 <b>BearHunter 봇 시작 (가상거래)</b>\n"
        f"자본: {state['capital']:,}원 | A:{A_MAX}+B:{B_MAX}포지션\n"
        "전략A: 낙폭과대반등 | 전략B: 변동성돌파\n"
        "08:50 준비 | 09:00 가동 | 14:30 강제청산"
    )

    # 장중 시작 시 즉시 준비
    now_t = now_kst().time()
    if dtime(8, 50) <= now_t <= dtime(9, 10):
        pre_market_prep()
    elif dtime(9, 5) <= now_t <= dtime(9, 15):
        refresh_b_targets()

    while True:
        schedule.run_pending()
        time.sleep(30)


if __name__ == "__main__":
    run()
