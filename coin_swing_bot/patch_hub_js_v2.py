# -*- coding: utf-8 -*-
"""Hub dashboard JS patch v2 — add loadCoinSwing (no unicode escapes)"""

filepath = '/home/ubuntu/kis_trader/dashboard_testa_server.py'
with open(filepath, 'r', encoding='utf-8') as f:
    content = f.read()

# Remove the broken patch first (the async function loadCoinSwing block)
# Find and remove everything between the markers
import re
# Remove old loadCoinSwing function if exists
content = re.sub(r'async function loadCoinSwing\(\).*?^}$', '', content, flags=re.DOTALL|re.MULTILINE)
# Fix double loadCoinSwing in loadAll
content = content.replace(' loadCoinSwing();', '')

js_func = """
async function loadCoinSwing() {
  setDot("coinswing","loading");
  try {
    const d = await fetch("http://138.2.28.57:8084/api/status").then(r=>r.json());
    setDot("coinswing","ok");
    const s=d.stats, pos=d.positions||[], trades=d.trades||[];
    let posHTML = pos.length ? pos.map(p=>{
      let cls = p.pnl_pct>=0?"pos":"neg";
      let sign = p.pnl_pct>=0?"+":"";
      let trail = p.trailing_active?"active":"off";
      return `<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid #1e293b;font-size:12px"><span><b>${p.market.replace("KRW-","")}</b></span><span class="${cls}">${sign}${p.pnl_pct.toFixed(2)}%</span><span>${trail}</span><span>${p.hours_held}h</span></div>`;
    }).join("") : `<p class="positions-empty">no position</p>`;
    let recentHTML = trades.length ? `<div class="section-title" style="margin-top:12px">recent</div><table><tr><th>coin</th><th>PnL</th><th>reason</th></tr>${trades.slice(0,5).map(t=>`<tr><td>${t.market.replace("KRW-","")}</td><td class="${pc(t.pnl)}">${(t.pnl_pct*100).toFixed(1)}% (${fmt(Math.round(t.pnl))})</td><td style="font-size:11px;color:#94a3b8">${t.reason}</td></tr>`).join("")}</table>` : "";
    document.getElementById("coinswing-content").innerHTML = `
      <div style="margin-bottom:6px"><span class="badge badge-paper">${d.mode}</span> <span style="font-size:11px;color:#64748b">${d.target_coins.join(", ")}</span></div>
      <div class="cards">
        <div class="card"><div class="lbl">equity</div><div class="val neu" style="font-size:14px">${fmt(Math.round(s.equity))}</div></div>
        <div class="card"><div class="lbl">return</div><div class="val ${pc(s.return_pct)}">${s.return_pct>=0?"+":""}${s.return_pct.toFixed(1)}%</div></div>
        <div class="card"><div class="lbl">win rate</div><div class="val wht">${s.win_rate.toFixed(0)}% (${s.total_trades})</div></div>
        <div class="card"><div class="lbl">positions</div><div class="val wht">${pos.length}/3</div></div>
      </div>
      <div class="section-title">positions</div>${posHTML}${recentHTML}`;
  } catch(e) {
    setDot("coinswing","error");
    document.getElementById("coinswing-content").innerHTML = `<p class="err-msg">connection failed</p>`;
  }
}
"""

# Insert before loadAll
old_loadall = 'function loadAll() {'
content = content.replace(old_loadall, js_func + '\nfunction loadAll() {', 1)

# Add to loadAll calls
old_calls = 'loadTesta(); loadSwing(); loadCoinDay(); loadBear(); loadGapup();'
new_calls = 'loadTesta(); loadSwing(); loadCoinDay(); loadBear(); loadGapup(); loadCoinSwing();'
content = content.replace(old_calls, new_calls, 1)

with open(filepath, 'w', encoding='utf-8') as f:
    f.write(content)

print('JS patch v2 done')
