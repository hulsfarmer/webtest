"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { BANNER_SAFE_AREA_GUIDANCE } from "@/lib/logomaker/youtube";

const MAX_REFS = 4;

type Kind = "banner" | "profile";

// 프로필 스타일 옵션 (사용자 선택)
const PROFILE_STYLES: { id: string; label: string; desc: string }[] = [
  { id: "mascot", label: "마스코트", desc: "귀여운 캐릭터 얼굴" },
  { id: "emblem", label: "엠블럼", desc: "심볼·배지형 마크" },
  { id: "minimal", label: "미니멀 아이콘", desc: "단순한 플랫 아이콘" },
  { id: "lettermark", label: "레터마크", desc: "이니셜·모노그램" },
];

// 유튜브 규격
const SPEC: Record<Kind, { w: number; h: number; label: string }> = {
  banner: { w: 2048, h: 1152, label: "2048 × 1152 (16:9)" },
  profile: { w: 800, h: 800, label: "800 × 800 (1:1)" },
};

// 안전영역(모든 기기 표시) 비율 — 2048x1152 기준 1235x338
const SAFE = { wRatio: 1235 / 2048, hRatio: 338 / 1152 };

function slugify(text: string, fallback: string): string {
  const first = (text || fallback).split(/\s|\n/).find((w) => w.trim().length > 0) || fallback;
  return first.replace(/[^\w가-힣-]/g, "").slice(0, 24) || fallback;
}

// 생성 이미지를 정확한 목표 크기로 맞춰(cover) PNG data URL 반환 — 유튜브 최소 규격 보장.
function normalizeToSize(dataUrl: string, targetW: number, targetH: number): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = targetW;
      canvas.height = targetH;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        resolve(dataUrl);
        return;
      }
      const iw = img.naturalWidth;
      const ih = img.naturalHeight;
      const scale = Math.max(targetW / iw, targetH / ih);
      const dw = iw * scale;
      const dh = ih * scale;
      const dx = (targetW - dw) / 2;
      const dy = (targetH - dh) / 2;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, dx, dy, dw, dh);
      resolve(canvas.toDataURL("image/png"));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

