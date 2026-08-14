/**
 * YouTube 연동 (본인 채널 자동 업로드).
 * OAuth 2.0 (offline) → refresh_token 을 서버 파일에 저장 → 업로드 시 access_token 갱신.
 * 자격증명: YOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET (.env.local)
 */
import fs from 'fs';
import path from 'path';

const TOKEN_PATH = path.join(process.cwd(), 'data', 'social', 'youtube.json');
export const YT_REDIRECT_URI = 'https://shortsai.kr/api/social/youtube/callback';
const SCOPE = 'https://www.googleapis.com/auth/youtube.upload';

/** 동의 화면 URL (offline + consent 로 refresh_token 확보) */
export function getAuthUrl(state: string): string {
  const p = new URLSearchParams({
    client_id: process.env.YOUTUBE_CLIENT_ID || '',
    redirect_uri: YT_REDIRECT_URI,
    response_type: 'code',
    scope: SCOPE,
    access_type: 'offline',
    prompt: 'consent',
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p.toString()}`;
}

/** code → refresh_token 저장 */
export async function exchangeCode(code: string): Promise<void> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: process.env.YOUTUBE_CLIENT_ID || '',
      client_secret: process.env.YOUTUBE_CLIENT_SECRET || '',
      redirect_uri: YT_REDIRECT_URI,
      grant_type: 'authorization_code',
    }).toString(),
  });
  const d = await res.json() as { refresh_token?: string; error?: string };
  if (!res.ok || !d.refresh_token) throw new Error(`token exchange 실패: ${JSON.stringify(d).slice(0, 200)}`);
  fs.mkdirSync(path.dirname(TOKEN_PATH), { recursive: true });
  fs.writeFileSync(TOKEN_PATH, JSON.stringify({ refresh_token: d.refresh_token, saved: Date.now() }));
}

export function isConnected(): boolean {
  try { return !!JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8')).refresh_token; } catch { return false; }
}

async function getAccessToken(): Promise<string> {
  const t = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8')) as { refresh_token: string };
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.YOUTUBE_CLIENT_ID || '',
      client_secret: process.env.YOUTUBE_CLIENT_SECRET || '',
      refresh_token: t.refresh_token,
      grant_type: 'refresh_token',
    }).toString(),
  });
  const d = await res.json() as { access_token?: string };
  if (!res.ok || !d.access_token) throw new Error(`access token 갱신 실패: ${JSON.stringify(d).slice(0, 200)}`);
  return d.access_token;
}

/** 영상 업로드(resumable) → videoId 반환 */
export async function uploadVideo(
  filePath: string,
  opts: { title: string; description: string; tags?: string[]; privacyStatus?: 'public' | 'unlisted' | 'private' },
): Promise<string> {
  const token = await getAccessToken();
  const size = fs.statSync(filePath).size;
  const meta = {
    snippet: {
      title: (opts.title || '무제').slice(0, 100),
      description: (opts.description || '').slice(0, 4900),
      tags: (opts.tags || []).slice(0, 15),
      categoryId: '22',
    },
    status: { privacyStatus: opts.privacyStatus || 'private', selfDeclaredMadeForKids: false },
  };
  // 1) resumable 세션 시작
  const init = await fetch('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': 'video/mp4',
      'X-Upload-Content-Length': String(size),
    },
    body: JSON.stringify(meta),
  });
  if (!init.ok) throw new Error(`YouTube init ${init.status}: ${(await init.text()).slice(0, 200)}`);
  const uploadUrl = init.headers.get('location');
  if (!uploadUrl) throw new Error('YouTube: 업로드 URL 없음');
  // 2) 바이트 업로드
  const body = fs.readFileSync(filePath);
  const up = await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Type': 'video/mp4', 'Content-Length': String(size) }, body });
  const r = await up.json() as { id?: string };
  if (!up.ok || !r.id) throw new Error(`YouTube upload ${up.status}: ${JSON.stringify(r).slice(0, 200)}`);
  return r.id;
}
