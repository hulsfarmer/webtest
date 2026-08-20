import PricingSection from '@/components/PricingSection';

export const metadata = { title: '결제 · 이용권' };

export default function BillingPage() {
  return (
    <>
      <div className="st-page-head">
        <div className="st-eyebrow">결제</div>
        <h1 className="st-title">결제 · 이용권</h1>
        <p className="st-sub">크레딧으로 필요한 만큼만 결제하세요. 구독하면 매달 크레딧이 자동 충전되고, 안 쓰면 이월됩니다.</p>
      </div>
      <PricingSection />
    </>
  );
}
