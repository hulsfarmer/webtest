"""코인 변동성 돌파봇 설정"""
import os

# ─── API ───
UPBIT_ACCESS_KEY = os.getenv("UPBIT_ACCESS_KEY", "")
UPBIT_SECRET_KEY = os.getenv("UPBIT_SECRET_KEY", "")
PAPER_TRADING = os.getenv("PAPER_TRADING", "true").lower() == "true"

# ─── 대상 코인 ───
TARGET_COINS = ["KRW-BTC", "KRW-ETH", "KRW-XRP", "KRW-SOL", "KRW-DOGE"]
BTC_TICKER = "KRW-BTC"

# ─── 전략 파라미터 ───
K_VALUE = 0.4              # 돌파 계수 (전일 변동폭 × k)
BTC_MA_PERIOD = 5          # BTC 추세 필터 MA 기간 (일봉)
MAX_POSITIONS = 3          # 동시 최대 포지션
POSITION_SIZE_RATIO = 0.35 # 포지션당 자본의 35% (3포지션 = 105%, 약간 오버랩)

# ─── 자본 ───
INITIAL_CAPITAL = 1_000_000

# ─── 청산 ───
# 기본: 다음 날 00:00 KST에 시가 매도
# 손절: -3% 즉시 청산
SL_PCT = 0.03

# ─── 스캔 주기 ───
SCAN_INTERVAL_SEC = 300    # 5분마다 돌파 체크
SELL_HOUR_KST = 0          # 매도 시각 (KST 00시 = 새 일봉 시작)

# ─── DB ───
DB_PATH = "vb_bot.db"
LOG_PATH = "vb_bot.log"
