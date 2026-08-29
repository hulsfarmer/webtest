// lib/musicgen.ts
// Replicate meta/musicgen 배경음악 생성 (후킹형 제휴 쇼츠용).
// musicgen 은 model-path 예측이 404 나므로 반드시 version 엔드포인트로 호출한다.

import { downloadToBuffer } from './replicate-seedance';

const REPLICATE_API = 'https://api.replicate.com/v1';

function token(): string {
  const t = process.env.REPLICATE_API_TOKEN;
  if (!t) throw new Error('REPLICATE_API_TOKEN 환경변수가 설정되지 않았습니다.');
  return t;
}

// 응답에 섞이는 제어문자(탭/개행/CR 제외) 제거 후 파싱.
const CONTROL_CHARS = new RegExp('[\\x00-\\x08\\x0B\\x0C\\x0E-\\x1F]', 'g');
function safeJson<T = unknown>(text: string): T {
  return JSON.parse(text.replace(CONTROL_CHARS, '')) as T;
}

async function api<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${REPLICATE_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token()}`,
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Replicate ${res.status}: ${text.slice(0, 300)}`);
  return safeJson<T>(text);
}

interface Prediction {
  id: string;
  status: 'starting' | 'processing' | 'succeeded' | 'failed' | 'canceled';
  output?: string | string[] | null;
  error?: string | null;
}

export interface MusicInput {
  prompt: string;
  /** seconds, default 17 (~15s ad + tail) */
  duration?: number;
}

/** 배경음악 생성 → mp3 URL 반환. */
export async function generateMusic(
  input: MusicInput,
  opts: { pollMs?: number; maxPolls?: number } = {}
): Promise<string> {
  // 최신 버전 id 조회 (버전이 바뀌어도 동작하도록 동적 조회)
  const model = await api<{ latest_version?: { id?: string } }>('/models/meta/musicgen');
  const versionId = model.latest_version?.id;
  if (!versionId) throw new Error('musicgen 최신 버전 id를 찾을 수 없습니다.');

  const created = await api<Prediction>('/predictions', {
    method: 'POST',
    body: JSON.stringify({
      version: versionId,
      input: {
        prompt: input.prompt,
        duration: input.duration ?? 17,
        model_version: 'stereo-large',
        output_format: 'mp3',
        normalization_strategy: 'peak',
      },
    }),
  });

  const pollMs = opts.pollMs ?? 5000;
  const maxPolls = opts.maxPolls ?? 90; // ~7.5 min
  for (let i = 0; i < maxPolls; i++) {
    await new Promise((r) => setTimeout(r, pollMs));
    const p = await api<Prediction>(`/predictions/${created.id}`);
    if (p.status === 'succeeded') {
      const url =
        typeof p.output === 'string' ? p.output : Array.isArray(p.output) ? p.output[0] : null;
      if (!url) throw new Error('musicgen 성공했으나 출력 URL이 없습니다.');
      return url;
    }
    if (p.status === 'failed' || p.status === 'canceled') {
      throw new Error(`음악 생성 실패: ${String(p.error || '').slice(0, 200)}`);
    }
  }
  throw new Error('음악 생성 타임아웃');
}

/** 톤별 프롬프트 프리셋 (후킹형 광고용). */
export const MUSIC_PRESETS: Record<string, string> = {
  energetic:
    'Energetic upbeat commercial music, driving beat, punchy drums, bright motivating synths, high energy, dense and full, radio-ready, no vocals.',
  calm:
    'Calm warm premium ambient background music, soft piano and gentle strings, clean and soothing, uplifting, no drums, no vocals.',
  cinematic:
    'Cinematic inspiring commercial score, warm strings and piano building to a hopeful swell, premium and emotional, no vocals.',
};

export async function generateMusicByTone(
  tone: keyof typeof MUSIC_PRESETS | string,
  duration?: number
): Promise<string> {
  const prompt = MUSIC_PRESETS[tone] || MUSIC_PRESETS.energetic;
  return generateMusic({ prompt, duration });
}

export { downloadToBuffer };
