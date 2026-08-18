import Link from 'next/link';

export const metadata = { title: '결제 · 이용권' };

const PLANS = [
  { name: 'Lite', price: '2,000', unit: '원/월', feats: ['월 10회 생성', '기본 음성·BGM', '워터마크 제거'], cta: '선택', feat: false },
  { name: 'Pro', price: '4,000', unit: '원/월', feats: ['월 30회 생성', '전체 음성·캐릭터', 'SNS 자동 발행'], cta: '구독하기', feat: true },
  { name: '크레딧 30회', price: '5,000', unit: '원', feats: ['30회 단건 충전', '자동 갱신 없음', '3개월 유효'], cta: '충전', feat: false },
];

export default function BillingPage() {
  return (
    <>
      <div className="st-page-head">
        <div className="st-eyebrow">결제</div>
        <h1 className="st-title">결제 · 이용권</h1>
        <p className="st-sub">구독 또는 단건 크레딧으로 필요한 만큼만 결제하세요. 이용권은 구매일로부터 3개월간 유효합니다.</p>
      </div>
      <div className="st-plans">
        {PLANS.map((p) => (
          <div className={`st-plan${p.feat ? ' feat' : ''}`} key={p.name}>
            <h3>{p.name}</h3>
            <div className="price">{p.price}<span> {p.unit}</span></div>
            <ul>{p.feats.map((f) => <li key={f}>{f}</li>)}</ul>
            <Link className="st-genbtn" href="/pricing">{p.cta}</Link>
          </div>
        ))}
      </div>
      <p className="st-note">표시 가격은 VAT 포함 실청구가입니다. 실제 결제는 포트원(KG이니시스) 카드·간편결제로 진행되며, 단건 크레딧은 구매일로부터 3개월간 사용할 수 있습니다.</p>
    </>
  );
}
