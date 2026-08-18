'use client';

import { useState } from 'react';
import Link from 'next/link';

export type Field =
  | { type: 'input' | 'textarea'; label: string; placeholder: string; hint?: string }
  | { type: 'select'; label: string; options: string[] }
  | { type: 'chips'; label: string; options: string[] }
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

function Preview({ config }: { config: ToolConfig }) {
  const d = config.previewData || {};
  const ratio = config.preview === 'wide' ? '16:9' : config.preview === 'square' ? '1:1' : '9:16';
  return (
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
          <Link className="st-genbtn" href={config.ctaHref}>{config.cta}</Link>
        )}
        <div className="st-genhint">입력을 채우고 제작 화면으로 이동해 생성합니다</div>
      </div>
    </div>
  );
}

export default function ToolWorkspace({ config }: { config: ToolConfig }) {
  const [chips, setChips] = useState<Record<number, number>>({});

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
            {config.fields.map((f, i) => (
              <div className="st-field" key={i}>
                <label>{f.label}{'hint' in f && f.hint ? <span className="hint"> · {f.hint}</span> : null}</label>
                {f.type === 'input' && <input className="st-inp" placeholder={f.placeholder} />}
                {f.type === 'textarea' && <textarea className="st-inp" placeholder={f.placeholder} />}
                {f.type === 'select' && (
                  <select className="st-sel" defaultValue="">
                    <option value="" disabled>선택하세요</option>
                    {f.options.map((o) => <option key={o}>{o}</option>)}
                  </select>
                )}
                {f.type === 'chips' && (
                  <div className="st-chips">
                    {f.options.map((o, j) => (
                      <span
                        key={o}
                        className={`st-chip${(chips[i] ?? 0) === j ? ' on' : ''}`}
                        onClick={() => setChips((c) => ({ ...c, [i]: j }))}
                      >{o}</span>
                    ))}
                  </div>
                )}
                {f.type === 'drop' && (
                  <div className="st-drop"><b>＋ 파일 선택</b><span>{f.text}</span></div>
                )}
              </div>
            ))}
          </div>
        </div>

        <Preview config={config} />
      </div>
    </>
  );
}
