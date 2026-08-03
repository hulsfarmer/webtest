import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: '환불정책 | ShortsAI',
  description: 'ShortsAI 취소 및 환불정책',
};

export default function RefundPage() {
  return (
    <main className="max-w-3xl mx-auto px-5 sm:px-6 py-14 sm:py-20 text-gray-300 leading-relaxed">
      <h1 className="text-2xl sm:text-3xl font-bold text-white mb-2">취소 및 환불정책</h1>
      <p className="text-gray-500 text-sm mb-10">시행일: 2026년 8월 3일</p>

      <Section title="1. 정기결제 해지">
        <p>유료 요금제(Pro·Business)는 월 정기결제로 자동 갱신됩니다. 회원은 언제든지 서비스 내 &lsquo;구독 해지&rsquo; 또는 고객문의를 통해 해지할 수 있습니다.</p>
        <p>해지 시 <strong className="text-gray-200">다음 결제일부터 청구가 중단</strong>되며, 이미 결제한 기간 동안에는 계속 서비스를 이용할 수 있습니다.</p>
      </Section>

      <Section title="2. 결제 취소 및 환불 (청약철회)">
        <p>「전자상거래 등에서의 소비자보호에 관한 법률」에 따라 다음과 같이 환불을 처리합니다.</p>
        <ul className="list-disc pl-5 space-y-1">
          <li><strong className="text-gray-200">결제일로부터 7일 이내</strong>이고, 해당 결제 기간에 서비스(영상 생성 등)를 <strong className="text-gray-200">이용하지 않은 경우</strong>: 전액 환불</li>
          <li>이미 서비스를 이용(영상 생성 등)한 경우: 디지털 콘텐츠의 특성상 사용을 시작한 부분에 대해서는 청약철회가 제한될 수 있습니다.</li>
          <li>회사의 귀책사유(서비스 장애 등)로 서비스를 정상 이용하지 못한 경우: 잔여 이용기간·횟수에 대해 비례하여 환불합니다.</li>
        </ul>
      </Section>

      <Section title="3. 환불 방법 및 기간">
        <p>환불은 원칙적으로 결제한 수단으로 취소 처리되며, 결제취소가 불가능한 경우 계좌 환불로 진행합니다.</p>
        <p>환불 요청 확인 후 영업일 기준 3~5일 이내에 처리되며, 카드사·결제사 사정에 따라 실제 환급까지 추가 기간이 소요될 수 있습니다.</p>
      </Section>

      <Section title="4. 환불 신청 방법">
        <p>아래 고객문의로 연락 주시면 안내해 드립니다.</p>
        <p>전화: 010-4149-0673 / 이메일: support@shortsai.kr</p>
      </Section>

      <div className="mt-12 pt-6 border-t border-white/10 text-sm text-gray-500">
        상호: 이지온 | 대표: 안수동 | 사업자등록번호: 794-03-04121<br />
        주소: 제주특별자치도 제주시 조천읍 함덕12길 46-1, 202호<br />
        고객문의: 010-4149-0673 | support@shortsai.kr
      </div>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="text-lg font-semibold text-white mb-3">{title}</h2>
      <div className="space-y-2 text-sm sm:text-[15px] text-gray-300">{children}</div>
    </section>
  );
}
