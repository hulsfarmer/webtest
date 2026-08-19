import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import { createJob, updateJob } from '@/lib/jobStore';
import { generatePromoScript, generateYouTubeTags, PromoInput, ScriptSection } from '@/lib/anthropic';
import { buildYouTubeTags } from '@/lib/promo-description';
import { createVisionStoryAvatar, submitVisionStoryVideo, pollVisionStoryVideo } from '@/lib/visionstory';
import { renderHeaderOverlay, renderCtaOverlay, renderPipAssets, renderSubtitle, composePromoCharacter, probeDuration, sanitizeScript } from '@/lib/promo-compose';
import { buildAlignedSubtitles, applySpeed } from '@/lib/promo-subtitles';
// import { canGenerate, incrementUsage } from '@/lib/usageStore'; // TODO(credits)

// 제품 홍보영상 (VisionStory 엔진) — Hedra판 /api/promo-character 의 자매 라우트.
// 차이: 캐릭터 영상+한국어 음성을 VisionStory(V-Character, 내부 Gemini TTS)가 생성.
// 자막은 반환 영상 오디오를 STT로 정렬(우리 시스템 재사용). 제품 합성은 동일.

interface CharVsJobInput extends PromoInput {
  voiceId: string;          // VisionStory Gemini voice_id (예: 'Aoede')
  emotion: string;          // cheerful | marketing | news ...
  characterBuf: Buffer;
  productImagePath: string;
  overlayTitle: string;
  overlayCta: string;
  catchphrase: string;
  headerTheme: string;
  speed?: number;
  sections?: ScriptSection[];
  buyLink?: string;
}

const VS_EMOTIONS = new Set(['cheerful', 'angry', 'marketing', 'news', 'singing']);

