export const metadata = { title: '로고 생성' };

export default function Page() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="st-page-head" style={{ marginBottom: 0 }}>
        <div className="st-eyebrow">AI 로고 스튜디오</div>
        <h1 className="st-title" style={{ margin: '4px 0 0' }}>로고 생성</h1>
        <p className="st-sub">브랜드 이름과 분위기만 입력하면 로고 시안을 만들고 PNG·SVG·AI로 내려받습니다.
          {' '}<a href="https://logomaker-blush.vercel.app" target="_blank" rel="noreferrer" style={{ color: 'var(--purple)', fontWeight: 700 }}>새 탭에서 열기 ↗</a></p>
      </div>
      <iframe
        src="https://logomaker-blush.vercel.app"
        title="AI 로고 생성"
        style={{ width: '100%', height: 'calc(100vh - 190px)', minHeight: 520, border: '1px solid var(--border)', borderRadius: 14, background: '#fff' }}
        allow="clipboard-write"
      />
    </div>
  );
}
