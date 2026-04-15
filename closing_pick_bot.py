"""
종가배팅봇 — G8 전략 v1.0
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[핵심 전략]
  볼린저밴드 1.5σ 돌파 + 거래량 3배 + 캔들위치 85%+ + 60일 신고가
  → 15:20 종가 매수, 익일 09:01 시장가 전량매도

[백테스트 근거]
  4.3년 223건 | 승률 60.1% | PF 7.41 | CAGR +57.9% | MDD 7.73%

[타임라인]
  08:55       봇 시작, 토큰 발급
  09:00~09:02 전일 매수분 시장가 전량매도 (청산)
  15:00       스크리닝용 데이터 수집 (일봉 20일+)
  15:18~15:20 조건 충족 종목 매수 (최대 3종목)
  15:30       일간 요약 출력

[진입 조건] (15:18~15:20 체크)
  ① 볼린저 밴드 1.5σ 상단 돌파 (20일)
  ② 거래량 5일 평균 대비 3배 이상
  ③ 캔들 위치 85% 이상 (종가 ≈ 고가)
  ④ 60일 신고가 돌파
  ⑤ 양봉
  ⑥ 최소 주가 2만원

[안전장치]
  - KOSPI 당일 -1.5% 이하면 매수 안 함
  - 1일 최대 손실 자본 -2% 시 매수 중단
"""

import os
import sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import json
import time
import sqlite3
import requests
import logging
import numpy as np
from datetime import datetime, timedelta, timezone

KST = timezone(timedelta(hours=9))
from dotenv import load_dotenv

load_dotenv()

# ── 설정 ──────────────────────────────────────────────
APP_KEY    = os.getenv("APP_KEY")
APP_SECRET = os.getenv("APP_SECRET")
BASE_URL   = "https://openapi.koreainvestment.com:9443"

DB_PATH       = "./closing_pick.db"
STATE_PATH    = "./closing_pick_state.json"
LOG_PATH      = "./logs/closing_pick.log"
TOKEN_FILE    = ".token_cache_closing"
MODE_FILE     = "./closing_pick_mode.json"

INITIAL_CAPITAL = 300_000     # 초기 자본 (갭봇과 동일 계좌)
MAX_POSITIONS   = 3
COMMISSION      = 0.000147    # 수수료 편도 0.0147%
SELL_TAX        = 0.0018      # 매도세 0.18%
SLIPPAGE        = 0.001       # 슬리피지 0.1%

# 볼린저 밴드 파라미터
BB_PERIOD       = 20          # 볼린저 이동평균 기간
BB_STD_MULT     = 1.5         # 볼린저 표준편차 배수
VOL_MULT        = 3.0         # 거래량 배수 (5일 대비)
CANDLE_POS_MIN  = 0.85        # 캔들 위치 최소값
HIGH_PERIOD     = 60          # 신고가 기간 (일)
MIN_PRICE       = 20_000      # 최소 주가
KOSPI_LIMIT     = -1.5        # KOSPI 하락 한도 (%)
DAILY_LOSS_LIMIT = -0.02      # 일일 최대 손실 비율

SCAN_INTERVAL   = 60          # 스캔 주기 (초)
API_DELAY       = 0.35
TOP_N_STOCKS    = 200         # 시총 상위 스크리닝 대상

# ── 로깅 ──────────────────────────────────────────────
os.makedirs("logs", exist_ok=True)
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
    datefmt="%H:%M:%S",
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler(LOG_PATH, encoding="utf-8")
    ]
)
log = logging.getLogger(__name__)


# ── 모드 ──────────────────────────────────────────────
def is_live_mode():
    if os.path.exists(MODE_FILE):
        try:
            with open(MODE_FILE) as f:
                return json.load(f).get("live", False)
        except:
            pass
    return False


# ── API ──────────────────────────────────────────────
def get_token() -> str:
    if os.path.exists(TOKEN_FILE):
        with open(TOKEN_FILE) as f:
            cache = json.load(f)
        if datetime.now(KST) < datetime.strptime(cache["expires"], "%Y-%m-%d %H:%M:%S").replace(tzinfo=KST) - timedelta(minutes=10):
            return cache["token"]
    res = requests.post(
        f"{BASE_URL}/oauth2/tokenP",
        headers={"content-type": "application/json"},
        json={"grant_type": "client_credentials", "appkey": APP_KEY, "appsecret": APP_SECRET}
    )
    res.raise_for_status()
    data = res.json()
    with open(TOKEN_FILE, "w") as f:
        json.dump({"token": data["access_token"], "expires": data["access_token_token_expired"]}, f)
    return data["access_token"]


