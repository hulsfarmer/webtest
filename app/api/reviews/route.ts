import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

// GET: 승인된 후기 목록 (공개)
export async function GET() {
  const { data, error } = await supabase
    .from('reviews')
    .select('id, rating, text, display_name, business_type, created_at')
    .eq('status', 'approved')
    .order('created_at', { ascending: false })
    .limit(20);

  if (error) {
    console.error('[Reviews] GET error:', error);
    return NextResponse.json({ reviews: [] });
  }

  return NextResponse.json({ reviews: data ?? [] });
}

// POST: 후기 작성 (로그인 필요)
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string })?.id;
  if (!session?.user || !userId) {
    return NextResponse.json({ error: '로그인이 필요합니다' }, { status: 401 });
  }

  const body = await request.json();
  const { rating, text, displayName, businessType, jobId } = body;

  // Validation
  if (!rating || rating < 1 || rating > 5) {
    return NextResponse.json({ error: '별점은 1~5점이어야 합니다' }, { status: 400 });
  }
  if (!text || typeof text !== 'string' || text.trim().length < 5) {
    return NextResponse.json({ error: '후기는 최소 5글자 이상 작성해주세요' }, { status: 400 });
  }
  if (text.trim().length > 500) {
    return NextResponse.json({ error: '후기는 500자 이내로 작성해주세요' }, { status: 400 });
  }

  // 중복 방지: 같은 job에 이미 후기를 작성한 경우
  if (jobId) {
    const { data: existing } = await supabase
      .from('reviews')
      .select('id')
      .eq('user_id', userId)
      .eq('job_id', jobId)
      .limit(1);
    if (existing && existing.length > 0) {
      return NextResponse.json({ error: '이미 이 영상에 대한 후기를 작성하셨습니다' }, { status: 409 });
    }
  }

  const { data, error } = await supabase
    .from('reviews')
    .insert({
      user_id: userId,
      job_id: jobId || null,
      rating: Math.round(rating),
      text: text.trim(),
      display_name: displayName?.trim() || session.user.name || '익명',
      business_type: businessType?.trim() || null,
      status: 'pending',
    })
    .select('id')
    .single();

  if (error) {
    console.error('[Reviews] POST error:', error);
    return NextResponse.json({ error: '후기 저장에 실패했습니다' }, { status: 500 });
  }

  return NextResponse.json({ success: true, id: data.id });
}
