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
import { generateActorHoldingProduct } from '@/lib/product-actor';
import { generateGeminiAudio } from '@/lib/gemini-tts';
import { renderHeaderOverlay, renderCtaOverlay, renderPipAssets, renderSubtitle, composePromoCharacter, buildSegmentClip, concatSegments, probeDuration, sanitizeScript } from '@/lib/promo-compose';
import { buildAlignedSubtitles, applySpeed } from '@/lib/promo-subtitles';
import { hasCredits, chargeCredits } from '@/lib/usageStore';
import { recordVsUsage } from '@/lib/visionStoryCredits';

// 캐릭터2(AI배우) 고정 요금: 20초 1편당 15크레딧 (캐릭터 대비 프리미엄).
const AI_ACTOR_CREDITS = 15;

// 제품 홍보영상 (AI배우) — 관리자 전용.
// promo-character-vs 의 자매 라우트. 차이: 사용자가 캐릭터를 고르지 않고,
// Gemini가 "제품을 든 프리젠터 이미지"를 생성해 그걸 VisionStory 아바타로 발화시킨다.
// 목소리도 안 고름 — 제품에 맞춰 배우 성별을 자동 결정하고, 그 성별의 목소리로 매칭한다.

/** 제품 정보로 배우 성별 자동 추론 (남성용 상품이면 남성, 그 외 기본 여성). */
function inferActorGender(...parts: (string | undefined)[]): 'female' | 'male' {
  const t = parts.filter(Boolean).join(' ').toLowerCase();
  if (/(남성|남자|맨즈|men['’]?s|\bmen\b|\bman\b|면도|쉐이빙|수염|남성용|아빠|신랑)/.test(t)) return 'male';
  return 'female';
}

interface CharAiJobInput extends PromoInput {
  voiceId: string;
  emotion: string;
  presenter: 'female' | 'male'; // 자동 결정된 배우 성별 (배우 이미지 + 목소리 매칭)
  vsModel?: string;             // vs_talk_v1(저가·제품1) | vs_character_v4(프리미엄·제품2)
  credits?: number;             // 사이트 크레딧 정액 (제품1=5, 제품2=15)
  productImagePath: string;
  overlayTitle: string;
  overlayCta: string;
  catchphrase: string;
  headerTheme: string;
  speed?: number;
  sections?: ScriptSection[];
  buyLink?: string;
  introChar?: boolean;
  productChar?: boolean;
  outroChar?: boolean;
  userId: string;
}

async function processPromoCharacterAiJob(jobId: string, input: CharAiJobInput) {
  const tmpDir = path.join(process.cwd(), 'data', 'tmp');
  const videoDir = path.join(process.cwd(), 'public', 'videos');
  [tmpDir, videoDir].forEach((d) => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });
  const headerPath = path.join(tmpDir, `${jobId}_header.png`);
  const ctaPath = path.join(tmpDir, `${jobId}_cta.png`);
  const maskPath = path.join(tmpDir, `${jobId}_mask.png`);
  const ringPath = path.join(tmpDir, `${jobId}_ring.png`);
  const actorPath = path.join(tmpDir, `${jobId}_actor.png`);
  const outPath = path.join(videoDir, `${jobId}.mp4`);
  const subPaths: string[] = [];
  const cleanup = () => [headerPath, ctaPath, maskPath, ringPath, actorPath, input.productImagePath, ...subPaths]
    .forEach((f) => { try { fs.unlinkSync(f); } catch { /* noop */ } });

  try {
    // 0) 제품 든 배우 이미지 생성(Gemini) → VisionStory 아바타 1회 등록
    updateJob(jobId, { status: 'generating_script', progress: 8, steps: { script: 'running', audio: 'pending', video: 'pending' } });
    const productBuf = fs.readFileSync(input.productImagePath);
    const actorBuf = await generateActorHoldingProduct(productBuf, {
      businessName: input.businessName, businessType: input.businessType, sellingPoints: input.sellingPoints,
      presenter: input.presenter === 'male'
        ? 'a friendly Korean man in his late 20s to 30s'
        : 'a friendly Korean woman in her late 20s to 30s',
    });
    fs.writeFileSync(actorPath, actorBuf);
    const avatarId = await createVisionStoryAvatar(actorBuf, 'image/png');

    // 1) 대본: 편집본 있으면 사용, 없으면 AI 생성
    updateJob(jobId, { status: 'generating_script', progress: 14 });
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
      console.error(`[PromoCharAiJob ${jobId}] AI 태그 실패 → 휴리스틱:`, e instanceof Error ? e.message : e);
      ytTags = buildYouTubeTags(input.businessName || '', input.catchphrase || '', narration, ['제품홍보영상']);
    }
    // '수정' 복원용: 제품 이미지 영구 사본(public/imports)
    let productImageUrl = '';
    try {
      const reuseImg = path.join(process.cwd(), 'public', 'imports', `reuse_${jobId}.png`);
      fs.copyFileSync(input.productImagePath, reuseImg);
      productImageUrl = `/imports/reuse_${jobId}.png`;
    } catch { /* noop */ }
    updateJob(jobId, { script: JSON.stringify({
      narration, buyLink: input.buyLink || '', businessName: input.businessName, catchphrase: input.catchphrase, tags: ytTags,
      sections: sections.map((s) => ({ type: s.type, text: s.text })), productImageUrl,
      businessType: input.businessType || '', sellingPoints: input.sellingPoints || '', cta: input.cta || '',
      headerTheme: input.headerTheme || 'navy', voice: input.voiceId || '',
      introChar: input.introChar !== false, productChar: input.productChar !== false, outroChar: input.outroChar !== false,
    }) });
    const L = hookT.length + mainT.length + ctaT.length;
    let f1 = L > 0 ? hookT.length / L : 0.28;
    let f2 = L > 0 ? (hookT.length + mainT.length) / L : 0.72;
    if (!(f1 > 0.08 && f2 > f1 + 0.1 && f2 < 0.92)) { f1 = 0.28; f2 = 0.72; }

    // 2) 공통 에셋 (헤더·CTA·PiP)
    await Promise.all([
      renderHeaderOverlay(input.overlayTitle, input.catchphrase, input.headerTheme, headerPath),
      renderCtaOverlay(input.overlayCta, ctaPath),
      renderPipAssets(maskPath, ringPath),
    ]);
    const speed = Math.min(2.0, Math.max(0.5, input.speed || 1.0));
    const introChar = input.introChar !== false, productChar = input.productChar !== false, outroChar = input.outroChar !== false;
    const allChar = introChar && productChar && outroChar;
    let vsCreditsUsed = 0;

    const mkAudio = async (txt: string, suffix: string) => {
      const p = path.join(tmpDir, `${jobId}_${suffix}.mp3`); subPaths.push(p);
      await generateGeminiAudio(txt.replace(/[A-Z]{2,}/g, (m) => m.toLowerCase()), input.voiceId, p);
      return p;
    };
    const mkChar = async (audioP: string, suffix: string) => {
      const vid = await submitVisionStoryVideo({ avatarId, audioBuf: fs.readFileSync(audioP), model: input.vsModel || 'vs_character_v4', aspectRatio: '9:16', resolution: '720p' });
      const cb = await pollVisionStoryVideo(vid, (_st, cost) => { if (typeof cost === 'number') vsCreditsUsed += cost; updateJob(jobId, { progress: 60, status: 'generating_video' }); });
      const cp = path.join(tmpDir, `${jobId}_${suffix}.mp4`); fs.writeFileSync(cp, cb); subPaths.push(cp);
      return cp;
    };
    const mkSubs = async (refPath: string, text: string, dur: number, suffix: string, sttSrc: string, timeScale = 1) => {
      const { cues } = await buildAlignedSubtitles(refPath, text, dur, tmpDir, `${jobId}_${suffix}`, { sttSource: sttSrc, timeScale });
      const arr: { path: string; start: number; end: number }[] = [];
      for (let i = 0; i < cues.length; i++) {
        const sp = path.join(tmpDir, `${jobId}_${suffix}_sub${i}.png`);
        await renderSubtitle(cues[i].text, sp); subPaths.push(sp);
        arr.push({ path: sp, start: +cues[i].start.toFixed(2), end: +cues[i].end.toFixed(2) });
      }
      return arr;
    };

    if (allChar) {
      updateJob(jobId, { status: 'generating_audio', progress: 30, steps: { script: 'done', audio: 'running', video: 'pending' } });
      const audioP = await mkAudio(narration, 'a');
      updateJob(jobId, { status: 'generating_video', progress: 45, steps: { script: 'done', audio: 'done', video: 'running' } });
      let charP = await mkChar(audioP, 'char');
      if (Math.abs(speed - 1.0) > 0.01) { const sp = path.join(tmpDir, `${jobId}_sped.mp4`); await applySpeed(charP, speed, sp); subPaths.push(sp); charP = sp; }
      updateJob(jobId, { progress: 88 });
      let D = await probeDuration(charP); if (!(D > 1)) D = await probeDuration(audioP);
      const t1 = +(D * f1).toFixed(2), t2 = +(D * f2).toFixed(2);
      const subs = await mkSubs(charP, narration, D, 'a', audioP, 1 / speed);
      await composePromoCharacter({
        productImagePath: input.productImagePath, characterVideoPath: charP,
        headerPath, ctaPath, pipMaskPath: maskPath, ringPath, durationSec: +D.toFixed(2), t1, t2, outPath, subtitles: subs,
      });
    } else {
      const segDefs = ([
        { kind: 'intro' as const, text: hookT, on: introChar },
        { kind: 'product' as const, text: mainT, on: productChar },
        { kind: 'outro' as const, text: ctaT, on: outroChar },
      ]).filter((s) => s.text && s.text.trim().length);
      const clips: string[] = [];
      let pi = 35;
      for (const seg of segDefs) {
        updateJob(jobId, { status: 'generating_video', progress: pi, steps: { script: 'done', audio: 'running', video: 'running' } });
        pi = Math.min(85, pi + 18);
        const aP = await mkAudio(seg.text, seg.kind);
        const charP = seg.on ? await mkChar(aP, `${seg.kind}_char`) : undefined;
        const D = await probeDuration(seg.on ? (charP as string) : aP);
        const subs = await mkSubs(seg.on ? (charP as string) : aP, seg.text, D, seg.kind, aP);
        const clipP = path.join(tmpDir, `${jobId}_clip_${seg.kind}.mp4`); subPaths.push(clipP);
        await buildSegmentClip({
          kind: seg.kind, charVideoPath: charP, audioPath: aP,
          productImagePath: input.productImagePath, headerPath,
          ctaPath: seg.kind === 'outro' ? ctaPath : undefined,
          pipMaskPath: maskPath, ringPath, durationSec: +D.toFixed(2), subtitles: subs, outPath: clipP,
        });
        clips.push(clipP);
      }
      updateJob(jobId, { progress: 90 });
      if (clips.length === 1) fs.copyFileSync(clips[0], outPath);
      else await concatSegments(clips, outPath);
    }

    // 정액 크레딧 차감(성공 시). 실소비(vsCreditsUsed)와 무관. 제품1=5 / 제품2=15.
    const charge = input.credits ?? AI_ACTOR_CREDITS;
    try { await chargeCredits(input.userId, charge); } catch (e) { console.error(`[PromoCharAiJob ${jobId}] 크레딧 차감 실패(소비 참고 ${vsCreditsUsed}):`, e); }
    // VisionStory 계정 실소비 원장 기록 (관리자 잔여 추정용, 유저 정액 과금과 별개)
    recordVsUsage(vsCreditsUsed, jobId);
    cleanup();
    updateJob(jobId, { status: 'done', progress: 100, steps: { script: 'done', audio: 'done', video: 'done' }, videoUrl: `/api/video/${jobId}` });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[PromoCharAiJob ${jobId}] Failed:`, msg);
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
  const emotion = ((fd.get('emotion') as string | null) ?? 'cheerful').trim();
  const duration = parseInt((fd.get('duration') as string | null) ?? '20', 10);
  const speed = Math.min(2.0, Math.max(0.5, parseFloat((fd.get('speed') as string | null) ?? '1.0') || 1.0));
  const tone = (fd.get('tone') as string | null) ?? '친근한';
  const productFile = fd.get('product') as File | null;
  const productPath = ((fd.get('productPath') as string | null) ?? '').trim();
  const buyLink = ((fd.get('buyLink') as string | null) ?? '').trim();
  const introChar = ((fd.get('introChar') as string | null) ?? '1') !== '0';
  const productChar = ((fd.get('productChar') as string | null) ?? '1') !== '0';
  const outroChar = ((fd.get('outroChar') as string | null) ?? '1') !== '0';
  const tier = ((fd.get('tier') as string | null) ?? 'premium').trim();
  const budget = tier === 'budget'; // 제품1(저가): vs_talk_v1·5크레딧 / 제품2(프리미엄): vs_character_v4·15크레딧
  const vsModel = budget ? 'vs_talk_v1' : 'vs_character_v4';
  const jobCredits = budget ? 5 : AI_ACTOR_CREDITS;
  const estCredits = jobCredits;

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

  // 크레딧 사전 확인
  if (!(await hasCredits(userId, estCredits))) {
    return NextResponse.json({ error: `크레딧이 부족해요 (약 ${estCredits}크레딧 필요). 충전 후 이용해주세요.`, needCredits: estCredits }, { status: 402 });
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
    id: jobId, sessionId: userId, topic: `제품홍보AI:${businessName}`, duration, tone,
    businessName, script: { buyLink, catchphrase },
  });
  updateJob(jobId, { status: 'queued', progress: 5, steps: { script: 'pending', audio: 'pending', video: 'pending' } });

  // 목소리 자동: 제품에 맞춰 배우 성별 추론 → 그 성별 목소리로 매칭 (프론트 voice 값 무시)
  const actorGender = inferActorGender(businessName, businessType, sellingPoints);
  const autoVoice = actorGender === 'male' ? 'charon' : 'aoede';

  processPromoCharacterAiJob(jobId, {
    businessName, businessType, sellingPoints, cta, duration, tone,
    voiceId: autoVoice, emotion, presenter: actorGender, productImagePath,
    overlayTitle: '', overlayCta: cta, // AI배우: 헤더 복잡도↓ — 제품명 빼고 홍보문구만
    catchphrase, headerTheme, speed, sections, buyLink,
    introChar, productChar, outroChar, userId, vsModel, credits: jobCredits,
  }).catch(console.error);

  return NextResponse.json({ jobId });
}
