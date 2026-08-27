import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { buildPromoDescription, buildYouTubeTags } from '@/lib/promo-description';
import fs from 'fs';
import path from 'path';

/** GET — 내 promo-character 영상 목록 (최신순) */
export async function GET() {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });

  const { data, error } = await supabase
    .from('jobs')
    .select('id, status, progress, topic, business_name, script, video_url, error, created_at')
    .eq('user_id', userId)
    .like('topic', '제품홍보:%')
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const items = (data || []).map((r: any) => {
    const meta = (r.script || {}) as { narration?: string; buyLink?: string; catchphrase?: string; tags?: string[]; youtubeUrl?: string; instagramUrl?: string };
    const bizName = r.business_name || String(r.topic || '').replace(/^제품홍보:/, '') || '제목 없음';
    return {
      id: r.id,
      title: bizName,
      catchphrase: meta.catchphrase || '',
      status: r.status,
      progress: r.progress || 0,
      videoUrl: r.status === 'done' ? `/api/video/${r.id}` : null,
      buyLink: meta.buyLink || '',
      description: meta.narration ? buildPromoDescription(meta.narration, meta.buyLink || '') : '',
      tags: (meta.tags && meta.tags.length) ? meta.tags.slice(0, 15)
        : (meta.narration ? buildYouTubeTags(bizName, meta.catchphrase || '', meta.narration, ['제품홍보영상']) : []),
      error: r.error || null,
      youtubeUrl: meta.youtubeUrl || '',
      instagramUrl: meta.instagramUrl || '',
      createdAt: r.created_at,
    };
  });
  return NextResponse.json({ items });
}

/** DELETE ?id= — 영상 삭제 (본인 것만) */
export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });

  const id = (new URL(req.url).searchParams.get('id') || '').replace(/[^a-zA-Z0-9_-]/g, '');
  if (!id) return NextResponse.json({ error: 'id 필요' }, { status: 400 });

  // 소유 확인
  const { data: row } = await supabase.from('jobs').select('id, user_id').eq('id', id).single();
  if (!row || row.user_id !== userId) return NextResponse.json({ error: '권한이 없습니다.' }, { status: 403 });

  try { fs.unlinkSync(path.join(process.cwd(), 'public', 'videos', `${id}.mp4`)); } catch { /* 파일 없어도 무시 */ }
  const { error } = await supabase.from('jobs').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export const dynamic = 'force-dynamic';
