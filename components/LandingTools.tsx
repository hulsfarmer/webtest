'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

type Samples = {
  videos: Record<string, { videoUrl: string; posterUrl: string | null }>;
  logo: Record<string, string>;
};

const LOGO_STYLES = [
  { id: 'flat', name: '플랫' },
  { id: 'minimal', name: '미니멀' },
  { id: 'emblem', name: '엠블럼' },
  { id: 'mascot', name: '마스코트' },
  { id: 'lettermark', name: '레터마크' },
];

type Card = {
  key?: string; icon: string; name: string; desc: string;
  href?: string; kind?: 'video' | 'logo'; tag?: 'new' | 'soon';
};

const CARDS: Card[] = [
  { key: 'promo', icon: '🏪', name: '업체 홍보영상', desc: '가게·회사·농장·병원 등 사업장을 소개하는 세로 쇼츠.', href: '/studio/promo', kind: 'video' },
  { key: 'event', icon: '📅', name: '행사 홍보영상', desc: '축제·마켓·세일·오픈 등 이벤트를 긴급성 있게 알립니다.', href: '/studio/event', kind: 'video' },
  { key: 'product-vs', icon: '🎭', name: '제품 홍보영상 (캐릭터)', desc: '캐릭터가 제품을 직접 소개하는 세로 쇼츠.', href: '/studio/product-vs', kind: 'video' },
  { key: 'product-ai', icon: '⭐', name: '제품 홍보영상 (캐릭터2)', desc: '제품을 든 AI배우를 자동 생성해 20초로 말하게 하는 쇼츠.', href: '/studio/product-ai', kind: 'video', tag: 'new' },
  { key: 'logo', icon: '✦', name: '로고 생성', desc: '브랜드 이름만 넣으면, 바로 쓸 수 있는 로고가 완성됩니다.', href: '/studio/logo', kind: 'logo' },
];

const LOGO_BENEFITS = [
  { icon: '🎨', t: '5가지 스타일, 여러 버전', d: '플랫·미니멀·엠블럼·마스코트·레터마크 — 여러 시안을 뽑아 비교하고 고르세요.' },
  { icon: '🖼️', t: '원하는 느낌 그대로', d: '마음에 드는 로고 이미지를 올리면 그 스타일을 그대로 따라 만들어 드려요.' },
  { icon: '⬇️', t: '간판·인쇄까지 쓰는 고화질', d: 'PNG은 물론 SVG·AI(벡터)까지, 추가 비용 없이. 아무리 키워도 깨지지 않습니다.' },
];

export default function LandingTools() {
  const [s, setS] = useState<Samples | null>(null);

  useEffect(() => {
    let alive = true;
    fetch('/api/menu-samples').then((r) => (r.ok ? r.json() : null)).then((d) => { if (alive) setS(d); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  const renderCard = (t: Card) => {
    let media: React.ReactNode = null;
    if (t.kind === 'video' && t.key && s?.videos?.[t.key]?.videoUrl) {
      const v = s.videos[t.key];
      media = (
        <div className="sa-tool-media">
          <video src={v.videoUrl} poster={v.posterUrl || undefined} controls playsInline preload="metadata" />
        </div>
      );
    } else if (t.kind === 'logo' && s) {
      const imgs = LOGO_STYLES.map((st) => ({ ...st, url: s.logo?.[st.id] })).filter((x) => x.url);
      if (imgs.length > 0) {
        media = (
          <div className="sa-tool-logos">
            {imgs.map((x) => (
              <figure key={x.id}><img src={x.url} alt={x.name} loading="lazy" /><figcaption>{x.name}</figcaption></figure>
            ))}
          </div>
        );
      }
    }

    const head = (
      <>
        <div className="ic">{t.icon}</div>
        <h3>{t.name}{t.tag === 'new' && <span className="sa-tag new">NEW</span>}{t.tag === 'soon' && <span className="sa-tag soon">준비중</span>}</h3>
        <p>{t.desc}</p>
      </>
    );

    if (media) {
      return (
        <div key={t.name} className={`sa-tool has-media${t.kind === 'logo' ? ' is-logo' : ''}`}>
          {head}
          {media}
          {t.kind === 'logo' && (
            <>
              <ul className="sa-logo-benefits">
                {LOGO_BENEFITS.map((b) => (
                  <li key={b.t}><span className="bic">{b.icon}</span><div><b>{b.t}</b><span>{b.d}</span></div></li>
                ))}
              </ul>
              <div className="sa-logo-price">
                <b>로고 한 장 약 200원</b>
                <span>디자인 외주는 보통 수만 원 — 원하는 만큼 여러 버전을 부담 없이.</span>
              </div>
            </>
          )}
          {t.href && <Link className="sa-tool-cta" href={t.href}>만들어 보기 →</Link>}
        </div>
      );
    }
    if (t.href) return <Link key={t.name} className="sa-tool" href={t.href}>{head}</Link>;
    return <div key={t.name} className="sa-tool" aria-disabled="true">{head}</div>;
  };

  const videoCards = CARDS.filter((t) => t.kind === 'video');
  const designCards = CARDS.filter((t) => t.kind === 'logo');

  return (
    <div className="sa-tool-groups">
      <div className="sa-tool-group">
        <div className="sa-group-label"><span className="ic">🎨</span> 디자인</div>
        <div className="sa-tools">{designCards.map(renderCard)}</div>
      </div>
      <div className="sa-tool-group">
        <div className="sa-group-label"><span className="ic">🎬</span> 홍보영상 · 쇼츠</div>
        <div className="sa-tools">{videoCards.map(renderCard)}</div>
      </div>
    </div>
  );
}
