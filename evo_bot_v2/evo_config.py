"""자가진화 트레이딩 봇 설정 v2.0"""
import os

# ── 봇 기본 설정 ──
INITIAL_CAPITAL = 1_000_000       # 초기 자본 (가상)
PAPER_TRADING = True              # 가상거래 모드

# ── 데이터 수집 ──
MAX_STOCKS = 100                  # 수집 대상 종목 수
HISTORY_DAYS = 500                # 초기 수집 일봉 수 (v2: 100→500)
DAILY_COLLECT_TIME = "15:40"      # 매일 수집 시각

# ── 패턴 발견 ──
MIN_SAMPLE_COUNT = 50             # 최소 검증 횟수 - 2조건 (v2: 20→50)
MIN_SAMPLE_COUNT_3 = 30           # 최소 검증 횟수 - 3조건 (v2 신규)
MIN_WIN_RATE = 0.55               # 최소 승률 55%
MIN_EXPECTED_VALUE = 0.5          # 최소 기대값 (%)
HOLDING_DAYS = [3, 5, 7, 10]     # 보유 기간 후보 (일)
TARGET_RETURN = 0.03              # 목표 수익률 3%
MAX_COMBO_SIZE = 3                # 최대 조건 조합 수
TRADE_COST = 0.0025              # 왕복 수수료+세금 0.25% (v2 신규)
DIVERSITY_MAX_PCT = 0.50         # 단일 조건 최대 비율 50% (v2 신규)

# ── 진화 ──
EVOLUTION_DAY = "saturday"        # 매주 진화 실행 요일
MAX_ACTIVE_RULES = 20             # 최대 활성 규칙 수
RULE_RETIRE_STRIKES = 3           # 연속 실패 시 폐기
CONFIDENCE_DECAY = 0.95           # 매주 신뢰도 감쇠 (오래된 규칙 자연 퇴화)
MIN_NEW_DAYS_FOR_DISCOVERY = 10   # 재발견 최소 신규 데이터 일수 (v2 신규)

# ── 트레이딩 ──
MAX_POSITIONS = 2                 # 동시 보유 종목 수
POSITION_SIZE_PCT = 0.45          # 포지션 크기 (자본의 45%)
STOP_LOSS_PCT = 0.05              # 손절 -5%
TRAILING_STOP_PCT = 0.05          # 트레일링 고점 -5%

# ── API ──
API_DELAY = 0.2                   # KIS API 호출 간격 (v2: 0.12→0.2)

# ── 대시보드 ──
DASHBOARD_PORT = 8080
DASHBOARD_HOST = "0.0.0.0"

# ── 파일 경로 ──
DB_PATH = os.path.join(os.path.dirname(__file__), "evo_bot.db")
LOG_PATH = os.path.join(os.path.dirname(__file__), "evo_bot.log")

# ── Phase 관리 ──
# Phase 1: 가격 + 거래량 + 코스피 지수
# Phase 2: + 외국인/기관 수급
# Phase 3: + PER, PBR, 시총
# Phase 4: + 업종 지수, 환율
CURRENT_PHASE = 1
