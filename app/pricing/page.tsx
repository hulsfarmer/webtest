import type { Metadata } from 'next';
import PricingSection from '@/components/PricingSection';

export const metadata: Metadata = {
  title: '요금제 - 영상 제작사보다 100배 저렴한',
  description: '무료부터 시작! 구독 Lite ₩2,000·Pro ₩4,000·Business ₩10,000 (월, 부가세 포함) 또는 단건 이용권 10회 ₩3,000·30회 ₩5,000(유효기간 3개월). 영상 제작 의뢰(50~100만원) 대비 저렴하게 매달 새 홍보영상을 만드세요.',
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
