/**
 * 틱톡 연동 (본인 계정 드래프트 업로드).
 * OAuth 2.0 (video.upload) → refresh_token 을 서버 파일에 저장 → 업로드 시 access_token 갱신.
 * 완성 영상을 틱톡 앱 "드래프트/받은함(inbox)"으로 보내고, 사용자가 앱에서 캡션 확인 후 게시.
 * 자격증명: TIKTOK_CLIENT_KEY / TIKTOK_CLIENT_SECRET (.env.local)
 *
 * 참고: 틱톡 refresh_token 은 갱신할 때마다 새 값으로 회전(rotate)되므로 매번 저장해야 함.
 */
import fs from 'fs';
import path from 'path';

const TOKEN_PATH = path.join(process.cwd(), 'data', 'social', 'tiktok.json');
export const TT_REDIRECT_URI = 'https://shortsai.kr/api/social/tiktok/callback';
const SCOPE = 'video.upload';

type TokenFile = { refresh_token: string; open_id?: string; saved: number };

/** 동의 화면 URL (video.upload 스코프) */
export function getAuthUrl(state: string): string {
  const p = new URLSearchParams({
    client_key: process.env.TIKTOK_CLIENT_KEY || '',
    scope: SCOPE,
    response_type: 'code',
    redirect_uri: TT_REDIRECT_URI,
    state,
  });
  return `https://www.tiktok.com/v2/auth/authorize/?${p.toString()}`;
}

function saveToken(refresh_token: string, open_id?: string): void {
  fs.mkdirSync(path.dirname(TOKEN_PATH), { recursive: true });
  const prev = (() => { try { return JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8')) as TokenFile; } catch { return null; } })();
  fs.writeFileSync(TOKEN_PATH, JSON.stringify({ refresh_token, open_id: open_id || prev?.open_id, saved: Date.now() }));
}

/** code → refresh_token 저장 */
export async function exchangeCode(code: string): Promise<void> {
  const res = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_key: process.env.TIKTOK_CLIENT_KEY || '',
      client_secret: process.env.TIKTOK_CLIENT_SECRET || '',
      code,
      grant_type: 'authorization_code',
      redirect_uri: TT_REDIRECT_URI,
    }).toString(),
  });
  const d = await res.json() as { refresh_token?: string; open_id?: string; error?: string; error_description?: string };
  if (!res.ok || !d.refresh_token) throw new Error(`token exchange 실패: ${JSON.stringify(d).slice(0, 200)}`);
  saveToken(d.refresh_token, d.open_id);
}

export function isConnected(): boolean {
  try { return !!(JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8')) as TokenFile).refresh_token; } catch { return false; }
}

/** refresh_token 으로 access_token 갱신 (+ 회전된 새 refresh_token 저장) */
async function getAccessToken(): Promise<string> {
  const t = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8')) as TokenFile;
  const res = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_key: process.env.TIKTOK_CLIENT_KEY || '',
      client_secret: process.env.TIKTOK_CLIENT_SECRET || '',
      refresh_token: t.refresh_token,
      grant_type: 'refresh_token',
    }).toString(),
  });
  const d = await res.json() as { access_token?: string; refresh_token?: string; open_id?: string };
  if (!res.ok || !d.access_token) throw new Error(`access token 갱신 실패: ${JSON.stringify(d).slice(0, 200)}`);
  if (d.refresh_token) saveToken(d.refresh_token, d.open_id); // 회전 대응
  return d.access_token;
}

const MAX_SINGLE = 64 * 1024 * 1024; // 64MB 이하는 단일 청크
const CHUNK = 32 * 1024 * 1024;      // 다중 청크 기본 크기(마지막 청크가 나머지 흡수 → 최대 ~64MB, 틱톡 한도 내)

/**
 * 완성 영상을 내 틱톡 드래프트(받은함)로 업로드 → publish_id 반환.
 * FILE_UPLOAD 방식: init 로 upload_url 받고 → PUT 으로 바이트 전송(청크).
 * 사용자는 틱톡 앱 알림/드래프트에서 확인 후 게시.
 */
export async function uploadToInbox(filePath: string): Promise<string> {
  const token = await getAccessToken();
  const size = fs.statSync(filePath).size;
  // 64MB 이하면 단일 청크, 넘으면 32MB 청크(마지막 청크는 32~64MB로 나머지 흡수 → 틱톡 청크 한도 준수)
  const single = size <= MAX_SINGLE;
  const chunkSize = single ? size : CHUNK;
  const totalChunks = single ? 1 : Math.floor(size / CHUNK);

  // 1) init → upload_url
  const init = await fetch('https://open.tiktokapis.com/v2/post/publish/inbox/video/init/', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=UTF-8' },
    body: JSON.stringify({
      source_info: { source: 'FILE_UPLOAD', video_size: size, chunk_size: chunkSize, total_chunk_count: totalChunks },
    }),
  });
  const initJson = await init.json() as { data?: { publish_id?: string; upload_url?: string }; error?: { code?: string; message?: string } };
  if (!init.ok || !initJson.data?.upload_url || !initJson.data?.publish_id) {
    throw new Error(`TikTok init ${init.status}: ${JSON.stringify(initJson).slice(0, 200)}`);
  }
  const { upload_url, publish_id } = initJson.data;

  // 2) 바이트 업로드 (청크별 PUT, Content-Range 헤더)
  const fd = fs.openSync(filePath, 'r');
  try {
    for (let i = 0; i < totalChunks; i++) {
      const start = i * chunkSize;
      const end = i === totalChunks - 1 ? size - 1 : start + chunkSize - 1; // 마지막 청크가 나머지 흡수
      const len = end - start + 1;
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, start);
      const put = await fetch(upload_url, {
        method: 'PUT',
        headers: {
          'Content-Type': 'video/mp4',
          'Content-Length': String(len),
          'Content-Range': `bytes ${start}-${end}/${size}`,
        },
        body: buf,
      });
      if (!put.ok && put.status !== 201 && put.status !== 206) {
        throw new Error(`TikTok upload ${put.status}: ${(await put.text()).slice(0, 200)}`);
      }
    }
  } finally {
    fs.closeSync(fd);
  }

  return publish_id;
}