function triggerDownload(dataUrl: string, filename: string) {
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

// 배너 문구를 안전영역(2048x1152 기준 가운데 1235x338) 안에 코드로 정확히 합성한다.
// 폭에 맞춰 폰트를 자동 축소하고, 글자 뒤에 부드러운 스크림(그라데이션)을 깔아
// 배경과 겹쳐 보이지 않고 항상 읽히게 한다. (AI가 아니라 우리가 그리므로 위치·맞춤법 보장)
const FONT_FAMILY = '"Apple SD Gothic Neo", Pretendard, "Noto Sans KR", system-ui, sans-serif';

function composeBanner(
  bgDataUrl: string,
  headline: string,
  subtext: string,
  light: boolean
): Promise<string> {
  return new Promise((resolve) => {
    const W = 2048,
      H = 1152;
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = W;
      canvas.height = H;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        resolve(bgDataUrl);
        return;
      }
      // 배경 cover
      const iw = img.naturalWidth,
        ih = img.naturalHeight;
      const s = Math.max(W / iw, H / ih);
      ctx.drawImage(img, (W - iw * s) / 2, (H - ih * s) / 2, iw * s, ih * s);

      const title = (headline || "").trim();
      const sub = (subtext || "").trim();
      if (!title && !sub) {
        resolve(canvas.toDataURL("image/png"));
        return;
      }

      const safeW = 1235,
        safeH = 338;
      const cx = W / 2,
        cy = H / 2;
      const maxW = safeW * 0.94;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      const fit = (text: string, weight: number, cap: number) => {
        for (let size = cap; size > 14; size -= 2) {
          ctx.font = `${weight} ${size}px ${FONT_FAMILY}`;
          if (ctx.measureText(text).width <= maxW) return size;
        }
        return 14;
      };

      let titleSize = title ? fit(title, 700, 150) : 0;
      let subSize = sub ? fit(sub, 600, 56) : 0;
      let gap = title && sub ? Math.round(titleSize * 0.24) : 0;
      let blockH = (title ? titleSize : 0) + gap + (sub ? subSize : 0);
      // 안전영역 세로를 넘으면 전체 축소
      if (blockH > safeH * 0.9) {
        const k = (safeH * 0.9) / blockH;
        titleSize = Math.floor(titleSize * k);
        subSize = Math.floor(subSize * k);
        gap = Math.floor(gap * k);
        blockH = safeH * 0.9;
      }

      // 밝은 글자: 배경을 어둡게 하지 않고 글자 테두리(외곽선)로만 가독성 확보.
      // 어두운 글자: 밝은 배경 위에서 읽히도록 옅은 흰색 스크림을 깐다.
      if (!light) {
        const padY = Math.round(blockH * 0.6) + 48;
        const bandTop = Math.max(0, cy - blockH / 2 - padY);
        const bandBot = Math.min(H, cy + blockH / 2 + padY);
        const grad = ctx.createLinearGradient(0, bandTop, 0, bandBot);
        grad.addColorStop(0, "rgba(255,255,255,0)");
        grad.addColorStop(0.5, "rgba(255,255,255,0.55)");
        grad.addColorStop(1, "rgba(255,255,255,0)");
        ctx.fillStyle = grad;
        ctx.fillRect(0, bandTop, W, bandBot - bandTop);
      }

      // 글자
      const titleColor = light ? "#ffffff" : "#141414";
      const subColor = light ? "#e9c46a" : "#5b4a12";
      // 밝은 글자는 스크림이 없으므로 외곽선을 더 선명·굵게 (바쁜 배경에서도 또렷하게)
      const strokeColor = light ? "rgba(0,0,0,0.9)" : "rgba(255,255,255,0.5)";
      const strokeK = light ? 0.07 : 0.045;
      let y = cy - blockH / 2;
      if (title) {
        const ts = titleSize;
        ctx.font = `700 ${ts}px ${FONT_FAMILY}`;
        y += ts / 2;
        ctx.lineJoin = "round";
        ctx.miterLimit = 2;
        ctx.lineWidth = Math.max(4, ts * strokeK);
        ctx.strokeStyle = strokeColor;
        ctx.strokeText(title, cx, y);
        ctx.fillStyle = titleColor;
        ctx.fillText(title, cx, y);
        y += ts / 2 + gap;
      }
      if (sub) {
        const ss = subSize;
        ctx.font = `600 ${ss}px ${FONT_FAMILY}`;
        y += ss / 2;
        ctx.lineJoin = "round";
        ctx.miterLimit = 2;
        ctx.lineWidth = Math.max(3, ss * strokeK);
        ctx.strokeStyle = strokeColor;
        ctx.strokeText(sub, cx, y);
        ctx.fillStyle = subColor;
        ctx.fillText(sub, cx, y);
      }
      resolve(canvas.toDataURL("image/png"));
    };
    img.onerror = () => resolve(bgDataUrl);
    img.src = bgDataUrl;
  });
}

// 참고 이미지를 업로드 시 축소·압축 (스타일 참고용이라 원본 해상도 불필요).
// 큰 사진을 그대로 base64로 보내면 요청 용량 한도를 넘겨 413이 난다.
function downscaleImageFile(file: File, maxSide = 1024, quality = 0.85): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const src = String(reader.result || "");
      const img = new Image();
      img.onload = () => {
        const iw = img.naturalWidth;
        const ih = img.naturalHeight;
        const scale = Math.min(1, maxSide / Math.max(iw, ih));
        const w = Math.max(1, Math.round(iw * scale));
        const h = Math.max(1, Math.round(ih * scale));
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve(src);
          return;
        }
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.onerror = () => reject(new Error("이미지를 읽지 못했어요."));
      img.src = src;
    };
    reader.onerror = () => reject(new Error("파일을 읽지 못했어요."));
    reader.readAsDataURL(file);
  });
}

