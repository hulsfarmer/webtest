"""
주식 단타 가상거래 봇 — 갭상승 전략 v1.0
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[핵심 전략]
  시가 갭업(전일 종가 대비 +2% 이상) + 거래대금 급증(5일 평균 2배)
  → 장 초반 모멘텀 매수, 당일 청산

[백테스트 근거]
  2년 251종목: 505건, 승률 65.5%, 건당 +2.55%

[타임라인]
  08:55       봇 시작, 토큰 발급
  09:00~09:10 전일 거래대금 상위 100종목 워치리스트 구성
  09:10~09:30 갭업 종목 스캔 → 조건 충족 시 가상 매수
  09:30~14:30 TP/SL 모니터링 + 추가 갭업 스캔 (5분 간격)
  14:30~15:20 신규 진입 중단, 기존 포지션만 관리
  15:20       미청산 포지션 강제 청산
  15:30       일간 요약 출력 후 종료

[진입 조건]
  ① 시가 > 전일 종가 × 1.02 (갭업 2% 이상)
  ② 누적 거래대금 > 5일 평균 × 경과시간비율 × 2.0
  ③ 절대 거래대금 > 30억원
  ④ 현재가 > 시가 (갭업 후 상승 유지)
  ⑤ 최대 동시 보유 3종목

[청산 조건]
  TP: +3.0%
  SL: -1.5%
  트레일링: +2.0% 도달 시 활성, 고점 -1.0%
  시간: 15:20 강제 청산
"""

import os
import sys
import json
import time
import sqlite3
import requests
import logging
from datetime import datetime, timedelta
from dotenv import load_dotenv

load_dotenv()

# ── 설정 ──────────────────────────────────────────────
APP_KEY    = os.getenv("APP_KEY")
APP_SECRET = os.getenv("APP_SECRET")
BASE_URL   = "https://openapi.koreainvestment.com:9443"

DB_PATH     = "./daytrade_gapup.db"
STATE_PATH  = "./daytrade_gapup_state.json"
LOG_PATH    = "./logs/daytrade_gapup.log"

INITIAL_CAPITAL = 1_000_000
TRADE_CAPITAL   = 333_000     # 종목당 투입 (100만 / 3)
MAX_POSITIONS   = 3
TP_RATE         = 0.030       # 익절 +3.0%
SL_RATE         = 0.015       # 손절 -1.5%
TRAIL_ACT       = 0.020       # 트레일링 활성 +2.0%
TRAIL_DIST      = 0.010       # 트레일링 간격 -1.0%
COMMISSION      = 0.00015     # 수수료 편도 0.015%

GAP_MIN         = 2.0         # 최소 갭업 (%)
GAP_MAX         = 15.0        # 최대 갭업 (%) — 너무 급등은 제외
TV_MULT         = 2.0         # 거래대금 배수 임계값
MIN_TV_ABS      = 3_000_000_000  # 절대 최소 거래대금 30억

SCAN_INTERVAL   = 120         # 스캔 주기 (초, 2분)
API_DELAY       = 0.35
TOKEN_FILE      = ".token_cache_gapup"

ENTRY_START     = "09:10"
ENTRY_END       = "14:30"
FORCE_EXIT      = "15:20"

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


# ── API ──────────────────────────────────────────────
def get_token() -> str:
    if os.path.exists(TOKEN_FILE):
        with open(TOKEN_FILE) as f:
            cache = json.load(f)
        if datetime.now() < datetime.strptime(cache["expires"], "%Y-%m-%d %H:%M:%S") - timedelta(minutes=10):
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


def api_get(tr_id: str, url: str, params: dict, token: str) -> dict:
    time.sleep(API_DELAY)
    headers = {
        "content-type": "application/json",
        "authorization": f"Bearer {token}",
        "appkey": APP_KEY, "appsecret": APP_SECRET,
        "tr_id": tr_id, "custtype": "P"
    }
    res = requests.get(url, headers=headers, params=params)
    res.raise_for_status()
    return res.json()


def get_daily_price(code: str, token: str, days: int = 6) -> list[dict]:
    """최근 N일 일봉"""
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
            "prev_close":  int(o.get("stck_sdpr", 0)),  # 전일 종가
            "acml_tv":     int(o.get("acml_tr_pbmn", 0)),
            "acml_vol":    int(o.get("acml_vol", 0)),
            "change_rate": float(o.get("prdy_ctrt", 0)),
            "name":        o.get("hts_kor_isnm", code),
        }
    except Exception as e:
        log.warning(f"현재가 조회 실패 ({code}): {e}")
        return None


