"""MarketSignal - Score Validator v2.0"""
import json
import time
from datetime import datetime, timedelta
from database import get_conn
from config import TOP_100_STOCKS
from kis_helper import get_stock_price_data


def validate_yesterday_scores():
    """Compare yesterday's scores with today's actual price changes"""
    conn = get_conn()

    # Check if it's a weekday (skip weekends)
    if datetime.now().weekday() >= 5:
        print("[Validator] Weekend - skipping validation")
        conn.close()
        return

    # Find most recent scored date
    yesterday = None
    for days_back in range(1, 5):
        check_date = (datetime.now() - timedelta(days=days_back)).strftime("%Y-%m-%d")
        count = conn.execute(
            "SELECT COUNT(*) as c FROM scores WHERE date = ?", (check_date,)
        ).fetchone()["c"]
        if count > 0:
            yesterday = check_date
            break

    if not yesterday:
        print("[Validator] No previous scores to validate")
        conn.close()
        return

    scores = conn.execute(
        "SELECT stock_code, score FROM scores WHERE date = ?", (yesterday,)
    ).fetchall()

    print(f"\n[Validator] Validating scores from {yesterday}")

    correct = 0
    total = 0
    top10_correct = 0
    top10_total = 0

    scores_list = sorted([(s["stock_code"], s["score"]) for s in scores],
                         key=lambda x: -x[1])

    for idx, (code, score) in enumerate(scores_list):
        price_data = get_stock_price_data(code)
        if not price_data:
            continue

        change_rate = price_data["change_rate"]
        predicted_up = score >= 55
        actual_up = change_rate > 0
        is_correct = 1 if predicted_up == actual_up else 0

        conn.execute("""
            INSERT OR REPLACE INTO validations
            (stock_code, score_date, score, next_day_change, next_day_close, is_correct, validated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        """, (code, yesterday, score, change_rate, price_data["price"],
              is_correct, datetime.now().isoformat()))

        total += 1
        correct += is_correct

        if idx < 10:
            top10_total += 1
            top10_correct += is_correct

    accuracy = correct / total if total > 0 else 0
    top10_acc = top10_correct / top10_total if top10_total > 0 else 0

    conn.execute("""
        INSERT OR REPLACE INTO accuracy_log
        (date, total_scored, correct_count, accuracy, top10_correct, top10_accuracy)
        VALUES (?, ?, ?, ?, ?, ?)
    """, (yesterday, total, correct, round(accuracy, 4),
          top10_correct, round(top10_acc, 4)))

    conn.commit()
    print(f"  Total: {correct}/{total} ({accuracy*100:.1f}%)")
    print(f"  Top10: {top10_correct}/{top10_total} ({top10_acc*100:.1f}%)")

    _update_category_weights(conn, yesterday)

    conn.close()
    return accuracy


def _update_category_weights(conn, score_date):
    """Update category weights based on prediction accuracy"""
    scores_with_cats = conn.execute("""
        SELECT s.stock_code, s.score, v.is_correct, n.category
        FROM scores s
        JOIN validations v ON s.stock_code = v.stock_code AND s.date = v.score_date
        JOIN news n ON s.stock_code = n.stock_code AND s.date = n.date
        WHERE s.date = ? AND n.category != ''
    """, (score_date,)).fetchall()

    cat_stats = {}
    for row in scores_with_cats:
        cat = row["category"]
        if cat not in cat_stats:
            cat_stats[cat] = {"correct": 0, "total": 0}
        cat_stats[cat]["total"] += 1
        cat_stats[cat]["correct"] += row["is_correct"]

    for cat, stats in cat_stats.items():
        if stats["total"] >= 3:
            accuracy = stats["correct"] / stats["total"]
            new_weight = 0.5 + accuracy * 1.5
            conn.execute("""
                UPDATE category_weights
                SET weight = ?, accuracy = ?, sample_count = sample_count + ?,
                    updated_at = ?
                WHERE category = ?
            """, (round(new_weight, 3), round(accuracy, 4), stats["total"],
                  datetime.now().isoformat(), cat))

    conn.commit()
    print(f"  Category weights updated: {len(cat_stats)} categories")


if __name__ == "__main__":
    validate_yesterday_scores()
