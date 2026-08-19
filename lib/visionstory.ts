/**
 * VisionStory OpenAPI 클라이언트 — "제품 홍보영상"(신규, V-Character) 엔진.
 * Hedra(lib/hedra.ts)와 동일한 역할: 캐릭터 이미지 + 대본 → 말하는 캐릭터 영상.
 * 차이: VisionStory가 내부에서 TTS(한국어 Gemini 음성)까지 처리 → 우리 오디오 대신 text_script 전달.
 * 자막은 반환 영상 오디오를 STT로 정렬(lib/promo-subtitles)해 별도로 얹는다.
 *
 * 인증: 헤더 X-API-Key = env VISIONSTORY_API_KEY (Pro 계정 필요, 크레딧 소비)
 * 문서 스펙의 .cn 베이스는 계정에 따라 401 → .ai 베이스 사용.
 */
const BASE = 'https://openapi.visionstory.ai/api/v1';

function apiKey(): string {
  const k = process.env.VISIONSTORY_API_KEY;
  if (!k) throw new Error('VISIONSTORY_API_KEY 가 설정되지 않았습니다.');
  return k;
}

function headers(json = true): Record<string, string> {
  const h: Record<string, string> = { 'X-API-Key': apiKey() };
  if (json) h['Content-Type'] = 'application/json';
  return h;
}

/** 이미지(버퍼)로 커스텀 아바타 생성 → avatar_id. inline base64 전송. */
export async function createVisionStoryAvatar(buf: Buffer, mime = 'image/png'): Promise<string> {
  const body = JSON.stringify({ inline_data: { mime_type: mime, data: buf.toString('base64') } });
  const res = await fetch(`${BASE}/avatar`, { method: 'POST', headers: headers(), body });
  const text = await res.text();
  if (!res.ok) throw new Error(`VisionStory 아바타 생성 실패 (${res.status}): ${text}`);
  const d = JSON.parse(text);
  const id = d?.data?.avatar_id;
  if (!id) throw new Error(`VisionStory 아바타 응답에 avatar_id 없음: ${text}`);
  return String(id);
}

/** 영상 생성 요청(텍스트→내부 TTS→립싱크) → video_id. */
export async function submitVisionStoryVideo(opts: {
  avatarId: string;
  audioBuf?: Buffer;         // 있으면 우리 오디오로 립싱크(audio_script, voice_change off)
  text?: string;             // audioBuf 없을 때 내부 TTS(text_script)
  voiceId?: string;
  model?: string;            // vs_character_v4(기본) | vs_talk_v1
  aspectRatio?: '9:16' | '16:9' | '1:1';
  resolution?: '480p' | '720p' | '1080p';
  emotion?: 'cheerful' | 'angry' | 'marketing' | 'news' | 'singing';
}): Promise<string> {
  const payload: Record<string, unknown> = {
    model_id: opts.model || 'vs_character_v4',
    avatar_id: opts.avatarId,
    aspect_ratio: opts.aspectRatio || '9:16',
    resolution: opts.resolution || '720p', // Pro 플랜 상한 720p
    emotion: opts.emotion || 'cheerful',
  };
  if (opts.audioBuf) {
    // 우리가 만든 Gemini 나레이션을 그대로 립싱크 (목소리 재합성 안 함)
    payload.audio_script = { inline_data: { mime_type: 'audio/mpeg', data: opts.audioBuf.toString('base64') }, voice_change: false };
  } else {
    payload.text_script = { text: opts.text || '', voice_id: opts.voiceId || 'Aoede' };
  }
  const body = JSON.stringify(payload);
  const res = await fetch(`${BASE}/video`, { method: 'POST', headers: headers(), body });
  const text = await res.text();
  if (!res.ok) throw new Error(`VisionStory 영상 요청 실패 (${res.status}): ${text}`);
  const d = JSON.parse(text);
  const id = d?.data?.video_id;
  if (!id) throw new Error(`VisionStory 영상 응답에 video_id 없음: ${text}`);
  return String(id);
}

/** 완료까지 폴링 후 결과 영상 버퍼 반환. VisionStory는 보통 수분 내 완료. */
export async function pollVisionStoryVideo(
  videoId: string,
  onStatus?: (status: string, costCredit?: number) => void,
  maxTries = 120, // 6초 × 120 = 12분
): Promise<Buffer> {
  for (let i = 0; i < maxTries; i++) {
    await new Promise((s) => setTimeout(s, 6000));
    const res = await fetch(`${BASE}/video?video_id=${encodeURIComponent(videoId)}`, { headers: headers(false) });
    const text = await res.text();
    if (!res.ok) { onStatus?.(`http_${res.status}`); continue; }
    const d = JSON.parse(text)?.data || {};
    const status = String(d.status || '');
    if (status === 'created' || status === 'completed' || status === 'success') {
      const url = d.video_url;
      if (!url) throw new Error('VisionStory 완료됐으나 video_url 없음');
      onStatus?.(status, d.cost_credit);
      const vid = await fetch(url).then((r) => r.arrayBuffer());
      return Buffer.from(vid);
    }
    if (status === 'failed' || status === 'error') throw new Error(`VisionStory 생성 실패: ${text}`);
    onStatus?.(status);
  }
  throw new Error('VisionStory 생성 타임아웃');
}