def api_get(tr_id: str, url: str, params: dict, token: str, retries: int = 3) -> dict:
    time.sleep(API_DELAY)
    headers = {
        "content-type": "application/json",
        "authorization": f"Bearer {token}",
        "appkey": APP_KEY, "appsecret": APP_SECRET,
        "tr_id": tr_id, "custtype": "P"
    }
    for attempt in range(1, retries + 1):
        try:
            res = requests.get(url, headers=headers, params=params, timeout=15)
            res.raise_for_status()
            return res.json()
        except (requests.exceptions.ConnectionError,
                requests.exceptions.Timeout,
                requests.exceptions.ChunkedEncodingError) as e:
            if attempt < retries:
                wait = attempt * 3
                log.warning(f"[API] {tr_id} 연결 오류 (시도 {attempt}/{retries}), {wait}초 후 재시도: {e}")
                time.sleep(wait)
            else:
                log.error(f"[API] {tr_id} {retries}회 재시도 실패: {e}")
                raise


def get_daily_price(code: str, token: str, days: int = 80) -> list[dict]:
    """최근 N일 일봉 (볼린저+60일고가 계산에 80일 필요)"""
    all_data = []
    end_date = datetime.now(KST).strftime("%Y%m%d")

    # KIS API는 한 번에 최대 100개 반환 — 80일이면 충분
    data = api_get(
        "FHKST01010400",
        f"{BASE_URL}/uapi/domestic-stock/v1/quotations/inquire-daily-price",
        {"fid_cond_mrkt_div_code": "J", "fid_input_iscd": code,
         "fid_period_div_code": "D", "fid_org_adj_prc": "0"},
        token
    )
    return data.get("output", [])[:days]


def get_current_price(code: str, token: str) -> dict | None:
    """현재가 + 시가 + 누적 거래대금"""
    try:
        data = api_get(
            "FHKST01010100",
            f"{BASE_URL}/uapi/domestic-stock/v1/quotations/inquire-price",
            {"fid_cond_mrkt_div_code": "J", "fid_input_iscd": code},
            token
        )
        o = data.get("output", {})
        return {
            "price":       int(o.get("stck_prpr", 0)),
            "open":        int(o.get("stck_oprc", 0)),
            "high":        int(o.get("stck_hgpr", 0)),
            "low":         int(o.get("stck_lwpr", 0)),
            "prev_close":  int(o.get("stck_sdpr", 0)),
            "acml_tv":     int(o.get("acml_tr_pbmn", 0)),
            "acml_vol":    int(o.get("acml_vol", 0)),
            "change_rate": float(o.get("prdy_ctrt", 0)),
            "name":        o.get("hts_kor_isnm", code),
        }
    except Exception as e:
        log.warning(f"현재가 조회 실패 ({code}): {e}")
        return None


def get_volume_rank(token: str, n: int = 200) -> list[dict]:
    """거래대금 상위 종목 (스크리닝 풀)"""
    try:
        data = api_get(
            "FHPST01710000",
            f"{BASE_URL}/uapi/domestic-stock/v1/ranking/volume",
            {
                "fid_cond_mrkt_div_code": "J",
                "fid_cond_scr_div_code": "20171",
                "fid_input_iscd": "0000",
                "fid_div_cls_code": "0",
                "fid_blng_cls_code": "0",
                "fid_trgt_cls_code": "111111111",
                "fid_trgt_exls_cls_code": "000000",
                "fid_input_price_1": "3000",
                "fid_input_price_2": "0",
                "fid_vol_cnt": "0",
                "fid_input_date_1": "",
            },
            token
        )
        result = []
        for i in data.get("output", [])[:n]:
            code = i.get("stck_shrn_iscd", "")
            if not code:
                continue
            result.append({
                "code": code,
                "name": i.get("hts_kor_isnm", ""),
                "acml_tv": int(i.get("acml_tr_pbmn", 0)),
                "change_rate": float(i.get("prdy_ctrt", 0)),
                "price": int(i.get("stck_prpr", 0)),
            })
        return result
    except Exception as e:
        log.error(f"거래대금 랭킹 조회 실패: {e}")
        return []


