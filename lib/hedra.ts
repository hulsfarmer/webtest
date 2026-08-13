/**
 * Hedra v3 API client — "말하는 캐릭터" 모드용.
 * Kling Avatar v2 (kling-ai-avatar-v2) 를 Hedra 호스팅으로 호출한다.
 * 인증: Authorization: Key <key_id>:<secret>  (HEDRA_API_KEY 에 전체 문자열)
 */
const BASE = 'https://api.hedra.com/v3';

function authHeader(): Record<string, string> {
  const key = process.env.HEDRA_API_KEY;
  if (!key) throw new Error('HEDRA_API_KEY 가 설정되지 않았습니다.');
  return { Authorization: `Key ${key}` };
}

/** 파일 업로드 (무료). 반환된 url 은 1시간 유효, 모델 input 에 그대로 전달. */
export async function uploadToHedra(buf: Buffer, filename: string, contentType: string): Promise<string> {
  const fd = new FormData();
  fd.append('file', new Blob([new Uint8Array(buf)], { type: contentType }), filename);
  const res = await fetch(`${BASE}/files`, { method: 'POST', headers: authHeader(), body: fd });
  const text = await res.text();
  if (!res.ok) throw new Error(`Hedra 파일 업로드 실패 (${res.status}): ${text}`);
  return JSON.parse(text).url as string;
}

/** Kling Avatar v2 생성 요청 → job_id 반환. */
export async function submitKlingAvatar(opts: {
  imageUrl: string;
  audioUrl: string;
  aspectRatio?: '9:16' | '16:9' | '1:1';
  prompt?: string;
}): Promise<string> {
  const body = {
    input: {
      start_image: { source: 'url', url: opts.imageUrl },
      audio: { source: 'url', url: opts.audioUrl },
      prompt: opts.prompt || 'A person speaking naturally to the camera with accurate mouth movements',
      aspect_ratio: opts.aspectRatio || '9:16',
      resolution: '720p',
      quality: 'standard',
    },
  };
  const res = await fetch(`${BASE}/models/kling-ai-avatar-v2`, {
    method: 'POST',
    headers: { ...authHeader(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Kling 생성 요청 실패 (${res.status}): ${text}`);
  return JSON.parse(text).job_id as string;
}

/** 완료까지 폴링 후 결과 영상 버퍼 반환. */
export async function pollHedraVideo(
  jobId: string,
  onStatus?: (status: string, cost?: number) => void,
  maxTries = 360, // 6초 × 360 = 36분 (Kling 은 긴 영상일수록 오래 걸림)
): Promise<Buffer> {
  for (let i = 0; i < maxTries; i++) {
    await new Promise((s) => setTimeout(s, 6000));
    const res = await fetch(`${BASE}/jobs/${jobId}`, { headers: authHeader() });
    const job = await res.json();
    if (job.status === 'COMPLETED') {
      const url = (job.outputs || []).find((o: { url?: string }) => o.url)?.url;
      if (!url) throw new Error('완료됐으나 출력 URL 이 없습니다.');
      const vid = await fetch(url).then((r) => r.arrayBuffer());
      onStatus?.('COMPLETED', job.cost);
      return Buffer.from(vid);
    }
    if (job.status === 'FAILED') throw new Error(`Hedra 생성 실패: ${JSON.stringify(job.error)}`);
    onStatus?.(job.status);
  }
  throw new Error('Hedra 생성 타임아웃');
}
