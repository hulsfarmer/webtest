"""
코인 모멘텀 봇 v6.0 대시보드
- main.py에서 백그라운드 스레드로 실행
- 포트 8081, 내장 HTTP 서버 (Flask 불필요)
- 10초마다 자동 갱신
"""

import json
import os
import sqlite3
import threading
from datetime import datetime
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import Dict, Any

import pytz

KST = pytz.timezone("Asia/Seoul")

# ─── 공유 상태 (main.py에서 업데이트) ────────────────────────────────────
_state: Dict[str, Any] = {
    "version": "v6.0",
    "mode": "모의거래",
    "capital": 0,
    "updated_at": "-",
    "positions": [],
    "daily": {"trades": 0, "pnl": 0, "win": 0, "loss": 0, "win_rate": 0},
    "scan_tickers": 0,
    "cooldowns": 0,
    "btc_return": None,
    "recent_events": [],
}
_lock = threading.Lock()
_recent_events = []  # 최근 이벤트 (진입/청산/신호) 최대 20개


def update_state(pos_manager, risk_manager, client, scan_tickers, cooldowns, btc_return):
    """main.py의 루프에서 호출 — 상태 갱신"""
    global _recent_events

    now = datetime.now(KST).strftime("%Y-%m-%d %H:%M:%S")
    stats = risk_manager.stats
    total = stats.win_count + stats.loss_count
    wr = (stats.win_count / total * 100) if total > 0 else 0

    positions = []
    for ticker, pos in pos_manager.positions.items():
        price = client.get_current_price(ticker) or pos.entry_price
        pnl_pct = pos.pnl_pct(price) * 100
        trail_mult = pos_manager.cfg.TRAIL_ATR_MULT_2ND if pos.second_entry_done else pos_manager.cfg.TRAIL_ATR_MULT
        trail_stop = pos.max_price - pos.atr * trail_mult
        hard_stop = pos.entry_price - pos.atr * pos_manager.cfg.STOP_ATR_MULT
        trail_active = pnl_pct >= pos_manager.cfg.TRAIL_ACTIVATE_PCT * 100
        elapsed = (datetime.now(KST) - pos.entry_time).total_seconds() / 3600
        positions.append({
            "ticker": ticker.replace("KRW-", ""),
            "entry_price": pos.entry_price,
            "current_price": price,
            "pnl_pct": round(pnl_pct, 2),
            "max_price": pos.max_price,
            "trail_stop": trail_stop,
            "hard_stop": hard_stop,
            "trail_active": trail_active,
            "score": pos.score,
            "rs": round(pos.rs_score * 100, 2),
            "k": round(pos.adaptive_k, 3),
            "entry_time": pos.entry_time.strftime("%m/%d %H:%M"),
            "elapsed_h": round(elapsed, 1),
        })

    with _lock:
        _state.update({
            "updated_at": now,
            "capital": round(risk_manager.capital),
            "mode": "모의거래" if pos_manager.cfg.PAPER_TRADING else "실거래",
            "positions": positions,
            "daily": {
                "trades": stats.trade_count,
                "pnl": round(stats.total_pnl),
                "win": stats.win_count,
                "loss": stats.loss_count,
                "win_rate": round(wr, 1),
            },
            "scan_tickers": scan_tickers,
            "cooldowns": cooldowns,
            "btc_return": round(btc_return * 100, 2) if btc_return is not None else None,
            "recent_events": list(_recent_events),
        })


def add_event(event_type: str, ticker: str, detail: str):
    """진입/청산/신호 이벤트 기록"""
    global _recent_events
    now = datetime.now(KST).strftime("%H:%M:%S")
    event = {"time": now, "type": event_type, "ticker": ticker.replace("KRW-", ""), "detail": detail}
    _recent_events.insert(0, event)
    if len(_recent_events) > 20:
        _recent_events = _recent_events[:20]


# ─── HTML 렌더링 ─────────────────────────────────────────────────────────

