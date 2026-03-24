"""MarketSignal - Blog Publisher v2.0 (with warning labels) — Light Theme"""
import os
import json
import subprocess
from datetime import datetime
from database import get_conn, get_scores_by_date, get_accuracy_history
from config import BLOG_DIR, POSTS_DIR, TOP_DETAIL_COUNT
from economic_calendar import get_calendar_html
from economic_indicators import fetch_all_indicators, build_indicators_html, build_index_summary_html, calc_market_score
from market_news import fetch_and_score_news, build_news_html, get_market_news_score


def generate_daily_post(date=None):
    """Generate daily blog post as HTML"""
    if date is None:
        date = datetime.now().strftime("%Y-%m-%d")

    conn = get_conn()
    scores = get_scores_by_date(conn, date)

    if not scores:
        print(f"[Publisher] No scores for {date}")
        conn.close()
        return None

    accuracy_history = get_accuracy_history(conn, 30)
    recent_accuracy = accuracy_history[-1]["accuracy"] * 100 if accuracy_history else 0

    html = _build_html(date, scores, accuracy_history, recent_accuracy)

    filename = f"{date}.html"
    filepath = os.path.join(POSTS_DIR, filename)
    with open(filepath, "w", encoding="utf-8") as f:
        f.write(html)

    _update_index(conn, date)

    conn.close()
    print(f"[Publisher] Post generated: {filepath}")

    _git_push(date)

    return filepath


def _git_push(date):
    """Push blog to GitHub Pages"""
    try:
        cmds = [
            ["git", "add", "-A"],
            ["git", "commit", "-m", f"Update: {date} score"],
            ["git", "push"],
        ]
        for cmd in cmds:
            subprocess.run(cmd, cwd=BLOG_DIR, capture_output=True, text=True, timeout=30)
        print(f"[Publisher] Pushed to GitHub Pages")
    except Exception as e:
        print(f"[Publisher] Git push failed: {e}")


COMMON_CSS = """
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, 'Noto Sans KR', sans-serif; background: #f5f7fa; color: #2d3748; line-height: 1.6; }
    .container { max-width: 920px; margin: 0 auto; padding: 20px; }
    a { color: #3182ce; text-decoration: none; }
    a:hover { text-decoration: underline; }

    header { text-align: center; padding: 35px 0 25px; border-bottom: 2px solid #e2e8f0; }
    header h1 { font-size: 2.2em; color: #1a365d; margin-bottom: 5px; letter-spacing: -0.5px; }
    header .date { color: #718096; font-size: 1.05em; }
    header .accuracy { color: #38a169; margin-top: 8px; font-size: 0.95em; font-weight: 500; }

    .nav { text-align: center; padding: 12px 0; background: #fff; border-radius: 8px; margin: 15px 0; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
    .nav a { color: #3182ce; margin: 0 12px; font-weight: 500; font-size: 0.95em; }

    .section { margin: 25px 0; }
    .section h2 { color: #1a365d; margin-bottom: 15px; font-size: 1.25em; padding-bottom: 8px; border-bottom: 2px solid #e2e8f0; }

    .top-card { background: #fff; border-radius: 10px; padding: 18px 20px; margin-bottom: 12px;
                border-left: 4px solid #3182ce; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
    .top-card .rank { color: #3182ce; font-size: 1.4em; font-weight: bold; float: left; margin-right: 15px; width: 35px; }
    .top-card .name { font-size: 1.1em; font-weight: 600; color: #2d3748; }
    .top-card .score { font-size: 1.4em; font-weight: bold; float: right; }
    .top-card .score.high { color: #e53e3e; }
    .top-card .score.mid { color: #dd6b20; }
    .top-card .score.low { color: #3182ce; }
    .top-card .score.danger { color: #a0aec0; }
    .top-card .change { font-size: 0.8em; margin-left: 4px; }
    .change.up { color: #e53e3e; }
    .change.down { color: #3182ce; }
    .top-card .news { color: #4a5568; margin-top: 8px; font-size: 0.9em; }
    .top-card .comment { color: #718096; margin-top: 4px; font-size: 0.85em; font-style: italic; }
    .top-card .meta { color: #a0aec0; font-size: 0.8em; margin-top: 4px; }
    .clearfix::after { content: ""; display: table; clear: both; }

    .warning-badge { display: inline-block; background: #fed7d7; color: #c53030; font-size: 0.75em;
                     padding: 2px 8px; border-radius: 10px; margin-left: 8px; font-weight: 500; }
    .penalty-info { color: #e53e3e; font-size: 0.8em; margin-top: 2px; }
    .overheat-card { border-left-color: #ed8936; background: #fffaf0; }
    .warning-card { border-left-color: #e53e3e; background: #fff5f5; }

    table { width: 100%; border-collapse: collapse; margin-top: 10px; background: #fff; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
    th { background: #edf2f7; color: #2d3748; padding: 10px 12px; text-align: left; font-size: 0.85em; font-weight: 600; }
    td { padding: 8px 12px; border-bottom: 1px solid #edf2f7; font-size: 0.85em; }
    tr:hover { background: #f7fafc; }
    .score-cell { font-weight: bold; text-align: center; }
    .score-high { color: #e53e3e; }
    .score-mid { color: #dd6b20; }
    .score-low { color: #a0aec0; }

    .footer { text-align: center; padding: 25px 0; color: #a0aec0; font-size: 0.85em; border-top: 1px solid #e2e8f0; margin-top: 30px; }
    .footer a { color: #3182ce; }

    .promo { background: #ebf8ff; border: 1px solid #bee3f8; border-radius: 8px; padding: 14px; margin: 20px 0; text-align: center; }
    .promo a { color: #2b6cb0; font-weight: bold; }
"""


