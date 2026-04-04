const steps = [
  {
    number: '01',
    icon: '✍️',
    title: '주제 입력',
    description: '만들고 싶은 쇼츠의 주제를 입력하세요. 예: "다이어트 팁", "재테크 방법"',
    color: 'from-purple-600 to-purple-400',
  },
  {
    number: '02',
    icon: '🤖',
    title: 'AI 스크립트',
    description: 'Claude AI가 시청자를 사로잡는 훅, 핵심 내용, CTA가 포함된 스크립트를 생성합니다',
    color: 'from-blue-600 to-blue-400',
  },
  {
    number: '03',
    icon: '🎙️',
    title: '음성 자동 생성',
    description: '자연스러운 한국어 TTS로 전문적인 음성 나레이션을 자동으로 만들어드립니다',
    color: 'from-violet-600 to-violet-400',
  },
  {
    number: '04',
    icon: '⬇️',
    title: '영상 다운로드',
    description: '1080×1920 쇼츠 포맷 MP4 파일로 완성! 바로 유튜브에 업로드하세요',
    color: 'from-indigo-600 to-indigo-400',
  },
];

export default function HowItWorks() {
  return (
    <section id="how-it-works" className="py-24 px-6">
      <div className="max-w-5xl mx-auto">
        <div className="text-center mb-16">
          <div className="inline-block px-4 py-1.5 rounded-full bg-purple-500/10 border border-purple-500/20 text-purple-400 text-sm font-medium mb-4">
            사용방법
          </div>
          <h2 className="text-4xl md:text-5xl font-bold mb-4">
            클릭 한 번으로{' '}
            <span className="gradient-text">완성</span>
          </h2>
          <p className="text-gray-400 text-lg">복잡한 영상 편집 없이 4단계로 끝납니다</p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
          {steps.map((step, i) => (
            <div key={i} className="relative group">
              {/* Connector line */}
              {i < steps.length - 1 && (
                <div className="hidden lg:block absolute top-12 left-full w-full h-px bg-gradient-to-r from-purple-500/40 to-transparent z-0" />
              )}

              <div className="glass-card p-6 h-full hover:border-purple-500/40 transition-colors">
                {/* Number badge */}
                <div
                  className={`w-10 h-10 rounded-xl bg-gradient-to-br ${step.color} flex items-center justify-center text-white font-bold text-sm mb-4`}
                >
                  {step.number}
                </div>

                <div className="text-3xl mb-3">{step.icon}</div>
                <h3 className="font-bold text-lg mb-2">{step.title}</h3>
                <p className="text-gray-400 text-sm leading-relaxed">{step.description}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Example topic pills */}
        <div className="mt-12 text-center">
          <p className="text-gray-500 text-sm mb-4">이런 주제로 바로 만들어보세요</p>
          <div className="flex flex-wrap justify-center gap-2">
            {['다이어트 팁', '재테크 방법', '영어 공부법', '요리 레시피', '운동 루틴', '독서 습관', '생산성 향상', '여행 꿀팁'].map(
              (topic) => (
                <span
                  key={topic}
                  className="px-3 py-1.5 rounded-full bg-white/5 border border-white/10 text-gray-300 text-sm hover:border-purple-500/40 transition-colors cursor-default"
                >
                  {topic}
                </span>
              )
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