def get_kospi_change(token: str) -> float:
    """KOSPI 당일 등락률"""
    try:
        data = api_get(
            "FHKST01010100",
            f"{BASE_URL}/uapi/domestic-stock/v1/quotations/inquire-price",
            {"fid_cond_mrkt_div_code": "U", "fid_input_iscd": "0001"},
            token
        )
        o = data.get("output", {})
        return float(o.get("prdy_ctrt", 0))
    except Exception as e:
        log.warning(f"KOSPI 등락률 조회 실패: {e}")
        return 0.0


# ── DB ──────────────────────────────────────────────
def init_db(conn: sqlite3.Connection):
    conn.execute("""
        CREATE TABLE IF NOT EXISTS trades (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            date         TEXT, code TEXT, name TEXT,
            entry_time   TEXT, exit_time TEXT,
            entry_price  INTEGER, exit_price INTEGER,
            qty          INTEGER, pnl REAL, return_pct REAL,
            result       TEXT,
            vol_ratio    REAL, candle_pos REAL, bb_break REAL
        )
    """)
    conn.commit()


def save_trade(conn: sqlite3.Connection, trade: dict):
    conn.execute("""
        INSERT INTO trades (date, code, name, entry_time, exit_time,
            entry_price, exit_price, qty, pnl, return_pct, result,
            vol_ratio, candle_pos, bb_break)
        VALUES (:date, :code, :name, :entry_time, :exit_time,
            :entry_price, :exit_price, :qty, :pnl, :return_pct, :result,
            :vol_ratio, :candle_pos, :bb_break)
    """, trade)
    conn.commit()


