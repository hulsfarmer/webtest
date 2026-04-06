#!/usr/bin/env python3
"""VB봇 strategy.py 패치: check_breakout에 강도 0.1 최소 필터 추가"""

path = "/home/ubuntu/coin_vb_bot/strategy.py"
with open(path, "r") as f:
    code = f.read()

# check_breakout: strength >= 0.1 필터 추가
old = """        if current >= t["target"]:
            strength = (current - t["target"]) / t["prev_range"] if t["prev_range"] > 0 else 0
            pct_above_open = (current - t["open"]) / t["open"] * 100

            signals.append({"""

new = """        if current >= t["target"]:
            strength = (current - t["target"]) / t["prev_range"] if t["prev_range"] > 0 else 0
            if strength < 0.1:
                nm = market.replace("KRW-", "")
                logger.info(f"  {nm} 돌파 but 강도 {strength:.3f} < 0.1 → 스킵")
                continue
            pct_above_open = (current - t["open"]) / t["open"] * 100

            signals.append({"""

assert old in code, "패치 대상 없음"
code = code.replace(old, new)

with open(path, "w") as f:
    f.write(code)
print("VB strategy.py 패치 완료: 강도 0.1 최소 필터 추가")
