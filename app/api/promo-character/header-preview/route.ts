import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { renderHeaderOverlay } from '@/lib/promo-compose';

/** 헤더 오버레이만 렌더해 미리보기 PNG(data URI) 반환 — 테마·문구 즉시 확인용 */
export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({}));
  const tmpDir = path.join(process.cwd(), 'data', 'tmp');
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
  const p = path.join(tmpDir, `hdr_${uuidv4()}.png`);
  try {
    await renderHeaderOverlay(
      String(b.businessName || ''), // 빈 값이면 그대로 빈 값 → 문구 단독 헤더(제품1/2). 폴백 '제품명' 제거
      String(b.catchphrase || ''),
      String(b.headerTheme || 'navy'),
      p,
    );
    const buf = fs.readFileSync(p);
    return NextResponse.json({ image: `data:image/png;base64,${buf.toString('base64')}` });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  } finally {
    try { fs.unlinkSync(p); } catch { /* noop */ }
  }
}
