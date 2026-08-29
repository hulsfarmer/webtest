// app/api/affiliate-shorts/route.ts
// 관리자 전용 — 후킹형 제휴 쇼츠 생성 잡.
// hook-script → seedance(2클립, 제품 reference, 얼굴 업로드 X) → musicgen → 글로우 자막 → assembleShort.

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { isAdminEmail } from '@/lib/admin';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import { createJob, updateJob, getJob } from '@/lib/jobStore';
import { generateHookScript, HookAngle, HookScript } from '@/lib/hook-script';
import {
  generateSeedanceClip,
  downloadToBuffer,
  estimateSeedanceCost,
  SeedanceSensitiveError,
  SeedanceResolution,
} from '@/lib/replicate-seedance';
import { generateMusicByTone } from '@/lib/musicgen';
import {
  renderGlowCaption,
  renderCtaCaption,
  assembleShort,
  TimedCaption,
} from '@/lib/shorts-assembly';

export const maxDuration = 800; // Lightsail 장시간 잡 (Vercel 아님)

interface AffiliateJobInput {
  productName: string;
  sellingPoints: string[];
  target?: string;
  tone?: string;
  angle: HookAngle;
  brand?: string;
  affiliateUrl?: string;
  resolution: SeedanceResolution;
  musicTone: string;
  productImagePath: string;
}

function buildClipPrompts(input: AffiliateJobInput): [string, string] {
  const p = input.productName;
  const sp = input.sellingPoints.join(', ');
  const a =
    `Energetic vertical commercial b-roll of ${p} (${sp}), matching the product in the reference image. ` +
    `Dynamic appealing lifestyle shots and product-in-use motion, kinetic camera with speed-ramp, ` +
    `bright premium commercial look. Framing on the product, no human face. No text, no reflections. ` +
    `Total: 8s / 3 shots / 9:16`;
  const b =
    `Clean product hero shots of ${p} matching the reference image, slow orbit and close-ups revealing ` +
    `detail and texture, bright premium background. Kinetic to smooth. No human face, no text, no reflections. ` +
    `Total: 8s / 3 shots / 9:16`;
  return [a, b];
}

