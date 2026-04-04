import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import { createJob, updateJob } from '@/lib/jobStore';
import { reviseScript, VideoScript } from '@/lib/anthropic';
import { generateAudio } from '@/lib/tts';
import { generateVideo } from '@/lib/video';

async function processReviseJob(
  jobId: string,
  originalScript: VideoScript,
  feedback: string,
  voice: string,
  speed: number,
) {
  const audioDir = path.join(process.cwd(), 'data', 'audio');
  const videoDir = path.join(process.cwd(), 'public', 'videos');
  [audioDir, videoDir].forEach((d) => {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  });

  const audioPath = path.join(audioDir, `${jobId}.mp3`);
  const videoPath = path.join(videoDir, `${jobId}.mp4`);

  try {
    // Step 1: AI가 스크립트 수정
    updateJob(jobId, {
      status: 'generating_script',
      progress: 10,
      steps: { script: 'running', audio: 'pending', video: 'pending' },
    });

    const revisedScript = await reviseScript(originalScript, feedback);

    updateJob(jobId, {
      progress: 30,
      script: JSON.stringify(revisedScript),
      steps: { script: 'done', audio: 'running', video: 'pending' },
      status: 'generating_audio',
    });

    // Step 2: 음성 재생성
    const fullText = revisedScript.sections.map((s) => s.text).join(' ');
    await generateAudio(fullText, audioPath, revisedScript.totalDuration, voice, speed);

    updateJob(jobId, {
      progress: 65,
      steps: { script: 'done', audio: 'done', video: 'running' },
      status: 'generating_video',
    });

    // Step 3: 영상 재합성
    await generateVideo(revisedScript, audioPath, videoPath);

    try { fs.unlinkSync(audioPath); } catch { /* ignore */ }

    updateJob(jobId, {
      status: 'done',
      progress: 100,
      steps: { script: 'done', audio: 'done', video: 'done' },
      videoUrl: `/videos/${jobId}.mp4`,
    });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`[ReviseJob ${jobId}] Failed:`, errorMsg);
    updateJob(jobId, { status: 'failed', error: errorMsg });
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const {
    originalScript,
    feedback,
    sessionId,
    voice = 'nova',
    speed = 1.0,
  } = body;

  if (!originalScript || typeof originalScript !== 'object') {
    return NextResponse.json({ error: '원본 스크립트가 필요합니다.' }, { status: 400 });
  }
  if (!feedback?.trim()) {
    return NextResponse.json({ error: '수정 요청을 입력해주세요.' }, { status: 400 });
  }
  if (!sessionId) {
    return NextResponse.json({ error: 'sessionId가 필요합니다.' }, { status: 400 });
  }

  const jobId = uuidv4();
  const duration = (originalScript as VideoScript).totalDuration ?? 60;

  // 수정은 사용량 카운트 차감 없음 (기존 영상 수정이므로)
  createJob({
    id: jobId,
    sessionId,
    topic: `✏️ 수정: ${String(feedback).slice(0, 40)}`,
    duration,
    tone: '',
  });

  processReviseJob(
    jobId,
    originalScript as VideoScript,
    feedback.trim(),
    voice,
    Number(speed),
  ).catch(console.error);

  return NextResponse.json({ jobId });
}
