'use client';

import { useEffect, useState } from 'react';

type Samples = {
  videos: Record<string, { videoUrl: string; posterUrl: string | null; businessName?: string }>;
  logo: Record<string, string>;
  banner?: Record<string, string>;
};
const LOGO_STYLES = [
  { id: 'flat', name: '플랫 일러스트' },
  { id: 'minimal', name: '미니멀/기하학' },
  { id: 'emblem', name: '엠블럼/뱃지' },
  { id: 'mascot', name: '마스코트' },
  { id: 'lettermark', name: '레터마크(이니셜)' },
];
const BANNER_STYLES = [
  { id: 'left', name: '좌측 미니멀' },
  { id: 'center', name: '센터 임팩트' },
  { id: 'colorblock', name: '컬러 블록' },
  { id: 'bigtype', name: '빅 타이포' },
  { id: 'split', name: '대각 스플릿' },
  { id: 'glass', name: '글래스 카드' },
];

// 스튜디오 메뉴 페이지 상단의 접이식 '예시 보기' 바 (기본 접힘).
export default function MenuSample({ menuKey }: { menuKey: string }) {
  const [s, setS] = useState<Samples | null>(null);
  const isLogo = menuKey === 'logo';
  const isBanner = menuKey === 'banner';
  const [open, setOpen] = useState(isLogo || isBanner); // 로고·배너는 기본 펼침, 영상 메뉴는 접힘

  useEffect(() => {
    let alive = true;
    fetch('/api/menu-samples').then((r) => (r.ok ? r.json() : null)).then((d) => { if (alive) setS(d); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  if (!s) return null;

  const logoImgs = isLogo ? LOGO_STYLES.map((st) => ({ ...st, url: s.logo?.[st.id] })).filter((x) => x.url) : [];
  const bannerImgs = isBanner ? BANNER_STYLES.map((st) => ({ ...st, url: s.banner?.[st.id] })).filter((x) => x.url) : [];
  const video = !isLogo && !isBanner ? s.videos?.[menuKey] : null;

  // 지정된 샘플이 없으면 바 자체를 숨김
  if (isLogo ? logoImgs.length === 0 : isBanner ? bannerImgs.length === 0 : !video?.videoUrl) return null;

  const label = isLogo ? '예시 스타일 보기' : isBanner ? '예시 배너 보기' : '예시 영상 보기';
  const icon = isLogo ? '🎨' : isBanner ? '🖼️' : '🎬';

  return (
    <div className={`msample${open ? ' open' : ''}`}>
      <button className="msample-toggle" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span>{icon} {label}</span>
        <span className="chev">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="msample-body">
          {isLogo ? (
            <div className="msample-logos">
              {logoImgs.map((x) => (
                <figure key={x.id}><img src={x.url} alt={x.name} loading="lazy" /><figcaption>{x.name}</figcaption></figure>
              ))}
            </div>
          ) : isBanner ? (
            <div className="msample-banners">
              {bannerImgs.map((x) => (
                <figure key={x.id}><img src={x.url} alt={x.name} loading="lazy" /><figcaption>{x.name}</figcaption></figure>
              ))}
            </div>
          ) : (
            <div className="msample-video">
              <video src={video!.videoUrl} poster={video!.posterUrl || undefined} controls playsInline preload="metadata" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
