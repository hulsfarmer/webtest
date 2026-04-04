"""
코인 단타 가상거래봇 v4.0 — WebSocket 기반
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[3단계 복합 신호]
  1단계 (선행): 호가 흡수    — 30초간 매도호가 잔량 10%↑ 감소
  2단계 (확인): 체결강도 급등 — CS 80~94 + 전3분 대비 +10pt↑
  3단계 (진입): 1분봉 양봉   — 직전 완성 1분봉 close > open

[필터] (v4.0, 2026-04-03 백테스트 기반)
  1. CS≥80 (65→80 상향, CS65-80 = -21,350원 손실)
  2. 블랙리스트: TAO,ETH,BLUR,DRIFT 진입 차단
  3. 00-08시 진입 차단 (새벽/아침 승률 29%)

[청산] ATR 기반
  TP: ATR × 1.5 | SL: ATR × 0.7
  트레일링: ATR × 1.0 도달 시 활성, 고점 - ATR × 0.3
  시간손절: 60분

실행: python3 coin_daytrade_paper.py
"""

import asyncio
import json
import os
import time
import logging
import sqlite3
import requests
import websockets
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime
from dotenv import load_dotenv
load_dotenv()

# ── 설정 ──────────────────────────────────────────────
TOP_N           = 20          # 모니터링 코인 수
MAX_POSITIONS   = 2           # 최대 동시 보유 (필터 강화로 시그널 감소 → 집중 투자)
TRADE_CAPITAL   = 500_000     # 종목당 투입 (원, 100만원 ÷ 2)

# ATR 기반 청산 (v2)
ATR_PERIOD      = 14          # ATR 계산 기간 (5분봉 14개)
TP_ATR_MULT     = 1.5         # TP = entry + ATR × 1.5
SL_ATR_MULT     = 0.7         # SL = entry - ATR × 0.7
TRAIL_ACT_ATR   = 1.0         # ATR × 1.0 수익 시 트레일링 활성
TRAIL_OFF_ATR   = 0.3         # 고점 - ATR × 0.3 에서 트레일링 스탑
TIME_STOP_MIN   = 60          # 시간손절 (분)

CS_THRESHOLD    = 80          # 체결강도 하한 (80 이상 진입) — 백테스트: CS65-80 = -21,350원 손실
CS_MAX          = 94          # 체결강도 상한 (과열 제외)
CS_LOG_MIN      = 60          # 시그널 로그 최소값 (백테스트용)
CS_ACCEL        = 10          # 전3분 대비 가속 포인트
ASK_ABSORB_RATE = 0.10        # 매도호가 감소율 (10%)
BTC_CS_MIN      = 95          # BTC 최소 체결강도

SIGNAL_COOLDOWN   = 5           # 진입 후 기본 쿨다운 (분) — 수익 청산 시
LOSS_COOLDOWN_MIN = 120         # 손실 청산 후 동일 코인 재진입 금지 (분)
CHECK_INTERVAL    = 30          # 신호 체크 주기 (초)
WARMUP_SEC        = 200         # 버퍼 워밍업 대기 (초)

# ── cs 80~90 가상 필터 (데이터 수집용, 실제 차단 X) ────
CS_FILTER_MIN = 80   # 이 범위 벗어나면 [FILTER_CS] 태그만 로그에 기록
CS_FILTER_MAX = 90


# ── 종목 그룹 분류 (백테스트 기반) ───────────────────────
# 블랙리스트: 102건 분석 결과 지속 손실 코인 — 진입 완전 차단
BLACKLIST = {'KRW-TAO', 'KRW-ETH', 'KRW-BLUR', 'KRW-DRIFT'}  # TAO -11,019 ETH -10,263 BLUR -10,662 DRIFT -7,246
# B그룹: BTC동조형 — 하락장 진입 차단
GROUP_B = {'KRW-XRP', 'KRW-SOL', 'KRW-RAY'}  # ETH는 블랙리스트로 이동
# D그룹: 부적합형 — 포지션 50% 축소
GROUP_D = {'KRW-SEI', 'KRW-ONG', 'KRW-MINA', 'KRW-DOGE', 'KRW-WCT'}
# C그룹: 고변동형 — 포지션 50% 축소
GROUP_C = {'KRW-KERNEL'}

