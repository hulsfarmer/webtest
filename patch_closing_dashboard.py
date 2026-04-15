"""대시보드 허브에 종가배팅봇 카드 + API 추가 패치"""
import re

DASHBOARD_PATH = "/home/ubuntu/kis_trader/dashboard_testa_server.py"

with open(DASHBOARD_PATH, "r", encoding="utf-8") as f:
    content = f.read()

# 1. 상단 상수 추가 (GAPUP_MODE 뒤에)
if "CLOSING_STATE" not in content:
    content = content.replace(
        'TESTA_CHANGELOG = ',
        'CLOSING_STATE = os.path.join(os.path.dirname(__file__), "closing_pick_state.json")\n'
        'CLOSING_DB = os.path.join(os.path.dirname(__file__), "closing_pick.db")\n'
        'TESTA_CHANGELOG = '
    )

# 2. 허브 HTML에 종가배팅봇 카드 추가 (거래대금 스크리너 카드 앞에)
closing_card = """
  <div class="bot-card">
    <div class="bot-header">
      <span><span class="status-dot dot-loading" id="dot-closing"></span><span class="bot-title">🌙 종가배팅봇 (G8)</span></span>
      <span><button class="refresh-btn" onclick="loadClosing()">새로고침</button></span>
    </div>
    <div id="closing-content"><p style="color:#64748b;font-size:12px;padding:10px">로딩 중...</p></div>
  </div>
"""
if "dot-closing" not in content:
    # 거래대금 스크리너 카드 앞에 삽입
    content = content.replace(
        '  <div class="bot-card">\n    <div class="bot-header">\n      <span><span class="status-dot dot-ok" id="dot-vol">',
        closing_card + '  <div class="bot-card">\n    <div class="bot-header">\n      <span><span class="status-dot dot-ok" id="dot-vol">'
    )

# 3. loadClosing() 자바스크립트 함수 추가 (loadAll 함수 앞에)
closing_js = """
async function loadClosing() {
  setDot("closing","loading");
  try {
    const d = await fetch("/api/closing").then(r=>r.json());
    setDot("closing","ok");
    const pos = d.positions || {};
    const posKeys = Object.keys(pos);
    let posHTML = posKeys.length
      ? `<table><tr><th>종목</th><th>진입가</th><th>거래량</th><th>캔들</th></tr>${posKeys.map(code=>{const p=pos[code];return `<tr><td><b>${p.name||code}</b></td><td>${fmt(p.entry_price)}원</td><td>${(p.vol_ratio||0).toFixed(1)}배</td><td>${Math.round((p.candle_pos||0)*100)}%</td></tr>`;}).join("")}</table>`
      : `<p class="positions-empty">포지션 없음 (15:20 매수 예정)</p>`;
    const badge = d.mode === "실거래" ? '<span class="badge badge-real">실거래</span>' : '<span class="badge badge-paper">모의</span>';
    document.getElementById("closing-content").innerHTML = `
      <div class="cards">
        <div class="card"><div class="lbl">자본</div><div class="val neu" style="font-size:14px">${fmt(d.equity)}원 ${badge}</div></div>
        <div class="card"><div class="lbl">누적 손익</div><div class="val ${pc(d.total_pnl)}">${d.total_pnl>=0?"+":""}${fmt(d.total_pnl)}원</div></div>
        <div class="card"><div class="lbl">오늘 손익</div><div class="val ${pc(d.today_pnl)}">${d.today_pnl>=0?"+":""}${fmt(d.today_pnl)}원</div></div>
        <div class="card"><div class="lbl">거래/승률</div><div class="val wht" style="font-size:14px">${d.trade_count}건 ${d.win_rate}%</div></div>
        <div class="card"><div class="lbl">포지션</div><div class="val wht">${posKeys.length}/3</div></div>
      </div>
      <div class="section-title">보유 포지션 (익일 09:05 청산)</div>${posHTML}
      <div class="updated">갱신: ${d.updated}</div>`;
  } catch(e) {
    setDot("closing","error");
    document.getElementById("closing-content").innerHTML=`<p class="err-msg">❌ 연결 실패</p>`;
  }
}
"""
if "loadClosing" not in content:
    content = content.replace(
        "async function loadAll",
        closing_js + "\nasync function loadAll"
    )

# 4. loadAll()에 loadClosing() 호출 추가
if "loadClosing()" not in content:
    # loadAll 함수 내 마지막 load 호출 뒤에 추가
    content = content.replace(
        "loadCoinSwing()",
        "loadCoinSwing();\n  loadClosing()"
    )

# 5. API 엔드포인트 추가 (/api/closing)
closing_api = '''
@app.route("/api/closing")
def api_closing():
    from datetime import datetime as _dt
    import sqlite3 as _sql
    today_str = _dt.now().strftime("%Y-%m-%d")
    month_str = _dt.now().strftime("%Y-%m-")

    state = {"updated": "-", "positions": {}, "today_closed": [],
             "today_pnl": 0, "today_count": 0, "today_wins": 0}
    if os.path.exists(CLOSING_STATE):
        try:
            with open(CLOSING_STATE, encoding="utf-8") as f:
                state = json.load(f)
        except:
            pass

    all_trades, total_pnl = [], 0
    if os.path.exists(CLOSING_DB) and os.path.getsize(CLOSING_DB) > 0:
        try:
            conn = _sql.connect(CLOSING_DB)
            conn.row_factory = _sql.Row
            rows = conn.execute("SELECT * FROM trades ORDER BY date, entry_time").fetchall()
            conn.close()
            all_trades = [dict(r) for r in rows]
            total_pnl = sum(t.get("pnl", 0) or 0 for t in all_trades)
        except:
            pass

    today_trades = [t for t in all_trades if t.get("date") == today_str]
    today_pnl = sum(t.get("pnl", 0) or 0 for t in today_trades)
    month_pnl = sum(t.get("pnl", 0) or 0 for t in all_trades if (t.get("date") or "").startswith(month_str))

    equity = int(300_000 + total_pnl)
    wins = [t for t in all_trades if (t.get("pnl") or 0) > 0]
    win_rate = len(wins) / len(all_trades) * 100 if all_trades else 0

    # 모드
    mode = "모의거래"
    mode_file = os.path.join(os.path.dirname(__file__), "closing_pick_mode.json")
    if os.path.exists(mode_file):
        try:
            with open(mode_file) as f:
                if json.load(f).get("live"):
                    mode = "실거래"
        except:
            pass

    return jsonify({
        "mode": mode,
        "updated": state.get("updated", "-"),
        "positions": state.get("positions", {}),
        "equity": equity,
        "total_pnl": round(total_pnl),
        "today_pnl": round(today_pnl),
        "month_pnl": round(month_pnl),
        "trade_count": len(all_trades),
        "win_rate": round(win_rate, 1),
        "today_count": len(today_trades),
        "today_wins": len([t for t in today_trades if (t.get("pnl") or 0) > 0]),
        "recent_trades": all_trades[-10:][::-1],
    })

'''
if '/api/closing' not in content:
    # /api/gapup 앞에 추가
    content = content.replace(
        '@app.route("/api/gapup")',
        closing_api + '@app.route("/api/gapup")'
    )

with open(DASHBOARD_PATH, "w", encoding="utf-8") as f:
    f.write(content)

print("패치 완료!")
