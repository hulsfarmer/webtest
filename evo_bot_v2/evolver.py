"""진화 엔진 v2.0 — 규칙 재평가, 폐기, 신규 발견 (데이터 충분시만), 자가 업그레이드"""
import json
from datetime import datetime
from database import get_conn, get_all_rules, log_evolution
from discoverer import discover_patterns
import evo_config


def evolve():
    """
    주간 진화 프로세스:
    1. 모든 활성 규칙 재평가
    2. 성과 나쁜 규칙 폐기
    3. 신뢰도 감쇠 (오래된 규칙 자연 퇴화)
    4. 새 패턴 탐색 (10+ 신규 거래일 데이터 있을 때만)
    5. Phase 자동 승격 판단
    """
    conn = get_conn()
    print("\n" + "=" * 55)
    print("  주간 진화 프로세스 v2.0 시작")
    print("=" * 55)

    # 1. 활성 규칙 재평가
    rules = get_all_rules(conn)
    active_rules = [r for r in rules if r["status"] in ("active", "candidate")]
    retired_rules = [r for r in rules if r["status"] == "retired"]

    print(f"\n[진화] 활성: {len(active_rules)}개 | 폐기: {len(retired_rules)}개")

    promoted = 0
    demoted = 0
    retired_now = 0

    for rule in active_rules:
        rule_id = rule["id"]

        # 이 규칙으로 한 거래들의 실적
        trades = conn.execute("""
            SELECT pnl, pnl_pct FROM trades
            WHERE rule_id=? AND status='closed'
            ORDER BY sell_date DESC LIMIT 10
        """, (rule_id,)).fetchall()

        if not trades:
            # 거래 없으면 신뢰도 감쇠만
            conn.execute("""
                UPDATE rules SET confidence = confidence * ?
                WHERE id=?
            """, (evo_config.CONFIDENCE_DECAY, rule_id))
            continue

        # 실전 승률 계산
        wins = sum(1 for t in trades if t["pnl"] > 0)
        real_win_rate = wins / len(trades)

        # 원래 예상 승률과 비교
        original_win_rate = rule["win_rate"]
        diff = real_win_rate - original_win_rate

        if diff >= 0.05:
            # 예상보다 좋음 -> 신뢰도 승격
            new_confidence = min(rule["confidence"] * 1.1, 0.95)
            conn.execute("""
                UPDATE rules SET confidence=?, status='active', last_evaluated=?
                WHERE id=?
            """, (round(new_confidence, 4), datetime.now().isoformat(), rule_id))
            promoted += 1
            conds = json.loads(rule["conditions_json"])
            labels = [c[3] for c in conds]
            print(f"  UP 규칙#{rule_id} 승격: {' + '.join(labels)} "
                  f"(실전 {real_win_rate*100:.0f}% vs 예상 {original_win_rate*100:.0f}%)")

        elif diff < -0.10:
            # 예상보다 많이 나쁨 -> 신뢰도 하락
            new_confidence = rule["confidence"] * 0.8
            if new_confidence < 0.3 or rule["consecutive_fails"] >= evo_config.RULE_RETIRE_STRIKES:
                # 폐기
                conn.execute("""
                    UPDATE rules SET status='retired', confidence=?,
                                    retired_at=?, last_evaluated=?
                    WHERE id=?
                """, (round(new_confidence, 4), datetime.now().isoformat(),
                      datetime.now().isoformat(), rule_id))
                retired_now += 1
                conds = json.loads(rule["conditions_json"])
                labels = [c[3] for c in conds]
                print(f"  XX 규칙#{rule_id} 폐기: {' + '.join(labels)} "
                      f"(실전 {real_win_rate*100:.0f}% vs 예상 {original_win_rate*100:.0f}%)")
                log_evolution(conn, "RETIRE",
                             f"규칙#{rule_id} 폐기: 실전 승률 {real_win_rate*100:.0f}%",
                             {"rule_id": rule_id, "real_win_rate": real_win_rate})
            else:
                conn.execute("""
                    UPDATE rules SET confidence=?, last_evaluated=?
                    WHERE id=?
                """, (round(new_confidence, 4), datetime.now().isoformat(), rule_id))
                demoted += 1
        else:
            # 비슷 -> 신뢰도 유지, 자연 감쇠만
            conn.execute("""
                UPDATE rules SET confidence = confidence * ?,
                                last_evaluated=?
                WHERE id=?
            """, (evo_config.CONFIDENCE_DECAY, datetime.now().isoformat(), rule_id))

    conn.commit()

    print(f"\n[진화] 결과: 승격 {promoted} | 강등 {demoted} | 폐기 {retired_now}")

    # 2. 전체 성과 요약
    total_stats = conn.execute("""
        SELECT COUNT(*) as cnt,
               SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END) as wins,
               COALESCE(SUM(pnl), 0) as total_pnl,
               COALESCE(AVG(pnl_pct), 0) as avg_pnl_pct
        FROM trades WHERE status='closed'
    """).fetchone()

    if total_stats["cnt"] > 0:
        overall_wr = (total_stats["wins"] or 0) / total_stats["cnt"]
        print(f"\n[성과] 전체: {total_stats['cnt']}거래 | "
              f"승률 {overall_wr*100:.0f}% | "
              f"총PnL {total_stats['total_pnl']:+,}원 | "
              f"평균 {total_stats['avg_pnl_pct']:+.2f}%")

    # 3. 새 패턴 탐색 (v2: 신규 데이터 충분시만)
    remaining_active = conn.execute(
        "SELECT COUNT(*) as cnt FROM rules WHERE status IN ('active','candidate')"
    ).fetchone()["cnt"]

    should_discover = False
    if remaining_active < evo_config.MAX_ACTIVE_RULES:
        # v2: 마지막 발견 이후 신규 거래일 데이터가 충분한지 확인
        min_new_days = getattr(evo_config, 'MIN_NEW_DAYS_FOR_DISCOVERY', 10)
        should_discover = _check_new_data_available(conn, min_new_days)

        if should_discover:
            print(f"\n[진화] 활성 규칙 {remaining_active}개 + 신규 데이터 충분 -> 새 패턴 탐색...")
            discover_patterns()
        else:
            print(f"\n[진화] 활성 규칙 {remaining_active}개이나 신규 데이터 부족 -> 탐색 스킵")
    else:
        print(f"\n[진화] 활성 규칙 충분 ({remaining_active}개) -- 탐색 스킵")

    # 4. Phase 자동 승격 판단
    _check_phase_upgrade(conn, total_stats)

    # 5. 진화 로그
    log_evolution(conn, "EVOLVE",
                 f"주간 진화 v2.0 완료: 승격 {promoted}, 강등 {demoted}, 폐기 {retired_now}",
                 {"promoted": promoted, "demoted": demoted, "retired": retired_now,
                  "discovery_triggered": should_discover})
    conn.commit()
    conn.close()

    print("\n" + "=" * 55)
    print("  주간 진화 v2.0 완료!")
    print("=" * 55)


