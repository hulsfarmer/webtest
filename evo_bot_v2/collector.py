"""데이터 수집기 v2.0 — KIS API로 시장 데이터 수집 (500일 페이지네이션 지원)"""
import sys
import os
import time
import requests
from datetime import datetime, timedelta

# 부모 디렉토리(kis_trader)의 모듈 import
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from auth import get_headers
from config import BASE_URL

sys.path.insert(0, os.path.dirname(__file__))

from database import (
    get_conn, insert_daily_price, insert_index_daily,
    insert_stock, insert_features, log_evolution,
)
from feature_engine import compute_features
import evo_config


API_DELAY = getattr(evo_config, 'API_DELAY', 0.2)


def get_top_stocks(count=100):
    """시가총액 상위 + 등락률 상위 종목 조합으로 대상 종목 수집"""
    stocks = {}

    # 1. 대형주 고정 목록 (시총 상위 50)
    BLUE_CHIPS = [
        ("005930", "삼성전자"), ("000660", "SK하이닉스"), ("373220", "LG에너지솔루션"),
        ("005380", "현대차"), ("000270", "기아"), ("068270", "셀트리온"),
        ("005490", "POSCO홀딩스"), ("035420", "NAVER"), ("035720", "카카오"),
        ("051910", "LG화학"), ("006400", "삼성SDI"), ("028260", "삼성물산"),
        ("105560", "KB금융"), ("055550", "신한지주"), ("003670", "포스코퓨처엠"),
        ("012330", "현대모비스"), ("066570", "LG전자"), ("032830", "삼성생명"),
        ("003550", "LG"), ("034730", "SK"), ("096770", "SK이노베이션"),
        ("030200", "KT"), ("017670", "SK텔레콤"), ("086790", "하나금융지주"),
        ("015760", "한국전력"), ("009150", "삼성전기"), ("010130", "고려아연"),
        ("034020", "두산에너빌리티"), ("011170", "롯데케미칼"), ("018260", "삼성에스디에스"),
        ("033780", "KT&G"), ("036570", "엔씨소프트"), ("316140", "우리금융지주"),
        ("000810", "삼성화재"), ("024110", "HMM"), ("009540", "한국조선해양"),
        ("010950", "S-Oil"), ("047050", "포스코인터내셔널"), ("003490", "대한항공"),
        ("011200", "HMM"), ("352820", "하이브"), ("259960", "크래프톤"),
        ("302440", "SK바이오사이언스"), ("207940", "삼성바이오로직스"),
        ("180640", "한진칼"), ("326030", "SK바이오팜"), ("247540", "에코프로비엠"),
        ("086520", "에코프로"), ("042700", "한미반도체"), ("377300", "카카오페이"),
    ]
    for code, name in BLUE_CHIPS:
        stocks[code] = {"code": code, "name": name}

    # 2. 등락률 상위 종목 추가 (활발히 거래되는 종목)
    headers = get_headers("FHPST01700000")
    url = f"{BASE_URL}/uapi/domestic-stock/v1/ranking/fluctuation"
    params = {
        "fid_cond_mrkt_div_code": "J",
        "fid_cond_scr_div_code": "20170",
        "fid_input_iscd": "0000",
        "fid_rank_sort_cls_code": "0",
        "fid_input_cnt_1": "0",
        "fid_prc_cls_code": "1",
        "fid_input_price_1": "5000",
        "fid_input_price_2": "500000",
        "fid_vol_cnt": "100000",
        "fid_trgt_cls_code": "0",
        "fid_trgt_exls_cls_code": "0",
        "fid_div_cls_code": "0",
        "fid_rsfl_rate1": "",
        "fid_rsfl_rate2": "",
    }
    try:
        time.sleep(API_DELAY)
        res = requests.get(url, headers=headers, params=params)
        data = res.json().get("output", [])
        for d in data[:50]:
            code = d.get("stck_shrn_iscd", "")
            name = d.get("hts_kor_isnm", "")
            if code and name and code not in stocks:
                stocks[code] = {"code": code, "name": name}
    except Exception as e:
        print(f"[수집] 등락률 종목 오류: {e}")

    result = list(stocks.values())[:count]
    print(f"[수집] 종목 {len(result)}개 확보 (대형주 {len(BLUE_CHIPS)} + 등락률 상위)")
    return result