# ── 시간대 필터 ─────────────────────────────────────────
TRADE_START_HOUR = 9   # 09시부터 거래 허용 — 00-08시 승률 29%, -12,873원

# ── 장세 판단 (BTC 3시간봉 기준) ────────────────────────
BTC_TREND_BULL  =  0.5   # 3h 변화 +0.5% 이상 → 상승장
BTC_TREND_BEAR  = -0.5   # 3h 변화 -0.5% 이하 → 하락장
                          # 그 외 → 횡보장 (진입 차단)

STATE_PATH      = os.path.join(os.path.dirname(__file__), "daytrade_coin_state.json")
DB_PATH         = os.path.join(os.path.dirname(__file__), "daytrade_coin.db")

# ── 실거래/모의거래 모드 ──────────────────────────────
MODE_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "daytrade_coin_mode.json")

def is_live_mode():
    """모드 파일에서 실거래 여부 확인"""
    try:
        if os.path.exists(MODE_FILE):
            with open(MODE_FILE) as f:
                return json.load(f).get("live", False)
    except:
        pass
    return False

# ── 실거래 클라이언트 ──────────────────────────────────
_upbit_client = None

def get_upbit_client():
    global _upbit_client
    if _upbit_client is None:
        from upbit_client import UpbitClient
        access = os.environ.get("UPBIT_ACCESS_KEY", "")
        secret = os.environ.get("UPBIT_SECRET_KEY", "")
        _upbit_client = UpbitClient(access, secret, paper_trading=False)
    return _upbit_client

def get_live_capital():
    """실거래: 업비트 KRW 잔고 조회"""
    try:
        client = get_upbit_client()
        return client.get_krw_balance()
    except Exception as e:
        log.error(f"잔고 조회 실패: {e}")
        return 0
LOG_PATH        = os.path.join(os.path.dirname(__file__), "daytrade_coin.log")

UPBIT_WS   = "wss://api.upbit.com/websocket/v1"
UPBIT_REST = "https://api.upbit.com/v1"

# ── 로깅 ──────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
    datefmt="%H:%M:%S",
    handlers=[logging.StreamHandler()]
)
log = logging.getLogger(__name__)


# ── 코인별 데이터 버퍼 ─────────────────────────────────
@dataclass
class CoinBuffer:
    # (timestamp_ms, is_buy, volume) — 최근 6분치
    trades: deque = field(default_factory=lambda: deque(maxlen=10000))
    # (timestamp_ms, ask_total) — 1초 샘플, 최근 90초
    ask_history: deque = field(default_factory=lambda: deque(maxlen=90))
    last_ob_sample: float = 0.0     # 마지막 호가 샘플 시각
    cooldown_until: float = 0.0     # 재진입 차단 시각 (epoch)


# ── 전역 상태 ──────────────────────────────────────────
buffers: dict[str, CoinBuffer] = {}
positions: dict[str, dict] = {}
closed_trades: list[dict] = []
daily_sl_coins: set[str] = set()   # 당일 SL 발생 코인 (자정 리셋)
_current_day: str = ""              # 날짜 변경 감지용


# ── Upbit REST 헬퍼 ────────────────────────────────────
def get_top_coins(n: int) -> list[str]:
    """거래대금 상위 N개 KRW 코인 (BTC 포함)"""
    try:
        markets = [m["market"]
                   for m in requests.get(f"{UPBIT_REST}/market/all?isDetails=false",
                                         timeout=5).json()
                   if m["market"].startswith("KRW-")]

        tickers = []
        for i in range(0, len(markets), 100):
            r = requests.get(f"{UPBIT_REST}/ticker",
                             params={"markets": ",".join(markets[i:i+100])},
                             timeout=5)
            tickers.extend(r.json())
            time.sleep(0.1)

        tickers.sort(key=lambda x: x.get("acc_trade_price_24h", 0), reverse=True)

        # BTC + BTC 필터 예외 코인은 항상 포함
        ALWAYS_INCLUDE = {"KRW-BTC", "KRW-ORCA", "KRW-JST"}
        top = list(ALWAYS_INCLUDE)
        for t in tickers:
            m = t["market"]
            if m not in ALWAYS_INCLUDE and len(top) < n:
                top.append(m)
        log.info(f"코인 목록: {', '.join(c.replace('KRW-','') for c in top)}")
        return top
    except Exception as e:
        log.error(f"코인 목록 조회 실패: {e} — 기본값 사용")
        return ["KRW-BTC","KRW-ETH","KRW-XRP","KRW-SOL","KRW-DOGE",
                "KRW-ADA","KRW-AVAX","KRW-DOT","KRW-LINK","KRW-MATIC",
                "KRW-ATOM","KRW-NEAR","KRW-BCH","KRW-LTC","KRW-ETC",
                "KRW-TRX","KRW-SAND","KRW-MANA","KRW-CHZ","KRW-SUI"]


