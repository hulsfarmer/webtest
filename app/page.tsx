import Link from 'next/link';
import { Suspense } from 'react';
import './landing.css';
import LandingNav from '@/components/LandingNav';
import LandingTools from '@/components/LandingTools';
import PricingBlock from '@/components/PricingBlock';
import MaintenanceModal from '@/components/MaintenanceModal';



const Arrow = (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
);

export default function Home() {
  return (
    <div className="sa-root">
      <Suspense fallback={null}>
        <MaintenanceModal active={process.env.MAINTENANCE_MODE === '1'} />
      </Suspense>
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
              <a className="sa-btn ghost lg" href="#tools">샘플 영상 보기</a>
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
            <div className="sa-kick">기능 · 샘플</div>
            <h2>메뉴마다, 실제 결과물을 먼저 보세요</h2>
            <p>각 도구로 만든 홍보영상 샘플입니다. 마음에 드는 걸 골라 바로 만들어 보세요.</p>
          </div>
          <LandingTools />
        </div>
      </section>

      {/* PRICING */}
      <section className="sa-block" id="pricing" style={{ background: 'var(--surface-2)' }}>
        <div className="sa-wrap">
          <div className="sa-sec-head">
            <div className="sa-kick">요금</div>
            <h2>필요한 만큼만, 부담 없이</h2>
            <p>가입하면 10크레딧 무료. 표시 가격은 VAT 포함 실청구가입니다.</p>
          </div>
          <PricingBlock />
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
