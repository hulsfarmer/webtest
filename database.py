"""MarketSignal - Database Schema v2.0 (price-aware scoring)"""
import sqlite3
import json
from datetime import datetime
from config import DB_PATH


def get_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def init_db():
    conn = get_conn()
    c = conn.cursor()

    # Stock master
    c.execute("""
        CREATE TABLE IF NOT EXISTS stocks (
            code TEXT PRIMARY KEY,
            name_en TEXT,
            name_kr TEXT,
            sector TEXT DEFAULT ''
        )
    """)

    # Daily news collected
    c.execute("""
        CREATE TABLE IF NOT EXISTS news (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            stock_code TEXT NOT NULL,
            date TEXT NOT NULL,
            title TEXT NOT NULL,
            summary TEXT DEFAULT '',
            source TEXT DEFAULT '',
            url TEXT DEFAULT '',
            sentiment TEXT DEFAULT 'neutral',
            sentiment_score REAL DEFAULT 0,
            category TEXT DEFAULT '',
            collected_at TEXT,
            UNIQUE(stock_code, date, title)
        )
    """)

    # Daily scores
    c.execute("""
        CREATE TABLE IF NOT EXISTS scores (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            stock_code TEXT NOT NULL,
            date TEXT NOT NULL,
            score INTEGER DEFAULT 50,
            prev_score INTEGER DEFAULT 50,
            score_change INTEGER DEFAULT 0,
            positive_count INTEGER DEFAULT 0,
            negative_count INTEGER DEFAULT 0,
            neutral_count INTEGER DEFAULT 0,
            key_news TEXT DEFAULT '',
            ai_comment TEXT DEFAULT '',
            warning_label TEXT DEFAULT '',
            raw_score INTEGER DEFAULT 0,
            penalty INTEGER DEFAULT 0,
            created_at TEXT,
            UNIQUE(stock_code, date)
        )
    """)

    # Validation (score vs actual price change)
    c.execute("""
        CREATE TABLE IF NOT EXISTS validations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            stock_code TEXT NOT NULL,
            score_date TEXT NOT NULL,
            score INTEGER,
            next_day_change REAL,
            next_day_close REAL,
            is_correct INTEGER DEFAULT 0,
            validated_at TEXT,
            UNIQUE(stock_code, score_date)
        )
    """)

    # Category weights (self-improving)
    c.execute("""
        CREATE TABLE IF NOT EXISTS category_weights (
            category TEXT PRIMARY KEY,
            weight REAL DEFAULT 1.0,
            sample_count INTEGER DEFAULT 0,
            accuracy REAL DEFAULT 0.5,
            updated_at TEXT
        )
    """)

    # Daily accuracy log
    c.execute("""
        CREATE TABLE IF NOT EXISTS accuracy_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            date TEXT NOT NULL UNIQUE,
            total_scored INTEGER DEFAULT 0,
            correct_count INTEGER DEFAULT 0,
            accuracy REAL DEFAULT 0,
            top10_correct INTEGER DEFAULT 0,
            top10_accuracy REAL DEFAULT 0,
            notes TEXT DEFAULT ''
        )
    """)

    # Price snapshots (v2.0) - daily price data for context
    c.execute("""
        CREATE TABLE IF NOT EXISTS price_snapshots (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            stock_code TEXT NOT NULL,
            date TEXT NOT NULL,
            current_price INTEGER DEFAULT 0,
            change_rate_1d REAL DEFAULT 0,
            change_rate_5d REAL DEFAULT 0,
            change_rate_20d REAL DEFAULT 0,
            rsi_14 REAL DEFAULT 50,
            volume_ratio REAL DEFAULT 1.0,
            collected_at TEXT,
            UNIQUE(stock_code, date)
        )
    """)

    # Indexes
    c.execute("CREATE INDEX IF NOT EXISTS idx_news_date ON news(date)")
    c.execute("CREATE INDEX IF NOT EXISTS idx_news_stock ON news(stock_code)")
    c.execute("CREATE INDEX IF NOT EXISTS idx_scores_date ON scores(date)")
    c.execute("CREATE INDEX IF NOT EXISTS idx_scores_stock ON scores(stock_code)")
    c.execute("CREATE INDEX IF NOT EXISTS idx_val_date ON validations(score_date)")
    c.execute("CREATE INDEX IF NOT EXISTS idx_price_snap ON price_snapshots(stock_code, date)")

    # Migration: add new columns to existing tables
    _migrate(conn)

    conn.commit()
    conn.close()
    print("[DB] MarketSignal database initialized (v2.0)")


