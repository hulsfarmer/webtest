#!/usr/bin/env python3
"""코인 단타봇 패치: 횡보장 CS<80 dead code 제거 + BTC_CS_MIN 미사용 제거"""

path = "/home/ubuntu/coin_daytrade_paper.py"
with open(path, "r") as f:
    code = f.read()

# 1. 횡보장 CS<80 dead code 제거 (check_signal이 이미 CS>=80 보장)
old1 = """            triggered, detail = check_signal(market)
            if triggered:
                cs = detail.get("cs_now", 0)
                # 횡보장/하락장: CS 80 미만 진입 차단
                if trend in ('횡보장', '하락장') and cs < 80:
                    log.info(f"[{trend} CS필터] {market} cs={cs} < 80 — 스킵")
                    continue
                price = get_current_price(market)"""

new1 = """            triggered, detail = check_signal(market)
            if triggered:
                cs = detail.get("cs_now", 0)
                price = get_current_price(market)"""

assert old1 in code, "패치1 대상 없음"
code = code.replace(old1, new1)

# 2. BTC_CS_MIN 미사용 설정 제거
old2 = "BTC_CS_MIN      = 95          # BTC 최소 체결강도\n"
new2 = ""
assert old2 in code, "패치2 대상 없음"
code = code.replace(old2, new2)

with open(path, "w") as f:
    f.write(code)

print("코인 단타봇 패치 완료: dead code 2건 제거")
