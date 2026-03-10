import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import { createJob, updateJob } from '@/lib/jobStore';
import { canGenerate, incrementUsage } from '@/lib/usageStore';
import { generatePromoScript, PromoInput, VideoScript } from '@/lib/anthropic';
import { generateAudioWithTimepoints } from '@/lib/tts';
import { generateVideo } from '@/lib/video';

/** Strip phone numbers / addresses from text so TTS doesn't read them awkwardly */
function stripContactFromText(text: string): string {
  return text
    // Korean mobile: 010-1234-5678, 010 1234 5678, 01012345678
    .replace(/\b01[016789][-\s]?\d{3,4}[-\s]?\d{4}\b/g, '')
    // General phone: 02-1234-5678, 031-123-4567
    .replace(/\b0\d{1,2}[-\s]?\d{3,4}[-\s]?\d{4}\b/g, '')
    // URL patterns (no need to read them)
    .replace(/https?:\/\/\S+/g, '')
    // Trim multiple spaces
    .replace(/\s{2,}/g, ' ')
    .trim();
}

async function processPromoJob(
  jobId: string,
  input: PromoInput,
  voice: string,
  speed: number,
  userImagePaths: string[],
  prebuiltScript?: VideoScript,
) {
  const audioDir = path.join(process.cwd(), 'data', 'audio');
  const videoDir = path.join(process.cwd(), 'public', 'videos');

  [audioDir, videoDir].forEach((d) => {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  });

  const audioPath = path.join(audioDir, `${jobId}.mp3`);
  const videoPath = path.join(videoDir, `${jobId}.mp4`);

  // Build contact/location info for bottom overlay bar
  const infoParts: string[] = [];
  if (input.contact?.trim()) infoParts.push(input.contact.trim());
  if (input.location?.trim()) infoParts.push(input.location.trim());
  const bottomInfo = infoParts.length > 0 ? infoParts.join('   ') : undefined;

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
      // Step 1: Generate promo script
      updateJob(jobId, {
        status: 'generating_script',
        progress: 10,
        steps: { script: 'running', audio: 'pending', video: 'pending' },
      });

      script = await generatePromoScript(input);

      updateJob(jobId, {
        progress: 30,
        script: JSON.stringify(script),
        steps: { script: 'done', audio: 'running', video: 'pending' },
        status: 'generating_audio',
      });
    }

    // Step 2: Generate audio with SSML timepoints for accurate subtitle timing
    // Strip phone numbers/URLs so TTS reads naturally
    const sentences = script.sections.flatMap(s => {
      const cleaned = stripContactFromText(s.text);
      return cleaned.split(/(?<=[.!?。！？])\s*/).map(x => x.trim()).filter(Boolean);
    });
    const sentenceDurations = await generateAudioWithTimepoints(sentences, audioPath, voice, speed);

    updateJob(jobId, {
      progress: 65,
      steps: { script: 'done', audio: 'done', video: 'running' },
      status: 'generating_video',
    });

    // Step 3: Generate video
    // Pass businessName separately so the overlay shows:
    //   ① business name (small, top of title zone)
    //   ② catchy script title (large, gradient, below business name)
    await generateVideo(script, audioPath, videoPath, userImagePaths, bottomInfo, sentenceDurations, input.businessName);

    // Cleanup audio and uploaded images
    try { fs.unlinkSync(audioPath); } catch { /* ignore */ }
    for (const imgPath of userImagePaths) {
      try { fs.unlinkSync(imgPath); } catch { /* ignore */ }
    }
    // Remove uploads dir if empty
    if (userImagePaths.length > 0) {
      try {
        const uploadsDir = path.dirname(userImagePaths[0]);
        fs.rmdirSync(uploadsDir);
      } catch { /* ignore */ }
    }

    updateJob(jobId, {
      status: 'done',
      progress: 100,
      steps: { script: 'done', audio: 'done', video: 'done' },
      videoUrl: `/videos/${jobId}.mp4`,
    });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`[PromoJob ${jobId}] Failed:`, errorMsg);
    updateJob(jobId, {
      status: 'failed',
      error: errorMsg,
    });
  }
}

