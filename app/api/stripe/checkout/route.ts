import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';

const PRICE_IDS: Record<string, string> = {
  basic: process.env.STRIPE_BASIC_PRICE_ID || 'price_basic',
  pro: process.env.STRIPE_PRO_PRICE_ID || 'price_pro',
};

export async function POST(req: NextRequest) {
  if (!process.env.STRIPE_SECRET_KEY) {
    return NextResponse.json(
      { error: 'Stripe가 설정되지 않았습니다. .env.local에 STRIPE_SECRET_KEY를 추가해주세요.' },
      { status: 503 }
    );
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const body = await req.json().catch(() => ({}));
  const { plan, sessionId } = body;

  if (!plan || !['basic', 'pro'].includes(plan)) {
    return NextResponse.json({ error: '올바른 플랜을 선택해주세요.' }, { status: 400 });
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

  const session = await stripe.checkout.sessions.create({
    payment_method_types: ['card'],
    line_items: [
      {
        price: PRICE_IDS[plan],
        quantity: 1,
      },
    ],
    mode: 'subscription',
    success_url: `${appUrl}/generate?upgraded=${plan}&session=${sessionId}`,
    cancel_url: `${appUrl}/#pricing`,
    metadata: {
      sessionId: sessionId || '',
      plan,
    },
  });

  return NextResponse.json({ url: session.url });
}
