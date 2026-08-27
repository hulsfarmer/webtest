'use client';

import { useEffect, useState } from 'react';

type Samples = {
  videos: Record<string, { videoUrl: string; posterUrl: string | null; businessName?: string }>;
  logo: Record<string, string>;
};
const LOGO_STYLES = [
  { id: 'flat', name: '플랫 일러스트' },
  { id: 'minimal', name: '미니멀/기하학' },
  { id: 'emblem', name: '엠블럼/뱃지' },
  { id: 'mascot', name: '마스코트' },
  { id: 'lettermark', name: '레터마크(이니셜)' },
];

// 스튜디오 메뉴 페이지 상단에 관리자 지정 샘플(영상 또는 로고 5스타일)을 보여준다.
export default function MenuSample({ menuKey }: { menuKey: string }) {
  const [s, setS] = useState<Samples | null>(null);

  useEffect(() => {
    let alive = true;
    fetch('/api/menu-samples').then((r) => (r.ok ? r.json() : null)).then((d) => { if (alive) setS(d); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  if (!s) return null;

  if (menuKey === 'logo') {
    const imgs = LOGO_STYLES.map((st) => ({ ...st, url: s.logo?.[st.id] })).filter((x) => x.url);
    if (imgs.length === 0) return null;
    return (
      <div className="msample">
        <div className="msample-head">이런 스타일로 만들어져요 <span>· 샘플</span></div>
        <div className="msample-logos">
          {imgs.map((x) => (
            <figure key={x.id}><img src={x.url} alt={x.name} loading="lazy" /><figcaption>{x.name}</figcaption></figure>
          ))}
        </div>
      </div>
    );
  }

  const v = s.videos?.[menuKey];
  if (!v?.videoUrl) return null;
  return (
    <div className="msample">
      <div className="msample-head">이렇게 만들어져요 <span>· 샘플</span></div>
      <div className="msample-video">
        <video src={v.videoUrl} poster={v.posterUrl || undefined} controls playsInline preload="metadata" />
      </div>
    </div>
  );
}
