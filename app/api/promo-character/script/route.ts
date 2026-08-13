import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { generatePromoScript } from '@/lib/anthropic';
import { sanitizeScript } from '@/lib/promo-compose';

/** 영상 생성 전에 AI 홍보 대본(인트로/제품소개/마무리)을 미리 생성 → 사용자 검토·편집용 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id ?? (process.env.NODE_ENV !== 'production' ? 'dev-local' : null);
  if (!userId) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const businessName = String(body.businessName || '').trim();
  const sellingPoints = String(body.sellingPoints || '').trim();
  if (!businessName) return NextResponse.json({ error: '제품명을 입력해주세요.' }, { status: 400 });
  if (!sellingPoints) return NextResponse.json({ error: '홍보 포인트를 입력해주세요.' }, { status: 400 });

  try {
    const script = await generatePromoScript({
      businessName,
      businessType: String(body.businessType || '').trim(),
      sellingPoints,
      cta: String(body.cta || '').trim(),
      duration: parseInt(String(body.duration || '20'), 10),
      tone: String(body.tone || '친근한'),
    });
    // hook/main/cta 3구간으로 정리 (정제)
    const pick = (t: 'hook' | 'main' | 'cta') =>
      sanitizeScript(script.sections.filter((s) => s.type === t).map((s) => s.text).join(' '));
    const sections = [
      { type: 'hook' as const, label: '인트로 (캐릭터)', text: pick('hook') },
      { type: 'main' as const, label: '제품 소개 (제품+캐릭터)', text: pick('main') },
      { type: 'cta' as const, label: '마무리 (캐릭터)', text: pick('cta') },
    ].filter((s) => s.text);
    return NextResponse.json({ title: script.title, sections });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