def _render_html() -> str:
    with _lock:
        s = dict(_state)

    d = s["daily"]
    pnl_color = "#22c55e" if d["pnl"] >= 0 else "#ef4444"
    mode_color = "#f59e0b" if s["mode"] == "모의거래" else "#22c55e"
    btc_str = f"{s['btc_return']:+.2f}%" if s["btc_return"] is not None else "-"
    btc_color = "#22c55e" if (s["btc_return"] or 0) >= 0 else "#ef4444"

    positions_html = ""
    if s["positions"]:
        for p in s["positions"]:
            pnl_c = "#22c55e" if p["pnl_pct"] >= 0 else "#ef4444"
            trail_badge = '<span style="background:#22c55e;color:#000;padding:1px 6px;border-radius:4px;font-size:11px;">ON</span>' if p["trail_active"] else '<span style="background:#475569;color:#fff;padding:1px 6px;border-radius:4px;font-size:11px;">대기</span>'
            positions_html += f"""
            <tr>
              <td><b style="font-size:15px">{p['ticker']}</b></td>
              <td>{p['entry_price']:,.0f}</td>
              <td>{p['current_price']:,.0f}</td>
              <td style="color:{pnl_c};font-weight:bold">{p['pnl_pct']:+.2f}%</td>
              <td>{p['max_price']:,.0f}</td>
              <td>{p['trail_stop']:,.0f} {trail_badge}</td>
              <td>{p['hard_stop']:,.0f}</td>
              <td>{p['score']}점</td>
              <td style="color:#38bdf8">{p['rs']:+.2f}%</td>
              <td>{p['entry_time']} ({p['elapsed_h']}h)</td>
            </tr>"""
    else:
        positions_html = '<tr><td colspan="10" style="text-align:center;color:#64748b;padding:20px">포지션 없음</td></tr>'

    events_html = ""
    type_style = {
        "진입": "background:#1d4ed8;color:#fff",
        "손절": "background:#dc2626;color:#fff",
        "트레일링익절": "background:#16a34a;color:#fff",
        "타임스탑": "background:#78716c;color:#fff",
        "신호": "background:#7c3aed;color:#fff",
    }
    for ev in s["recent_events"]:
        style = type_style.get(ev["type"], "background:#334155;color:#fff")
        events_html += f"""
        <tr>
          <td style="color:#94a3b8">{ev['time']}</td>
          <td><span style="{style};padding:2px 8px;border-radius:4px;font-size:11px">{ev['type']}</span></td>
          <td><b>{ev['ticker']}</b></td>
          <td style="color:#cbd5e1">{ev['detail']}</td>
        </tr>"""
    if not events_html:
        events_html = '<tr><td colspan="4" style="text-align:center;color:#64748b;padding:20px">이벤트 없음</td></tr>'


    # ── EVO 규칙 섹션 ──────────────────────────────────────────
    evo_html = ""
    try:
        db_path = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                               "coin_evo_bot", "coin_evo.db")
        conn_evo = sqlite3.connect(db_path)
        conn_evo.row_factory = sqlite3.Row
        rules = conn_evo.execute("""
            SELECT id, conditions_json, win_rate, expected_value,
                   sample_count, status
            FROM rules
            WHERE win_rate >= 0.65 AND sample_count >= 100
            ORDER BY win_rate DESC
        """).fetchall()
        conn_evo.close()
        for r in rules:
            conds = json.loads(r["conditions_json"])
            labels = " + ".join(c[3] for c in conds)
            wr_pct = r["win_rate"] * 100
            ev_val = r["expected_value"]
            ev_color = "#22c55e" if ev_val >= 0 else "#ef4444"
            status_badge = ('<span style="background:#1d4ed8;color:#fff;padding:1px 6px;border-radius:4px;font-size:10px">active</span>'
                            if r["status"] == "active" else
                            '<span style="background:#475569;color:#fff;padding:1px 6px;border-radius:4px;font-size:10px">candidate</span>')
            evo_html += (
                f'<tr>'
                f'<td style="color:#94a3b8">#{r["id"]}</td>'
                f'<td style="color:#e2e8f0">{labels}</td>'
                f'<td style="font-weight:bold;color:#22c55e">{wr_pct:.0f}%</td>'
                f'<td style="color:{ev_color}">{ev_val:+.2f}%</td>'
                f'<td style="color:#94a3b8">{r["sample_count"]}</td>'
                f'<td>{status_badge}</td>'
                f'</tr>'
            )
        evo_count = len(rules)
    except Exception as e:
        evo_html = f'<tr><td colspan="6" style="color:#ef4444">오류: {e}</td></tr>'
        evo_count = 0

    evo_section_html = f"""
<div class="section">
  <h2>EVO 유효 규칙 ({evo_count}개)</h2>
  <table>
    <thead>
      <tr>
        <th>#</th><th>조건</th><th>승률</th><th>EV</th><th>샘플</th><th>상태</th>
      </tr>
    </thead>
    <tbody>{evo_html}</tbody>
  </table>
</div>
"""

    return f"""<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta http-equiv="refresh" content="10">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>코인봇 v6.0 대시보드</title>
<style>
  * {{ box-sizing: border-box; margin: 0; padding: 0; }}
  body {{ background: #0f172a; color: #e2e8f0; font-family: 'Segoe UI', sans-serif; padding: 20px; }}
  h1 {{ font-size: 22px; color: #f1f5f9; margin-bottom: 16px; }}
  h2 {{ font-size: 14px; color: #94a3b8; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 10px; }}
  .cards {{ display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: 24px; }}
  .card {{ background: #1e293b; border-radius: 10px; padding: 16px 22px; min-width: 140px; }}
  .card .label {{ font-size: 11px; color: #64748b; margin-bottom: 4px; }}
  .card .value {{ font-size: 22px; font-weight: bold; }}
  .section {{ background: #1e293b; border-radius: 10px; padding: 18px; margin-bottom: 20px; }}
  table {{ width: 100%; border-collapse: collapse; font-size: 13px; }}
  th {{ text-align: left; color: #64748b; font-weight: 500; padding: 6px 10px; border-bottom: 1px solid #334155; }}
  td {{ padding: 10px 10px; border-bottom: 1px solid #1e293b; }}
  tr:last-child td {{ border-bottom: none; }}
  .badge-paper {{ background: #78350f; color: #fbbf24; padding: 3px 10px; border-radius: 20px; font-size: 12px; }}
  .badge-real {{ background: #14532d; color: #4ade80; padding: 3px 10px; border-radius: 20px; font-size: 12px; }}
  .updated {{ color: #475569; font-size: 12px; margin-top: 16px; text-align: right; }}
</style>
</head>
<body>
<h1>⚡ 코인 모멘텀 봇 <span style="font-size:14px;color:#64748b">v6.0</span>
  &nbsp;<span class="{'badge-paper' if s['mode'] == '모의거래' else 'badge-real'}">{s['mode']}</span>
  &nbsp;<a href="http://138.2.12.110:8083/hub" style="font-size:13px;color:#38bdf8;text-decoration:none;margin-left:8px;">← 허브로</a>
</h1>
<p style="color:#94a3b8;font-size:13px;margin:-8px 0 12px 0">전략: evo_bot DB 규칙 기반 (승률 65%+ · 샘플 100+ · 보유 24~48h)</p>

<div class="cards">
  <div class="card">
    <div class="label">자본</div>
    <div class="value" style="font-size:18px">{s['capital']:,}원</div>
  </div>
  <div class="card">
    <div class="label">오늘 PnL</div>
    <div class="value" style="color:{pnl_color}">{d['pnl']:+,}원</div>
  </div>
  <div class="card">
    <div class="label">거래 / 승률</div>
    <div class="value" style="font-size:18px">{d['trades']}회 &nbsp;<span style="font-size:14px;color:#94a3b8">{d['win_rate']}%</span></div>
  </div>
  <div class="card">
    <div class="label">포지션</div>
    <div class="value">{len(s['positions'])}개</div>
  </div>
  <div class="card">
    <div class="label">스캔 대상</div>
    <div class="value" style="font-size:18px">{s['scan_tickers']}개</div>
  </div>
  <div class="card">
    <div class="label">BTC 1h</div>
    <div class="value" style="color:{btc_color};font-size:18px">{btc_str}</div>
  </div>
  <div class="card">
    <div class="label">쿨다운</div>
    <div class="value" style="font-size:18px">{s['cooldowns']}개</div>
  </div>
</div>

<div class="section">
  <h2>보유 포지션</h2>
  <table>
    <thead>
      <tr>
        <th>코인</th><th>진입가</th><th>현재가</th><th>PnL</th>
        <th>고점</th><th>트레일링 스탑</th><th>하드 손절</th>
        <th>점수</th><th>RS</th><th>진입시간</th>
      </tr>
    </thead>
    <tbody>{positions_html}</tbody>
  </table>
</div>

<div class="section">
  <h2>최근 이벤트</h2>
  <table>
    <thead><tr><th>시간</th><th>유형</th><th>코인</th><th>상세</th></tr></thead>
    <tbody>{events_html}</tbody>
  </table>
</div>

{evo_section_html}
<div class="updated">마지막 갱신: {s['updated_at']} &nbsp;·&nbsp; 10초마다 자동 갱신</div>
</body>
</html>"""


