"""테스타 v2 봇 대시보드 — Flask + Chart.js (포트 8083)"""
import json, os, sqlite3
from datetime import datetime
from flask import Flask, jsonify, render_template_string

INITIAL_CAPITAL = 1_000_000
STATE_FILE  = os.path.join(os.path.dirname(__file__), "testa_state.json")
TRADES_FILE = os.path.join(os.path.dirname(__file__), "testa_trades.json")
PAPER_STATE = os.path.join(os.path.dirname(__file__), "daytrade_paper_state.json")
PAPER_DB    = os.path.join(os.path.dirname(__file__), "daytrade_paper.db")


def load_paper(detail=False):
    state = {"updated": "-", "positions": {}, "today_pnl": 0,
             "today_count": 0, "today_wins": 0, "today_closed": []}
    if os.path.exists(PAPER_STATE):
        with open(PAPER_STATE, encoding="utf-8") as f:
            state = json.load(f)

    all_trades, total_pnl, trade_count, wins = [], 0, 0, 0
    if os.path.exists(PAPER_DB):
        conn = sqlite3.connect(PAPER_DB)
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            "SELECT * FROM paper_trades ORDER BY date, entry_time"
        ).fetchall()
        conn.close()
        all_trades = [dict(r) for r in rows]
        trade_count = len(all_trades)
        wins        = sum(1 for t in all_trades if (t.get("pnl") or 0) > 0)
        total_pnl   = sum(t.get("pnl") or 0 for t in all_trades)

    win_rate = round(wins / trade_count * 100, 1) if trade_count else 0

    summary = {
        "updated":     state["updated"],
        "positions":   len(state.get("positions", {})),
        "today_pnl":   round(state.get("today_pnl", 0)),
        "today_count": state.get("today_count", 0),
        "today_wins":  state.get("today_wins", 0),
        "total_pnl":   round(total_pnl),
        "trade_count": trade_count,
        "win_rate":    win_rate,
    }

    if not detail:
        return summary

    # 상세 데이터 (전용 페이지용)
    PAPER_INITIAL = 1_000_000
    curve = [{"date": "시작", "capital": PAPER_INITIAL}]
    running = PAPER_INITIAL
    for t in all_trades:
        running += t.get("pnl") or 0
        curve.append({"date": t["date"], "capital": round(running)})

    tv_buckets = {"2~3배": [0,0], "3~5배": [0,0], "5배+": [0,0]}
    for t in all_trades:
        m = t.get("tv_mult") or 0
        b = "2~3배" if m < 3 else ("3~5배" if m < 5 else "5배+")
        tv_buckets[b][0] += 1
        if (t.get("pnl") or 0) > 0:
            tv_buckets[b][1] += 1
    tv_stats = [{"label": k, "count": v[0],
                 "win_rate": round(v[1]/v[0]*100) if v[0] else 0}
                for k, v in tv_buckets.items()]

    return {**summary,
            "positions":     state.get("positions", {}),
            "today_closed":  state.get("today_closed", []),
            "recent_trades": list(reversed(all_trades[-30:])),
            "curve":         curve,
            "tv_stats":      tv_stats}

# ── 데이터 로드 ───────────────────────────────────────────────
def load_data():
    state = {"capital": INITIAL_CAPITAL, "positions": {}, "total_pnl": 0, "trade_count": 0}
    if os.path.exists(STATE_FILE):
        with open(STATE_FILE) as f:
            state = json.load(f)

    trades = []
    if os.path.exists(TRADES_FILE):
        with open(TRADES_FILE) as f:
            trades = json.load(f)

    # 자산 곡선
    curve = [{"date": "시작", "capital": INITIAL_CAPITAL}]
    running = INITIAL_CAPITAL
    for t in trades:
        running += t.get("pnl", 0) or 0
        curve.append({"date": (t.get("date") or "")[:10], "capital": round(running)})

    # 보유 포지션 평가금액
    pos_value = sum(p.get("shares", 0) * p.get("entry_price", 0)
                    for p in state.get("positions", {}).values())
    total_assets = state["capital"] + pos_value
    pnl_pct      = (total_assets - INITIAL_CAPITAL) / INITIAL_CAPITAL * 100

    wins     = [t for t in trades if (t.get("pnl") or 0) > 0]
    win_rate = len(wins) / len(trades) * 100 if trades else 0

    avg_win  = sum(t["pnl_pct"] for t in wins) / len(wins) if wins else 0
    losses   = [t for t in trades if (t.get("pnl") or 0) <= 0]
    avg_loss = sum(t["pnl_pct"] for t in losses) / len(losses) if losses else 0
    rr       = abs(avg_win / avg_loss) if avg_loss else 0

    # MDD 계산
    capitals = [p["capital"] for p in curve]
    mdd = 0
    peak = capitals[0]
    for c in capitals:
        peak = max(peak, c)
        dd = (c - peak) / peak * 100
        mdd = min(mdd, dd)

    # 섹터별 성과
    sector_stats = {}
    for t in trades:
        s = t.get("sector", "기타")
        if s not in sector_stats:
            sector_stats[s] = {"count": 0, "pnl": 0, "wins": 0}
        sector_stats[s]["count"] += 1
        sector_stats[s]["pnl"]   += t.get("pnl", 0) or 0
        if (t.get("pnl") or 0) > 0:
            sector_stats[s]["wins"] += 1

    sectors = sorted([
        {"name": k,
         "count": v["count"],
         "pnl": round(v["pnl"]),
         "win_rate": round(v["wins"] / v["count"] * 100) if v["count"] else 0}
        for k, v in sector_stats.items()
    ], key=lambda x: -x["pnl"])

    return {
        "capital":      round(state["capital"]),
        "total_assets": round(total_assets),
        "pnl_pct":      round(pnl_pct, 1),
        "total_pnl":    round(state.get("total_pnl", 0)),
        "trade_count":  len(trades),
        "win_rate":     round(win_rate, 1),
        "avg_win":      round(avg_win, 1),
        "avg_loss":     round(avg_loss, 1),
        "rr":           round(rr, 2),
        "mdd":          round(mdd, 1),
        "positions":    list(state.get("positions", {}).items()),
        "recent_trades": list(reversed(trades[-30:])),
        "curve":        curve,
        "sectors":      sectors,
        "updated":      datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
    }


