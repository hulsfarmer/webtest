// PM2 설정 — 클러스터 2인스턴스.
// 단일 프로세스에서 영상·이미지 생성 같은 무거운 작업이 이벤트 루프를 점유하면
// 로그인·네비게이션이 그 뒤에 줄 서서 몇 초씩 멈추던 문제를 해소한다.
// 잡 상태는 Supabase(jobs 테이블)·디스크에 저장되므로 워커 간 공유가 안전하다.
module.exports = {
  apps: [
    {
      name: 'shortsai',
      script: './node_modules/next/dist/bin/next',
      args: 'start',
      instances: 2,
      exec_mode: 'cluster',
      max_memory_restart: '600M',
      env: { NODE_ENV: 'production' },
    },
  ],
};