# ─── HTTP 서버 ────────────────────────────────────────────────────────────

DAYTRADE_STATE_PATH = os.path.join(os.path.dirname(__file__), "daytrade_coin_state.json")
DAYTRADE_DB_PATH    = os.path.join(os.path.dirname(__file__), "daytrade_coin.db")


def _load_coin_daytrade(detail=False):
    state = {"updated": "-", "positions": {}, "today_pnl": 0,
             "today_count": 0, "today_wins": 0, "today_closed": []}
    if os.path.exists(DAYTRADE_STATE_PATH):
        try:
            with open(DAYTRADE_STATE_PATH, encoding="utf-8") as f:
                state = json.load(f)
        except Exception:
            pass

    all_trades, total_pnl, trade_count, wins = [], 0, 0, 0
    if os.path.exists(DAYTRADE_DB_PATH):
        try:
            conn = sqlite3.connect(DAYTRADE_DB_PATH, timeout=3)
            conn.row_factory = sqlite3.Row
            rows = conn.execute(
                "SELECT * FROM trades ORDER BY date, entry_time"
            ).fetchall()
            conn.close()
            all_trades  = [dict(r) for r in rows]
            trade_count = len(all_trades)
            wins        = sum(1 for t in all_trades if (t.get("pnl") or 0) > 0)
            total_pnl   = sum(t.get("pnl") or 0 for t in all_trades)
        except Exception:
            pass

    from datetime import datetime as _dt
    today_str = _dt.now().strftime("%Y-%m-%d")
    today_closed = [t for t in all_trades if t.get("date") == today_str] if all_trades else []

    summary = {
        "updated":      state.get("updated", "-"),
        "mode":         state.get("mode", "모의거래"),
        "positions":    state.get("positions", {}),
        "today_pnl":    round(state.get("today_pnl", 0)),
        "today_count":  state.get("today_count", 0),
        "today_wins":   state.get("today_wins", 0),
        "total_pnl":        round(total_pnl),
        "total_return_pct": round(total_pnl / 1_000_000 * 100, 2),
        "trade_count":      trade_count,
        "win_rate":         round(wins / trade_count * 100, 1) if trade_count else 0,
        "today_closed":     today_closed,
    }
    if not detail:
        return summary

    COIN_INITIAL = 1_000_000
    curve = [{"date": "시작", "capital": COIN_INITIAL}]
    running = COIN_INITIAL
    for t in all_trades:
        running += t.get("pnl") or 0
        curve.append({"date": t["date"], "capital": round(running)})

    # 작업일지 로드
    changelog = []
    changelog_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "daytrade_changelog.json")
    if os.path.exists(changelog_path):
        try:
            with open(changelog_path, encoding="utf-8") as f:
                changelog = json.load(f)
        except Exception:
            pass

    return {**summary,
            "positions_detail": state.get("positions", {}),
            "today_closed":     today_closed,
            "curve":            curve,
            "changelog":        changelog}


