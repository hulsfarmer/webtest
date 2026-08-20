'use client';

import { useState, useEffect, CSSProperties } from 'react';
import { useSession } from 'next-auth/react';
import PortOne from '@portone/browser-sdk/v2';

const ONETIME_CHANNEL_KEY = process.env.NEXT_PUBLIC_PORTONE_CHANNEL_KEY_ONETIME;

// 랜딩(sa- 톤)용 크레딧 충전 위젯 — 10/20/30 빠른선택 + 직접입력, ₩200/크레딧, 포트원 결제.
export default function CreditChargeCard() {
  const { data: session } = useSession();
  const [qty, setQty] = useState(10);
  const [loading, setLoading] = useState(false);
  const [modal, setModal] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  useEffect(() => {
    const u = session?.user as { name?: string; email?: string } | undefined;
    if (u?.name) setName((v) => v || (u.name as string));
    if (u?.email) setEmail((v) => v || (u.email as string));
  }, [session]);

  const q = Math.max(10, Math.min(2000, Math.floor(qty) || 0));
  const amount = q * 200;

  const open = () => {
    if (!session) { window.location.href = '/api/auth/signin'; return; }
    if (!ONETIME_CHANNEL_KEY) { alert('단건 결제가 곧 오픈됩니다. 잠시만 기다려주세요!'); return; }
    if (qty < 10) setQty(10);
    setModal(true);
  };

  const pay = async () => {
    const storeId = process.env.NEXT_PUBLIC_PORTONE_STORE_ID;
    if (!storeId || !ONETIME_CHANNEL_KEY) { alert('결제가 아직 준비 중입니다.'); return; }
    const digits = phone.replace(/[^0-9]/g, '');
    if (!name.trim()) { alert('이름을 입력해주세요.'); return; }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) { alert('이메일을 정확히 입력해주세요.'); return; }
    if (digits.length < 10) { alert('휴대폰 번호를 정확히 입력해주세요.'); return; }
    setModal(false);
    setLoading(true);
    try {
      const userId = (session!.user as { id?: string }).id;
      const paymentId = `sao-${String(userId).slice(0, 8)}-${Date.now().toString(36)}`;
      const payment = await PortOne.requestPayment({
        storeId, channelKey: ONETIME_CHANNEL_KEY, paymentId,
        orderName: `ShortsAI ${q}크레딧`, totalAmount: amount, currency: 'KRW', payMethod: 'CARD',
        customer: { customerId: userId, fullName: name.trim(), phoneNumber: digits, email: email.trim() },
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

  const card: CSSProperties = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 18, padding: 24, maxWidth: 420, margin: '0 auto' };
  const input: CSSProperties = { width: '100%', padding: '11px 12px', borderRadius: 11, background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text)', fontFamily: 'inherit', fontSize: 14, boxSizing: 'border-box' };

  return (
    <>
      <div style={card}>
        <div style={{ fontWeight: 800, fontSize: 18, marginBottom: 4, color: 'var(--text)' }}>크레딧 충전</div>
        <div style={{ color: 'var(--text-dim)', fontSize: 13.5, marginBottom: 16 }}>필요한 만큼 · 10크레딧당 2,000원 · 안 만료 · 자동결제 없음</div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          {[10, 20, 30].map((n) => (
            <button key={n} onClick={() => setQty(n)} className={`sa-btn ${qty === n ? 'grad' : 'ghost'}`} style={{ flex: 1, justifyContent: 'center' }}>{n}크레딧</button>
          ))}
        </div>
        <label style={{ display: 'block', color: 'var(--text-faint)', fontSize: 12.5, marginBottom: 6 }}>직접 입력 (10 이상)</label>
        <input type="number" min={10} max={2000} value={qty}
          onChange={(e) => setQty(Math.max(0, Math.min(2000, parseInt(e.target.value) || 0)))}
          style={{ ...input, marginBottom: 16 }} />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <span style={{ color: 'var(--text-dim)', fontSize: 14 }}>결제 금액</span>
          <span style={{ fontWeight: 800, fontSize: 26, color: 'var(--text)' }}>₩{amount.toLocaleString()}</span>
        </div>
        <button onClick={open} disabled={loading || q < 10} className="sa-btn grad lg" style={{ width: '100%', justifyContent: 'center', opacity: loading ? 0.6 : 1 }}>
          {loading ? '처리 중...' : `${q}크레딧 충전하기`}
        </button>
        <div style={{ color: 'var(--text-faint)', fontSize: 12, marginTop: 12, textAlign: 'center' }}>슬라이드쇼·로고 1크레딧 · 캐릭터 영상 8크레딧부터</div>
      </div>

      {modal && (
        <div onClick={() => setModal(false)} style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(0,0,0,.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ ...card, maxWidth: 360 }}>
            <div style={{ fontWeight: 800, fontSize: 17, marginBottom: 4, color: 'var(--text)' }}>크레딧 충전</div>
            <div style={{ color: 'var(--text-dim)', fontSize: 13.5, marginBottom: 16 }}>{q}크레딧 · ₩{amount.toLocaleString()} · 안 만료 (1회 결제)</div>
            <input placeholder="이름" value={name} onChange={(e) => setName(e.target.value)} style={{ ...input, marginBottom: 8 }} />
            <input type="email" placeholder="이메일" value={email} onChange={(e) => setEmail(e.target.value)} style={{ ...input, marginBottom: 8 }} />
            <input type="tel" placeholder="휴대폰 (01012345678)" value={phone} onChange={(e) => setPhone(e.target.value)} style={{ ...input, marginBottom: 16 }} />
            <button onClick={pay} className="sa-btn grad lg" style={{ width: '100%', justifyContent: 'center' }}>결제하기</button>
            <div style={{ color: 'var(--text-faint)', fontSize: 11.5, marginTop: 12, textAlign: 'center' }}>결제 영수증 발급을 위해 필요합니다.</div>
          </div>
        </div>
      )}
    </>
  );
}
