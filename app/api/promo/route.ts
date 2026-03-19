import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import { createJob, updateJob } from '@/lib/jobStore';
import { canGenerate, incrementUsage, getUsage } from '@/lib/usageStore';
import { generatePromoScript, PromoInput, VideoScript } from '@/lib/anthropic';
import { generateAudioWithTimepoints } from '@/lib/tts';
import { generateVideo } from '@/lib/video';
import { resolveBgmPath, BgmId } from '@/lib/bgm';
import { supabase } from '@/lib/supabase';

// 플랜별 보관 한도
const HISTORY_LIMITS: Record<string, number> = {
  free: 3, pro: 30, business: 100, admin: 9999,
};

/** 보관 한도 초과 시 오래된 영상 자동 삭제 */
async function cleanupOldVideos(currentJobId: string) {
  // 현재 job의 user_id와 plan 조회
  const { data: job } = await supabase
    .from('jobs')
    .select('user_id')
    .eq('id', currentJobId)
    .single();
  if (!job?.user_id) return;

  const { data: user } = await supabase
    .from('users')
    .select('plan')
    .eq('id', job.user_id)
    .single();
  const plan = user?.plan || 'free';
  const limit = HISTORY_LIMITS[plan] || 3;

  // 완료된 영상 목록 (최신순)
  const { data: allJobs } = await supabase
    .from('jobs')
    .select('id')
    .eq('user_id', job.user_id)
    .eq('status', 'done')
    .order('created_at', { ascending: false });

  if (!allJobs || allJobs.length <= limit) return;

  // 한도 초과분 삭제
  const toDelete = allJobs.slice(limit);
  const videoDir = path.join(process.cwd(), 'public', 'videos');

  const uploadsDir = path.join(process.cwd(), 'data', 'uploads');
  for (const old of toDelete) {
    // 영상 파일 삭제
    const videoPath = path.join(videoDir, `${old.id}.mp4`);
    try { fs.unlinkSync(videoPath); } catch { /* ignore */ }
    // 업로드 이미지 폴더 삭제
    const imgDir = path.join(uploadsDir, old.id);
    try { fs.rmSync(imgDir, { recursive: true, force: true }); } catch { /* ignore */ }
    await supabase.from('jobs').delete().eq('id', old.id);
    console.log(`[Cleanup] Deleted old video + images: ${old.id}`);
  }
}

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
  bgmId?: BgmId,
  customBgmPath?: string,
  bgmVolume?: number,
  showWatermark?: boolean,
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
    const sentenceDurations = await generateAudioWithTimepoints(sentences, audioPath, voice, speed, (percent) => {
      // Audio step spans progress 30–65 (35% range)
      const audioProgress = 30 + Math.round((percent / 100) * 35);
      updateJob(jobId, {
        progress: Math.min(audioProgress, 64), // cap at 64, 65 = audio done
        steps: { script: 'done', audio: 'running', video: 'pending' },
        status: 'generating_audio',
      });
    });

    updateJob(jobId, {
      progress: 65,
      steps: { script: 'done', audio: 'done', video: 'running' },
      status: 'generating_video',
    });

    // Step 3: Resolve BGM (download and cache if needed)
    let bgmPath: string | null = null;
    console.log(`[Promo] BGM requested: bgmId="${bgmId}", customBgm=${!!customBgmPath}`);
    if (customBgmPath) {
      bgmPath = customBgmPath;
      console.log(`[Promo] Using custom BGM: "${bgmPath}"`);
    } else if (bgmId && bgmId !== 'none') {
      bgmPath = await resolveBgmPath(bgmId);
      console.log(`[Promo] BGM resolved: path="${bgmPath}"`);
    } else {
      console.log(`[Promo] BGM skipped (none or empty)`);
    }

    // Step 4: Generate video
    // Pass businessName separately so the overlay shows:
    //   ① business name (small, top of title zone)
    //   ② catchy script title (large, gradient, below business name)
    await generateVideo(
      script, audioPath, videoPath, userImagePaths,
      bottomInfo, sentenceDurations, input.businessName,
      bgmPath ?? undefined, bgmId, bgmVolume, showWatermark, input.tone,
    );

    // Cleanup audio and custom BGM (uploaded images are kept for history reuse)
    try { fs.unlinkSync(audioPath); } catch { /* ignore */ }
    if (customBgmPath) { try { fs.unlinkSync(customBgmPath); } catch { /* ignore */ } }

    updateJob(jobId, {
      status: 'done',
      progress: 100,
      steps: { script: 'done', audio: 'done', video: 'done' },
      videoUrl: `/api/video/${jobId}`,
    });

    // 보관 한도 초과 시 오래된 영상 자동 삭제
    cleanupOldVideos(jobId).catch(err =>
      console.error(`[Promo] cleanup old videos error:`, err)
    );
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
  // Auth check
  const authSession = await getServerSession(authOptions);
  if (!authSession?.user?.id) {
    return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  }
  const userId = authSession.user.id;

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
  let voice = 'ko-KR-Chirp3-HD-Aoede';
  let speed = 1.0;
  let bgmId: BgmId = 'none';
  let bgmVolume: number | undefined;
  let customBgmPath: string | undefined;
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
    voice         = (formData.get('voice')         as string | null) ?? 'ko-KR-Chirp3-HD-Aoede';
    duration      = parseInt((formData.get('duration') as string | null) ?? '60', 10);
    tone          = (formData.get('tone')          as string | null) ?? '친근한';
    speed         = parseFloat((formData.get('speed') as string | null) ?? '1.0');
    bgmId         = ((formData.get('bgmId') as string | null) ?? 'none') as BgmId;
    const bgmVolumeRaw = formData.get('bgmVolume') as string | null;
    if (bgmVolumeRaw) bgmVolume = parseFloat(bgmVolumeRaw);
    const prebuiltScriptRaw = formData.get('prebuiltScript') as string | null;
    if (prebuiltScriptRaw) {
      try { prebuiltScript = JSON.parse(prebuiltScriptRaw); } catch { /* ignore */ }
    }

    // Save uploaded images
    const jobId = uuidv4();
    const uploadsDir = path.join(process.cwd(), 'data', 'uploads', jobId);

    const imageFiles = formData.getAll('images') as File[];
    const IMAGE_EXTS = /\.(jpe?g|png|webp|gif|bmp|heic|heif|avif)$/i;
    const validImages = imageFiles.filter(f =>
      f instanceof File && f.size > 0 && (f.type.startsWith('image/') || IMAGE_EXTS.test(f.name) || f.name === 'blob')
    ).slice(0, 5);

    if (validImages.length > 0) {
      fs.mkdirSync(uploadsDir, { recursive: true });
      const sharp = (await import('sharp')).default;
      for (let i = 0; i < validImages.length; i++) {
        const file = validImages[i];
        const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg';
        const arrayBuffer = await file.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        // Always convert to JPEG via sharp for compatibility (Claude API + ffmpeg)
        const savePath = path.join(uploadsDir, `img_${i}.jpg`);
        try {
          await sharp(buffer).jpeg({ quality: 90 }).toFile(savePath);
          if (ext !== 'jpg' && ext !== 'jpeg') {
            console.log(`[Promo] Converted ${ext.toUpperCase()} → JPEG: ${file.name}`);
          }
        } catch (convErr) {
          console.warn(`[Promo] Sharp conversion failed for ${file.name} (${ext}):`, convErr);
          // Fallback: save original and hope for the best
          fs.writeFileSync(savePath, buffer);
        }
        userImagePaths.push(savePath);
      }
      console.log(`[Promo] Saved ${userImagePaths.length} user images for job ${jobId}`);
    }

    // Save custom BGM file if uploaded
    const customBgmFile = formData.get('customBgm') as File | null;
    if (customBgmFile && customBgmFile instanceof File && customBgmFile.size > 0) {
      const bgmDir = path.join(process.cwd(), 'data', 'bgm');
      if (!fs.existsSync(bgmDir)) fs.mkdirSync(bgmDir, { recursive: true });
      const ext = customBgmFile.name.split('.').pop()?.toLowerCase() || 'mp3';
      const savePath = path.join(bgmDir, `custom_${jobId}.${ext}`);
      const arrayBuffer = await customBgmFile.arrayBuffer();
      fs.writeFileSync(savePath, Buffer.from(arrayBuffer));
      customBgmPath = savePath;
      console.log(`[Promo] Saved custom BGM: ${savePath}`);
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

    if (!(await canGenerate(userId))) {
      return NextResponse.json(
        { error: '이번 달 생성 한도를 초과했습니다. 플랜을 업그레이드해주세요.' },
        { status: 429 }
      );
    }

    const usage = await getUsage(userId);
    const showWatermark = usage.plan === 'free';

    const topic = `${businessName} ${businessType} 홍보`;
    await createJob({ id: jobId, sessionId: userId, topic, duration, tone });
    await incrementUsage(userId);

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

    processPromoJob(jobId, input, voice, speed, userImagePaths, prebuiltScript, bgmId, customBgmPath, bgmVolume, showWatermark).catch(console.error);
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
      voice = 'ko-KR-Chirp3-HD-Aoede',
      speed = 1.0,
    } = body);
    bgmId = (body.bgmId ?? 'none') as BgmId;
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

    if (!(await canGenerate(userId))) {
      return NextResponse.json(
        { error: '이번 달 생성 한도를 초과했습니다. 플랜을 업그레이드해주세요.' },
        { status: 429 }
      );
    }

    const usage2 = await getUsage(userId);
    const showWatermark2 = usage2.plan === 'free';

    const jobId = uuidv4();
    const topic = `${businessName} ${businessType} 홍보`;
    await createJob({ id: jobId, sessionId: userId, topic, duration, tone });
    await incrementUsage(userId);

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

    processPromoJob(jobId, input, voice, Number(speed), [], prebuiltScript, bgmId, undefined, undefined, showWatermark2).catch(console.error);
    return NextResponse.json({ jobId });
  }
}
