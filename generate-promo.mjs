import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
process.chdir(__dirname);

// Load .env.local manually
const envFile = fs.readFileSync('.env.local', 'utf8');
for (const line of envFile.split('\n')) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const eqIdx = trimmed.indexOf('=');
  if (eqIdx === -1) continue;
  const key = trimmed.slice(0, eqIdx).trim();
  const val = trimmed.slice(eqIdx + 1).trim();
  if (!process.env[key]) process.env[key] = val;
}

const { generatePromoScript } = await import('./lib/anthropic.ts');
const { generateAudioWithTimepoints } = await import('./lib/tts.ts');
const { generateVideo } = await import('./lib/video.ts');
const { resolveBgmPath } = await import('./lib/bgm.ts');

const jobId = uuidv4();
const audioDir = path.join(process.cwd(), 'data', 'audio');
const videoDir = path.join(process.cwd(), 'public', 'videos');
[audioDir, videoDir].forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });

const audioPath = path.join(audioDir, `${jobId}.mp3`);
const videoPath = path.join(videoDir, `${jobId}.mp4`);

const input = {
  businessName: 'ShortsAI',
  businessType: 'AI 서비스',
  sellingPoints: '업체명과 사진만 올리면 AI가 고화질 홍보영상을 3분 안에 자동 생성. 스크립트, 음성, BGM, 영상까지 원클릭 완성. 카페, 식당, 헬스장, 미용실, 학교, 농장 등 업종 상관없이 누구나 전문가급 홍보영상. 한국어 완벽 지원. 무료로 시작 가능.',
  contact: 'shortsai.kr',
  cta: '지금 무료로 시작하세요',
  duration: 60,
  tone: '전문적인',
};

console.log('[1/4] Generating script...');
const script = await generatePromoScript(input);
console.log('Script:', script.title, '-', script.sections.length, 'sections');

console.log('[2/4] Generating audio...');
function stripContact(text) {
  return text
    .replace(/\b01[016789][-\s]?\d{3,4}[-\s]?\d{4}\b/g, '')
    .replace(/\b0\d{1,2}[-\s]?\d{3,4}[-\s]?\d{4}\b/g, '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}
const sentences = script.sections.flatMap(s => {
  const cleaned = stripContact(s.text);
  return cleaned.split(/(?<=[.!?。！？])\s*/).map(x => x.trim()).filter(Boolean);
});
const sentenceDurations = await generateAudioWithTimepoints(sentences, audioPath, 'ko-KR-Chirp3-HD-Aoede', 1.0);
console.log('Audio generated, sentences:', sentenceDurations.length);

console.log('[3/4] Resolving BGM...');
const bgmPath = await resolveBgmPath('upbeat');
console.log('BGM:', bgmPath);

console.log('[4/4] Generating video...');
await generateVideo(
  script, audioPath, videoPath, [],
  'shortsai.kr', sentenceDurations, 'ShortsAI',
  bgmPath ?? undefined, 'upbeat', 0.15, false,
);

console.log('Done!');
console.log('Video:', videoPath);
console.log('URL: https://shortsai.kr/videos/' + jobId + '.mp4');