export async function POST(req: NextRequest) {
  // Detect content type: FormData (with images) or JSON (no images)
  const contentType = req.headers.get('content-type') ?? '';
  const isFormData = contentType.includes('multipart/form-data');

  let businessName = '';
  let businessType = '';
  let sellingPoints = '';
  let contact = '';
  let location = '';
  let cta = '';
  let duration = 60;
  let tone = '친근한';
  let sessionId = '';
  let voice = 'nova';
  let speed = 1.0;
  let prebuiltScript: VideoScript | undefined;
  const userImagePaths: string[] = [];

  if (isFormData) {
    const formData = await req.formData();

    businessName  = (formData.get('businessName')  as string | null) ?? '';
    businessType  = (formData.get('businessType')  as string | null) ?? '';
    sellingPoints = (formData.get('sellingPoints') as string | null) ?? '';
    contact       = (formData.get('contact')       as string | null) ?? '';
    location      = (formData.get('location')      as string | null) ?? '';
    cta           = (formData.get('cta')           as string | null) ?? '';
    sessionId     = (formData.get('sessionId')     as string | null) ?? '';
    voice         = (formData.get('voice')         as string | null) ?? 'nova';
    duration      = parseInt((formData.get('duration') as string | null) ?? '60', 10);
    tone          = (formData.get('tone')          as string | null) ?? '친근한';
    speed         = parseFloat((formData.get('speed') as string | null) ?? '1.0');
    const prebuiltScriptRaw = formData.get('prebuiltScript') as string | null;
    if (prebuiltScriptRaw) {
      try { prebuiltScript = JSON.parse(prebuiltScriptRaw); } catch { /* ignore */ }
    }

    // Save uploaded images
    const jobId = uuidv4();
    const uploadsDir = path.join(process.cwd(), 'data', 'uploads', jobId);

    const imageFiles = formData.getAll('images') as File[];
    const validImages = imageFiles.filter(f => f instanceof File && f.size > 0).slice(0, 5);

    if (validImages.length > 0) {
      fs.mkdirSync(uploadsDir, { recursive: true });
      for (let i = 0; i < validImages.length; i++) {
        const file = validImages[i];
        const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg';
        const savePath = path.join(uploadsDir, `img_${i}.${ext}`);
        const arrayBuffer = await file.arrayBuffer();
        fs.writeFileSync(savePath, Buffer.from(arrayBuffer));
        userImagePaths.push(savePath);
      }
      console.log(`[Promo] Saved ${userImagePaths.length} user images for job ${jobId}`);
    }

    // Validate required fields
    if (!businessName?.trim()) {
      return NextResponse.json({ error: '업체명을 입력해주세요.' }, { status: 400 });
    }
    if (!businessType?.trim()) {
      return NextResponse.json({ error: '업종을 선택해주세요.' }, { status: 400 });
    }
    if (!sellingPoints?.trim()) {
      return NextResponse.json({ error: '홍보 포인트를 입력해주세요.' }, { status: 400 });
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

    const topic = `${businessName} ${businessType} 홍보`;
    createJob({ id: jobId, sessionId, topic, duration, tone });
    incrementUsage(sessionId);

    const input: PromoInput = {
      businessName: businessName.trim(),
      businessType: businessType.trim(),
      sellingPoints: sellingPoints.trim(),
      contact: contact?.trim() || undefined,
      location: location?.trim() || undefined,
      cta: cta?.trim() || undefined,
      duration,
      tone,
    };

    processPromoJob(jobId, input, voice, speed, userImagePaths, prebuiltScript).catch(console.error);
    return NextResponse.json({ jobId });

  } else {
    // JSON fallback (no images)
    const body = await req.json().catch(() => ({}));
    ({
      businessName = '',
      businessType = '',
      sellingPoints = '',
      contact = '',
      location = '',
      cta = '',
      duration = 60,
      tone = '친근한',
      sessionId = '',
      voice = 'nova',
      speed = 1.0,
    } = body);
    prebuiltScript = body.prebuiltScript ?? undefined;

    if (!businessName?.trim()) {
      return NextResponse.json({ error: '업체명을 입력해주세요.' }, { status: 400 });
    }
    if (!businessType?.trim()) {
      return NextResponse.json({ error: '업종을 선택해주세요.' }, { status: 400 });
    }
    if (!sellingPoints?.trim()) {
      return NextResponse.json({ error: '홍보 포인트를 입력해주세요.' }, { status: 400 });
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
    const topic = `${businessName} ${businessType} 홍보`;
    createJob({ id: jobId, sessionId, topic, duration, tone });
    incrementUsage(sessionId);

    const input: PromoInput = {
      businessName: businessName.trim(),
      businessType: businessType.trim(),
      sellingPoints: sellingPoints.trim(),
      contact: contact?.trim() || undefined,
      location: location?.trim() || undefined,
      cta: cta?.trim() || undefined,
      duration,
      tone,
    };

    processPromoJob(jobId, input, voice, Number(speed), [], prebuiltScript).catch(console.error);
    return NextResponse.json({ jobId });
  }
}
