import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import axios from 'axios';

const execAsync = promisify(exec);

// ── Voice mapping: UI ID → Google Cloud TTS voice name ───────────────────────
// Google Chirp3-HD (최신, 가장 자연스러운 한국어)
//   ko-KR-Chirp3-HD-Aoede    : 여성 · 자연스러운
//   ko-KR-Chirp3-HD-Zephyr   : 여성 · 활기찬
//   ko-KR-Chirp3-HD-Charon   : 남성 · 자연스러운
// Google Neural2 (안정적인 한국어 - fallback)
//   ko-KR-Neural2-A : 여성
//   ko-KR-Neural2-C : 남성
//
// Google 음성 ID를 직접 전달할 때는 매핑 없이 그대로 사용.
// 하위 호환용 OpenAI-style ID 및 구버전 Journey ID 변환.
const GOOGLE_VOICE_MAP: Record<string, string> = {
  // OpenAI-style aliases
  nova:    'ko-KR-Chirp3-HD-Aoede',   // 여성 · 자연스러운
  shimmer: 'ko-KR-Chirp3-HD-Zephyr',  // 여성 · 활기찬
  echo:    'ko-KR-Chirp3-HD-Charon',  // 남성 · 자연스러운
  onyx:    'ko-KR-Chirp3-HD-Charon',  // 남성
  alloy:   'ko-KR-Chirp3-HD-Aoede',
  fable:   'ko-KR-Chirp3-HD-Charon',
  // Journey → Chirp3-HD 변환 (구버전 호환)
  'ko-KR-Journey-F': 'ko-KR-Chirp3-HD-Aoede',
  'ko-KR-Journey-O': 'ko-KR-Chirp3-HD-Zephyr',
  'ko-KR-Journey-D': 'ko-KR-Chirp3-HD-Charon',
};

/** Google 음성 이름 해석: 매핑 테이블에 있으면 변환, 없으면 그대로 사용 */
function resolveGoogleVoice(voice: string): string {
  return GOOGLE_VOICE_MAP[voice] ?? voice;
}