type ApiResult = { image?: string; error?: string };

// fetch + 안전한 JSON 파싱. 서버가 JSON이 아닌 응답(504/500 HTML 등)을 줘도
// 진짜 원인을 사용자에게 보여준다. (기존엔 res.json() 실패가 "네트워크 오류"로 뭉개졌음)
async function callApi(url: string, payload: unknown): Promise<ApiResult> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    return { error: "요청을 보내지 못했어요. 인터넷 연결을 확인해 주세요." };
  }
  let raw = "";
  try {
    raw = await res.text();
  } catch {
    return { error: "응답을 받지 못했어요. 잠시 후 다시 시도해 주세요." };
  }
  let data: ApiResult | null = null;
  try {
    data = raw ? (JSON.parse(raw) as ApiResult) : null;
  } catch {
    data = null;
  }
  if (!res.ok || !data) {
    if (res.status === 504 || res.status === 408 || res.status === 524) {
      return { error: "생성이 시간 내에 끝나지 않았어요(시간 초과). 설명을 조금 줄이거나 잠시 후 다시 시도해 주세요." };
    }
    if (res.status === 413) {
      return { error: "참고 이미지 용량이 너무 커요. 더 작은 이미지를 사용해 주세요." };
    }
    return { error: (data && data.error) || `서버 오류가 발생했어요 (HTTP ${res.status}). 다시 시도해 주세요.` };
  }
  return data;
}