def get_volume_rank(token: str, n: int = 100) -> list[dict]:
    """거래대금 상위 종목 조회"""
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
            })
        return result
    except Exception as e:
        log.error(f"거래대금 랭킹 조회 실패: {e}")
        return []


def get_fluctuation_top(token: str, n: int = 100) -> list[dict]:
    """등락률 상위 종목"""
    try:
        data = api_get(
            "FHPST01700000",
            f"{BASE_URL}/uapi/domestic-stock/v1/ranking/fluctuation",
            {
                "fid_cond_mrkt_div_code": "J", "fid_cond_scr_div_code": "20170",
                "fid_input_iscd": "0000", "fid_rank_sort_cls_code": "0",
                "fid_input_cnt_1": "0", "fid_prc_cls_code": "1",
                "fid_input_price_1": "3000", "fid_input_price_2": "0",
                "fid_vol_cnt": "100000",
                "fid_trgt_cls_code": "0", "fid_trgt_exls_cls_code": "0",
                "fid_div_cls_code": "0",
                "fid_rsfl_rate1": str(GAP_MIN),
                "fid_rsfl_rate2": str(GAP_MAX),
            },
            token
        )
        return [
            {"code": i.get("stck_shrn_iscd", ""), "name": i.get("hts_kor_isnm", ""),
             "change_rate": float(i.get("prdy_ctrt", 0)),
             "acml_tv": int(i.get("acml_tr_pbmn", 0))}
            for i in data.get("output", [])[:n]
            if i.get("stck_shrn_iscd", "")
        ]
    except Exception as e:
        log.error(f"등락률 랭킹 조회 실패: {e}")
        return []