def _check_new_data_available(conn, min_new_days):
    """마지막 발견 이후 신규 거래일 데이터가 min_new_days 이상인지 확인"""
    # 마지막 DISCOVER 이벤트 날짜
    last_discover = conn.execute("""
        SELECT date FROM evolution_log
        WHERE event_type='DISCOVER'
        ORDER BY date DESC LIMIT 1
    """).fetchone()

    if not last_discover:
        # 발견 이력 없음 -> 무조건 실행
        return True

    last_date_str = last_discover["date"]
    # ISO format에서 날짜 부분만 추출
    try:
        last_dt = datetime.fromisoformat(last_date_str)
        last_date_ymd = last_dt.strftime("%Y%m%d")
    except:
        return True

    # 마지막 발견 이후 새로 추가된 거래일 수 (any stock)
    new_days = conn.execute("""
        SELECT COUNT(DISTINCT date) as cnt FROM daily_prices
        WHERE date > ?
    """, (last_date_ymd,)).fetchone()["cnt"]

    print(f"[진화] 마지막 발견: {last_date_ymd}, 이후 신규 거래일: {new_days}일 (최소 {min_new_days}일 필요)")
    return new_days >= min_new_days


def _check_phase_upgrade(conn, stats):
    """Phase 자동 승격 판단"""
    if not stats or stats["cnt"] < 10:
        return

    win_rate = (stats["wins"] or 0) / stats["cnt"]
    avg_pnl = stats["avg_pnl_pct"]

    current = evo_config.CURRENT_PHASE

    # Phase 승격 조건: 10거래 이상 + 승률 55% + 평균수익 양수
    if current == 1 and win_rate >= 0.55 and avg_pnl > 0:
        print(f"\n[Phase] Phase 2 승격 조건 충족! (승률 {win_rate*100:.0f}%, 평균 {avg_pnl:+.2f}%)")
        print("  -> 다음 주부터 외국인/기관 수급 데이터 추가 수집 시작")
        log_evolution(conn, "PHASE_UP",
                     f"Phase 1->2 승격 조건 충족: 승률 {win_rate*100:.0f}%",
                     {"win_rate": win_rate, "avg_pnl": avg_pnl})
    elif current == 2 and win_rate >= 0.55 and avg_pnl > 0.5:
        print(f"\n[Phase] Phase 3 승격 조건 충족!")
        log_evolution(conn, "PHASE_UP", "Phase 2->3 승격 조건 충족")
    elif current == 3 and win_rate >= 0.55 and avg_pnl > 0.5:
        print(f"\n[Phase] Phase 4 승격 조건 충족!")
        log_evolution(conn, "PHASE_UP", "Phase 3->4 승격 조건 충족")


if __name__ == "__main__":
    evolve()