def get_current_price(market: str) -> float:
    try:
        r = requests.get(f"{UPBIT_REST}/ticker",
                         params={"markets": market}, timeout=3)
        return float(r.json()[0]["trade_price"])
    except:
        return 0.0


def fetch_atr(market: str, unit: int = 5, period: int = ATR_PERIOD) -> float:
    """5분봉 기반 ATR 계산 (REST API)"""
    try:
        r = requests.get(
            f"{UPBIT_REST}/candles/minutes/{unit}",
            params={"market": market, "count": period + 5},
            timeout=5
        )
        candles = r.json()
        if not isinstance(candles, list) or len(candles) < period + 1:
            return 0.0
        candles.sort(key=lambda c: c['candle_date_time_kst'])
        trs = []
        for i in range(1, len(candles)):
            h = float(candles[i]['high_price'])
            l = float(candles[i]['low_price'])
            pc = float(candles[i-1]['trade_price'])
            tr = max(h - l, abs(h - pc), abs(l - pc))
            trs.append(tr)
        return sum(trs[-period:]) / period if len(trs) >= period else (sum(trs) / len(trs) if trs else 0.0)
    except Exception as e:
        log.warning(f"ATR 계산 실패 {market}: {e}")
        return 0.0


def is_last_1min_bullish(market: str) -> bool:
    """직전 완성 1분봉이 양봉인지 REST로 확인"""
    try:
        r = requests.get(
            f"{UPBIT_REST}/candles/minutes/1",
            params={"market": market, "count": 3},
            timeout=3
        )
        candles = r.json()
        # index 0 = 현재 진행 중, index 1 = 직전 완성봉
        if len(candles) < 2:
            return False
        prev = candles[1]
        return float(prev["trade_price"]) > float(prev["opening_price"])
    except:
        return False


# ── 신호 계산 ──────────────────────────────────────────
def calc_cs(buf: CoinBuffer, window_min: int, offset_min: int = 0) -> float:
    """
    체결강도 계산 (window_min 분간)
    offset_min: 몇 분 전 시점을 기준으로 (0 = 지금부터 역산)
    """
    now_ms   = time.time() * 1000
    end_ms   = now_ms - offset_min * 60_000
    start_ms = end_ms - window_min * 60_000

    buy = sell = 0.0
    for ts, is_buy, vol in buf.trades:
        if start_ms <= ts < end_ms:
            buy  += vol if is_buy else 0
            sell += vol if not is_buy else 0

    total = buy + sell
    return (buy / total * 100) if total > 0 else 100.0


def is_ask_absorbing(buf: CoinBuffer) -> bool:
    """
    최근 30초간 매도호가 잔량이 ASK_ABSORB_RATE 이상 감소했는지
    """
    if len(buf.ask_history) < 10:
        return False

    now_ms    = time.time() * 1000
    cutoff_ms = now_ms - 30_000

    # 30초 전 가장 최근 값 찾기
    old_ask = None
    for ts, ask in buf.ask_history:
        if ts <= cutoff_ms:
            old_ask = ask   # 계속 갱신 → 30초 전에 가장 가까운 값

    if old_ask is None or old_ask == 0:
        return False

    current_ask = buf.ask_history[-1][1]
    return (old_ask - current_ask) / old_ask >= ASK_ABSORB_RATE