export default function YouTubeStudio() {
  const [kind, setKind] = useState<Kind>("banner");
  const [headline, setHeadline] = useState("");
  const [subtext, setSubtext] = useState("");
  const [description, setDescription] = useState("");
  const [colors, setColors] = useState("");
  const [refs, setRefs] = useState<string[]>([]);
  const [showSafe, setShowSafe] = useState(true);
  const [lightText, setLightText] = useState(true); // 밝은 글자(어두운 배경용)
  const [profileStyle, setProfileStyle] = useState("mascot"); // 프로필 스타일

  const [history, setHistory] = useState<string[]>([]);
  const [current, setCurrent] = useState<number>(-1);
  const [composed, setComposed] = useState("");

  const [instruction, setInstruction] = useState("");
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState("");

  const image = current >= 0 ? history[current] : ""; // 배너에선 "배경 아트"
  const rendering = loading || editing;
  const busy = loading || editing;
  const spec = SPEC[kind];
  // 화면·저장 이미지: 배너는 문구 합성본, 프로필은 원본
  const viewImage = kind === "banner" ? composed || image : image;

  // 배경/문구/글자색이 바뀌면 배너 문구를 다시 합성 (재생성 없이 문구만 수정 가능)
  useEffect(() => {
    let cancelled = false;
    if (kind === "banner" && image) {
      composeBanner(image, headline, subtext, lightText).then((url) => {
        if (!cancelled) setComposed(url);
      });
    } else {
      setComposed("");
    }
    return () => {
      cancelled = true;
    };
  }, [kind, image, headline, subtext, lightText]);

  function pushImage(dataUrl: string) {
    setHistory((h) => {
      const next = [...h, dataUrl];
      setCurrent(next.length - 1);
      return next;
    });
  }

  function switchKind(k: Kind) {
    if (k === kind) return;
    setKind(k);
    setHistory([]);
    setCurrent(-1);
    setComposed("");
    setError("");
    setInstruction("");
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
      .forEach(async (file) => {
        if (!file.type.startsWith("image/")) return;
        try {
          const url = await downscaleImageFile(file);
          if (url) setRefs((r) => (r.length >= MAX_REFS ? r : [...r, url]));
        } catch {
          setError("참고 이미지를 불러오지 못했어요. 다른 이미지를 사용해 주세요.");
        }
      });
  }

  function removeRef(i: number) {
    setRefs((r) => r.filter((_, idx) => idx !== i));
  }

  async function generate() {
    setError("");
    if (!headline.trim() && !subtext.trim() && !description.trim() && refs.length === 0) {
      setError("채널 이름·설명 또는 참고 이미지를 입력해 주세요.");
      return;
    }
    setLoading(true);
    const data = await callApi("/api/gemini/youtube", {
      kind,
      headline,
      subtext,
      description,
      colors,
      refs,
      style: kind === "profile" ? profileStyle : undefined,
    });
    if (data.error || !data.image) {
      setError(data.error || "생성에 실패했습니다.");
    } else {
      const finalImg = await normalizeToSize(data.image, spec.w, spec.h);
      pushImage(finalImg);
    }
    setLoading(false);
  }

  async function applyEdit() {
    setError("");
    if (!image) return;
    if (!instruction.trim()) {
      setError("수정할 내용을 입력해 주세요.");
      return;
    }
    setEditing(true);
    const data = await callApi("/api/gemini/edit", {
      image,
      instruction,
      context: kind === "banner" ? BANNER_SAFE_AREA_GUIDANCE : undefined,
    });
    if (data.error || !data.image) {
      setError(data.error || "수정에 실패했습니다.");
    } else {
      const finalImg = await normalizeToSize(data.image, spec.w, spec.h);
      pushImage(finalImg);
      setInstruction("");
    }
    setEditing(false);
  }

  const fname = `${slugify(headline || description, kind === "banner" ? "banner" : "profile")}_${kind}.png`;

  return (
    <div className="lgm">
      <div className="header">
        <h1>
          유튜브 채널 아트 <span className="badge">Gemini</span>
        </h1>
        <p>
          채널 배너(2048×1152)와 프로필(800×800)을 만들어요. 배너는 AI가 <b>글자 없는 배경</b>을 그리고,
          채널 이름·태그라인은 앱이 <b>모든 기기 표시 안전영역</b> 안에 정확히 얹어 항상 안 잘리게 합니다.
          프로필은 로고 엔진으로 원형에 맞게 만들어요.{" "}
          <Link href="/" style={{ color: "var(--accent)", textDecoration: "underline" }}>
            ← 로고 스튜디오
          </Link>
        </p>
      </div>

      {/* 모드 탭 */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        {(["banner", "profile"] as Kind[]).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => switchKind(k)}
            style={{
              padding: "10px 18px",
              borderRadius: 10,
              border: k === kind ? "1px solid var(--accent)" : "1px solid var(--border)",
              background: k === kind ? "var(--accent)" : "var(--panel-2)",
              color: k === kind ? "#fff" : "var(--text)",
              fontWeight: 700,
              fontSize: 14,
              cursor: "pointer",
            }}
          >
            {k === "banner" ? "채널 배너" : "프로필 사진"}
          </button>
        ))}
        <span className="hint" style={{ alignSelf: "center", marginLeft: 4 }}>
          {spec.label}
        </span>
      </div>

      <div className="grid">
        {/* 입력 */}
        <div className="card">
          <div className="field">
            <label>채널 이름 {kind === "profile" ? "(선택)" : ""}</label>
            <input
              placeholder="예: 경이로운 코스모스"
              value={headline}
              onChange={(e) => setHeadline(e.target.value)}
            />
          </div>

          {kind === "banner" && (
            <div className="field">
              <label>태그라인 (선택)</label>
              <input
                placeholder="예: 우주와 과학, 그리고 우리에 대한 이야기"
                value={subtext}
                onChange={(e) => setSubtext(e.target.value)}
              />
            </div>
          )}

          {kind === "profile" && (
            <div className="field">
              <label>스타일</label>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {PROFILE_STYLES.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setProfileStyle(s.id)}
                    title={s.desc}
                    style={{
                      padding: "8px 12px",
                      borderRadius: 8,
                      border: profileStyle === s.id ? "1px solid var(--accent)" : "1px solid var(--border)",
                      background: profileStyle === s.id ? "var(--accent)" : "var(--panel-2)",
                      color: profileStyle === s.id ? "#fff" : "var(--text)",
                      fontSize: 13,
                      fontWeight: 700,
                      cursor: "pointer",
                    }}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
              <p className="hint" style={{ marginTop: 6 }}>
                {PROFILE_STYLES.find((s) => s.id === profileStyle)?.desc}
                {profileStyle === "lettermark" && " · 한글 이니셜은 AI가 다르게 그릴 수 있어요"}
              </p>
            </div>
          )}

          <div className="field">
            <label>컨셉 / 배경 설명</label>
            <textarea
              rows={3}
              placeholder={
                kind === "banner"
                  ? "예: 깊은 우주 딥필드 배경, 토성형 금빛 행성 엠블럼, 시네마틱하고 경이로운 분위기."
                  : "예: 금빛 링을 두른 토성형 행성, 어두운 우주 배경, 심플하고 또렷한 엠블럼."
              }
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <div className="field">
            <label>선호 색상 (선택)</label>
            <input
              placeholder="예: 금색, 크림색, 딥 네이비"
              value={colors}
              onChange={(e) => setColors(e.target.value)}
            />
          </div>

          {/* 참고 이미지 */}
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
              방금 만든 프로필을 참고 이미지로 넣으면 배너와 스타일을 맞출 수 있어요.
            </p>
          </div>

          {kind === "banner" && (
            <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, cursor: "pointer" }}>
              <input type="checkbox" checked={lightText} onChange={(e) => setLightText(e.target.checked)} />
              <span className="hint" style={{ margin: 0 }}>밝은 글자 (어두운 배경용 · 끄면 어두운 글자)</span>
            </label>
          )}

          <button className="primary" onClick={generate} disabled={busy}>
            {loading ? "생성 중…" : kind === "banner" ? "배경 생성" : "프로필 생성"}
          </button>
          <p className="hint">
            {kind === "banner"
              ? "채널 이름·태그라인은 앱이 안전영역 안에 정확히 얹어요. 위 입력칸을 고치면 재생성 없이 바로 반영됩니다. 배경만 다시 뽑고 싶으면 배경 생성을 다시 누르세요."
              : "문구(특히 한글)는 AI가 글자를 미세하게 다르게 그릴 수 있어요. 어긋나면 아래에서 수정하거나 다시 생성하세요."}
          </p>
        </div>

        {/* 결과 + 수정 */}
        <div className="card results">
          {error && <div className="error">{error}</div>}

          {!image && !rendering && (
            <p className="hint" style={{ marginTop: 0 }}>
              왼쪽에서 내용을 입력하고 <b>{kind === "banner" ? "배너 생성" : "프로필 생성"}</b>을 눌러보세요.
            </p>
          )}

          {(image || rendering) && (
            <>
              {kind === "banner" ? (
                <div
                  style={{
                    position: "relative",
                    background: "#000",
                    borderRadius: 12,
                    border: "1px solid var(--border)",
                    aspectRatio: "2048 / 1152",
                    width: "100%",
                    overflow: "hidden",
                  }}
                >
                  {rendering ? (
                    <div style={centerFill}>
                      <span style={{ color: "#888", fontSize: 14 }}>
                        {loading ? "배너를 만드는 중…" : "수정하는 중…"}
                      </span>
                    </div>
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={viewImage} alt="banner" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  )}
                  {/* 안전영역 가이드 */}
                  {showSafe && !rendering && (
                    <div
                      style={{
                        position: "absolute",
                        left: `${((1 - SAFE.wRatio) / 2) * 100}%`,
                        top: `${((1 - SAFE.hRatio) / 2) * 100}%`,
                        width: `${SAFE.wRatio * 100}%`,
                        height: `${SAFE.hRatio * 100}%`,
                        border: "2px dashed rgba(255,255,255,0.9)",
                        boxShadow: "0 0 0 100vmax rgba(0,0,0,0.28)",
                        borderRadius: 4,
                        pointerEvents: "none",
                      }}
                    >
                      <span
                        style={{
                          position: "absolute",
                          top: -22,
                          left: 0,
                          fontSize: 11,
                          color: "#fff",
                          background: "rgba(0,0,0,0.6)",
                          padding: "2px 6px",
                          borderRadius: 4,
                          whiteSpace: "nowrap",
                        }}
                      >
                        모든 기기 표시 안전영역 (문구는 이 안에)
                      </span>
                    </div>
                  )}
                </div>
              ) : (
                // 프로필: 정사각 + 원형 미리보기
                <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
                  <div
                    style={{
                      position: "relative",
                      background: "#000",
                      borderRadius: 12,
                      border: "1px solid var(--border)",
                      width: 220,
                      height: 220,
                      overflow: "hidden",
                      flex: "0 0 auto",
                    }}
                  >
                    {rendering ? (
                      <div style={centerFill}>
                        <span style={{ color: "#888", fontSize: 14 }}>
                          {loading ? "프로필을 만드는 중…" : "수정하는 중…"}
                        </span>
                      </div>
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={image} alt="profile" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    )}
                  </div>
                  {!rendering && image && (
                    <div style={{ textAlign: "center" }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={image}
                        alt="profile circle"
                        style={{
                          width: 120,
                          height: 120,
                          borderRadius: "50%",
                          objectFit: "cover",
                          border: "1px solid var(--border)",
                        }}
                      />
                      <div className="hint" style={{ marginTop: 6 }}>원형 표시 미리보기</div>
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {image && !rendering && (
            <>
              {kind === "banner" && (
                <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, cursor: "pointer" }}>
                  <input type="checkbox" checked={showSafe} onChange={(e) => setShowSafe(e.target.checked)} />
                  <span className="hint" style={{ margin: 0 }}>안전영역 가이드 표시 (저장 이미지엔 포함 안 됨)</span>
                </label>
              )}

              <div className="field" style={{ marginTop: 12 }}>
                <label>{kind === "banner" ? "배경 수정 (자연어)" : "수정 (자연어)"}</label>
                <input
                  placeholder={
                    kind === "banner"
                      ? "예: 배경을 더 어둡게 / 은하를 더 크게 / 오른쪽에 성운 추가 (글자는 위 입력칸에서 수정)"
                      : "예: 링을 더 굵게 / 배경을 더 어둡게 / 조금 더 심플하게"
                  }
                  value={instruction}
                  onChange={(e) => setInstruction(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && applyEdit()}
                />
                {kind === "banner" && (
                  <p className="hint" style={{ marginTop: 4 }}>
                    채널 이름·태그라인은 왼쪽 입력칸에서 바로 고치면 돼요(항상 안전영역 안). 이 칸은 <b>배경 그림</b>만 수정합니다.
                  </p>
                )}
              </div>
              <div style={{ display: "flex", gap: 10 }}>
                <button className="primary" style={{ flex: 1 }} onClick={applyEdit} disabled={busy}>
                  수정 적용
                </button>
                <a
                  href={viewImage}
                  download={fname}
                  onClick={(e) => {
                    e.preventDefault();
                    triggerDownload(viewImage, fname);
                  }}
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
              </div>
              <p className="hint" style={{ marginTop: 8 }}>
                저장 크기: <b>{spec.w} × {spec.h}</b> — 유튜브 {kind === "banner" ? "배너" : "프로필"} 규격에 맞춰 내보냅니다.
              </p>

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
                          height: 40,
                          objectFit: "contain",
                          background: "#000",
                          borderRadius: 8,
                          cursor: "pointer",
                          border: i === current ? "2px solid var(--accent)" : "1px solid var(--border)",
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

const centerFill: React.CSSProperties = {
  position: "absolute",
  inset: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};
