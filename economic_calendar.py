"""MarketSignal - Economic Calendar (경제 캘린더)
Forex Factory JSON API에서 이번 주 주요 경제 이벤트를 가져와
비전문가도 이해할 수 있도록 한글 번역 + 쉬운 해설 제공
"""
import json
import urllib.request
import urllib.error
from datetime import datetime, timedelta

# ============================================================
# 주요 경제 이벤트 한글 번역 + 쉬운 해설
# key: Forex Factory 이벤트명 (부분 매칭)
# ============================================================
EVENT_TRANSLATIONS = {
    # ── 미국 금리/통화정책 ──
    "Federal Funds Rate": {
        "name": "미국 기준금리 결정",
        "emoji": "🏦",
        "explain": "미국 중앙은행이 금리를 올리거나 내리는 날",
        "impact_kr": "금리 인상 → 달러 강세 → 코스피 하락 압력\n금리 인하 → 달러 약세 → 코스피 상승 기대",
        "keywords": ["금리", "FOMC"],
    },
    "FOMC Statement": {
        "name": "FOMC 성명서",
        "emoji": "📋",
        "explain": "미국 중앙은행의 경제 전망과 향후 금리 방향 발표",
        "impact_kr": "매파적(금리 인상 시사) → 주식시장 하락\n비둘기적(금리 인하 시사) → 주식시장 상승",
        "keywords": ["FOMC", "연준"],
    },
    "FOMC Press Conference": {
        "name": "FOMC 기자회견",
        "emoji": "🎤",
        "explain": "연준 의장이 금리 결정 이유를 설명하는 자리",
        "impact_kr": "의장 발언에 따라 시장이 크게 흔들릴 수 있음",
        "keywords": ["FOMC", "파월"],
    },
    "FOMC Meeting Minutes": {
        "name": "FOMC 회의록",
        "emoji": "📝",
        "explain": "지난 금리회의에서 위원들이 어떤 논의를 했는지 공개",
        "impact_kr": "금리 인상 논의가 많았으면 → 주식 하락\n금리 인하 논의가 많았으면 → 주식 상승",
        "keywords": ["FOMC", "회의록"],
    },

    # ── 고용 ──
    "Non-Farm Employment Change": {
        "name": "미국 비농업 고용자수",
        "emoji": "👷",
        "explain": "미국에서 한 달간 새로 생긴 일자리 수 (농업 제외)",
        "impact_kr": "예상보다 많으면 → 경기 좋다 → 금리 인상 우려 → 코스피 단기 하락\n예상보다 적으면 → 경기 둔화 → 금리 인하 기대 → 코스피 상승 기대",
        "keywords": ["고용", "NFP"],
    },
    "Unemployment Rate": {
        "name": "미국 실업률",
        "emoji": "📊",
        "explain": "미국에서 일자리를 구하지 못한 사람의 비율",
        "impact_kr": "실업률 상승 → 경기 둔화 → 금리 인하 기대 → 주식 상승 가능\n실업률 하락 → 경기 과열 → 금리 인상 우려 → 주식 하락 가능",
        "keywords": ["실업률"],
    },
    "Average Hourly Earnings": {
        "name": "미국 평균 시급",
        "emoji": "💰",
        "explain": "미국 근로자의 평균 시급 변화율",
        "impact_kr": "시급 상승 → 물가 상승 압력 → 금리 인상 우려\n시급 하락 → 물가 안정 → 금리 인하 기대",
        "keywords": ["시급", "임금"],
    },
    "ADP Non-Farm Employment Change": {
        "name": "ADP 민간 고용",
        "emoji": "👔",
        "explain": "민간 기업의 고용 변화 (공식 고용지표 2일 전 발표)",
        "impact_kr": "공식 고용지표의 '예고편' 역할\n결과가 좋으면 → 금요일 공식 고용도 좋을 것으로 기대",
        "keywords": ["ADP", "고용"],
    },
    "Unemployment Claims": {
        "name": "미국 신규 실업수당 청구",
        "emoji": "📋",
        "explain": "이번 주 새로 실업수당을 신청한 사람 수",
        "impact_kr": "청구 증가 → 고용 악화 신호 → 금리 인하 기대\n청구 감소 → 고용 호조 → 금리 유지/인상 우려",
        "keywords": ["실업수당"],
    },

    # ── 물가/인플레이션 ──
    "CPI m/m": {
        "name": "미국 소비자물가 (월간)",
        "emoji": "🛒",
        "explain": "미국 소비자가 사는 물건 가격이 한 달간 얼마나 올랐는지",
        "impact_kr": "예상보다 높으면 → 인플레이션 심화 → 금리 인상 → 코스피 하락\n예상보다 낮으면 → 인플레이션 둔화 → 금리 인하 기대 → 코스피 상승",
        "keywords": ["CPI", "물가"],
    },
    "CPI y/y": {
        "name": "미국 소비자물가 (연간)",
        "emoji": "🛒",
        "explain": "1년 전과 비교한 물가 상승률 (큰 그림 파악용)",
        "impact_kr": "높으면 → 물가가 여전히 높다 → 금리 인상 지속\n낮으면 → 물가 안정 → 금리 인하 가능",
        "keywords": ["CPI", "물가"],
    },
    "Core CPI m/m": {
        "name": "미국 근원 소비자물가",
        "emoji": "🔍",
        "explain": "식품·에너지를 제외한 물가 (변동이 큰 항목을 빼고 본 '진짜 물가')",
        "impact_kr": "연준이 가장 주목하는 물가지표\n예상보다 높으면 → 금리 인상 가능성 높아짐",
        "keywords": ["근원CPI", "Core CPI"],
    },
    "PPI m/m": {
        "name": "미국 생산자물가",
        "emoji": "🏭",
        "explain": "공장에서 만든 물건의 가격 변화 (소비자물가의 선행지표)",
        "impact_kr": "생산자물가 상승 → 곧 소비자물가도 오를 수 있음\n소비자물가보다 먼저 발표되어 힌트 역할",
        "keywords": ["PPI", "생산자물가"],
    },
    "Core PPI m/m": {
        "name": "미국 근원 생산자물가",
        "emoji": "🏭",
        "explain": "식품·에너지 제외 생산자물가",
        "impact_kr": "CPI와 함께 인플레이션 추세 판단에 사용",
        "keywords": ["PPI"],
    },
    "PCE Price Index m/m": {
        "name": "PCE 물가지수",
        "emoji": "📈",
        "explain": "연준이 가장 중시하는 물가지표 (개인소비지출 기반)",
        "impact_kr": "연준 목표: 2%\n이보다 높으면 → 금리 인상 지속 가능성",
        "keywords": ["PCE"],
    },
    "Core PCE Price Index m/m": {
        "name": "근원 PCE 물가지수",
        "emoji": "🎯",
        "explain": "연준이 '가장 좋아하는' 물가지표 (식품·에너지 제외)",
        "impact_kr": "연준 금리 결정에 가장 큰 영향을 주는 지표\n시장이 가장 주목하는 물가 데이터",
        "keywords": ["PCE", "근원"],
    },

    # ── GDP/경제성장 ──
    "Advance GDP q/q": {
        "name": "미국 GDP 성장률 (속보)",
        "emoji": "📊",
        "explain": "미국 경제가 지난 분기에 얼마나 성장했는지",
        "impact_kr": "예상보다 높으면 → 경제 탄탄 → 기업 실적 기대 → 주식 상승 가능\n너무 높으면 → 과열 우려 → 금리 인상 → 주식 하락 가능",
        "keywords": ["GDP"],
    },
    "Final GDP q/q": {
        "name": "미국 GDP 성장률 (확정)",
        "emoji": "📊",
        "explain": "GDP 최종 확정치 (속보→잠정→확정 3번 발표 중 마지막)",
        "impact_kr": "보통 속보치에서 큰 변화 없으면 시장 영향 적음",
        "keywords": ["GDP"],
    },
    "Prelim GDP q/q": {
        "name": "미국 GDP 성장률 (잠정)",
        "emoji": "📊",
        "explain": "GDP 잠정치 (속보 다음 수정치)",
        "impact_kr": "속보치와 크게 다르면 시장에 영향",
        "keywords": ["GDP"],
    },

    # ── 소비/소매 ──
    "Retail Sales m/m": {
        "name": "미국 소매판매",
        "emoji": "🛍️",
        "explain": "미국 소비자들이 한 달간 얼마나 소비했는지",
        "impact_kr": "소비 증가 → 경기 좋다 → 기업 실적 기대 → 주식 상승\n소비 급감 → 경기 둔화 우려 → 주식 하락",
        "keywords": ["소매판매"],
    },
    "Core Retail Sales m/m": {
        "name": "미국 근원 소매판매",
        "emoji": "🛍️",
        "explain": "자동차를 제외한 소매판매 (자동차 판매 변동이 크기 때문)",
        "impact_kr": "실질적인 소비 트렌드를 더 정확히 반영",
        "keywords": ["소매판매"],
    },
    "CB Consumer Confidence": {
        "name": "미국 소비자신뢰지수",
        "emoji": "😊",
        "explain": "소비자들이 경제를 얼마나 긍정적으로 보는지",
        "impact_kr": "신뢰 상승 → 소비 증가 기대 → 주식 상승 가능\n신뢰 하락 → 소비 감소 우려 → 주식 하락 가능",
        "keywords": ["소비자신뢰"],
    },
    "Prelim UoM Consumer Sentiment": {
        "name": "미시간대 소비자심리지수",
        "emoji": "😊",
        "explain": "미국 소비자들의 경기 체감도 (대학에서 설문조사)",
        "impact_kr": "심리 악화 → 소비 줄고 경기 둔화 우려",
        "keywords": ["소비자심리"],
    },

    # ── 제조업/산업 ──
    "ISM Manufacturing PMI": {
        "name": "ISM 제조업 지수",
        "emoji": "🏭",
        "explain": "미국 제조업 경기 (50 이상이면 확장, 이하면 위축)",
        "impact_kr": "50 이상 → 제조업 호황 → 수출 기업에 긍정적\n50 이하 → 제조업 침체 → 경기 둔화 신호",
        "keywords": ["ISM", "제조업"],
    },
    "ISM Services PMI": {
        "name": "ISM 서비스업 지수",
        "emoji": "🏢",
        "explain": "미국 서비스업 경기 (미국 경제의 70%가 서비스업)",
        "impact_kr": "미국 경제의 핵심 지표\n50 이하면 경기 침체 우려 급증",
        "keywords": ["ISM", "서비스업"],
    },

    # ── 주택 ──
    "Existing Home Sales": {
        "name": "미국 기존주택 판매",
        "emoji": "🏠",
        "explain": "기존 주택이 한 달간 얼마나 팔렸는지",
        "impact_kr": "주택시장은 금리에 민감 → 금리 방향 힌트 제공",
        "keywords": ["주택"],
    },
    "New Home Sales": {
        "name": "미국 신규주택 판매",
        "emoji": "🏗️",
        "explain": "새로 지은 주택의 판매 건수",
        "impact_kr": "건설/부동산 경기 판단 지표",
        "keywords": ["주택"],
    },

    # ── PMI (Flash) ──
    "Flash Manufacturing PMI": {
        "name": "미국 제조업 PMI (속보)",
        "emoji": "🏭",
        "explain": "미국 제조업 경기를 가장 빠르게 보여주는 속보치 (50 이상=확장, 이하=위축)",
        "impact_kr": "50 이상 → 제조업 호황 → 수출 기업에 긍정적\n50 이하 → 제조업 위축 → 경기 둔화 신호",
        "keywords": ["PMI", "제조업"],
    },
    "Flash Services PMI": {
        "name": "미국 서비스업 PMI (속보)",
        "emoji": "🏢",
        "explain": "미국 서비스업 경기 속보치 (미국 경제의 70%가 서비스업)",
        "impact_kr": "미국 경제의 핵심 지표\n50 이하면 경기 침체 우려 급증",
        "keywords": ["PMI", "서비스업"],
    },

    # ── 지역 제조업 ──
    "Richmond Manufacturing Index": {
        "name": "리치먼드 제조업지수",
        "emoji": "🏭",
        "explain": "미국 리치먼드 지역의 제조업 경기 (지역별 PMI 중 하나)",
        "impact_kr": "ISM 제조업 지수의 선행 힌트 역할\n0 이상이면 확장, 이하면 위축",
        "keywords": ["제조업"],
    },

    # ── 소비자심리 (Revised) ──
    "Revised UoM Consumer Sentiment": {
        "name": "미시간대 소비자심리 (수정치)",
        "emoji": "😊",
        "explain": "미국 소비자들이 경제를 어떻게 느끼는지 (대학 설문조사 수정치)",
        "impact_kr": "심리 악화 → 소비 줄고 경기 둔화 우려\n심리 개선 → 소비 증가 기대 → 주식 상승 가능",
        "keywords": ["소비자심리"],
    },

    # ── 무역 ──
    "Trade Balance": {
        "name": "미국 무역수지",
        "emoji": "🚢",
        "explain": "미국의 수출 - 수입 차이",
        "impact_kr": "적자 확대 → 달러 약세 가능 → 원화 강세 → 수출기업 부담",
        "keywords": ["무역"],
    },

    # ── 기타 주요 ──
    "Crude Oil Inventories": {
        "name": "미국 원유 재고",
        "emoji": "🛢️",
        "explain": "미국에 쌓여있는 원유의 양",
        "impact_kr": "재고 감소 → 유가 상승 → 정유주 긍정, 항공·운송주 부정\n재고 증가 → 유가 하락",
        "keywords": ["원유", "유가"],
    },
}

