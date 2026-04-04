"""
통합 트레이딩 대시보드 — 포트 8083
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
탭 1: 테스타 v2 스윙봇
탭 2: 단타 가상거래봇
탭 3: BearHunter
탭 4: 갭상승 단타봇

실행: python3 dashboard_unified.py
"""

import json, os, sqlite3
from datetime import datetime
from flask import Flask, jsonify, render_template_string

BASE = os.path.dirname(os.path.abspath(__file__))

# ── 테스타 v2 데이터 ───────────────────────────────────
TESTA_INITIAL  = 1_000_000
TESTA_STATE    = os.path.join(BASE, "testa_state.json")
TESTA_TRADES   = os.path.join(BASE, "testa_trades.json")

def load_testa():
    state  = {"capital": TESTA_INITIAL, "positions": {}, "total_pnl": 0, "trade_count": 0}
    trades = []
    if os.path.exists(TESTA_STATE):
        with open(TESTA_STATE) as f:
            state = json.load(f)
    if os.path.exists(TESTA_TRADES):
        with open(TESTA_TRADES) as f:
            trades = json.load(f)

    curve = [{"date": "시작", "capital": TESTA_INITIAL}]
    running = TESTA_INITIAL
    for t in trades:
        running += t.get("pnl", 0) or 0
        curve.append({"date": (t.get("date") or "")[:10], "capital": round(running)})

    pos_value   = sum(p.get("shares", 0) * p.get("entry_price", 0)
                      for p in state.get("positions", {}).values())
    total_assets = state["capital"] + pos_value
    pnl_pct      = (total_assets - TESTA_INITIAL) / TESTA_INITIAL * 100

    wins     = [t for t in trades if (t.get("pnl") or 0) > 0]
    losses   = [t for t in trades if (t.get("pnl") or 0) <= 0]
    win_rate = len(wins) / len(trades) * 100 if trades else 0
    avg_win  = sum(t.get("pnl_pct", 0) for t in wins)  / len(wins)  if wins   else 0
    avg_loss = sum(t.get("pnl_pct", 0) for t in losses) / len(losses) if losses else 0
    rr       = abs(avg_win / avg_loss) if avg_loss else 0

    caps = [p["capital"] for p in curve]
    mdd, peak = 0, caps[0]
    for c in caps:
        peak = max(peak, c)
        mdd  = min(mdd, (c - peak) / peak * 100)

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
        {"name": k, "count": v["count"], "pnl": round(v["pnl"]),
         "win_rate": round(v["wins"] / v["count"] * 100) if v["count"] else 0}
        for k, v in sector_stats.items()
    ], key=lambda x: -x["pnl"])

    return {
        "capital":       round(state["capital"]),
        "total_assets":  round(total_assets),
        "pnl_pct":       round(pnl_pct, 1),
        "total_pnl":     round(state.get("total_pnl", 0)),
        "trade_count":   len(trades),
        "win_rate":      round(win_rate, 1),
        "avg_win":       round(avg_win, 1),
        "avg_loss":      round(avg_loss, 1),
        "rr":            round(rr, 2),
        "mdd":           round(mdd, 1),
        "positions":     list(state.get("positions", {}).items()),
        "recent_trades": list(reversed(trades[-20:])),
        "curve":         curve,
        "sectors":       sectors,
    }


# ── 단타봇 데이터 ──────────────────────────────────────
PAPER_DB    = os.path.join(BASE, "daytrade_paper.db")
PAPER_STATE = os.path.join(BASE, "daytrade_paper_state.json")

def load_paper():
    # 오늘 상태 (오픈 포지션 + 당일 거래)
    state = {"updated": "-", "positions": {}, "today_closed": [],
             "today_pnl": 0, "today_count": 0, "today_wins": 0}
    if os.path.exists(PAPER_STATE):
        with open(PAPER_STATE, encoding="utf-8") as f:
            state = json.load(f)

    # 전체 거래 이력 (SQLite)
    all_trades = []
    curve      = [{"date": "시작", "capital": 0}]
    total_pnl  = 0

    if os.path.exists(PAPER_DB):
        conn = sqlite3.connect(PAPER_DB)
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            "SELECT * FROM paper_trades ORDER BY date, entry_time"
        ).fetchall()
        conn.close()
        all_trades = [dict(r) for r in rows]

        running = 0
        for t in all_trades:
            running += t.get("pnl", 0) or 0
            curve.append({"date": t["date"], "capital": round(running)})
        total_pnl = running

    wins     = [t for t in all_trades if (t.get("pnl") or 0) > 0]
    losses   = [t for t in all_trades if (t.get("pnl") or 0) <= 0]
    win_rate = len(wins) / len(all_trades) * 100 if all_trades else 0
    avg_win  = sum(t.get("return_pct", 0) for t in wins)   / len(wins)   if wins   else 0
    avg_loss = sum(t.get("return_pct", 0) for t in losses)  / len(losses) if losses else 0
    rr       = abs(avg_win / avg_loss) if avg_loss else 0

    # TV배수별 승률 집계
    tv_buckets = {"2~3배": [0, 0], "3~5배": [0, 0], "5배+": [0, 0]}
    for t in all_trades:
        m = t.get("tv_mult", 0) or 0
        bucket = "2~3배" if m < 3 else ("3~5배" if m < 5 else "5배+")
        tv_buckets[bucket][0] += 1
        if (t.get("pnl") or 0) > 0:
            tv_buckets[bucket][1] += 1
    tv_stats = [
        {"label": k, "count": v[0],
         "win_rate": round(v[1] / v[0] * 100) if v[0] else 0}
        for k, v in tv_buckets.items()
    ]

    # 결과별 집계
    result_counts = {}
    for t in all_trades:
        r = t.get("result", "?")
        result_counts[r] = result_counts.get(r, 0) + 1

    return {
        "updated":       state["updated"],
        "positions":     state["positions"],
        "today_closed":  state.get("today_closed", []),
        "today_pnl":     state.get("today_pnl", 0),
        "today_count":   state.get("today_count", 0),
        "today_wins":    state.get("today_wins", 0),
        "total_pnl":     round(total_pnl),
        "trade_count":   len(all_trades),
        "win_rate":      round(win_rate, 1),
        "avg_win":       round(avg_win, 2),
        "avg_loss":      round(avg_loss, 2),
        "rr":            round(rr, 2),
        "recent_trades": list(reversed(all_trades[-20:])),
        "curve":         curve,
        "tv_stats":      tv_stats,
        "result_counts": result_counts,
    }