def _build_card(s, rank=None, is_warning=False):
    """Build a single stock card HTML"""
    score_class = "high" if s["score"] >= 70 else "mid" if s["score"] >= 50 else "low"
    if is_warning:
        score_class = "danger" if s["score"] < 30 else "low"

    change_val = s["score_change"]
    change_class = "up" if change_val > 0 else "down" if change_val < 0 else ""
    change_str = f"+{change_val}" if change_val > 0 else str(change_val)

    warning_label = s.get("warning_label", "") or ""
    penalty = s.get("penalty", 0) or 0
    raw_score = s.get("raw_score", 0) or 0

    # Card class based on penalty
    card_class = "top-card clearfix"
    if is_warning:
        card_class += " warning-card"
    elif penalty >= 20:
        card_class += " overheat-card"

    html = f'<div class="{card_class}">\n'

    if rank is not None:
        html += f'  <span class="rank">{rank}</span>\n'

    html += f'  <span class="score {score_class}">{s["score"]}점\n'
    html += f'    <span class="change {change_class}">({change_str})</span>\n'
    html += f'  </span>\n'
    html += f'  <div class="name">{s["name_kr"]} ({s["stock_code"]})'

    if warning_label:
        html += f' <span class="warning-badge">과열주의</span>'
    html += '</div>\n'

    html += f'  <div class="news">{s.get("key_news", "") or "뉴스 없음"}</div>\n'
    html += f'  <div class="comment">{s.get("ai_comment", "") or ""}</div>\n'

    if penalty > 0 and raw_score > 0:
        html += f'  <div class="penalty-info">AI 원점수 {raw_score}점 → 과열 페널티 -{penalty}점 적용</div>\n'

    if warning_label:
        html += f'  <div class="penalty-info">{warning_label}</div>\n'

    if rank is not None and not is_warning:
        html += f'  <div class="meta">긍정 {s["positive_count"]}건 / 부정 {s["negative_count"]}건 / 중립 {s["neutral_count"]}건</div>\n'

    html += '</div>\n'
    return html