def check_signal(market: str) -> tuple[bool, dict]:
    """3단계 신호 체크. (triggered, detail) 반환"""
    buf = buffers.get(market)
    if not buf:
        return False, {}

    # 블랙리스트 차단
    if market in BLACKLIST:
        return False, {}

    # 시간대 필터: 00-08시 진입 차단
    if datetime.now().hour < TRADE_START_HOUR:
        return False, {}

    # 쿨다운
    if time.time() < buf.cooldown_until:
        return False, {}

    # 당일 SL 차단
    if market in daily_sl_coins:
        return False, {}

    # ── Stage 2: 체결강도 ──
    cs_now   = calc_cs(buf, 3, 0)   # 현재~3분 전
    cs_prev  = calc_cs(buf, 3, 3)   # 3~6분 전
    cs_accel = round(cs_now - cs_prev, 1)

    # ── Stage 1: 호가 흡수 ──
    stage1 = is_ask_absorbing(buf)

    # 시그널 로그 최소 조건 (백테스트용 — CS_LOG_MIN 이상 + 가속 + 호가흡수)
    log_cond = stage1 and cs_now >= CS_LOG_MIN and cs_accel >= CS_ACCEL
    if not log_cond:
        return False, {}

    # ── Stage 3: 1분봉 양봉 ──
    stage3 = is_last_1min_bullish(market)

    # 실제 진입 조건: CS_THRESHOLD~CS_MAX 범위 내
    in_range = CS_THRESHOLD < cs_now <= CS_MAX
    entered  = in_range and stage3

    # 시그널 DB 저장 (범위 밖 포함 모든 시그널 기록)
    save_signal_db(market, round(cs_now, 1), cs_accel, stage3, entered)

    detail = {
        "cs_now":   round(cs_now, 1),
        "cs_prev":  round(cs_prev, 1),
        "cs_accel": cs_accel,
        "s1_absorb": stage1,
        "s3_candle": stage3,
    }
    return entered, detail


def get_btc_trend() -> tuple[str, float]:
    """BTC 1시간봉 기준 3시간 변화율로 장세 판단
    반환: ('상승장'|'횡보장'|'하락장', 변화율%)
    """
    try:
        r = requests.get(
            f"{UPBIT_REST}/candles/minutes/60",
            params={"market": "KRW-BTC", "count": 4},
            timeout=3
        )
        candles = r.json()
        if len(candles) < 4:
            return '횡보장', 0.0
        price_now  = float(candles[0]["trade_price"])
        price_3ago = float(candles[3]["trade_price"])
        chg = (price_now / price_3ago - 1) * 100
        if chg >= BTC_TREND_BULL:
            return '상승장', round(chg, 2)
        elif chg <= BTC_TREND_BEAR:
            return '하락장', round(chg, 2)
        else:
            return '횡보장', round(chg, 2)
    except:
        return '횡보장', 0.0


def is_btc_stable() -> tuple[bool, float]:
    """BTC 15분 변동률 ±0.25% 이내면 True(안정), 아니면 False(불안정)"""
    try:
        r = requests.get(
            f"{UPBIT_REST}/candles/minutes/1",
            params={"market": "KRW-BTC", "count": 16},
            timeout=3
        )
        candles = r.json()
        if len(candles) < 16:
            return True, 0.0
        price_now   = float(candles[0]["trade_price"])
        price_15ago = float(candles[15]["trade_price"])
        ret = (price_now / price_15ago - 1) * 100
        return abs(ret) <= 0.25, round(ret, 2)
    except:
        return True, 0.0


