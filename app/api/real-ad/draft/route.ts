import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { isAdminEmail } from '@/lib/admin';
import { extractFromHtml } from '@/lib/real-ad-extract';
import { generateAdDraft } from '@/lib/real-ad-script';

export const runtime = 'nodejs';
export const maxDuration = 120;

// HTML 상세페이지 → 이미지 목록 + AI 슬롯 초안(자막+나레이션)
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const isAdmin = isAdminEmail(session?.user?.email) || process.env.NODE_ENV !== 'production';
  if (!isAdmin) return NextResponse.json({ error: '관리자 전용 기능입니다.' }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const html = String(body.html || '');
  const productName = String(body.productName || '').trim();
  const price = String(body.price || '').trim();
  if (!html) return NextResponse.json({ error: 'HTML 이 비었습니다.' }, { status: 400 });
  if (!productName) return NextResponse.json({ error: '제품명을 입력하세요.' }, { status: 400 });

  try {
    const { images, texts } = extractFromHtml(html);
    const draft = await generateAdDraft(productName, price, texts);
    return NextResponse.json({ images, texts, draft });
  } catch (e) {
    console.error('[real-ad/draft] 실패:', e instanceof Error ? e.stack : e);
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
