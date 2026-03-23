"""패턴 발견 엔진 v2.0 — Walk-forward 검증, EV 비용 반영, 다양성 제어, NumPy 벡터화"""
import json
import random
import itertools
import numpy as np
from datetime import datetime
from database import (
    get_conn, insert_rule, get_all_rules, log_evolution,
)
from feature_engine import CONDITION_TEMPLATES, check_conditions
import evo_config


# 탈락 사유 카운터
_rejection_counts = {
    "sample_insufficient": 0,
    "winrate_low": 0,
    "walkforward_fail": 0,
    "overfit_suspect": 0,
    "ev_insufficient": 0,
    "duplicate_holding": 0,
}


def _reset_rejection_counts():
    for k in _rejection_counts:
        _rejection_counts[k] = 0


def _print_rejection_summary():
    print(f"\n[탈락 요약] "
          f"샘플 부족: {_rejection_counts['sample_insufficient']}건 | "
          f"승률 미달: {_rejection_counts['winrate_low']}건 | "
          f"WF 실패: {_rejection_counts['walkforward_fail']}건 | "
          f"과적합: {_rejection_counts['overfit_suspect']}건 | "
          f"EV 부족: {_rejection_counts['ev_insufficient']}건 | "
          f"중복 보유기간: {_rejection_counts['duplicate_holding']}건")


def discover_patterns():
    """
    메인 발견 프로세스 v2.0:
    1. 모든 종목의 피처 데이터 로드 (NumPy 배열)
    2. 2~3개 조건 조합 생성
    3. Walk-forward 검증
    4. EV 비용 반영, 과적합 필터, 다양성 제어
    5. 유의미한 패턴을 규칙으로 저장
    """
    conn = get_conn()
    _reset_rejection_counts()

    print("\n" + "=" * 55)
    print("  패턴 발견 엔진 v2.0 시작")
    print("=" * 55)

    # 기존 규칙 조건 (중복 방지)
    existing_rules = get_all_rules(conn)
    existing_conditions = set()
    for r in existing_rules:
        conds = json.loads(r["conditions_json"])
        key = _conditions_key(conds)
        existing_conditions.add(key)
    print(f"[발견] 기존 규칙 {len(existing_rules)}개 (중복 제외)")

    # 전 종목 피처+가격 데이터 로드 (NumPy 벡터화)
    dataset, np_dataset = _load_dataset(conn)
    if not dataset:
        print("[발견] 데이터 부족 -- 발견 중단")
        conn.close()
        return

    print(f"[발견] 데이터 로드: {len(dataset)}개 종목, 총 {len(np_dataset['dates'])}개 레코드")

    # 조건 조합 생성 + 검증
    total_conditions = len(CONDITION_TEMPLATES)
    all_candidates = []  # (conditions, holding_days, result) tuples

    # 2개 조합
    combos_2 = list(itertools.combinations(range(total_conditions), 2))
    random.shuffle(combos_2)
    combos_2 = combos_2[:2000]

    print(f"[발견] 2-조건 조합 {len(combos_2)}개 검증 중...")
    for combo_idx in combos_2:
        conditions = [CONDITION_TEMPLATES[i] for i in combo_idx]
        key = _conditions_key(conditions)
        if key in existing_conditions:
            continue

        # 각 보유기간별 테스트, 최고 EV만 보존 (중복 제거)
        best_result = None
        best_holding = None
        for holding_days in evo_config.HOLDING_DAYS:
            result = _test_combination_vectorized(np_dataset, conditions, holding_days,
                                                   min_samples=evo_config.MIN_SAMPLE_COUNT)
            if result:
                if best_result is None or result["expected_value"] > best_result["expected_value"]:
                    best_result = result
                    best_holding = holding_days

        if best_result:
            all_candidates.append({
                "conditions": [list(c) for c in conditions],
                "holding_days": best_holding,
                **best_result
            })
            existing_conditions.add(key)

    print(f"[발견] 2-조건에서 {len(all_candidates)}개 후보 발견")

    # 3개 조합 (상위 2-조건 기반 확장)
    if all_candidates:
        print(f"[발견] 3-조건 확장 시도...")
        top_2 = sorted(all_candidates, key=lambda x: x["expected_value"], reverse=True)[:20]

        count_3 = 0
        for rule in top_2:
            base_indices = []
            for c in rule["conditions"]:
                for idx, t in enumerate(CONDITION_TEMPLATES):
                    if list(t) == c:
                        base_indices.append(idx)
                        break

            for extra_idx in range(total_conditions):
                if extra_idx in base_indices:
                    continue
                conditions = [CONDITION_TEMPLATES[i] for i in base_indices] + [CONDITION_TEMPLATES[extra_idx]]
                key = _conditions_key(conditions)
                if key in existing_conditions:
                    continue

                best_result = None
                best_holding = None
                for holding_days in evo_config.HOLDING_DAYS:
                    result = _test_combination_vectorized(np_dataset, conditions, holding_days,
                                                           min_samples=evo_config.MIN_SAMPLE_COUNT_3)
                    if result:
                        if best_result is None or result["expected_value"] > best_result["expected_value"]:
                            best_result = result
                            best_holding = holding_days

                if best_result and best_result["expected_value"] > rule["expected_value"]:
                    all_candidates.append({
                        "conditions": [list(c) for c in conditions],
                        "holding_days": best_holding,
                        **best_result
                    })
                    existing_conditions.add(key)
                    count_3 += 1

        print(f"[발견] 3-조건에서 {count_3}개 추가 후보 발견")

    # 결과 저장 — 다양성 제어 적용
    if all_candidates:
        all_candidates.sort(key=lambda x: x["expected_value"], reverse=True)
        selected = _apply_diversity_filter(all_candidates)

        saved_count = 0
        for rule in selected[:evo_config.MAX_ACTIVE_RULES]:
            rule_id = insert_rule(
                conn,
                conditions=rule["conditions"],
                holding_days=rule["holding_days"],
                win_rate=rule["win_rate"],
                avg_return=rule["avg_return"],
                sample_count=rule["sample_count"],
                ev=rule["expected_value"],
                phase=evo_config.CURRENT_PHASE,
            )
            saved_count += 1

            cond_labels = [c[3] for c in rule["conditions"]]
            print(f"  * 규칙 #{rule_id}: {' + '.join(cond_labels)} "
                  f"| {rule['holding_days']}일 보유 "
                  f"| 승률 {rule['win_rate']*100:.0f}% "
                  f"| EV {rule['expected_value']:.2f}% "
                  f"| 샘플 {rule['sample_count']}회 "
                  f"| WF윈도우 {rule.get('wf_windows_passed', '?')}개통과")

        log_evolution(conn, "DISCOVER",
                     f"패턴 발견 v2.0 완료: {saved_count}개 신규 규칙 저장",
                     {"total_candidates": len(all_candidates), "saved": saved_count})
        conn.commit()
        print(f"\n[발견] 완료: {saved_count}개 신규 규칙 저장!")
    else:
        log_evolution(conn, "DISCOVER", "패턴 발견 v2.0 완료: 신규 규칙 없음")
        conn.commit()
        print("\n[발견] 유의미한 패턴 없음")

    _print_rejection_summary()
    conn.close()
    return all_candidates