# ── 가상 매매 ──────────────────────────────────────────
def enter(market: str, price: float, detail: dict, trend: str = ""):
    # ATR 계산
    atr = fetch_atr(market)
    if atr <= 0:
        log.warning(f"[매수 취소] {market} ATR 계산 실패")
        return

    atr_pct = atr / price * 100
    if atr_pct < 0.3:
        log.info(f"[매수 스킵] {market} ATR {atr_pct:.2f}% — 변동성 부족")
        return

    # 투입금 결정
    invested = sum(p["entry_price"] * p["qty"] for p in positions.values())
    total_capital = get_live_capital() if is_live_mode() else 1_000_000
    remaining = total_capital - invested
    remaining_slots = MAX_POSITIONS - len(positions)
    cs = detail.get("cs_now", 0)

    if trend == "상승장" and cs >= 80 and len(positions) == 0:
        capital = 750_000  # 1.5배 (기본 500K × 1.5)
    elif remaining_slots > 0:
        capital = int(remaining / remaining_slots)
    else:
        capital = TRADE_CAPITAL

    # D/C그룹: 50% 축소
    if market in GROUP_D | GROUP_C:
        capital = capital // 2

    tp_price = round(price + atr * TP_ATR_MULT, 4)
    sl_price = round(price - atr * SL_ATR_MULT, 4)

    qty = capital / price

    # 실거래 주문
    if is_live_mode():
        client = get_upbit_client()
        result = client.buy_market(market, capital)
        if not result:
            log.error(f"[실거래 매수 실패] {market}")
            return
        price = result["price"]  # 실제 체결가
        qty = result["quantity"]  # 실제 체결 수량
        log.info(f"[실거래 매수 체결] {market} | 체결가 {price:,.0f} | 수량 {qty:.6f}")

    now = datetime.now()
    positions[market] = {
        "market":       market,
        "name":         market.replace("KRW-", ""),
        "entry_time":   now.strftime("%H:%M:%S"),
        "entry_dt":     now.timestamp(),
        "entry_price":  price,
        "qty":          qty,
        "tp_price":     tp_price,
        "sl_price":     sl_price,
        "trail_active": False,
        "trail_high":   price,
        "trail_stop":   0.0,
        "atr":          atr,
        "cs_now":       detail.get("cs_now", 0),
        "cs_accel":     detail.get("cs_accel", 0),
    }
    tp_pct = (tp_price - price) / price * 100
    sl_pct = (price - sl_price) / price * 100
    filter_tag = "" if CS_FILTER_MIN <= cs <= CS_FILTER_MAX else f" [FILTER_CS cs={cs}]"
    boost_tag = " [1.5배]" if trend == "상승장" and cs >= 80 and capital == 750_000 else ""
    grp_tag = " [D그룹50%]" if market in GROUP_D else (" [C그룹50%]" if market in GROUP_C else "")
    log.info(
        f"[매수] {market} | {price:,.0f}원 | 투입 {capital:,}원 | "
        f"TP {tp_price:,.0f}(+{tp_pct:.1f}%) | SL {sl_price:,.0f}(-{sl_pct:.1f}%) | "
        f"ATR {atr:,.0f}({atr_pct:.1f}%) | "
        f"체결강도 {cs} (+{detail.get('cs_accel')}pt){filter_tag}{grp_tag}{boost_tag}"
    )
    save_state()


def close(market: str, exit_price: float, reason: str):
    pos = positions.pop(market, None)
    if not pos:
        return

    # 실거래 매도
    if is_live_mode():
        client = get_upbit_client()
        result = client.sell_market(market, pos["qty"])
        if result:
            exit_price = result["price"]  # 실제 체결가
            log.info(f"[실거래 매도 체결] {market} | 체결가 {exit_price:,.0f}")
        else:
            log.error(f"[실거래 매도 실패] {market} — 가상 가격으로 기록")

    commission = (pos["entry_price"] + exit_price) * pos["qty"] * 0.0005
    pnl = (exit_price - pos["entry_price"]) * pos["qty"] - commission
    ret = (exit_price / pos["entry_price"] - 1) * 100
    now = datetime.now()

    trade = {
        "date":         now.strftime("%Y-%m-%d"),
        "market":       market,
        "name":         pos["name"],
        "entry_time":   pos["entry_time"],
        "exit_time":    now.strftime("%H:%M:%S"),
        "entry_price":  pos["entry_price"],
        "exit_price":   exit_price,
        "qty":          pos["qty"],
        "pnl":          round(pnl),
        "return_pct":   round(ret, 2),
        "result":       reason,
        "cs_now":       pos["cs_now"],
    }
    closed_trades.append(trade)
    save_db(trade)

    # ② 손실 쿨다운: 손실 청산 시 2시간, 수익 시 5분
    if pnl < 0:
        buffers[market].cooldown_until = time.time() + LOSS_COOLDOWN_MIN * 60
        cooldown_msg = f" | 쿨다운 {LOSS_COOLDOWN_MIN}분"
    else:
        buffers[market].cooldown_until = time.time() + SIGNAL_COOLDOWN * 60
        cooldown_msg = ""

    # 당일 SL → 자정까지 재진입 금지
    if reason == "SL":
        daily_sl_coins.add(market)
        log.info(f"[당일 SL 차단] {market.replace('KRW-','')} — 자정까지 재진입 금지")

    emoji = "✅" if pnl > 0 else "❌"
    log.info(
        f"{emoji} [{reason}] {market} | "
        f"{pos['entry_price']:,.0f} → {exit_price:,.0f} | "
        f"{ret:+.2f}% | {pnl:+,.0f}원{cooldown_msg}"
    )
    save_state()


