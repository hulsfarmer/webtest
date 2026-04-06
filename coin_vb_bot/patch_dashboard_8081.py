# -*- coding: utf-8 -*-
"""Patch dashboard.py on 138.2.28.57 to add /vb and /api/vb routes"""

filepath = '/home/ubuntu/dashboard.py'
with open(filepath, 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Add VB bot data loader before _Handler class
vb_loader = '''
def _load_vb_bot():
    """Load volatility breakout bot status"""
    import sqlite3 as _sq
    db = os.path.join(os.path.dirname(os.path.abspath(__file__)), "coin_vb_bot", "vb_bot.db")
    if not os.path.exists(db):
        return {"status": "offline", "error": "DB not found"}
    try:
        conn = _sq.connect(db)
        conn.row_factory = _sq.Row
        positions = [dict(r) for r in conn.execute("SELECT * FROM positions WHERE status='open'").fetchall()]
        trades = [dict(r) for r in conn.execute("SELECT * FROM trades ORDER BY exit_time DESC LIMIT 30").fetchall()]
        all_trades = [dict(r) for r in conn.execute("SELECT * FROM trades").fetchall()]
        row = conn.execute("SELECT value FROM bot_state WHERE key='paper_capital'").fetchone()
        capital = float(row["value"]) if row else 1000000
        hb = conn.execute("SELECT value FROM bot_state WHERE key='last_heartbeat'").fetchone()
        heartbeat = hb["value"] if hb else "N/A"
        bf = conn.execute("SELECT value FROM bot_state WHERE key='btc_filter'").fetchone()
        btc_filter = bf["value"] if bf else "?"
        conn.close()

        for pos in positions:
            try:
                cur = pyupbit.get_current_price(pos["market"])
                pos["current_price"] = cur or pos["entry_price"]
            except:
                pos["current_price"] = pos["entry_price"]
            pos["pnl_pct"] = (pos["current_price"] - pos["entry_price"]) / pos["entry_price"] * 100
            pos["pnl_krw"] = pos["quantity"] * (pos["current_price"] - pos["entry_price"])

        total_pnl = sum(t["pnl"] for t in all_trades)
        wins = [t for t in all_trades if t["pnl"] > 0]
        win_rate = len(wins) / len(all_trades) * 100 if all_trades else 0
        pos_value = sum(p["quantity"] * p["current_price"] for p in positions)

        return {
            "status": "online",
            "mode": "paper",
            "strategy": "volatility_breakout",
            "target_coins": ["BTC", "ETH", "XRP", "SOL", "DOGE"],
            "positions": positions,
            "trades": trades,
            "stats": {
                "total_trades": len(all_trades),
                "total_pnl": total_pnl,
                "win_rate": win_rate,
                "capital": capital,
                "pos_value": pos_value,
                "equity": capital + pos_value,
                "return_pct": (capital + pos_value - 1000000) / 1000000 * 100,
            },
            "config": {
                "k": 0.4, "btc_ma": 5,
                "max_positions": 3, "sl_pct": 3.0,
                "pos_size": "35%",
            },
            "btc_filter": btc_filter,
            "heartbeat": heartbeat,
        }
    except Exception as e:
        return {"status": "error", "error": str(e)}


'''

# Insert before _Handler class (but after any existing loaders)
if '_load_vb_bot' not in content:
    content = content.replace('class _Handler(BaseHTTPRequestHandler):',
                              vb_loader + 'class _Handler(BaseHTTPRequestHandler):')

# 2. Add routes
old_else = '''        else:
            html = _render_html().encode("utf-8")'''

if '"/api/vb"' not in content:
    new_routes = '''        elif self.path == "/api/vb":
            body = json.dumps(_load_vb_bot(), ensure_ascii=False, default=str).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(body)
        elif self.path == "/vb":
            html = _VB_HTML.encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(html)))
            self.end_headers()
            self.wfile.write(html)
        else:
            html = _render_html().encode("utf-8")'''

    content = content.replace(old_else, new_routes)

# 3. Add VB HTML page
vb_html = r'''
_VB_HTML = """<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>volatility breakout bot</title>
<style>
* { margin:0; padding:0; box-sizing:border-box; }
body { font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; background:#0a0a1a; color:#e0e0e0; padding:16px; }
.header { text-align:center; margin-bottom:20px; }
.header h1 { font-size:24px; color:#ff9800; }
.header .mode { font-size:14px; color:#ffa500; margin-top:4px; }
.header .coins { font-size:12px; color:#888; margin-top:4px; }
.grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); gap:12px; margin-bottom:20px; }
.card { background:#1a1a2e; border-radius:8px; padding:14px; border:1px solid #333; }
.card .label { font-size:11px; color:#888; text-transform:uppercase; }
.card .value { font-size:22px; font-weight:700; margin-top:4px; }
.plus { color:#00e676; } .minus { color:#ff5252; }
.config-bar { display:flex; gap:8px; flex-wrap:wrap; margin-bottom:16px; justify-content:center; }
.config-tag { background:#1a1a2e; border:1px solid #333; border-radius:4px; padding:4px 8px; font-size:11px; color:#aaa; }
.filter-on { border-color:#00e676; color:#00e676; }
.filter-off { border-color:#ff5252; color:#ff5252; }
table { width:100%; border-collapse:collapse; margin-bottom:20px; }
th { background:#1a1a2e; padding:8px; text-align:left; font-size:12px; color:#888; border-bottom:1px solid #333; }
td { padding:8px; font-size:13px; border-bottom:1px solid #222; }
.section-title { font-size:16px; font-weight:600; margin:16px 0 8px; color:#ff9800; }
.heartbeat { text-align:center; font-size:11px; color:#555; margin-top:16px; }
.hub-link { display:block; text-align:center; margin-top:12px; }
.hub-link a { color:#888; font-size:12px; text-decoration:none; }
.hub-link a:hover { color:#ff9800; }
</style>
</head>
<body>
<div class="header">
  <h1>volatility breakout</h1>
  <div class="mode" id="mode"></div>
  <div class="coins" id="coins"></div>
</div>
<div class="config-bar" id="config-bar"></div>
<div class="grid" id="stats-grid"></div>
<div class="section-title">positions</div>
<table id="pos-table"><thead><tr><th>coin</th><th>entry</th><th>current</th><th>PnL</th><th>target</th></tr></thead><tbody></tbody></table>
<div class="section-title">recent trades</div>
<table id="trade-table"><thead><tr><th>coin</th><th>entry / exit</th><th>PnL</th><th>reason</th><th>time</th></tr></thead><tbody></tbody></table>
<div class="heartbeat" id="hb"></div>
<div class="hub-link"><a href="http://138.2.12.110:8083/hub">hub</a></div>

<script>
function fmt(n) { return n.toLocaleString('ko-KR', {maximumFractionDigits:0}); }
function cls(n) { return n >= 0 ? 'plus' : 'minus'; }

async function refresh() {
  try {
    const r = await fetch('/api/vb');
    const d = await r.json();
    if (d.status !== 'online') {
      document.getElementById('mode').textContent = 'OFFLINE: ' + (d.error || '');
      return;
    }

    document.getElementById('mode').textContent = d.mode === 'paper' ? 'paper trading' : 'LIVE';
    document.getElementById('coins').textContent = 'target: ' + d.target_coins.join(', ');

    const cfg = d.config;
    const bf = d.btc_filter === 'on';
    document.getElementById('config-bar').innerHTML =
      `<span class="config-tag">k=${cfg.k}</span>` +
      `<span class="config-tag">BTC MA${cfg.btc_ma}</span>` +
      `<span class="config-tag ${bf ? 'filter-on' : 'filter-off'}">BTC filter: ${d.btc_filter}</span>` +
      `<span class="config-tag">SL ${cfg.sl_pct}%</span>` +
      `<span class="config-tag">max ${cfg.max_positions} pos</span>`;

    const s = d.stats;
    document.getElementById('stats-grid').innerHTML =
      `<div class="card"><div class="label">equity</div><div class="value">${fmt(s.equity)}</div></div>` +
      `<div class="card"><div class="label">return</div><div class="value ${cls(s.return_pct)}">${s.return_pct >= 0 ? '+' : ''}${s.return_pct.toFixed(1)}%</div></div>` +
      `<div class="card"><div class="label">total pnl</div><div class="value ${cls(s.total_pnl)}">${s.total_pnl >= 0 ? '+' : ''}${fmt(s.total_pnl)}</div></div>` +
      `<div class="card"><div class="label">win rate</div><div class="value">${s.win_rate.toFixed(0)}% (${s.total_trades})</div></div>` +
      `<div class="card"><div class="label">positions</div><div class="value">${d.positions.length}/${cfg.max_positions}</div></div>`;

    const ptb = document.querySelector('#pos-table tbody');
    if (d.positions.length === 0) {
      ptb.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#555">no positions</td></tr>';
    } else {
      ptb.innerHTML = d.positions.map(p =>
        `<tr>
          <td>${p.market.replace('KRW-','')}</td>
          <td>${fmt(p.entry_price)}</td>
          <td>${fmt(p.current_price)}</td>
          <td class="${cls(p.pnl_pct)}">${p.pnl_pct >= 0 ? '+' : ''}${p.pnl_pct.toFixed(2)}% (${p.pnl_krw >= 0 ? '+' : ''}${fmt(p.pnl_krw)})</td>
          <td>${fmt(p.target_price)}</td>
        </tr>`
      ).join('');
    }

    const ttb = document.querySelector('#trade-table tbody');
    if (d.trades.length === 0) {
      ttb.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#555">no trades</td></tr>';
    } else {
      ttb.innerHTML = d.trades.map(t =>
        `<tr>
          <td>${t.market.replace('KRW-','')}</td>
          <td>${fmt(t.entry_price)} / ${fmt(t.exit_price)}</td>
          <td class="${cls(t.pnl)}">${(t.pnl_pct*100).toFixed(2)}% (${t.pnl >= 0 ? '+' : ''}${fmt(t.pnl)})</td>
          <td>${t.reason}</td>
          <td>${(t.exit_time||'').slice(5,16)}</td>
        </tr>`
      ).join('');
    }

    document.getElementById('hb').textContent = 'heartbeat: ' + d.heartbeat;
  } catch(e) {
    console.error(e);
  }
}

refresh();
setInterval(refresh, 30000);
</script>
</body>
</html>"""

'''

if '_VB_HTML' not in content:
    content = content.replace("def start(port: int = 8081):", vb_html + "def start(port: int = 8081):")

with open(filepath, 'w', encoding='utf-8') as f:
    f.write(content)

print('VB dashboard patch done')
