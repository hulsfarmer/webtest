import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import { createJob, updateJob } from '@/lib/jobStore';
import { generatePromoScript, PromoInput, ScriptSection } from '@/lib/anthropic';
import { generateAudioWithTimepoints } from '@/lib/tts';
import { uploadToHedra, submitKlingAvatar, pollHedraVideo } from '@/lib/hedra';
import { renderHeaderOverlay, renderCtaOverlay, renderPipAssets, renderSubtitle, composePromoCharacter, probeDuration, sanitizeScript } from '@/lib/promo-compose';

/** 자막용 청크: 문장 → ≤32자 단위 (긴 문장은 어절 단위로 분할) */
function chunkForSubtitles(text: string, maxChars = 32): string[] {
  const clean = text.replace(/\s+/g, ' ').trim();
  const sents = clean.split(/(?<=[.!?。…])\s+/).filter(Boolean);
  const chunks: string[] = [];
  for (const s of sents) {
    if (s.length <= maxChars) { chunks.push(s); continue; }
    let cur = '';
    for (const w of s.split(' ')) {
      const t = cur ? `${cur} ${w}` : w;
      if (t.length <= maxChars || !cur) cur = t;
      else { chunks.push(cur); cur = w; }
    }
    if (cur) chunks.push(cur);
  }
  return chunks.filter(Boolean);
}
// import { canGenerate, incrementUsage } from '@/lib/usageStore'; // TODO(credits)

interface CharJobInput extends PromoInput {
  voice: string;
  characterBuf: Buffer;
  characterType: string;
  productImagePath: string;
  overlayTitle: string;
  overlayCta: string;
  catchphrase: string;
  headerTheme: string;
  sections?: ScriptSection[]; // 사용자가 편집한 대본(있으면 AI 생성 생략)
}

