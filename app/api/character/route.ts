import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import { createJob, updateJob } from '@/lib/jobStore';
import { generateAudio } from '@/lib/tts';
import { uploadToHedra, submitKlingAvatar, pollHedraVideo } from '@/lib/hedra';
// import { canGenerate, incrementUsage } from '@/lib/usageStore'; // TODO(credits)

/**
 * "말하는 캐릭터" 잡 처리: 캐릭터 이미지 + 스크립트 → Chirp3-HD 음성 → Kling Avatar(Hedra) → 9:16 영상.
 * promo 흐름과 동일하게 fire-and-forget 백그라운드로 실행 (PM2 상주 서버라 유지됨).
 */
async function processCharacterJob(
  jobId: string,
  imageBuf: Buffer,
  contentType: string,
  script: string,
  voice: string,
  speed: number,
) {
  const audioDir = path.join(process.cwd(), 'data', 'audio');
  const videoDir = path.join(process.cwd(), 'public', 'videos');
  [audioDir, videoDir].forEach((d) => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });
  const audioPath = path.join(audioDir, `${jobId}.mp3`);
  const videoPath = path.join(videoDir, `${jobId}.mp4`);

  try {
    // Step 1: Chirp3-HD 음성 생성 (shortsai 기존 TTS 재사용)
    updateJob(jobId, {
      status: 'generating_audio',
      progress: 20,
      steps: { script: 'done', audio: 'running', video: 'pending' },
    });
    await generateAudio(script, audioPath, 60, voice, speed);

    // Step 2: Hedra 업로드 (이미지 + 오디오, 무료)
    updateJob(jobId, {
      status: 'generating_video',
      progress: 45,
      steps: { script: 'done', audio: 'done', video: 'running' },
    });
    const audioBuf = fs.readFileSync(audioPath);
    const [imageUrl, audioUrl] = await Promise.all([
      uploadToHedra(imageBuf, 'character.png', contentType),
      uploadToHedra(audioBuf, 'narration.mp3', 'audio/mpeg'),
    ]);

    // Step 3: Kling Avatar v2 생성 + 폴링
    const hedraJob = await submitKlingAvatar({ imageUrl, audioUrl, aspectRatio: '9:16' });
    const videoBuf = await pollHedraVideo(hedraJob, () => {
      updateJob(jobId, { progress: 70, status: 'generating_video' });
    });
    fs.writeFileSync(videoPath, videoBuf);
    try { fs.unlinkSync(audioPath); } catch { /* ignore */ }

    updateJob(jobId, {
      status: 'done',
      progress: 100,
      steps: { script: 'done', audio: 'done', video: 'done' },
      videoUrl: `/api/video/${jobId}`,
    });

    // TODO(credits): await incrementUsage(userId) — 크레딧 정책 확정 후 활성화
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[CharacterJob ${jobId}] Failed:`, msg);
    updateJob(jobId, { status: 'failed', error: msg });
  }
}

export async function POST(req: NextRequest) {
  // 인증: 프로덕션은 로그인 필수, 개발환경은 로컬 확인 편의를 위해 익명 허용
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id ?? (process.env.NODE_ENV !== 'production' ? 'dev-local' : null);
  if (!userId) {
    return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  }

  const formData = await req.formData();
  const script = ((formData.get('script') as string | null) ?? '').trim();
  const voice = (formData.get('voice') as string | null) ?? 'ko-KR-Chirp3-HD-Aoede';
  const speed = parseFloat((formData.get('speed') as string | null) ?? '1.0');
  const preset = (formData.get('preset') as string | null) ?? '';
  const imageFile = formData.get('image') as File | null;

  if (!script) {
    return NextResponse.json({ error: '스크립트를 입력해주세요.' }, { status: 400 });
  }

  // 캐릭터 이미지: 업로드 우선, 없으면 프리셋
  let imageBuf: Buffer;
  let contentType = 'image/png';
  if (imageFile && typeof imageFile.arrayBuffer === 'function') {
    imageBuf = Buffer.from(await imageFile.arrayBuffer());
    contentType = imageFile.type || 'image/png';
  } else if (preset) {
    const safe = preset.replace(/[^a-zA-Z0-9_-]/g, '');
    const presetPath = path.join(process.cwd(), 'public', 'characters', `${safe}.png`);
    if (!fs.existsSync(presetPath)) {
      return NextResponse.json({ error: '프리셋 캐릭터를 찾을 수 없습니다.' }, { status: 400 });
    }
    imageBuf = fs.readFileSync(presetPath);
  } else {
    return NextResponse.json({ error: '캐릭터 이미지를 올리거나 프리셋을 선택해주세요.' }, { status: 400 });
  }

  // TODO(credits): const ok = await canGenerate(userId); if (!ok) return 429;  — 정책 확정 후 활성화

  const jobId = uuidv4();
  await createJob({ id: jobId, sessionId: userId, topic: '말하는 캐릭터', duration: 30, tone: '기본' });
  updateJob(jobId, {
    status: 'queued',
    progress: 5,
    steps: { script: 'done', audio: 'pending', video: 'pending' },
  });

  processCharacterJob(jobId, imageBuf, contentType, script, voice, speed).catch(console.error);

  return NextResponse.json({ jobId });
}