# ── 포트폴리오 ──────────────────────────────────────────
class ClosingPickPortfolio:
    def __init__(self, conn: sqlite3.Connection):
        self.conn = conn
        self.positions: dict[str, dict] = {}
        self.closed: list[dict] = []
        self._restore_positions()

    def _restore_positions(self):
        if not os.path.exists(STATE_PATH):
            return
        try:
            with open(STATE_PATH, encoding="utf-8") as f:
                state = json.load(f)
            saved_pos = state.get("positions", {})
            if saved_pos:
                self.positions = saved_pos
                log.info(f"[복원] {len(saved_pos)}개 포지션 복원: {list(saved_pos.keys())}")
            saved_closed = state.get("today_closed", [])
            if saved_closed:
                today = datetime.now(KST).strftime("%Y-%m-%d")
                # 오늘 청산 건만 복원
                self.closed = [c for c in saved_closed if c.get("exit_date", "") == today]
        except Exception as e:
            log.warning(f"[복원] 포지션 복원 실패: {e}")

    def get_equity(self) -> int:
        """현재 잔고"""
        if is_live_mode():
            try:
                from market import get_balance
                bal = get_balance()
                cash = bal.get("available_cash", 0)
                if cash > 0:
                    return cash
            except Exception as e:
                log.warning(f"잔고 조회 실패: {e}")
            return 0
        db_pnl = 0
        try:
            row = self.conn.execute("SELECT COALESCE(SUM(pnl), 0) FROM trades").fetchone()
            db_pnl = row[0] if row else 0
        except:
            pass
        return int(INITIAL_CAPITAL + db_pnl)

    def get_trade_capital(self) -> int:
        equity = self.get_equity()
        if not is_live_mode():
            in_use = sum(p["entry_price"] * p["qty"] for p in self.positions.values())
            equity = max(0, equity - in_use)
        slots = MAX_POSITIONS - len(self.positions)
        if slots <= 0:
            return 0
        return int(equity / slots)

    def can_enter(self) -> bool:
        return len(self.positions) < MAX_POSITIONS

    def enter(self, code: str, name: str, price: int, vol_ratio: float, candle_pos: float, bb_break: float):
        if code in self.positions:
            return
        price = int(price * (1 + SLIPPAGE))  # 매수 슬리피지
        trade_cap = self.get_trade_capital()
        if trade_cap < 50_000:
            log.warning(f"잔고 부족 (종목당 {trade_cap:,}원) — 진입 스킵")
            return
        qty = int(trade_cap / price)
        if qty < 1:
            return

        self.positions[code] = {
            "code": code, "name": name,
            "entry_time": datetime.now(KST).strftime("%H:%M:%S"),
            "entry_date": datetime.now(KST).strftime("%Y-%m-%d"),
            "entry_price": price, "qty": qty,
            "vol_ratio": vol_ratio, "candle_pos": candle_pos, "bb_break": bb_break,
        }
        mode_str = "실거래" if is_live_mode() else "모의"
        log.info(
            f"[{mode_str} 매수] {name}({code}) | 진입가: {price:,} | 수량: {qty} | "
            f"거래량: {vol_ratio:.1f}배 | 캔들: {candle_pos:.0%} | BB돌파: {bb_break:.1f}%"
        )
        if is_live_mode():
            try:
                from order import buy_market_order, get_filled_price
                result = buy_market_order(code, qty)
                if result.get("success"):
                    filled = get_filled_price(result["order_no"], code, max_wait=8)
                    if filled and filled > 0:
                        self.positions[code]["entry_price"] = filled
                        log.info(f"  → 체결가 {filled:,}원으로 갱신")
                    self.positions[code]["order_no"] = result["order_no"]
                    log.info(f"  → 실거래 매수 완료 (주문번호: {result['order_no']})")
                else:
                    log.error(f"  → 실거래 매수 실패: {result.get('error')}")
                    del self.positions[code]
                    return
            except Exception as e:
                log.error(f"  → 실거래 매수 오류: {e}")
                del self.positions[code]
                return
        self.save_state()

    def sell_all(self, token: str, conn: sqlite3.Connection):
        """전 포지션 시장가 매도 (09:01)"""
        today = datetime.now(KST).strftime("%Y-%m-%d")
        if not self.positions:
            return

        to_sell = list(self.positions.keys())
        for code in to_sell:
            pos = self.positions.pop(code)
            info = get_current_price(code, token)
            if not info or info["price"] <= 0:
                log.warning(f"매도 시 현재가 조회 실패: {pos['name']}({code})")
                exit_price = pos["entry_price"]  # fallback
            else:
                exit_price = info["price"]

            entry = pos["entry_price"]
            qty = pos["qty"]

            if not is_live_mode():
                exit_price = int(exit_price * (1 - SLIPPAGE))

            pnl = (exit_price - entry) * qty
            pnl -= int(entry * qty * COMMISSION) + int(exit_price * qty * COMMISSION)
            pnl -= int(exit_price * qty * SELL_TAX)
            ret = (exit_price / entry - 1 - SELL_TAX) * 100

            trade = {
                "date": pos.get("entry_date", today), "code": code, "name": pos["name"],
                "entry_time": pos["entry_time"],
                "entry_price": entry,
                "exit_time": datetime.now(KST).strftime("%H:%M:%S"),
                "exit_date": today,
                "exit_price": exit_price,
                "qty": qty, "pnl": round(pnl), "return_pct": round(ret, 2),
                "result": "CLOSE",
                "vol_ratio": pos.get("vol_ratio", 0),
                "candle_pos": pos.get("candle_pos", 0),
                "bb_break": pos.get("bb_break", 0),
            }

            # 실거래 매도
            if is_live_mode():
                try:
                    from order import sell_market_order, get_filled_price
                    sell_result = sell_market_order(code, qty)
                    if sell_result.get("success"):
                        filled = get_filled_price(sell_result["order_no"], code, max_wait=8)
                        if filled and filled > 0:
                            exit_price = filled
                            pnl = (exit_price - entry) * qty
                            pnl -= int(entry * qty * COMMISSION) + int(exit_price * qty * COMMISSION)
                            pnl -= int(exit_price * qty * SELL_TAX)
                            ret = (exit_price / entry - 1 - SELL_TAX) * 100
                            trade["exit_price"] = exit_price
                            trade["pnl"] = round(pnl)
                            trade["return_pct"] = round(ret, 2)
                        log.info(f"  → 실거래 매도 완료 (체결가: {exit_price:,})")
                    else:
                        log.error(f"  → 실거래 매도 실패: {sell_result.get('error')}")
                except Exception as e:
                    log.error(f"  → 실거래 매도 오류: {e}")

            self.closed.append(trade)
            save_trade(conn, trade)
            emoji = "✅" if pnl > 0 else "❌"
            log.info(
                f"{emoji} [매도] {pos['name']}({code}) | "
                f"{entry:,} → {exit_price:,} | {ret:+.2f}% | 손익: {pnl:+,.0f}원"
            )

    def status(self):
        lines = []
        if self.positions:
            lines.append(f"보유 {len(self.positions)}/{MAX_POSITIONS}")
        if self.closed:
            total_pnl = sum(t["pnl"] for t in self.closed)
            wins = sum(1 for t in self.closed if t["pnl"] > 0)
            lines.append(f"오늘 {len(self.closed)}건 {wins}승 {total_pnl:+,.0f}원")
        return " | ".join(lines) if lines else "대기 중"

    def save_state(self):
        state = {
            "updated": datetime.now(KST).strftime("%Y-%m-%d %H:%M:%S"),
            "positions": {
                code: {
                    "name": p["name"], "entry_time": p["entry_time"],
                    "entry_date": p.get("entry_date", ""),
                    "entry_price": p["entry_price"], "qty": p["qty"],
                    "vol_ratio": round(p.get("vol_ratio", 0), 1),
                    "candle_pos": round(p.get("candle_pos", 0), 3),
                    "bb_break": round(p.get("bb_break", 0), 2),
                }
                for code, p in self.positions.items()
            },
            "today_closed": self.closed[-20:],
            "today_pnl": sum(t["pnl"] for t in self.closed),
            "today_count": len(self.closed),
            "today_wins": sum(1 for t in self.closed if t["pnl"] > 0),
        }
        with open(STATE_PATH, "w", encoding="utf-8") as f:
            json.dump(state, f, ensure_ascii=False, default=str)