// ── Google Cloud TTS Neural2 (1순위) ─────────────────────────────────────────
async function generateGoogleCloudTTS(
  text: string,
  outputPath: string,
  voice = 'nova',
  speed = 1.0
): Promise<void> {
  const apiKey = process.env.GOOGLE_TTS_API_KEY;
  if (!apiKey) throw new Error('GOOGLE_TTS_API_KEY not set');

  const voiceName = resolveGoogleVoice(voice);

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

// ── SSML helpers ─────────────────────────────────────────────────────────────
function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Generate audio from a list of sentences using Google Cloud TTS SSML marks.
 * Returns the duration (in seconds) of each sentence.
 * Falls back to proportional estimation when Google Cloud TTS is unavailable.
 */
export async function generateAudioWithTimepoints(
  sentences: string[],
  outputPath: string,
  voice = 'nova',
  speed = 1.0,
): Promise<number[]> {
  const apiKey = process.env.GOOGLE_TTS_API_KEY;

  if (apiKey) {
    try {
      const voiceName = resolveGoogleVoice(voice);
      const dir = path.dirname(outputPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

      // Build SSML with <mark> between sentences
      const ssmlParts = sentences.map((s, i) => `<mark name="s${i}"/>${escapeXml(s)}`);
      const ssml = `<speak>${ssmlParts.join(' ')}<mark name="s${sentences.length}"/></speak>`;

      const response = await axios.post(
        `https://texttospeech.googleapis.com/v1beta1/text:synthesize?key=${apiKey}`,
        {
          input: { ssml },
          voice: { languageCode: 'ko-KR', name: voiceName },
          audioConfig: { audioEncoding: 'MP3', speakingRate: speed },
          enableTimePointing: ['SSML_MARK'],
        },
        { timeout: 30000 }
      );

      const audioContent: string = response.data.audioContent;
      fs.writeFileSync(outputPath, Buffer.from(audioContent, 'base64'));

      // Extract per-sentence durations from timepoints
      const timepoints: Array<{ markName: string; timeSeconds: number }> =
        response.data.timepoints ?? [];

      // Chirp3-HD doesn't return timepoints — generate each sentence individually to measure exact duration
      if (timepoints.length === 0) {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const ffmpegPath = require('ffmpeg-static') as string;
        const tmpDir = path.dirname(outputPath);
        const segmentPaths: string[] = [];
        const durations: number[] = [];

        try {
          for (let i = 0; i < sentences.length; i++) {
            const segPath = path.join(tmpDir, `seg_${i}_${Date.now()}.mp3`);
            // Add brief pauses after commas via SSML for natural pacing
            const ssmlText = `<speak>${escapeXml(sentences[i]).replace(/,\s*/g, ',<break time="150ms"/>')}</speak>`;
            const segResp = await axios.post(
              `https://texttospeech.googleapis.com/v1/text:synthesize?key=${apiKey}`,
              {
                input: { ssml: ssmlText },
                voice: { languageCode: 'ko-KR', name: voiceName },
                audioConfig: { audioEncoding: 'MP3', speakingRate: speed },
              },
              { timeout: 30000 }
            );
            fs.writeFileSync(segPath, Buffer.from(segResp.data.audioContent, 'base64'));
            segmentPaths.push(segPath);
            const dur = await getActualAudioDuration(segPath);
            durations.push(Math.max(dur, 0.4));
          }

          // Concat all segments into final output (exact audio matches measured durations)
          if (segmentPaths.length === 1) {
            fs.copyFileSync(segmentPaths[0], outputPath);
          } else {
            const concatFile = path.join(tmpDir, `concat_${Date.now()}.txt`);
            fs.writeFileSync(
              concatFile,
              segmentPaths.map(p => `file '${p.replace(/'/g, "'\\''")}'`).join('\n')
            );
            try {
              await execAsync(
                `"${ffmpegPath}" -f concat -safe 0 -i "${concatFile}" -c copy -y "${outputPath}"`
              );
            } finally {
              try { fs.unlinkSync(concatFile); } catch { /* ignore */ }
            }
          }

          console.log('[TTS] Chirp3-HD per-sentence measured:', durations.map(d => d.toFixed(2)).join(', '));
          return durations;
        } finally {
          for (const p of segmentPaths) {
            try { fs.unlinkSync(p); } catch { /* ignore */ }
          }
        }
      }

      const durations: number[] = sentences.map((_, i) => {
        const start = timepoints.find(tp => tp.markName === `s${i}`)?.timeSeconds ?? null;
        const end   = timepoints.find(tp => tp.markName === `s${i + 1}`)?.timeSeconds ?? null;
        if (start !== null && end !== null) return Math.max(end - start, 0.4);
        return null as unknown as number; // filled below
      });

      // Fill any missing durations proportionally
      const totalAudioSecs = timepoints.find(tp => tp.markName === `s${sentences.length}`)?.timeSeconds
        ?? durations.reduce((a, b) => a + (b || 0), 0);
      const totalChars = sentences.reduce((a, s) => a + s.length, 0);
      for (let i = 0; i < durations.length; i++) {
        if (!durations[i]) {
          durations[i] = Math.max((sentences[i].length / totalChars) * totalAudioSecs, 0.4);
        }
      }

      console.log('[TTS] SSML timepoints:', durations.map(d => d.toFixed(2)).join(', '));
      return durations;
    } catch (err) {
      const axiosErr = err as { response?: { data?: unknown } };
      if (axiosErr?.response?.data) console.warn('[TTS] SSML error body:', JSON.stringify(axiosErr.response.data));
      console.warn('[TTS] SSML timepoints failed, falling back to generateAudio:', err);
    }
  }

  // Fallback: generate audio normally, estimate durations by character proportion
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const fullText = sentences.join(' ');
  await generateAudio(fullText, outputPath, 60, voice, speed);

  // Measure actual audio duration for proportional estimation
  const actualDuration = await getActualAudioDuration(outputPath);
  const totalChars = sentences.reduce((a, s) => a + s.length, 0);
  return sentences.map(s => Math.max((s.length / totalChars) * actualDuration, 0.4));
}

async function getActualAudioDuration(audioPath: string): Promise<number> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ffmpegPath = require('ffmpeg-static') as string;

  // Try ffprobe (may not be bundled with ffmpeg-static)
  const probePath = ffmpegPath.replace(/ffmpeg$/, 'ffprobe');
  if (fs.existsSync(probePath)) {
    try {
      const { stdout } = await execAsync(
        `"${probePath}" -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${audioPath}"`
      );
      const d = parseFloat(stdout.trim());
      if (!isNaN(d) && d > 0) return d;
    } catch { /* fall through */ }
  }

  // Fallback: `ffmpeg -i file` (no output spec) always exits non-zero
  // but always prints file info including Duration: to stderr
  let ffmpegStderr = '';
  try {
    const r = await execAsync(`"${ffmpegPath}" -i "${audioPath}"`);
    ffmpegStderr = r.stderr;
  } catch (e: unknown) {
    ffmpegStderr = (e as { stderr?: string }).stderr ?? '';
  }
  const match = ffmpegStderr.match(/Duration:\s*(\d+):(\d+):(\d+\.?\d*)/);
  if (match) {
    const secs = parseInt(match[1]) * 3600 + parseInt(match[2]) * 60 + parseFloat(match[3]);
    if (secs > 0) return secs;
  }

  return 60;
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
      const voiceName = resolveGoogleVoice(voice);
      console.log(`[TTS] Google Cloud Neural2 (${voiceName}, speed: ${speed})`);
      await generateGoogleCloudTTS(text, outputPath, voice, speed);
      console.log('[TTS] Google Cloud TTS complete');
      return;
    } catch (err) {
      const axiosErr = err as { response?: { data?: unknown } };
      if (axiosErr?.response?.data) console.warn('[TTS] Google Cloud error body:', JSON.stringify(axiosErr.response.data));
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
