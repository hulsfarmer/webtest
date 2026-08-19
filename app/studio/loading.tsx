// 스튜디오 진입 시 즉시 뜨는 스켈레톤 — 동적 라우트 이동 체감 지연 제거
export default function StudioLoading() {
  return (
    <div className="st-skel" aria-busy="true" aria-label="불러오는 중">
      <div className="st-skel-head">
        <div className="st-skel-line sm" />
        <div className="st-skel-line lg" />
        <div className="st-skel-line md" />
      </div>
      <div className="st-skel-cards">
        {Array.from({ length: 6 }).map((_, i) => (
          <div className="st-skel-card" key={i} />
        ))}
      </div>
    </div>
  );
}