def _render_daytrade_html() -> str:
    return """<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>코인 단타봇 대시보드</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: 'Segoe UI', sans-serif; background: #0f1117; color: #e0e0e0; padding: 20px; }
h1 { font-size: 1.4rem; color: #7eb8f7; margin-bottom: 16px; }
.updated { font-size: 0.75rem; color: #555; margin-bottom: 20px; }
.cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; margin-bottom: 24px; }
.card { background: #1a1d27; border-radius: 10px; padding: 16px; text-align: center; border: 1px solid #2a2d3a; }
.card .lbl { font-size: 0.72rem; color: #888; margin-bottom: 6px; }
.card .val { font-size: 1.3rem; font-weight: 700; }
.pos { color: #4cdf90; } .neg { color: #f05e5e; } .neu { color: #7eb8f7; } .wht { color: #e0e0e0; }
.section { background: #1a1d27; border-radius: 10px; padding: 16px; margin-bottom: 20px; border: 1px solid #2a2d3a; }
.section-title { font-size: 0.8rem; color: #94a3b8; margin-bottom: 10px; text-transform: uppercase; letter-spacing: 0.05em; }
.chart-wrap { position: relative; height: 200px; }
table { width: 100%; border-collapse: collapse; font-size: 0.82rem; }
th { color: #888; font-weight: 500; padding: 6px 8px; border-bottom: 1px solid #2a2d3a; text-align: left; }
td { padding: 6px 8px; border-bottom: 1px solid #1e2230; }
.err-msg { color: #f05e5e; font-size: 13px; padding: 12px; }
</style>
</head>
<body>
<h1>⚡ 코인 단타봇 <span style="font-size:13px;color:#94a3b8">WebSocket 3단계 복합신호</span>
  &nbsp;<a href="http://138.2.12.110:8083/hub" style="font-size:14px;color:#38bdf8;text-decoration:none;margin-left:12px;">← 허브로</a>
</h1>
<div style="margin-bottom:16px">
  <button id="mode-btn" onclick="toggleMode()" style="padding:8px 20px;border-radius:20px;border:none;cursor:pointer;font-size:13px;font-weight:bold"></button>
</div>
<div id="summary-cards" class="cards">
  <div class="card"><div class="lbl">전체 수익률</div><div class="val neu" id="total-ret">-</div></div>
  <div class="card"><div class="lbl">누적 손익</div><div class="val neu" id="total-pnl">-</div></div>
  <div class="card"><div class="lbl">오늘 손익</div><div class="val neu" id="today-pnl">-</div></div>
  <div class="card"><div class="lbl">전체 거래수</div><div class="val wht" id="trade-count">-</div></div>
  <div class="card"><div class="lbl">전체 승률</div><div class="val wht" id="win-rate">-</div></div>
  <div class="card"><div class="lbl">오늘 거래/승</div><div class="val wht" id="today-count">-</div></div>
  <div class="card"><div class="lbl">포지션</div><div class="val wht" id="positions">-</div></div>
</div>
<div class="section">
  <div class="section-title">자본 곡선</div>
  <div class="chart-wrap"><canvas id="chart"></canvas></div>
</div>
<div class="section">
  <div class="section-title">보유 포지션</div>
  <div id="pos-table"></div>
</div>
<div class="section">
  <div class="section-title">오늘 청산 내역</div>
  <div id="closed-table"></div>
</div>
<div class="section">
  <div class="section-title">작업일지</div>
  <div id="changelog"></div>
</div>
<div class="updated" id="updated-time">-</div>
<script>
let chartInst = null;
function pc(v){return v>=0?"pos":"neg";}
function fmt(n){return n==null?"-":Math.round(n).toLocaleString("ko-KR");}

async function loadAll() {
  try {
    const d = await fetch("/api/daytrade/detail").then(r=>r.json());

    const ret = d.total_return_pct||0;
    document.getElementById("total-ret").className = "val "+(ret>=0?"pos":"neg");
    document.getElementById("total-ret").textContent = (ret>=0?"+":"")+ret+"%";
    document.getElementById("total-pnl").className = "val "+(d.total_pnl>=0?"pos":"neg");
    document.getElementById("total-pnl").textContent = (d.total_pnl>=0?"+":"")+fmt(d.total_pnl)+"원";
    document.getElementById("today-pnl").className = "val "+(d.today_pnl>=0?"pos":"neg");
    document.getElementById("today-pnl").textContent = (d.today_pnl>=0?"+":"")+fmt(d.today_pnl)+"원";
    document.getElementById("trade-count").textContent = d.trade_count+"건";
    document.getElementById("win-rate").textContent = d.win_rate+"%";
    const todayWR = d.today_count ? Math.round(d.today_wins/d.today_count*100) : 0;
    document.getElementById("today-count").textContent = d.today_count+"건 "+todayWR+"%";
    const posCount = d.positions_detail ? Object.keys(d.positions_detail).length : d.positions;
    document.getElementById("positions").textContent = posCount+"/3";
    document.getElementById("updated-time").textContent = "봇 갱신: "+d.updated;

    // 모드 버튼
    const isLive = d.mode === "실거래";
    const btn = document.getElementById("mode-btn");
    btn.textContent = isLive ? "🔴 실거래 모드" : "🟡 모의거래 모드";
    btn.style.background = isLive ? "#dc2626" : "#78350f";
    btn.style.color = isLive ? "#fff" : "#fbbf24";

    // 자본 곡선
    if (d.curve && d.curve.length > 1) {
      const labels = d.curve.map(c=>c.date);
      const vals   = d.curve.map(c=>c.capital);
      if (chartInst) chartInst.destroy();
      chartInst = new Chart(document.getElementById("chart"), {
        type:"line",
        data:{labels,datasets:[{data:vals,borderColor:"#38bdf8",borderWidth:2,pointRadius:1,fill:true,backgroundColor:"rgba(56,189,248,0.07)"}]},
        options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{x:{ticks:{color:"#555",maxTicksLimit:8}},y:{ticks:{color:"#888",callback:v=>v.toLocaleString("ko-KR")}}}}
      });
    }

    // 보유 포지션
    const pos = d.positions_detail || {};
    const posKeys = Object.keys(pos);
    if (posKeys.length) {
      document.getElementById("pos-table").innerHTML =
        `<table><tr><th>코인</th><th>진입가</th><th>현재가</th><th>PnL</th><th>트레일링</th></tr>`+
        posKeys.map(k=>{const p=pos[k];return `<tr><td><b>${p.market||k}</b></td><td>${fmt(p.entry_price)}</td><td>${fmt(p.current_price||p.entry_price)}</td><td class="${pc(p.pnl||0)}">${fmt(p.pnl)}원</td><td>${p.trail_active?'<span style="color:#22c55e">ON</span>':'대기'}</td></tr>`;}).join("")+
        `</table>`;
    } else {
      document.getElementById("pos-table").innerHTML = `<p style="color:#64748b;font-size:13px;padding:8px">포지션 없음</p>`;
    }

    // 오늘 청산
    const closed = d.today_closed || [];
    if (closed.length) {
      document.getElementById("closed-table").innerHTML =
        `<table><tr><th>코인</th><th>진입</th><th>청산</th><th>PnL</th><th>수익률</th><th>결과</th></tr>`+
        closed.slice().reverse().map(t=>`<tr><td><b>${t.market||t.name||""}</b></td><td>${t.entry_time||""}</td><td>${t.exit_time||""}</td><td class="${pc(t.pnl||0)}">${fmt(t.pnl)}원</td><td class="${pc(t.return_pct||0)}" style="font-size:12px">${t.return_pct!=null?(t.return_pct>=0?"+":"")+t.return_pct+"%":"-"}</td><td style="color:#94a3b8;font-size:11px">${t.result||""}</td></tr>`).join("")+
        `</table>`;
    } else {
      document.getElementById("closed-table").innerHTML = `<p style="color:#64748b;font-size:13px;padding:8px">오늘 청산 내역 없음</p>`;
    }

    // 작업일지
    const cl = d.changelog || [];
    if (cl.length) {
      document.getElementById("changelog").innerHTML =
        `<table><tr><th style="width:90px">날짜</th><th style="width:50px">시간</th><th style="width:200px">변경사항</th><th>상세</th></tr>`+
        cl.slice().reverse().map(c=>`<tr><td style="color:#94a3b8">${c.date}</td><td style="color:#7eb8f7">${c.time}</td><td><b style="color:#e2e8f0">${c.title}</b></td><td style="color:#94a3b8;font-size:12px">${c.detail}</td></tr>`).join("")+
        `</table>`;
    } else {
      document.getElementById("changelog").innerHTML = `<p style="color:#64748b;font-size:13px;padding:8px">작업일지 없음</p>`;
    }
  } catch(e) {
    document.getElementById("today-pnl").textContent = "오류: "+e.message;
  }
}
async function toggleMode() {
  const btn = document.getElementById("mode-btn");
  const isLive = btn.textContent.includes("실거래");
  if (!isLive) {
    if (!confirm("⚠️ 실거래로 전환하시겠습니까?\\n실제 자금이 사용됩니다!")) return;
  }
  const pin = prompt("PIN 입력:");
  if (!pin) return;
  const r = await fetch("/api/daytrade/toggle-mode", {method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({pin})});
  const d2 = await r.json();
  if (d2.error) { alert(d2.error); return; }
  loadAll();
}
loadAll();
setInterval(loadAll, 15000);
</script>
</body>
</html>"""


