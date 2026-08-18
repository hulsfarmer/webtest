'use client';

import { useEffect, useState } from 'react';

type Mode = 'light' | 'system' | 'dark';

function applyTheme(mode: Mode) {
  const root = document.documentElement;
  if (mode === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', mode);
  try { localStorage.setItem('theme', mode); } catch { /* ignore */ }
}

const SunIcon = (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.4 1.4M17.6 17.6L19 19M19 5l-1.4 1.4M6.4 17.6L5 19" /></svg>
);
const SystemIcon = (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="4" width="18" height="13" rx="2" /><path d="M8 21h8M12 17v4" /></svg>
);
const MoonIcon = (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21 12.8A8.5 8.5 0 1 1 11.2 3a6.6 6.6 0 0 0 9.8 9.8Z" /></svg>
);

const OPTIONS: { mode: Mode; label: string; icon: React.ReactNode }[] = [
  { mode: 'light', label: '라이트', icon: SunIcon },
  { mode: 'system', label: '시스템', icon: SystemIcon },
  { mode: 'dark', label: '다크', icon: MoonIcon },
];

export default function ThemeToggle() {
  const [mode, setMode] = useState<Mode>('system');

  // 초기값: layout 의 선적용 스크립트가 이미 html[data-theme] 를 세팅했으므로 그걸 읽는다
  useEffect(() => {
    let saved: Mode = 'system';
    try { saved = (localStorage.getItem('theme') as Mode) || 'system'; } catch { /* ignore */ }
    setMode(saved);
  }, []);

  const pick = (m: Mode) => { setMode(m); applyTheme(m); };

  return (
    <div className="sa-seg" role="group" aria-label="테마 선택">
      {OPTIONS.map((o) => (
        <button
          key={o.mode}
          type="button"
          className={mode === o.mode ? 'on' : undefined}
          onClick={() => pick(o.mode)}
          title={o.label}
          aria-label={`${o.label} 모드`}
          aria-pressed={mode === o.mode}
        >
          {o.icon}
        </button>
      ))}
    </div>
  );
}
