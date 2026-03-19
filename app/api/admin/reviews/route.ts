import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '').split(',').map(e => e.trim()).filter(Boolean);

// GET: 모든 후기 목록 (어드민용)
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email || !ADMIN_EMAILS.includes(session.user.email)) {
    return NextResponse.json({ error: '권한이 없습니다' }, { status: 403 });
  }

  const { data, error } = await supabase
    .from('reviews')
    .select(`
      id, user_id, job_id, rating, text, display_name, business_type, status, created_at,
      users!inner(name, email)
    `)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) {
    // inner join이 실패할 수 있으므로 fallback
    const { data: fallback } = await supabase
      .from('reviews')
      .select('id, user_id, job_id, rating, text, display_name, business_type, status, created_at')
      .order('created_at', { ascending: false })
      .limit(50);

    return NextResponse.json({ reviews: fallback ?? [] });
  }

  return NextResponse.json({ reviews: data ?? [] });
}

// PATCH: 후기 승인/거절
export async function PATCH(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email || !ADMIN_EMAILS.includes(session.user.email)) {
    return NextResponse.json({ error: '권한이 없습니다' }, { status: 403 });
  }

  const { id, status } = await request.json();
  if (!id || !['approved', 'rejected', 'pending'].includes(status)) {
    return NextResponse.json({ error: '잘못된 요청입니다' }, { status: 400 });
  }

  const { error } = await supabase
    .from('reviews')
    .update({ status })
    .eq('id', id);

  if (error) {
    console.error('[Admin Reviews] PATCH error:', error);
    return NextResponse.json({ error: '상태 변경에 실패했습니다' }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}

// DELETE: 후기 삭제
export async function DELETE(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email || !ADMIN_EMAILS.includes(session.user.email)) {
    return NextResponse.json({ error: '권한이 없습니다' }, { status: 403 });
  }

  const { id } = await request.json();
  if (!id) {
    return NextResponse.json({ error: '잘못된 요청입니다' }, { status: 400 });
  }

  const { error } = await supabase
    .from('reviews')
    .delete()
    .eq('id', id);

  if (error) {
    console.error('[Admin Reviews] DELETE error:', error);
    return NextResponse.json({ error: '삭제에 실패했습니다' }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
