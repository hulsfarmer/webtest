#!/usr/bin/env python3
"""코인 스윙봇 패치: check_exit + get_updated_trailing 이중 API 호출 제거"""

path = "/home/ubuntu/coin_swing_bot/strategy.py"
with open(path, "r") as f:
    code = f.read()

# check_exit에서 current_price를 반환하도록 수정
# 기존: return (None, None) — 청산 아닐 때
# 수정: return (None, None, current_price) — 가격도 같이 반환

old_exit = '''def check_exit(pos: dict) -> Tuple[Optional[str], Optional[float]]:
    """
    포지션 청산 체크.
    Returns: (reason, exit_price) or (None, None)
    """
    market = pos["market"]
    entry_price = pos["entry_price"]
    highest = pos["highest_price"]
    trailing_active = pos["trailing_active"]

    try:
        current_price = pyupbit.get_current_price(market)
        if current_price is None:
            return None, None
    except Exception:
        return None, None

    pnl_pct = (current_price - entry_price) / entry_price

    # 1. 손절
    if pnl_pct <= -SL_PCT:
        return "손절", current_price

    # 2. 트레일링 업데이트
    new_highest = max(highest, current_price)
    new_trailing = trailing_active or (pnl_pct >= TRAIL_ACTIVATE)

    # 3. 트레일링 스탑 발동
    if new_trailing and new_highest > 0:
        trail_stop_price = new_highest * (1 - TRAIL_DISTANCE)
        if current_price <= trail_stop_price:
            return "트레일링", current_price

    # 4. 타임스탑
    import datetime
    now = datetime.datetime.now()
    entry_time = datetime.datetime.fromisoformat(pos["entry_time"])
    hours_held = (now - entry_time).total_seconds() / 3600
    if hours_held >= TIME_STOP_HOURS:
        return "타임스탑", current_price

    return None, None'''

new_exit = '''def check_exit(pos: dict) -> Tuple[Optional[str], Optional[float], Optional[float]]:
    """
    포지션 청산 체크.
    Returns: (reason, exit_price, current_price) or (None, None, current_price)
    current_price는 트레일링 업데이트용으로 항상 반환
    """
    market = pos["market"]
    entry_price = pos["entry_price"]
    highest = pos["highest_price"]
    trailing_active = pos["trailing_active"]

    try:
        current_price = pyupbit.get_current_price(market)
        if current_price is None:
            return None, None, None
    except Exception:
        return None, None, None

    pnl_pct = (current_price - entry_price) / entry_price

    # 1. 손절
    if pnl_pct <= -SL_PCT:
        return "손절", current_price, current_price

    # 2. 트레일링 업데이트
    new_highest = max(highest, current_price)
    new_trailing = trailing_active or (pnl_pct >= TRAIL_ACTIVATE)

    # 3. 트레일링 스탑 발동
    if new_trailing and new_highest > 0:
        trail_stop_price = new_highest * (1 - TRAIL_DISTANCE)
        if current_price <= trail_stop_price:
            return "트레일링", current_price, current_price

    # 4. 타임스탑
    import datetime
    now = datetime.datetime.now()
    entry_time = datetime.datetime.fromisoformat(pos["entry_time"])
    hours_held = (now - entry_time).total_seconds() / 3600
    if hours_held >= TIME_STOP_HOURS:
        return "타임스탑", current_price, current_price

    return None, None, current_price'''

assert old_exit in code, "check_exit 패치 대상 없음"
code = code.replace(old_exit, new_exit)

# get_updated_trailing: current_price를 인자로 받도록 수정
old_trailing = '''def get_updated_trailing(pos: dict) -> Tuple[float, bool]:
    """현재가 기반으로 highest/trailing_active 업데이트"""
    try:
        current_price = pyupbit.get_current_price(pos["market"])
        if current_price is None:
            return pos["highest_price"], pos["trailing_active"]
    except Exception:
        return pos["highest_price"], pos["trailing_active"]

    new_highest = max(pos["highest_price"], current_price)
    pnl_pct = (current_price - pos["entry_price"]) / pos["entry_price"]
    new_trailing = pos["trailing_active"] or (pnl_pct >= TRAIL_ACTIVATE)
    return new_highest, new_trailing'''

new_trailing = '''def get_updated_trailing(pos: dict, current_price: float = None) -> Tuple[float, bool]:
    """현재가 기반으로 highest/trailing_active 업데이트"""
    if current_price is None:
        try:
            current_price = pyupbit.get_current_price(pos["market"])
            if current_price is None:
                return pos["highest_price"], pos["trailing_active"]
        except Exception:
            return pos["highest_price"], pos["trailing_active"]

    new_highest = max(pos["highest_price"], current_price)
    pnl_pct = (current_price - pos["entry_price"]) / pos["entry_price"]
    new_trailing = pos["trailing_active"] or (pnl_pct >= TRAIL_ACTIVATE)
    return new_highest, new_trailing'''

assert old_trailing in code, "get_updated_trailing 패치 대상 없음"
code = code.replace(old_trailing, new_trailing)

with open(path, "w") as f:
    f.write(code)

print("스윙봇 strategy.py 패치 완료: 이중 API 호출 제거")