# 이벤트명에 포함된 키워드로 매칭하는 추가 패턴
KEYWORD_FALLBACKS = {
    "CPI": {"name": "미국 소비자물가", "emoji": "🛒", "explain": "소비자물가 관련 지표"},
    "GDP": {"name": "미국 GDP", "emoji": "📊", "explain": "경제성장률 관련 지표"},
    "PMI": {"name": "경기지수(PMI)", "emoji": "📈", "explain": "구매관리자지수 - 경기 확장/위축 판단"},
    "Employment": {"name": "고용 지표", "emoji": "👷", "explain": "일자리 관련 경제 지표"},
    "Inflation": {"name": "인플레이션 지표", "emoji": "📈", "explain": "물가 상승 관련 지표"},
    "Interest Rate": {"name": "금리 결정", "emoji": "🏦", "explain": "중앙은행 금리 결정"},
}

# 영향도 레벨 한글 + 색상
IMPACT_MAP = {
    "High": {"label": "매우 중요", "color": "#e53e3e", "bg": "#fed7d7", "icon": "🔴"},
    "Medium": {"label": "중요", "color": "#dd6b20", "bg": "#fefcbf", "icon": "🟡"},
    "Low": {"label": "참고", "color": "#718096", "bg": "#edf2f7", "icon": "⚪"},
    "Holiday": {"label": "휴장", "color": "#805ad5", "bg": "#e9d8fd", "icon": "🔵"},
}

