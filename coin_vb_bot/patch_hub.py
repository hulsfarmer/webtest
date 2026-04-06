# -*- coding: utf-8 -*-
"""Patch hub dashboard to add VB bot card"""
import re

filepath = '/home/ubuntu/kis_trader/dashboard_testa_server.py'
with open(filepath, 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Add loadCoinVB function in JS (before the closing </script>)
vb_js = r"""
// --- Coin VB Bot ---
async function loadCoinVB() {
  const card = document.getElementById('coin-vb-card');
  if (!card) return;
  try {
    const r = await fetch('http://138.2.28.57:8081/api/vb');
    const d = await r.json();
    if (d.status !== 'online') {
      card.querySelector('.bot-status').textContent = 'OFFLINE';
      card.querySelector('.bot-status').style.color = '#ff5252';
      return;
    }
    const s = d.stats;
    const bf = d.btc_filter === 'on';
    card.querySelector('.bot-status').textContent = d.mode === 'paper' ? 'PAPER' : 'LIVE';
    card.querySelector('.bot-status').style.color = '#ffa500';
    card.querySelector('.bot-detail').innerHTML =
      `<div>equity: <b>${s.equity.toLocaleString()}</b></div>` +
      `<div>return: <span style="color:${s.return_pct>=0?'#00e676':'#ff5252'}">${s.return_pct>=0?'+':''}${s.return_pct.toFixed(1)}%</span></div>` +
      `<div>win rate: ${s.win_rate.toFixed(0)}% (${s.total_trades})</div>` +
      `<div>positions: ${d.positions.length}/${d.config.max_positions}</div>` +
      `<div>BTC filter: <span style="color:${bf?'#00e676':'#ff5252'}">${d.btc_filter}</span></div>`;
  } catch(e) {
    card.querySelector('.bot-status').textContent = 'ERROR';
    card.querySelector('.bot-status').style.color = '#ff5252';
  }
}
loadCoinVB();
setInterval(loadCoinVB, 60000);
"""

# 2. Add card HTML
vb_card = """<a href="http://138.2.28.57:8081/vb" style="text-decoration:none;color:inherit" target="_blank">
<div class="bot-card" id="coin-vb-card">
  <div class="bot-title">VB Breakout</div>
  <div class="bot-status" style="color:#888">loading...</div>
  <div class="bot-detail" style="font-size:12px;color:#aaa;margin-top:8px"></div>
</div>
</a>"""

# Insert JS before </script>
if 'loadCoinVB' not in content:
    content = content.replace('</script>', vb_js + '\n</script>', 1)

# Insert card HTML before closing grid div (find last bot card and add after it)
if 'coin-vb-card' not in content:
    # Find the last </a> before </div> that closes the bot grid
    # Add the card before the hub dashboard section or before </body>
    # Look for the pattern of existing cards
    if 'coin-swing-card' in content:
        content = content.replace('</a>\n<div class="section-title"',
                                  '</a>\n' + vb_card + '\n<div class="section-title"', 1)
    elif '</div>\\n<div class="section-title">' in content:
        content = content.replace('</div>\n<div class="section-title">',
                                  vb_card + '\n</div>\n<div class="section-title">', 1)
    else:
        # Fallback: add before </body>
        content = content.replace('</body>', vb_card + '\n</body>', 1)

with open(filepath, 'w', encoding='utf-8') as f:
    f.write(content)

print('Hub VB patch done')