def get_fluctuation_stocks():
    """등락률 상위 종목 (상승 종목)"""
    headers = get_headers("FHPST01700000")
    url = f"{BASE_URL}/uapi/domestic-stock/v1/ranking/fluctuation"
    params = {
        "fid_cond_mrkt_div_code": "J",
        "fid_cond_scr_div_code": "20170",
        "fid_input_iscd": "0000",
        "fid_rank_sort_cls_code": "0",
        "fid_input_cnt_1": "0",
        "fid_prc_cls_code": "0",
        "fid_input_price_1": "0",
        "fid_input_price_2": "0",
        "fid_vol_cnt": "0",
        "fid_trgt_cls_code": "0",
        "fid_trgt_exls_cls_code": "0",
        "fid_div_cls_code": "0",
        "fid_rsfl_rate1": "",
        "fid_rsfl_rate2": "",
    }
    try:
        time.sleep(API_DELAY)
        res = requests.get(url, headers=headers, params=params)
        data = res.json().get("output", [])
        stocks = []
        for d in data:
            code = d.get("stck_shrn_iscd", "")
            name = d.get("hts_kor_isnm", "")
            if code and name:
                stocks.append({"code": code, "name": name})
        return stocks
    except Exception as e:
        print(f"[수집] 등락률 종목 오류: {e}")
        return []


def _get_last_collected_date(conn, stock_code):
    """DB에서 해당 종목의 마지막 수집 날짜 조회"""
    row = conn.execute("""
        SELECT MAX(date) as last_date FROM daily_prices WHERE stock_code=?
    """, (stock_code,)).fetchone()
    if row and row["last_date"]:
        return row["last_date"]
    return None


def fetch_daily_ohlcv(stock_code, count=100):
    """종목 일봉 데이터 조회 — 기간지정 API로 100일 이상 수집 (페이지네이션)"""
    all_rows = []

    # 100일 이하면 단일 호출
    if count <= 100:
        return _fetch_daily_chunk(stock_code, count)

    # 100일 초과: 페이지네이션 (100일씩 분할)
    today = datetime.now()
    remaining = count
    current_end = today

    while remaining > 0:
        chunk_size = min(remaining, 100)
        # 날짜 범위 계산 (거래일 기준 약 1.6배)
        start_date = (current_end - timedelta(days=int(chunk_size * 1.6))).strftime("%Y%m%d")
        end_date = current_end.strftime("%Y%m%d")

        chunk = _fetch_daily_range(stock_code, start_date, end_date, chunk_size)
        if not chunk:
            break

        all_rows = chunk + all_rows  # prepend (older data first)

        # 다음 구간: 마지막으로 받은 데이터의 전날부터
        oldest_date = chunk[0]["date"]
        try:
            current_end = datetime.strptime(oldest_date, "%Y%m%d") - timedelta(days=1)
        except:
            break

        remaining -= len(chunk)
        time.sleep(API_DELAY)

    # 중복 제거 (날짜 기준)
    seen = set()
    deduped = []
    for row in all_rows:
        if row["date"] not in seen:
            seen.add(row["date"])
            deduped.append(row)

    return deduped


def _fetch_daily_range(stock_code, start_date, end_date, max_rows=100):
    """특정 기간의 일봉 데이터 조회"""
    headers = get_headers("FHKST03010100")
    url = f"{BASE_URL}/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice"
    params = {
        "FID_COND_MRKT_DIV_CODE": "J",
        "FID_INPUT_ISCD": stock_code,
        "FID_INPUT_DATE_1": start_date,
        "FID_INPUT_DATE_2": end_date,
        "FID_PERIOD_DIV_CODE": "D",
        "FID_ORG_ADJ_PRC": "0",
    }
    try:
        time.sleep(API_DELAY)
        res = requests.get(url, headers=headers, params=params)
        data = res.json().get("output2", [])
        if not data:
            return []
        rows = []
        for d in data[:max_rows]:
            row = {
                "date": d.get("stck_bsop_date", ""),
                "open": int(d.get("stck_oprc", 0)),
                "high": int(d.get("stck_hgpr", 0)),
                "low": int(d.get("stck_lwpr", 0)),
                "close": int(d.get("stck_clpr", 0)),
                "volume": int(d.get("acml_vol", 0)),
                "trading_value": int(d.get("acml_tr_pbmn", 0) or 0),
            }
            if row["close"] > 0 and row["date"]:
                rows.append(row)
        rows.reverse()  # 오래된 순
        return rows
    except Exception as e:
        print(f"[수집] 기간지정 일봉 오류 ({stock_code}, {start_date}~{end_date}): {e}")
        return []