HUB_HTML = """<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>봇 통합 대시보드</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #0f172a; color: #e2e8f0; font-family: 'Segoe UI', sans-serif; padding: 20px; }
  h1 { font-size: 20px; color: #f1f5f9; margin-bottom: 4px; }
  .subtitle { font-size: 12px; color: #475569; margin-bottom: 22px; }
  .bots { display: grid; grid-template-columns: repeat(auto-fit, minmax(340px, 1fr)); gap: 20px; }
  .bot-card { background: #1e293b; border-radius: 12px; padding: 18px; border: 1px solid #334155; }
  .bot-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; }
  .bot-title { font-size: 15px; font-weight: bold; color: #f1f5f9; }
  .bot-link { font-size: 11px; color: #38bdf8; text-decoration: none; }
  .bot-link:hover { text-decoration: underline; }
  .status-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; margin-right: 6px; }
  .dot-ok { background: #22c55e; box-shadow: 0 0 6px #22c55e; }
  .dot-error { background: #ef4444; }
  .dot-loading { background: #f59e0b; animation: pulse 1s infinite; }
  @keyframes pulse { 0%,100%{opacity:1}50%{opacity:.4} }
  .cards { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 14px; }
  .card { background: #0f172a; border-radius: 8px; padding: 10px 14px; min-width: 100px; }
  .card .lbl { font-size: 10px; color: #64748b; margin-bottom: 3px; }
  .card .val { font-size: 18px; font-weight: bold; }
  .pos { color: #22c55e; } .neg { color: #ef4444; } .neu { color: #38bdf8; } .wht { color: #f1f5f9; }
  .section-title { font-size: 11px; color: #64748b; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 8px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th { color: #64748b; font-weight: 500; padding: 4px 8px; text-align: left; border-bottom: 1px solid #334155; }
  td { padding: 6px 8px; border-bottom: 1px solid #1e293b; }
  .badge { display: inline-block; padding: 1px 7px; border-radius: 4px; font-size: 10px; }
  .badge-paper { background: #78350f; color: #fbbf24; }
  .badge-real { background: #14532d; color: #4ade80; }
  .err-msg { color: #ef4444; font-size: 12px; padding: 12px; text-align: center; }
  .updated { font-size: 10px; color: #334155; text-align: right; margin-top: 10px; }
  .positions-empty { color: #475569; font-size: 12px; padding: 10px 0; }
  .events-list { max-height: 120px; overflow-y: auto; }
  .event-row { display: flex; gap: 8px; padding: 4px 0; border-bottom: 1px solid #1e293b; font-size: 11px; }
  .event-time { color: #64748b; min-width: 55px; }
  .event-type { padding: 0 6px; border-radius: 3px; font-size: 10px; }
  .type-진입{background:#1d4ed8;color:#fff} .type-손절{background:#dc2626;color:#fff}
  .type-트레일링익절{background:#16a34a;color:#fff} .type-타임스탑{background:#78716c;color:#fff}
  .type-신호{background:#7c3aed;color:#fff}
  .refresh-btn { background: #334155; border: none; color: #94a3b8; padding: 4px 10px; border-radius: 6px; cursor: pointer; font-size: 11px; }
  .refresh-btn:hover { background: #475569; }
</style>
</head>
<body>
<h1>⚡ 봇 통합 대시보드</h1>
<p class="subtitle" id="global-updated">로딩 중...</p>
<div class="bots">
  <div class="bot-card">
    <div class="bot-header">
      <span><span class="status-dot dot-loading" id="dot-coin"></span><span class="bot-title">코인 모멘텀 봇 v6.0</span></span>
      <span><button class="refresh-btn" onclick="loadCoin()">새로고침</button>&nbsp;<a class="bot-link" href="http://138.2.28.57:8081/" target="_blank">대시보드 ↗</a></span>
    </div>
    <div id="coin-content"><p style="color:#64748b;font-size:12px;padding:10px">로딩 중...</p></div>
  </div>
  <div class="bot-card">
    <div class="bot-header">
      <span><span class="status-dot dot-loading" id="dot-testa"></span><span class="bot-title">테스타 v2 봇 (주식)</span></span>
      <span><button class="refresh-btn" onclick="loadTesta()">새로고침</button>&nbsp;<a class="bot-link" href="http://138.2.12.110:8083/" target="_blank">대시보드 ↗</a></span>
    </div>
    <div id="testa-content"><p style="color:#64748b;font-size:12px;padding:10px">로딩 중...</p></div>
  </div>
  <div class="bot-card">
    <div class="bot-header">
      <span><span class="status-dot dot-loading" id="dot-evo"></span><span class="bot-title">EVO 봇 (주식 자가진화)</span></span>
      <span><button class="refresh-btn" onclick="loadEvo()">새로고침</button>&nbsp;<a class="bot-link" href="http://138.2.12.110:8080/" target="_blank">대시보드 ↗</a></span>
    </div>
    <div id="evo-content"><p style="color:#64748b;font-size:12px;padding:10px">로딩 중...</p></div>
  </div>
  <div class="bot-card">
    <div class="bot-header">
      <span><span class="status-dot dot-loading" id="dot-daytrade"></span><span class="bot-title">단타 가상거래봇 ⚡</span></span>
      <span><button class="refresh-btn" onclick="loadDaytrade()">새로고침</button>&nbsp;<a class="bot-link" href="http://138.2.12.110:8083/daytrade" target="_blank">대시보드 ↗</a></span>
    </div>
    <div id="daytrade-content"><p style="color:#64748b;font-size:12px;padding:10px">로딩 중...</p></div>
  </div>
  <div class="bot-card">
    <div class="bot-header">
      <span><span class="status-dot dot-loading" id="dot-coinday"></span><span class="bot-title">코인 단타봇 ⚡</span></span>
      <span><button class="refresh-btn" onclick="loadCoinDay()">새로고침</button>&nbsp;<a class="bot-link" href="http://138.2.28.57:8081/daytrade" target="_blank">대시보드 ↗</a></span>
    </div>
    <div id="coinday-content"><p style="color:#64748b;font-size:12px;padding:10px">로딩 중...</p></div>
  </div>
  <div class="bot-card">
    <div class="bot-header">
      <span><span class="status-dot dot-loading" id="dot-bear"></span><span class="bot-title">🐻 BearHunter (하락장 특화)</span></span>
      <span><button class="refresh-btn" onclick="loadBear()">새로고침</button>&nbsp;<a class="bot-link" href="http://138.2.12.110:8083/" target="_blank">대시보드 ↗</a></span>
    </div>
    <div id="bear-content"><p style="color:#64748b;font-size:12px;padding:10px">로딩 중...</p></div>
  </div>
</div>
<script>
function setDot(id, state) {
  document.getElementById("dot-"+id).className = "status-dot " + (state==="ok"?"dot-ok":state==="error"?"dot-error":"dot-loading");
}
function pc(v){return v>=0?"pos":"neg";}
function fmt(n){return n==null?"-":n.toLocaleString("ko-KR");}

async function loadCoin() {
  setDot("coin","loading");
  try {
    const d = await fetch("http://138.2.28.57:8081/api").then(r=>r.json());
    setDot("coin","ok");
    const daily=d.daily||{}, pos=d.positions||[], evts=d.recent_events||[];
    const pnl=daily.pnl||0;
    let posHTML = pos.length ? `<table><tr><th>코인</th><th>진입가</th><th>현재가</th><th>PnL</th><th>트레일링</th></tr>${pos.map(p=>`<tr><td><b>${p.ticker}</b></td><td>${fmt(p.entry_price)}</td><td>${fmt(p.current_price)}</td><td class="${pc(p.pnl_pct)}">${p.pnl_pct>0?"+":""}${p.pnl_pct}%</td><td>${p.trail_active?'<span style="color:#22c55e">ON</span>':'<span style="color:#64748b">대기</span>'}</td></tr>`).join("")}</table>` : `<p class="positions-empty">포지션 없음</p>`;
    let evHTML = evts.length ? `<div class="section-title" style="margin-top:12px">최근 이벤트</div><div class="events-list">${evts.slice(0,6).map(e=>`<div class="event-row"><span class="event-time">${e.time}</span><span class="event-type type-${e.type}">${e.type}</span><b>${e.ticker}</b><span style="color:#94a3b8">${e.detail}</span></div>`).join("")}</div>` : "";
    const modeBadge = d.mode==="실거래"?"badge-real":"badge-paper";
    document.getElementById("coin-content").innerHTML = `
      <div class="cards">
        <div class="card"><div class="lbl">자본</div><div class="val wht" style="font-size:15px">${fmt(d.capital)}원</div></div>
        <div class="card"><div class="lbl">오늘 PnL</div><div class="val ${pc(pnl)}">${pnl>=0?"+":""}${fmt(pnl)}원</div></div>
        <div class="card"><div class="lbl">거래/승률</div><div class="val neu" style="font-size:14px">${daily.trades||0}회 ${daily.win_rate||0}%</div></div>
        <div class="card"><div class="lbl">포지션</div><div class="val wht">${pos.length}개</div></div>
        <div class="card"><div class="lbl">BTC 1h</div><div class="val ${pc(d.btc_return)}" style="font-size:14px">${d.btc_return!=null?(d.btc_return>=0?"+":"")+d.btc_return+"%":"-"}</div></div>
        <div class="card"><div class="lbl">모드</div><div class="val" style="font-size:12px;padding-top:4px"><span class="badge ${modeBadge}">${d.mode}</span></div></div>
      </div>
      <div class="section-title">보유 포지션</div>${posHTML}${evHTML}
      <div class="updated">갱신: ${d.updated_at}</div>`;
  } catch(e) {
    setDot("coin","error");
    document.getElementById("coin-content").innerHTML=`<p class="err-msg">❌ 연결 실패<br><small style="color:#64748b">${e.message}</small></p>`;
  }
}

async function loadTesta() {
  setDot("testa","loading");
  try {
    const d = await fetch("http://138.2.12.110:8083/api").then(r=>r.json());
    setDot("testa","ok");
    const pos=d.positions||[], trades=d.recent_trades||[];
    let posHTML = pos.length ? `<table><tr><th>종목</th><th>수량</th><th>매수가</th><th>손절가</th></tr>${pos.map(([code,p])=>`<tr><td><b>${p.name||code}</b></td><td>${p.shares}주</td><td>${fmt(p.entry_price)}원</td><td class="neg">${fmt(Math.round(p.stop))}원</td></tr>`).join("")}</table>` : `<p class="positions-empty">포지션 없음</p>`;
    let recentHTML = trades.length ? `<div class="section-title" style="margin-top:12px">최근 거래</div><table><tr><th>종목</th><th>PnL</th><th>수익률</th><th>사유</th></tr>${trades.slice(0,3).map(t=>`<tr><td>${t.name||""}</td><td class="${pc(t.pnl||0)}">${fmt(Math.round(t.pnl||0))}원</td><td class="${pc(t.pnl_pct||0)}">${(t.pnl_pct||0)>=0?"+":""}${(t.pnl_pct||0).toFixed(1)}%</td><td style="color:#94a3b8;font-size:11px">${t.reason||""}</td></tr>`).join("")}</table>` : "";
    document.getElementById("testa-content").innerHTML = `
      <div class="cards">
        <div class="card"><div class="lbl">총 자산</div><div class="val neu" style="font-size:14px">${fmt(d.total_assets)}원</div></div>
        <div class="card"><div class="lbl">수익률</div><div class="val ${pc(d.pnl_pct)}">${d.pnl_pct>=0?"+":""}${d.pnl_pct}%</div></div>
        <div class="card"><div class="lbl">MDD</div><div class="val neg" style="font-size:14px">${d.mdd}%</div></div>
        <div class="card"><div class="lbl">거래/승률</div><div class="val wht" style="font-size:14px">${d.trade_count}건 ${d.win_rate}%</div></div>
        <div class="card"><div class="lbl">R/R</div><div class="val ${d.rr>=2?"pos":"neg"}" style="font-size:14px">${d.rr}</div></div>
        <div class="card"><div class="lbl">포지션</div><div class="val wht">${pos.length}/3</div></div>
      </div>
      <div class="section-title">보유 포지션</div>${posHTML}${recentHTML}
      <div class="updated">갱신: ${d.updated}</div>`;
  } catch(e) {
    setDot("testa","error");
    document.getElementById("testa-content").innerHTML=`<p class="err-msg">❌ 연결 실패<br><small style="color:#64748b">${e.message}</small></p>`;
  }
}

async function loadEvo() {
  setDot("evo","loading");
  try {
    const d = await fetch("http://138.2.12.110:8080/api").then(r=>r.json());
    setDot("evo","ok");
    document.getElementById("evo-content").innerHTML = `
      <div class="cards">
        <div class="card"><div class="lbl">자본</div><div class="val neu" style="font-size:14px">${fmt(d.capital)}원</div></div>
        <div class="card"><div class="lbl">수익률</div><div class="val ${pc(d.pnl_pct)}">${d.pnl_pct>=0?"+":""}${d.pnl_pct}%</div></div>
        <div class="card"><div class="lbl">거래수</div><div class="val wht">${d.trade_count}건</div></div>
        <div class="card"><div class="lbl">승률</div><div class="val wht">${d.win_rate}%</div></div>
        <div class="card"><div class="lbl">포지션</div><div class="val wht">${d.positions}개</div></div>
      </div>
      <div class="updated">갱신: ${d.updated}</div>`;
  } catch(e) {
    setDot("evo","error");
    document.getElementById("evo-content").innerHTML=`<p class="err-msg">❌ 연결 실패<br><small style="color:#64748b">${e.message}</small></p>`;
  }
}

async function loadDaytrade() {
  setDot("daytrade","loading");
  try {
    const d = await fetch("http://138.2.12.110:8083/api/paper").then(r=>r.json());
    setDot("daytrade","ok");
    const todayWR = d.today_count ? Math.round(d.today_wins/d.today_count*100) : 0;
    document.getElementById("daytrade-content").innerHTML = `
      <div class="cards">
        <div class="card"><div class="lbl">누적 손익</div><div class="val ${pc(d.total_pnl)}">${d.total_pnl>=0?"+":""}${fmt(d.total_pnl)}원</div></div>
        <div class="card"><div class="lbl">오늘 손익</div><div class="val ${pc(d.today_pnl)}">${d.today_pnl>=0?"+":""}${fmt(d.today_pnl)}원</div></div>
        <div class="card"><div class="lbl">오늘 거래/승률</div><div class="val wht" style="font-size:14px">${d.today_count}건 ${todayWR}%</div></div>
        <div class="card"><div class="lbl">전체 거래/승률</div><div class="val wht" style="font-size:14px">${d.trade_count}건 ${d.win_rate}%</div></div>
        <div class="card"><div class="lbl">오픈 포지션</div><div class="val wht">${d.positions}/3</div></div>
      </div>
      <div class="updated">봇 갱신: ${d.updated}</div>`;
  } catch(e) {
    setDot("daytrade","error");
    document.getElementById("daytrade-content").innerHTML=`<p class="err-msg">❌ 봇 미실행<br><small style="color:#64748b">장중에 daytrade_paper.py 실행 필요</small></p>`;
  }
}

async function loadCoinDay() {
  setDot("coinday","loading");
  try {
    const d = await fetch("http://138.2.28.57:8081/api/daytrade").then(r=>r.json());
    setDot("coinday","ok");
    const pos = d.positions || {};
    const posKeys = Object.keys(pos);
    const todayWR = d.today_count ? Math.round(d.today_wins/d.today_count*100) : 0;
    let posHTML = posKeys.length
      ? `<table><tr><th>코인</th><th>진입가</th><th>TP</th><th>SL</th><th>트레일링</th></tr>${posKeys.map(code=>{const p=pos[code];return `<tr><td><b>${p.name||code}</b></td><td>${fmt(p.entry_price)}</td><td class="pos">${fmt(p.tp_price)}</td><td class="neg">${fmt(p.sl_price)}</td><td>${p.trail_active?'<span style="color:#22c55e">ON</span>':'<span style="color:#64748b">대기</span>'}</td></tr>`;}).join("")}</table>`
      : `<p class="positions-empty">포지션 없음</p>`;
    document.getElementById("coinday-content").innerHTML = `
      <div class="cards">
        <div class="card"><div class="lbl">누적 손익</div><div class="val ${pc(d.total_pnl)}">${d.total_pnl>=0?"+":""}${fmt(d.total_pnl)}원</div></div>
        <div class="card"><div class="lbl">오늘 손익</div><div class="val ${pc(d.today_pnl)}">${d.today_pnl>=0?"+":""}${fmt(d.today_pnl)}원</div></div>
        <div class="card"><div class="lbl">오늘 거래/승률</div><div class="val wht" style="font-size:14px">${d.today_count}건 ${todayWR}%</div></div>
        <div class="card"><div class="lbl">전체 거래/승률</div><div class="val wht" style="font-size:14px">${d.trade_count}건 ${d.win_rate}%</div></div>
        <div class="card"><div class="lbl">포지션</div><div class="val wht">${posKeys.length}개</div></div>
      </div>
      <div class="section-title">보유 포지션</div>${posHTML}
      <div class="updated">갱신: ${d.updated}</div>`;
  } catch(e) {
    setDot("coinday","error");
    document.getElementById("coinday-content").innerHTML=`<p class="err-msg">❌ 연결 실패<br><small style="color:#64748b">${e.message}</small></p>`;
  }
}

async function loadBear() {
  setDot("bear","loading");
  try {
    const d = await fetch("http://138.2.12.110:8083/api/bear").then(r=>r.json());
    setDot("bear","ok");
    const pos = d.positions || {};
    const posKeys = Object.keys(pos);
    const haltBadge = d.halt ? '<span style="color:#f05e5e;font-size:11px">⛔ 중단</span>' : '<span style="color:#22c55e;font-size:11px">● 가동중</span>';
    let posHTML = posKeys.length
      ? `<table><tr><th>종목</th><th>전략</th><th>매수가</th><th>손절가</th></tr>${posKeys.map(code=>{const p=pos[code];return `<tr><td><b>${p.name||code}</b></td><td>${p.strategy}</td><td>${fmt(p.entry_price)}원</td><td class="neg">${fmt(Math.round(p.sl))}원</td></tr>`;}).join("")}</table>`
      : `<p class="positions-empty">포지션 없음</p>`;
    document.getElementById("bear-content").innerHTML = `
      <div class="cards">
        <div class="card"><div class="lbl">총 자산</div><div class="val neu" style="font-size:14px">${fmt(d.total_assets)}원</div></div>
        <div class="card"><div class="lbl">수익률</div><div class="val ${pc(d.pnl_pct)}">${d.pnl_pct>=0?"+":""}${d.pnl_pct}%</div></div>
        <div class="card"><div class="lbl">오늘 손익</div><div class="val ${pc(d.today_pnl)}">${d.today_pnl>=0?"+":""}${fmt(d.today_pnl)}원</div></div>
        <div class="card"><div class="lbl">거래/승률</div><div class="val wht" style="font-size:14px">${d.trade_count}건 ${d.win_rate}%</div></div>
        <div class="card"><div class="lbl">포지션</div><div class="val wht">${posKeys.length}/4</div></div>
        <div class="card"><div class="lbl">상태</div><div class="val" style="font-size:12px;padding-top:4px">${haltBadge}</div></div>
      </div>
      <div class="section-title">보유 포지션</div>${posHTML}
      <div class="updated">A전략: ${d.a_count}건(${d.a_wr}%) / B전략: ${d.b_count}건(${d.b_wr}%)</div>`;
  } catch(e) {
    setDot("bear","error");
    document.getElementById("bear-content").innerHTML=`<p class="err-msg">❌ 연결 실패<br><small style="color:#64748b">${e.message}</small></p>`;
  }
}

function loadAll() {
  document.getElementById("global-updated").textContent = "마지막 갱신: "+new Date().toLocaleString("ko-KR")+" · 30초 자동갱신";
  loadCoin(); loadTesta(); loadEvo(); loadDaytrade(); loadCoinDay(); loadBear();
}
loadAll();
setInterval(loadAll, 30000);
</script>
</body>
</html>"""

