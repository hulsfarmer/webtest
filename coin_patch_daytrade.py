#!/usr/bin/env python3
"""코인 단타봇 패치: CS>=80 경계값 + calc_cs 기본값"""
import re

path = "/home/ubuntu/coin_daytrade_paper.py"
with open(path, "r") as f:
    code = f.read()

# 1. CS_THRESHOLD < cs_now → CS_THRESHOLD <= cs_now (CS=80 포함)
old1 = "in_range = CS_THRESHOLD < cs_now <= CS_MAX"
new1 = "in_range = CS_THRESHOLD <= cs_now <= CS_MAX"
assert old1 in code, f"패치1 대상 없음: {old1}"
code = code.replace(old1, new1)

# 2. calc_cs 기본값 100.0 → 50.0 (거래 데이터 없을 때 중립)
old2 = 'return (buy / total * 100) if total > 0 else 100.0'
new2 = 'return (buy / total * 100) if total > 0 else 50.0'
assert old2 in code, f"패치2 대상 없음: {old2}"
code = code.replace(old2, new2)

with open(path, "w") as f:
    f.write(code)

print("단타봇 패치 완료: CS>=80 경계값 + calc_cs 기본값 50.0")