# ── BearHunter 데이터 ──────────────────────────────────
BEAR_INITIAL = 1_000_000
BEAR_STATE   = os.path.join(BASE, "bear_hunter_state.json")
BEAR_TRADES  = os.path.join(BASE, "bear_hunter_trades.json")

def load_bear():
    state = {"capital": BEAR_INITIAL, "positions": {}, "total_pnl": 0,
             "trade_count": 0, "today_pnl": 0, "today_wins": 0,
             "today_losses": 0, "halt": False}
    trades = []
    if os.path.exists(BEAR_STATE):
        with open(BEAR_STATE) as f:
            state = json.load(f)
    if os.path.exists(BEAR_TRADES):
        with open(BEAR_TRADES) as f:
            trades = json.load(f)

    curve = [{"date": "시작", "capital": BEAR_INITIAL}]
    running = BEAR_INITIAL
    for t in trades:
        running += t.get("pnl", 0) or 0
        curve.append({"date": (t.get("date") or "")[:10], "capital": round(running)})

    pos_value    = sum(p.get("shares", 0) * p.get("entry_price", 0)
                       for p in state.get("positions", {}).values())
    total_assets = state["capital"] + pos_value
    pnl_pct      = (total_assets - BEAR_INITIAL) / BEAR_INITIAL * 100

    wins     = [t for t in trades if (t.get("pnl") or 0) > 0]
    losses   = [t for t in trades if (t.get("pnl") or 0) <= 0]
    win_rate = len(wins) / len(trades) * 100 if trades else 0
    avg_win  = sum(t.get("pnl_pct", 0) for t in wins)  / len(wins)  if wins   else 0
    avg_loss = sum(t.get("pnl_pct", 0) for t in losses) / len(losses) if losses else 0
    rr       = abs(avg_win / avg_loss) if avg_loss else 0

    a_trades = [t for t in trades if t.get("strategy") == "A"]
    b_trades_list = [t for t in trades if t.get("strategy") == "B"]
    a_wr = len([t for t in a_trades if (t.get("pnl") or 0) > 0]) / len(a_trades) * 100 if a_trades else 0
    b_wr = len([t for t in b_trades_list if (t.get("pnl") or 0) > 0]) / len(b_trades_list) * 100 if b_trades_list else 0

    caps = [p["capital"] for p in curve]
    mdd, peak = 0, caps[0]
    for c in caps:
        peak = max(peak, c)
        mdd  = min(mdd, (c - peak) / peak * 100)

    return {
        "capital":       round(state["capital"]),
        "total_assets":  round(total_assets),
        "pnl_pct":       round(pnl_pct, 1),
        "total_pnl":     round(state.get("total_pnl", 0)),
        "today_pnl":     state.get("today_pnl", 0),
        "today_wins":    state.get("today_wins", 0),
        "today_losses":  state.get("today_losses", 0),
        "halt":          state.get("halt", False),
        "trade_count":   len(trades),
        "win_rate":      round(win_rate, 1),
        "avg_win":       round(avg_win, 1),
        "avg_loss":      round(avg_loss, 1),
        "rr":            round(rr, 2),
        "mdd":           round(mdd, 1),
        "positions":     state.get("positions", {}),
        "recent_trades": list(reversed(trades[-20:])),
        "curve":         curve,
        "a_count":       len(a_trades),
        "b_count":       len(b_trades_list),
        "a_wr":          round(a_wr, 1),
        "b_wr":          round(b_wr, 1),
    }


# ── 갭상승 단타봇 데이터 ──────────────────────────────────
GAPUP_DB        = os.path.join(BASE, "daytrade_gapup.db")
GAPUP_STATE     = os.path.join(BASE, "daytrade_gapup_state.json")
GAPUP_CHANGELOG = os.path.join(BASE, "daytrade_gapup_changelog.json")

def load_gapup():
    # 오늘 상태 (오픈 포지션 + 당일 거래)
    state = {"updated": "-", "positions": {}, "today_closed": [],
             "today_pnl": 0, "today_count": 0, "today_wins": 0}
    if os.path.exists(GAPUP_STATE):
        with open(GAPUP_STATE, encoding="utf-8") as f:
            state = json.load(f)

    # 전체 거래 이력 (SQLite)
    all_trades = []
    curve      = [{"date": "시작", "capital": 0}]
    total_pnl  = 0

    if os.path.exists(GAPUP_DB):
        conn = sqlite3.connect(GAPUP_DB)
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            "SELECT * FROM trades ORDER BY date, entry_time"
        ).fetchall()
        conn.close()
        all_trades = [dict(r) for r in rows]

        running = 0
        for t in all_trades:
            running += t.get("pnl", 0) or 0
            curve.append({"date": t["date"], "capital": round(running)})
        total_pnl = running

    wins     = [t for t in all_trades if (t.get("pnl") or 0) > 0]
    losses   = [t for t in all_trades if (t.get("pnl") or 0) <= 0]
    win_rate = len(wins) / len(all_trades) * 100 if all_trades else 0
    avg_win  = sum(t.get("return_pct", 0) for t in wins)   / len(wins)   if wins   else 0
    avg_loss = sum(t.get("return_pct", 0) for t in losses)  / len(losses) if losses else 0
    rr       = abs(avg_win / avg_loss) if avg_loss else 0

    return {
        "updated":       state["updated"],
        "positions":     state["positions"],
        "today_closed":  state.get("today_closed", []),
        "today_pnl":     state.get("today_pnl", 0),
        "today_count":   state.get("today_count", 0),
        "today_wins":    state.get("today_wins", 0),
        "total_pnl":     round(total_pnl),
        "trade_count":   len(all_trades),
        "win_rate":      round(win_rate, 1),
        "avg_win":       round(avg_win, 2),
        "avg_loss":      round(avg_loss, 2),
        "rr":            round(rr, 2),
        "recent_trades": list(reversed(all_trades[-20:])),
        "curve":         curve,
    }

