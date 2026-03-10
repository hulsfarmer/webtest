import PricingSection from '@/components/PricingSection';

export const metadata = {
  title: '요금제 | ShortsAI',
  description: '합리적인 가격으로 무한한 유튜브 쇼츠를 만들어보세요.',
};

export default function PricingPage() {
  return (
    <main className="min-h-screen bg-brand-bg">
      <PricingSection />
    </main>
  );
}
