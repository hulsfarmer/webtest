import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { isAdminEmail } from '@/lib/admin';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import { generateAudio } from '@/lib/tts';
import { resolveBgmPath } from '@/lib/bgm';
import type { BgmId } from '@/lib/bgm-catalog';
import { assembleRealAd, RealAdInput, RealAdSlot } from '@/lib/real-ad';
import { createJob, updateJob } from '@/lib/jobStore';

export const runtime = 'nodejs';
export const maxDuration = 300;

// 슬롯 메타(클라이언트 전송분) — 미디어는 별도 파일로 온다
interface SlotMeta {
  kind: 'hook' | 'promo' | 'cta';
  lines: string[];
  question?: string;
  scenes?: { text: string; imgPrompt?: string; pose?: string; face?: string; prop?: string; item?: boolean; itemLabel?: string }[];
  badge?: string;
  priceText?: string;
  footerText?: string;
  narration: string;
  hasMedia?: boolean;
  mediaUrl?: string;   // 상세페이지 이미지 URL (업로드 대신)
}
interface Meta {
  slots: SlotMeta[];
  bgmId?: BgmId;
  bgmVolume?: number;
  voice?: string;       // nova(민지)/shimmer(수아)/echo(남)
  brandName?: string;
  productName?: string;
}

const EXT: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
  'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm',
};

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const isAdmin = isAdminEmail(session?.user?.email) || process.env.NODE_ENV !== 'production';
  if (!isAdmin) return NextResponse.json({ error: '관리자 전용 기능입니다.' }, { status: 403 });

  let meta: Meta;
  const fd = await req.formData();
  try { meta = JSON.parse(String(fd.get('meta') || '')); }
  catch { return NextResponse.json({ error: 'meta 파싱 실패' }, { status: 400 }); }
  if (!meta?.slots?.length) return NextResponse.json({ error: '슬롯이 비었습니다.' }, { status: 400 });

  const id = uuidv4();
  const videoDir = path.join(process.cwd(), 'public', 'videos');
  const workDir = path.join(videoDir, `tmp_${id}`);
  fs.mkdirSync(workDir, { recursive: true });
  const outPath = path.join(videoDir, `${id}.mp4`);

  try {
    // 슬롯별 미디어 파일 저장
    const slots: RealAdSlot[] = [];
    for (let i = 0; i < meta.slots.length; i++) {
      const s = meta.slots[i];
      let mediaPath: string | undefined;
      if (s.hasMedia) {
        const file = fd.get(`media_${i}`) as File | null;
        if (file && typeof file.arrayBuffer === 'function') {
          const ext = EXT[file.type] || 'jpg';
          mediaPath = path.join(workDir, `media_${i}.${ext}`);
          fs.writeFileSync(mediaPath, Buffer.from(await file.arrayBuffer()));
        }
      } else if (s.mediaUrl && /^https?:\/\//i.test(s.mediaUrl)) {
        // 상세페이지 이미지 URL → 서버에서 다운로드
        try {
          const r = await fetch(s.mediaUrl);
          if (r.ok) {
            const ct = r.headers.get('content-type') || '';
            const ext = ct.includes('png') ? 'png' : ct.includes('gif') ? 'gif' : ct.includes('webp') ? 'webp' : ct.includes('mp4') ? 'mp4' : 'jpg';
            mediaPath = path.join(workDir, `media_${i}.${ext}`);
            fs.writeFileSync(mediaPath, Buffer.from(await r.arrayBuffer()));
          }
        } catch { /* 이미지 없이 진행 */ }
      }
      slots.push({
        kind: s.kind, lines: s.lines || [], question: s.question,
        scenes: s.scenes as RealAdSlot['scenes'],
        badge: s.badge, priceText: s.priceText, footerText: s.footerText, narration: s.narration || '', mediaPath,
      });
    }

    const bgmPath = meta.bgmId ? await resolveBgmPath(meta.bgmId) : null;
    const voice = meta.voice || 'nova'; // 기본 민지(Chirp3-HD-Aoede)

    const input: RealAdInput = {
      slots, bgmPath, bgmVolume: meta.bgmVolume ?? 0.5, brandName: meta.brandName || '',
    };
    const ttsFn = (text: string, out: string) => generateAudio(text, out, 40, voice, 1.0);

    const { duration } = await assembleRealAd(input, ttsFn, workDir, outPath);

    // 라이브러리(jobs)에 저장 — 로그인 사용자의 내 라이브러리에 노출
    const userId = session?.user?.id;
    if (userId) {
      try {
        const productName = meta.productName?.trim()
          || meta.slots.find((s) => s.kind === 'cta')?.lines?.[0]
          || meta.brandName || '실사 제품광고';
        await createJob({ id, sessionId: userId, topic: `${productName} 실사광고`, duration, tone: 'energetic' });
        updateJob(id, { status: 'done', progress: 100, steps: { script: 'done', audio: 'done', video: 'done' }, videoUrl: `/api/video/${id}` });
      } catch (e) { console.error('[real-ad] 라이브러리 저장 실패:', e); }
    }

    return NextResponse.json({ videoUrl: `/api/video/${id}`, id, duration });
  } catch (e) {
    console.error('[real-ad] 생성 실패:', e instanceof Error ? e.stack : e);
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  } finally {
    try { fs.rmSync(workDir, { recursive: true, force: true }); } catch { /* noop */ }
  }
}
