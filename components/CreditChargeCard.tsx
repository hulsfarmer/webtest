'use client';

import { useState, CSSProperties } from 'react';
import { useSession } from 'next-auth/react';
import PortOne from '@portone/browser-sdk/v2';

const ONETIME_CHANNEL_KEY = process.env.NEXT_PUBLIC_PORTONE_CHANNEL_KEY_ONETIME;

// 랜딩(sa- 톤)용 크레딧 충전 위젯 — 10/20/30 빠른선택 + 직접입력. 누르면 바로 PortOne 결제창.
export default function CreditChargeCard() {
  const { data: session } = useSession();
  const [qty, setQty] = useState(10);
  const [loading, setLoading] = useState(false);

  const q = Math.max(10, Math.min(2000, Math.floor(qty) || 0));
  const amount = q * 200;

  const charge = async () => {
    if (!session) { window.location.href = '/api/auth/signin'; return; }
    if (!ONETIME_CHANNEL_KEY) { alert('단건 결제가 곧 오픈됩니다. 잠시만 기다려주세요!'); return; }
    const storeId = process.env.NEXT_PUBLIC_PORTONE_STORE_ID;
    if (!storeId) { alert('결제가 아직 준비 중입니다.'); return; }
    const u = session.user as { id?: string; name?: string; email?: string };
    setLoading(true);
    try {
      const paymentId = `sao-${String(u.id).slice(0, 8)}-${Date.now().toString(36)}`;
      const payment = await PortOne.requestPayment({
        storeId, channelKey: ONETIME_CHANNEL_KEY, paymentId,
        orderName: `ShortsAI ${q}크레딧`, totalAmount: amount, currency: 'KRW', payMethod: 'CARD',
        customer: { customerId: u.id, fullName: u.name || '고객', email: u.email || undefined },
      });
      if (!payment || payment.code != null) { if (payment?.message) alert(payment.message); setLoading(false); return; }
      const res = await fetch('/api/payment/portone/pay-once', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paymentId, credits: q }),
      });
      const data = await res.json();
      if (data.success) { alert(`${q}크레딧이 충전되었습니다!`); window.location.reload(); return; }
      alert(data.error || '결제 검증에 실패했습니다.');
    } catch (e) {
      alert('결제 처리 중 오류: ' + (e instanceof Error ? e.message : String(e)));
    }
    setLoading(false);
  };

  const input: CSSProperties = { width: '100%', padding: '10px 12px', borderRadius: 10, background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text)', fontFamily: 'inherit', fontSize: 15, fontWeight: 700, boxSizing: 'border-box', textAlign: 'center' };
  const quick: CSSProperties = { flex: 1, padding: '8px 0', borderRadius: 9, fontFamily: 'inherit', fontWeight: 700, fontSize: 13, cursor: 'pointer' };

  return (
    <div className="sa-price" style={{ display: 'flex', flexDirection: 'column' }}>
      <h3>크레딧 충전</h3>
      <div className="who" style={{ marginBottom: 12 }}>필요한 만큼 · 200원/크레딧</div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
        {[10, 20, 30].map((n) => (
          <button key={n} onClick={() => setQty(n)} style={{ ...quick, border: `1px solid ${qty === n ? 'var(--purple)' : 'var(--border)'}`, background: qty === n ? 'var(--purple)' : 'var(--surface-2)', color: qty === n ? '#fff' : 'var(--text-dim)' }}>{n}</button>
        ))}
      </div>
      <input type="number" min={10} max={2000} value={qty}
        onChange={(e) => setQty(Math.max(0, Math.min(2000, parseInt(e.target.value) || 0)))}
        style={input} aria-label="크레딧 수 직접 입력 (10 이상)" />
      <div style={{ margin: '12px 0 16px', display: 'flex', alignItems: 'baseline', justifyContent: 'center' }}>
        <span style={{ fontWeight: 800, fontSize: 26, letterSpacing: '-.02em', color: 'var(--text)' }}>₩{amount.toLocaleString()}</span>
      </div>
      <button onClick={charge} disabled={loading || q < 10} className="sa-btn grad" style={{ marginTop: 'auto', width: '100%', justifyContent: 'center', opacity: loading ? 0.6 : 1 }}>
        {loading ? '처리 중...' : '충전하기'}
      </button>
    </div>
  );
}
