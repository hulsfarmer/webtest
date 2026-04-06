#!/usr/bin/env python3
"""코인 스윙봇 main.py 패치: check_exit 3-tuple 반환값 대응"""

path = "/home/ubuntu/coin_swing_bot/main.py"
with open(path, "r") as f:
    code = f.read()

# check_exit 호출부를 3-tuple로 변경
old_call = '''            for pos in positions:
                reason, exit_price = check_exit(pos)
                if reason and exit_price:
                    execute_sell(pos, exit_price, reason)
                else:
                    # 트레일링 업데이트
                    new_highest, new_trailing = get_updated_trailing(pos)
                    if new_highest != pos["highest_price"] or new_trailing != bool(pos["trailing_active"]):
                        update_trailing(pos["id"], new_highest, new_trailing)'''

new_call = '''            for pos in positions:
                reason, exit_price, cur_price = check_exit(pos)
                if reason and exit_price:
                    execute_sell(pos, exit_price, reason)
                elif cur_price is not None:
                    # 트레일링 업데이트 (check_exit에서 받은 현재가 재사용)
                    new_highest, new_trailing = get_updated_trailing(pos, cur_price)
                    if new_highest != pos["highest_price"] or new_trailing != bool(pos["trailing_active"]):
                        update_trailing(pos["id"], new_highest, new_trailing)'''

assert old_call in code, "main.py check_exit 호출부 패치 대상 없음"
code = code.replace(old_call, new_call)

with open(path, "w") as f:
    f.write(code)

print("스윙봇 main.py 패치 완료: check_exit 3-tuple 대응")