async function processAffiliateJob(jobId: string, input: AffiliateJobInput): Promise<void> {
  const tmpDir = path.join(process.cwd(), 'data', 'tmp');
  const videoDir = path.join(process.cwd(), 'public', 'videos');
  [tmpDir, videoDir].forEach((d) => {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  });
  const tmpPrefix = path.join(tmpDir, jobId);
  const outPath = path.join(videoDir, `${jobId}.mp4`);
  const clipA = `${tmpPrefix}_a.mp4`;
  const clipB = `${tmpPrefix}_b.mp4`;
  const musicPath = `${tmpPrefix}_music.mp3`;

  try {
    // 1. 훅 스크립트
    updateJob(jobId, {
      status: 'generating_script',
      progress: 10,
      steps: { script: 'running', audio: 'pending', video: 'pending' },
    });
    const script: HookScript = await generateHookScript({
      productName: input.productName,
      sellingPoints: input.sellingPoints,
      target: input.target,
      tone: input.tone,
      angle: input.angle,
      brand: input.brand,
      affiliateUrl: input.affiliateUrl,
    });
    updateJob(jobId, {
      script: JSON.stringify(script),
      steps: { script: 'done', audio: 'pending', video: 'running' },
      status: 'generating_video',
      progress: 30,
    });

    // 2. 영상 2클립 (제품 이미지 reference, 얼굴 업로드 안 함)
    const productBuf = fs.readFileSync(input.productImagePath);
    const productDataUri = `data:image/png;base64,${productBuf.toString('base64')}`;
    const [promptA, promptB] = buildClipPrompts(input);
    const urlA = await generateSeedanceClip({
      prompt: promptA,
      referenceImages: [productDataUri],
      resolution: input.resolution,
      aspectRatio: '9:16',
      duration: 8,
    });
    fs.writeFileSync(clipA, await downloadToBuffer(urlA));
    updateJob(jobId, { progress: 45 });
    const urlB = await generateSeedanceClip({
      prompt: promptB,
      referenceImages: [productDataUri],
      resolution: input.resolution,
      aspectRatio: '9:16',
      duration: 8,
    });
    fs.writeFileSync(clipB, await downloadToBuffer(urlB));

    // 3. 음악
    updateJob(jobId, {
      status: 'generating_audio',
      progress: 60,
      steps: { script: 'done', audio: 'running', video: 'done' },
    });
    const musicUrl = await generateMusicByTone(input.musicTone, 17);
    fs.writeFileSync(musicPath, await downloadToBuffer(musicUrl));

    // 4. 자막 렌더
    updateJob(jobId, { progress: 78, steps: { script: 'done', audio: 'done', video: 'running' } });
    const capHook = `${tmpPrefix}_c0.png`;
    const capProblem = `${tmpPrefix}_c1.png`;
    const capAnswer = `${tmpPrefix}_c2.png`;
    const capProof = `${tmpPrefix}_c3.png`;
    const capCta = `${tmpPrefix}_cta.png`;
    await renderGlowCaption(script.captions[0], capHook, { cy: 1360, maxSize: 104 });
    await renderGlowCaption(script.captions[1], capProblem, { cy: 1480 });
    await renderGlowCaption(script.captions[2], capAnswer, { cy: 1480 });
    await renderGlowCaption(script.captions[3], capProof, { cy: 1480 });
    await renderCtaCaption(script.cta.brand, script.cta.action, capCta);
    const captions: TimedCaption[] = [
      { pngPath: capHook, start: 0.4, end: 3.5 },
      { pngPath: capProblem, start: 4.0, end: 7.0 },
      { pngPath: capAnswer, start: 8.2, end: 11.2 },
      { pngPath: capProof, start: 11.4, end: 13.0 },
      { pngPath: capCta, start: 13.2, end: 15.5 },
    ];

    // 5. 조립
    updateJob(jobId, { progress: 90 });
    await assembleShort({
      clipPaths: [clipA, clipB],
      captions,
      musicPath,
      outPath,
      tmpPrefix,
    });

    updateJob(jobId, {
      status: 'done',
      progress: 100,
      videoUrl: `/videos/${jobId}.mp4`,
      steps: { script: 'done', audio: 'done', video: 'done' },
    });

    // 임시파일 정리
    [clipA, clipB, musicPath, capHook, capProblem, capAnswer, capProof, capCta, input.productImagePath].forEach(
      (f) => {
        try {
          fs.unlinkSync(f);
        } catch {
          /* noop */
        }
      }
    );
  } catch (e) {
    const msg =
      e instanceof SeedanceSensitiveError
        ? '콘텐츠 필터 차단 — 제품 사진에 사람 얼굴이 없는지 확인하세요.'
        : e instanceof Error
          ? e.message
          : '알 수 없는 오류';
    console.error(`[AffiliateJob ${jobId}]`, msg);
    updateJob(jobId, { status: 'failed', error: msg });
  }
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!isAdminEmail(email) && process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: '관리자 전용 기능입니다.' }, { status: 403 });
  }

  const fd = await req.formData();
  const productName = ((fd.get('productName') as string | null) ?? '').trim();
  const sellingPoints = ((fd.get('sellingPoints') as string | null) ?? '')
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);
  const target = ((fd.get('target') as string | null) ?? '').trim();
  const tone = ((fd.get('tone') as string | null) ?? '').trim();
  const angle = ((fd.get('angle') as string | null) ?? '트렌드').trim() as HookAngle;
  const brand = ((fd.get('brand') as string | null) ?? '').trim();
  const affiliateUrl = ((fd.get('affiliateUrl') as string | null) ?? '').trim();
  const resolution = (((fd.get('resolution') as string | null) ?? '480p').trim() as SeedanceResolution);
  const musicTone = ((fd.get('musicTone') as string | null) ?? 'energetic').trim();
  const productFile = fd.get('product') as File | null;

  if (!productName) return NextResponse.json({ error: '제품명을 입력해주세요.' }, { status: 400 });
  if (!sellingPoints.length)
    return NextResponse.json({ error: '셀링포인트를 입력해주세요.' }, { status: 400 });
  if (!productFile || typeof productFile.arrayBuffer !== 'function')
    return NextResponse.json({ error: '제품 사진을 업로드해주세요.' }, { status: 400 });

  const tmpDir = path.join(process.cwd(), 'data', 'tmp');
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
  const jobId = uuidv4();
  const productImagePath = path.join(tmpDir, `${jobId}_product.png`);
  fs.writeFileSync(productImagePath, Buffer.from(await productFile.arrayBuffer()));

  await createJob({
    id: jobId,
    sessionId: session?.user?.id ?? 'admin',
    topic: productName,
    duration: 15,
    tone: tone || '후킹형',
  });

  const estCost = estimateSeedanceCost([
    { duration: 8, resolution },
    { duration: 8, resolution },
  ]);

  processAffiliateJob(jobId, {
    productName,
    sellingPoints,
    target,
    tone,
    angle,
    brand,
    affiliateUrl,
    resolution,
    musicTone,
    productImagePath,
  }).catch(console.error);

  return NextResponse.json({ jobId, estimatedCostUsd: +estCost.toFixed(2) });
}

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('jobId');
  if (!id) return NextResponse.json({ error: 'jobId 필요' }, { status: 400 });
  const job = await getJob(id);
  if (!job) return NextResponse.json({ error: '잡을 찾을 수 없습니다.' }, { status: 404 });
  return NextResponse.json(job);
}
