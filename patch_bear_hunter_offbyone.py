#!/usr/bin/env python3
"""Bear Hunter 패치: _check_a_stock off-by-one 수정"""

path = "/home/ubuntu/kis_trader/main_bear_hunter.py"
with open(path, "r") as f:
    code = f.read()

# 1. ret5: closes.iloc[-2] → closes.iloc[-1]
old1 = "ret5     = float((closes.iloc[-2] - closes.iloc[-7]) / closes.iloc[-7])"
new1 = "ret5     = float((closes.iloc[-1] - closes.iloc[-6]) / closes.iloc[-6])"
assert old1 in code, f"패치1 대상 없음: {old1}"
code = code.replace(old1, new1)

# 2. rsi: closes.iloc[:-1] → closes (전체, 어제 포함)
old2 = "rsi      = calc_rsi(closes.iloc[:-1])"
new2 = "rsi      = calc_rsi(closes)"
assert old2 in code, f"패치2 대상 없음: {old2}"
code = code.replace(old2, new2)

# 3. prev_close: closes.iloc[-2] → closes.iloc[-1]
old3 = "prev_close = float(closes.iloc[-2])"
new3 = "prev_close = float(closes.iloc[-1])"
assert old3 in code, f"패치3 대상 없음: {old3}"
code = code.replace(old3, new3)

# 4. amount20: amounts.iloc[-21:-1] → amounts.iloc[-20:] (어제 포함)
old4 = "amount20 = float(amounts.iloc[-21:-1].mean())"
new4 = "amount20 = float(amounts.iloc[-20:].mean())"
assert old4 in code, f"패치4 대상 없음: {old4}"
code = code.replace(old4, new4)

with open(path, "w") as f:
    f.write(code)

print("Bear Hunter 패치 완료: _check_a_stock off-by-one 4건 수정")
