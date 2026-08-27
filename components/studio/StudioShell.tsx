'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSession, signOut } from 'next-auth/react';
import ThemeToggle from '@/components/ThemeToggle';

type Usage = { plan: string; used: number; limit: number | null; remaining: number | null; credits: number; claimable?: boolean; firstFreeClaim?: boolean };

type Item = {
  id: string; name: string; icon: string; href: string;
  external?: boolean; badge?: 'new' | 'soon'; adminOnly?: boolean; cost?: string;
};

const ICONS: Record<string, string> = {
  store: '<path d="M4 9h16l-1-4H5L4 9Z"/><path d="M4 9v10h16V9"/><path d="M9 19v-6h6v6"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M3 10h18M8 2v4M16 2v4"/>',
  box: '<path d="M21 8l-9-5-9 5 9 5 9-5Z"/><path d="M3 8v8l9 5 9-5V8"/><path d="M12 13v8"/>',
  sparkle: '<path d="M12 3l1.8 4.7L18.5 9l-4.7 1.8L12 15.5l-1.8-4.7L5.5 9l4.7-1.3L12 3Z"/>',
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z"/><path d="M14 3v5h5"/>',
  youtube: '<rect x="3" y="6" width="18" height="12" rx="3"/><path d="M10 9.5l5 2.5-5 2.5v-5Z"/>',
  library: '<rect x="3" y="4" width="6" height="16" rx="1"/><rect x="10" y="4" width="6" height="16" rx="1"/><path d="M18 5l3 15"/>',
  card: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/>',
  home: '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/>',
};

const CREATE: Item[] = [
  { id: 'promo', name: '업체 홍보영상', icon: 'store', href: '/studio/promo', cost: '1C' },
  { id: 'event', name: '행사 홍보영상', icon: 'calendar', href: '/studio/event', cost: '1C' },
  { id: 'product-vs', name: '제품 홍보영상 (캐릭터)', icon: 'box', href: '/studio/product-vs', cost: '4C~' },
  { id: 'product-ai', name: '제품 홍보영상 (캐릭터2) ⭐', icon: 'box', href: '/studio/product-ai', cost: '15C' },
  { id: 'logo', name: '로고 생성', icon: 'sparkle', href: '/studio/logo', cost: '1C' },
  { id: 'convert', name: '파일 변환', icon: 'file', href: '/studio/convert', badge: 'soon', adminOnly: true },
  { id: 'youtube', name: '유튜브 디자인', icon: 'youtube', href: '/studio/youtube', adminOnly: true },
];
const WORK: Item[] = [
  { id: 'library', name: '내 라이브러리', icon: 'library', href: '/studio/library' },
  { id: 'billing', name: '결제 · 이용권', icon: 'card', href: '/studio/billing' },
];

function Icon({ name }: { name: string }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" dangerouslySetInnerHTML={{ __html: ICONS[name] || '' }} />
  );
}

const Chevron = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M15 6l-6 6 6 6" /></svg>
);
const Burger = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
);
const LogoutIcon = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="M16 17l5-5-5-5M21 12H9" /></svg>
);

