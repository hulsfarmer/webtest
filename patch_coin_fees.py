#!/usr/bin/env python3
"""코인 스윙봇 + VB봇 패치: close_position에 업비트 수수료(0.05%) 반영"""

UPBIT_FEE = 0.0005  # 편도 0.05%

# ── 스윙봇 ──
path_swing = "/home/ubuntu/coin_swing_bot/main.py"
with open(path_swing, "r") as f:
    code = f.read()

old_swing = """    pnl_pct = (exit_price - entry_price) / entry_price
    pnl = quantity * (exit_price - entry_price)"""

new_swing = """    pnl_pct = (exit_price - entry_price) / entry_price
    commission = (entry_price + exit_price) * quantity * 0.0005  # 업비트 수수료 0.05%
    pnl = quantity * (exit_price - entry_price) - commission"""

assert old_swing in code, "스윙봇 패치 대상 없음"
code = code.replace(old_swing, new_swing)

with open(path_swing, "w") as f:
    f.write(code)
print("스윙봇 close_position 수수료 반영 완료")

# ── VB봇 ──
path_vb = "/home/ubuntu/coin_vb_bot/main.py"
with open(path_vb, "r") as f:
    code = f.read()

old_vb = """    pnl_pct = (exit_price - entry_price) / entry_price
    pnl = quantity * (exit_price - entry_price)"""

new_vb = """    pnl_pct = (exit_price - entry_price) / entry_price
    commission = (entry_price + exit_price) * quantity * 0.0005  # 업비트 수수료 0.05%
    pnl = quantity * (exit_price - entry_price) - commission"""

assert old_vb in code, "VB봇 패치 대상 없음"
code = code.replace(old_vb, new_vb)

with open(path_vb, "w") as f:
    f.write(code)
print("VB봇 close_position 수수료 반영 완료")