# ── HTML 템플릿 ───────────────────────────────────────────────
HTML = """<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="60">
<title>테스타 v2 대시보드</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: 'Segoe UI', sans-serif; background: #0f1117; color: #e0e0e0; padding: 20px; }
h1 { font-size: 1.4rem; color: #7eb8f7; margin-bottom: 16px; }
h2 { font-size: 1rem; color: #aaa; margin-bottom: 10px; }
.updated { font-size: 0.75rem; color: #555; margin-bottom: 20px; }

.cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; margin-bottom: 24px; }
.card { background: #1a1d27; border-radius: 10px; padding: 16px; text-align: center; border: 1px solid #2a2d3a; }
.card .label { font-size: 0.72rem; color: #888; margin-bottom: 6px; }
.card .value { font-size: 1.4rem; font-weight: 700; }
.pos  { color: #4cdf90; }
.neg  { color: #f05e5e; }
.neu  { color: #7eb8f7; }

.section { background: #1a1d27; border-radius: 10px; padding: 16px; margin-bottom: 20px; border: 1px solid #2a2d3a; }
.chart-wrap { position: relative; height: 220px; }

table { width: 100%; border-collapse: collapse; font-size: 0.82rem; }
th { background: #22263a; color: #888; padding: 8px; text-align: left; font-weight: 500; }
td { padding: 7px 8px; border-bottom: 1px solid #22263a; }
tr:hover td { background: #1f2335; }

.badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 0.72rem; }
.badge-pos { background: #1a3a2a; color: #4cdf90; }
.badge-neg { background: #3a1a1a; color: #f05e5e; }
.badge-sec { background: #1a2a3a; color: #7eb8f7; }
</style>
</head>
<body>
<h1>📈 테스타 v2 — 가상거래 대시보드</h1>
<p class="updated">마지막 갱신: {{ d.updated }} (60초 자동 새로고침)</p>

<!-- 요약 카드 -->
<div class="cards">
  <div class="card">
    <div class="label">총 자산</div>
    <div class="value neu">{{ "{:,}".format(d.total_assets) }}원</div>
  </div>
  <div class="card">
    <div class="label">수익률</div>
    <div class="value {{ 'pos' if d.pnl_pct >= 0 else 'neg' }}">{{ "{:+.1f}".format(d.pnl_pct) }}%</div>
  </div>
  <div class="card">
    <div class="label">총 손익</div>
    <div class="value {{ 'pos' if d.total_pnl >= 0 else 'neg' }}">{{ "{:+,}".format(d.total_pnl) }}원</div>
  </div>
  <div class="card">
    <div class="label">MDD</div>
    <div class="value neg">{{ "{:.1f}".format(d.mdd) }}%</div>
  </div>
  <div class="card">
    <div class="label">거래수 / 승률</div>
    <div class="value neu">{{ d.trade_count }}건 / {{ d.win_rate }}%</div>
  </div>
  <div class="card">
    <div class="label">평균 수익 / 손실</div>
    <div class="value neu">{{ "{:+.1f}".format(d.avg_win) }}% / {{ "{:.1f}".format(d.avg_loss) }}%</div>
  </div>
  <div class="card">
    <div class="label">R/R</div>
    <div class="value {{ 'pos' if d.rr >= 2 else 'neg' }}">{{ d.rr }}</div>
  </div>
  <div class="card">
    <div class="label">보유 포지션</div>
    <div class="value neu">{{ d.positions|length }}개 / 3개</div>
  </div>
</div>

<!-- 자산 곡선 -->
<div class="section">
  <h2>자산 곡선</h2>
  <div class="chart-wrap">
    <canvas id="curve"></canvas>
  </div>
</div>

<!-- 보유 포지션 -->
<div class="section">
  <h2>보유 포지션</h2>
  {% if d.positions %}
  <table>
    <tr><th>종목</th><th>섹터</th><th>수량</th><th>매수가</th><th>손절가</th><th>1차목표</th><th>1차완료</th><th>진입일</th></tr>
    {% for code, pos in d.positions %}
    <tr>
      <td><b>{{ pos.name }}</b> ({{ code }})</td>
      <td><span class="badge badge-sec">{{ pos.sector }}</span></td>
      <td>{{ pos.shares }}주</td>
      <td>{{ "{:,}".format(pos.entry_price) }}원</td>
      <td class="neg">{{ "{:,}".format(pos.stop|int) }}원</td>
      <td class="pos">{{ "{:,}".format(pos.target|int) }}원</td>
      <td>{{ '✅' if pos.half_sold else '—' }}</td>
      <td>{{ pos.entry_date[:10] }}</td>
    </tr>
    {% endfor %}
  </table>
  {% else %}
  <p style="color:#555; font-size:0.85rem;">보유 포지션 없음</p>
  {% endif %}
</div>

<!-- 섹터별 성과 -->
{% if d.sectors %}
<div class="section">
  <h2>섹터별 성과</h2>
  <table>
    <tr><th>섹터</th><th>거래수</th><th>승률</th><th>누적 손익</th></tr>
    {% for s in d.sectors %}
    <tr>
      <td><span class="badge badge-sec">{{ s.name }}</span></td>
      <td>{{ s.count }}건</td>
      <td class="{{ 'pos' if s.win_rate >= 50 else 'neg' }}">{{ s.win_rate }}%</td>
      <td class="{{ 'pos' if s.pnl >= 0 else 'neg' }}">{{ "{:+,}".format(s.pnl) }}원</td>
    </tr>
    {% endfor %}
  </table>
</div>
{% endif %}

<!-- 최근 거래 -->
<div class="section">
  <h2>최근 거래 (최대 30건)</h2>
  {% if d.recent_trades %}
  <table>
    <tr><th>날짜</th><th>종목</th><th>섹터</th><th>수량</th><th>매수가</th><th>매도가</th><th>손익</th><th>수익률</th><th>청산 사유</th></tr>
    {% for t in d.recent_trades %}
    <tr>
      <td>{{ (t.date or '')[:10] }}</td>
      <td><b>{{ t.name }}</b></td>
      <td><span class="badge badge-sec">{{ t.sector or '—' }}</span></td>
      <td>{{ t.qty }}주</td>
      <td>{{ "{:,}".format(t.entry_price|int) }}원</td>
      <td>{{ "{:,}".format(t.exit_price|int) }}원</td>
      <td class="{{ 'pos' if (t.pnl or 0) >= 0 else 'neg' }}">{{ "{:+,}".format(t.pnl|int) }}원</td>
      <td><span class="badge {{ 'badge-pos' if (t.pnl_pct or 0) >= 0 else 'badge-neg' }}">{{ "{:+.1f}".format(t.pnl_pct or 0) }}%</span></td>
      <td style="color:#aaa; font-size:0.78rem;">{{ t.reason }}</td>
    </tr>
    {% endfor %}
  </table>
  {% else %}
  <p style="color:#555; font-size:0.85rem;">거래 내역 없음</p>
  {% endif %}
</div>

<script>
const curve = {{ d.curve | tojson }};
const labels = curve.map(p => p.date);
const data   = curve.map(p => p.capital);
new Chart(document.getElementById('curve'), {
  type: 'line',
  data: {
    labels,
    datasets: [{
      label: '자산 (원)',
      data,
      borderColor: '#7eb8f7',
      backgroundColor: 'rgba(126,184,247,0.08)',
      borderWidth: 2,
      pointRadius: data.length > 30 ? 0 : 3,
      fill: true,
      tension: 0.3,
    }]
  },
  options: {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: false } },
    scales: {
      x: { ticks: { color: '#666', maxTicksLimit: 10 }, grid: { color: '#1e2130' } },
      y: { ticks: { color: '#666', callback: v => (v/10000).toFixed(0)+'만' }, grid: { color: '#1e2130' } }
    }
  }
});
</script>
</body>
</html>
"""

