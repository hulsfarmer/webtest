import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import axios from 'axios';

const execAsync = promisify(exec);

// ── Voice mapping: UI ID → Google Cloud TTS Neural2 ─────────────────────────
// ko-KR-Neural2-A : 여성 · 자연스러운
// ko-KR-Neural2-B : 여성 · 부드러운
// ko-KR-Neural2-C : 남성 · 명확한
// ko-KR-Neural2-D : 남성 · 중후한
const GOOGLE_VOICE_MAP: Record<string, string> = {
  nova:    'ko-KR-Neural2-A',
  shimmer: 'ko-KR-Neural2-B',
  echo:    'ko-KR-Neural2-C',
  onyx:    'ko-KR-Neural2-D',
  // 하위 호환
  alloy:   'ko-KR-Neural2-A',
  fable:   'ko-KR-Neural2-C',
};

// ── Google Cloud TTS Neural2 (1순위) ─────────────────────────────────────────
async function generateGoogleCloudTTS(
  text: string,
  outputPath: string,
  voice = 'nova',
  speed = 1.0
): Promise<void> {
  const apiKey = process.env.GOOGLE_TTS_API_KEY;
  if (!apiKey) throw new Error('GOOGLE_TTS_API_KEY not set');

  const voiceName = GOOGLE_VOICE_MAP[voice] || 'ko-KR-Neural2-A';

  const response = await axios.post(
    `https://texttospeech.googleapis.com/v1/text:synthesize?key=${apiKey}`,
    {
      input: { text },
      voice: {
        languageCode: 'ko-KR',
        name: voiceName,
      },
      audioConfig: {
        audioEncoding: 'MP3',
        speakingRate: speed,  // 0.25 ~ 4.0
        pitch: 0.0,
      },
    },
    { timeout: 30000 }
  );

  const audioContent: string = response.data.audioContent;
  const audioBuffer = Buffer.from(audioContent, 'base64');
  fs.writeFileSync(outputPath, audioBuffer);
}

// ── OpenAI TTS (2순위 fallback) ──────────────────────────────────────────────
async function generateOpenAITTS(
  text: string,
  outputPath: string,
  voice = 'nova',
  speed = 1.0
): Promise<void> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY not set');

  const response = await axios.post(
    'https://api.openai.com/v1/audio/speech',
    { model: 'tts-1', input: text, voice, speed, response_format: 'mp3' },
    {
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      responseType: 'arraybuffer',
      timeout: 60000,
    }
  );
  fs.writeFileSync(outputPath, Buffer.from(response.data));
}

// ── Google Translate TTS (3순위 – 무료, API 키 불필요) ──────────────────────
async function generateGoogleTranslateTTS(
  text: string,
  outputPath: string,
  speed = 1.0,
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ffmpegPath = require('ffmpeg-static') as string;
  const dir = path.dirname(outputPath);

  // Split into ≤100-char chunks (URL length limit for this endpoint)
  const chunks: string[] = [];
  let remaining = text.trim();
  while (remaining.length > 0) {
    if (remaining.length <= 100) {
      chunks.push(remaining);
      break;
    }
    // Try to cut at a space/punctuation boundary
    let cut = remaining.lastIndexOf(' ', 100);
    if (cut < 10) cut = 100;
    chunks.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trim();
  }

  const chunkPaths: string[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const chunkPath = path.join(dir, `gtts_${Date.now()}_${i}.mp3`);
    const encoded = encodeURIComponent(chunks[i]);
    // slow=false → 정상 속도 (없으면 Google이 느린 모드로 읽음)
    const url = `https://translate.google.com/translate_tts?tl=ko&client=tw-ob&slow=false&q=${encoded}`;

    const response = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://translate.google.com/',
      },
    });
    fs.writeFileSync(chunkPath, Buffer.from(response.data));
    chunkPaths.push(chunkPath);
  }

  // Concat chunks (or single file) into rawPath first
  const rawPath = path.join(dir, `gtts_raw_${Date.now()}.mp3`);
  if (chunkPaths.length === 1) {
    fs.renameSync(chunkPaths[0], rawPath);
  } else {
    const concatFile = path.join(dir, `gtts_concat_${Date.now()}.txt`);
    fs.writeFileSync(concatFile, chunkPaths.map(p => `file '${p.replace(/'/g, "'\\''")}'`).join('\n'));
    try {
      await execAsync(`"${ffmpegPath}" -f concat -safe 0 -i "${concatFile}" -c copy -y "${rawPath}"`);
    } finally {
      chunkPaths.forEach(p => { try { fs.unlinkSync(p); } catch { /* ignore */ } });
      try { fs.unlinkSync(concatFile); } catch { /* ignore */ }
    }
  }

  // Apply speed via atempo if user set speed != 1.0
  // atempo range: 0.5–2.0 per filter (chain two for values outside range)
  if (Math.abs(speed - 1.0) > 0.02) {
    const clamped = Math.max(0.5, Math.min(2.0, speed));
    try {
      await execAsync(
        `"${ffmpegPath}" -i "${rawPath}" -filter:a "atempo=${clamped.toFixed(2)}" -acodec libmp3lame -q:a 3 -y "${outputPath}"`
      );
    } finally {
      try { fs.unlinkSync(rawPath); } catch { /* ignore */ }
    }
  } else {
    fs.renameSync(rawPath, outputPath);
  }
}

// ── Silent fallback (4순위) ───────────────────────────────────────────────────
async function generateSilent(outputPath: string, duration: number): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ffmpegPath = require('ffmpeg-static') as string;
  await execAsync(
    `"${ffmpegPath}" -f lavfi -i "anullsrc=r=44100:cl=stereo" -t ${duration} -acodec libmp3lame -y "${outputPath}"`
  );
}

// ── Main export ───────────────────────────────────────────────────────────────
export async function generateAudio(
  text: string,
  outputPath: string,
  fallbackDuration = 60,
  voice = 'nova',
  speed = 1.0
): Promise<void> {
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  // 1순위: Google Cloud TTS Neural2 (자연스러운 한국어)
  if (process.env.GOOGLE_TTS_API_KEY) {
    try {
      const voiceName = GOOGLE_VOICE_MAP[voice] || 'ko-KR-Neural2-A';
      console.log(`[TTS] Google Cloud Neural2 (${voiceName}, speed: ${speed})`);
      await generateGoogleCloudTTS(text, outputPath, voice, speed);
      console.log('[TTS] Google Cloud TTS complete');
      return;
    } catch (err) {
      console.warn('[TTS] Google Cloud TTS failed, trying OpenAI fallback:', err);
    }
  }

  // 2순위: OpenAI TTS
  if (process.env.OPENAI_API_KEY) {
    try {
      console.log(`[TTS] OpenAI TTS fallback (voice: ${voice})`);
      await generateOpenAITTS(text, outputPath, voice, speed);
      console.log('[TTS] OpenAI TTS complete');
      return;
    } catch (err) {
      console.warn('[TTS] OpenAI TTS also failed, trying Google Translate TTS:', err);
    }
  }

  // 3순위: Google Translate TTS (무료, API 키 불필요)
  try {
    console.log('[TTS] Google Translate TTS fallback (free)');
    await generateGoogleTranslateTTS(text, outputPath, speed);
    console.log('[TTS] Google Translate TTS complete');
    return;
  } catch (err) {
    console.warn('[TTS] Google Translate TTS also failed, using silent:', err);
  }

  // 4순위: 무음
  console.warn('[TTS] All TTS options failed, generating silent audio');
  await generateSilent(outputPath, fallbackDuration);
}

// execAsync는 silent fallback에서만 사용됨
void execAsync;
