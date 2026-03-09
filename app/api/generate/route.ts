import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import { createJob, updateJob } from '@/lib/jobStore';
import { canGenerate, incrementUsage } from '@/lib/usageStore';
import { generateScript, VideoScript } from '@/lib/anthropic';
import { generateAudioWithTimepoints } from '@/lib/tts';
import { generateVideo } from '@/lib/video';

function getUploadedImagePaths(uploadId?: string): string[] {
  if (!uploadId) return [];
  const uploadDir = path.join(process.cwd(), 'data', 'uploads', uploadId);
  if (!fs.existsSync(uploadDir)) return [];
  return fs.readdirSync(uploadDir)
    .filter(f => /\.(jpe?g|png|webp|gif)$/i.test(f))
    .sort()
    .map(f => path.join(uploadDir, f));
}

async function processJob(
  jobId: string,
  topic: string,
  duration: number,
  tone: string,
  voice: string,
  speed: number,
  prebuiltScript?: VideoScript,
  uploadId?: string,
) {
  const audioDir = path.join(process.cwd(), 'data', 'audio');
  const videoDir = path.join(process.cwd(), 'public', 'videos');

  [audioDir, videoDir].forEach((d) => {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  });

  const audioPath = path.join(audioDir, `${jobId}.mp3`);
  const videoPath = path.join(videoDir, `${jobId}.mp4`);

  try {
    let script: VideoScript;

    if (prebuiltScript) {
      // Skip script generation — use the user-reviewed script directly
      script = prebuiltScript;
      updateJob(jobId, {
        status: 'generating_audio',
        progress: 30,
        script: JSON.stringify(script),
        steps: { script: 'done', audio: 'running', video: 'pending' },
      });
    } else {
      // Step 1: Generate script
      updateJob(jobId, {
        status: 'generating_script',
        progress: 10,
        steps: { script: 'running', audio: 'pending', video: 'pending' },
      });

      script = await generateScript(topic, duration, tone);

      updateJob(jobId, {
        progress: 30,
        script: JSON.stringify(script),
        steps: { script: 'done', audio: 'running', video: 'pending' },
        status: 'generating_audio',
      });
    }

    // Step 2: Generate audio with SSML timepoints for accurate subtitle timing
    const sentences = script.sections.flatMap(s =>
      s.text.split(/(?<=[.!?。！？])\s*/).map(x => x.trim()).filter(Boolean)
    );
    const sentenceDurations = await generateAudioWithTimepoints(sentences, audioPath, voice, speed);

    updateJob(jobId, {
      progress: 65,
      steps: { script: 'done', audio: 'done', video: 'running' },
      status: 'generating_video',
    });

    // Step 3: Generate video with accurate per-sentence durations
    const userImagePaths = getUploadedImagePaths(uploadId);
    await generateVideo(script, audioPath, videoPath, userImagePaths, undefined, sentenceDurations);

    // Cleanup audio file
    try { fs.unlinkSync(audioPath); } catch { /* ignore */ }

    updateJob(jobId, {
      status: 'done',
      progress: 100,
      steps: { script: 'done', audio: 'done', video: 'done' },
      videoUrl: `/videos/${jobId}.mp4`,
    });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`[Job ${jobId}] Failed:`, errorMsg);
    updateJob(jobId, {
      status: 'failed',
      error: errorMsg,
    });
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { topic, duration = 60, tone = '정보성', sessionId, voice = 'nova', speed = 1.1, prebuiltScript, uploadId } = body;

  if (!topic || typeof topic !== 'string' || topic.trim().length === 0) {
    return NextResponse.json({ error: '주제를 입력해주세요.' }, { status: 400 });
  }

  if (!sessionId) {
    return NextResponse.json({ error: 'sessionId가 필요합니다.' }, { status: 400 });
  }

  if (!canGenerate(sessionId)) {
    return NextResponse.json(
      { error: '이번 달 생성 한도를 초과했습니다. 플랜을 업그레이드해주세요.' },
      { status: 429 }
    );
  }

  const jobId = uuidv4();
  createJob({ id: jobId, sessionId, topic: topic.trim(), duration, tone });
  incrementUsage(sessionId);

  // Fire-and-forget background processing
  processJob(jobId, topic.trim(), duration, tone, voice, Number(speed), prebuiltScript ?? undefined, uploadId ?? undefined).catch(console.error);

  return NextResponse.json({ jobId });
}