DAYTRADE_HTML = """<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>단타 가상거래봇</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: 'Segoe UI', sans-serif; background: #0f172a; color: #e2e8f0; padding: 20px; }
h1  { font-size: 1.3rem; color: #f1f5f9; margin-bottom: 4px; }
.sub { font-size: 0.72rem; color: #475569; margin-bottom: 20px; }
.back { font-size: 0.78rem; color: #38bdf8; text-decoration: none; margin-left: 12px; }
.cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; margin-bottom: 20px; }
.card  { background: #1e293b; border-radius: 10px; padding: 14px; text-align: center; border: 1px solid #334155; }
.card .lbl { font-size: 0.68rem; color: #64748b; margin-bottom: 5px; }
.card .val { font-size: 1.3rem; font-weight: 700; }
.pos{color:#22c55e;} .neg{color:#ef4444;} .neu{color:#38bdf8;} .wht{color:#f1f5f9;}
.section { background: #1e293b; border-radius: 10px; padding: 16px; margin-bottom: 16px; border: 1px solid #334155; }
.section h2 { font-size: 0.88rem; color: #64748b; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 12px; }
.chart-wrap { position: relative; height: 200px; }
table { width: 100%; border-collapse: collapse; font-size: 0.80rem; }
th { color: #64748b; font-weight: 500; padding: 6px 8px; text-align: left; border-bottom: 1px solid #334155; }
td { padding: 6px 8px; border-bottom: 1px solid #1e293b; }
tr:hover td { background: #162032; }
.badge { display: inline-block; padding: 2px 7px; border-radius: 4px; font-size: 0.70rem; }
.b-pos{background:#14532d;color:#4ade80;} .b-neg{background:#450a0a;color:#f87171;} .b-neu{background:#0f2a4a;color:#38bdf8;}
.empty { color: #475569; font-size: 0.83rem; padding: 10px 0; }
</style>
</head>
<body>
<h1>⚡ 단타 가상거래봇 <a class="back" href="/hub">← 허브로</a></h1>
<p class="sub" id="updated">로딩 중...</p>

<div class="cards" id="cards">
  <div class="card"><div class="lbl">누적 손익</div><div class="val" id="c-total">-</div></div>
  <div class="card"><div class="lbl">오늘 손익</div><div class="val" id="c-today">-</div></div>
  <div class="card"><div class="lbl">오늘 거래</div><div class="val wht" id="c-todaycnt">-</div></div>
  <div class="card"><div class="lbl">전체 거래수</div><div class="val wht" id="c-cnt">-</div></div>
  <div class="card"><div class="lbl">전체 승률</div><div class="val" id="c-wr">-</div></div>
  <div class="card"><div class="lbl">오픈 포지션</div><div class="val wht" id="c-pos">-</div></div>
</div>

<div class="section">
  <h2>오픈 포지션</h2>
  <div id="positions"><p class="empty">로딩 중...</p></div>
</div>

<div class="section">
  <h2>누적 손익 곡선</h2>
  <div class="chart-wrap"><canvas id="chart"></canvas></div>
</div>

<div class="section">
  <h2>거래대금 배수별 승률</h2>
  <div id="tv-stats"><p class="empty">로딩 중...</p></div>
</div>

<div class="section">
  <h2>오늘 거래</h2>
  <div id="today-trades"><p class="empty">로딩 중...</p></div>
</div>

<div class="section">
  <h2>최근 거래 (전체)</h2>
  <div id="all-trades"><p class="empty">로딩 중...</p></div>
</div>

<script>
const fmt = n => n == null ? "-" : Math.round(n).toLocaleString("ko-KR");
const pc  = v => v >= 0 ? "pos" : "neg";
let chart = null;

async function load() {
  try {
    const [summary, detail] = await Promise.all([
      fetch("/api/paper").then(r => r.json()),
      fetch("/api/paper/detail").then(r => r.json())
    ]);

    document.getElementById("updated").textContent = "봇 갱신: " + summary.updated + " · 30초 자동갱신";

    // 요약 카드
    document.getElementById("c-total").className = "val " + pc(summary.total_pnl);
    document.getElementById("c-total").textContent = (summary.total_pnl >= 0 ? "+" : "") + fmt(summary.total_pnl) + "원";
    document.getElementById("c-today").className = "val " + pc(summary.today_pnl);
    document.getElementById("c-today").textContent = (summary.today_pnl >= 0 ? "+" : "") + fmt(summary.today_pnl) + "원";
    const todayWR = summary.today_count ? Math.round(summary.today_wins / summary.today_count * 100) : 0;
    document.getElementById("c-todaycnt").textContent = summary.today_count + "건 / 승 " + summary.today_wins + "건 (" + todayWR + "%)";
    document.getElementById("c-cnt").textContent = summary.trade_count + "건";
    document.getElementById("c-wr").className = "val " + pc(summary.win_rate - 50);
    document.getElementById("c-wr").textContent = summary.win_rate + "%";
    document.getElementById("c-pos").textContent = summary.positions + " / 3개";

    // 오픈 포지션
    const posEl = document.getElementById("positions");
    if (detail.positions && Object.keys(detail.positions).length) {
      posEl.innerHTML = `<table><tr><th>종목</th><th>진입시각</th><th>진입가</th><th>수량</th><th>TP</th><th>SL</th><th>TV배수</th><th>등락률</th></tr>
        ${Object.entries(detail.positions).map(([code, p]) =>
          `<tr><td><b>${p.name}</b> (${code})</td><td>${p.entry_time}</td>
          <td>${fmt(p.entry_price)}원</td><td>${p.qty}주</td>
          <td class="pos">${fmt(p.tp_price)}원</td><td class="neg">${fmt(p.sl_price)}원</td>
          <td class="neu">${p.tv_mult}x</td>
          <td class="${pc(p.change_rate)}">${p.change_rate >= 0 ? "+" : ""}${p.change_rate.toFixed(1)}%</td></tr>`
        ).join("")}</table>`;
    } else {
      posEl.innerHTML = '<p class="empty">오픈 포지션 없음</p>';
    }

    // 손익 곡선
    const curve = detail.curve || [];
    if (chart) chart.destroy();
    chart = new Chart(document.getElementById("chart"), {
      type: "line",
      data: {
        labels: curve.map(p => p.date),
        datasets: [{ data: curve.map(p => p.capital),
          borderColor: "#22c55e", backgroundColor: "rgba(34,197,94,0.07)",
          borderWidth: 2, pointRadius: curve.length > 30 ? 0 : 3, fill: true, tension: 0.3 }]
      },
      options: { responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: "#475569", maxTicksLimit: 8 }, grid: { color: "#1e293b" } },
          y: { ticks: { color: "#475569", callback: v => (v/10000).toFixed(1)+"만" }, grid: { color: "#1e293b" } }
        }
      }
    });

    // TV배수별 승률
    const tvEl = document.getElementById("tv-stats");
    if (detail.tv_stats && detail.tv_stats.length) {
      tvEl.innerHTML = `<table><tr><th>구간</th><th>거래수</th><th>승률</th></tr>
        ${detail.tv_stats.map(s =>
          `<tr><td>${s.label}</td><td>${s.count}건</td>
          <td class="${pc(s.win_rate - 50)}">${s.win_rate}%</td></tr>`
        ).join("")}</table>`;
    } else {
      tvEl.innerHTML = '<p class="empty">데이터 없음</p>';
    }

    // 오늘 거래
    const todayEl = document.getElementById("today-trades");
    const todayTrades = detail.today_closed || [];
    if (todayTrades.length) {
      todayEl.innerHTML = tradeTable(todayTrades);
    } else {
      todayEl.innerHTML = '<p class="empty">오늘 거래 없음</p>';
    }

    // 전체 최근 거래
    const allEl = document.getElementById("all-trades");
    const allTrades = detail.recent_trades || [];
    if (allTrades.length) {
      allEl.innerHTML = tradeTable(allTrades);
    } else {
      allEl.innerHTML = '<p class="empty">거래 내역 없음</p>';
    }

  } catch(e) {
    document.getElementById("updated").textContent = "오류: " + e.message;
  }
}

function tradeTable(trades) {
  return `<table><tr><th>날짜</th><th>진입</th><th>청산</th><th>종목</th><th>진입가</th><th>청산가</th><th>손익</th><th>수익률</th><th>결과</th><th>TV배수</th></tr>
    ${trades.map(t => `<tr>
      <td>${t.date || ""}</td><td>${t.entry_time}</td><td>${t.exit_time}</td>
      <td><b>${t.name}</b></td>
      <td>${fmt(t.entry_price)}원</td><td>${fmt(t.exit_price)}원</td>
      <td class="${pc(t.pnl || 0)}">${(t.pnl||0) >= 0?"+":""}${fmt(t.pnl)}원</td>
      <td><span class="badge ${(t.return_pct||0)>=0?'b-pos':'b-neg'}">${(t.return_pct||0)>=0?"+":""}${(t.return_pct||0).toFixed(2)}%</span></td>
      <td><span class="badge ${t.result==='TP'?'b-pos':t.result==='SL'?'b-neg':'b-neu'}">${t.result}</span></td>
      <td class="neu">${(t.tv_mult||0).toFixed(1)}x</td>
    </tr>`).join("")}</table>`;
}

load();
setInterval(load, 30000);
</script>
</body>
</html>"""

# ── Flask 앱 ──────────────────────────────────────────────────
app = Flask(__name__)

@app.after_request
def add_cors(response):
    response.headers["Access-Control-Allow-Origin"] = "*"
    return response

@app.route("/")
def index():
    d = load_data()
    return render_template_string(HTML, d=type('D', (), d)())

@app.route("/api")
def api():
    return jsonify(load_data())

@app.route("/hub")
def hub():
    return render_template_string(HUB_HTML)

@app.route("/api/paper")
def api_paper():
    return jsonify(load_paper())

@app.route("/api/paper/detail")
def api_paper_detail():
    return jsonify(load_paper(detail=True))

@app.route("/daytrade")
def daytrade():
    return render_template_string(DAYTRADE_HTML)

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8083, debug=False)
