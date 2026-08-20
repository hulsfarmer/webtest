import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { chargeBillingKey, isPortOneConfigured } from '@/lib/portone';
import { renewSubscription, cancelSubscription, upgradePlan } from '@/lib/usageStore';

/**
 * 정기결제 갱신 크론 (매일 실행, 시스템 crontab이 CRON_SECRET 헤더로 호출).
 * 만료 임박(24h 내)/만료된 구독자를 빌링키로 자동청구 → 성공 시 +1개월 연장.
 * 청구 실패가 5일 이상 지속되면 빌링키 제거 + free 강등(청구 포기).
 */
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get('x-cron-secret') !== secret) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  if (!isPortOneConfigured()) {
    return NextResponse.json({ ok: true, skipped: 'PortOne 미설정' });
  }

  const now = Date.now();
  const dueThreshold = new Date(now + 24 * 60 * 60 * 1000).toISOString(); // 24h 내 만료분까지 선청구

  const { data: users, error } = await supabase
    .from('users')
    .select('id, plan, plan_expires_at, portone_billing_key')
    .not('portone_billing_key', 'is', null)
    .lte('plan_expires_at', dueThreshold);

  if (error) {
    console.error('[Cron] 구독자 조회 실패:', error);
    return NextResponse.json({ error: 'query failed' }, { status: 500 });
  }

  let renewed = 0, failed = 0, dropped = 0;
  for (const u of users || []) {
    if (!u.portone_billing_key || u.plan === 'free' || u.plan === 'admin') continue;
    const paymentId = `sar-${String(u.id).slice(0, 8)}-${now.toString(36)}`;
    const result = await chargeBillingKey(paymentId, u.portone_billing_key, u.plan, u.id);
    if (result.ok) {
      await renewSubscription(u.id, u.plan_expires_at, u.plan);
      renewed++;
      console.log(`[Cron] 갱신 성공 user=${u.id} plan=${u.plan}`);
    } else {
      failed++;
      console.error(`[Cron] 갱신 실패 user=${u.id}: ${result.error}`);
      // 만료 후 5일 이상 청구 실패 → 청구 포기(빌링키 제거 + free 강등)
      const expired = u.plan_expires_at ? new Date(u.plan_expires_at).getTime() : 0;
      if (expired && now - expired > 5 * 24 * 60 * 60 * 1000) {
        await cancelSubscription(u.id);
        await upgradePlan(u.id, 'free');
        dropped++;
        console.warn(`[Cron] 청구 포기 user=${u.id} → free (5일 초과 실패)`);
      }
    }
  }

  return NextResponse.json({ ok: true, checked: users?.length || 0, renewed, failed, dropped });
}