def monitor_positions():
    """ATR 기반 TP / SL / 트레일링 / 시간손절"""
    state_changed = False
    for market in list(positions.keys()):
        pos = positions[market]
        price = get_current_price(market)
        if not price:
            continue

        atr = pos.get("atr", 0)
        elapsed = (time.time() - pos["entry_dt"]) / 60

        # 고점 갱신
        if price > pos["trail_high"]:
            pos["trail_high"] = price
            state_changed = True

        # 트레일링 활성화: ATR × TRAIL_ACT_ATR 수익 도달 시
        activate_price = pos["entry_price"] + atr * TRAIL_ACT_ATR
        if not pos["trail_active"] and price >= activate_price:
            pos["trail_active"] = True
            state_changed = True
            log.info(f"[트레일링 ON] {market} | 가격 {price:,.0f} | ATR×{TRAIL_ACT_ATR}")

        if pos["trail_active"] and atr > 0:
            new_stop = round(pos["trail_high"] - atr * TRAIL_OFF_ATR, 4)
            if new_stop != pos.get("trail_stop", 0):
                pos["trail_stop"] = new_stop
                state_changed = True

        # 청산 판정
        reason = None
        if price <= pos["sl_price"]:
            reason = "SL"
        elif pos["trail_active"] and price <= pos.get("trail_stop", 0):
            reason = "TRAIL"
        elif price >= pos["tp_price"]:
            reason = "TP"
        elif elapsed >= TIME_STOP_MIN:
            reason = "TIME"

        if reason:
            exit_price = pos["sl_price"] if reason == "SL" else (pos["tp_price"] if reason == "TP" else price)
            close(market, exit_price, reason)

    if state_changed:
        save_state()