class _Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/api":
            with _lock:
                s = dict(_state)
            body = json.dumps(s, ensure_ascii=False, default=str).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(body)
        elif self.path == "/api/prob" or self.path == "/api/prob_bot":
            try:
                import urllib.request
                req = urllib.request.urlopen("http://localhost:8082/api/prob", timeout=3)
                body = req.read()
            except:
                body = json.dumps({"status":"offline","name":"코인 확률봇 v1"}, ensure_ascii=False).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(body)
        elif self.path == "/api/daytrade/toggle-mode":
            # GET은 거부 — POST만 허용
            body = json.dumps({"error": "POST 요청만 허용됩니다"}, ensure_ascii=False).encode("utf-8")
            self.send_response(405)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        elif self.path == "/api/daytrade":
            body = json.dumps(_load_coin_daytrade(), ensure_ascii=False).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(body)
        elif self.path in ("/daytrade", "/api/daytrade/detail"):
            if self.path.endswith("/detail"):
                body = json.dumps(_load_coin_daytrade(detail=True), ensure_ascii=False).encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(body)
                return
            html = _render_daytrade_html().encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(html)))
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(html)
        else:
            html = _render_html().encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(html)))
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(html)

    def do_POST(self):
        if self.path == "/api/daytrade/toggle-mode":
            TOGGLE_PIN = "9482"  # 실거래 전환 PIN
            content_len = int(self.headers.get("Content-Length", 0))
            raw = self.rfile.read(content_len) if content_len > 0 else b"{}"
            try:
                data = json.loads(raw)
            except:
                data = {}
            pin = data.get("pin", "")
            if pin != TOGGLE_PIN:
                body = json.dumps({"error": "PIN이 올바르지 않습니다"}, ensure_ascii=False).encode("utf-8")
                self.send_response(403)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(body)
                return
            mode_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "daytrade_coin_mode.json")
            current = False
            try:
                if os.path.exists(mode_path):
                    with open(mode_path) as f:
                        current = json.load(f).get("live", False)
            except:
                pass
            new_mode = not current
            with open(mode_path, "w") as f:
                json.dump({"live": new_mode, "changed": datetime.now().strftime("%Y-%m-%d %H:%M:%S")}, f)
            body = json.dumps({"live": new_mode, "mode": "실거래" if new_mode else "모의거래"}, ensure_ascii=False).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(body)
        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, format, *args):
        pass  # 액세스 로그 비활성


def start(port: int = 8081):
    """백그라운드 스레드로 대시보드 HTTP 서버 시작"""
    server = HTTPServer(("0.0.0.0", port), _Handler)
    t = threading.Thread(target=server.serve_forever, daemon=True)
    t.start()
    import logging
    logging.getLogger("scalper").info(f"대시보드 시작: http://0.0.0.0:{port}")


if __name__ == "__main__":
    import signal, sys
    server = HTTPServer(("0.0.0.0", 8081), _Handler)
    print("대시보드 standalone 시작: http://0.0.0.0:8081")
    signal.signal(signal.SIGTERM, lambda *a: sys.exit(0))
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
