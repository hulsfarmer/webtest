import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import { createJob, updateJob } from '@/lib/jobStore';
import { generatePromoScript, generateYouTubeTags, PromoInput, ScriptSection } from '@/lib/anthropic';
import { buildYouTubeTags } from '@/lib/promo-description';
import { generateAudio } from '@/lib/tts';
import { generateAzureTTS } from '@/lib/azure-tts';
import { applyChildLisp } from '@/lib/child-voice';
import { uploadToHedra, submitKlingAvatar, pollHedraVideo } from '@/lib/hedra';
import { renderHeaderOverlay, renderCtaOverlay, renderPipAssets, renderSubtitle, composePromoCharacter, probeDuration, sanitizeScript, fitCharTo916 } from '@/lib/promo-compose';
import { buildAlignedSubtitles, applySpeed, applyPitch } from '@/lib/promo-subtitles';
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
  speed?: number; // 영상 배속 (기본 1.1)
  pitch?: number; // 목소리 피치 반음 (rubberband, Google 폴백용)
  ttsEngine?: string; // 'azure' | 'google'(기본)
  azureVoice?: string; // Azure 음성 (예 ko-KR-YuJinNeural)
  azurePitch?: string; // Azure 네이티브 피치 (예 '+45%')
  azureRate?: string; // Azure 속도 (예 '+8%')
  childLisp?: boolean; // 하늘(아이) 음성: 혀짧은소리 변환을 TTS에만 적용
  sections?: ScriptSection[]; // 사용자가 편집한 대본(있으면 AI 생성 생략)
  buyLink?: string; // 쿠팡 구매 링크 (라이브러리 유튜브 설명)
  quality?: 'standard' | 'pro'; // 말하는 영상 화질: standard=720p(기본), pro=1080p
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
    const narration = [hookT, mainT, ctaT].filter(Boolean).join('  ').trim()
      || sanitizeScript(sections.map((s) => s.text).join(' '));
    // 유튜브 태그 (AI 명사 키워드, 실패 시 휴리스틱 폴백)
    let ytTags: string[] = [];
    try {
      ytTags = await generateYouTubeTags(input.businessName || '', input.catchphrase || '', narration);
    } catch (e) {
      console.error(`[PromoCharacterJob ${jobId}] AI 태그 실패 → 휴리스틱:`, e instanceof Error ? e.message : e);
      ytTags = buildYouTubeTags(input.businessName || '', input.catchphrase || '', narration);
    }
    // 라이브러리·유튜브 설명용 메타 저장 (나레이션 + 구매 링크 + 태그)
    updateJob(jobId, { script: JSON.stringify({
      narration, buyLink: input.buyLink || '', businessName: input.businessName, catchphrase: input.catchphrase, tags: ytTags,
      businessType: input.businessType || '', sellingPoints: input.sellingPoints || '', cta: input.cta || '', headerTheme: input.headerTheme || 'navy',
    }) });
    // 구간 비율(텍스트 길이 기반)
    const L = hookT.length + mainT.length + ctaT.length;
    let f1 = L > 0 ? hookT.length / L : 0.28;
    let f2 = L > 0 ? (hookT.length + mainT.length) / L : 0.72;
    if (!(f1 > 0.08 && f2 > f1 + 0.1 && f2 < 0.92)) { f1 = 0.28; f2 = 0.72; }

    // 2) 나레이션 음성 (연속 통 오디오 — 청크별 생성은 문장 사이 멈춤 유발)
    updateJob(jobId, { status: 'generating_audio', progress: 30, steps: { script: 'done', audio: 'running', video: 'pending' } });
    // 영어 전대문자(브랜드명 등)는 소문자로 — Chirp3-HD가 철자로 읽는 것 방지
    let ttsText = narration.replace(/[A-Z]{2,}/g, (m) => m.toLowerCase());
    // 하늘(아이) 음성이면 혀짧은소리로 읽기 — 자막/설명은 원문 narration 유지
    if (input.childLisp) ttsText = applyChildLisp(ttsText);
    // TTS 엔진: Azure(네이티브 캐릭터 톤) 우선, 실패/미지정 시 Google
    let azureDone = false;
    if (input.ttsEngine === 'azure' && input.azureVoice) {
      try {
        await generateAzureTTS(ttsText, audioPath, input.azureVoice, input.azurePitch || '0%', input.azureRate || '0%');
        azureDone = true;
        console.log(`[PromoCharacterJob ${jobId}] Azure TTS (${input.azureVoice} ${input.azurePitch}/${input.azureRate})`);
      } catch (e) { console.error(`[PromoCharacterJob ${jobId}] Azure TTS 실패 → Google 폴백:`, e instanceof Error ? e.message : e); }
    }
    if (!azureDone) await generateAudio(ttsText, audioPath, input.duration || 30, input.voice, 1.0);
    // STT용 깨끗한 원본 오디오(피치·배속 전) 보관 — 피치 오디오는 STT 인식률이 급락
    const cleanAudioPath = path.join(tmpDir, `${jobId}_clean.mp3`);
    fs.copyFileSync(audioPath, cleanAudioPath);
    subPaths.push(cleanAudioPath);
    // 목소리 피치(rubberband): Azure는 네이티브 피치라 스킵. Google 경로만 적용.
    const pitch = azureDone ? 0 : Math.max(-6, Math.min(6, input.pitch || 0));
    if (Math.abs(pitch) > 0.01) {
      const pitchedPath = path.join(tmpDir, `${jobId}_pitched.mp3`);
      await applyPitch(audioPath, pitch, pitchedPath);
      fs.copyFileSync(pitchedPath, audioPath);
      try { fs.unlinkSync(pitchedPath); } catch { /* noop */ }
    }

    // 3) Kling 캐릭터 영상
    updateJob(jobId, { status: 'generating_video', progress: 45, steps: { script: 'done', audio: 'done', video: 'running' } });
    // 캐릭터 이미지를 9:16(720x1280)로 정규화 — 머리(위) 고정, 넘치면 아래만 크롭.
    // Kling이 입력 비율을 따라가므로 9:16로 보내면 출력도 9:16 → 합성 잘림/크래시 방지.
    const charInPath = path.join(tmpDir, `${jobId}_charin.png`);
    const char916Path = path.join(tmpDir, `${jobId}_char916.png`);
    fs.writeFileSync(charInPath, input.characterBuf);
    await fitCharTo916(charInPath, char916Path);
    const charUploadBuf = fs.readFileSync(char916Path);
    subPaths.push(charInPath, char916Path);

    const audioBuf = fs.readFileSync(audioPath);
    const [imageUrl, audioUrl] = await Promise.all([
      uploadToHedra(charUploadBuf, 'character.png', 'image/png'),
      uploadToHedra(audioBuf, 'narration.mp3', 'audio/mpeg'),
    ]);
    const hedraJob = await submitKlingAvatar({ imageUrl, audioUrl, aspectRatio: '9:16', quality: input.quality });
    const charBuf = await pollHedraVideo(hedraJob, () => updateJob(jobId, { progress: 70, status: 'generating_video' }));
    fs.writeFileSync(charVideoPath, charBuf);

    // 3.5) 배속 (기본 1.1): 캐릭터 영상+음성을 speed 배로. 이후 계산은 배속본 기준.
    updateJob(jobId, { progress: 82 });
    const speed = Math.min(2.0, Math.max(0.5, input.speed || 1.1));
    let effCharPath = charVideoPath;
    if (Math.abs(speed - 1.0) > 0.01) {
      const spedPath = path.join(tmpDir, `${jobId}_char_sped.mp4`);
      await applySpeed(charVideoPath, speed, spedPath);
      effCharPath = spedPath;
      subPaths.push(spedPath);
    }

    // 4) 인터컷 + PiP 합성 (헤더 전 구간 + 나레이션 자막)
    updateJob(jobId, { progress: 88 });
    let D = await probeDuration(effCharPath);
    if (!(D > 1)) D = await probeDuration(audioPath);
    const t1 = +(D * f1).toFixed(2), t2 = +(D * f2).toFixed(2);

    // 자막: 실제 음성 STT 단어 타임스탬프에 원고를 정밀 정렬 (실패 시 쉼정렬→비례 폴백)
    // STT는 깨끗한 원본 오디오로(정확), 결과 시각은 배속에 맞춰 스케일(1/speed)
    const { cues, mode } = await buildAlignedSubtitles(effCharPath, narration, D, tmpDir, jobId, { sttSource: cleanAudioPath, timeScale: 1 / speed });
    const subtitles: { path: string; start: number; end: number }[] = [];
    for (let i = 0; i < cues.length; i++) {
      const sp = path.join(tmpDir, `${jobId}_sub${i}.png`);
      await renderSubtitle(cues[i].text, sp);
      subtitles.push({ path: sp, start: +cues[i].start.toFixed(2), end: +cues[i].end.toFixed(2) });
    }
    subPaths.push(...subtitles.map((s) => s.path));
    console.log(`[PromoCharacterJob ${jobId}] 자막 ${subtitles.length}개 (${mode}), speed ${speed}`);

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
    // 실패 시엔 임시파일을 지우지 않는다: 캐릭터 영상(Kling=유료)과 합성 입력이
    // 남아있어야 Kling 재과금 없이 합성만 다시 돌릴 수 있다.
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[PromoCharacterJob ${jobId}] Failed:`, msg);
    console.error(`[PromoCharacterJob ${jobId}] 임시파일 유지(재합성용): ${charVideoPath}`);
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
  const voice = (fd.get('voice') as string | null) ?? 'ko-KR-Chirp3-HD-Aoede';
  const duration = parseInt((fd.get('duration') as string | null) ?? '20', 10);
  const speed = Math.min(2.0, Math.max(0.5, parseFloat((fd.get('speed') as string | null) ?? "1.1") || 1.1));
  const pitch = Math.max(-6, Math.min(6, parseFloat((fd.get('pitch') as string | null) ?? '0') || 0));
  const characterName = ((fd.get('characterName') as string | null) ?? '').trim();
  const ttsEngine = ((fd.get('ttsEngine') as string | null) ?? 'google').trim();
  const azureVoice = ((fd.get('azureVoice') as string | null) ?? '').trim();
  const azurePitch = ((fd.get('azurePitch') as string | null) ?? '0%').trim();
  const azureRate = ((fd.get('azureRate') as string | null) ?? '0%').trim();
  const childLisp = ((fd.get('childLisp') as string | null) ?? '') === '1';
  const tone = (fd.get('tone') as string | null) ?? '친근한';
  const quality = ((fd.get('quality') as string | null) ?? 'standard') === 'pro' ? 'pro' : 'standard';
  const preset = (fd.get('preset') as string | null) ?? '';
  const characterFile = fd.get('character') as File | null;
  const productFile = fd.get('product') as File | null;
  const productPath = ((fd.get('productPath') as string | null) ?? '').trim(); // 링크 불러오기 이미지 (/imports/xxx)
  const buyLink = ((fd.get('buyLink') as string | null) ?? '').trim(); // 쿠팡 구매 링크 (라이브러리·유튜브 설명)

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

  await createJob({
    id: jobId, sessionId: userId, topic: `제품홍보:${businessName}`, duration, tone,
    businessName, script: { buyLink, catchphrase, characterName }, // 나레이션은 생성 후 채움
  });
  updateJob(jobId, { status: 'queued', progress: 5, steps: { script: 'pending', audio: 'pending', video: 'pending' } });

  processPromoCharacterJob(jobId, {
    businessName, businessType, sellingPoints, cta, duration, tone,
    voice, characterBuf, characterType, productImagePath,
    overlayTitle: businessName, overlayCta: cta, // 빈 값이면 CTA 표시 안 함
    catchphrase, headerTheme, speed, pitch, characterName,
    ttsEngine, azureVoice, azurePitch, azureRate, childLisp, sections, buyLink, quality,
  }).catch(console.error);

  return NextResponse.json({ jobId });
}