def load_gapup_changelog():
    if os.path.exists(GAPUP_CHANGELOG):
        with open(GAPUP_CHANGELOG, encoding="utf-8") as f:
            return json.load(f)
    return []


# ── HTML ──────────────────────────────────────────────
HTML = """<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="60">
<title>통합 트레이딩 대시보드</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: 'Segoe UI', sans-serif; background: #0f1117; color: #e0e0e0; padding: 20px; }
h1  { font-size: 1.4rem; color: #7eb8f7; margin-bottom: 6px; }
h2  { font-size: 0.95rem; color: #aaa; margin-bottom: 10px; }
.updated { font-size: 0.72rem; color: #555; margin-bottom: 18px; }

/* 탭 */
.tabs { display: flex; gap: 8px; margin-bottom: 20px; }
.tab  { padding: 8px 22px; border-radius: 6px; cursor: pointer; font-size: 0.88rem;
        background: #1a1d27; color: #888; border: 1px solid #2a2d3a; transition: all .2s; }
.tab.active { background: #1e3a5f; color: #7eb8f7; border-color: #3a6fa8; }
.panel { display: none; }
.panel.active { display: block; }

/* 카드 */
.cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; margin-bottom: 20px; }
.card  { background: #1a1d27; border-radius: 10px; padding: 14px; text-align: center; border: 1px solid #2a2d3a; }
.card .label { font-size: 0.70rem; color: #777; margin-bottom: 5px; }
.card .value { font-size: 1.3rem; font-weight: 700; }
.pos { color: #4cdf90; } .neg { color: #f05e5e; } .neu { color: #7eb8f7; }

/* 섹션 */
.section { background: #1a1d27; border-radius: 10px; padding: 16px; margin-bottom: 16px; border: 1px solid #2a2d3a; }
.chart-wrap { position: relative; height: 200px; }

/* 테이블 */
table { width: 100%; border-collapse: collapse; font-size: 0.80rem; }
th { background: #22263a; color: #777; padding: 7px 8px; text-align: left; font-weight: 500; }
td { padding: 6px 8px; border-bottom: 1px solid #1e2130; }
tr:hover td { background: #1f2335; }

/* 배지 */
.badge { display: inline-block; padding: 2px 7px; border-radius: 4px; font-size: 0.70rem; }
.badge-pos { background: #1a3a2a; color: #4cdf90; }
.badge-neg { background: #3a1a1a; color: #f05e5e; }
.badge-neu { background: #1a2a3a; color: #7eb8f7; }

/* 상단 오버뷰 바 */
.overview { display: flex; gap: 20px; align-items: center; background: #13161f;
            border: 1px solid #2a2d3a; border-radius: 10px; padding: 12px 20px;
            margin-bottom: 20px; flex-wrap: wrap; }
.overview-item { text-align: center; min-width: 100px; }
.overview-item .lbl { font-size: 0.68rem; color: #666; margin-bottom: 3px; }
.overview-item .val { font-size: 1.1rem; font-weight: 700; }
.divider { width: 1px; height: 36px; background: #2a2d3a; }

/* 오픈 포지션 */
.pos-badge { display: inline-block; padding: 3px 10px; border-radius: 20px;
             background: #1e3a2a; color: #4cdf90; font-size: 0.78rem; }

/* 작업일지 */
.changelog-item { border-left: 3px solid #3a6fa8; padding: 8px 14px; margin-bottom: 10px; background: #13161f; border-radius: 0 6px 6px 0; }
.changelog-item .cl-date { font-size: 0.72rem; color: #666; }
.changelog-item .cl-ver  { font-size: 0.72rem; color: #7eb8f7; margin-left: 8px; }
.changelog-item .cl-title { font-size: 0.85rem; color: #e0e0e0; margin-top: 3px; }
.changelog-item .cl-detail { font-size: 0.75rem; color: #888; margin-top: 2px; }
</style>
</head>
<body>
<h1>📊 통합 트레이딩 대시보드</h1>
<p class="updated">마지막 갱신: {{ now }} (60초 자동 새로고침)</p>

<!-- 오버뷰 바 -->
<div class="overview">
  <div class="overview-item">
    <div class="lbl">테스타 v2 수익률</div>
    <div class="val {{ 'pos' if t.pnl_pct >= 0 else 'neg' }}">{{ "{:+.1f}".format(t.pnl_pct) }}%</div>
  </div>
  <div class="divider"></div>
  <div class="overview-item">
    <div class="lbl">단타봇 누적 손익</div>
    <div class="val {{ 'pos' if p.total_pnl >= 0 else 'neg' }}">{{ "{:+,}".format(p.total_pnl) }}원</div>
  </div>
  <div class="divider"></div>
  <div class="overview-item">
    <div class="lbl">단타봇 오늘 손익</div>
    <div class="val {{ 'pos' if p.today_pnl >= 0 else 'neg' }}">{{ "{:+,}".format(p.today_pnl|int) }}원</div>
  </div>
  <div class="divider"></div>
  <div class="overview-item">
    <div class="lbl">단타봇 오픈 포지션</div>
    <div class="val neu">{{ p.positions|length }}개</div>
  </div>
  <div class="divider"></div>
  <div class="overview-item">
    <div class="lbl">단타봇 전체 승률</div>
    <div class="val {{ 'pos' if p.win_rate >= 50 else 'neg' }}">{{ p.win_rate }}%</div>
  </div>
  <div class="divider"></div>
  <div class="overview-item">
    <div class="lbl">갭상승 누적 손익</div>
    <div class="val {{ 'pos' if g.total_pnl >= 0 else 'neg' }}">{{ "{:+,}".format(g.total_pnl) }}원</div>
  </div>
  <div class="divider"></div>
  <div class="overview-item">
    <div class="lbl">갭상승 오늘 손익</div>
    <div class="val {{ 'pos' if g.today_pnl >= 0 else 'neg' }}">{{ "{:+,}".format(g.today_pnl|int) }}원</div>
  </div>
</div>

<!-- 탭 -->
<div class="tabs">
  <div class="tab {{ 'active' if active_tab == 'testa' }}" onclick="switchTab('testa', this)">📈 테스타 v2 스윙봇</div>
  <div class="tab {{ 'active' if active_tab == 'paper' }}" onclick="switchTab('paper', this)">⚡ 단타 가상거래봇</div>
  <div class="tab {{ 'active' if active_tab == 'bear' }}" onclick="switchTab('bear', this)">🐻 BearHunter</div>
  <div class="tab {{ 'active' if active_tab == 'gapup' }}" onclick="switchTab('gapup', this)">🚀 갭상승 단타봇</div>
</div>

<!-- ══ 테스타 v2 패널 ══════════════════════════════════ -->
<div id="panel-testa" class="panel {{ 'active' if active_tab == 'testa' }}">
  <div class="cards">
    <div class="card"><div class="label">총 자산</div><div class="value neu">{{ "{:,}".format(t.total_assets) }}원</div></div>
    <div class="card"><div class="label">수익률</div><div class="value {{ 'pos' if t.pnl_pct >= 0 else 'neg' }}">{{ "{:+.1f}".format(t.pnl_pct) }}%</div></div>
    <div class="card"><div class="label">총 손익</div><div class="value {{ 'pos' if t.total_pnl >= 0 else 'neg' }}">{{ "{:+,}".format(t.total_pnl) }}원</div></div>
    <div class="card"><div class="label">MDD</div><div class="value neg">{{ "{:.1f}".format(t.mdd) }}%</div></div>
    <div class="card"><div class="label">거래수 / 승률</div><div class="value neu">{{ t.trade_count }}건 / {{ t.win_rate }}%</div></div>
    <div class="card"><div class="label">R/R</div><div class="value {{ 'pos' if t.rr >= 2 else 'neg' }}">{{ t.rr }}</div></div>
    <div class="card"><div class="label">평균 수익/손실</div><div class="value neu">{{ "{:+.1f}".format(t.avg_win) }}% / {{ "{:.1f}".format(t.avg_loss) }}%</div></div>
    <div class="card"><div class="label">보유 포지션</div><div class="value neu">{{ t.positions|length }}개 / 3개</div></div>
  </div>

  <div class="section">
    <h2>자산 곡선</h2>
    <div class="chart-wrap"><canvas id="testa-curve"></canvas></div>
  </div>

  <div class="section">
    <h2>보유 포지션</h2>
    {% if t.positions %}
    <table>
      <tr><th>종목</th><th>섹터</th><th>수량</th><th>매수가</th><th>손절가</th><th>1차목표</th><th>진입일</th></tr>
      {% for code, pos in t.positions %}
      <tr>
        <td><b>{{ pos.name }}</b> ({{ code }})</td>
        <td><span class="badge badge-neu">{{ pos.sector }}</span></td>
        <td>{{ pos.shares }}주</td>
        <td>{{ "{:,}".format(pos.entry_price) }}원</td>
        <td class="neg">{{ "{:,}".format(pos.stop|int) }}원</td>
        <td class="pos">{{ "{:,}".format(pos.target|int) }}원</td>
        <td>{{ pos.entry_date[:10] }}</td>
      </tr>
      {% endfor %}
    </table>
    {% else %}
    <p style="color:#555;font-size:0.83rem;">보유 포지션 없음</p>
    {% endif %}
  </div>

  {% if t.sectors %}
  <div class="section">
    <h2>섹터별 성과</h2>
    <table>
      <tr><th>섹터</th><th>거래수</th><th>승률</th><th>누적 손익</th></tr>
      {% for s in t.sectors %}
      <tr>
        <td><span class="badge badge-neu">{{ s.name }}</span></td>
        <td>{{ s.count }}건</td>
        <td class="{{ 'pos' if s.win_rate >= 50 else 'neg' }}">{{ s.win_rate }}%</td>
        <td class="{{ 'pos' if s.pnl >= 0 else 'neg' }}">{{ "{:+,}".format(s.pnl) }}원</td>
      </tr>
      {% endfor %}
    </table>
  </div>
  {% endif %}

  <div class="section">
    <h2>최근 거래</h2>
    {% if t.recent_trades %}
    <table>
      <tr><th>날짜</th><th>종목</th><th>수량</th><th>매수가</th><th>매도가</th><th>손익</th><th>수익률</th><th>사유</th></tr>
      {% for tr in t.recent_trades %}
      <tr>
        <td>{{ (tr.date or '')[:10] }}</td>
        <td><b>{{ tr.name }}</b></td>
        <td>{{ tr.qty }}주</td>
        <td>{{ "{:,}".format(tr.entry_price|int) }}원</td>
        <td>{{ "{:,}".format(tr.exit_price|int) }}원</td>
        <td class="{{ 'pos' if (tr.pnl or 0) >= 0 else 'neg' }}">{{ "{:+,}".format(tr.pnl|int) }}원</td>
        <td><span class="badge {{ 'badge-pos' if (tr.pnl_pct or 0) >= 0 else 'badge-neg' }}">{{ "{:+.1f}".format(tr.pnl_pct or 0) }}%</span></td>
        <td style="color:#aaa;font-size:0.75rem;">{{ tr.reason }}</td>
      </tr>
      {% endfor %}
    </table>
    {% else %}
    <p style="color:#555;font-size:0.83rem;">거래 내역 없음</p>
    {% endif %}
  </div>
</div>

<!-- ══ 단타봇 패널 ════════════════════════════════════ -->
<div id="panel-paper" class="panel {{ 'active' if active_tab == 'paper' }}">
  <p style="font-size:0.78rem;color:#555;margin-bottom:14px;">봇 업데이트: {{ p.updated }}</p>

  <div class="cards">
    <div class="card"><div class="label">누적 손익</div><div class="value {{ 'pos' if p.total_pnl >= 0 else 'neg' }}">{{ "{:+,}".format(p.total_pnl) }}원</div></div>
    <div class="card"><div class="label">오늘 손익</div><div class="value {{ 'pos' if p.today_pnl >= 0 else 'neg' }}">{{ "{:+,}".format(p.today_pnl|int) }}원</div></div>
    <div class="card"><div class="label">오늘 거래</div><div class="value neu">{{ p.today_count }}건 / 승 {{ p.today_wins }}건</div></div>
    <div class="card"><div class="label">전체 거래수</div><div class="value neu">{{ p.trade_count }}건</div></div>
    <div class="card"><div class="label">전체 승률</div><div class="value {{ 'pos' if p.win_rate >= 50 else 'neg' }}">{{ p.win_rate }}%</div></div>
    <div class="card"><div class="label">R/R</div><div class="value {{ 'pos' if p.rr >= 1.5 else 'neg' }}">{{ p.rr }}</div></div>
    <div class="card"><div class="label">평균 수익/손실</div><div class="value neu">{{ "{:+.2f}".format(p.avg_win) }}% / {{ "{:.2f}".format(p.avg_loss) }}%</div></div>
    <div class="card"><div class="label">오픈 포지션</div><div class="value neu">{{ p.positions|length }} / 3개</div></div>
  </div>

  <!-- 오픈 포지션 -->
  <div class="section">
    <h2>오픈 포지션 (실시간)</h2>
    {% if p.positions %}
    <table>
      <tr><th>종목</th><th>진입시각</th><th>진입가</th><th>수량</th><th>TP</th><th>SL</th><th>TV배수</th><th>등락률</th></tr>
      {% for code, pos in p.positions.items() %}
      <tr>
        <td><b>{{ pos.name }}</b> ({{ code }})</td>
        <td>{{ pos.entry_time }}</td>
        <td>{{ "{:,}".format(pos.entry_price) }}원</td>
        <td>{{ pos.qty }}주</td>
        <td class="pos">{{ "{:,}".format(pos.tp_price) }}원</td>
        <td class="neg">{{ "{:,}".format(pos.sl_price) }}원</td>
        <td class="neu">{{ pos.tv_mult }}x</td>
        <td class="{{ 'pos' if pos.change_rate >= 0 else 'neg' }}">{{ "{:+.1f}".format(pos.change_rate) }}%</td>
      </tr>
      {% endfor %}
    </table>
    {% else %}
    <p style="color:#555;font-size:0.83rem;">오픈 포지션 없음</p>
    {% endif %}
  </div>

  <!-- TV배수별 승률 -->
  {% if p.tv_stats %}
  <div class="section">
    <h2>거래대금 배수별 승률</h2>
    <table>
      <tr><th>구간</th><th>거래수</th><th>승률</th></tr>
      {% for s in p.tv_stats %}
      <tr>
        <td>{{ s.label }}</td>
        <td>{{ s.count }}건</td>
        <td class="{{ 'pos' if s.win_rate >= 50 else 'neg' }}">{{ s.win_rate }}%</td>
      </tr>
      {% endfor %}
    </table>
  </div>
  {% endif %}

  <!-- 누적 손익 곡선 -->
  <div class="section">
    <h2>누적 손익 곡선</h2>
    <div class="chart-wrap"><canvas id="paper-curve"></canvas></div>
  </div>

  <!-- 오늘 거래 -->
  <div class="section">
    <h2>오늘 거래</h2>
    {% if p.today_closed %}
    <table>
      <tr><th>진입</th><th>청산</th><th>종목</th><th>진입가</th><th>청산가</th><th>손익</th><th>수익률</th><th>결과</th><th>TV배수</th></tr>
      {% for tr in p.today_closed %}
      <tr>
        <td>{{ tr.entry_time }}</td>
        <td>{{ tr.exit_time }}</td>
        <td><b>{{ tr.name }}</b></td>
        <td>{{ "{:,}".format(tr.entry_price|int) }}원</td>
        <td>{{ "{:,}".format(tr.exit_price|int) }}원</td>
        <td class="{{ 'pos' if (tr.pnl or 0) >= 0 else 'neg' }}">{{ "{:+,}".format(tr.pnl|int) }}원</td>
        <td><span class="badge {{ 'badge-pos' if (tr.return_pct or 0) >= 0 else 'badge-neg' }}">{{ "{:+.2f}".format(tr.return_pct or 0) }}%</span></td>
        <td><span class="badge {{ 'badge-pos' if tr.result == 'TP' else ('badge-neg' if tr.result == 'SL' else 'badge-neu') }}">{{ tr.result }}</span></td>
        <td class="neu">{{ "{:.1f}".format(tr.tv_mult or 0) }}x</td>
      </tr>
      {% endfor %}
    </table>
    {% else %}
    <p style="color:#555;font-size:0.83rem;">오늘 거래 없음</p>
    {% endif %}
  </div>

  <!-- 최근 전체 거래 -->
  <div class="section">
    <h2>최근 거래 (최대 20건)</h2>
    {% if p.recent_trades %}
    <table>
      <tr><th>날짜</th><th>진입</th><th>종목</th><th>진입가</th><th>청산가</th><th>손익</th><th>수익률</th><th>결과</th><th>TV배수</th></tr>
      {% for tr in p.recent_trades %}
      <tr>
        <td>{{ tr.date }}</td>
        <td>{{ tr.entry_time }}</td>
        <td><b>{{ tr.name }}</b></td>
        <td>{{ "{:,}".format(tr.entry_price|int) }}원</td>
        <td>{{ "{:,}".format(tr.exit_price|int) }}원</td>
        <td class="{{ 'pos' if (tr.pnl or 0) >= 0 else 'neg' }}">{{ "{:+,}".format(tr.pnl|int) }}원</td>
        <td><span class="badge {{ 'badge-pos' if (tr.return_pct or 0) >= 0 else 'badge-neg' }}">{{ "{:+.2f}".format(tr.return_pct or 0) }}%</span></td>
        <td><span class="badge {{ 'badge-pos' if tr.result == 'TP' else ('badge-neg' if tr.result == 'SL' else 'badge-neu') }}">{{ tr.result }}</span></td>
        <td class="neu">{{ "{:.1f}".format(tr.tv_mult or 0) }}x</td>
      </tr>
      {% endfor %}
    </table>
    {% else %}
    <p style="color:#555;font-size:0.83rem;">거래 내역 없음</p>
    {% endif %}
  </div>
</div>
<!-- ══ BearHunter 패널 ════════════════════════════════ -->
<div id="panel-bear" class="panel {{ 'active' if active_tab == 'bear' }}">
  <p style="font-size:0.78rem;color:#555;margin-bottom:14px;">
    {% if b.halt %}<span style="color:#f05e5e">⛔ 당일 거래 중단</span>{% else %}<span style="color:#4cdf90">● 가동 중</span>{% endif %}
  </p>
  <div class="cards">
    <div class="card"><div class="label">총 자산</div><div class="value neu">{{ "{:,}".format(b.total_assets) }}원</div></div>
    <div class="card"><div class="label">수익률</div><div class="value {{ 'pos' if b.pnl_pct >= 0 else 'neg' }}">{{ "{:+.1f}".format(b.pnl_pct) }}%</div></div>
    <div class="card"><div class="label">총 손익</div><div class="value {{ 'pos' if b.total_pnl >= 0 else 'neg' }}">{{ "{:+,}".format(b.total_pnl) }}원</div></div>
    <div class="card"><div class="label">MDD</div><div class="value neg">{{ "{:.1f}".format(b.mdd) }}%</div></div>
    <div class="card"><div class="label">오늘 손익</div><div class="value {{ 'pos' if b.today_pnl >= 0 else 'neg' }}">{{ "{:+,}".format(b.today_pnl|int) }}원</div></div>
    <div class="card"><div class="label">거래수 / 승률</div><div class="value neu">{{ b.trade_count }}건 / {{ b.win_rate }}%</div></div>
    <div class="card"><div class="label">R/R</div><div class="value {{ 'pos' if b.rr >= 2 else 'neg' }}">{{ b.rr }}</div></div>
    <div class="card"><div class="label">A전략 / B전략</div><div class="value neu">{{ b.a_count }}건({{ b.a_wr }}%) / {{ b.b_count }}건({{ b.b_wr }}%)</div></div>
  </div>
  <div class="section">
    <h2>자산 곡선</h2>
    <div class="chart-wrap"><canvas id="bear-curve"></canvas></div>
  </div>
  <div class="section">
    <h2>보유 포지션</h2>
    {% if b.positions %}
    <table>
      <tr><th>종목</th><th>전략</th><th>수량</th><th>매수가</th><th>손절가</th><th>익절가</th><th>진입시각</th></tr>
      {% for code, pos in b.positions.items() %}
      <tr>
        <td><b>{{ pos.name }}</b> ({{ code }})</td>
        <td><span class="badge {{ 'badge-neg' if pos.strategy == 'A' else 'badge-neu' }}">전략{{ pos.strategy }}</span></td>
        <td>{{ pos.shares }}주</td>
        <td>{{ "{:,}".format(pos.entry_price) }}원</td>
        <td class="neg">{{ "{:,}".format(pos.sl|int) }}원</td>
        <td class="pos">{{ "{:,}".format(pos.tp|int) if pos.tp else '타임스탑' }}</td>
        <td>{{ pos.entry_time[:16] }}</td>
      </tr>
      {% endfor %}
    </table>
    {% else %}
    <p style="color:#555;font-size:0.83rem;">보유 포지션 없음</p>
    {% endif %}
  </div>
  <div class="section">
    <h2>최근 거래 (최대 20건)</h2>
    {% if b.recent_trades %}
    <table>
      <tr><th>날짜</th><th>종목</th><th>전략</th><th>수량</th><th>매수가</th><th>매도가</th><th>손익</th><th>수익률</th><th>사유</th></tr>
      {% for tr in b.recent_trades %}
      <tr>
        <td>{{ (tr.date or '')[:10] }}</td>
        <td><b>{{ tr.name }}</b></td>
        <td><span class="badge {{ 'badge-neg' if tr.strategy == 'A' else 'badge-neu' }}">전략{{ tr.strategy }}</span></td>
        <td>{{ tr.shares }}주</td>
        <td>{{ "{:,}".format(tr.entry_price|int) }}원</td>
        <td>{{ "{:,}".format(tr.exit_price|int) }}원</td>
        <td class="{{ 'pos' if (tr.pnl or 0) >= 0 else 'neg' }}">{{ "{:+,}".format(tr.pnl|int) }}원</td>
        <td><span class="badge {{ 'badge-pos' if (tr.pnl_pct or 0) >= 0 else 'badge-neg' }}">{{ "{:+.1f}".format(tr.pnl_pct or 0) }}%</span></td>
        <td style="color:#aaa;font-size:0.75rem;">{{ tr.reason }}</td>
      </tr>
      {% endfor %}
    </table>
    {% else %}
    <p style="color:#555;font-size:0.83rem;">거래 내역 없음</p>
    {% endif %}
  </div>
</div>

<!-- ══ 갭상승 단타봇 패널 ════════════════════════════════ -->
<div id="panel-gapup" class="panel {{ 'active' if active_tab == 'gapup' }}">
  <p style="font-size:0.78rem;color:#555;margin-bottom:14px;">봇 업데이트: {{ g.updated }}</p>

  <div class="cards">
    <div class="card"><div class="label">누적 손익</div><div class="value {{ 'pos' if g.total_pnl >= 0 else 'neg' }}">{{ "{:+,}".format(g.total_pnl) }}원</div></div>
    <div class="card"><div class="label">오늘 손익</div><div class="value {{ 'pos' if g.today_pnl >= 0 else 'neg' }}">{{ "{:+,}".format(g.today_pnl|int) }}원</div></div>
    <div class="card"><div class="label">오늘 거래</div><div class="value neu">{{ g.today_count }}건 / 승 {{ g.today_wins }}건</div></div>
    <div class="card"><div class="label">전체 거래수</div><div class="value neu">{{ g.trade_count }}건</div></div>
    <div class="card"><div class="label">전체 승률</div><div class="value {{ 'pos' if g.win_rate >= 50 else 'neg' }}">{{ g.win_rate }}%</div></div>
    <div class="card"><div class="label">R/R</div><div class="value {{ 'pos' if g.rr >= 1.5 else 'neg' }}">{{ g.rr }}</div></div>
    <div class="card"><div class="label">평균 수익/손실</div><div class="value neu">{{ "{:+.2f}".format(g.avg_win) }}% / {{ "{:.2f}".format(g.avg_loss) }}%</div></div>
    <div class="card"><div class="label">오픈 포지션</div><div class="value neu">{{ g.positions|length }} / 3개</div></div>
  </div>

  <!-- 오픈 포지션 -->
  <div class="section">
    <h2>오픈 포지션 (실시간)</h2>
    {% if g.positions %}
    <table>
      <tr><th>종목</th><th>진입시각</th><th>진입가</th><th>수량</th><th>갭%</th><th>TV배수</th></tr>
      {% for code, pos in g.positions.items() %}
      <tr>
        <td><b>{{ pos.name }}</b> ({{ code }})</td>
        <td>{{ pos.entry_time }}</td>
        <td>{{ "{:,}".format(pos.entry_price) }}원</td>
        <td>{{ pos.qty }}주</td>
        <td class="pos">{{ "{:+.1f}".format(pos.gap_pct|default(0)) }}%</td>
        <td class="neu">{{ "{:.1f}".format(pos.tv_mult|default(0)) }}x</td>
      </tr>
      {% endfor %}
    </table>
    {% else %}
    <p style="color:#555;font-size:0.83rem;">오픈 포지션 없음</p>
    {% endif %}
  </div>

  <!-- 누적 손익 곡선 -->
  <div class="section">
    <h2>누적 손익 곡선</h2>
    <div class="chart-wrap"><canvas id="gapup-curve"></canvas></div>
  </div>

  <!-- 오늘 거래 -->
  <div class="section">
    <h2>오늘 거래</h2>
    {% if g.today_closed %}
    <table>
      <tr><th>진입</th><th>청산</th><th>종목</th><th>진입가</th><th>청산가</th><th>손익</th><th>수익률</th><th>결과</th><th>갭%</th><th>TV배수</th></tr>
      {% for tr in g.today_closed %}
      <tr>
        <td>{{ tr.entry_time }}</td>
        <td>{{ tr.exit_time }}</td>
        <td><b>{{ tr.name }}</b></td>
        <td>{{ "{:,}".format(tr.entry_price|int) }}원</td>
        <td>{{ "{:,}".format(tr.exit_price|int) }}원</td>
        <td class="{{ 'pos' if (tr.pnl or 0) >= 0 else 'neg' }}">{{ "{:+,}".format(tr.pnl|int) }}원</td>
        <td><span class="badge {{ 'badge-pos' if (tr.return_pct or 0) >= 0 else 'badge-neg' }}">{{ "{:+.2f}".format(tr.return_pct or 0) }}%</span></td>
        <td><span class="badge {{ 'badge-pos' if tr.result == 'TP' else ('badge-neg' if tr.result == 'SL' else 'badge-neu') }}">{{ tr.result }}</span></td>
        <td class="neu">{{ "{:.1f}".format(tr.gap_pct or 0) }}%</td>
        <td class="neu">{{ "{:.1f}".format(tr.tv_mult or 0) }}x</td>
      </tr>
      {% endfor %}
    </table>
    {% else %}
    <p style="color:#555;font-size:0.83rem;">오늘 거래 없음</p>
    {% endif %}
  </div>

  <!-- 최근 전체 거래 -->
  <div class="section">
    <h2>최근 거래 (최대 20건)</h2>
    {% if g.recent_trades %}
    <table>
      <tr><th>날짜</th><th>진입</th><th>종목</th><th>진입가</th><th>청산가</th><th>손익</th><th>수익률</th><th>결과</th><th>갭%</th><th>TV배수</th></tr>
      {% for tr in g.recent_trades %}
      <tr>
        <td>{{ tr.date }}</td>
        <td>{{ tr.entry_time }}</td>
        <td><b>{{ tr.name }}</b></td>
        <td>{{ "{:,}".format(tr.entry_price|int) }}원</td>
        <td>{{ "{:,}".format(tr.exit_price|int) }}원</td>
        <td class="{{ 'pos' if (tr.pnl or 0) >= 0 else 'neg' }}">{{ "{:+,}".format(tr.pnl|int) }}원</td>
        <td><span class="badge {{ 'badge-pos' if (tr.return_pct or 0) >= 0 else 'badge-neg' }}">{{ "{:+.2f}".format(tr.return_pct or 0) }}%</span></td>
        <td><span class="badge {{ 'badge-pos' if tr.result == 'TP' else ('badge-neg' if tr.result == 'SL' else 'badge-neu') }}">{{ tr.result }}</span></td>
        <td class="neu">{{ "{:.1f}".format(tr.gap_pct or 0) }}%</td>
        <td class="neu">{{ "{:.1f}".format(tr.tv_mult or 0) }}x</td>
      </tr>
      {% endfor %}
    </table>
    {% else %}
    <p style="color:#555;font-size:0.83rem;">거래 내역 없음</p>
    {% endif %}
  </div>

  <!-- 작업일지 -->
  <div class="section">
    <h2>작업일지</h2>
    {% if gc %}
    {% for entry in gc %}
    <div class="changelog-item">
      <span class="cl-date">{{ entry.date }}</span><span class="cl-ver">{{ entry.version }}</span>
      <div class="cl-title">{{ entry.title }}</div>
      <div class="cl-detail">{{ entry.detail }}</div>
    </div>
    {% endfor %}
    {% else %}
    <p style="color:#555;font-size:0.83rem;">작업일지 없음</p>
    {% endif %}
  </div>
</div>


<script>
// 탭 전환
function switchTab(name, el) {
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.getElementById('panel-' + name).classList.add('active');
  el.classList.add('active');
}

// 테스타 자산 곡선
const tCurve = {{ t.curve | tojson }};
new Chart(document.getElementById('testa-curve'), {
  type: 'line',
  data: {
    labels: tCurve.map(p => p.date),
    datasets: [{
      data: tCurve.map(p => p.capital),
      borderColor: '#7eb8f7', backgroundColor: 'rgba(126,184,247,0.07)',
      borderWidth: 2, pointRadius: tCurve.length > 30 ? 0 : 3, fill: true, tension: 0.3
    }]
  },
  options: {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { display: false } },
    scales: {
      x: { ticks: { color: '#555', maxTicksLimit: 8 }, grid: { color: '#1a1e2e' } },
      y: { ticks: { color: '#555', callback: v => (v/10000).toFixed(0)+'만' }, grid: { color: '#1a1e2e' } }
    }
  }
});

// 단타 누적 손익 곡선
const pCurve = {{ p.curve | tojson }};
new Chart(document.getElementById('paper-curve'), {
  type: 'line',
  data: {
    labels: pCurve.map(p => p.date),
    datasets: [{
      data: pCurve.map(p => p.capital),
      borderColor: '#4cdf90', backgroundColor: 'rgba(76,223,144,0.07)',
      borderWidth: 2, pointRadius: pCurve.length > 30 ? 0 : 3, fill: true, tension: 0.3
    }]
  },
  options: {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { display: false } },
    scales: {
      x: { ticks: { color: '#555', maxTicksLimit: 8 }, grid: { color: '#1a1e2e' } },
      y: { ticks: { color: '#555', callback: v => (v/10000).toFixed(1)+'만' }, grid: { color: '#1a1e2e' } }
    }
  }
});

// BearHunter 자산 곡선
const bCurve = {{ b.curve | tojson }};
new Chart(document.getElementById('bear-curve'), {
  type: 'line',
  data: {
    labels: bCurve.map(p => p.date),
    datasets: [{
      data: bCurve.map(p => p.capital),
      borderColor: '#f0a040', backgroundColor: 'rgba(240,160,64,0.07)',
      borderWidth: 2, pointRadius: bCurve.length > 30 ? 0 : 3, fill: true, tension: 0.3
    }]
  },
  options: {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { display: false } },
    scales: {
      x: { ticks: { color: '#555', maxTicksLimit: 8 }, grid: { color: '#1a1e2e' } },
      y: { ticks: { color: '#555', callback: v => (v/10000).toFixed(0)+'만' }, grid: { color: '#1a1e2e' } }
    }
  }
});

// 갭상승 단타봇 누적 손익 곡선
const gCurve = {{ g.curve | tojson }};
new Chart(document.getElementById('gapup-curve'), {
  type: 'line',
  data: {
    labels: gCurve.map(p => p.date),
    datasets: [{
      data: gCurve.map(p => p.capital),
      borderColor: '#e06cf0', backgroundColor: 'rgba(224,108,240,0.07)',
      borderWidth: 2, pointRadius: gCurve.length > 30 ? 0 : 3, fill: true, tension: 0.3
    }]
  },
  options: {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { display: false } },
    scales: {
      x: { ticks: { color: '#555', maxTicksLimit: 8 }, grid: { color: '#1a1e2e' } },
      y: { ticks: { color: '#555', callback: v => (v/10000).toFixed(1)+'만' }, grid: { color: '#1a1e2e' } }
    }
  }
});
</script>
</body>
</html>
"""

# ── Flask ──────────────────────────────────────────────
app = Flask(__name__)

def render_dashboard(active_tab="testa"):
    t = load_testa()
    p = load_paper()
    b = load_bear()
    g = load_gapup()
    gc = load_gapup_changelog()
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    return render_template_string(HTML,
        t=type('T', (), t)(),
        p=type('P', (), p)(),
        b=type('B', (), b)(),
        g=type('G', (), g)(),
        gc=gc,
        now=now,
        active_tab=active_tab
    )

@app.route("/")
def index():
    return render_dashboard()

@app.route("/hub")
def hub():
    return render_dashboard()

@app.route("/daytrade")
def daytrade():
    return render_dashboard(active_tab="gapup")

@app.route("/api/testa")
def api_testa():
    return jsonify(load_testa())

@app.route("/api/bear")
def api_bear():
    return jsonify(load_bear())

@app.route("/api/paper")
def api_paper():
    return jsonify(load_paper())

@app.route("/api/gapup")
def api_gapup():
    return jsonify(load_gapup())

if __name__ == "__main__":
    print("통합 대시보드 시작: http://localhost:8083")
    app.run(host="0.0.0.0", port=8083, debug=False)
