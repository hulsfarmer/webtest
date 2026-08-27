import type { Metadata } from 'next';
import PricingSection from '@/components/PricingSection';

export const metadata: Metadata = {
  title: '요금제 - 영상 제작사보다 100배 저렴한',
  description: '매달 무료 5크레딧(쿠폰 받기)으로 시작! 크레딧 팩 10개 ₩2,000·25개 ₩5,000·60개 ₩12,000(안 만료) 또는 구독 라이트 ₩9,900(55크레딧)·프로 ₩19,900(110크레딧, 월·부가세 포함). 슬라이드쇼 1크레딧·캐릭터 홍보영상 8크레딧부터.',
  openGraph: {
    title: 'ShortsAI 요금제 - 영상 제작사보다 100배 저렴한',
    description: '무료부터 시작! 영상 제작 의뢰 대비 100배 저렴한 AI 홍보영상 솔루션.',
  },
  alternates: {
    canonical: 'https://shortsai.kr/pricing',
  },
};

export default function PricingPage() {
  return (
    <main className="min-h-screen bg-brand-bg">
      <PricingSection />
    </main>
  );
}
