'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export type Field =
  | { type: 'input' | 'textarea'; label: string; placeholder: string; hint?: string; param?: string }
  | { type: 'select'; label: string; options: string[]; param?: string }
  | { type: 'chips'; label: string; options: string[]; param?: string }
  | { type: 'drop'; label: string; text: string };

export type ToolConfig = {
  eyebrow: string;
  title: string;
  sub: string;
  fields: Field[];
  preview: 'vertical' | 'square' | 'wide';
  previewData?: { name?: string; capA?: string; capB?: string };
  cta: string;
  ctaHref: string;
  ctaExternal?: boolean;
};

const Gear = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9L17 7M7 17l-2.1 2.1" /></svg>
);

export default function ToolWorkspace({ config }: { config: ToolConfig }) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, string>>({});
  const [chips, setChips] = useState<Record<number, number>>({});

  const keyOf = (f: Field, i: number) => ('param' in f && f.param) ? f.param : `f${i}`;
  const setV = (k: string, v: string) => setValues((s) => ({ ...s, [k]: v }));

  const buildHref = () => {
    const params: Record<string, string> = {};
    config.fields.forEach((f, i) => {
      if (!('param' in f) || !f.param) return;
      const val = f.type === 'chips' ? f.options[chips[i] ?? 0] : (values[f.param] || '').trim();
      if (val) params[f.param] = val;
    });
    const qs = new URLSearchParams(params).toString();
    const base = config.ctaHref;
    return qs ? base + (base.includes('?') ? '&' : '?') + qs : base;
  };

  const d = config.previewData || {};
  const ratio = config.preview === 'wide' ? '16:9' : config.preview === 'square' ? '1:1' : '9:16';

  return (
    <>
      <div className="st-page-head">
        <div className="st-eyebrow">{config.eyebrow}</div>
        <h1 className="st-title">{config.title}</h1>
        <p className="st-sub">{config.sub}</p>
      </div>

      <div className="st-ws">
        <div className="st-fcard">
          <div className="st-fcard-h">{Gear} 설정</div>
          <div className="st-fcard-b">
            {config.fields.map((f, i) => {
              const k = keyOf(f, i);
              return (
                <div className="st-field" key={i}>
                  <label>{f.label}{'hint' in f && f.hint ? <span className="hint"> · {f.hint}</span> : null}</label>
                  {f.type === 'input' && <input className="st-inp" placeholder={f.placeholder} value={values[k] || ''} onChange={(e) => setV(k, e.target.value)} />}
                  {f.type === 'textarea' && <textarea className="st-inp" placeholder={f.placeholder} value={values[k] || ''} onChange={(e) => setV(k, e.target.value)} />}
                  {f.type === 'select' && (
                    <select className="st-sel" value={values[k] || ''} onChange={(e) => setV(k, e.target.value)}>
                      <option value="" disabled>선택하세요</option>
                      {f.options.map((o) => <option key={o}>{o}</option>)}
                    </select>
                  )}
                  {f.type === 'chips' && (
                    <div className="st-chips">
                      {f.options.map((o, j) => (
                        <span key={o} className={`st-chip${(chips[i] ?? 0) === j ? ' on' : ''}`} onClick={() => setChips((c) => ({ ...c, [i]: j }))}>{o}</span>
                      ))}
                    </div>
                  )}
                  {f.type === 'drop' && (
                    <div className="st-drop"><b>＋ 파일 선택</b><span>{f.text}</span></div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div className="st-fcard">
          <div className="st-fcard-b">
            <div className="st-preview-h"><span>미리보기</span><em>{ratio}</em></div>
            <div className={`st-frame ${config.preview}`}>
              {config.preview === 'vertical' && (
                <>
                  <div className="band"><small>{d.name}</small></div>
                  <div className="cap">{d.capA} <i>{d.capB}</i></div>
                  <div className="play">▶</div>
                </>
              )}
              {config.preview === 'square' && (
                <div className="logo-preview"><b>{d.name || 'BRAND'}</b><span>STUDIO</span></div>
              )}
              {config.preview === 'wide' && (
                <div className="soon-mini">완성 결과가 여기에 표시됩니다</div>
              )}
            </div>
            {config.ctaExternal ? (
              <a className="st-genbtn" href={config.ctaHref} target="_blank" rel="noreferrer">{config.cta}</a>
            ) : (
              <button className="st-genbtn" type="button" onClick={() => router.push(buildHref())}>{config.cta}</button>
            )}
            <div className="st-genhint">입력한 내용이 제작 화면에 채워지고, 거기서 최종 생성합니다</div>
          </div>
        </div>
      </div>
    </>
  );
}
