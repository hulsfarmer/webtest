import { ImageResponse } from 'next/og';

export const runtime = 'edge';
export const alt = 'ShortsAI - AI 사업장 홍보영상 자동 생성';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function OGImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'linear-gradient(135deg, #0F172A 0%, #1a1f4e 50%, #0F172A 100%)',
          fontFamily: 'sans-serif',
        }}
      >
        {/* Purple glow */}
        <div
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            width: 600,
            height: 400,
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(147,51,234,0.3) 0%, transparent 70%)',
          }}
        />

        {/* Logo / Brand */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            marginBottom: 24,
          }}
        >
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: 16,
              background: 'linear-gradient(135deg, #9333ea, #6366f1)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 28,
              color: 'white',
              fontWeight: 900,
            }}
          >
            S
          </div>
          <span
            style={{
              fontSize: 48,
              fontWeight: 800,
              color: 'white',
              letterSpacing: -1,
            }}
          >
            ShortsAI
          </span>
        </div>

        {/* Headline */}
        <div
          style={{
            fontSize: 52,
            fontWeight: 800,
            color: 'white',
            textAlign: 'center',
            lineHeight: 1.3,
            marginBottom: 16,
          }}
        >
          사업장 홍보영상
        </div>
        <div
          style={{
            fontSize: 52,
            fontWeight: 800,
            background: 'linear-gradient(90deg, #9333ea, #6366f1, #10b981)',
            backgroundClip: 'text',
            color: 'transparent',
            textAlign: 'center',
            lineHeight: 1.3,
            marginBottom: 32,
          }}
        >
          AI로 3분 완성!
        </div>

        {/* Sub text */}
        <div
          style={{
            fontSize: 24,
            color: '#9ca3af',
            textAlign: 'center',
          }}
        >
          업체명 + 사진만 입력 → 스크립트 · 음성 · BGM · 영상 자동 생성
        </div>

        {/* Bottom bar */}
        <div
          style={{
            position: 'absolute',
            bottom: 32,
            display: 'flex',
            gap: 32,
            fontSize: 18,
            color: '#6b7280',
          }}
        >
          <span>shortsai.kr</span>
          <span>·</span>
          <span>한국어 완벽 지원</span>
          <span>·</span>
          <span>무료로 시작</span>
        </div>
      </div>
    ),
    { ...size }
  );
}