def _migrate(conn):
    """Add new columns if they don't exist"""
    try:
        conn.execute("ALTER TABLE scores ADD COLUMN warning_label TEXT DEFAULT ''")
    except Exception:
        pass
    try:
        conn.execute("ALTER TABLE scores ADD COLUMN raw_score INTEGER DEFAULT 0")
    except Exception:
        pass
    try:
        conn.execute("ALTER TABLE scores ADD COLUMN penalty INTEGER DEFAULT 0")
    except Exception:
        pass


def insert_news(conn, stock_code, date, title, summary="", source="", url="",
                sentiment="neutral", sentiment_score=0, category=""):
    try:
        conn.execute("""
            INSERT OR IGNORE INTO news
            (stock_code, date, title, summary, source, url, sentiment,
             sentiment_score, category, collected_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (stock_code, date, title, summary, source, url,
              sentiment, sentiment_score, category, datetime.now().isoformat()))
    except Exception:
        pass


def insert_score(conn, stock_code, date, score, prev_score, pos, neg, neu,
                 key_news="", ai_comment="", warning_label="", raw_score=0, penalty=0):
    conn.execute("""
        INSERT OR REPLACE INTO scores
        (stock_code, date, score, prev_score, score_change,
         positive_count, negative_count, neutral_count,
         key_news, ai_comment, warning_label, raw_score, penalty, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (stock_code, date, score, prev_score, score - prev_score,
          pos, neg, neu, key_news, ai_comment, warning_label, raw_score, penalty,
          datetime.now().isoformat()))


def insert_price_snapshot(conn, stock_code, date, price, r1d, r5d, r20d, rsi, vol_ratio):
    conn.execute("""
        INSERT OR REPLACE INTO price_snapshots
        (stock_code, date, current_price, change_rate_1d, change_rate_5d,
         change_rate_20d, rsi_14, volume_ratio, collected_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (stock_code, date, price, r1d, r5d, r20d, rsi, vol_ratio,
          datetime.now().isoformat()))


def get_price_snapshot(conn, stock_code, date):
    row = conn.execute("""
        SELECT * FROM price_snapshots
        WHERE stock_code = ? AND date = ?
    """, (stock_code, date)).fetchone()
    return dict(row) if row else None


def get_scores_by_date(conn, date):
    rows = conn.execute("""
        SELECT s.*, st.name_kr FROM scores s
        JOIN stocks st ON s.stock_code = st.code
        WHERE s.date = ?
        ORDER BY s.score DESC
    """, (date,)).fetchall()
    return [dict(r) for r in rows]


def get_prev_score(conn, stock_code, date):
    row = conn.execute("""
        SELECT score FROM scores
        WHERE stock_code = ? AND date < ?
        ORDER BY date DESC LIMIT 1
    """, (stock_code, date)).fetchone()
    return row["score"] if row else 50


def get_category_weights(conn):
    rows = conn.execute("SELECT * FROM category_weights").fetchall()
    return {r["category"]: r["weight"] for r in rows}


def get_accuracy_history(conn, limit=30):
    rows = conn.execute("""
        SELECT * FROM accuracy_log ORDER BY date DESC LIMIT ?
    """, (limit,)).fetchall()
    return [dict(r) for r in reversed(rows)]


if __name__ == "__main__":
    init_db()
