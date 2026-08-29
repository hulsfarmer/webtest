// lib/replicate-seedance.ts
// Replicate bytedance/seedance-2.5 video generation (for hook-driven affiliate shorts).
//
// Validated pipeline rules:
//  - Use product/object images as reference_images for product consistency.
//  - Do NOT upload a person's face image (Replicate's ByteDance wrapper blocks it as E005 "sensitive").
//    Generate people from text, or frame on the product / lower body / motion instead.
//  - Default 480p ($0.103/s); use 720p ($0.231/s) only for the final publish cut.

const REPLICATE_API = 'https://api.replicate.com/v1';
const MODEL = 'bytedance/seedance-2.5';

export type SeedanceResolution = '480p' | '720p';
export type SeedanceRatio = '16:9' | '9:16' | '1:1' | '4:3' | '3:4' | '21:9';

export interface SeedanceInput {
  prompt: string;
  /** Product photos etc. (data URI or public URL). Never upload a human face. */
  referenceImages?: string[];
  /** seconds, default 8 */
  duration?: number;
  /** default 480p */
  resolution?: SeedanceResolution;
  /** default 9:16 */
  aspectRatio?: SeedanceRatio;
  /** native audio generation (default false — music is composited separately via musicgen) */
  generateAudio?: boolean;
}

function token(): string {
  const t = process.env.REPLICATE_API_TOKEN;
  if (!t) throw new Error('REPLICATE_API_TOKEN 환경변수가 설정되지 않았습니다.');
  return t;
}

// Replicate responses occasionally contain raw control characters that break JSON.parse.
// Strip control chars except tab (\x09), newline (\x0A), CR (\x0D) before parsing.
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

/** Content-filter (E005) block — lets callers strip faces / adjust framing and retry. */
export class SeedanceSensitiveError extends Error {
  constructor(msg = 'Seedance 콘텐츠 필터에 차단됨 (얼굴 업로드/노출 제거 필요)') {
    super(msg);
    this.name = 'SeedanceSensitiveError';
  }
}

/** Generate a single Seedance clip → returns the output mp4 URL. Throws on failure. */
export async function generateSeedanceClip(
  input: SeedanceInput,
  opts: { pollMs?: number; maxPolls?: number } = {}
): Promise<string> {
  const body = {
    input: {
      prompt: input.prompt,
      duration: input.duration ?? 8,
      resolution: input.resolution ?? '480p',
      aspect_ratio: input.aspectRatio ?? '9:16',
      generate_audio: input.generateAudio ?? false,
      output_format: 'mp4',
      ...(input.referenceImages?.length ? { reference_images: input.referenceImages } : {}),
    },
  };

  const created = await api<Prediction>(`/models/${MODEL}/predictions`, {
    method: 'POST',
    body: JSON.stringify(body),
  });

  const pollMs = opts.pollMs ?? 5000;
  const maxPolls = opts.maxPolls ?? 150; // ~12.5 min
  for (let i = 0; i < maxPolls; i++) {
    await new Promise((r) => setTimeout(r, pollMs));
    const p = await api<Prediction>(`/predictions/${created.id}`);
    if (p.status === 'succeeded') {
      const url =
        typeof p.output === 'string' ? p.output : Array.isArray(p.output) ? p.output[0] : null;
      if (!url) throw new Error('Seedance 성공했으나 출력 URL이 없습니다.');
      return url;
    }
    if (p.status === 'failed' || p.status === 'canceled') {
      const err = String(p.error || '');
      if (err.includes('E005') || err.toLowerCase().includes('sensitive')) {
        throw new SeedanceSensitiveError();
      }
      throw new Error(`Seedance 생성 실패: ${err.slice(0, 200)}`);
    }
  }
  throw new Error('Seedance 생성 타임아웃');
}

/** Download the result URL into a Buffer. */
export async function downloadToBuffer(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`영상 다운로드 실패 ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/** Per-second price (USD) — for cost display / spend guard. */
export const SEEDANCE_USD_PER_SEC: Record<SeedanceResolution, number> = {
  '480p': 0.1028,
  '720p': 0.231,
};

/** Estimated USD cost for a set of clips. */
export function estimateSeedanceCost(
  clips: { duration: number; resolution: SeedanceResolution }[]
): number {
  return clips.reduce((sum, c) => sum + c.duration * SEEDANCE_USD_PER_SEC[c.resolution], 0);
}
