"""코인 스윙봇 v5.1 대시보드"""
import sqlite3
import json
from datetime import datetime
from flask import Flask, jsonify, Response

from config import (
    DB_PATH, TARGET_COINS, MAX_POSITIONS, PAPER_TRADING,
    SL_PCT, TRAIL_ACTIVATE, TRAIL_DISTANCE, TIME_STOP_HOURS,
    BIG_CANDLE_MIN, BIG_CANDLE_MAX, RSI_MIN, VOL_SURGE,
    INITIAL_CAPITAL,
)

try:
    import pyupbit
except ImportError:
    pyupbit = None


def create_app():
    app = Flask(__name__)

    def get_db():
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        return conn

    @app.route("/")
    def index():
        return Response(HTML, content_type="text/html; charset=utf-8")

    @app.route("/api/status")
    def api_status():
        conn = get_db()

        # 오픈 포지션
        positions = [dict(r) for r in conn.execute("SELECT * FROM positions WHERE status='open'").fetchall()]

        # 현재가 + PnL 계산
        for pos in positions:
            try:
                if pyupbit:
                    cur = pyupbit.get_current_price(pos["market"])
                else:
                    cur = pos["entry_price"]
                pos["current_price"] = cur or pos["entry_price"]
            except Exception:
                pos["current_price"] = pos["entry_price"]
            pos["pnl_pct"] = (pos["current_price"] - pos["entry_price"]) / pos["entry_price"] * 100
            pos["pnl_krw"] = pos["quantity"] * (pos["current_price"] - pos["entry_price"])
            hours = (datetime.now() - datetime.fromisoformat(pos["entry_time"])).total_seconds() / 3600
            pos["hours_held"] = round(hours, 1)

        # 거래 내역
        trades = [dict(r) for r in conn.execute(
            "SELECT * FROM trades ORDER BY exit_time DESC LIMIT 50"
        ).fetchall()]

        # 통계
        all_trades = [dict(r) for r in conn.execute("SELECT * FROM trades").fetchall()]
        total_pnl = sum(t["pnl"] for t in all_trades)
        wins = [t for t in all_trades if t["pnl"] > 0]
        win_rate = len(wins) / len(all_trades) * 100 if all_trades else 0

        # 자본
        row = conn.execute("SELECT value FROM bot_state WHERE key='paper_capital'").fetchone()
        capital = float(row["value"]) if row else INITIAL_CAPITAL
        pos_value = sum(p["quantity"] * p["current_price"] for p in positions)

        # 하트비트
        hb = conn.execute("SELECT value FROM bot_state WHERE key='last_heartbeat'").fetchone()
        heartbeat = hb["value"] if hb else "N/A"

        conn.close()

        return jsonify({
            "mode": "모의거래" if PAPER_TRADING else "실거래",
            "target_coins": [c.replace("KRW-", "") for c in TARGET_COINS],
            "positions": positions,
            "trades": trades,
            "stats": {
                "total_trades": len(all_trades),
                "total_pnl": total_pnl,
                "win_rate": win_rate,
                "capital": capital,
                "pos_value": pos_value,
                "equity": capital + pos_value,
                "return_pct": (capital + pos_value - INITIAL_CAPITAL) / INITIAL_CAPITAL * 100,
            },
            "config": {
                "max_positions": MAX_POSITIONS,
                "sl_pct": SL_PCT * 100,
                "trail_activate": TRAIL_ACTIVATE * 100,
                "trail_distance": TRAIL_DISTANCE * 100,
                "time_stop": TIME_STOP_HOURS,
                "big_candle": f"{BIG_CANDLE_MIN*100:.0f}~{BIG_CANDLE_MAX*100:.0f}%",
                "rsi_min": RSI_MIN,
                "vol_surge": VOL_SURGE,
            },
            "heartbeat": heartbeat,
        })

    return app