def _fetch_daily_chunk(stock_code, count=100):
    """단일 API 호출로 일봉 데이터 조회 (100일 이하)"""
    headers = get_headers("FHKST03010100")
    url = f"{BASE_URL}/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice"
    end_date = datetime.now().strftime("%Y%m%d")
    start_date = (datetime.now() - timedelta(days=int(count * 1.6))).strftime("%Y%m%d")
    params = {
        "FID_COND_MRKT_DIV_CODE": "J",
        "FID_INPUT_ISCD": stock_code,
        "FID_INPUT_DATE_1": start_date,
        "FID_INPUT_DATE_2": end_date,
        "FID_PERIOD_DIV_CODE": "D",
        "FID_ORG_ADJ_PRC": "0",
    }
    try:
        time.sleep(API_DELAY)
        res = requests.get(url, headers=headers, params=params)
        data = res.json().get("output2", [])
        if not data:
            return _fetch_daily_fallback(stock_code, count)
        rows = []
        for d in data[:count]:
            row = {
                "date": d.get("stck_bsop_date", ""),
                "open": int(d.get("stck_oprc", 0)),
                "high": int(d.get("stck_hgpr", 0)),
                "low": int(d.get("stck_lwpr", 0)),
                "close": int(d.get("stck_clpr", 0)),
                "volume": int(d.get("acml_vol", 0)),
                "trading_value": int(d.get("acml_tr_pbmn", 0) or 0),
            }
            if row["close"] > 0 and row["date"]:
                rows.append(row)
        rows.reverse()
        return rows
    except Exception as e:
        print(f"[수집] 기간지정 일봉 오류 ({stock_code}): {e}")
        return _fetch_daily_fallback(stock_code, count)


def _fetch_daily_fallback(stock_code, count=100):
    """일봉 fallback — 기본 일봉 API"""
    headers = get_headers("FHKST01010400")
    url = f"{BASE_URL}/uapi/domestic-stock/v1/quotations/inquire-daily-price"
    params = {
        "fid_cond_mrkt_div_code": "J",
        "fid_input_iscd": stock_code,
        "fid_period_div_code": "D",
        "fid_org_adj_prc": "0",
    }
    try:
        time.sleep(API_DELAY)
        res = requests.get(url, headers=headers, params=params)
        data = res.json().get("output", [])
        rows = []
        for d in data[:count]:
            rows.append({
                "date": d.get("stck_bsop_date", ""),
                "open": int(d.get("stck_oprc", 0)),
                "high": int(d.get("stck_hgpr", 0)),
                "low": int(d.get("stck_lwpr", 0)),
                "close": int(d.get("stck_clpr", 0)),
                "volume": int(d.get("acml_vol", 0)),
                "trading_value": int(d.get("acml_tr_pbmn", 0) or 0),
            })
        return [r for r in rows if r["close"] > 0]
    except Exception as e:
        print(f"[수집] 일봉 fallback 오류 ({stock_code}): {e}")
        return []


