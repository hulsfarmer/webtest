import Link from 'next/link';
import { Suspense } from 'react';
import './landing.css';
import LandingNav from '@/components/LandingNav';
import LandingTools from '@/components/LandingTools';
import HeroPhone from '@/components/HeroPhone';
import PricingBlock from '@/components/PricingBlock';
import MaintenanceModal from '@/components/MaintenanceModal';

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
              <Link className="sa-btn grad lg" href="/studio">무료로 시작하기 →</Link>
              <a className="sa-btn ghost lg" href="#video-samples">샘플 영상 보기</a>
            </div>
            <div className="sa-trust">
              <span><span className="ck">✓</span> <b>매달 무료 5크레딧</b></span>
              <span><span className="ck">✓</span> 신용카드 불필요</span>
              <span><span className="ck">✓</span> 한국어 완벽 지원</span>
            </div>
          </div>

          <div className="sa-stage">
            <div className="sa-phone">
              <HeroPhone />
            </div>
            <div className="sa-float f1"><span className="ic" style={{ background: 'var(--grad)' }}>✦</span><span>AI 대본·자막 자동</span></div>
            <div className="sa-float f2"><span className="ic" style={{ background: 'linear-gradient(135deg,var(--pink),var(--purple))' }}>▶</span><span>평균 3분 12초 완성</span></div>
          </div>
        </div>
      </header>

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
            <p>가입하면 매달 무료 5크레딧(쿠폰 받기). 표시 가격은 VAT 포함 실청구가입니다.</p>
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
            <p>신용카드 없이 매달 무료 5크레딧. 3분이면 SNS에 올릴 영상이 나옵니다.</p>
            <div className="sa-cta-row" style={{ justifyContent: 'center' }}>
              <Link className="sa-btn ghost lg" href="/studio">무료로 시작하기 →</Link>
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