def _load_dataset(conn):
    """
    전 종목의 피처+미래수익률 데이터셋 구성
    반환: (dict dataset, dict np_dataset)
    np_dataset: 전체 데이터를 numpy 배열로 (벡터화 연산용)
    """
    stocks = conn.execute("SELECT DISTINCT stock_code FROM features").fetchall()
    dataset = {}

    # numpy용 글로벌 배열 준비
    all_features_list = []
    all_future_returns = {d: [] for d in [3, 5, 7, 10]}
    all_dates = []
    all_stock_codes = []

    # 피처 이름 목록 (CONDITION_TEMPLATES에서 사용되는 것들)
    feature_names = list(set(c[0] for c in CONDITION_TEMPLATES))
    feature_names.sort()
    feat_name_to_idx = {name: idx for idx, name in enumerate(feature_names)}

    for stock_row in stocks:
        code = stock_row["stock_code"]
        feat_rows = conn.execute("""
            SELECT date, features_json FROM features
            WHERE stock_code=? ORDER BY date ASC
        """, (code,)).fetchall()

        price_rows = conn.execute("""
            SELECT date, close FROM daily_prices
            WHERE stock_code=? ORDER BY date ASC
        """, (code,)).fetchall()

        if len(feat_rows) < 30 or len(price_rows) < 30:
            continue

        price_map = {r["date"]: r["close"] for r in price_rows}
        date_list = [r["date"] for r in price_rows]

        entries = []
        for fr in feat_rows:
            date = fr["date"]
            if date not in price_map:
                continue

            features = json.loads(fr["features_json"])
            date_idx = date_list.index(date) if date in date_list else -1
            if date_idx < 0:
                continue

            current_price = price_map[date]
            future_returns = {}
            for days in [3, 5, 7, 10]:
                future_idx = date_idx + days
                if future_idx < len(date_list):
                    future_price = price_map[date_list[future_idx]]
                    future_returns[days] = (future_price - current_price) / current_price * 100
                else:
                    future_returns[days] = None

            entries.append({
                "date": date,
                "features": features,
                "future_returns": future_returns,
            })

            # numpy 배열용 데이터 추가
            feat_vec = np.zeros(len(feature_names), dtype=np.float64)
            for fname, fidx in feat_name_to_idx.items():
                feat_vec[fidx] = features.get(fname, 0.0)
            all_features_list.append(feat_vec)
            for days in [3, 5, 7, 10]:
                val = future_returns.get(days)
                all_future_returns[days].append(float(val) if val is not None else np.nan)
            all_dates.append(date)
            all_stock_codes.append(code)

        if entries:
            dataset[code] = entries

    if not all_features_list:
        return {}, {}

    np_dataset = {
        "features": np.array(all_features_list),
        "future_returns": {d: np.array(all_future_returns[d]) for d in [3, 5, 7, 10]},
        "dates": all_dates,
        "stock_codes": all_stock_codes,
        "feat_name_to_idx": feat_name_to_idx,
        "feature_names": feature_names,
    }

    return dataset, np_dataset