# ── 스크리닝 ──────────────────────────────────────────
def compute_indicators(daily: list[dict]) -> dict | None:
    """일봉 데이터로 볼린저밴드, 거래량, 캔들위치, 60일고가 계산.
    daily[0]=오늘, daily[1]=어제, ... (최신순)
    """
    if len(daily) < BB_PERIOD + HIGH_PERIOD:
        return None

    # 종가 배열 (과거→현재 순서로 뒤집기)
    closes = []
    highs = []
    lows = []
    opens = []
    volumes = []
    for d in reversed(daily):
        c = int(d.get("stck_clpr", 0))
        h = int(d.get("stck_hgpr", 0))
        l = int(d.get("stck_lwpr", 0))
        o = int(d.get("stck_oprc", 0))
        v = int(d.get("acml_vol", 0))
        if c <= 0:
            continue
        closes.append(c)
        highs.append(h)
        lows.append(l)
        opens.append(o)
        volumes.append(v)

    if len(closes) < BB_PERIOD + HIGH_PERIOD:
        return None

    closes = np.array(closes, dtype=float)
    highs = np.array(highs, dtype=float)
    lows = np.array(lows, dtype=float)
    opens = np.array(opens, dtype=float)
    volumes = np.array(volumes, dtype=float)

    today_idx = len(closes) - 1

    # 볼린저 밴드 (20일)
    bb_mid = np.mean(closes[today_idx - BB_PERIOD + 1:today_idx + 1])
    bb_std = np.std(closes[today_idx - BB_PERIOD + 1:today_idx + 1], ddof=0)
    bb_upper = bb_mid + BB_STD_MULT * bb_std

    today_close = closes[today_idx]
    today_open = opens[today_idx]
    today_high = highs[today_idx]
    today_low = lows[today_idx]
    today_vol = volumes[today_idx]

    # ① 볼린저 1.5σ 돌파
    if today_close <= bb_upper:
        return None
    bb_break = (today_close / bb_upper - 1) * 100

    # ② 거래량 5일 평균 3배
    vol_5d = np.mean(volumes[today_idx - 5:today_idx])  # 전일~5일전 평균
    if vol_5d <= 0:
        return None
    vol_ratio = today_vol / vol_5d
    if vol_ratio < VOL_MULT:
        return None

    # ③ 캔들 위치 85%
    rng = today_high - today_low
    if rng <= 0:
        return None
    candle_pos = (today_close - today_low) / rng
    if candle_pos < CANDLE_POS_MIN:
        return None

    # ④ 60일 신고가
    high_60 = np.max(highs[today_idx - HIGH_PERIOD:today_idx])  # 전일까지의 60일 고가
    if today_high <= high_60:
        return None

    # ⑤ 양봉
    if today_close <= today_open:
        return None

    # ⑥ 최소 주가
    if today_close < MIN_PRICE:
        return None

    return {
        "bb_break": bb_break,
        "vol_ratio": vol_ratio,
        "candle_pos": candle_pos,
        "today_close": int(today_close),
        "acml_tv": int(today_close * today_vol),  # 오늘 거래대금 추정
    }


