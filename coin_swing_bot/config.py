"""코인 스윙봇 v5.1 설정"""
import os

# ─── API ───
UPBIT_ACCESS_KEY = os.getenv("UPBIT_ACCESS_KEY", "")
UPBIT_SECRET_KEY = os.getenv("UPBIT_SECRET_KEY", "")
PAPER_TRADING = os.getenv("PAPER_TRADING", "true").lower() == "true"

# ─── 대상 코인 ───
TARGET_COINS = ["KRW-ONT", "KRW-ONG", "KRW-ZETA", "KRW-ZBT", "KRW-ETH"]
BTC_TICKER = "KRW-BTC"

# ─── 자본 ───
INITIAL_CAPITAL = 1_000_000
MAX_POSITIONS = 3
POSITION_SIZE_RATIO = 0.45  # 포지션당 자본의 45%

# ─── 진입 조건 ───
BIG_CANDLE_MIN = 0.02      # 시가 대비 +2% 이상
BIG_CANDLE_MAX = 0.08      # 시가 대비 +8% 이하
RSI_MIN = 50               # RSI 14 > 50
VOL_SURGE = 1.5            # 거래량 20봉 평균 대비 1.5배
BTC_FILTER = True           # BTC > MA20 필터

# ─── 청산 조건 ───
SL_PCT = 0.05              # 손절 -5%
TRAIL_ACTIVATE = 0.03      # +3% 수익 시 트레일링 활성화
TRAIL_DISTANCE = 0.025     # 고점 대비 -2.5% 트레일링
TIME_STOP_HOURS = 48       # 48시간 타임스탑

# ─── 스캔 주기 ───
SCAN_INTERVAL_SEC = 3600   # 1시간마다 스캔
PRICE_CHECK_SEC = 60       # 1분마다 가격 체크 (청산 모니터링)

# ─── 대시보드 ───
DASHBOARD_PORT = 8084

# ─── DB ───
DB_PATH = "swing_bot.db"
LOG_PATH = "swing_bot.log"
