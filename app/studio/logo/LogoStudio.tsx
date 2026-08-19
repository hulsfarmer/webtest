"use client";

import { useState, useEffect } from "react";

function slugify(text: string): string {
  const first = (text || "logo").split(/\s|\n/).find((w) => w.trim().length > 0) || "logo";
  return first.replace(/[^\w가-힣-]/g, "").slice(0, 24) || "logo";
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// SVG(벡터) → PDF 변환. .ai 는 PDF 호환 포맷이라 이 PDF 를 .ai 로 저장하면
// 일러스트레이터에서 편집 가능한 벡터로 열립니다.
async function svgToPdfBlob(svgString: string): Promise<Blob> {
  const { jsPDF } = await import("jspdf");
  await import("svg2pdf.js"); // jsPDF.prototype.svg 를 주입

  const container = document.createElement("div");
  container.style.position = "fixed";
  container.style.left = "-99999px";
  container.style.top = "0";
  container.innerHTML = svgString;
  document.body.appendChild(container);
  try {
    const svgEl = container.querySelector("svg");
    if (!svgEl) throw new Error("SVG 파싱 실패");

    let width = parseFloat(svgEl.getAttribute("width") || "");
    let height = parseFloat(svgEl.getAttribute("height") || "");
    const vb = svgEl.getAttribute("viewBox");
    if ((!width || !height) && vb) {
      const p = vb.split(/[\s,]+/).map(Number);
      width = width || p[2];
      height = height || p[3];
    }
    if (!width || !height) {
      width = 512;
      height = 512;
    }

    const pdf = new jsPDF({
      unit: "pt",
      format: [width, height],
      orientation: width >= height ? "landscape" : "portrait",
    });
    await (pdf as unknown as {
      svg: (el: Element, opts: { x: number; y: number; width: number; height: number }) => Promise<unknown>;
    }).svg(svgEl, { x: 0, y: 0, width, height });
    return pdf.output("blob");
  } finally {
    document.body.removeChild(container);
  }
}

export default function LogoStudio() {
  const [brand, setBrand] = useState("");
  const [description, setDescription] = useState("");
  const [style, setStyle] = useState("flat");
  const [colors, setColors] = useState("");
  const [refs, setRefs] = useState<string[]>([]); // 참고 이미지 (data URL)

  const MAX_REFS = 4;

  const [instruction, setInstruction] = useState("");

  const [history, setHistory] = useState<string[]>([]); // 생성/수정 이력 (data URL)
  const [current, setCurrent] = useState<number>(-1);

  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [vectorizing, setVectorizing] = useState(false);
  const [exportingAi, setExportingAi] = useState(false);
  const [vectorCache, setVectorCache] = useState<Record<string, string>>({}); // image data URL → svg
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedSet, setSavedSet] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null); // 라이브러리에서 수정하러 온 로고 id

  // 라이브러리 [수정]으로 들어오면 해당 로고를 불러와 편집 시작
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem("editLogo");
      if (!raw) return;
      sessionStorage.removeItem("editLogo");
      const o = JSON.parse(raw) as { id?: string; image?: string; title?: string };
      if (o.image) {
        setHistory([o.image]);
        setCurrent(0);
        if (o.title) setBrand(o.title);
        if (o.id) setEditingId(o.id);
      }
    } catch { /* ignore */ }
  }, []);

  const image = current >= 0 ? history[current] : "";
  const isSaved = !!image && savedSet.has(image);

  async function saveToLibrary() {
    if (!image || saving || isSaved) return;
    setSaving(true);
    setError("");
    try {
      const res = editingId
        ? await fetch("/api/assets", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: editingId, image, title: brand || description }),
          })
        : await fetch("/api/assets", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ type: "logo", title: brand || description, image }),
          });
      const data = await res.json();
      if (!res.ok) setError(data.error || "저장에 실패했습니다.");
      else setSavedSet((s) => new Set(s).add(image));
    } catch {
      setError("저장 중 오류가 발생했습니다.");
    } finally {
      setSaving(false);
    }
  }

  function pushImage(dataUrl: string) {
    setHistory((h) => {
      const next = [...h, dataUrl];
      setCurrent(next.length - 1);
      return next;
    });
  }

  function addRefFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setError("");
    const room = MAX_REFS - refs.length;
    if (room <= 0) {
      setError(`참고 이미지는 최대 ${MAX_REFS}장까지 넣을 수 있어요.`);
      return;
    }
    Array.from(files)
      .slice(0, room)
      .forEach((file) => {
        if (!file.type.startsWith("image/")) return;
        const reader = new FileReader();
        reader.onload = () => {
          const url = String(reader.result || "");
          if (url) setRefs((r) => (r.length >= MAX_REFS ? r : [...r, url]));
        };
        reader.readAsDataURL(file);
      });
  }

  function removeRef(i: number) {
    setRefs((r) => r.filter((_, idx) => idx !== i));
  }

  async function generate() {
    setError("");
    if (!brand.trim() && !description.trim() && refs.length === 0) {
      setError("브랜드명·설명 또는 참고 이미지를 입력해 주세요.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/gemini/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brand, description, style, colors, refs }),
      });
      const data = await res.json();
      if (!res.ok) setError(data.error || "생성에 실패했습니다.");
      else pushImage(data.image);
    } catch {
      setError("네트워크 오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  }

  async function applyEdit() {
    setError("");
    if (!image) return;
    if (!instruction.trim()) {
      setError("수정할 내용을 입력해 주세요.");
      return;
    }
    setEditing(true);
    try {
      const res = await fetch("/api/gemini/edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image, instruction }),
      });
      const data = await res.json();
      if (!res.ok) setError(data.error || "수정에 실패했습니다.");
      else {
        pushImage(data.image);
        setInstruction("");
      }
    } catch {
      setError("네트워크 오류가 발생했습니다.");
    } finally {
      setEditing(false);
    }
  }

  // 현재 로고를 벡터(SVG)로 변환. 같은 이미지는 캐시해서 Recraft 크레딧 중복 소모 방지.
  async function getVectorSvg(): Promise<string | null> {
    if (!image) return null;
    if (vectorCache[image]) return vectorCache[image];
    const res = await fetch("/api/gemini/vectorize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "벡터 변환에 실패했습니다.");
      return null;
    }
    setVectorCache((c) => ({ ...c, [image]: data.svg }));
    return data.svg as string;
  }

  async function downloadSvg() {
    setError("");
    if (!image) return;
    setVectorizing(true);
    try {
      const svg = await getVectorSvg();
      if (!svg) return;
      triggerDownload(new Blob([svg], { type: "image/svg+xml" }), `${slugify(brand || description)}.svg`);
    } catch {
      setError("네트워크 오류가 발생했습니다.");
    } finally {
      setVectorizing(false);
    }
  }

  async function downloadAi() {
    setError("");
    if (!image) return;
    setExportingAi(true);
    try {
      const svg = await getVectorSvg();
      if (!svg) return;
      const blob = await svgToPdfBlob(svg);
      triggerDownload(blob, `${slugify(brand || description)}.ai`);
    } catch {
      setError("AI(PDF) 변환에 실패했습니다.");
    } finally {
      setExportingAi(false);
    }
  }

  const rendering = loading || editing; // 이미지를 새로 만드는 중 (이미지 자리를 스피너로 덮음)
  const busy = loading || editing || vectorizing || exportingAi; // 모든 버튼 비활성 조건

  return (
    <div className="lgm">
      <div className="header">
        <h1>
          AI 로고 스튜디오 <span className="badge">Gemini</span>
        </h1>
        <p>AI가 로고 이미지를 만들고, 자연어로 부분 수정합니다.</p>
      </div>

      <div className="grid">
        {/* 입력 */}
        <div className="card">
          <div className="field">
            <label>브랜드명</label>
            <input
              placeholder="예: 들꽃카페"
              value={brand}
              onChange={(e) => setBrand(e.target.value)}
            />
          </div>
          <div className="field">
            <label>설명 / 원하는 이미지</label>
            <textarea
              rows={4}
              placeholder="예: 시골 감성의 아늑한 카페. 들꽃과 커피잔을 부드러운 느낌으로."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div className="row">
            <div className="field">
              <label>스타일{refs.length > 0 && " (참고 이미지 우선 — 무시됨)"}</label>
              <select
                value={style}
                onChange={(e) => setStyle(e.target.value)}
                disabled={refs.length > 0}
                title={refs.length > 0 ? "참고 이미지를 넣으면 스타일 옵션은 무시되고 참고 이미지의 스타일을 따릅니다." : undefined}
                style={refs.length > 0 ? { opacity: 0.5, cursor: "not-allowed" } : undefined}
              >
                <option value="flat">플랫 일러스트</option>
                <option value="minimal">미니멀/기하학</option>
                <option value="emblem">엠블럼/뱃지</option>
                <option value="mascot">마스코트</option>
                <option value="lettermark">레터마크(이니셜)</option>
              </select>
            </div>
            <div className="field">
              <label>선호 색상 (선택)</label>
              <input
                placeholder="예: 초록, 베이지"
                value={colors}
                onChange={(e) => setColors(e.target.value)}
              />
            </div>
          </div>
          <div className="field">
            <label>참고 이미지 (선택 · 최대 {MAX_REFS}장)</label>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              {refs.map((r, i) => (
                <div key={i} style={{ position: "relative" }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={r}
                    alt={`ref${i + 1}`}
                    style={{
                      width: 56,
                      height: 56,
                      objectFit: "contain",
                      background: "#fff",
                      borderRadius: 8,
                      border: "1px solid var(--border)",
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => removeRef(i)}
                    aria-label="참고 이미지 삭제"
                    style={{
                      position: "absolute",
                      top: -6,
                      right: -6,
                      width: 18,
                      height: 18,
                      borderRadius: "50%",
                      border: "none",
                      background: "#000",
                      color: "#fff",
                      fontSize: 12,
                      lineHeight: "18px",
                      textAlign: "center",
                      cursor: "pointer",
                      padding: 0,
                    }}
                  >
                    ×
                  </button>
                </div>
              ))}
              {refs.length < MAX_REFS && (
                <label
                  style={{
                    width: 56,
                    height: 56,
                    borderRadius: 8,
                    border: "1px dashed var(--border)",
                    background: "var(--panel-2)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 22,
                    color: "#888",
                    cursor: "pointer",
                  }}
                >
                  +
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={(e) => {
                      addRefFiles(e.target.files);
                      e.target.value = "";
                    }}
                    style={{ display: "none" }}
                  />
                </label>
              )}
            </div>
            <p className="hint" style={{ marginTop: 6 }}>
              마음에 드는 로고를 올리면 그 스타일을 참고해서 만들어요. 이때 위의 <b>스타일 옵션은 무시</b>되고 참고 이미지의 스타일을 따릅니다. (학습이 아니라 이번 생성에만 반영)
            </p>
          </div>
          <button className="primary" onClick={generate} disabled={busy}>
            {loading ? "생성 중…" : "로고 생성"}
          </button>
          <p className="hint">
            Google AI Studio API 키(GEMINI_API_KEY)가 필요합니다. 무료 tier 제공.
          </p>
        </div>

        {/* 결과 + 수정 */}
        <div className="card results">
          {error && <div className="error">{error}</div>}

          {!image && !rendering && (
            <p className="hint" style={{ marginTop: 0 }}>
              왼쪽에서 정보를 입력하고 <b>로고 생성</b>을 눌러보세요.
            </p>
          )}

          {(image || rendering) && (
            <div
              style={{
                background: "#fff",
                borderRadius: 12,
                border: "1px solid var(--border)",
                aspectRatio: "1",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                overflow: "hidden",
              }}
            >
              {rendering ? (
                <span style={{ color: "#888", fontSize: 14 }}>
                  {loading ? "로고를 만드는 중…" : "수정하는 중…"}
                </span>
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={image} alt="logo" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
              )}
            </div>
          )}

          {image && !rendering && (
            <>
              <button
                className="primary"
                style={{ marginTop: 16, background: isSaved ? "var(--good, #10b981)" : undefined }}
                onClick={saveToLibrary}
                disabled={saving || isSaved}
              >
                {isSaved
                  ? (editingId ? "✓ 수정 저장됨" : "✓ 라이브러리에 저장됨")
                  : saving ? "저장 중…"
                  : (editingId ? "수정 내용 저장" : "＋ 라이브러리에 저장")}
              </button>
              <div className="field" style={{ marginTop: 16 }}>
                <label>부분 수정 (자연어)</label>
                <input
                  placeholder='예: 커피잔만 파란색으로 / 배경을 투명하게 / 꽃을 하나 더 추가'
                  value={instruction}
                  onChange={(e) => setInstruction(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && applyEdit()}
                />
              </div>
              <div style={{ display: "flex", gap: 10 }}>
                <button
                  className="primary"
                  style={{ flex: 1 }}
                  onClick={applyEdit}
                  disabled={busy}
                >
                  수정 적용
                </button>
                <a
                  href={image}
                  download={`${slugify(brand || description)}.png`}
                  style={{
                    padding: "14px 18px",
                    borderRadius: 10,
                    border: "1px solid var(--border)",
                    background: "var(--panel-2)",
                    color: "var(--text)",
                    fontWeight: 700,
                    fontSize: 14,
                    textDecoration: "none",
                    whiteSpace: "nowrap",
                    display: "inline-flex",
                    alignItems: "center",
                  }}
                >
                  PNG 저장
                </a>
                <button
                  onClick={downloadSvg}
                  disabled={busy}
                  style={{
                    padding: "14px 18px",
                    borderRadius: 10,
                    border: "1px solid var(--border)",
                    background: "var(--panel-2)",
                    color: "var(--text)",
                    fontWeight: 700,
                    fontSize: 14,
                    whiteSpace: "nowrap",
                    cursor: "pointer",
                  }}
                >
                  {vectorizing ? "변환 중…" : "SVG 저장"}
                </button>
                <button
                  onClick={downloadAi}
                  disabled={busy}
                  style={{
                    padding: "14px 18px",
                    borderRadius: 10,
                    border: "1px solid var(--border)",
                    background: "var(--panel-2)",
                    color: "var(--text)",
                    fontWeight: 700,
                    fontSize: 14,
                    whiteSpace: "nowrap",
                    cursor: "pointer",
                  }}
                >
                  {exportingAi ? "변환 중…" : "AI 저장"}
                </button>
              </div>
              <p className="hint">
                SVG·AI 저장은 현재 로고를 벡터로 변환합니다 (건당 약 10 Recraft 크레딧, 같은 로고는 재변환 없이 캐시).
                <br />
                <b>AI</b>는 인쇄·현수막·간판용 벡터 파일(PDF 호환)로, 일러스트레이터에서 편집 가능하게 열립니다.
              </p>

              {/* 이력 (되돌리기) */}
              {history.length > 1 && (
                <>
                  <label style={{ marginTop: 16 }}>이력 (클릭해서 되돌리기)</label>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {history.map((h, i) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        key={i}
                        src={h}
                        alt={`v${i + 1}`}
                        onClick={() => setCurrent(i)}
                        style={{
                          width: 56,
                          height: 56,
                          objectFit: "contain",
                          background: "#fff",
                          borderRadius: 8,
                          cursor: "pointer",
                          border:
                            i === current
                              ? "2px solid var(--accent)"
                              : "1px solid var(--border)",
                        }}
                      />
                    ))}
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