def _build_html(date, scores, accuracy_history, recent_accuracy):
    """Build HTML blog post — light theme v2.0"""
    year, month, day = date.split("-")
    weekday_kr = ["월", "화", "수", "목", "금", "토", "일"]
    dt = datetime.strptime(date, "%Y-%m-%d")
    wday = weekday_kr[dt.weekday()]

    top10 = scores[:TOP_DETAIL_COUNT]
    bottom5 = sorted(scores, key=lambda x: x["score"])[:5]

    # Count penalized stocks
    penalized = [s for s in scores if (s.get("penalty") or 0) > 0]

    # 경제 지표 + 캘린더 가져오기
    try:
        indicators = fetch_all_indicators()
        indicators_html = build_indicators_html(indicators, compact=False)
    except Exception as e:
        print(f"[Publisher] Indicators failed: {e}")
        indicators_html = ""

    try:
        calendar_html = get_calendar_html(today_only=True)
    except Exception as e:
        print(f"[Publisher] Calendar failed: {e}")
        calendar_html = ""

    try:
        market_news_html = build_news_html()
    except Exception as e:
        print(f"[Publisher] Market news failed: {e}")
        market_news_html = ""

    html = f"""<!DOCTYPE html>
<html lang="ko">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>MarketSignal - {date} 뉴스 스코어</title>
    <meta name="description" content="AI가 분석한 한국 주식 상위 100개 종목 뉴스 점수 ({date})">
    <style>{COMMON_CSS}</style>
</head>
<body>
<div class="container">
    <header>
        <h1>MarketSignal</h1>
        <div class="date">{year}년 {month}월 {day}일 ({wday}) 뉴스 스코어</div>
        <div class="accuracy">AI 분석 정확도: {recent_accuracy:.1f}% (최근 30일)</div>
    </header>

    <div class="nav">
        <a href="../index.html">홈</a> |
        <a href="#indicators">경제 지표</a> |
        <a href="#news">주요 뉴스</a> |
        <a href="#calendar">발표 일정</a> |
        <a href="#top10">상위 10</a> |
        <a href="#warning">주의 종목</a> |
        <a href="#all">전체 100</a>
    </div>

    {indicators_html}

    {market_news_html}

    {calendar_html}
"""

    # Overheat notice
    if penalized:
        html += f"""
    <div style="background:#fffaf0; border:1px solid #fbd38d; border-radius:8px; padding:12px; margin:15px 0; font-size:0.9em; color:#744210;">
        <b>과열 감지:</b> {len(penalized)}개 종목에 과열 페널티가 적용되었습니다.
        급등주의 긍정 뉴스는 이미 주가에 반영되었을 가능성이 높습니다.
    </div>
"""

    html += f"""
    <div class="section" id="top10">
        <h2>상위 10 종목 (매수 긍정)</h2>
"""

    for i, s in enumerate(top10):
        html += _build_card(s, rank=i + 1)

    html += """
    </div>

    <div class="section" id="warning">
        <h2>주의 종목 (리스크)</h2>
"""
    for s in bottom5:
        html += _build_card(s, is_warning=True)

    html += """
    </div>

    <div class="promo">
        유튜브 쇼츠를 AI로 자동 생성하고 싶다면? <a href="https://shortsai.kr" target="_blank">ShortsAI.kr</a>
    </div>
"""

    # Full table
    html += """
    <div class="section" id="all">
        <h2>전체 100 종목 점수표</h2>
        <table>
            <thead>
                <tr>
                    <th>순위</th>
                    <th>종목</th>
                    <th>코드</th>
                    <th>점수</th>
                    <th>전일비</th>
                    <th>상태</th>
                    <th>핵심 뉴스</th>
                </tr>
            </thead>
            <tbody>
"""
    for i, s in enumerate(scores):
        score_class = "score-high" if s["score"] >= 65 else "score-mid" if s["score"] >= 45 else "score-low"
        change_val = s["score_change"]
        change_str = f"+{change_val}" if change_val > 0 else str(change_val)
        change_class = "up" if change_val > 0 else "down" if change_val < 0 else ""
        key_news = (s.get("key_news", "") or "")[:40]
        penalty = s.get("penalty", 0) or 0

        status = ""
        if penalty >= 20:
            status = '<span style="color:#e53e3e; font-size:0.8em;">과열</span>'
        elif penalty > 0:
            status = '<span style="color:#dd6b20; font-size:0.8em;">주의</span>'

        html += f"""
                <tr>
                    <td>{i+1}</td>
                    <td>{s['name_kr']}</td>
                    <td>{s['stock_code']}</td>
                    <td class="score-cell {score_class}">{s['score']}</td>
                    <td class="change {change_class}">{change_str}</td>
                    <td>{status}</td>
                    <td>{key_news}</td>
                </tr>
"""

    html += f"""
            </tbody>
        </table>
    </div>

    <div class="footer">
        <p>MarketSignal v3.1 - AI 뉴스 + 주가 데이터 + 경제 지표 기반 주식 스코어</p>
        <p>본 자료는 투자 참고용이며, 투자 판단의 책임은 본인에게 있습니다.</p>
        <p style="margin-top: 5px; font-size: 0.8em; color: #cbd5e0;">
            과열 페널티: 급등주(5일 +10% 이상), 과매수(RSI 70+) 종목에 자동 감점 적용
        </p>
        <p style="margin-top: 10px;">
            <a href="https://shortsai.kr">ShortsAI</a> |
            Generated by AI · Updated {date}
        </p>
        <p style="margin-top:8px;"><img src="https://api.visitorbadge.io/api/visitors?path=https%3A%2F%2Fmarketsignal.kr&label=visitors&countColor=%233182ce" alt="visitors"/></p>
    </div>
</div>
</body>
</html>"""

    return html


