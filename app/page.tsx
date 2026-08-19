import Link from 'next/link';
import './landing.css';
import LandingNav from '@/components/LandingNav';
import ShowcaseStrip from '@/components/ShowcaseStrip';

const QUOTES = [
  { emoji: '☕', text: '업체 사진 몇 장 올렸더니 진짜 3분 만에 홍보 쇼츠가 나왔어요. 제작 업체에 맡기면 50만원인데, 이건 무료라니!', name: '김사장님', type: '카페' },
  { emoji: '💪', text: '인스타 릴스용 영상이 필요했는데 딱이에요. 나레이션까지 자동이라 편하고, BGM도 분위기에 맞게 나와서 바로 올렸습니다.', name: '박대표님', type: '헬스장' },
  { emoji: '✂️', text: '매장 리뉴얼하고 홍보영상 만들고 싶었는데 비용이 부담됐거든요. 여기서 만들어보니 퀄리티가 생각보다 좋아서 놀랐어요.', name: '이원장님', type: '미용실' },
];

const LOGO_MAKER_URL = 'https://logomaker-blush.vercel.app';

const TOOLS = [
  { icon: '🏪', name: '업체 홍보영상', desc: '가게·회사·농장·병원 등 사업장을 소개하는 세로 쇼츠.', href: '/promo' },
  { icon: '📅', name: '행사 홍보영상', desc: '축제·마켓·세일·오픈 등 이벤트를 긴급성 있게 알립니다.', href: '/promo?mode=event' },
  { icon: '🎭', name: '제품 홍보영상', desc: '말하는 캐릭터가 제품을 직접 소개하는 드라마형 쇼츠.', href: '/promo-character', tag: 'new' as const },
  { icon: '✦', name: '로고 생성', desc: '브랜드 이름과 분위기만으로 로고 시안 제작·다운로드.', href: LOGO_MAKER_URL, external: true },
  { icon: '🔄', name: '파일 변환', desc: '영상·이미지·문서 포맷을 빠르게 변환합니다.', tag: 'soon' as const },
  { icon: '🎬', name: '유튜브 디자인', desc: '채널 배너·썸네일을 브랜드 톤에 맞춰 자동 디자인.', tag: 'soon' as const },
];

const PRICES = [
  { name: '무료', amt: '0', unit: '원', who: '처음 써보는 분', feats: ['가입 시 3회 제공', '기본 음성·BGM', '워터마크 포함'], cta: '무료로 시작', href: '/promo', style: 'ghost' as const },
  { name: 'Lite', amt: '2,000', unit: '원/월', who: '가끔 올리는 분', feats: ['월 10회 생성', '워터마크 제거', '전체 톤·BGM'], cta: '선택', href: '/pricing', style: 'ghost' as const },
  { name: 'Pro', amt: '4,000', unit: '원/월', who: '꾸준히 홍보하는 분', feats: ['월 30회 생성', '말하는 캐릭터', 'SNS 자동 발행'], cta: '구독하기', href: '/pricing', style: 'grad' as const, feat: true },
  { name: '크레딧 30회', amt: '5,000', unit: '원', who: '몰아서 쓰는 분', feats: ['30회 단건 충전', '자동 갱신 없음', '3개월 유효'], cta: '충전', href: '/pricing', style: 'ghost' as const },
];

const Arrow = (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
);

