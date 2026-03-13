import os
from dotenv import load_dotenv

load_dotenv()

# KIS API 설정
APP_KEY = os.getenv("APP_KEY")
APP_SECRET = os.getenv("APP_SECRET")
ACCOUNT_NO = os.getenv("ACCOUNT_NO")
ACCOUNT_PROD = os.getenv("ACCOUNT_PROD", "01")

BASE_URL = "https://openapi.koreainvestment.com:9443"

# 투자 설정 (.env 에서 DAILY_BUDGET 지정 권장, 미지정 시 100만원)
DAILY_BUDGET = int(os.getenv("DAILY_BUDGET", "50000"))
TARGET_PROFIT_RATE = 0.025    # 목표 수익률 +2.5% (슬리피지 0.3% 감안, 실수익 +2.2%)
STOP_LOSS_RATE = 0.010        # 손절 기준 -1.0% (실손실 -1.3%, 손익비 1.7:1)
SLIPPAGE_RATE = 0.003         # 예상 슬리피지 0.3% (목표/손절 계산 시 반영)
MAX_TRADES_PER_DAY = 5
FORCE_SELL_TIME = "15:20"

# 트레일링 스톱 설정
TRAILING_TRIGGER_1 = 0.010   # 수익 1.0% 달성 시 → 손절가를 본전으로
TRAILING_STEP_1    = 0.000   # 본전 (0%)
TRAILING_TRIGGER_2 = 0.015   # 수익 1.5% 달성 시 → 손절가를 +0.5%로
TRAILING_STEP_2    = 0.005   # +0.5%

# 시장 필터
MARKET_FILTER_DROP = -1.5    # 코스피 등락률 -1.5% 이하 시 당일 매매 중단 (%)

# 급락 시 보유 포지션 대응
KOSPI_CRASH_RATE = -2.0       # 코스피 -2% 이하 시 보유 포지션 손절가 타이트닝
CRASH_STOP_LOSS_RATE = 0.005  # 급락 시 타이트닝 손절 기준 -0.5%

# 분할 매도 설정
GRADUAL_SELL_TIME = "15:15"   # 분할 매도 시작 시간
GRADUAL_SELL_RATIO = 0.5      # 1차 매도 비율 (50%)

# API 호출 간격 (TPS 제한 대응)
API_CALL_DELAY = 0.1         # 초

# 종목 스캐닝 조건
MIN_MARKET_CAP = 100_000_000_000
MIN_TRADING_VALUE = 10_000_000_000  # 당일 거래대금 100억 이상 (잡주 필터)
MIN_VOLUME = 500_000
MAX_PRICE = 500_000    # 종목당 최대 주가 (가용금액과 무관, 고정 상한)

# 텔레그램 설정
TELEGRAM_TOKEN = os.getenv("TELEGRAM_TOKEN")
TELEGRAM_CHAT_ID = os.getenv("TELEGRAM_CHAT_ID")

# 거래 시간
MARKET_OPEN = "09:30"        # 개장 직후 30분 변동성 회피
MARKET_CLOSE = "15:30"
SCAN_TIME = "08:50"
