#!/usr/bin/env python3
"""Gapup 패치: get_equity 당일 PnL 이중계산 수정"""

path = "/home/ubuntu/kis_trader/daytrade_gapup.py"
with open(path, "r") as f:
    code = f.read()

# get_equity: today_pnl 이중계산 제거 — DB에 이미 오늘 거래 포함
old = """    def get_equity(self) -> int:
        \"\"\"현재 잔고 = 초기자본 + DB 누적손익 + 오늘 청산 손익\"\"\"
        db_pnl = 0
        try:
            row = self.conn.execute("SELECT COALESCE(SUM(pnl), 0) FROM trades").fetchone()
            db_pnl = row[0] if row else 0
        except:
            pass
        today_pnl = sum(t["pnl"] for t in self.closed)
        return int(INITIAL_CAPITAL + db_pnl + today_pnl)"""

new = """    def get_equity(self) -> int:
        \"\"\"현재 잔고 = 초기자본 + DB 누적손익 (오늘 거래 포함)\"\"\"
        db_pnl = 0
        try:
            row = self.conn.execute("SELECT COALESCE(SUM(pnl), 0) FROM trades").fetchone()
            db_pnl = row[0] if row else 0
        except:
            pass
        return int(INITIAL_CAPITAL + db_pnl)"""

assert old in code, "get_equity 패치 대상 없음"
code = code.replace(old, new)

with open(path, "w") as f:
    f.write(code)

print("Gapup 패치 완료: get_equity 이중계산 제거")