async function processPromoCharacterVsJob(jobId: string, input: CharVsJobInput) {
  const tmpDir = path.join(process.cwd(), 'data', 'tmp');
  const videoDir = path.join(process.cwd(), 'public', 'videos');
  [tmpDir, videoDir].forEach((d) => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });
  const charVideoPath = path.join(tmpDir, `${jobId}_char.mp4`);
  const headerPath = path.join(tmpDir, `${jobId}_header.png`);
  const ctaPath = path.join(tmpDir, `${jobId}_cta.png`);
  const maskPath = path.join(tmpDir, `${jobId}_mask.png`);
  const ringPath = path.join(tmpDir, `${jobId}_ring.png`);
  const outPath = path.join(videoDir, `${jobId}.mp4`);
  const subPaths: string[] = [];
  const cleanup = () => [charVideoPath, headerPath, ctaPath, maskPath, ringPath, input.productImagePath, ...subPaths]
    .forEach((f) => { try { fs.unlinkSync(f); } catch { /* noop */ } });

  try {
    // 1) 대본: 편집본 있으면 사용, 없으면 AI 생성
    updateJob(jobId, { status: 'generating_script', progress: 10, steps: { script: 'running', audio: 'pending', video: 'pending' } });
    let sections: ScriptSection[];
    if (input.sections && input.sections.length) {
      sections = input.sections;
    } else {
      const script = await generatePromoScript(input);
      sections = script.sections;
    }
    const byType = (t: ScriptSection['type']) => sanitizeScript(sections.filter((s) => s.type === t).map((s) => s.text).join(' '));
    const hookT = byType('hook'), mainT = byType('main'), ctaT = byType('cta');
    const narration = [hookT, mainT, ctaT].filter(Boolean).join('  ').trim()
      || sanitizeScript(sections.map((s) => s.text).join(' '));
    let ytTags: string[] = [];
    try {
      ytTags = await generateYouTubeTags(input.businessName || '', input.catchphrase || '', narration);
    } catch (e) {
      console.error(`[PromoCharVsJob ${jobId}] AI 태그 실패 → 휴리스틱:`, e instanceof Error ? e.message : e);
      ytTags = buildYouTubeTags(input.businessName || '', input.catchphrase || '', narration);
    }
    updateJob(jobId, { script: JSON.stringify({ narration, buyLink: input.buyLink || '', businessName: input.businessName, catchphrase: input.catchphrase, tags: ytTags }) });
    const L = hookT.length + mainT.length + ctaT.length;
    let f1 = L > 0 ? hookT.length / L : 0.28;
    let f2 = L > 0 ? (hookT.length + mainT.length) / L : 0.72;
    if (!(f1 > 0.08 && f2 > f1 + 0.1 && f2 < 0.92)) { f1 = 0.28; f2 = 0.72; }

    // 2) VisionStory 캐릭터 영상 (내부 TTS로 한국어 음성까지 생성)
    updateJob(jobId, { status: 'generating_video', progress: 35, steps: { script: 'done', audio: 'running', video: 'running' } });
    // 영어 전대문자(브랜드명 등)는 소문자로 — 철자 읽기 방지
    const speakText = narration.replace(/[A-Z]{2,}/g, (m) => m.toLowerCase());
    const emotion = (VS_EMOTIONS.has(input.emotion) ? input.emotion : 'cheerful') as 'cheerful' | 'marketing' | 'news' | 'angry' | 'singing';
    const avatarId = await createVisionStoryAvatar(input.characterBuf, 'image/png');
    const videoId = await submitVisionStoryVideo({
      avatarId, text: speakText, voiceId: input.voiceId, model: 'vs_character_v4',
      aspectRatio: '9:16', resolution: '720p', emotion,
    });
    const charBuf = await pollVisionStoryVideo(videoId, () => updateJob(jobId, { progress: 70, status: 'generating_video' }));
    fs.writeFileSync(charVideoPath, charBuf);

    // 2.5) 배속 (기본 1.0 = 그대로). VisionStory는 자체 페이싱이 자연스러워 배속 불필요.
    updateJob(jobId, { progress: 82, steps: { script: 'done', audio: 'done', video: 'running' } });
    const speed = Math.min(2.0, Math.max(0.5, input.speed || 1.0));
    let effCharPath = charVideoPath;
    if (Math.abs(speed - 1.0) > 0.01) {
      const spedPath = path.join(tmpDir, `${jobId}_char_sped.mp4`);
      await applySpeed(charVideoPath, speed, spedPath);
      effCharPath = spedPath;
      subPaths.push(spedPath);
    }

    // 3) 인터컷 + PiP 합성 + 나레이션 자막 (STT는 VisionStory 영상 오디오에서 직접 추출·정렬)
    updateJob(jobId, { progress: 88 });
    let D = await probeDuration(effCharPath);
    if (!(D > 1)) D = await probeDuration(charVideoPath);
    const t1 = +(D * f1).toFixed(2), t2 = +(D * f2).toFixed(2);

    const { cues, mode } = await buildAlignedSubtitles(effCharPath, narration, D, tmpDir, jobId, { sttSource: charVideoPath, timeScale: 1 / speed });
    const subtitles: { path: string; start: number; end: number }[] = [];
    for (let i = 0; i < cues.length; i++) {
      const sp = path.join(tmpDir, `${jobId}_sub${i}.png`);
      await renderSubtitle(cues[i].text, sp);
      subtitles.push({ path: sp, start: +cues[i].start.toFixed(2), end: +cues[i].end.toFixed(2) });
    }
    subPaths.push(...subtitles.map((s) => s.path));
    console.log(`[PromoCharVsJob ${jobId}] 자막 ${subtitles.length}개 (${mode}), speed ${speed}`);

    await Promise.all([
      renderHeaderOverlay(input.overlayTitle, input.catchphrase, input.headerTheme, headerPath),
      renderCtaOverlay(input.overlayCta, ctaPath),
      renderPipAssets(maskPath, ringPath),
    ]);
    await composePromoCharacter({
      productImagePath: input.productImagePath, characterVideoPath: effCharPath,
      headerPath, ctaPath, pipMaskPath: maskPath, ringPath, durationSec: +D.toFixed(2), t1, t2, outPath, subtitles,
    });

    cleanup();
    updateJob(jobId, { status: 'done', progress: 100, steps: { script: 'done', audio: 'done', video: 'done' }, videoUrl: `/api/video/${jobId}` });
  } catch (err) {
    // 실패 시 임시파일 유지(VisionStory 영상=유료, 재합성용)
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[PromoCharVsJob ${jobId}] Failed:`, msg);
    console.error(`[PromoCharVsJob ${jobId}] 임시파일 유지(재합성용): ${charVideoPath}`);
    updateJob(jobId, { status: 'failed', error: msg });
  }
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id ?? (process.env.NODE_ENV !== 'production' ? 'dev-local' : null);
  if (!userId) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });

  const fd = await req.formData();
  const businessName = ((fd.get('businessName') as string | null) ?? '').trim();
  const businessType = ((fd.get('businessType') as string | null) ?? '').trim();
  const sellingPoints = ((fd.get('sellingPoints') as string | null) ?? '').trim();
  const cta = ((fd.get('cta') as string | null) ?? '').trim();
  const catchphrase = ((fd.get('catchphrase') as string | null) ?? '').trim();
  const headerTheme = (fd.get('headerTheme') as string | null) ?? 'navy';
  const voiceId = ((fd.get('voice') as string | null) ?? 'Aoede').trim(); // VisionStory Gemini voice_id
  const emotion = ((fd.get('emotion') as string | null) ?? 'cheerful').trim();
  const duration = parseInt((fd.get('duration') as string | null) ?? '20', 10);
  const speed = Math.min(2.0, Math.max(0.5, parseFloat((fd.get('speed') as string | null) ?? '1.0') || 1.0));
  const characterName = ((fd.get('characterName') as string | null) ?? '').trim();
  const tone = (fd.get('tone') as string | null) ?? '친근한';
  const preset = (fd.get('preset') as string | null) ?? '';
  const characterFile = fd.get('character') as File | null;
  const productFile = fd.get('product') as File | null;
  const productPath = ((fd.get('productPath') as string | null) ?? '').trim();
  const buyLink = ((fd.get('buyLink') as string | null) ?? '').trim();

  let sections: ScriptSection[] | undefined;
  const sectionsRaw = fd.get('sections') as string | null;
  if (sectionsRaw) {
    try {
      const parsed = JSON.parse(sectionsRaw) as ScriptSection[];
      if (Array.isArray(parsed) && parsed.length) sections = parsed.map((s) => ({ type: s.type, text: String(s.text || ''), duration: s.duration || 0 }));
    } catch { /* 무시하고 AI 생성 */ }
  }

  if (!businessName) return NextResponse.json({ error: '제품명을 입력해주세요.' }, { status: 400 });
  if (!sections && !sellingPoints) return NextResponse.json({ error: '홍보 포인트를 입력해주세요.' }, { status: 400 });
  if (!productFile && !productPath) return NextResponse.json({ error: '제품 이미지를 업로드하거나 링크에서 불러와주세요.' }, { status: 400 });

  let characterBuf: Buffer;
  if (characterFile && typeof characterFile.arrayBuffer === 'function') {
    characterBuf = Buffer.from(await characterFile.arrayBuffer());
  } else if (preset) {
    const safe = preset.replace(/[^a-zA-Z0-9_-]/g, '');
    const p = path.join(process.cwd(), 'public', 'characters', `${safe}.png`);
    if (!fs.existsSync(p)) return NextResponse.json({ error: '프리셋 캐릭터를 찾을 수 없습니다.' }, { status: 400 });
    characterBuf = fs.readFileSync(p);
  } else {
    return NextResponse.json({ error: '캐릭터를 선택하거나 업로드해주세요.' }, { status: 400 });
  }

  const tmpDir = path.join(process.cwd(), 'data', 'tmp');
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
  const jobId = uuidv4();
  const productImagePath = path.join(tmpDir, `${jobId}_product.png`);
  if (productFile && typeof productFile.arrayBuffer === 'function') {
    fs.writeFileSync(productImagePath, Buffer.from(await productFile.arrayBuffer()));
  } else {
    const base = path.basename(productPath);
    const src = path.join(process.cwd(), 'public', 'imports', base);
    if (!fs.existsSync(src)) return NextResponse.json({ error: '불러온 제품 이미지를 찾을 수 없습니다. 다시 시도해주세요.' }, { status: 400 });
    fs.copyFileSync(src, productImagePath);
  }

  await createJob({
    id: jobId, sessionId: userId, topic: `제품홍보:${businessName}`, duration, tone,
    businessName, script: { buyLink, catchphrase, characterName },
  });
  updateJob(jobId, { status: 'queued', progress: 5, steps: { script: 'pending', audio: 'pending', video: 'pending' } });

  processPromoCharacterVsJob(jobId, {
    businessName, businessType, sellingPoints, cta, duration, tone,
    voiceId, emotion, characterBuf, productImagePath,
    overlayTitle: businessName, overlayCta: cta,
    catchphrase, headerTheme, speed, characterName, sections, buyLink,
  }).catch(console.error);

  return NextResponse.json({ jobId });
}
