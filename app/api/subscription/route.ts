import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

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

  const subId = user.lemon_subscription_id;
  const portalUrl = `https://promiai.lemonsqueezy.com/billing/${subId}/update`;

  return NextResponse.json({ portalUrl });
}