# 요일 한글
WEEKDAY_KR = ["월", "화", "수", "목", "금", "토", "일"]


def fetch_weekly_calendar():
    """Forex Factory에서 이번 주 경제 캘린더 가져오기"""
    url = "https://nfs.faireconomy.media/ff_calendar_thisweek.json"

    try:
        req = urllib.request.Request(url, headers={
            "User-Agent": "Mozilla/5.0 (compatible; MarketSignal/1.0)"
        })
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        print(f"[캘린더] {len(data)}개 이벤트 수신")
        return data
    except Exception as e:
        print(f"[캘린더] 데이터 수신 실패: {e}")
        return []


def _translate_event(event_title):
    """이벤트명을 한글로 번역 + 해설 반환"""
    # 1. 정확한 매칭
    for key, info in EVENT_TRANSLATIONS.items():
        if key.lower() in event_title.lower() or event_title.lower() in key.lower():
            return info

    # 2. 키워드 폴백
    for keyword, info in KEYWORD_FALLBACKS.items():
        if keyword.lower() in event_title.lower():
            return {**info, "impact_kr": "시장에 영향을 줄 수 있는 지표입니다.", "keywords": [keyword]}

    # 3. 매칭 실패
    return None


def _format_value(val):
    """수치 포맷팅 (빈 값 처리)"""
    if val is None or val == "" or val == "null":
        return "-"
    return str(val).strip()