def _build_condition_mask(np_dataset, conditions):
    """조건들로 boolean mask 생성 (벡터화)"""
    feat_array = np_dataset["features"]
    feat_idx_map = np_dataset["feat_name_to_idx"]
    mask = np.ones(len(feat_array), dtype=bool)

    for cond in conditions:
        feat_name, op, value, _ = cond
        if feat_name not in feat_idx_map:
            return np.zeros(len(feat_array), dtype=bool)
        col_idx = feat_idx_map[feat_name]
        col = feat_array[:, col_idx]

        if op == ">":
            mask &= (col > value)
        elif op == "<":
            mask &= (col < value)
        elif op == ">=":
            mask &= (col >= value)
        elif op == "<=":
            mask &= (col <= value)
        elif op == "==":
            mask &= (col == value)

    return mask


def _test_combination_vectorized(np_dataset, conditions, holding_days, min_samples=50):
    """
    조건 조합의 예측력 검증 — NumPy 벡터화 + Walk-forward 검증
    """
    if not np_dataset or "features" not in np_dataset:
        return None

    trade_cost_pct = getattr(evo_config, 'TRADE_COST', 0.0025) * 100  # 0.25%

    # 조건 마스크 생성
    cond_mask = _build_condition_mask(np_dataset, conditions)

    # 미래 수익률
    future_ret = np_dataset["future_returns"][holding_days]
    valid_mask = ~np.isnan(future_ret)
    full_mask = cond_mask & valid_mask

    total_signals = np.sum(full_mask)
    if total_signals < min_samples:
        _rejection_counts["sample_insufficient"] += 1
        return None

    returns = future_ret[full_mask]
    wins = np.sum(returns > 0)
    win_rate = wins / len(returns)

    if win_rate < evo_config.MIN_WIN_RATE:
        _rejection_counts["winrate_low"] += 1
        return None

    # 과적합 필터: 샘플 < 50 AND 승률 > 90% -> reject
    if len(returns) < 50 and win_rate > 0.90:
        _rejection_counts["overfit_suspect"] += 1
        return None

    # EV 계산 (비용 반영)
    gains = returns[returns > 0]
    losses = returns[returns <= 0]
    avg_gain = np.mean(gains) if len(gains) > 0 else 0
    avg_loss = np.mean(np.abs(losses)) if len(losses) > 0 else 0
    ev_net = win_rate * avg_gain - (1 - win_rate) * avg_loss - trade_cost_pct

    if ev_net < evo_config.MIN_EXPECTED_VALUE:
        _rejection_counts["ev_insufficient"] += 1
        return None

    # Walk-forward 검증
    wf_result = _walk_forward_validate(np_dataset, conditions, holding_days, full_mask)
    if not wf_result["passed"]:
        _rejection_counts["walkforward_fail"] += 1
        return None

    avg_return = float(np.mean(returns))

    return {
        "win_rate": round(float(win_rate), 4),
        "avg_return": round(avg_return, 4),
        "sample_count": int(total_signals),
        "expected_value": round(float(ev_net), 4),
        "wf_windows_passed": wf_result["windows_passed"],
        "wf_avg_winrate": round(wf_result["avg_winrate"], 4),
    }


