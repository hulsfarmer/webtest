'use client';

import { useEffect, useState } from 'react';

type Video = { videoUrl: string; posterUrl: string | null; businessName?: string; businessType?: string };

const FALLBACK = ['향긋한 한 잔', '이번 주말 오픈', '무설탕 바삭함', '제주 노을 명당', '첫 방문 20% 할인', '매일 아침 갓 구운'];

export default function ShowcaseStrip() {
  const [videos, setVideos] = useState<Video[] | null>(null);

  useEffect(() => {
    let alive = true;
    fetch('/api/showcase')
      .then((r) => (r.ok ? r.json() : { videos: [] }))
      .then((d) => { if (alive) setVideos((d.videos || []).filter((v: Video) => v.videoUrl)); })
      .catch(() => { if (alive) setVideos([]); });
    return () => { alive = false; };
  }, []);

  // 실제 쇼케이스 영상이 있으면 재생 가능한 그리드
  if (videos && videos.length > 0) {
    return (
      <div className="sa-wrap">
        <div className="sa-showgrid">
          {videos.slice(0, 6).map((v, i) => (
            <div className="cell" key={i}>
              <video src={v.videoUrl} poster={v.posterUrl || undefined} controls playsInline preload="metadata" />
              {v.businessName && <div className="cap">{v.businessName}{v.businessType ? ` · ${v.businessType}` : ''}</div>}
            </div>
          ))}
        </div>
      </div>
    );
  }

  // 없거나 로딩 중이면 정적 마퀴 (기존 디자인)
  return (
    <div className="sa-marquee">
      <div className="sa-track">
        {[...FALLBACK, ...FALLBACK].map((s, i) => (
          <div className="sa-shot" key={i}><div className="bd" /><div className="pl">▶</div><div className="cp">{s}</div></div>
        ))}
      </div>
    </div>
  );
}
