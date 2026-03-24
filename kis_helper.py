"""MarketSignal - KIS API Helper (standalone, reads token from kis_trader)"""
import json
import os
import time
import requests
from datetime import datetime, timedelta

# Read KIS credentials from kis_trader .env
_TOKEN_CACHE = os.path.expanduser("~/kis_trader/.token_cache")
_KIS_ENV = os.path.expanduser("~/kis_trader/.env")
_BASE_URL = "https://openapi.koreainvestment.com:9443"
_APP_KEY = None
_APP_SECRET = None
_ACCESS_TOKEN = None
_TOKEN_EXPIRES = None


def _load_env():
    """Load APP_KEY and APP_SECRET from kis_trader .env"""
    global _APP_KEY, _APP_SECRET
    if _APP_KEY and _APP_SECRET:
        return True

    try:
        with open(_KIS_ENV, "r") as f:
            for line in f:
                line = line.strip()
                if line.startswith("APP_KEY="):
                    _APP_KEY = line.split("=", 1)[1].strip().strip('"').strip("'")
                elif line.startswith("APP_SECRET="):
                    _APP_SECRET = line.split("=", 1)[1].strip().strip('"').strip("'")
        return _APP_KEY is not None and _APP_SECRET is not None
    except Exception as e:
        print(f"[KIS] Failed to load .env: {e}")
        return False


def _get_token():
    """Get access token (from cache or generate new)"""
    global _ACCESS_TOKEN, _TOKEN_EXPIRES

    # Try cached token
    if _ACCESS_TOKEN and _TOKEN_EXPIRES and datetime.now() < _TOKEN_EXPIRES:
        return _ACCESS_TOKEN

    # Try file cache
    try:
        with open(_TOKEN_CACHE, "r") as f:
            cache = json.load(f)
        expire_dt = datetime.strptime(cache["expires"], "%Y-%m-%d %H:%M:%S")
        if datetime.now() < expire_dt - timedelta(minutes=10):
            _ACCESS_TOKEN = cache["token"]
            _TOKEN_EXPIRES = expire_dt
            return _ACCESS_TOKEN
    except Exception:
        pass

    # Generate new token
    if not _load_env():
        return None

    try:
        resp = requests.post(
            f"{_BASE_URL}/oauth2/tokenP",
            headers={"content-type": "application/json"},
            json={
                "grant_type": "client_credentials",
                "appkey": _APP_KEY,
                "appsecret": _APP_SECRET,
            },
            timeout=10,
        )
        data = resp.json()
        _ACCESS_TOKEN = data["access_token"]
        expires_str = data.get("access_token_token_expired", "")
        _TOKEN_EXPIRES = datetime.strptime(expires_str, "%Y-%m-%d %H:%M:%S")

        # Save to cache
        with open(_TOKEN_CACHE, "w") as f:
            json.dump({"token": _ACCESS_TOKEN, "expires": expires_str}, f)

        print(f"[KIS] New token obtained (expires: {expires_str})")
        return _ACCESS_TOKEN
    except Exception as e:
        print(f"[KIS] Token generation failed: {e}")
        return None


def _get_headers(tr_id):
    """Build KIS API headers"""
    token = _get_token()
    if not token:
        return None
    if not _load_env():
        return None

    return {
        "Content-Type": "application/json; charset=utf-8",
        "authorization": f"Bearer {token}",
        "appkey": _APP_KEY,
        "appsecret": _APP_SECRET,
        "tr_id": tr_id,
    }


def get_stock_price_data(stock_code):
    """Get current price from KIS API"""
    headers = _get_headers("FHKST01010100")
    if not headers:
        return None

    try:
        params = {
            "FID_COND_MRKT_DIV_CODE": "J",
            "FID_INPUT_ISCD": stock_code,
        }
        time.sleep(0.15)
        resp = requests.get(
            f"{_BASE_URL}/uapi/domestic-stock/v1/quotations/inquire-price",
            headers=headers, params=params, timeout=10,
        )
        if resp.status_code == 200:
            data = resp.json()
            if data.get("rt_cd") == "0":
                out = data["output"]
                return {
                    "price": int(out["stck_prpr"]),
                    "change_rate": float(out["prdy_ctrt"]),
                }
            else:
                print(f"  [KIS] {stock_code}: {data.get('msg1', 'unknown error')}")
    except Exception as e:
        print(f"  [KIS price error] {stock_code}: {e}")
    return None


def get_daily_ohlcv(stock_code, count=30):
    """Get daily OHLCV data from KIS API (newest first)"""
    headers = _get_headers("FHKST01010400")
    if not headers:
        return None

    try:
        params = {
            "FID_COND_MRKT_DIV_CODE": "J",
            "FID_INPUT_ISCD": stock_code,
            "FID_PERIOD_DIV_CODE": "D",
            "FID_ORG_ADJ_PRC": "0",
        }
        time.sleep(0.15)
        resp = requests.get(
            f"{_BASE_URL}/uapi/domestic-stock/v1/quotations/inquire-daily-price",
            headers=headers, params=params, timeout=10,
        )
        if resp.status_code != 200:
            return None

        data = resp.json()
        if data.get("rt_cd") != "0":
            print(f"  [KIS] {stock_code}: {data.get('msg1', '')}")
            return None

        records = data.get("output", [])
        if len(records) < 20:
            return None

        closes = []
        volumes = []
        for r in records[:count]:
            c = int(r.get("stck_clpr", 0))
            v = int(r.get("acml_vol", 0))
            if c > 0:
                closes.append(c)
                volumes.append(v)

        return {"closes": closes, "volumes": volumes}

    except Exception as e:
        print(f"  [KIS ohlcv error] {stock_code}: {e}")
    return None