async function processPromoCharacterJob(jobId: string, input: CharJobInput) {
  const tmpDir = path.join(process.cwd(), 'data', 'tmp');
  const videoDir = path.join(process.cwd(), 'public', 'videos');
  [tmpDir, videoDir].forEach((d) => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });
  const audioPath = path.join(tmpDir, `${jobId}.mp3`);
  const charVideoPath = path.join(tmpDir, `${jobId}_char.mp4`);
  const headerPath = path.join(tmpDir, `${jobId}_header.png`);
  const ctaPath = path.join(tmpDir, `${jobId}_cta.png`);
  const maskPath = path.join(tmpDir, `${jobId}_mask.png`);
  const ringPath = path.join(tmpDir, `${jobId}_ring.png`);
  const outPath = path.join(videoDir, `${jobId}.mp4`);
  const subPaths: string[] = [];
  const cleanup = () => [audioPath, charVideoPath, headerPath, ctaPath, maskPath, ringPath, input.productImagePath, ...subPaths]
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

    // 구간별 텍스트(정제) + 나레이션
    const byType = (t: ScriptSection['type']) => sanitizeScript(sections.filter((s) => s.type === t).map((s) => s.text).join(' '));
    const hookT = byType('hook'), mainT = byType('main'), ctaT = byType('cta');
    let narration = [hookT, mainT, ctaT].filter(Boolean).join('  ').trim()
      || sanitizeScript(sections.map((s) => s.text).join(' '));
    // 길이 상한(한국어 ~5.5자/초): 너무 길면 문장 경계에서 컷 (OOM·과대기 방지)
    const maxChars = Math.max(90, (input.duration || 20) * 7);
    if (narration.length > maxChars) {
      const cut = narration.slice(0, maxChars);
      const lastEnd = Math.max(cut.lastIndexOf('.'), cut.lastIndexOf('!'), cut.lastIndexOf('?'), cut.lastIndexOf('。'), cut.lastIndexOf('요 '), cut.lastIndexOf('다 '));
      narration = (lastEnd > maxChars * 0.5 ? cut.slice(0, lastEnd + 1) : cut).trim();
    }
    // 구간 비율(텍스트 길이 기반)
    const L = hookT.length + mainT.length + ctaT.length;
    let f1 = L > 0 ? hookT.length / L : 0.28;
    let f2 = L > 0 ? (hookT.length + mainT.length) / L : 0.72;
    if (!(f1 > 0.08 && f2 > f1 + 0.1 && f2 < 0.92)) { f1 = 0.28; f2 = 0.72; }

    // 2) 나레이션 음성 (자막용 문장 청크별 타이밍)
    updateJob(jobId, { status: 'generating_audio', progress: 30, steps: { script: 'done', audio: 'running', video: 'pending' } });
    const subChunks = chunkForSubtitles(narration);
    const chunkDurs = await generateAudioWithTimepoints(subChunks.length ? subChunks : [narration], audioPath, input.voice, 1.0);

    // 3) Kling 캐릭터 영상
    updateJob(jobId, { status: 'generating_video', progress: 45, steps: { script: 'done', audio: 'done', video: 'running' } });
    const audioBuf = fs.readFileSync(audioPath);
    const [imageUrl, audioUrl] = await Promise.all([
      uploadToHedra(input.characterBuf, 'character.png', input.characterType),
      uploadToHedra(audioBuf, 'narration.mp3', 'audio/mpeg'),
    ]);
    const hedraJob = await submitKlingAvatar({ imageUrl, audioUrl, aspectRatio: '9:16' });
    const charBuf = await pollHedraVideo(hedraJob, () => updateJob(jobId, { progress: 70, status: 'generating_video' }));
    fs.writeFileSync(charVideoPath, charBuf);

    // 4) 인터컷 + PiP 합성 (헤더 전 구간 + 나레이션 자막)
    updateJob(jobId, { progress: 88 });
    let D = await probeDuration(charVideoPath);
    if (!(D > 1)) D = await probeDuration(audioPath);
    const t1 = +(D * f1).toFixed(2), t2 = +(D * f2).toFixed(2);

    // 자막 큐: 청크 duration → 영상 길이에 맞춰 스케일
    const chunks = subChunks.length ? subChunks : [narration];
    const totalDur = chunkDurs.reduce((a, b) => a + b, 0) || D;
    const scale = D / totalDur;
    const subtitles: { path: string; start: number; end: number }[] = [];
    let acc = 0;
    for (let i = 0; i < chunks.length; i++) {
      const start = acc * scale, end = (acc + (chunkDurs[i] || 0)) * scale;
      acc += chunkDurs[i] || 0;
      const sp = path.join(tmpDir, `${jobId}_sub${i}.png`);
      await renderSubtitle(chunks[i], sp);
      subtitles.push({ path: sp, start: +start.toFixed(2), end: +end.toFixed(2) });
    }
    subPaths.push(...subtitles.map((s) => s.path));

    await Promise.all([
      renderHeaderOverlay(input.overlayTitle, input.catchphrase, input.headerTheme, headerPath),
      renderCtaOverlay(input.overlayCta, ctaPath),
      renderPipAssets(maskPath, ringPath),
    ]);
    await composePromoCharacter({
      productImagePath: input.productImagePath, characterVideoPath: charVideoPath,
      headerPath, ctaPath, pipMaskPath: maskPath, ringPath, durationSec: +D.toFixed(2), t1, t2, outPath, subtitles,
    });

    cleanup();
    updateJob(jobId, { status: 'done', progress: 100, steps: { script: 'done', audio: 'done', video: 'done' }, videoUrl: `/api/video/${jobId}` });
  } catch (err) {
    cleanup();
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[PromoCharacterJob ${jobId}] Failed:`, msg);
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
  const headerTheme = (fd.get('headerTheme') as string | null) ?? 'blur';
  const voice = (fd.get('voice') as string | null) ?? 'ko-KR-Chirp3-HD-Aoede';
  const duration = parseInt((fd.get('duration') as string | null) ?? '20', 10);
  const tone = (fd.get('tone') as string | null) ?? '친근한';
  const preset = (fd.get('preset') as string | null) ?? '';
  const characterFile = fd.get('character') as File | null;
  const productFile = fd.get('product') as File | null;
  const productPath = ((fd.get('productPath') as string | null) ?? '').trim(); // 링크 불러오기 이미지 (/imports/xxx)

  // 편집된 대본(선택)
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

  let characterBuf: Buffer, characterType = 'image/png';
  if (characterFile && typeof characterFile.arrayBuffer === 'function') {
    characterBuf = Buffer.from(await characterFile.arrayBuffer());
    characterType = characterFile.type || 'image/png';
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
    // 링크에서 불러온 이미지: public/imports/<basename> 만 허용 (경로 조작 방지)
    const base = path.basename(productPath);
    const src = path.join(process.cwd(), 'public', 'imports', base);
    if (!fs.existsSync(src)) return NextResponse.json({ error: '불러온 제품 이미지를 찾을 수 없습니다. 다시 시도해주세요.' }, { status: 400 });
    fs.copyFileSync(src, productImagePath);
  }

  await createJob({ id: jobId, sessionId: userId, topic: `제품홍보:${businessName}`, duration, tone });
  updateJob(jobId, { status: 'queued', progress: 5, steps: { script: 'pending', audio: 'pending', video: 'pending' } });

  processPromoCharacterJob(jobId, {
    businessName, businessType, sellingPoints, cta, duration, tone,
    voice, characterBuf, characterType, productImagePath,
    overlayTitle: businessName, overlayCta: cta || '지금 구매하기',
    catchphrase, headerTheme, sections,
  }).catch(console.error);

  return NextResponse.json({ jobId });
}
