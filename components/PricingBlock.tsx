import Link from 'next/link';
import { CSSProperties } from 'react';
import CreditChargeCard from '@/components/CreditChargeCard';
import SubscribeButton, { cardStyle, featCardStyle, btnGhost } from '@/components/SubscribeButton';

// 랜딩·스튜디오 공용 요금 블록 — 인라인 스타일 + 공통 CSS 변수라 두 테마 다 맞음.
const h3: CSSProperties = { margin: '0 0 2px', fontSize: 15, color: 'var(--text)' };
const amt: CSSProperties = { fontSize: 27, fontWeight: 800, letterSpacing: '-.02em', margin: '6px 0', color: 'var(--text)' };
const unit: CSSProperties = { fontSize: 13, color: 'var(--text-dim)', fontWeight: 600 };
const who: CSSProperties = { fontSize: 13, color: 'var(--text-faint)', marginBottom: 14 };
const ulS: CSSProperties = { listStyle: 'none', margin: '0 0 18px', padding: 0, display: 'grid', gap: 7, fontSize: 13.5, color: 'var(--text-dim)' };

function Feats({ items }: { items: string[] }) {
  return (
    <ul style={ulS}>
      {items.map((f) => <li key={f}><span style={{ color: 'var(--good)', fontWeight: 800 }}>✓ </span>{f}</li>)}
    </ul>
  );
}

export default function PricingBlock() {
  return (
    <div>
      <div className="pricing-grid">
        <CreditChargeCard />

        <div style={cardStyle}>
          <h3 style={h3}>무료</h3>
          <div style={amt}>0<span style={unit}>원</span></div>
          <div style={who}>처음 써보는 분</div>
          <Feats items={['매달 무료 5크레딧', '모든 기능 사용']} />
          <Link href="/studio" style={{ ...btnGhost, marginTop: 'auto', textDecoration: 'none' }}>무료로 시작</Link>
        </div>

        <div style={cardStyle}>
          <h3 style={h3}>라이트</h3>
          <div style={amt}>9,900<span style={unit}>원/월</span></div>
          <div style={who}>가끔 올리는 분</div>
          <Feats items={['매달 55크레딧', '안 쓰면 이월', '모든 기능 사용']} />
          <div style={{ marginTop: 'auto' }}><SubscribeButton plan="lite" variant="ghost">구독하기</SubscribeButton></div>
        </div>

        <div style={featCardStyle}>
          <span style={{ position: 'absolute', top: -11, left: 22, background: 'var(--grad)', color: '#fff', fontSize: 11, fontWeight: 800, padding: '3px 11px', borderRadius: 999 }}>인기</span>
          <h3 style={h3}>프로</h3>
          <div style={amt}>19,900<span style={unit}>원/월</span></div>
          <div style={who}>꾸준히 홍보하는 분</div>
          <Feats items={['매달 110크레딧', '안 쓰면 이월', '모든 기능 사용']} />
          <div style={{ marginTop: 'auto' }}><SubscribeButton plan="pro" variant="grad">구독하기</SubscribeButton></div>
        </div>
      </div>
      <p style={{ textAlign: 'center', marginTop: 18, fontSize: 13, color: 'var(--text-faint)' }}>
        크레딧 사용 — 사진 홍보영상 · 로고 <b style={{ color: 'var(--text-dim)' }}>1크레딧</b> · 캐릭터 홍보영상 <b style={{ color: 'var(--text-dim)' }}>8크레딧부터</b> (길이·구간에 따라)
      </p>
    </div>
  );
}
