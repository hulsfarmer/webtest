import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import { createJob, updateJob } from '@/lib/jobStore';
import { generatePromoScript, PromoInput } from '@/lib/anthropic';
import { generateAudio } from '@/lib/tts';
import { uploadToHedra, submitKlingAvatar, pollHedraVideo } from '@/lib/hedra';
import { renderPromoOverlay, renderPipAssets, composePromoCharacter, probeDuration } from '@/lib/promo-compose';
// import { canGenerate, incrementUsage } from '@/lib/usageStore'; // TODO(credits)

interface CharJobInput extends PromoInput {
  voice: string;
  characterBuf: Buffer;
  characterType: string;
  productImagePath: string;
  overlayTitle: string;
  overlayCta: string;
}

async function processPromoCharacterJob(jobId: string, input: CharJobInput) {
  const tmpDir = path.join(process.cwd(), 'data', 'tmp');
  const videoDir = path.join(process.cwd(), 'public', 'videos');
  [tmpDir, videoDir].forEach((d) => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });
  const audioPath = path.join(tmpDir, `${jobId}.mp3`);
  const charVideoPath = path.join(tmpDir, `${jobId}_char.mp4`);
  const overlayPath = path.join(tmpDir, `${jobId}_overlay.png`);
  const maskPath = path.join(tmpDir, `${jobId}_mask.png`);
  const ringPath = path.join(tmpDir, `${jobId}_ring.png`);
  const outPath = path.join(videoDir, `${jobId}.mp4`);

  const cleanup = () => [audioPath, charVideoPath, overlayPath, maskPath, ringPath, input.productImagePath]
    .forEach((f) => { try { fs.unlinkSync(f); } catch { /* noop */ } });

  try {
    // 1) AI 홍보 대본
    updateJob(jobId, { status: 'generating_script', progress: 10, steps: { script: 'running', audio: 'pending', video: 'pending' } });
    const script = await generatePromoScript(input);
    const narration = script.sections.map((s) => s.text).join(' ').trim();

    // 구간 비율: hook/main/cta 지속시간 기반 (없으면 0.28/0.72 폴백)
    const dur = (t: string) => script.sections.filter((s) => s.type === t).reduce((a, s) => a + (s.duration || 0), 0);
    const hookD = dur('hook'), mainD = dur('main'), ctaD = dur('cta'), tot = hookD + mainD + ctaD;
    let f1 = tot > 0 ? hookD / tot : 0.28;
    let f2 = tot > 0 ? (hookD + mainD) / tot : 0.72;
    if (!(f1 > 0.05 && f2 > f1 && f2 < 0.95)) { f1 = 0.28; f2 = 0.72; }

    // 2) 나레이션 음성 (Chirp3-HD)
    updateJob(jobId, { status: 'generating_audio', progress: 30, steps: { script: 'done', audio: 'running', video: 'pending' } });
    await generateAudio(narration, audioPath, input.duration || 20, input.voice, 1.0);

    // 3) Hedra 업로드 + Kling 캐릭터 영상
    updateJob(jobId, { status: 'generating_video', progress: 45, steps: { script: 'done', audio: 'done', video: 'running' } });
    const audioBuf = fs.readFileSync(audioPath);
    const [imageUrl, audioUrl] = await Promise.all([
      uploadToHedra(input.characterBuf, 'character.png', input.characterType),
      uploadToHedra(audioBuf, 'narration.mp3', 'audio/mpeg'),
    ]);
    const hedraJob = await submitKlingAvatar({ imageUrl, audioUrl, aspectRatio: '9:16' });
    const charBuf = await pollHedraVideo(hedraJob, () => updateJob(jobId, { progress: 70, status: 'generating_video' }));
    fs.writeFileSync(charVideoPath, charBuf);

    // 4) 인터컷 + PiP 합성
    updateJob(jobId, { progress: 88 });
    let D = await probeDuration(charVideoPath);
    if (!(D > 1)) D = await probeDuration(audioPath); // 폴백
    const t1 = +(D * f1).toFixed(2);
    const t2 = +(D * f2).toFixed(2);
    await Promise.all([
      renderPromoOverlay(input.overlayTitle, input.overlayCta, overlayPath),
      renderPipAssets(maskPath, ringPath),
    ]);
    await composePromoCharacter({
      productImagePath: input.productImagePath, characterVideoPath: charVideoPath,
      overlayPath, pipMaskPath: maskPath, ringPath, durationSec: +D.toFixed(2), t1, t2, outPath,
    });

    cleanup();
    updateJob(jobId, { status: 'done', progress: 100, steps: { script: 'done', audio: 'done', video: 'done' }, videoUrl: `/api/video/${jobId}` });
    // TODO(credits): await incrementUsage(userId)
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
  const voice = (fd.get('voice') as string | null) ?? 'ko-KR-Chirp3-HD-Aoede';
  const duration = parseInt((fd.get('duration') as string | null) ?? '20', 10);
  const tone = (fd.get('tone') as string | null) ?? '친근한';
  const preset = (fd.get('preset') as string | null) ?? '';
  const characterFile = fd.get('character') as File | null;
  const productFile = fd.get('product') as File | null;

  if (!businessName) return NextResponse.json({ error: '제품명을 입력해주세요.' }, { status: 400 });
  if (!sellingPoints) return NextResponse.json({ error: '홍보 포인트를 입력해주세요.' }, { status: 400 });
  if (!productFile) return NextResponse.json({ error: '제품 이미지를 업로드해주세요.' }, { status: 400 });

  // 캐릭터 이미지 (업로드 우선, 없으면 프리셋)
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

  // 제품 이미지 저장
  const tmpDir = path.join(process.cwd(), 'data', 'tmp');
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
  const jobId = uuidv4();
  const productImagePath = path.join(tmpDir, `${jobId}_product.png`);
  fs.writeFileSync(productImagePath, Buffer.from(await productFile.arrayBuffer()));

  // TODO(credits): canGenerate 게이트

  await createJob({ id: jobId, sessionId: userId, topic: `제품홍보:${businessName}`, duration, tone });
  updateJob(jobId, { status: 'queued', progress: 5, steps: { script: 'pending', audio: 'pending', video: 'pending' } });

  processPromoCharacterJob(jobId, {
    businessName, businessType, sellingPoints, cta, duration, tone,
    voice, characterBuf, characterType, productImagePath,
    overlayTitle: businessName,
    overlayCta: cta || '지금 구매하기',
  }).catch(console.error);

  return NextResponse.json({ jobId });
}
