/**
 * Gemini TTS (google generativelanguage) — 제품 홍보영상(신규) 나레이션 음성.
 * VisionStory 내부 TTS(text_script) 대신 우리가 직접 Gemini 음성을 만들어
 * "밝은 광고 톤" 스타일 지시까지 얹은 뒤 VisionStory 에 audio_script 로 넘겨 립싱크시킨다.
 * 캐릭터 없는 구간은 이 오디오를 화면에 그대로 얹어 재활용(추후 구간 기능).
 *
 * 인증: env GEMINI_API_KEY (로고 메이커와 공유, pay-as-you-go). 아주 저렴.
 * 출력: mp3 (VisionStory audio_script 는 audio/mpeg 허용).
 */
import fs from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
const MODEL = 'gemini-2.5-flash-preview-tts';

// 페르소나 id → Gemini 기본 음성 + 스타일 지시.
// Gemini 프리빌트 음성은 성인 음성뿐이라 청소년/아이/강아지는 스타일 프롬프트로 근사(추후 튜닝).
export const VS_VOICE_MAP: Record<string, { voice: string; style: string }> = {
  aoede:  { voice: 'Aoede',  style: '밝고 활기찬 광고 내레이션 톤으로 신나게 말해줘' },
  leda:   { voice: 'Leda',   style: '발랄하고 경쾌한 광고 톤으로 말해줘' },
  charon: { voice: 'Charon', style: '신뢰감 있고 차분한 남성 광고 톤으로 말해줘' },
  puck:   { voice: 'Puck',   style: '밝고 힘찬 남성 광고 톤으로 말해줘' },
  teen:   { voice: 'Puck',       style: '밝고 풋풋한 청소년 톤으로 말해줘' },
  child:  { voice: 'Leda',       style: '아주 어리고 귀여운 다섯 살 아이처럼 최대한 높고 밝게 애교 부리며 말해줘' },
  puppy:  { voice: 'Callirrhoe', style: '아주 어리고 귀여운 다섯 살 아이처럼 최대한 높고 밝게 애교 부리며 말해줘' },
};

/** 페르소나 id로 Gemini 음성 나레이션(mp3) 생성. */
export async function generateGeminiAudio(text: string, personaId: string, outMp3: string): Promise<void> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY 가 설정되지 않았습니다.');
  const cfg = VS_VOICE_MAP[personaId] || VS_VOICE_MAP.aoede;
  const prompt = `${cfg.style}: ${text}`;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${key}`;
  const body = JSON.stringify({
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      responseModalities: ['AUDIO'],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: cfg.voice } } },
    },
  });
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  const txt = await res.text();
  if (!res.ok) throw new Error(`Gemini TTS 실패 (${res.status}): ${txt.slice(0, 300)}`);
  const d = JSON.parse(txt);
  const parts = d?.candidates?.[0]?.content?.parts || [];
  const inline = parts.map((p: { inlineData?: { data?: string; mimeType?: string } }) => p.inlineData).find((x: unknown) => x && (x as { data?: string }).data);
  if (!inline?.data) throw new Error(`Gemini TTS 응답에 오디오 없음: ${txt.slice(0, 200)}`);
  const pcm = Buffer.from(inline.data, 'base64');
  const rate = (/rate=(\d+)/.exec(inline.mimeType || '') || [])[1] || '24000';
  const rawPath = outMp3 + '.pcm';
  fs.writeFileSync(rawPath, pcm);
  const ffmpeg = require('ffmpeg-static') as string;
  // Gemini PCM = 16-bit LE, mono, rate(보통 24000)
  await execAsync(`"${ffmpeg}" -y -loglevel error -f s16le -ar ${rate} -ac 1 -i "${rawPath}" -ar 44100 -ac 1 -b:a 128k "${outMp3}"`);
  try { fs.unlinkSync(rawPath); } catch { /* noop */ }
}
