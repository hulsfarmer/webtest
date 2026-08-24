'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';

/**
 * 서비스 점검(리모델링) 안내 팝업.
 * 미들웨어가 제작 도구 접근을 막고 `/?maintenance=1`로 돌려보내면 이 모달을 띄운다.
 */
export default function MaintenanceModal() {
  const sp = useSearchParams();
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (sp.get('maintenance') === '1') setShow(true);
  }, [sp]);

  if (!show) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="서비스 점검 안내"
      onClick={() => setShow(false)}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px',
        background: 'rgba(15, 18, 30, 0.55)',
        backdropFilter: 'blur(4px)',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 360,
          background: '#fff',
          borderRadius: 18,
          padding: '32px 26px 24px',
          textAlign: 'center',
          boxShadow: '0 20px 60px rgba(0,0,0,0.28)',
        }}
      >
        <div style={{ fontSize: 40, lineHeight: 1, marginBottom: 14 }}>🔧</div>
        <h2 style={{ margin: '0 0 12px', fontSize: 20, fontWeight: 800, color: '#141824' }}>
          서비스 점검 중
        </h2>
        <p style={{ margin: '0 0 22px', fontSize: 15, lineHeight: 1.6, color: '#4a5163' }}>
          더 안전한 서비스를 위해 잠시 점검 중입니다.
          <br />
          빠른 시간 내 다시 찾아뵙겠습니다.
          <br />
          감사합니다.
        </p>
        <button
          type="button"
          onClick={() => setShow(false)}
          style={{
            width: '100%',
            padding: '13px 0',
            border: 'none',
            borderRadius: 12,
            fontSize: 15,
            fontWeight: 700,
            color: '#fff',
            cursor: 'pointer',
            background: 'linear-gradient(135deg, #6d5efc, #8b6bff)',
          }}
        >
          확인
        </button>
      </div>
    </div>
  );
}