def screen_candidates(token: str) -> list[dict]:
    """종가배팅 후보 스크리닝"""
    log.info("[스크리닝] 거래대금 상위 종목 조회...")
    top_stocks = get_volume_rank(token, TOP_N_STOCKS)
    log.info(f"  {len(top_stocks)}개 종목 대상")

    candidates = []
    for i, stock in enumerate(top_stocks):
        code = stock["code"]
        name = stock["name"]
        price = stock.get("price", 0)

        if price < MIN_PRICE:
            continue

        try:
            daily = get_daily_price(code, token, days=80)
            if len(daily) < BB_PERIOD + HIGH_PERIOD:
                continue

            indicators = compute_indicators(daily)
            if indicators is None:
                continue

            candidates.append({
                "code": code,
                "name": name,
                "price": indicators["today_close"],
                "vol_ratio": indicators["vol_ratio"],
                "candle_pos": indicators["candle_pos"],
                "bb_break": indicators["bb_break"],
                "acml_tv": indicators["acml_tv"],
            })
            log.info(
                f"  ✓ {name}({code}) | 가격: {indicators['today_close']:,} | "
                f"거래량: {indicators['vol_ratio']:.1f}배 | 캔들: {indicators['candle_pos']:.0%} | "
                f"BB돌파: {indicators['bb_break']:.1f}%"
            )
        except Exception as e:
            log.debug(f"  {code} 분석 실패: {e}")

        if (i + 1) % 50 == 0:
            log.info(f"  {i+1}/{len(top_stocks)} 처리 중... ({len(candidates)}건 발견)")

    # 거래대금 높은 순 정렬
    candidates.sort(key=lambda x: -x["acml_tv"])
    log.info(f"[스크리닝] 완료: {len(candidates)}건 충족")
    return candidates


# ── 유틸 ──────────────────────────────────────────────
def now_str() -> str:
    return datetime.now(KST).strftime("%H:%M")

def after(t: str) -> bool:
    return now_str() >= t

def before(t: str) -> bool:
    return now_str() < t


# ── 메인 루프 ──────────────────────────────────────────
def sleep_until_next_trading():
    """다음 거래일 08:50 KST까지 대기"""
    now = datetime.now(KST)
    tomorrow = now + timedelta(days=1)
    next_start = tomorrow.replace(hour=8, minute=50, second=0, microsecond=0)
    dow = now.weekday()
    if dow == 4:
        next_start += timedelta(days=2)
    elif dow == 5:
        next_start += timedelta(days=1)
    wait = (next_start - now).total_seconds()
    if wait > 0:
        log.info(f"다음 거래일 대기: {next_start.strftime('%Y-%m-%d %H:%M')} KST ({wait/3600:.1f}시간)")
        time.sleep(wait)


