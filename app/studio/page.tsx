import Link from 'next/link';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { isAdminEmail } from '@/lib/admin';

const CARDS: { icon: string; name: string; desc: string; href: string; tag?: 'new' | 'soon'; premium?: boolean; adminOnly?: boolean }[] = [
  { icon: '🏪', name: '브랜드 소개 영상', desc: '가게·회사·농장·병원 등 사업장을 소개하는 세로 쇼츠.', href: '/studio/promo' },
  { icon: '📅', name: '이벤트 홍보 영상', desc: '축제·마켓·세일·오픈 등 이벤트를 긴급성 있게 알립니다.', href: '/studio/event' },
  { icon: '🎭', name: '제품홍보영상', desc: '제품 이미지만 넣으면 AI배우를 자동 생성해 20초로 말하게 하는 세로 쇼츠 (기본형).', href: '/studio/product-vs' },
  { icon: '⭐', name: '제품홍보영상', premium: true, desc: '제품을 든 AI배우를 자동 생성해 20초로 말하게 하는 쇼츠. 손동작·표현이 더 풍부한 프리미엄. (1편 15크레딧)', href: '/studio/product-ai' },
  { icon: '✦', name: '로고 생성', desc: '브랜드 이름과 분위기만으로 로고 시안 제작·다운로드.', href: '/studio/logo' },
  { icon: '🔄', name: '파일 변환', desc: '영상·이미지·문서 포맷을 빠르게 변환합니다.', href: '/studio/convert', tag: 'soon' as const, adminOnly: true },
  { icon: '🎬', name: '유튜브 디자인', desc: '채널 배너·썸네일을 브랜드 톤에 맞춰 자동 디자인.', href: '/studio/youtube', adminOnly: true },
];

export default async function StudioHome() {
  const session = await getServerSession(authOptions);
  const admin = isAdminEmail(session?.user?.email);
  const cards = CARDS.filter((c) => !c.adminOnly || admin);

  return (
    <>
      <div className="st-page-head">
        <div className="st-eyebrow">스튜디오</div>
        <h1 className="st-title">무엇을 만들어 볼까요?</h1>
        <p className="st-sub">왼쪽에서 도구를 고르거나 아래 카드를 눌러 시작하세요. 만든 결과물은 &lsquo;내 라이브러리&rsquo;에 모입니다.</p>
      </div>

      <div className="st-cards">
        {cards.map((c) => {
          const inner = (
            <>
              <div className="ic">{c.icon}</div>
              <h3>{c.name}{c.premium && <span style={{ fontSize: '0.58em', fontWeight: 400, opacity: 0.6, marginLeft: 4 }}>premium</span>}{c.tag === 'new' && <span className="tag new">NEW</span>}{c.tag === 'soon' && <span className="tag soon">준비중</span>}</h3>
              <p>{c.desc}</p>
            </>
          );
          return <Link key={c.href} className="st-card" href={c.href}>{inner}</Link>;
        })}
      </div>
    </>
  );
}
