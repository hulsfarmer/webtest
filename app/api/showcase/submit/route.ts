import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

// 랜딩 소개 신청 — 완성 영상을 홈 쇼케이스에 올려달라고 신청(관리자 승인 후 노출).
// 기존 reviews 테이블/승인 인프라 재활용 (rating/text는 신청용 기본값).
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string })?.id;
  if (!userId) return NextResponse.json({ error: '로그인이 필요합니다' }, { status: 401 });

  const { jobId, consent } = await req.json().catch(() => ({}));
  if (!jobId) return NextResponse.json({ error: 'jobId가 필요합니다' }, { status: 400 });
  if (!consent) return NextResponse.json({ error: '홈 화면 공개 동의가 필요합니다' }, { status: 400 });

  const { data: job } = await supabase.from('jobs').select('id, business_name, status, video_url').eq('id', jobId).single();
  if (!job || job.status !== 'done' || !job.video_url) {
    return NextResponse.json({ error: '완성된 영상만 신청할 수 있어요.' }, { status: 400 });
  }
  const { data: existing } = await supabase.from('reviews').select('id').eq('user_id', userId).eq('job_id', jobId).maybeSingle();
  if (existing) return NextResponse.json({ error: '이미 이 영상을 신청했어요. 승인을 기다려주세요.' }, { status: 409 });

  const { error } = await supabase.from('reviews').insert({
    user_id: userId, job_id: jobId, rating: 5, text: '(랜딩 소개 신청)',
    display_name: job.business_name || session?.user?.name || '', business_type: null,
    allow_showcase: true, status: 'pending',
  });
  if (error) { console.error('[showcase submit]', error); return NextResponse.json({ error: '신청 저장에 실패했습니다.' }, { status: 500 }); }
  return NextResponse.json({ ok: true });
}
