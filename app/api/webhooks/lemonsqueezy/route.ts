import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { supabase } from '@/lib/supabase';
import { VARIANT_TO_PLAN } from '@/lib/usageStore';

export async function POST(request: NextRequest) {
  const signature = request.headers.get('X-Signature');
  if (!signature) {
    return NextResponse.json({ error: 'Missing signature' }, { status: 400 });
  }

  const rawBody = await request.text();
  if (!rawBody) {
    return NextResponse.json({ error: 'Empty body' }, { status: 400 });
  }

  // HMAC-SHA256 서명 검증
  const secret = process.env.LEMONSQUEEZY_WEBHOOK_SECRET!;
  const hmac = crypto.createHmac('sha256', secret);
  const digest = Buffer.from(hmac.update(rawBody).digest('hex'), 'utf8');
  const signatureBuf = Buffer.from(signature, 'utf8');

  if (digest.length !== signatureBuf.length || !crypto.timingSafeEqual(digest, signatureBuf)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  const event = JSON.parse(rawBody);
  const eventName: string = event.meta?.event_name;
  const data = event.data?.attributes;
  const customData = event.meta?.custom_data;

  console.log(`[Webhook] LemonSqueezy event: ${eventName}`);

  try {
    switch (eventName) {
      case 'subscription_created':
      case 'subscription_updated': {
        const userId = customData?.user_id;
        const email = data?.user_email;
        const variantId = String(data?.variant_id);
        const status: string = data?.status; // active, cancelled, expired, paused
        const subscriptionId = String(event.data?.id);
        const customerId = String(data?.customer_id);

        const plan = VARIANT_TO_PLAN[variantId] || 'free';
        const isActive = status === 'active';

        // userId 또는 email로 사용자 찾기
        let targetUserId = userId;
        if (!targetUserId && email) {
          const { data: user } = await supabase
            .from('users')
            .select('id')
            .eq('email', email)
            .single();
          targetUserId = user?.id;
        }

        if (targetUserId) {
          await supabase
            .from('users')
            .update({
              plan: isActive ? plan : 'free',
              lemon_subscription_id: subscriptionId,
              lemon_customer_id: customerId,
              monthly_usage: 0,
              usage_reset_month: new Date().toISOString().slice(0, 7),
            })
            .eq('id', targetUserId);
          console.log(`[Webhook] User ${targetUserId} → plan: ${isActive ? plan : 'free'}`);
        } else {
          console.warn(`[Webhook] User not found for email: ${email}`);
        }
        break;
      }

      case 'subscription_expired':
      case 'subscription_cancelled': {
        const subscriptionId = String(event.data?.id);
        // subscription_cancelled에서 status가 cancelled이면 아직 기간 남음
        // subscription_expired에서만 실제 다운그레이드
        if (eventName === 'subscription_expired') {
          await supabase
            .from('users')
            .update({ plan: 'free' })
            .eq('lemon_subscription_id', subscriptionId);
          console.log(`[Webhook] Subscription ${subscriptionId} expired → free`);
        } else {
          console.log(`[Webhook] Subscription ${subscriptionId} cancelled (still active until period end)`);
        }
        break;
      }
    }
  } catch (err) {
    console.error('[Webhook] Processing error:', err);
  }

  return NextResponse.json({ success: true }, { status: 200 });
}
