// ── 서버 전용 (Node.js fs/https 사용) ────────────────────────────────────────
// 클라이언트에서는 bgm-catalog.ts를 직접 import 하세요.
import fs from 'fs';
import path from 'path';
import https from 'https';
import http from 'http';
import { IncomingMessage } from 'http';

// 카탈로그·추천 로직은 클라이언트 공용 파일에서 가져옴
export type { BgmId, BgmTrack } from './bgm-catalog';
export { BGM_CATALOG, recommendBgm, getBgmTrack } from './bgm-catalog';
import { BgmId, getBgmTrack } from './bgm-catalog';

// ── 다운로드 헬퍼 (redirect 지원, timeout 30s) ───────────────────────────────
function downloadUrl(url: string, destPath: string, maxRedirects = 5): Promise<void> {
  return new Promise((resolve, reject) => {
    if (maxRedirects === 0) { reject(new Error('Too many redirects')); return; }

    const proto = url.startsWith('https') ? https : http;
    const file  = fs.createWriteStream(destPath);

    const cleanup = (err: Error) => {
      file.close();
      fs.unlink(destPath, () => {});
      reject(err);
    };

    const req = proto.get(url, (res: IncomingMessage) => {
      if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307 || res.statusCode === 308) {
        file.close();
        fs.unlink(destPath, () => {});
        const location = res.headers.location;
        if (!location) { reject(new Error('Redirect without Location header')); return; }
        downloadUrl(location, destPath, maxRedirects - 1).then(resolve).catch(reject);
        return;
      }
      if (res.statusCode && res.statusCode !== 200) {
        cleanup(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(); });
      file.on('error', cleanup);
    });

    req.on('error', cleanup);
    req.setTimeout(30_000, () => { req.destroy(); cleanup(new Error('Download timeout')); });
  });
}

// ── BGM 경로 해결 (캐시 우선, 없으면 다운로드) ─────────────────────────────
export async function resolveBgmPath(bgmId: BgmId): Promise<string | null> {
  if (bgmId === 'none') return null;

  const track = getBgmTrack(bgmId);
  if (!track?.url) return null;

  const bgmDir   = path.join(process.cwd(), 'data', 'bgm');
  if (!fs.existsSync(bgmDir)) fs.mkdirSync(bgmDir, { recursive: true });

  const localPath = path.join(bgmDir, track.filename);

  // 캐시 유효성 확인 (1 KB 이상이면 유효)
  if (fs.existsSync(localPath)) {
    const stat = fs.statSync(localPath);
    if (stat.size > 1024) {
      console.log(`[BGM] 캐시 사용: ${track.filename}`);
      return localPath;
    }
    fs.unlinkSync(localPath); // 불완전 파일 제거
  }

  console.log(`[BGM] 다운로드 중 "${track.label}": ${track.url}`);
  try {
    await downloadUrl(track.url, localPath);
    const stat = fs.statSync(localPath);
    if (stat.size < 1024) throw new Error('Downloaded file too small');
    console.log(`[BGM] 다운로드 완료: ${track.filename} (${(stat.size / 1024 / 1024).toFixed(1)} MB)`);
    return localPath;
  } catch (e) {
    console.warn(`[BGM] 다운로드 실패 "${track.id}":`, e);
    try { fs.unlinkSync(localPath); } catch { /* ignore */ }
    return null;
  }
}