def fetch_kospi_daily(days=100):
    """코스피 지수 일봉 조회 — 페이지네이션 지원"""
    if days <= 100:
        return _fetch_index_chunk("0001", days)

    all_rows = []
    today = datetime.now()
    remaining = days
    current_end = today

    while remaining > 0:
        chunk_size = min(remaining, 100)
        start_date = (current_end - timedelta(days=int(chunk_size * 1.6))).strftime("%Y%m%d")
        end_date = current_end.strftime("%Y%m%d")

        chunk = _fetch_index_range("0001", start_date, end_date, chunk_size)
        if not chunk:
            break

        all_rows = chunk + all_rows
        oldest_date = chunk[0]["date"]
        try:
            current_end = datetime.strptime(oldest_date, "%Y%m%d") - timedelta(days=1)
        except:
            break
        remaining -= len(chunk)
        time.sleep(API_DELAY)

    seen = set()
    deduped = []
    for row in all_rows:
        if row["date"] not in seen:
            seen.add(row["date"])
            deduped.append(row)
    return deduped


def fetch_kosdaq_daily(days=100):
    """코스닥 지수 일봉 조회 — 페이지네이션 지원"""
    if days <= 100:
        return _fetch_index_chunk("1001", days)

    all_rows = []
    today = datetime.now()
    remaining = days
    current_end = today

    while remaining > 0:
        chunk_size = min(remaining, 100)
        start_date = (current_end - timedelta(days=int(chunk_size * 1.6))).strftime("%Y%m%d")
        end_date = current_end.strftime("%Y%m%d")

        chunk = _fetch_index_range("1001", start_date, end_date, chunk_size)
        if not chunk:
            break

        all_rows = chunk + all_rows
        oldest_date = chunk[0]["date"]
        try:
            current_end = datetime.strptime(oldest_date, "%Y%m%d") - timedelta(days=1)
        except:
            break
        remaining -= len(chunk)
        time.sleep(API_DELAY)

    seen = set()
    deduped = []
    for row in all_rows:
        if row["date"] not in seen:
            seen.add(row["date"])
            deduped.append(row)
    return deduped


def _fetch_index_chunk(index_code, days):
    """지수 데이터 단일 호출"""
    headers = get_headers("FHKUP03500100")
    url = f"{BASE_URL}/uapi/domestic-stock/v1/quotations/inquire-daily-indexchartprice"
    end_date = datetime.now().strftime("%Y%m%d")
    start_date = (datetime.now() - timedelta(days=days + 30)).strftime("%Y%m%d")
    params = {
        "FID_COND_MRKT_DIV_CODE": "U",
        "FID_INPUT_ISCD": index_code,
        "FID_INPUT_DATE_1": start_date,
        "FID_INPUT_DATE_2": end_date,
        "FID_PERIOD_DIV_CODE": "D",
    }
    try:
        time.sleep(API_DELAY)
        res = requests.get(url, headers=headers, params=params)
        data = res.json().get("output2", [])
        rows = []
        for d in data[:days]:
            close_val = float(d.get("bstp_nmix_prpr", 0))
            change = float(d.get("bstp_nmix_prdy_ctrt", 0))
            date_str = d.get("stck_bsop_date", "")
            if close_val > 0 and date_str:
                rows.append({
                    "date": date_str,
                    "close": close_val,
                    "change_pct": change,
                })
        rows.reverse()
        return rows
    except Exception as e:
        print(f"[수집] 지수 오류 ({index_code}): {e}")
        return []


def _fetch_index_range(index_code, start_date, end_date, max_rows=100):
    """지수 데이터 특정 기간 호출"""
    headers = get_headers("FHKUP03500100")
    url = f"{BASE_URL}/uapi/domestic-stock/v1/quotations/inquire-daily-indexchartprice"
    params = {
        "FID_COND_MRKT_DIV_CODE": "U",
        "FID_INPUT_ISCD": index_code,
        "FID_INPUT_DATE_1": start_date,
        "FID_INPUT_DATE_2": end_date,
        "FID_PERIOD_DIV_CODE": "D",
    }
    try:
        time.sleep(API_DELAY)
        res = requests.get(url, headers=headers, params=params)
        data = res.json().get("output2", [])
        rows = []
        for d in data[:max_rows]:
            close_val = float(d.get("bstp_nmix_prpr", 0))
            change = float(d.get("bstp_nmix_prdy_ctrt", 0))
            date_str = d.get("stck_bsop_date", "")
            if close_val > 0 and date_str:
                rows.append({
                    "date": date_str,
                    "close": close_val,
                    "change_pct": change,
                })
        rows.reverse()
        return rows
    except Exception as e:
        print(f"[수집] 지수 기간 오류 ({index_code}, {start_date}~{end_date}): {e}")
        return []


