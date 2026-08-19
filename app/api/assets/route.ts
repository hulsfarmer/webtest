import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

export const runtime = 'nodejs';
export const maxDuration = 30;

// GET /api/assets?type=logo|banner — 사용자의 로고·배너 라이브러리
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  const type = new URL(req.url).searchParams.get('type');
  let q = supabase
    .from('assets')
    .select('id, type, title, image, created_at')
    .eq('user_id', session.user.id)
    .order('created_at', { ascending: false })
    .limit(100);
  if (type) q = q.eq('type', type);
  const { data, error } = await q;
  if (error) return NextResponse.json({ assets: [], error: error.message });
  return NextResponse.json({ assets: data || [] });
}

// POST /api/assets — 로고·배너 저장 { type, title, image(dataURL) }
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  let body: { type?: string; title?: string; image?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: '잘못된 요청입니다.' }, { status: 400 }); }
  const { type, title, image } = body;
  if (!image || typeof image !== 'string' || !image.startsWith('data:image')) {
    return NextResponse.json({ error: '저장할 이미지가 없습니다.' }, { status: 400 });
  }
  if (type !== 'logo' && type !== 'banner') {
    return NextResponse.json({ error: '지원하지 않는 타입입니다.' }, { status: 400 });
  }
  const { data, error } = await supabase
    .from('assets')
    .insert({ user_id: session.user.id, type, title: (title || '').slice(0, 80), image })
    .select('id')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, id: data?.id });
}

// PATCH /api/assets — 기존 항목 수정 { id, image?, title? }
export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  let body: { id?: string; image?: string; title?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: '잘못된 요청입니다.' }, { status: 400 }); }
  const { id, image, title } = body;
  if (!id) return NextResponse.json({ error: 'id가 필요합니다.' }, { status: 400 });
  const { data: row } = await supabase.from('assets').select('user_id').eq('id', id).single();
  if (!row || row.user_id !== session.user.id) return NextResponse.json({ error: '권한이 없습니다.' }, { status: 403 });
  const patch: { image?: string; title?: string } = {};
  if (typeof image === 'string' && image.startsWith('data:image')) patch.image = image;
  if (typeof title === 'string') patch.title = title.slice(0, 80);
  if (Object.keys(patch).length === 0) return NextResponse.json({ error: '변경할 내용이 없습니다.' }, { status: 400 });
  const { error } = await supabase.from('assets').update(patch).eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

// DELETE /api/assets?id=
export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  const id = new URL(req.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id가 필요합니다.' }, { status: 400 });
  const { data: row } = await supabase.from('assets').select('user_id').eq('id', id).single();
  if (!row || row.user_id !== session.user.id) return NextResponse.json({ error: '권한이 없습니다.' }, { status: 403 });
  const { error } = await supabase.from('assets').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