def _update_index(conn, latest_date):
    """Update blog index.html"""
    posts = []
    for f in sorted(os.listdir(POSTS_DIR), reverse=True):
        if f.endswith(".html"):
            posts.append(f.replace(".html", ""))

    scores = get_scores_by_date(conn, latest_date)
    top3 = scores[:3] if scores else []
    accuracy_history = get_accuracy_history(conn, 30)
    recent_accuracy = accuracy_history[-1]["accuracy"] * 100 if accuracy_history else 0

    # 홈페이지용 경제 지표 (compact) + 캘린더
    try:
        index_indicators_html = build_indicators_html(compact=True)
    except Exception as e:
        print(f"[Publisher] Index indicators failed: {e}")
        index_indicators_html = ""
    try:
        index_calendar_html = get_calendar_html()
    except Exception as e:
        print(f"[Publisher] Index calendar failed: {e}")
        index_calendar_html = ""

    try:
        market_news_html = build_news_html()
    except Exception as e:
        print(f"[Publisher] Market news failed: {e}")
        market_news_html = ""

    top3_html = ""
    for s in top3:
        penalty_tag = ""
        if (s.get("penalty") or 0) > 0:
            penalty_tag = ' <span style="color:#e53e3e; font-size:0.7em;">과열</span>'
        top3_html += f'<span style="margin-right:15px; color:#2d3748;">{s["name_kr"]} <b style="color:#e53e3e;">{s["score"]}점</b>{penalty_tag}</span>'

    post_list = ""
    for p in posts[:60]:
        post_list += f'<li><a href="posts/{p}.html">{p} 뉴스 스코어</a></li>\n'

    index_html = f"""<!DOCTYPE html>
<html lang="ko">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>MarketSignal - AI 주식 뉴스 스코어</title>
    <meta name="description" content="AI가 매일 분석하는 한국 주식 상위 100개 종목 뉴스 점수">
    <style>{COMMON_CSS}
        h1 {{ text-align: center; color: #1a365d; font-size: 2.5em; margin-bottom: 10px; letter-spacing: -0.5px; }}
        .subtitle {{ text-align: center; color: #718096; margin-bottom: 25px; font-size: 1.05em; }}
        .today {{ background: #fff; border-radius: 10px; padding: 25px; margin: 20px 0; text-align: center; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }}
        .today a {{ color: #1a365d; font-size: 1.2em; font-weight: 600; }}
        .today .preview {{ margin-top: 12px; }}
        .accuracy {{ text-align: center; color: #38a169; margin: 10px 0; font-weight: 500; }}
        .archive {{ margin-top: 30px; }}
        .archive h2 {{ color: #1a365d; margin-bottom: 15px; padding-bottom: 8px; border-bottom: 2px solid #e2e8f0; }}
        .archive ul {{ list-style: none; }}
        .archive li {{ padding: 10px 0; border-bottom: 1px solid #edf2f7; }}
        .archive a {{ color: #2d3748; font-weight: 500; }}
        .archive a:hover {{ color: #3182ce; }}
    </style>
</head>
<body>
<div class="container">
    <h1>MarketSignal</h1>
    <div class="subtitle">AI가 매일 분석하는 한국 주식 뉴스 + 주가 데이터 스코어</div>
    <div class="accuracy">분석 정확도: {recent_accuracy:.1f}% (최근 30일)</div>

    <div class="today">
        <a href="posts/{latest_date}.html">오늘의 스코어 ({latest_date})</a>
        <div class="preview">{top3_html}</div>
    </div>

    {index_indicators_html}

    {market_news_html}

    {index_calendar_html}

    <div class="promo">
        유튜브 쇼츠를 AI로 자동 생성! <a href="https://shortsai.kr" target="_blank">ShortsAI.kr</a>
    </div>

    <div class="archive">
        <h2>지난 스코어</h2>
        <ul>
            {post_list}
        </ul>
    </div>

    <div class="footer">
        <p>MarketSignal v3.1 - AI 뉴스 + 주가 데이터 + 경제 지표 기반 주식 스코어</p>
        <p>본 자료는 투자 참고용이며, 투자 판단의 책임은 본인에게 있습니다.</p>
        <p style="margin-top: 10px;"><a href="https://shortsai.kr">ShortsAI</a></p>
        <p style="margin-top:8px;"><img src="https://api.visitorbadge.io/api/visitors?path=https%3A%2F%2Fmarketsignal.kr&label=visitors&countColor=%233182ce" alt="visitors"/></p>
    </div>
</div>
</body>
</html>"""

    with open(os.path.join(BLOG_DIR, "index.html"), "w", encoding="utf-8") as f:
        f.write(index_html)

    _update_sitemap(posts)


def _update_sitemap(posts):
    """Generate sitemap.xml for SEO"""
    base = "https://hulsfarmer.github.io/marketsignal"
    urls = f"""  <url>
    <loc>{base}/</loc>
    <changefreq>daily</changefreq>
    <priority>1.0</priority>
  </url>
"""
    for p in posts[:90]:
        urls += f"""  <url>
    <loc>{base}/posts/{p}.html</loc>
    <lastmod>{p}</lastmod>
  </url>
"""

    sitemap = f"""<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
{urls}</urlset>
"""
    with open(os.path.join(BLOG_DIR, "sitemap.xml"), "w", encoding="utf-8") as f:
        f.write(sitemap)


if __name__ == "__main__":
    generate_daily_post()