export default function Home() {
  return (
    <div className="sa-root">
      <LandingNav />

      {/* HERO */}
      <header className="sa-hero">
        <div className="sa-aurora" />
        <div className="sa-wrap sa-hgrid">
          <div>
            <span className="sa-eyebrow"><span className="d" />소상공인을 위한 AI 홍보 스튜디오</span>
            <h1 className="sa-hl">사진 몇 장이면,<br /><span className="g">홍보 쇼츠</span>가 <u>3분</u> 만에<br />완성됩니다.</h1>
            <p className="sa-lead">업체명과 사진만 넣으면 대본·AI 음성·BGM·자막까지 자동으로. 영상 제작사 없이, 오늘 바로 SNS에 올리세요.</p>
            <div className="sa-cta-row">
              <Link className="sa-btn grad lg" href="/promo">무료로 시작하기 →</Link>
              <a className="sa-btn ghost lg" href="#samples">샘플 영상 보기</a>
            </div>
            <div className="sa-trust">
              <span><span className="ck">✓</span> <b>무료 3회</b> 제공</span>
              <span><span className="ck">✓</span> 신용카드 불필요</span>
              <span><span className="ck">✓</span> 한국어 완벽 지원</span>
            </div>
          </div>

          <div className="sa-stage">
            <div className="sa-phone">
              <div className="sa-screen">
                <div className="sa-photo" />
                <div className="sa-shdr"><small>연남동 감성카페</small><b>매일 아침, 향긋한 한 잔</b></div>
                <div className="sa-cap-area">
                  <div className="c">직접 로스팅한 <i>원두</i></div>
                  <div className="c">오션뷰 <i>창가 자리</i></div>
                  <div className="c">지금 <i>방문하세요</i></div>
                </div>
                <div className="sa-prog"><i /></div>
              </div>
            </div>
            <div className="sa-float f1"><span className="ic" style={{ background: 'var(--grad)' }}>✦</span><span>AI 대본·자막 자동</span></div>
            <div className="sa-float f2"><span className="ic" style={{ background: 'linear-gradient(135deg,var(--pink),var(--purple))' }}>▶</span><span>평균 3분 12초 완성</span></div>
          </div>
        </div>
      </header>

      {/* HOW */}
      <section className="sa-block" id="how">
        <div className="sa-wrap">
          <div className="sa-sec-head">
            <div className="sa-kick">작동 방식</div>
            <h2>세 단계면 끝납니다</h2>
            <p>편집 프로그램도, 촬영 장비도 필요 없습니다. 입력만 하면 나머지는 AI가 합니다.</p>
          </div>
          <div className="sa-steps">
            <div className="sa-step"><div className="n" /><h3>정보·사진 입력</h3><p>업체명, 강점, 사진 몇 장만. 사진이 없으면 업종에 맞는 스톡 영상 배경을 자동으로 넣어줍니다.</p><div className="con">{Arrow}</div></div>
            <div className="sa-step"><div className="n" /><h3>AI가 자동 제작</h3><p>클로드가 대본을 쓰고, 자연스러운 한국어 음성·BGM·자막을 나레이션에 딱 맞춰 싱크합니다.</p><div className="con">{Arrow}</div></div>
            <div className="sa-step"><div className="n" /><h3>완성·바로 발행</h3><p>9:16 쇼츠를 내려받거나, 유튜브·틱톡으로 곧바로 발행. 마음에 안 들면 대본만 고쳐 재생성.</p></div>
          </div>
        </div>
      </section>

      {/* TOOLS */}
      <section className="sa-block" id="tools" style={{ background: 'var(--surface-2)' }}>
        <div className="sa-wrap">
          <div className="sa-sec-head">
            <div className="sa-kick">기능</div>
            <h2>홍보에 필요한 걸 한곳에서</h2>
            <p>영상부터 로고까지. 로그인하면 좌측 스튜디오에서 원하는 도구를 골라 바로 만듭니다.</p>
          </div>
          <div className="sa-tools">
            {TOOLS.map((t) => {
              const inner = (
                <>
                  <div className="ic">{t.icon}</div>
                  <h3>{t.name}{t.tag === 'new' && <span className="sa-tag new">NEW</span>}{t.tag === 'soon' && <span className="sa-tag soon">준비중</span>}</h3>
                  <p>{t.desc}</p>
                </>
              );
              if (t.href && t.external) return <a key={t.name} className="sa-tool" href={t.href} target="_blank" rel="noreferrer">{inner}</a>;
              if (t.href) return <Link key={t.name} className="sa-tool" href={t.href}>{inner}</Link>;
              return <div key={t.name} className="sa-tool" aria-disabled="true">{inner}</div>;
            })}
          </div>
        </div>
      </section>

      {/* SAMPLES */}
      <section className="sa-block" id="samples">
        <div className="sa-wrap sa-sec-head">
          <div className="sa-kick">샘플</div>
          <h2>실제로 이렇게 만들어집니다</h2>
          <p>업체명과 사진만 입력해서 나온 결과물입니다.</p>
        </div>
        <ShowcaseStrip />
      </section>

      {/* TESTIMONIALS */}
      <section className="sa-block" id="reviews" style={{ background: 'var(--surface-2)' }}>
        <div className="sa-wrap">
          <div className="sa-sec-head">
            <div className="sa-kick">후기</div>
            <h2>사장님들이 먼저 써봤습니다</h2>
            <p>영상 제작 경험이 없어도, 3분이면 올릴 수 있는 결과물이 나옵니다.</p>
          </div>
          <div className="sa-quotes">
            {QUOTES.map((q) => (
              <div className="sa-quote" key={q.name}>
                <div className="stars">★★★★★</div>
                <p>&ldquo;{q.text}&rdquo;</p>
                <div className="who">
                  <span className="ava">{q.emoji}</span>
                  <div><b>{q.name}</b><span>{q.type}</span></div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* PRICING */}
      <section className="sa-block" id="pricing" style={{ background: 'var(--surface-2)' }}>
        <div className="sa-wrap">
          <div className="sa-sec-head">
            <div className="sa-kick">요금</div>
            <h2>필요한 만큼만, 부담 없이</h2>
            <p>무료로 3개를 먼저 만들어 보세요. 표시 가격은 VAT 포함 실청구가입니다.</p>
          </div>
          <div className="sa-prices">
            {PRICES.map((p) => (
              <div className={`sa-price${p.feat ? ' feat' : ''}`} key={p.name}>
                <h3>{p.name}</h3>
                <div className="amt">{p.amt}<span>{p.unit}</span></div>
                <div className="who">{p.who}</div>
                <ul>{p.feats.map((f) => <li key={f}>{f}</li>)}</ul>
                <Link className={`sa-btn ${p.style}`} href={p.href}>{p.cta}</Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FINAL */}
      <section className="sa-block">
        <div className="sa-wrap">
          <div className="sa-final">
            <div className="glow" />
            <h2>오늘, 첫 홍보 쇼츠를 만들어 보세요</h2>
            <p>신용카드 없이 무료 3회. 3분이면 SNS에 올릴 영상이 나옵니다.</p>
            <div className="sa-cta-row" style={{ justifyContent: 'center' }}>
              <Link className="sa-btn ghost lg" href="/promo">무료로 시작하기 →</Link>
            </div>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="sa-footer">
        <div className="sa-wrap">
          <div className="top">
            <div className="sa-brand"><span className="sa-mk">S</span>Shorts<b>AI</b></div>
            <div className="fl">
              <Link href="/terms">이용약관</Link>
              <Link href="/privacy">개인정보처리방침</Link>
              <Link href="/refund">환불정책</Link>
              <a href="mailto:support@shortsai.kr">고객문의</a>
            </div>
          </div>
          <div className="biz">
            상호 이지온 · 대표 안수동 · 사업자등록 794-03-04121 · 통신판매 · 제주 제주시 조천읍 함덕12길 46-1 202호<br />
            고객문의 010-4149-0673 · support@shortsai.kr &nbsp;·&nbsp; © 2026 ShortsAI
          </div>
        </div>
      </footer>
    </div>
  );
}
