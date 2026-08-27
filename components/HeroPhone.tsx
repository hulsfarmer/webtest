'use client';

import { useEffect, useState } from 'react';

// 히어로 폰 화면 — 관리자 지정 '업체 홍보영상' 샘플의 포스터 이미지를 보여준다.
// 지정 전이면 기존 CSS 목업으로 폴백.
export default function HeroPhone() {
  const [poster, setPoster] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch('/api/menu-samples')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!alive || !d) return;
        const v = d.videos || {};
        const p = v.promo?.posterUrl || v.event?.posterUrl || v['product-vs']?.posterUrl || v['product-ai']?.posterUrl || null;
        setPoster(p);
      })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  if (poster) {
    return (
      <div className="sa-screen">
        <img className="sa-screen-img" src={poster} alt="홍보영상 샘플" />
      </div>
    );
  }

  // 폴백: 기존 목업
  return (
    <div className="sa-screen">
      <div className="sa-photo" />
      <div className="sa-shdr"><small>연남동 감성카페</small><b>매일 아침, 향긋한 한 잔</b></div>
      <div className="sa-cap-area">
        <div className="c">직접 로스팅한 <i>원두</i></div>
        <div className="c">오션뷰 <i>창가 자리</i></div>
        <div className="c">지금 <i>방문하세요</i></div>
      </div>
      <div className="sa-prog"><i /></div>
    </div>
  );
}