# ── 워치리스트 ──────────────────────────────────────────
def build_watchlist(token: str) -> dict:
    """5일 평균 거래대금 포함 워치리스트"""
    log.info("워치리스트 구성 중...")
    candidates = get_fluctuation_top(token, 80)
    log.info(f"  등락률 상위 {len(candidates)}개 종목 스캔")

    watchlist = {}
    for i, c in enumerate(candidates):
        code = c["code"]
        try:
            daily = get_daily_price(code, token, days=6)
            past = daily[1:6]
            tvs = []
            for d in past:
                close = int(d.get("stck_clpr", 0))
                volume = int(d.get("acml_vol", 0))
                if close > 0 and volume > 0:
                    tvs.append(close * volume)
            avg_5d = sum(tvs) / len(tvs) if tvs else 0

            # 전일 종가
            prev_close = int(daily[1].get("stck_clpr", 0)) if len(daily) > 1 else 0

            if avg_5d > 0 and prev_close > 0:
                watchlist[code] = {
                    "name": c["name"],
                    "avg_5d_tv": avg_5d,
                    "prev_close": prev_close,
                }
        except Exception as e:
            log.debug(f"워치리스트 {code} 오류: {e}")
        if (i + 1) % 20 == 0:
            log.info(f"  {i+1}/{len(candidates)} 처리 중...")

    log.info(f"워치리스트 완성: {len(watchlist)}개 종목")
    return watchlist


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
            gap_pct      REAL, tv_mult REAL
        )
    """)
    conn.commit()


def save_trade(conn: sqlite3.Connection, trade: dict):
    conn.execute("""
        INSERT INTO trades (date, code, name, entry_time, exit_time,
            entry_price, exit_price, qty, pnl, return_pct, result, gap_pct, tv_mult)
        VALUES (:date, :code, :name, :entry_time, :exit_time,
            :entry_price, :exit_price, :qty, :pnl, :return_pct, :result, :gap_pct, :tv_mult)
    """, trade)
    conn.commit()


# ── 포트폴리오 ──────────────────────────────────────────
class PaperPortfolio:
    def __init__(self):
        self.positions: dict[str, dict] = {}
        self.closed: list[dict] = []

    def can_enter(self) -> bool:
        return len(self.positions) < MAX_POSITIONS

    def enter(self, code: str, name: str, price: int, gap_pct: float, tv_mult: float):
        if code in self.positions:
            return
        qty = int(TRADE_CAPITAL / price)
        if qty < 1:
            return

        self.positions[code] = {
            "code": code, "name": name,
            "entry_time": datetime.now().strftime("%H:%M:%S"),
            "entry_price": price, "qty": qty,
            "tp_price": int(price * (1 + TP_RATE)),
            "sl_price": int(price * (1 - SL_RATE)),
            "highest": price,
            "trail_active": False,
            "gap_pct": gap_pct, "tv_mult": tv_mult,
        }
        log.info(
            f"[매수] {name}({code}) | 진입가: {price:,} | 수량: {qty} | "
            f"갭: +{gap_pct:.1f}% | 거래대금: {tv_mult:.1f}배 | "
            f"TP: {int(price*(1+TP_RATE)):,} | SL: {int(price*(1-SL_RATE)):,}"
        )

    def check_exits(self, token: str, conn: sqlite3.Connection, force: bool = False):
        today = datetime.now().strftime("%Y-%m-%d")
        to_exit = []

        for code, pos in self.positions.items():
            info = get_current_price(code, token)
            if not info or info["price"] <= 0:
                continue

            price = info["price"]
            result = None
            exit_price = price

            # 최고가 갱신
            if price > pos["highest"]:
                pos["highest"] = price

            if force:
                result, exit_price = "FORCE", price
            elif price <= pos["sl_price"]:
                result, exit_price = "SL", pos["sl_price"]
            elif price >= pos["tp_price"]:
                result, exit_price = "TP", pos["tp_price"]
            else:
                # 트레일링
                gain = (pos["highest"] / pos["entry_price"] - 1)
                if gain >= TRAIL_ACT:
                    pos["trail_active"] = True

                if pos["trail_active"]:
                    trail_stop = int(pos["highest"] * (1 - TRAIL_DIST))
                    if price <= trail_stop:
                        result, exit_price = "TRAIL", trail_stop

            if result:
                to_exit.append((code, result, exit_price))

        for code, result, exit_price in to_exit:
            pos = self.positions.pop(code)
            entry = pos["entry_price"]
            qty = pos["qty"]
            pnl = (exit_price - entry) * qty
            pnl -= (entry * qty + exit_price * qty) * COMMISSION
            ret = (exit_price / entry - 1) * 100

            trade = {
                "date": today, "code": code, "name": pos["name"],
                "entry_time": pos["entry_time"],
                "entry_price": entry,
                "exit_time": datetime.now().strftime("%H:%M:%S"),
                "exit_price": exit_price,
                "qty": qty, "pnl": round(pnl), "return_pct": round(ret, 2),
                "result": result, "gap_pct": pos["gap_pct"], "tv_mult": pos["tv_mult"],
            }
            self.closed.append(trade)
            save_trade(conn, trade)

            emoji = "✅" if pnl > 0 else "❌"
            log.info(
                f"{emoji} [{result}] {pos['name']}({code}) | "
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
            "updated": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "positions": {
                code: {
                    "name": p["name"], "entry_time": p["entry_time"],
                    "entry_price": p["entry_price"], "qty": p["qty"],
                    "tp_price": p["tp_price"], "sl_price": p["sl_price"],
                    "gap_pct": p["gap_pct"], "tv_mult": round(p["tv_mult"], 1),
                    "highest": p["highest"], "trail_active": p["trail_active"],
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


# ── 유틸 ──────────────────────────────────────────────
def elapsed_ratio() -> float:
    now = datetime.now()
    start = now.replace(hour=9, minute=0, second=0, microsecond=0)
    end = now.replace(hour=15, minute=30, second=0, microsecond=0)
    total = (end - start).total_seconds()
    elapsed = (now - start).total_seconds()
    return max(0.05, min(1.0, elapsed / total))


def now_str() -> str:
    return datetime.now().strftime("%H:%M")

def after(t: str) -> bool:
    return now_str() >= t

def before(t: str) -> bool:
    return now_str() < t


# ── 메인 ──────────────────────────────────────────────
def main():
    today = datetime.now().strftime("%Y-%m-%d")
    dow = datetime.now().weekday()

    if dow >= 5:
        log.info(f"주말 — 종료")
        return

    if not APP_KEY or not APP_SECRET:
        log.error(".env에 APP_KEY, APP_SECRET 필요")
        sys.exit(1)

    log.info(f"\n{'='*55}")
    log.info(f"갭상승 단타봇 시작 | {today}")
    log.info(f"갭 +{GAP_MIN}~{GAP_MAX}% | TV {TV_MULT}배↑ | TP +{TP_RATE*100:.1f}% | SL -{SL_RATE*100:.1f}%")
    log.info(f"트레일링 +{TRAIL_ACT*100:.1f}% 활성, -{TRAIL_DIST*100:.1f}% | 최대 {MAX_POSITIONS}종목")
    log.info(f"{'='*55}")

    token = get_token()
    conn = sqlite3.connect(DB_PATH)
    init_db(conn)
    port = PaperPortfolio()
    watchlist: dict = {}
    entered_today: set = set()

    while True:
        current = now_str()

        # 장 종료
        if after("15:30"):
            log.info(f"\n{'='*55}")
            log.info("장 마감 — 일간 요약")
            if port.closed:
                total_pnl = sum(t["pnl"] for t in port.closed)
                wins = sum(1 for t in port.closed if t["pnl"] > 0)
                log.info(f"총 {len(port.closed)}건 | 승률 {wins/len(port.closed)*100:.0f}% | 손익: {total_pnl:+,.0f}원")
                for t in port.closed:
                    log.info(f"  {t['result']:5s} {t['name']}({t['code']}) 갭+{t['gap_pct']:.1f}% "
                             f"| {t['entry_price']:,}→{t['exit_price']:,} | {t['return_pct']:+.2f}% | {t['pnl']:+,.0f}원")
            else:
                log.info("거래 없음")
            log.info(f"{'='*55}")
            port.save_state()
            break

        # 09:00~: 워치리스트 구성
        if after("09:00") and not watchlist:
            token = get_token()
            watchlist = build_watchlist(token)

        # 15:20: 강제 청산
        if after(FORCE_EXIT) and port.positions:
            log.info(f"[{current}] 강제 청산")
            token = get_token()
            port.check_exits(token, conn, force=True)
            port.save_state()

        # 09:10~14:30: 스캔 + 진입 + 모니터링
        elif after(ENTRY_START) and before(ENTRY_END) and watchlist:
            token = get_token()

            # 기존 포지션 TP/SL/트레일링 체크
            if port.positions:
                port.check_exits(token, conn)

            # 신규 진입 스캔
            if port.can_enter():
                ratio = elapsed_ratio()
                log.info(f"[{current}] 스캔 | 경과: {ratio:.0%} | {port.status()}")

                # 등락률 상위 조회 (갭업 범위)
                live_top = get_fluctuation_top(token, 80)

                for item in live_top:
                    code = item["code"]
                    if code in entered_today or code in port.positions:
                        continue
                    if not port.can_enter():
                        break

                    wl = watchlist.get(code)
                    if not wl:
                        # 워치리스트에 없으면 실시간 조회
                        info = get_current_price(code, token)
                        if not info or info["price"] <= 0 or info["prev_close"] <= 0:
                            continue

                        # 간이 5일 평균 (워치리스트 미포함 종목)
                        daily = get_daily_price(code, token, 6)
                        past = daily[1:6]
                        tvs = []
                        for d in past:
                            cl = int(d.get("stck_clpr", 0))
                            vol = int(d.get("acml_vol", 0))
                            if cl > 0 and vol > 0:
                                tvs.append(cl * vol)
                        avg_5d = sum(tvs) / len(tvs) if tvs else 0
                        prev_close = info["prev_close"]
                    else:
                        avg_5d = wl["avg_5d_tv"]
                        prev_close = wl["prev_close"]
                        info = get_current_price(code, token)
                        if not info or info["price"] <= 0:
                            continue

                    price = info["price"]
                    open_price = info["open"]
                    acml_tv = info["acml_tv"]

                    # ① 갭업 체크: 시가 > 전일종가 × 1.02
                    if prev_close <= 0 or open_price <= 0:
                        continue
                    gap_pct = (open_price / prev_close - 1) * 100
                    if gap_pct < GAP_MIN or gap_pct > GAP_MAX:
                        continue

                    # ② 거래대금 체크
                    threshold = avg_5d * ratio * TV_MULT if avg_5d > 0 else 0
                    if acml_tv < threshold and acml_tv < MIN_TV_ABS:
                        continue
                    tv_mult = acml_tv / (avg_5d * ratio) if avg_5d * ratio > 0 else 0

                    # ③ 절대 거래대금
                    if acml_tv < MIN_TV_ABS:
                        continue

                    # ④ 현재가 > 시가 (갭업 후 상승 유지)
                    if price < open_price:
                        continue

                    entered_today.add(code)
                    port.enter(code, info["name"], price, gap_pct, tv_mult)

            elif port.positions:
                port.check_exits(token, conn)

            port.save_state()

        # 14:30~15:20: 포지션만 관리
        elif after(ENTRY_END) and before(FORCE_EXIT) and port.positions:
            token = get_token()
            port.check_exits(token, conn)
            port.save_state()
            log.info(f"[{current}] 진입 중단 | {port.status()}")

        time.sleep(SCAN_INTERVAL)


if __name__ == "__main__":
    main()
