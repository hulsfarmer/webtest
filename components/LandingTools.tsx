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
  { key: 'logo', icon: '✦', name: '로고 생성', desc: '브랜드 이름과 분위기만으로 로고 시안 제작·다운로드. 5가지 스타일.', href: '/studio/logo', kind: 'logo' },
];

export default function LandingTools() {
  const [s, setS] = useState<Samples | null>(null);

  useEffect(() => {
    let alive = true;
    fetch('/api/menu-samples').then((r) => (r.ok ? r.json() : null)).then((d) => { if (alive) setS(d); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  return (
    <div className="sa-tools">
      {CARDS.map((t) => {
        // 샘플 미디어
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

        // 샘플이 있으면: 카드=div(미디어 재생 가능) + 하단 CTA 링크
        if (media) {
          return (
            <div key={t.name} className="sa-tool has-media">
              {head}
              {media}
              {t.href && <Link className="sa-tool-cta" href={t.href}>만들어 보기 →</Link>}
            </div>
          );
        }
        // 샘플 없음: 기존처럼 전체가 링크(또는 준비중 비활성)
        if (t.href) return <Link key={t.name} className="sa-tool" href={t.href}>{head}</Link>;
        return <div key={t.name} className="sa-tool" aria-disabled="true">{head}</div>;
      })}
    </div>
  );
}