HTML = """<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>코인 스윙봇 v5.1</title>
<style>
* { margin:0; padding:0; box-sizing:border-box; }
body { font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; background:#0a0a1a; color:#e0e0e0; padding:16px; }
.header { text-align:center; margin-bottom:20px; }
.header h1 { font-size:24px; color:#00d4ff; }
.header .mode { font-size:14px; color:#ffa500; margin-top:4px; }
.header .coins { font-size:12px; color:#888; margin-top:4px; }
.grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(200px,1fr)); gap:12px; margin-bottom:20px; }
.card { background:#1a1a2e; border-radius:8px; padding:14px; border:1px solid #333; }
.card .label { font-size:11px; color:#888; text-transform:uppercase; }
.card .value { font-size:22px; font-weight:700; margin-top:4px; }
.plus { color:#00e676; } .minus { color:#ff5252; }
.config-bar { display:flex; gap:8px; flex-wrap:wrap; margin-bottom:16px; justify-content:center; }
.config-tag { background:#1a1a2e; border:1px solid #333; border-radius:4px; padding:4px 8px; font-size:11px; color:#aaa; }
table { width:100%; border-collapse:collapse; margin-bottom:20px; }
th { background:#1a1a2e; padding:8px; text-align:left; font-size:12px; color:#888; border-bottom:1px solid #333; }
td { padding:8px; font-size:13px; border-bottom:1px solid #222; }
.section-title { font-size:16px; font-weight:600; margin:16px 0 8px; color:#00d4ff; }
.heartbeat { text-align:center; font-size:11px; color:#555; margin-top:16px; }
</style>
</head>
<body>
<div class="header">
  <h1>코인 스윙봇 v5.1</h1>
  <div class="mode" id="mode"></div>
  <div class="coins" id="coins"></div>
</div>
<div class="config-bar" id="config-bar"></div>
<div class="grid" id="stats-grid"></div>
<div class="section-title">포지션</div>
<table id="pos-table"><thead><tr><th>코인</th><th>진입가</th><th>현재가</th><th>PnL</th><th>트레일링</th><th>보유</th></tr></thead><tbody></tbody></table>
<div class="section-title">최근 거래</div>
<table id="trade-table"><thead><tr><th>코인</th><th>진입→청산</th><th>PnL</th><th>사유</th><th>시간</th></tr></thead><tbody></tbody></table>
<div class="heartbeat" id="hb"></div>

<script>
function fmt(n) { return n.toLocaleString('ko-KR', {maximumFractionDigits:0}); }
function cls(n) { return n >= 0 ? 'plus' : 'minus'; }

async function refresh() {
  try {
    const r = await fetch('/api/status');
    const d = await r.json();

    document.getElementById('mode').textContent = d.mode;
    document.getElementById('coins').textContent = '대상: ' + d.target_coins.join(', ');

    // config tags
    const cfg = d.config;
    document.getElementById('config-bar').innerHTML =
      `<span class="config-tag">SL ${cfg.sl_pct}%</span>` +
      `<span class="config-tag">트레일 +${cfg.trail_activate}% / -${cfg.trail_distance}%</span>` +
      `<span class="config-tag">타임스탑 ${cfg.time_stop}h</span>` +
      `<span class="config-tag">대양봉 ${cfg.big_candle}</span>` +
      `<span class="config-tag">RSI>${cfg.rsi_min}</span>` +
      `<span class="config-tag">거래량 ${cfg.vol_surge}배</span>`;

    // stats
    const s = d.stats;
    document.getElementById('stats-grid').innerHTML =
      `<div class="card"><div class="label">자기자본</div><div class="value">${fmt(s.equity)}원</div></div>` +
      `<div class="card"><div class="label">수익률</div><div class="value ${cls(s.return_pct)}">${s.return_pct >= 0 ? '+' : ''}${s.return_pct.toFixed(1)}%</div></div>` +
      `<div class="card"><div class="label">총 손익</div><div class="value ${cls(s.total_pnl)}">${s.total_pnl >= 0 ? '+' : ''}${fmt(s.total_pnl)}원</div></div>` +
      `<div class="card"><div class="label">승률</div><div class="value">${s.win_rate.toFixed(0)}% (${s.total_trades}건)</div></div>` +
      `<div class="card"><div class="label">포지션</div><div class="value">${d.positions.length}/${d.config.max_positions}</div></div>`;

    // positions
    const ptb = document.querySelector('#pos-table tbody');
    if (d.positions.length === 0) {
      ptb.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#555">포지션 없음</td></tr>';
    } else {
      ptb.innerHTML = d.positions.map(p =>
        `<tr>
          <td>${p.market.replace('KRW-','')}</td>
          <td>${fmt(p.entry_price)}</td>
          <td>${fmt(p.current_price)}</td>
          <td class="${cls(p.pnl_pct)}">${p.pnl_pct >= 0 ? '+' : ''}${p.pnl_pct.toFixed(2)}% (${p.pnl_krw >= 0 ? '+' : ''}${fmt(p.pnl_krw)}원)</td>
          <td>${p.trailing_active ? '🟢 활성' : '⚪'}</td>
          <td>${p.hours_held}h</td>
        </tr>`
      ).join('');
    }

    // trades
    const ttb = document.querySelector('#trade-table tbody');
    if (d.trades.length === 0) {
      ttb.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#555">거래 없음</td></tr>';
    } else {
      ttb.innerHTML = d.trades.map(t =>
        `<tr>
          <td>${t.market.replace('KRW-','')}</td>
          <td>${fmt(t.entry_price)} → ${fmt(t.exit_price)}</td>
          <td class="${cls(t.pnl)}">${(t.pnl_pct*100).toFixed(2)}% (${t.pnl >= 0 ? '+' : ''}${fmt(t.pnl)}원)</td>
          <td>${t.reason}</td>
          <td>${t.exit_time.slice(5,16)}</td>
        </tr>`
      ).join('');
    }

    document.getElementById('hb').textContent = 'Last heartbeat: ' + d.heartbeat;
  } catch(e) {
    console.error(e);
  }
}

refresh();
setInterval(refresh, 30000);
</script>
</body>
</html>
"""
