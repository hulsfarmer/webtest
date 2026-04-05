"""Hub dashboard JS patch — add loadCoinSwing"""
import sys

filepath = '/home/ubuntu/kis_trader/dashboard_testa_server.py'
with open(filepath, 'r') as f:
    content = f.read()

js_func = r'''
async function loadCoinSwing() {
  setDot("coinswing","loading");
  try {
    const d = await fetch("http://138.2.28.57:8084/api/status").then(r=>r.json());
    setDot("coinswing","ok");
    const s=d.stats, pos=d.positions||[], trades=d.trades||[];
    let posHTML = pos.length ? pos.map(p=>`<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid #1e293b;font-size:12px"><span><b>${p.market.replace("KRW-","")}</b></span><span class="${p.pnl_pct>=0?"pos":"neg"}">${p.pnl_pct>=0?"+":""}${p.pnl_pct.toFixed(2)}%</span><span>${p.trailing_active?"\u{1f7e2}\ud2b8\ub808\uc77c":"\u26aa"}</span><span>${p.hours_held}h</span></div>`).join("") : `<p class="positions-empty">\ud3ec\uc9c0\uc158 \uc5c6\uc74c</p>`;
    let recentHTML = trades.length ? `<div class="section-title" style="margin-top:12px">\ucd5c\uadfc \uac70\ub798</div><table><tr><th>\ucf54\uc778</th><th>PnL</th><th>\uc0ac\uc720</th></tr>${trades.slice(0,5).map(t=>`<tr><td>${t.market.replace("KRW-","")}</td><td class="${pc(t.pnl)}">${(t.pnl_pct*100).toFixed(1)}% (${fmt(Math.round(t.pnl))}\uc6d0)</td><td style="font-size:11px;color:#94a3b8">${t.reason}</td></tr>`).join("")}</table>` : "";
    document.getElementById("coinswing-content").innerHTML = `
      <div style="margin-bottom:6px"><span class="badge badge-paper">${d.mode}</span> <span style="font-size:11px;color:#64748b">\ub300\uc0c1: ${d.target_coins.join(", ")}</span></div>
      <div class="cards">
        <div class="card"><div class="lbl">\uc790\uae30\uc790\ubcf8</div><div class="val neu" style="font-size:14px">${fmt(Math.round(s.equity))}\uc6d0</div></div>
        <div class="card"><div class="lbl">\uc218\uc775\ub960</div><div class="val ${pc(s.return_pct)}">${s.return_pct>=0?"+":""}${s.return_pct.toFixed(1)}%</div></div>
        <div class="card"><div class="lbl">\uc2b9\ub960</div><div class="val wht">${s.win_rate.toFixed(0)}% (${s.total_trades}\uac74)</div></div>
        <div class="card"><div class="lbl">\ud3ec\uc9c0\uc158</div><div class="val wht">${pos.length}/3</div></div>
      </div>
      <div class="section-title">\ud3ec\uc9c0\uc158</div>${posHTML}${recentHTML}`;
  } catch(e) {
    setDot("coinswing","error");
    document.getElementById("coinswing-content").innerHTML = `<p class="err-msg">\uc5f0\uacb0 \uc2e4\ud328</p>`;
  }
}
'''

# Insert before loadAll
old_loadall = 'function loadAll() {'
content = content.replace(old_loadall, js_func + '\nfunction loadAll() {', 1)

# Add to loadAll calls
old_calls = 'loadTesta(); loadSwing(); loadCoinDay(); loadBear(); loadGapup();'
new_calls = 'loadTesta(); loadSwing(); loadCoinDay(); loadBear(); loadGapup(); loadCoinSwing();'
content = content.replace(old_calls, new_calls, 1)

with open(filepath, 'w') as f:
    f.write(content)

print('JS patch done')
