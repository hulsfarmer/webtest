"""MarketSignal - Configuration"""
import os
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), '.env'))

# API Keys
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
NAVER_CLIENT_ID = os.getenv("NAVER_CLIENT_ID", "")
NAVER_CLIENT_SECRET = os.getenv("NAVER_CLIENT_SECRET", "")

# Paths
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "data", "marketsignal.db")
BLOG_DIR = os.path.join(BASE_DIR, "blog")
POSTS_DIR = os.path.join(BLOG_DIR, "posts")

# Settings
MAX_NEWS_PER_STOCK = 5
TOP_DETAIL_COUNT = 10
TOTAL_STOCKS = 100

# Schedule (KST, server is UTC so -9)
COLLECT_HOUR_UTC = 7      # KST 16:00
VALIDATE_HOUR_UTC = 0     # KST 09:00
PUBLISH_HOUR_UTC = 8      # KST 17:00

# Top 100 Korean Stocks (KOSPI market cap order, 2026)
TOP_100_STOCKS = [
    ("005930", "Samsung Electronics", "삼성전자"),
    ("000660", "SK Hynix", "SK하이닉스"),
    ("373220", "LG Energy Solution", "LG에너지솔루션"),
    ("207940", "Samsung Biologics", "삼성바이오로직스"),
    ("005380", "Hyundai Motor", "현대차"),
    ("000270", "Kia", "기아"),
    ("006400", "Samsung SDI", "삼성SDI"),
    ("051910", "LG Chem", "LG화학"),
    ("035420", "NAVER", "NAVER"),
    ("005490", "POSCO Holdings", "POSCO홀딩스"),
    ("055550", "Shinhan Financial", "신한지주"),
    ("105560", "KB Financial", "KB금융"),
    ("035720", "Kakao", "카카오"),
    ("003670", "POSCO Future M", "포스코퓨처엠"),
    ("068270", "Celltrion", "셀트리온"),
    ("028260", "Samsung C&T", "삼성물산"),
    ("012330", "Hyundai Mobis", "현대모비스"),
    ("066570", "LG Electronics", "LG전자"),
    ("003550", "LG", "LG"),
    ("096770", "SK Innovation", "SK이노베이션"),
    ("034730", "SK Inc", "SK"),
    ("030200", "KT", "KT"),
    ("032830", "Samsung Life", "삼성생명"),
    ("086790", "Hana Financial", "하나금융지주"),
    ("015760", "Korea Electric Power", "한국전력"),
    ("017670", "SK Telecom", "SK텔레콤"),
    ("316140", "Woori Financial", "우리금융지주"),
    ("009150", "Samsung Electro-Mechanics", "삼성전기"),
    ("018260", "Samsung SDS", "삼성SDS"),
    ("010130", "Korea Zinc", "고려아연"),
    ("033780", "KT&G", "KT&G"),
    ("034020", "Doosan Enerbility", "두산에너빌리티"),
    ("011200", "HMM", "HMM"),
    ("003490", "Korean Air", "대한항공"),
    ("024110", "Industrial Bank of Korea", "기업은행"),
    ("259960", "Krafton", "크래프톤"),
    ("010950", "S-Oil", "S-Oil"),
    ("267250", "HD Hyundai", "HD현대"),
    ("009540", "HD Korea Shipbuilding", "HD한국조선해양"),
    ("000810", "Samsung Fire & Marine", "삼성화재"),
    ("329180", "HD Hyundai Heavy", "HD현대중공업"),
    ("036570", "NCsoft", "엔씨소프트"),
    ("011170", "Lotte Chemical", "롯데케미칼"),
    ("047050", "Daewoo Engineering", "포스코인터내셔널"),
    ("138040", "Meritz Financial", "메리츠금융지주"),
    ("352820", "Hive", "하이브"),
    ("010140", "Samsung Heavy Industries", "삼성중공업"),
    ("090430", "Amore Pacific", "아모레퍼시픽"),
    ("051900", "LG H&H", "LG생활건강"),
    ("180640", "Hanmi Semiconductor", "한미반도체"),
    ("247540", "Ecopro BM", "에코프로비엠"),
    ("377300", "Ecopro", "에코프로"),
    ("006800", "Mirae Asset Securities", "미래에셋증권"),
    ("004020", "Hyundai Steel", "현대제철"),
    ("032640", "LG Uplus", "LG유플러스"),
    ("326030", "SK Biopharm", "SK바이오팜"),
    ("003410", "Ssangyong C&E", "쌍용C&E"),
    ("009830", "Hanwha Solutions", "한화솔루션"),
    ("011790", "SKC", "SKC"),
    ("161390", "Hankook Tire", "한국타이어앤테크놀로지"),
    ("302440", "SK Bioscience", "SK바이오사이언스"),
    ("004170", "Shinsegae", "신세계"),
    ("021240", "Coway", "코웨이"),
    ("022100", "Poongsan", "포스코DX"),
    ("000720", "Hyundai Engineering", "현대건설"),
    ("007070", "GS Retail", "GS리테일"),
    ("016360", "Samsung Securities", "삼성증권"),
    ("078930", "GS", "GS"),
    ("036460", "Korea Gas", "한국가스공사"),
    ("128940", "Hanmi Pharm", "한미약품"),
    ("271560", "Orion", "오리온"),
    ("000880", "Hanwha", "한화"),
    ("272210", "Hanwha Systems", "한화시스템"),
    ("042700", "Hanmi Science", "한미사이언스"),
    ("004990", "Lotte Corp", "롯데지주"),
    ("006260", "LS", "LS"),
    ("002790", "Amorepacific Group", "아모레G"),
    ("139480", "E-Mart", "이마트"),
    ("383220", "F&F", "F&F"),
    ("361610", "SK IE Technology", "SK아이이테크놀로지"),
    ("011070", "LG Innotek", "LG이노텍"),
    ("005830", "DB Insurance", "DB손해보험"),
    ("097950", "CJ CheilJedang", "CJ제일제당"),
    ("034220", "LG Display", "LG디스플레이"),
    ("028050", "Samsung Engineering", "삼성엔지니어링"),
    ("307950", "Hyundai Oilbank", "현대오일뱅크"),
    ("069500", "KODEX 200", "KODEX200"),
    ("251270", "Netmarble", "넷마블"),
    ("088350", "Hanwha Life", "한화생명"),
    ("052690", "Hanon Systems", "한온시스템"),
    ("000100", "Yuhan", "유한양행"),
    ("001040", "CJ", "CJ"),
    ("241560", "Doosan Bobcat", "두산밥캣"),
    ("029780", "Samsung Card", "삼성카드"),
    ("005940", "NH Investment", "NH투자증권"),
    ("002380", "KCC", "KCC"),
    ("006360", "GS Engineering", "GS건설"),
    ("018880", "Hanon Systems", "한온시스템"),
    ("020150", "Ilsung Pharma", "일성신약"),
    ("003240", "Taekwang Industrial", "태광산업"),
]