def process_calendar(raw_events):
    """원본 이벤트를 가공: 미국(USD) High/Medium만 필터 + 한글 번역"""
    processed = []

    for event in raw_events:
        country = event.get("country", "")
        impact = event.get("impact", "")
        title = event.get("title", "")

        # USD(미국) + High/Medium 영향만 필터
        if country != "USD":
            continue
        if impact not in ("High", "Medium"):
            continue

        # 한글 번역 시도
        translation = _translate_event(title)

        # 날짜 파싱
        date_str = event.get("date", "")
        try:
            # FF format: "2026-03-24T13:30:00-04:00" or similar
            if "T" in date_str:
                dt = datetime.fromisoformat(date_str.replace("Z", "+00:00"))
                # KST 변환 (UTC+9, FF는 보통 EST/EDT 기준이지만 날짜만 사용)
                event_date = dt.strftime("%Y-%m-%d")
                event_time = dt.strftime("%H:%M")
            else:
                event_date = date_str[:10]
                event_time = ""
        except Exception:
            event_date = date_str[:10] if len(date_str) >= 10 else ""
            event_time = ""

        entry = {
            "date": event_date,
            "time": event_time,
            "title_en": title,
            "title_kr": translation["name"] if translation else title,
            "emoji": translation.get("emoji", "📌") if translation else "📌",
            "explain": translation.get("explain", "") if translation else "",
            "impact_kr": translation.get("impact_kr", "") if translation else "",
            "impact": impact,
            "impact_info": IMPACT_MAP.get(impact, IMPACT_MAP["Low"]),
            "forecast": _format_value(event.get("forecast")),
            "previous": _format_value(event.get("previous")),
            "actual": _format_value(event.get("actual", "")),
            "is_translated": translation is not None,
        }
        processed.append(entry)

    # 날짜 + 시간순 정렬
    processed.sort(key=lambda x: (x["date"], x["time"]))

    print(f"[캘린더] USD High/Medium {len(processed)}개 필터됨")
    return processed


