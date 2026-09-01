import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: '이용약관 | ShortsAI',
  description: 'ShortsAI 서비스 이용약관',
};

export default function TermsPage() {
  return (
    <main className="max-w-3xl mx-auto px-5 sm:px-6 py-14 sm:py-20 text-gray-300 leading-relaxed">
      <h1 className="text-2xl sm:text-3xl font-bold text-white mb-2">이용약관</h1>
      <p className="text-gray-500 text-sm mb-10">시행일: 2026년 8월 3일</p>

      <Section title="제1조 (목적)">
        본 약관은 이지온(이하 &ldquo;회사&rdquo;)이 운영하는 ShortsAI(shortsai.kr, 이하 &ldquo;서비스&rdquo;)의
        이용과 관련하여 회사와 회원 간의 권리·의무 및 책임사항, 이용조건 및 절차를 규정함을 목적으로 합니다.
      </Section>

      <Section title="제2조 (정의)">
        <ul className="list-disc pl-5 space-y-1">
          <li>&ldquo;서비스&rdquo;란 회사가 AI 기술을 이용해 홍보영상(쇼츠)을 자동 생성·제공하는 온라인 서비스를 말합니다.</li>
          <li>&ldquo;회원&rdquo;이란 본 약관에 동의하고 서비스를 이용하는 자를 말합니다.</li>
          <li>&ldquo;유료서비스&rdquo;란 회원이 요금을 결제하고 이용하는 Pro·Business 등 유료 요금제를 말합니다.</li>
        </ul>
      </Section>

      <Section title="제3조 (약관의 효력 및 변경)">
        <p>1. 본 약관은 서비스 화면에 게시함으로써 효력이 발생합니다.</p>
        <p>2. 회사는 관련 법령을 위반하지 않는 범위에서 약관을 변경할 수 있으며, 변경 시 시행일 7일 전(회원에게 불리한 변경은 30일 전)부터 공지합니다.</p>
      </Section>

      <Section title="제4조 (서비스의 제공)">
        <p>1. 회사는 회원에게 AI 기반 홍보영상 생성, 스크립트 생성, 음성 내레이션, BGM, 다운로드 등의 기능을 제공합니다.</p>
        <p>2. 요금제별 월 생성 횟수 및 기능은 서비스 내 요금 안내에 따릅니다(무료 월 3회, Lite 월 10회, Pro 월 30회, Business 월 100회). 단건 이용권(10회·30회)은 충전한 횟수만큼 사용합니다.</p>
        <p>3. 회사는 서비스의 품질 향상을 위해 기능을 변경·추가할 수 있습니다.</p>
      </Section>

      <Section title="제5조 (회원가입 및 계정)">
        <p>1. 회원가입은 Google 또는 Kakao 계정 인증을 통해 이루어집니다.</p>
        <p>2. 회원은 계정 정보를 제3자에게 양도·대여할 수 없으며, 관리 소홀로 인한 책임은 회원에게 있습니다.</p>
      </Section>

      <Section title="제6조 (이용요금 및 결제)">
        <p>1. 유료서비스는 (가) 월 정기결제(자동갱신)와 (나) 단건 이용권(횟수 충전, 자동갱신 없음)으로 제공됩니다. 구독 요금(부가세 포함)은 Lite 월 2,000원, Pro 월 4,000원, Business 월 10,000원이며, 단건 이용권은 10회 3,000원, 30회 5,000원입니다.</p>
        <p>2. 결제는 PortOne(포트원)을 통한 카드·간편결제(토스페이·카카오페이·네이버페이 등)로 이루어집니다.</p>
        <p>3. 정기결제는 매 결제일에 자동으로 갱신되며, 회원은 언제든지 해지할 수 있습니다. 해지 시 다음 결제일부터 청구되지 않습니다.</p>
        <p>4. 환불은 별도의 <a href="/refund" className="text-purple-400 hover:underline">환불정책</a>에 따릅니다.</p>
      </Section>

      <Section title="제7조 (회원의 의무 및 금지행위)">
        <p>회원은 다음 행위를 하여서는 안 됩니다.</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>타인의 정보 도용, 허위 정보 등록</li>
          <li>서비스를 이용해 불법·음란·타인의 권리를 침해하는 콘텐츠를 제작·배포하는 행위</li>
          <li>서비스의 정상적 운영을 방해하는 행위(자동화 프로그램, 과도한 요청 등)</li>
          <li>회사 또는 제3자의 지식재산권을 침해하는 행위</li>
        </ul>
      </Section>

      <Section title="제8조 (생성물의 권리)">
        <p>1. 회원이 서비스를 통해 생성한 영상의 이용 권리는 회원에게 있으며, 회원은 이를 상업적 목적으로 이용할 수 있습니다.</p>
        <p>2. 단, 생성에 사용된 소스(음원·폰트·AI 모델 등)의 제3자 라이선스 조건을 회원이 준수하여야 합니다.</p>
        <p>3. 회원이 입력한 정보 및 생성물의 적법성·정확성에 대한 책임은 회원에게 있습니다.</p>
      </Section>

      <Section title="제9조 (서비스 이용제한 및 해지)">
        <p>1. 회원이 본 약관을 위반하는 경우 회사는 이용을 제한하거나 계약을 해지할 수 있습니다.</p>
        <p>2. 회원은 언제든지 서비스 내 기능 또는 고객문의를 통해 이용계약을 해지(회원탈퇴)할 수 있습니다.</p>
      </Section>

      <Section title="제10조 (면책 및 손해배상)">
        <p>1. 회사는 천재지변, 회원의 귀책, 제3자 서비스(결제·AI·호스팅 등) 장애 등 회사의 책임 없는 사유로 인한 손해에 대해 책임을 지지 않습니다.</p>
        <p>2. 서비스는 &ldquo;있는 그대로&rdquo; 제공되며, 생성된 결과물의 특정 목적 적합성을 보증하지 않습니다.</p>
      </Section>

      <Section title="제11조 (준거법 및 관할)">
        <p>본 약관은 대한민국 법령에 따르며, 서비스 이용과 관련한 분쟁은 민사소송법상의 관할 법원을 제1심 관할로 합니다.</p>
      </Section>

      <div className="mt-12 pt-6 border-t border-white/10 text-sm text-gray-500">
        상호: 이지온 | 대표: Sutong An | 사업자등록번호: 794-03-04121<br />
        주소: 202, 46-1, Hamdeok 12-gil, Jocheon-eup, Jeju-si, Jeju-do, Republic of Korea<br />
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