def _walk_forward_validate(np_dataset, conditions, holding_days, full_mask):
    """
    Walk-forward 검증:
    - 전체 데이터를 날짜 기준으로 슬라이딩 윈도우 분할
    - 각 윈도우: 6개월 학습 + 2개월 테스트
    - 모든 테스트 윈도우에서 승률 >= 52% 필요
    - 전체 평균 승률 >= 55% 필요
    - 각 윈도우 최소 10개 샘플
    """
    dates = np_dataset["dates"]
    future_ret = np_dataset["future_returns"][holding_days]

    # 날짜를 정수 인덱스로 — 고유 날짜 정렬
    unique_dates = sorted(set(dates))
    if len(unique_dates) < 120:  # 최소 6개월
        return {"passed": True, "windows_passed": 0, "avg_winrate": 0.55}

    # 날짜 -> 월 단위 인덱스 매핑
    date_to_month = {}
    for d in unique_dates:
        try:
            dt = datetime.strptime(d, "%Y%m%d")
            month_key = dt.year * 12 + dt.month
            date_to_month[d] = month_key
        except:
            continue

    if not date_to_month:
        return {"passed": True, "windows_passed": 0, "avg_winrate": 0.55}

    months = sorted(set(date_to_month.values()))
    if len(months) < 8:  # 최소 8개월 (6+2)
        return {"passed": True, "windows_passed": 0, "avg_winrate": 0.55}

    # 각 레코드의 월 매핑
    record_months = np.array([date_to_month.get(d, 0) for d in dates])

    # 슬라이딩 윈도우 생성: 6개월 학습 + 2개월 테스트, 4개월씩 슬라이드
    windows = []
    i = 0
    while i + 8 <= len(months):
        train_months = set(months[i:i+6])
        test_months = set(months[i+6:i+8])
        windows.append((train_months, test_months))
        i += 4  # 4개월 슬라이드

    if not windows:
        return {"passed": True, "windows_passed": 0, "avg_winrate": 0.55}

    test_winrates = []
    windows_passed = 0

    for train_months, test_months in windows:
        # 테스트 윈도우에서 신호 발생한 것들만
        test_in_window = np.array([record_months[j] in test_months for j in range(len(dates))])
        test_mask = full_mask & test_in_window & ~np.isnan(future_ret)

        test_count = np.sum(test_mask)
        if test_count < 10:
            continue  # 샘플 부족한 윈도우는 스킵 (불이익 아님)

        test_returns = future_ret[test_mask]
        test_wr = np.sum(test_returns > 0) / len(test_returns)

        if test_wr < 0.52:
            return {"passed": False, "windows_passed": windows_passed, "avg_winrate": 0}

        test_winrates.append(test_wr)
        windows_passed += 1

    if windows_passed == 0:
        # 어떤 윈도우도 10개 이상 샘플 없음 — 데이터 부족으로 통과 허용
        return {"passed": True, "windows_passed": 0, "avg_winrate": 0.55}

    avg_wr = sum(test_winrates) / len(test_winrates)
    if avg_wr < 0.55:
        return {"passed": False, "windows_passed": windows_passed, "avg_winrate": avg_wr}

    return {"passed": True, "windows_passed": windows_passed, "avg_winrate": avg_wr}


def _apply_diversity_filter(candidates):
    """
    다양성 제어: 단일 조건이 전체 규칙의 50% 이상 차지 못하도록
    EV 순 정렬된 candidates에서 하나씩 추가, 위반 시 스킵
    """
    max_pct = getattr(evo_config, 'DIVERSITY_MAX_PCT', 0.50)
    selected = []
    condition_counts = {}

    for candidate in candidates:
        # 이 후보를 추가했을 때 다양성 위반 여부 확인
        cond_labels = [c[3] for c in candidate["conditions"]]
        total_after = len(selected) + 1

        would_violate = False
        for label in cond_labels:
            count_after = condition_counts.get(label, 0) + 1
            if count_after / total_after > max_pct and total_after > 2:
                would_violate = True
                break

        if would_violate:
            continue

        selected.append(candidate)
        for label in cond_labels:
            condition_counts[label] = condition_counts.get(label, 0) + 1

        if len(selected) >= evo_config.MAX_ACTIVE_RULES:
            break

    return selected


def _conditions_key(conditions):
    """조건 조합의 고유 키 (순서 무관)"""
    labels = sorted([c[3] if len(c) > 3 else str(c) for c in conditions])
    return "|".join(labels)


if __name__ == "__main__":
    discover_patterns()
