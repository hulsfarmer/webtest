import Link from 'next/link';

export const metadata = { title: '내 라이브러리' };

const ITEMS = [
  { name: '향긋한 한 잔', when: '오늘', len: '30초' },
  { name: '봄 플리마켓', when: '2일 전', len: '30초' },
  { name: '수제 그래놀라', when: '3일 전', len: '15초' },
  { name: '오션뷰 카페', when: '5일 전', len: '30초' },
  { name: '신메뉴 출시', when: '1주 전', len: '45초' },
  { name: '주말 특가', when: '1주 전', len: '30초' },
];

export default function LibraryPage() {
  return (
    <>
      <div className="st-page-head">
        <div className="st-eyebrow">내 작업</div>
        <h1 className="st-title">내 라이브러리</h1>
        <p className="st-sub">지금까지 만든 영상을 모아보고, 다시 편집하거나 SNS로 바로 발행하세요.</p>
      </div>
      <div className="st-libgrid">
        {ITEMS.map((it, i) => (
          <div className="st-libcard" key={i}>
            <div className="thumb">
              <div className="band"><small>ShortsAI</small></div>
              <div className="cap">{it.name}</div>
            </div>
            <div className="meta"><b>{it.name}</b><span>{it.when} · {it.len}</span></div>
          </div>
        ))}
      </div>
      <p className="st-note">실제 생성한 영상 목록은 <Link href="/history" style={{ color: 'var(--purple)', fontWeight: 700 }}>내 영상</Link> 에서 확인·다운로드할 수 있습니다. (여기 표시는 예시입니다)</p>
    </>
  );
}
