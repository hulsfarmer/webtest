"""MarketSignal - News & Price Collector v2.0"""
import requests
import time
import xml.etree.ElementTree as ET
import re
from datetime import datetime
from database import get_conn, insert_news, insert_price_snapshot
from config import TOP_100_STOCKS, MAX_NEWS_PER_STOCK
from kis_helper import get_daily_ohlcv


def collect_news_google_rss(stock_name_kr, count=5):
    """Google News RSS for Korean stock news"""
    query = f"{stock_name_kr} 주식"
    url = f"https://news.google.com/rss/search?q={query}&hl=ko&gl=KR&ceid=KR:ko"
    headers = {"User-Agent": "Mozilla/5.0"}

    try:
        resp = requests.get(url, headers=headers, timeout=10)
        if resp.status_code != 200:
            return []

        root = ET.fromstring(resp.content)
        articles = []

        for item in root.findall(".//item")[:count]:
            title = item.findtext("title", "")
            link = item.findtext("link", "")
            source = item.findtext("source", "")

            title_clean = re.sub(r'\s*-\s*[^-]+$', '', title).strip()
            desc_raw = item.findtext("description", "")
            desc = re.sub(r'<[^>]+>', '', desc_raw).strip()[:200]

            articles.append({
                "title": title_clean,
                "summary": desc,
                "source": source,
                "url": link,
            })

        return articles

    except Exception as e:
        print(f"  [RSS error] {stock_name_kr}: {e}")
        return []


def collect_price_data(stock_code):
    """Collect price data from KIS API: current price, returns, RSI, volume ratio"""
    ohlcv = get_daily_ohlcv(stock_code, 30)
    if not ohlcv:
        return None

    closes = ohlcv["closes"]
    volumes = ohlcv["volumes"]

    if len(closes) < 20:
        return None

    current = closes[0]
    r1d = (closes[0] / closes[1] - 1) * 100 if closes[1] > 0 else 0
    r5d = (closes[0] / closes[5] - 1) * 100 if len(closes) > 5 and closes[5] > 0 else 0
    r20d = (closes[0] / closes[20] - 1) * 100 if len(closes) > 20 and closes[20] > 0 else 0

    rsi = _calc_rsi(closes[:15])

    avg_vol = sum(volumes[1:21]) / 20 if len(volumes) > 20 else sum(volumes[1:]) / max(len(volumes) - 1, 1)
    vol_ratio = volumes[0] / avg_vol if avg_vol > 0 else 1.0

    return {
        "price": current,
        "r1d": round(r1d, 2),
        "r5d": round(r5d, 2),
        "r20d": round(r20d, 2),
        "rsi": round(rsi, 1),
        "vol_ratio": round(vol_ratio, 2),
    }


def _calc_rsi(closes, period=14):
    """Calculate RSI from closes list (newest first)"""
    if len(closes) < period + 1:
        return 50.0

    prices = list(reversed(closes[:period + 1]))
    gains = []
    losses = []
    for i in range(1, len(prices)):
        diff = prices[i] - prices[i - 1]
        if diff > 0:
            gains.append(diff)
            losses.append(0)
        else:
            gains.append(0)
            losses.append(abs(diff))

    avg_gain = sum(gains) / period
    avg_loss = sum(losses) / period

    if avg_loss == 0:
        return 100.0
    rs = avg_gain / avg_loss
    return 100 - (100 / (1 + rs))


def collect_all_news():
    """Collect news for all 100 stocks"""
    today = datetime.now().strftime("%Y-%m-%d")
    conn = get_conn()

    for code, name_en, name_kr in TOP_100_STOCKS:
        conn.execute("""
            INSERT OR IGNORE INTO stocks (code, name_en, name_kr)
            VALUES (?, ?, ?)
        """, (code, name_en, name_kr))
    conn.commit()

    total_news = 0
    no_news_count = 0
    print(f"\n[MarketSignal] News collection started ({today})")
    print(f"  Target: {len(TOP_100_STOCKS)} stocks, max {MAX_NEWS_PER_STOCK} news each\n")

    for i, (code, name_en, name_kr) in enumerate(TOP_100_STOCKS):
        articles = collect_news_google_rss(name_kr, MAX_NEWS_PER_STOCK)

        if not articles:
            no_news_count += 1

        for art in articles:
            insert_news(
                conn, code, today,
                title=art["title"],
                summary=art.get("summary", ""),
                source=art.get("source", ""),
                url=art.get("url", ""),
            )
            total_news += 1

        if (i + 1) % 20 == 0:
            conn.commit()
            print(f"  -> {i+1}/{len(TOP_100_STOCKS)} stocks ({total_news} articles)")

        time.sleep(0.3)

    conn.commit()
    conn.close()
    print(f"\n[MarketSignal] Collection done: {total_news} articles for {len(TOP_100_STOCKS)} stocks")
    if no_news_count > 0:
        print(f"  ({no_news_count} stocks had no news)")
    return total_news


def collect_all_prices():
    """Collect price data for all 100 stocks (call after market close)"""
    today = datetime.now().strftime("%Y-%m-%d")
    conn = get_conn()
    collected = 0

    print(f"\n[MarketSignal] Price collection started ({today})")

    for i, (code, name_en, name_kr) in enumerate(TOP_100_STOCKS):
        price_data = collect_price_data(code)
        if price_data:
            insert_price_snapshot(
                conn, code, today,
                price=price_data["price"],
                r1d=price_data["r1d"],
                r5d=price_data["r5d"],
                r20d=price_data["r20d"],
                rsi=price_data["rsi"],
                vol_ratio=price_data["vol_ratio"],
            )
            collected += 1

        if (i + 1) % 20 == 0:
            conn.commit()
            print(f"  -> {i+1}/{len(TOP_100_STOCKS)} prices collected")

    conn.commit()
    conn.close()
    print(f"[MarketSignal] Price collection done: {collected}/{len(TOP_100_STOCKS)}")
    return collected


if __name__ == "__main__":
    collect_all_news()
    collect_all_prices()