def collect_historical_data():
    """기존 데이터를 500일로 확장 — 증분 수집 (v2 신규)"""
    print("=" * 50)
    print("  v2.0: 과거 데이터 확장 수집 (→500일)")
    print("=" * 50)

    conn = get_conn()

    # 1. 코스피/코스닥 지수 확장
    print("\n[1/3] 코스피/코스닥 지수 확장...")
    kospi = fetch_kospi_daily(evo_config.HISTORY_DAYS)
    for row in kospi:
        insert_index_daily(conn, "KOSPI", row["date"], row["close"], row["change_pct"])
    print(f"  -> 코스피 {len(kospi)}일 저장")

    kosdaq = fetch_kosdaq_daily(evo_config.HISTORY_DAYS)
    for row in kosdaq:
        insert_index_daily(conn, "KOSDAQ", row["date"], row["close"], row["change_pct"])
    print(f"  -> 코스닥 {len(kosdaq)}일 저장")
    conn.commit()

    # 2. 종목 목록
    print("\n[2/3] 종목 목록 확인...")
    stocks = get_top_stocks(evo_config.MAX_STOCKS)
    for s in stocks:
        insert_stock(conn, s["code"], s["name"])
    conn.commit()

    # 3. 각 종목 증분 수집
    print(f"\n[3/3] 종목별 증분 수집 ({len(stocks)}개)...")
    for i, s in enumerate(stocks):
        code = s["code"]
        last_date = _get_last_collected_date(conn, code)

        if last_date:
            # DB에 데이터 있음 — 현재 보유 일수 확인
            existing_count = conn.execute(
                "SELECT COUNT(*) as cnt FROM daily_prices WHERE stock_code=?", (code,)
            ).fetchone()["cnt"]

            if existing_count >= evo_config.HISTORY_DAYS * 0.8:
                # 이미 충분 — 최근 데이터만 업데이트
                ohlcv = _fetch_daily_chunk(code, 10)
            else:
                # 부족 — 전체 500일 수집
                ohlcv = fetch_daily_ohlcv(code, evo_config.HISTORY_DAYS)
        else:
            # 신규 종목 — 전체 수집
            ohlcv = fetch_daily_ohlcv(code, evo_config.HISTORY_DAYS)

        for row in ohlcv:
            insert_daily_price(conn, code, row["date"],
                             row["open"], row["high"], row["low"],
                             row["close"], row["volume"], row.get("trading_value", 0))

        if (i + 1) % 10 == 0:
            conn.commit()
            print(f"  -> {i+1}/{len(stocks)} 완료 ({s['name']}, {len(ohlcv)}일)")

    conn.commit()

    # 4. 피처 재계산
    print("\n[bonus] 피처 재계산...")
    compute_all_features(conn, stocks)

    log_evolution(conn, "HIST_COLLECT", f"과거 데이터 확장 완료: {len(stocks)}종목, 목표 {evo_config.HISTORY_DAYS}일")
    conn.commit()
    conn.close()

    print("\n" + "=" * 50)
    print("  과거 데이터 확장 수집 완료!")
    print("=" * 50)


