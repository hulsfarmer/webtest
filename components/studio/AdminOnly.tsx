import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { isAdminEmail } from '@/lib/admin';

// 관리자만 children 렌더, 아니면 안내. 업체·행사 홍보영상 외 편집 기능 보호용.
export default async function AdminOnly({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);
  if (!isAdminEmail(session?.user?.email)) {
    return (
      <div className="st-soon">
        <div>
          <span className="badge">관리자 전용</span>
          <h2>이 기능은 관리자만 사용할 수 있어요</h2>
          <p>브랜드·이벤트 소개 영상은 자유롭게 이용하실 수 있습니다.</p>
        </div>
      </div>
    );
  }
  return <>{children}</>;
}
