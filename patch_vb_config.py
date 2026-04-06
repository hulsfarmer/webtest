#!/usr/bin/env python3
"""VB봇 config.py 패치: SELL_HOUR_KST = 0 → 9"""

path = "/home/ubuntu/coin_vb_bot/config.py"
with open(path, "r") as f:
    code = f.read()

old = 'SELL_HOUR_KST = 0          # 매도 시각 (KST 00시 = 새 일봉 시작)'
new = 'SELL_HOUR_KST = 9          # 매도 시각 (KST 09시, 최소 보유시간 확보)'

assert old in code, "config 패치 대상 없음"
code = code.replace(old, new)

# 주석도 업데이트
old2 = '# 기본: 다음 날 00:00 KST에 시가 매도'
new2 = '# 기본: 다음 날 09:00 KST에 매도 (최소 보유시간 확보)'
code = code.replace(old2, new2)

with open(path, "w") as f:
    f.write(code)
print("VB config.py 패치 완료: SELL_HOUR_KST=9")