def collect_initial_data():
    """초기 데이터 수집 — 최초 1회 실행"""
    print("=" * 50)
    print("  자가진화 봇: 초기 데이터 수집 시작")
    print("=" * 50)

    conn = get_conn()

    # 1. 코스피/코스닥 지수
    print("\n[1/3] 코스피 지수 수집...")
    kospi = fetch_kospi_daily(evo_config.HISTORY_DAYS)
    for row in kospi:
        insert_index_daily(conn, "KOSPI", row["date"], row["close"], row["change_pct"])
    print(f"  -> 코스피 {len(kospi)}일 저장")

    kosdaq = fetch_kosdaq_daily(evo_config.HISTORY_DAYS)
    for row in kosdaq:
        insert_index_daily(conn, "KOSDAQ", row["date"], row["close"], row["change_pct"])
    print(f"  -> 코스닥 {len(kosdaq)}일 저장")

    # 2. 종목 목록 수집
    print("\n[2/3] 종목 목록 수집...")
    stocks = get_top_stocks(evo_config.MAX_STOCKS)
    for s in stocks:
        insert_stock(conn, s["code"], s["name"])
    conn.commit()
    print(f"  -> {len(stocks)}개 종목 등록")

    # 3. 각 종목 일봉 데이터
    print(f"\n[3/3] 일봉 데이터 수집 ({len(stocks)}개 종목)...")
    for i, s in enumerate(stocks):
        ohlcv = fetch_daily_ohlcv(s["code"], evo_config.HISTORY_DAYS)
        for row in ohlcv:
            insert_daily_price(conn, s["code"], row["date"],
                             row["open"], row["high"], row["low"],
                             row["close"], row["volume"], row.get("trading_value", 0))
        if (i + 1) % 10 == 0:
            conn.commit()
            print(f"  -> {i+1}/{len(stocks)} 완료 ({s['name']})")

    conn.commit()

    # 4. 피처 계산
    print("\n[bonus] 피처 계산...")
    compute_all_features(conn, stocks)

    log_evolution(conn, "INIT", f"초기 데이터 수집 완료: {len(stocks)}종목, {len(kospi)}일")
    conn.commit()
    conn.close()

    print("\n" + "=" * 50)
    print("  초기 데이터 수집 완료!")
    print("=" * 50)


def collect_daily():
    """매일 장 마감 후 실행 — 당일 데이터 수집"""
    print(f"\n[{datetime.now().strftime('%Y-%m-%d %H:%M')}] 일일 데이터 수집 시작...")
    conn = get_conn()

    # 코스피/코스닥
    kospi = fetch_kospi_daily(5)
    for row in kospi:
        insert_index_daily(conn, "KOSPI", row["date"], row["close"], row["change_pct"])

    kosdaq = fetch_kosdaq_daily(5)
    for row in kosdaq:
        insert_index_daily(conn, "KOSDAQ", row["date"], row["close"], row["change_pct"])

    # 종목 목록 갱신
    stocks = get_top_stocks(evo_config.MAX_STOCKS)
    for s in stocks:
        insert_stock(conn, s["code"], s["name"])

    # 각 종목 최근 5일 일봉
    for i, s in enumerate(stocks):
        ohlcv = fetch_daily_ohlcv(s["code"], 5)
        for row in ohlcv:
            insert_daily_price(conn, s["code"], row["date"],
                             row["open"], row["high"], row["low"],
                             row["close"], row["volume"], row.get("trading_value", 0))
        if (i + 1) % 20 == 0:
            conn.commit()

    # 피처 계산
    compute_all_features(conn, stocks)

    log_evolution(conn, "COLLECT", f"일일 수집 완료: {len(stocks)}종목")
    conn.commit()
    conn.close()
    print(f"[수집] 완료: {len(stocks)}종목 업데이트")


def compute_all_features(conn, stocks):
    """전 종목 피처 계산"""
    count = 0
    for s in stocks:
        code = s["code"] if isinstance(s, dict) else s
        rows = conn.execute("""
            SELECT * FROM daily_prices WHERE stock_code=?
            ORDER BY date ASC
        """, (code,)).fetchall()
        if len(rows) < 21:
            continue

        # 코스피 데이터
        kospi_rows = conn.execute("""
            SELECT date, close, change_pct FROM index_daily
            WHERE index_code='KOSPI' ORDER BY date ASC
        """).fetchall()
        kospi_map = {r["date"]: {"close": r["close"], "change_pct": r["change_pct"]} for r in kospi_rows}

        prices = [dict(r) for r in rows]
        features_list = compute_features(prices, kospi_map)

        for feat in features_list:
            insert_features(conn, code, feat["date"], feat["features"])
            count += 1

    if count > 0:
        conn.commit()
        print(f"  -> {count}개 피처 레코드 저장")


if __name__ == "__main__":
    import sys
    if len(sys.argv) > 1 and sys.argv[1] == "--extend":
        collect_historical_data()
    else:
        collect_initial_data()
