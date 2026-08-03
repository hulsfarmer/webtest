import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: '개인정보처리방침 | ShortsAI',
  description: 'ShortsAI 개인정보처리방침',
};

export default function PrivacyPage() {
  return (
    <main className="max-w-3xl mx-auto px-5 sm:px-6 py-14 sm:py-20 text-gray-300 leading-relaxed">
      <h1 className="text-2xl sm:text-3xl font-bold text-white mb-2">개인정보처리방침</h1>
      <p className="text-gray-500 text-sm mb-10">시행일: 2026년 8월 3일</p>

      <p className="text-sm text-gray-400 mb-8">
        이지온(이하 &ldquo;회사&rdquo;)은 「개인정보 보호법」 등 관련 법령을 준수하며, 이용자의 개인정보를 다음과 같이
        처리합니다.
      </p>

      <Section title="1. 수집하는 개인정보 항목">
        <ul className="list-disc pl-5 space-y-1">
          <li>회원가입: 이메일, 이름 또는 닉네임, 프로필 정보(Google·Kakao 소셜 로그인 제공 항목)</li>
          <li>유료 결제: 결제 승인 정보, 결제수단 식별값(카드정보 등 민감 결제정보는 결제대행사 PortOne이 처리하며 회사는 보관하지 않습니다)</li>
          <li>서비스 이용 과정에서 생성: 영상 생성 기록, 입력 텍스트, 이용 로그</li>
          <li>자동 수집: 접속 IP, 쿠키, 브라우저·기기 정보</li>
        </ul>
      </Section>

      <Section title="2. 개인정보의 수집·이용 목적">
        <ul className="list-disc pl-5 space-y-1">
          <li>회원 식별 및 관리, 서비스 제공</li>
          <li>유료서비스 결제, 정산 및 요금제 관리</li>
          <li>고객 문의 응대 및 공지사항 전달</li>
          <li>서비스 품질 개선 및 부정이용 방지</li>
        </ul>
      </Section>

      <Section title="3. 개인정보의 보유 및 이용 기간">
        <p>원칙적으로 회원 탈퇴 시 지체 없이 파기합니다. 다만 관련 법령에 따라 아래 정보는 명시된 기간 동안 보관합니다.</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>계약 또는 청약철회 등에 관한 기록: 5년(전자상거래법)</li>
          <li>대금결제 및 재화 공급에 관한 기록: 5년(전자상거래법)</li>
          <li>소비자 불만 또는 분쟁처리에 관한 기록: 3년(전자상거래법)</li>
          <li>접속에 관한 기록: 3개월(통신비밀보호법)</li>
        </ul>
      </Section>

      <Section title="4. 개인정보 처리의 위탁">
        <p>회사는 서비스 제공을 위해 아래와 같이 개인정보 처리를 위탁합니다.</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>Amazon Web Services — 서버 호스팅(국내 리전)</li>
          <li>Supabase — 데이터베이스 및 회원정보 저장</li>
          <li>PortOne(포트원) 및 연계 결제사(토스페이·카카오페이·네이버페이·카드사) — 결제 처리</li>
          <li>Google — 소셜 로그인 인증 및 음성합성(TTS)</li>
          <li>Anthropic, OpenAI — AI 스크립트·콘텐츠 생성 처리</li>
        </ul>
      </Section>

      <Section title="5. 개인정보의 제3자 제공">
        <p>회사는 이용자의 개인정보를 원칙적으로 제3자에게 제공하지 않습니다. 다만 이용자가 동의한 경우 또는 법령에 따른 요청이 있는 경우 예외로 합니다.</p>
      </Section>

      <Section title="6. 이용자의 권리">
        <p>이용자는 언제든지 자신의 개인정보에 대한 열람·정정·삭제·처리정지를 요청할 수 있으며, 회사는 지체 없이 조치합니다. 요청은 아래 개인정보 보호책임자에게 하실 수 있습니다.</p>
      </Section>

      <Section title="7. 개인정보의 파기">
        <p>개인정보는 보유기간 경과 또는 처리목적 달성 시 지체 없이 파기합니다. 전자적 파일은 복구 불가능한 방법으로 삭제합니다.</p>
      </Section>

      <Section title="8. 쿠키의 운용">
        <p>회사는 로그인 유지 및 서비스 이용 편의를 위해 쿠키를 사용합니다. 이용자는 브라우저 설정을 통해 쿠키 저장을 거부할 수 있으나, 이 경우 로그인 등 일부 기능이 제한될 수 있습니다.</p>
      </Section>

      <Section title="9. 개인정보 보호책임자">
        <p>성명: 안수동<br />연락처: 010-4149-0673 / huls_family@naver.com</p>
      </Section>

      <div className="mt-12 pt-6 border-t border-white/10 text-sm text-gray-500">
        상호: 이지온 | 대표: 안수동 | 사업자등록번호: 794-03-04121<br />
        주소: 제주특별자치도 제주시 조천읍 함덕12길 46-1, 202호
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
