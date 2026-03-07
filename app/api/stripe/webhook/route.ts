import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { upgradePlan } from '@/lib/usageStore';
import type { Plan } from '@/lib/usageStore';

export async function POST(req: NextRequest) {
  if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_WEBHOOK_SECRET) {
    return NextResponse.json({ error: 'Stripe not configured' }, { status: 503 });
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const body = await req.text();
  const sig = req.headers.get('stripe-signature');

  if (!sig) {
    return NextResponse.json({ error: 'Missing signature' }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Stripe webhook signature error:', err);
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session;
    const { sessionId, plan } = session.metadata || {};
    if (sessionId && plan) {
      upgradePlan(sessionId, plan as Plan);
      console.log(`[Stripe] Upgraded ${sessionId} to ${plan}`);
    }
  }

  return NextResponse.json({ received: true });
}