def run_day():
    """하루치 종가배팅 실행"""
    today = datetime.now(KST).strftime("%Y-%m-%d")
    dow = datetime.now(KST).weekday()

    if dow >= 5:
        log.info("주말 — 다음 거래일까지 대기")
        return True

    if not APP_KEY or not APP_SECRET:
        log.error(".env에 APP_KEY, APP_SECRET 필요")
        sys.exit(1)

    mode_str = "실거래" if is_live_mode() else "모의거래(복리)"
    log.info(f"\n{'='*55}")
    log.info(f"종가배팅봇 시작 | {today} | {mode_str}")
    log.info(f"BB {BB_PERIOD}일 {BB_STD_MULT}σ | 거래량 {VOL_MULT}배↑ | 캔들 {CANDLE_POS_MIN:.0%}↑")
    log.info(f"최대 {MAX_POSITIONS}종목 | 최소 {MIN_PRICE:,}원 | KOSPI {KOSPI_LIMIT}% 제한")
    log.info(f"{'='*55}")

    token = get_token()
    conn = sqlite3.connect(DB_PATH)
    init_db(conn)
    port = ClosingPickPortfolio(conn)
    equity = port.get_equity()
    port.start_equity = equity
    log.info(f"자본: {equity:,}원 | 종목당: {port.get_trade_capital():,}원 ({MAX_POSITIONS}분할)")

    sold_today = False
    screened = False
    candidates = []
    entered_today = False

    while True:
        current = now_str()

        # ── 09:00~09:02: 전일 매수분 매도 ──
        if after("09:00") and before("09:03") and not sold_today:
            if port.positions:
                log.info(f"[{current}] 전일 매수분 시장가 청산 ({len(port.positions)}건)")
                token = get_token()
                port.sell_all(token, conn)
                port.save_state()
            sold_today = True
            log.info(f"[{current}] 매도 완료 | {port.status()}")

        # ── 15:00: 스크리닝 데이터 수집 ──
        if after("15:00") and before("15:15") and not screened:
            log.info(f"[{current}] 스크리닝 시작")
            token = get_token()

            # KOSPI 체크
            kospi_chg = get_kospi_change(token)
            log.info(f"  KOSPI 등락률: {kospi_chg:+.2f}%")
            if kospi_chg <= KOSPI_LIMIT:
                log.info(f"  ⚠️ KOSPI {kospi_chg:.2f}% ≤ {KOSPI_LIMIT}% — 오늘 매수 안 함")
                screened = True
                candidates = []
            else:
                # 일일 손실 한도 체크
                today_pnl = sum(t["pnl"] for t in port.closed)
                if equity > 0 and today_pnl / equity <= DAILY_LOSS_LIMIT:
                    log.info(f"  ⚠️ 일일 손실 한도 ({today_pnl:+,.0f}원) — 오늘 매수 안 함")
                    screened = True
                    candidates = []
                else:
                    candidates = screen_candidates(token)
                    screened = True
                    log.info(f"[스크리닝] {len(candidates)}건 후보 발견")

        # ── 15:18~15:20: 매수 ──
        if after("15:18") and before("15:21") and not entered_today and screened:
            if candidates and port.can_enter():
                log.info(f"[{current}] 종가배팅 매수 시작")
                token = get_token()

                for cand in candidates[:MAX_POSITIONS]:
                    if not port.can_enter():
                        break
                    # 최신 현재가로 갱신
                    info = get_current_price(cand["code"], token)
                    if not info or info["price"] <= 0:
                        continue
                    port.enter(
                        cand["code"], cand["name"], info["price"],
                        cand["vol_ratio"], cand["candle_pos"], cand["bb_break"]
                    )

                log.info(f"[{current}] 매수 완료 | {port.status()}")
            else:
                log.info(f"[{current}] 매수 대상 없음")
            entered_today = True
            port.save_state()

        # ── 15:30: 일간 요약 ──
        if after("15:30"):
            log.info(f"\n{'='*55}")
            log.info("장 마감 — 일간 요약")
            if port.closed:
                total_pnl = sum(t["pnl"] for t in port.closed)
                wins = sum(1 for t in port.closed if t["pnl"] > 0)
                log.info(f"청산 {len(port.closed)}건 | 승률 {wins/len(port.closed)*100:.0f}% | 손익: {total_pnl:+,.0f}원")
                for t in port.closed:
                    log.info(f"  {t['result']:5s} {t['name']}({t['code']}) "
                             f"vol{t.get('vol_ratio',0):.1f}x | "
                             f"{t['entry_price']:,}→{t['exit_price']:,} | "
                             f"{t['return_pct']:+.2f}% | {t['pnl']:+,.0f}원")
            if port.positions:
                log.info(f"보유 {len(port.positions)}건 (익일 09:01 청산 예정)")
                for code, p in port.positions.items():
                    log.info(f"  {p['name']}({code}) | 진입: {p['entry_price']:,} | "
                             f"vol{p.get('vol_ratio',0):.1f}x")
            if not port.closed and not port.positions:
                log.info("거래 없음")
            log.info(f"{'='*55}")
            port.save_state()
            conn.close()
            return True

        time.sleep(SCAN_INTERVAL)


def main():
    """무한 루프: 매일 장 운영 → 장 마감 후 다음 거래일까지 대기"""
    log.info("종가배팅봇 — 상시 운영 모드 시작")
    while True:
        try:
            run_day()
        except Exception as e:
            log.error(f"run_day 오류: {e}", exc_info=True)
            now = datetime.now(KST)
            if now.hour >= 9 and (now.hour < 15 or (now.hour == 15 and now.minute < 30)):
                log.info("[복구] 장중 에러 — 60초 후 run_day 재시작")
                time.sleep(60)
                continue
        sleep_until_next_trading()


if __name__ == "__main__":
    main()
