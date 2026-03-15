import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import axios from 'axios';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: '로그인이 필요합니다' }, { status: 401 });
  }

  const { data: user } = await supabase
    .from('users')
    .select('lemon_subscription_id, lemon_customer_id')
    .eq('id', session.user.id)
    .single();

  if (!user?.lemon_subscription_id) {
    return NextResponse.json({ portalUrl: null });
  }

  const apiKey = process.env.LEMONSQUEEZY_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'Not configured' }, { status: 500 });
  }

  try {
    const res = await axios.get(
      `https://api.lemonsqueezy.com/v1/subscriptions/${user.lemon_subscription_id}`,
      {
        headers: {
          Accept: 'application/vnd.api+json',
          Authorization: `Bearer ${apiKey}`,
        },
        timeout: 10000,
      }
    );

    const portalUrl = res.data?.data?.attributes?.urls?.customer_portal;
    return NextResponse.json({ portalUrl });
  } catch {
    return NextResponse.json({ portalUrl: null });
  }
}