# ── DB / 상태 저장 ─────────────────────────────────────
def init_db():
    conn = sqlite3.connect(DB_PATH)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS trades (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            date        TEXT, market TEXT, name TEXT,
            entry_time  TEXT, exit_time TEXT,
            entry_price REAL, exit_price REAL,
            qty         REAL, pnl REAL, return_pct REAL,
            result      TEXT, cs_now REAL
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS signals (
            id       INTEGER PRIMARY KEY AUTOINCREMENT,
            dt       TEXT,
            market   TEXT,
            cs_now   REAL,
            cs_accel REAL,
            stage3   INTEGER,
            entered  INTEGER
        )
    """)
    conn.commit()
    conn.close()


def save_db(t: dict):
    conn = sqlite3.connect(DB_PATH)
    conn.execute(
        "INSERT INTO trades VALUES (NULL,?,?,?,?,?,?,?,?,?,?,?,?)",
        (t["date"], t["market"], t["name"],
         t["entry_time"], t["exit_time"],
         t["entry_price"], t["exit_price"],
         t["qty"], t["pnl"], t["return_pct"],
         t["result"], t["cs_now"])
    )
    conn.commit()
    conn.close()


def save_signal_db(market: str, cs_now: float, cs_accel: float, stage3: bool, entered: bool):
    try:
        conn = sqlite3.connect(DB_PATH)
        conn.execute(
            "INSERT INTO signals VALUES (NULL,?,?,?,?,?,?)",
            (datetime.now().strftime("%Y-%m-%d %H:%M:%S"), market,
             cs_now, cs_accel, int(stage3), int(entered))
        )
        conn.commit()
        conn.close()
    except Exception as e:
        log.warning(f"시그널 로그 저장 실패: {e}")


def save_state():
    today    = datetime.now().strftime("%Y-%m-%d")
    today_t  = [t for t in closed_trades if t["date"] == today]
    today_pnl  = sum(t["pnl"] for t in today_t)
    today_wins = sum(1 for t in today_t if t["pnl"] > 0)

    # 쿨다운 상태 저장 (재시작 시 복원용)
    cooldowns = {
        market: buf.cooldown_until
        for market, buf in buffers.items()
        if buf.cooldown_until > time.time()
    }

    state = {
        "updated":       datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "mode":          "실거래" if is_live_mode() else "모의거래",
        "positions":     positions,
        "today_closed":  today_t[-10:],
        "today_pnl":     today_pnl,
        "today_count":   len(today_t),
        "today_wins":    today_wins,
        "cooldowns":     cooldowns,
        "daily_sl_coins": list(daily_sl_coins),
    }
    with open(STATE_PATH, "w", encoding="utf-8") as f:
        json.dump(state, f, ensure_ascii=False, default=str)


# ── WebSocket 메시지 처리 ──────────────────────────────
def on_trade(msg: dict):
    market = msg.get("code", "")
    buf    = buffers.get(market)
    if not buf:
        return
    buf.trades.append((
        int(msg.get("trade_timestamp", time.time() * 1000)),
        msg.get("ask_bid") == "BID",   # BID = 매수 체결
        float(msg.get("trade_volume", 0))
    ))


def on_orderbook(msg: dict):
    market = msg.get("code", "")
    buf    = buffers.get(market)
    if not buf:
        return

    now_ms = time.time() * 1000
    if now_ms - buf.last_ob_sample < 1000:   # 1초에 한 번만 샘플링
        return

    buf.last_ob_sample = now_ms
    ask_total = sum(float(u.get("ask_size", 0))
                    for u in msg.get("orderbook_units", []))
    buf.ask_history.append((now_ms, ask_total))


# ── 비동기 태스크 ──────────────────────────────────────
async def ws_task(coins: list[str]):
    """WebSocket 수신 — 자동 재연결"""
    sub = json.dumps([
        {"ticket": "coin-daytrade-paper"},
        {"type": "trade",     "codes": coins},
        {"type": "orderbook", "codes": coins},
    ])

    while True:
        try:
            log.info("WebSocket 연결 중...")
            async with websockets.connect(
                UPBIT_WS, ping_interval=20, ping_timeout=10
            ) as ws:
                await ws.send(sub)
                log.info(f"WebSocket 연결됨 — {len(coins)}개 코인 구독")

                async for raw in ws:
                    try:
                        msg = json.loads(raw)
                        t   = msg.get("type")
                        if t == "trade":
                            on_trade(msg)
                        elif t == "orderbook":
                            on_orderbook(msg)
                    except Exception:
                        pass

        except Exception as e:
            log.warning(f"WebSocket 끊김: {e} — 5초 후 재연결")
            await asyncio.sleep(5)


async def signal_task(coins: list[str]):
    """30초마다 신호 체크 및 가상 진입"""
    global daily_sl_coins, _current_day
    log.info(f"버퍼 워밍업 대기 ({WARMUP_SEC}초)...")
    await asyncio.sleep(WARMUP_SEC)
    log.info("신호 체크 시작")

    while True:
        # 자정 리셋: 날짜 바뀌면 당일 SL 차단 초기화
        today = datetime.now().strftime("%Y-%m-%d")
        if _current_day and _current_day != today:
            daily_sl_coins.clear()
            log.info("자정 — 당일 SL 차단 목록 초기화")
        _current_day = today

        # BTC 안정성 필터 (15분 변동률)
        stable, btc_15m = is_btc_stable()

        # 장세 판단 (BTC 3시간봉)
        trend, btc_3h = get_btc_trend()

        # 코인별 신호 체크
        for market in coins:
            if market == "KRW-BTC":
                continue
            if market in positions or len(positions) >= MAX_POSITIONS:
                continue

            # BTC 안정성 필터: 종목별 예외 허용
            if not stable:
                if market == "KRW-ORCA" and abs(btc_15m) <= 1.0:
                    pass  # ORCA: BTC 변동 ±1.0% 이내 허용 (독립형)
                elif market == "KRW-JST" and btc_15m < 0 and abs(btc_15m) <= 1.0:
                    pass  # JST: BTC 하락 변동 시 허용 (독립형, 하락시 강세)
                else:
                    continue

            # 하락장 B그룹 차단
            if trend == '하락장' and market in GROUP_B:
                continue

            triggered, detail = check_signal(market)
            if triggered:
                cs = detail.get("cs_now", 0)
                # 횡보장/하락장: CS 80 미만 진입 차단
                if trend in ('횡보장', '하락장') and cs < 80:
                    log.info(f"[{trend} CS필터] {market} cs={cs} < 80 — 스킵")
                    continue
                price = get_current_price(market)
                if price > 0:
                    log.info(f"[신호 발생] {market} | {detail} | 장세:{trend} BTC3h {btc_3h:+.2f}% 15m {btc_15m:+.2f}%")
                    enter(market, price, detail, trend)
                    await asyncio.sleep(0.5)   # API 부하 방지

        await asyncio.sleep(CHECK_INTERVAL)


async def monitor_task():
    """10초마다 포지션 관리"""
    while True:
        if positions:
            monitor_positions()
        await asyncio.sleep(10)


async def status_task():
    """5분마다 상태 요약 출력 + 상태 파일 갱신 / 6시간마다 종목 패턴 갱신"""
    tick = 0
    while True:
        await asyncio.sleep(300)
        tick += 1
        today     = datetime.now().strftime("%Y-%m-%d")
        today_t   = [t for t in closed_trades if t["date"] == today]
        today_pnl = sum(t["pnl"] for t in today_t)
        wins      = sum(1 for t in today_t if t["pnl"] > 0)
        wr        = round(wins / len(today_t) * 100) if today_t else 0

        sl_names = ', '.join(c.replace('KRW-','') for c in daily_sl_coins) if daily_sl_coins else '없음'
        log.info(
            f"[상태] 포지션: {len(positions)}/{MAX_POSITIONS} | "
            f"오늘: {len(today_t)}건 {wr}% | 손익: {today_pnl:+,.0f}원 | "
            f"당일SL차단: {sl_names}"
        )
        save_state()


# ── 메인 ──────────────────────────────────────────────
async def main():
    log.info("=" * 55)
    log.info("코인 단타 가상거래봇 시작")
    log.info(f"TP ATR×{TP_ATR_MULT} | SL ATR×{SL_ATR_MULT} | Trail ATR×{TRAIL_OFF_ATR} | 시간손절 {TIME_STOP_MIN}분")
    log.info(f"체결강도 {CS_THRESHOLD}~{CS_MAX} & +{CS_ACCEL}pt | 호가흡수 {ASK_ABSORB_RATE*100:.0f}%↓ | 시그널로그 CS≥{CS_LOG_MIN}")
    log.info("=" * 55)

    init_db()

    # 재시작 시 오늘 거래 DB에서 복원
    today_str = datetime.now().strftime("%Y-%m-%d")
    try:
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            "SELECT * FROM trades WHERE date=? ORDER BY entry_time", (today_str,)
        ).fetchall()
        conn.close()
        for r in rows:
            closed_trades.append(dict(r))
        if closed_trades:
            log.info(f"오늘 거래 {len(closed_trades)}건 복원")
    except Exception as e:
        log.warning(f"오늘 거래 복원 실패: {e}")

    coins = get_top_coins(TOP_N)
    for c in coins:
        buffers[c] = CoinBuffer()

    # 재시작 시 쿨다운 복원
    try:
        if os.path.exists(STATE_PATH):
            with open(STATE_PATH, encoding="utf-8") as f:
                prev = json.load(f)
            now_ts = time.time()
            for market, until in prev.get("cooldowns", {}).items():
                if market in buffers and float(until) > now_ts:
                    buffers[market].cooldown_until = float(until)
                    remain_min = int((float(until) - now_ts) / 60)
                    log.info(f"[쿨다운 복원] {market} → {remain_min}분 남음")
    except Exception as e:
        log.warning(f"쿨다운 복원 실패: {e}")

    # 재시작 시 당일 SL 차단 복원 (오늘 DB 거래 기준)
    for t in closed_trades:
        if t.get("result") == "SL":
            daily_sl_coins.add(t["market"])
    if daily_sl_coins:
        names = ', '.join(c.replace('KRW-', '') for c in daily_sl_coins)
        log.info(f"[당일 SL 차단 복원] {names}")

    save_state()

    await asyncio.gather(
        ws_task(coins),
        signal_task(coins),
        monitor_task(),
        status_task(),
    )


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        log.info("종료")
        save_state()
