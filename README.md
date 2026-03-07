# ShortsAI - 유튜브 쇼츠 자동 생성 SaaS

Claude AI로 주제만 입력하면 스크립트 → 음성 → 영상까지 자동 완성.

## 빠른 시작

```bash
# 1. 의존성 설치
npm install  # 또는 bun install

# 2. 환경변수 설정
cp .env.example .env.local
# .env.local에서 ANTHROPIC_API_KEY 입력

# 3. (선택) 한국어 폰트 다운로드
mkdir -p public/fonts
curl -L "https://github.com/google/fonts/raw/main/ofl/notosanskr/NotoSansKR%5Bwght%5D.ttf" \
  -o public/fonts/NotoSansKR-Regular.ttf

# 4. 실행
npm run dev
```

→ http://localhost:3000 접속

## 환경변수

| 변수 | 설명 | 필수 |
|------|------|------|
| `ANTHROPIC_API_KEY` | Claude API 키 | 필수 (없으면 Mock 모드) |
| `STRIPE_SECRET_KEY` | Stripe 비밀 키 | 결제 기능 사용 시 |
| `STRIPE_WEBHOOK_SECRET` | Stripe 웹훅 시크릿 | 결제 기능 사용 시 |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Stripe 공개 키 | 결제 기능 사용 시 |

## 기능

- **AI 스크립트**: Claude claude-opus-4-6로 훅 + 핵심 내용 + CTA 자동 생성
- **한국어 TTS**: Google TTS 기반 자연스러운 한국어 음성
- **영상 합성**: 1080×1920 쇼츠 포맷 MP4 자동 생성
- **사용량 관리**: 플랜별 월간 한도 (무료 5개, 기본 30개, 프로 무제한)
- **Stripe 결제**: 구독 플랜 결제

## 기술 스택

- Next.js 14 (App Router) + TypeScript
- Tailwind CSS (다크 퍼플 테마)
- Anthropic SDK (Claude claude-opus-4-6)
- @napi-rs/canvas (한국어 텍스트 렌더링)
- FFmpeg (영상 합성)
- Stripe (결제)

## 배포 주의사항

- **서버리스 불가**: FFmpeg 영상 생성은 서버리스 환경에서 동작하지 않음
- **Railway/Render 추천**: `npm start`로 일반 Node.js 서버로 배포
- **스토리지**: 생성된 영상은 `public/videos/`에 저장됨. 프로덕션에서는 S3 연동 권장

## 수익 구조

| 플랜 | 가격 | 영상 |
|------|------|------|
| 무료 | $0 | 월 5개 |
| 기본 | $19/월 | 월 30개 |
| 프로 | $49/월 | 무제한 |

구독자 100명 → 월 $2,000~5,000 예상 수익