def group_by_date(events):
    """이벤트를 날짜별로 그룹핑"""
    groups = {}
    for e in events:
        d = e["date"]
        if d not in groups:
            groups[d] = []
        groups[d].append(e)
    return groups


def build_calendar_html(events, today_only=False):
    """경제 캘린더 HTML 섹션 생성 — 비전문가도 이해할 수 있게"""

    today = datetime.now().strftime("%Y-%m-%d")
    cal_title = "\U0001f4c5 오늘의 미국 경제 일정" if today_only else "이번 주 미국 경제 캘린더"
    empty_msg = "오늘 주요 경제 일정이 없습니다." if today_only else "이번 주 주요 경제 일정이 없습니다."

    if today_only:
        events = [e for e in events if e["date"] == today]

    if not events:
        return f"""
    <div class="section" id="calendar">
        <h2>{cal_title}</h2>
        <p style="color:#718096; padding:15px;">{empty_msg}</p>
    </div>
"""

    grouped = group_by_date(events)

    html = f"""
    <div class="section" id="calendar">
        <h2>{cal_title}</h2>
        <div style="background:#ebf8ff; border:1px solid #bee3f8; border-radius:8px; padding:14px; margin-bottom:15px; font-size:0.9em; color:#2c5282;">
            <b>왜 미국 경제지표가 중요할까?</b><br>
            미국 경제 지표 발표 → 미국 금리 방향 결정 → 한국 주식시장에 직접 영향<br>
            <span style="color:#e53e3e;">🔴 매우 중요</span> 지표 발표일에는 코스피가 크게 흔들릴 수 있습니다.
        </div>
        <div style="background:#f0fff4; border:1px solid #c6f6d5; border-radius:8px; padding:12px; margin-bottom:15px; font-size:0.85em; color:#276749;">
            💡 <b>핵심 포인트:</b> 숫자 자체보다 <u>예상치 vs 실제치의 차이</u>가 시장을 움직입니다.<br>
            예상대로 나오면 영향 적음, 예상과 다르면 시장이 크게 반응합니다.
        </div>
"""

    for date_str in sorted(grouped.keys()):
        day_events = grouped[date_str]

        try:
            dt = datetime.strptime(date_str, "%Y-%m-%d")
            wday = WEEKDAY_KR[dt.weekday()]
            month = dt.month
            day = dt.day
        except Exception:
            wday = ""
            month = ""
            day = date_str

        # 오늘 표시
        is_today = date_str == today
        today_badge = ' <span style="background:#e53e3e; color:#fff; font-size:0.7em; padding:2px 8px; border-radius:10px; margin-left:5px;">오늘</span>' if is_today else ""
        day_bg = "#fff5f5" if is_today else "#fff"

        html += f"""
        <div style="background:{day_bg}; border-radius:8px; margin-bottom:10px; border:1px solid #e2e8f0; overflow:hidden;">
            <div style="background:#edf2f7; padding:10px 15px; font-weight:600; color:#2d3748; font-size:0.95em;">
                {month}월 {day}일 ({wday}){today_badge}
            </div>
"""

        for e in day_events:
            imp = e["impact_info"]
            has_actual = e["actual"] != "-"

            # 예상 vs 실제 비교
            compare_html = ""
            if has_actual and e["forecast"] != "-":
                compare_html = f"""
                <div style="margin-top:6px; padding:6px 10px; background:#f7fafc; border-radius:4px; font-size:0.85em;">
                    예상: <b>{e['forecast']}</b> → 실제: <b style="color:#e53e3e;">{e['actual']}</b>
                </div>"""
            elif e["forecast"] != "-":
                compare_html = f"""
                <div style="margin-top:6px; padding:6px 10px; background:#f7fafc; border-radius:4px; font-size:0.85em;">
                    예상: <b>{e['forecast']}</b> | 이전: {e['previous']}
                </div>"""
            elif e["previous"] != "-":
                compare_html = f"""
                <div style="margin-top:6px; padding:6px 10px; background:#f7fafc; border-radius:4px; font-size:0.85em;">
                    이전: {e['previous']}
                </div>"""

            # 영향 해설
            impact_explain = ""
            if e["impact_kr"]:
                # 줄바꿈을 <br>로
                lines = e["impact_kr"].replace("\n", "<br>")
                impact_explain = f"""
                <div style="margin-top:6px; color:#4a5568; font-size:0.82em; line-height:1.5; padding-left:10px; border-left:2px solid #e2e8f0;">
                    {lines}
                </div>"""

            html += f"""
            <div style="padding:12px 15px; border-bottom:1px solid #f0f0f0;">
                <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                    <span style="background:{imp['bg']}; color:{imp['color']}; font-size:0.75em; padding:2px 8px; border-radius:10px; font-weight:500; white-space:nowrap;">
                        {imp['icon']} {imp['label']}
                    </span>
                    <span style="font-weight:600; color:#2d3748;">{e['emoji']} {e['title_kr']}</span>
                </div>
                <div style="color:#718096; font-size:0.85em; margin-top:4px;">
                    {e['explain']}
                </div>
                {compare_html}
                {impact_explain}
            </div>
"""

        html += "        </div>\n"

    html += """
        <div style="font-size:0.8em; color:#a0aec0; margin-top:8px; text-align:center;">
            * 시간은 미국 현지 기준 | 데이터: Forex Factory
        </div>
    </div>
"""
    return html


def get_calendar_html(today_only=False):
    """전체 프로세스: 가져오기 → 가공 → HTML 생성"""
    raw = fetch_weekly_calendar()
    if not raw:
        return build_calendar_html([], today_only=today_only)

    events = process_calendar(raw)
    return build_calendar_html(events, today_only=today_only)


# 테스트
if __name__ == "__main__":
    html = get_calendar_html()
    with open("/tmp/calendar_test.html", "w", encoding="utf-8") as f:
        f.write(f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
body {{ font-family: -apple-system, sans-serif; max-width:800px; margin:30px auto; background:#f5f7fa; }}
</style></head><body>{html}</body></html>""")
    print("Test HTML saved to /tmp/calendar_test.html")