export default function StudioShell({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [claiming, setClaiming] = useState(false);
  const [claimMsg, setClaimMsg] = useState('');
  const pathname = usePathname();
  const { data: session, status } = useSession();

  const loadUsage = useCallback(() => {
    fetch('/api/usage')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d && !d.error) setUsage(d); })
      .catch(() => { /* ignore */ });
  }, []);

  useEffect(() => {
    if (status !== 'authenticated') return;
    loadUsage();
  }, [status, loadUsage]);

  const claimFree = async () => {
    setClaiming(true); setClaimMsg('');
    try {
      const r = await fetch('/api/credits/claim', { method: 'POST' });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || '받기 실패');
      setClaimMsg(`+${d.granted} 크레딧 충전됐어요!`);
      loadUsage();
    } catch (e) { setClaimMsg(e instanceof Error ? e.message : String(e)); }
    setClaiming(false);
  };

  const unlimited = usage?.limit === null && usage !== null;
  const remainText = status !== 'authenticated' ? '—' : usage == null ? '…' : unlimited ? '무제한' : String(usage.remaining ?? 0);
  const barPct = usage && usage.limit ? Math.min(100, Math.round(((usage.remaining ?? 0) / usage.limit) * 100)) : 100;
  const pillText = status !== 'authenticated' ? '로그인 필요' : usage == null ? '불러오는 중' : unlimited ? '무제한' : `${usage.remaining ?? 0}회 남음`;

  const isAdmin = !!(session?.user as { isAdmin?: boolean } | undefined)?.isAdmin;
  const createItems = CREATE.filter((i) => !i.adminOnly || isAdmin);
  const all = [...CREATE, ...WORK];
  const active = all.find((i) => !i.external && (i.href === pathname || (i.href !== '/studio' && pathname.startsWith(i.href))));
  const crumbName = pathname === '/studio' ? '홈' : (active?.name ?? '스튜디오');

  const name = session?.user?.name || session?.user?.email || '게스트';
  const initial = (name || 'G').trim().charAt(0).toUpperCase();

  const renderNav = (items: Item[]) =>
    items.map((it) => {
      const isActive = !it.external && (it.href === pathname);
      const cls = `st-nav${isActive ? ' active' : ''}`;
      const inner = (
        <>
          <span className="ico"><Icon name={it.icon} /></span>
          <span className="txt">{it.name}</span>
          {it.badge && <span className={`badge${it.badge === 'soon' ? ' soon' : ''}`}>{it.badge === 'new' ? 'NEW' : '준비중'}</span>}
          {!it.badge && it.cost && <span className="cost" title={`영상 1건당 약 ${it.cost.replace('C', '크레딧')} 소모`}>{it.cost}</span>}
        </>
      );
      if (it.external) return <a key={it.id} className={cls} href={it.href} target="_blank" rel="noreferrer" title={it.name}>{inner}</a>;
      return <Link key={it.id} className={cls} href={it.href} title={it.name} onClick={() => setDrawer(false)}>{inner}</Link>;
    });

  return (
    <div className="st-root">
      <div className={`st-app${collapsed ? ' collapsed' : ''}${drawer ? ' drawer-open' : ''}`}>
        <aside className="st-sidebar">
          <div className="st-head">
            <Link href="/" className="st-brand-link" title="홈으로">
              <span className="st-logo">S</span>
              <span className="st-wordmark">Shorts<b>AI</b></span>
            </Link>
            <button className="st-collapse" onClick={() => setCollapsed((v) => !v)} aria-label={collapsed ? '사이드바 펼치기' : '사이드바 접기'}>{Chevron}</button>
          </div>

          <div className="st-scroll">
            <div className="st-group">
              <div className="st-label">만들기</div>
              {renderNav(createItems)}
            </div>
            <div className="st-group">
              <div className="st-label">내 작업</div>
              {renderNav(WORK)}
            </div>
          </div>

          <div className="st-foot">
            <div className="st-credits">
              <div className="st-cnum">{remainText}{usage && !unlimited && usage.limit ? <span> / {usage.limit}회</span> : null}</div>
              <div className="st-clabel">남은 생성 횟수{usage && usage.credits > 0 ? ` · 크레딧 ${usage.credits}` : ''}</div>
              <div className="st-bar"><i style={{ width: `${barPct}%` }} /></div>
              {usage?.claimable && (
                <button className="st-coupon" onClick={claimFree} disabled={claiming}>
                  {claiming ? '받는 중…' : `🎁 ${usage.firstFreeClaim ? '가입 선물' : '이번 달 무료'} 5크레딧 받기`}
                </button>
              )}
              {claimMsg && <div className="st-coupon-msg">{claimMsg}</div>}
              <Link className="st-buy" href="/studio/billing">이용권 충전</Link>
            </div>
            {session ? (
              <div className="st-account">
                <div className="st-avatar">{initial}</div>
                <div className="st-who"><b>{name}</b><span>로그인됨</span></div>
                <button className="st-logout" onClick={() => signOut({ callbackUrl: '/' })} title="로그아웃" aria-label="로그아웃">{LogoutIcon}</button>
              </div>
            ) : (
              <Link className="st-login-btn" href="/login?callbackUrl=/studio">로그인</Link>
            )}
          </div>
        </aside>

        <div className="st-scrim" onClick={() => setDrawer(false)} />

        <div className="st-main">
          <header className="st-topbar">
            <button className="st-iconbtn st-hamburger" onClick={() => setDrawer(true)} aria-label="메뉴 열기">{Burger}</button>
            <div className="st-crumb"><Link href="/studio">Studio</Link> <span>›</span> <b>{crumbName}</b></div>
            <div className="spacer" />
            {status === 'authenticated' ? (
              <span className="st-pill"><span className="dot" />{pillText}</span>
            ) : (
              <Link className="st-pill st-pill-login" href={`/login?callbackUrl=${encodeURIComponent(pathname || '/studio')}`}>
                <span className="dot" />로그인 →
              </Link>
            )}
            <ThemeToggle />
          </header>

          <main className="st-content">{children}</main>
        </div>
      </div>
    </div>
  );
}
