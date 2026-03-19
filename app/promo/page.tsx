'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Megaphone, ArrowLeft, Download, Check, Loader2, AlertCircle, ChevronDown, Phone, MapPin, Sparkles, ImagePlus, X, Edit3, RefreshCw, Music2, Settings2, Upload, Volume2, MessageSquarePlus } from 'lucide-react';
import ReviewModal from '@/components/ReviewModal';
import { BGM_CATALOG, recommendBgm, type BgmId } from '@/lib/bgm-catalog';

type VideoScript = {
  title: string;
  hashtags: string[];
  sections: Array<{ type: string; text: string; duration: number }>;
  totalDuration: number;
  bgKeyword: string;
};

type StepStatus = 'pending' | 'running' | 'done' | 'failed';

interface JobStatus {
  id: string;
  status: string;
  progress: number;
  steps: {
    script: StepStatus;
    audio: StepStatus;
    video: StepStatus;
  };
  videoUrl?: string;
  script?: {
    title: string;
    hashtags: string[];
    sections: Array<{ type: string; text: string; duration: number }>;
    totalDuration: number;
    bgKeyword: string;
  };
  error?: string;
}

interface UsageInfo {
  plan: string;
  used: number;
  limit: number | null;
  remaining: number;
}

const BUSINESS_TYPES = [
  '카페 · 커피숍',
  '음식점 · 식당',
  '학원 · 교육',
  '헬스장 · 피트니스',
  '병원 · 의원',
  '뷰티 · 미용',
  '쇼핑 · 의류',
  '부동산',
  '숙박 · 펜션',
  '기타',
];

const TONES = [
  { id: '친근한',   label: '친근한',   emoji: '😊' },
  { id: '전문적인', label: '전문적인', emoji: '💼' },
  { id: '긴급한',   label: '긴급한',   emoji: '🔥', desc: '특가·한정' },
  { id: '따뜻한',   label: '따뜻한',   emoji: '🤝' },
];

const VOICES = [
  // Chirp3-HD (최신, 가장 자연스러운)
  { id: 'ko-KR-Chirp3-HD-Zephyr', label: '수아',   desc: '여성 · 활기찬',     badge: '추천' },
  { id: 'ko-KR-Chirp3-HD-Aoede',  label: '지은',   desc: '여성 · 자연스러운', badge: '' },
  { id: 'ko-KR-Chirp3-HD-Charon', label: '민준',   desc: '남성 · 자연스러운', badge: '' },
  // Neural2 (안정적, 경제적)
  { id: 'ko-KR-Neural2-A',        label: '서연',   desc: '여성 · 차분한',     badge: '' },
  { id: 'ko-KR-Neural2-B',        label: '하나',   desc: '여성 · 부드러운',   badge: '' },
  { id: 'ko-KR-Neural2-C',        label: '도윤',   desc: '남성 · 밝은',       badge: '' },
];

const SPEEDS = [
  { value: 0.9, label: '0.9×', desc: '천천히' },
  { value: 1.0, label: '1.0×', desc: '보통' },
  { value: 1.1, label: '1.1×', desc: '약간 빠르게' },
  { value: 1.2, label: '1.2×', desc: '빠르게' },
];

const DURATIONS = [
  { value: 30, label: '30초' },
  { value: 60, label: '60초' },
];

const STEP_LABELS: Record<string, string> = {
  script: 'AI 홍보 스크립트 생성',
  audio: '한국어 음성 생성',
  video: '영상 합성',
};

const VIDEO_SUB_STEPS = [
  { at: 0,  msg: '이미지 준비 중...' },
  { at: 15, msg: '영상 렌더링 중...' },
  { at: 50, msg: '음악 합성 중...' },
  { at: 80, msg: '마무리 중...' },
];

const MAX_IMAGES = 5;
const MIN_IMAGES = 4;

function StepIndicator({ label, status, subMessage }: { label: string; status: StepStatus; subMessage?: string }) {
  return (
    <div className={`flex items-center gap-3 p-4 rounded-xl transition-all ${
      status === 'running' ? 'bg-emerald-500/10 border border-emerald-500/30' :
      status === 'done'    ? 'bg-green-500/10 border border-green-500/20' :
      status === 'failed'  ? 'bg-red-500/10 border border-red-500/20' :
      'bg-white/3 border border-white/5'
    }`}>
      <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
        status === 'running' ? 'bg-emerald-500/20' :
        status === 'done'    ? 'bg-green-500/20' :
        status === 'failed'  ? 'bg-red-500/20' :
        'bg-white/5'
      }`}>
        {status === 'running' && <Loader2 className="w-4 h-4 text-emerald-400 animate-spin" />}
        {status === 'done'    && <Check   className="w-4 h-4 text-green-400" />}
        {status === 'failed'  && <AlertCircle className="w-4 h-4 text-red-400" />}
        {status === 'pending' && <div className="w-2 h-2 rounded-full bg-gray-600" />}
      </div>
      <div className="flex flex-col">
        <span className={`font-medium text-sm ${
          status === 'running' ? 'text-emerald-300' :
          status === 'done'    ? 'text-green-300' :
          status === 'failed'  ? 'text-red-300' :
          'text-gray-500'
        }`}>
          {label}
        </span>
        {status === 'running' && subMessage && (
          <span className="text-xs text-emerald-400/70 mt-0.5">{subMessage}</span>
        )}
      </div>
      {status === 'running' && <span className="ml-auto text-xs text-emerald-400 animate-pulse">처리 중...</span>}
      {status === 'done'    && <span className="ml-auto text-xs text-green-400">완료</span>}
    </div>
  );
}

export default function PromoPage() {
  const { data: authSession } = useSession();
  const searchParams = useSearchParams();
  const [businessName, setBusinessName]     = useState('');
  const [businessType, setBusinessType]     = useState('');
  const [sellingPoints, setSellingPoints]   = useState('');
  const [contact, setContact]               = useState('');
  const [location, setLocation]             = useState('');
  const [cta, setCta]                       = useState('');
  const [duration, setDuration]             = useState(60);
  const [tone, setTone]                     = useState('친근한');
  const [voice, setVoice]                   = useState('ko-KR-Chirp3-HD-Zephyr');
  const [speed, setSpeed]                   = useState(1.0);
  const [showAdvanced, setShowAdvanced]     = useState(false);
  const [bgmId, setBgmId]                   = useState<BgmId>('cafe');
  const [bgmVolume, setBgmVolume]           = useState(20);
  const [customBgm, setCustomBgm]           = useState<File | null>(null);
  const [customBgmName, setCustomBgmName]   = useState('');
  const bgmInputRef                         = useRef<HTMLInputElement>(null);

  // Image upload state
  const [images, setImages]                 = useState<File[]>([]);
  const [imagePreviews, setImagePreviews]   = useState<string[]>([]);
  const [isDragging, setIsDragging]         = useState(false);
  const fileInputRef                        = useRef<HTMLInputElement>(null);

  // Upload & section state
  const [uploadId, setUploadId]             = useState<string | null>(null);
  const [sectionImages, setSectionImages]   = useState<(File | null)[]>([]);
  const [sectionPreviews, setSectionPreviews] = useState<(string | null)[]>([]);
  const [pickerSection, setPickerSection]   = useState<number>(-1);

  const [jobId, setJobId]                   = useState<string | null>(null);
  const [jobStatus, setJobStatus]           = useState<JobStatus | null>(null);
  const [loading, setLoading]               = useState(false);
  const [error, setError]                   = useState<string | null>(null);
  const [usage, setUsage]                   = useState<UsageInfo | null>(null);
  const [showScript, setShowScript]         = useState(false);
  const [scriptDraft, setScriptDraft]       = useState<VideoScript | null>(null);
  const [loadingScript, setLoadingScript]   = useState(false);
  const pollRef   = useRef<NodeJS.Timeout | null>(null);
  const [downloaded, setDownloaded] = useState(false);
  const [showReviewModal, setShowReviewModal] = useState(false);
  const [reviewSubmitted, setReviewSubmitted] = useState(false);

  // Fake progress for video step
  const [fakeProgress, setFakeProgress] = useState(0);
  const [videoSubMsg, setVideoSubMsg] = useState('');
  const fakeTimerRef = useRef<NodeJS.Timeout | null>(null);
  const videoStartedRef = useRef(false);

  // 히스토리에서 스크립트 수정/재생성으로 온 경우 입력값 복원
  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current) return;
    const scriptParam = searchParams.get('script');
    const bnParam = searchParams.get('businessName');
    const topicParam = searchParams.get('topic');
    const durParam = searchParams.get('duration');
    const toneParam = searchParams.get('tone');
    const imageJobId = searchParams.get('imageJobId');

    if (scriptParam || bnParam) {
      restoredRef.current = true;
      if (bnParam) setBusinessName(bnParam);
      if (topicParam) setSellingPoints(topicParam);
      if (durParam) setDuration(Number(durParam) || 60);
      if (toneParam) setTone(toneParam);
      if (scriptParam) {
        try {
          const parsed = JSON.parse(scriptParam) as VideoScript;
          setScriptDraft(parsed);
          // Initialize section images for the restored script
          const n = parsed.sections?.length || 0;
          setSectionImages(Array.from({ length: n }, () => null));
          setSectionPreviews(Array.from({ length: n }, () => null));
        } catch { /* ignore parse errors */ }
      }

      // 이전 영상의 이미지 복원
      if (imageJobId) {
        (async () => {
          try {
            const listRes = await fetch(`/api/images/${imageJobId}`);
            if (!listRes.ok) {
              console.warn('[ImageRestore] 이미지 목록 조회 실패:', listRes.status);
              return;
            }
            const listData = await listRes.json() as { images?: string[] };
            if (!listData.images || listData.images.length === 0) return;

            const files: File[] = [];
            const previews: string[] = [];
            for (let i = 0; i < listData.images.length; i++) {
              try {
                const imgRes = await fetch(listData.images[i]);
                if (!imgRes.ok) continue;
                const blob = await imgRes.blob();
                const file = new File([blob], `restored_${i}.jpg`, { type: blob.type || 'image/jpeg' });
                files.push(file);
                previews.push(URL.createObjectURL(file));
              } catch { /* skip failed image */ }
            }
            if (files.length > 0) {
              setImages(files);
              setImagePreviews(previews);
              if (scriptParam) {
                try {
                  const parsed = JSON.parse(scriptParam) as VideoScript;
                  const n = parsed.sections?.length || 0;
                  setSectionImages(Array.from({ length: n }, (_, idx) => files[idx] ?? null));
                  setSectionPreviews(Array.from({ length: n }, (_, idx) => previews[idx] ?? null));
                } catch { /* ignore */ }
              }
            }
          } catch (err) {
            console.warn('[ImageRestore] 이미지 복원 실패:', err);
          }
        })();
      }

      // URL에서 파라미터 제거 (뒤로가기 시 재트리거 방지)
      window.history.replaceState({}, '', '/promo');
    }
  }, [searchParams]);

  useEffect(() => {
    if (authSession?.user?.id) {
      fetchUsage();
    }
  }, [authSession]);

  // Clean up object URLs on unmount
  useEffect(() => {
    return () => {
      imagePreviews.forEach(url => URL.revokeObjectURL(url));
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // BGM별 기본 볼륨 (calm/trendy는 소리가 작아서 높게)
  const getDefaultVolume = (id: string) =>
    (id === 'calm' || id === 'trendy') ? 45
    : (id === 'professional' || id === 'energetic') ? 10 : 20;

  // 업종·톤 변경 시 배경음악 자동 추천
  useEffect(() => {
    if (businessType) {
      const recommended = recommendBgm(businessType, tone);
      setBgmId(recommended);
      setBgmVolume(getDefaultVolume(recommended));
    }
  }, [businessType, tone]);

  async function fetchUsage() {
    try {
      const res  = await fetch('/api/usage');
      const data = await res.json();
      setUsage(data);
    } catch { /* ignore */ }
  }

  const resizeImage = useCallback((file: File, maxW = 1920, maxH = 1920, quality = 0.85): Promise<File> => {
    // Always output as .jpg to avoid HEIC/HEIF issues on server
    const jpgName = file.name.replace(/\.[^.]+$/, '.jpg');
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        let { width: w, height: h } = img;
        // Always convert through canvas to ensure JPEG output (even if small)
        const needsResize = w > maxW || h > maxH || file.size > 1 * 1024 * 1024;
        const isHeic = /\.(heic|heif)$/i.test(file.name);
        if (!needsResize && !isHeic) { URL.revokeObjectURL(img.src); resolve(file); return; }
        if (needsResize) {
          const ratio = Math.min(maxW / w, maxH / h);
          w = Math.round(w * ratio);
          h = Math.round(h * ratio);
        }
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        canvas.getContext('2d')!.drawImage(img, 0, 0, w, h);
        canvas.toBlob(
          (blob) => {
            URL.revokeObjectURL(img.src);
            resolve(blob ? new File([blob], jpgName, { type: 'image/jpeg' }) : file);
          },
          'image/jpeg',
          quality,
        );
      };
      img.onerror = () => resolve(file);
      img.src = URL.createObjectURL(file);
    });
  }, []);

  const addImages = useCallback(async (files: FileList | File[]) => {
    const fileArr = Array.from(files).filter(f => f.type.startsWith('image/'));
    const remaining = MAX_IMAGES - images.length;
    const toAdd = fileArr.slice(0, remaining);
    if (toAdd.length === 0) return;

    // 큰 이미지 자동 리사이즈 (모바일 대응)
    const resized = await Promise.all(toAdd.map(f => resizeImage(f)));

    const newPreviews = resized.map(f => URL.createObjectURL(f));
    setImages(prev => [...prev, ...resized]);
    setImagePreviews(prev => [...prev, ...newPreviews]);
    setUploadId(null); // force re-upload on next script generation
  }, [images.length, resizeImage]);

  function removeImage(idx: number) {
    URL.revokeObjectURL(imagePreviews[idx]);
    setImages(prev => prev.filter((_, i) => i !== idx));
    setImagePreviews(prev => prev.filter((_, i) => i !== idx));
    setUploadId(null); // force re-upload on next script generation
  }

  function onFileInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files) {
      addImages(e.target.files);
      e.target.value = ''; // reset so same file can be re-added
    }
  }

  function onDragOver(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(true);
  }
  function onDragLeave() { setIsDragging(false); }
  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files) addImages(e.dataTransfer.files);
  }

  async function generateScriptPreview() {
    if (!businessName.trim() || !businessType || !sellingPoints.trim()) return;
    setError(null);
    // loadingScript를 먼저 설정해서 form이 깜빡이지 않도록
    setLoadingScript(true);
    // 같은 batch 안에서 scriptDraft도 null로 — React 18 auto-batching 덕분에 깜빡임 없음
    setScriptDraft(null);
    try {
      // Upload images first (if any) to get uploadId
      let currentUploadId = uploadId;
      if (images.length > 0 && !currentUploadId) {
        const formData = new FormData();
        for (const img of images) formData.append('images', img);
        const upRes = await fetch('/api/upload', { method: 'POST', body: formData });
        const upData = await upRes.json();
        if (!upRes.ok) throw new Error(upData.error || '사진 업로드에 실패했습니다.');
        currentUploadId = upData.uploadId;
        setUploadId(currentUploadId);
      }

      const res = await fetch('/api/promo-script', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          businessName: businessName.trim(),
          businessType,
          sellingPoints: sellingPoints.trim(),
          contact: contact.trim() || undefined,
          location: location.trim() || undefined,
          cta: cta.trim() || undefined,
          duration,
          tone,
          uploadId: currentUploadId,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '스크립트 생성에 실패했습니다.');

      setScriptDraft(data.script);

      // Initialize section images from uploaded photos
      const n = data.script.sections.length;
      const initImgs: (File | null)[] = Array.from({ length: n }, (_, i) => images[i] ?? null);
      const initPrevs: (string | null)[] = Array.from({ length: n }, (_, i) => imagePreviews[i] ?? null);
      setSectionImages(initImgs);
      setSectionPreviews(initPrevs);
      setPickerSection(-1);
    } catch (err) {
      setError(err instanceof Error ? err.message : '오류가 발생했습니다.');
    } finally {
      setLoadingScript(false);
    }
  }

  async function startGeneration() {
    if (!businessName.trim() || !businessType || !sellingPoints.trim()) return;
    setError(null);
    setLoading(true);
    setJobId(null);
    setJobStatus(null);
    setShowScript(false);

    try {
      const formData = new FormData();
      formData.append('businessName',  businessName.trim());
      formData.append('businessType',  businessType);
      formData.append('sellingPoints', sellingPoints.trim());
      if (contact.trim())  formData.append('contact',  contact.trim());
      if (location.trim()) formData.append('location', location.trim());
      if (cta.trim())      formData.append('cta',      cta.trim());
      formData.append('duration',   String(duration));
      formData.append('tone',       tone);
      formData.append('voice',      voice);
      formData.append('speed',      String(speed));
      formData.append('bgmId',      customBgm ? 'custom' : bgmId);
      formData.append('bgmVolume',   String(bgmVolume / 100));
      if (customBgm) {
        formData.append('customBgm', customBgm);
      }
      if (scriptDraft) {
        formData.append('prebuiltScript', JSON.stringify(scriptDraft));
      }

      // Attach images in section order (fall back to original images if no sections)
      const orderedImgs = sectionImages.length > 0
        ? sectionImages.filter((img): img is File => img !== null)
        : images;
      for (const img of orderedImgs) {
        formData.append('images', img);
      }

      const res = await fetch('/api/promo', {
        method: 'POST',
        body: formData,
        // Do NOT set Content-Type — browser sets it with boundary automatically
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '영상 생성에 실패했습니다.');

      setJobId(data.jobId);
      setDownloaded(false);
      startPolling(data.jobId);
      fetchUsage();
    } catch (err) {
      setError(err instanceof Error ? err.message : '오류가 발생했습니다.');
      setLoading(false);
    }
  }

  function startPolling(id: string) {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/status/${id}`);
        if (!res.ok) {
          if (res.status === 404) {
            clearInterval(pollRef.current!);
            setLoading(false);
            setJobId(null);
            setJobStatus(null);
            setError('생성 작업을 찾을 수 없습니다. 다시 시도해주세요.');
          }
          return;
        }
        const data: JobStatus = await res.json();
        setJobStatus(data);
        if (data.status === 'done' || data.status === 'failed') {
          clearInterval(pollRef.current!);
          setLoading(false);
        }
      } catch { /* ignore */ }
    }, 2000);
  }

  useEffect(() => {
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  // Fake progress ticker for video generation step
  useEffect(() => {
    const isVideoRunning = jobStatus?.status === 'generating_video';
    if (isVideoRunning && !videoStartedRef.current) {
      videoStartedRef.current = true;
      setFakeProgress(0);
      setVideoSubMsg(VIDEO_SUB_STEPS[0].msg);
      let tick = 0;
      fakeTimerRef.current = setInterval(() => {
        tick += 1;
        // Ease out: fast at start, slow approaching 95
        const p = Math.min(95, Math.round(95 * (1 - Math.exp(-tick / 30))));
        setFakeProgress(p);
        // Update sub-message based on progress
        for (let i = VIDEO_SUB_STEPS.length - 1; i >= 0; i--) {
          if (p >= VIDEO_SUB_STEPS[i].at) {
            setVideoSubMsg(VIDEO_SUB_STEPS[i].msg);
            break;
          }
        }
      }, 1000);
    }
    if (!isVideoRunning && videoStartedRef.current) {
      // Video step finished
      if (fakeTimerRef.current) clearInterval(fakeTimerRef.current);
      setFakeProgress(100);
      setVideoSubMsg('');
      videoStartedRef.current = false;
    }
    return () => {
      if (fakeTimerRef.current) clearInterval(fakeTimerRef.current);
    };
  }, [jobStatus?.status]);

  // 영상 생성 후 다운로드 안 하고 페이지 이탈 시 경고
  useEffect(() => {
    const shouldWarn = jobStatus?.videoUrl && !downloaded;

    // 탭 닫기, 새 URL 입력 시
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (shouldWarn) {
        e.preventDefault();
        e.returnValue = '생성된 영상이 아직 저장되지 않았습니다.';
        return e.returnValue;
      }
    };

    // 브라우저 뒤로가기 감지
    const handlePopState = () => {
      if (shouldWarn) {
        const leave = window.confirm('생성된 영상이 아직 저장되지 않았습니다. 그래도 페이지를 나가시겠습니까?');
        if (!leave) {
          window.history.pushState(null, '', window.location.href);
        }
      }
    };

    if (shouldWarn) {
      window.history.pushState(null, '', window.location.href);
    }

    window.addEventListener('beforeunload', handleBeforeUnload);
    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      window.removeEventListener('popstate', handlePopState);
    };
  }, [jobStatus?.videoUrl, downloaded]);

  function goBackToScript() {
    if (jobStatus?.videoUrl && !downloaded) {
      const leave = window.confirm('생성된 영상이 아직 저장되지 않았습니다. 그래도 스크립트 수정으로 돌아가시겠습니까?');
      if (!leave) return;
    }
    setJobId(null);
    setJobStatus(null);
    setLoading(false);
    setError(null);
    // scriptDraft and sectionImages stay intact → isScriptReview becomes true
  }

  function resetForm() {
    if (jobStatus?.videoUrl && !downloaded) {
      const leave = window.confirm('생성된 영상이 아직 저장되지 않았습니다. 그래도 새로 시작하시겠습니까?');
      if (!leave) return;
    }
    setJobId(null);
    setJobStatus(null);
    setLoading(false);
    setBusinessName('');
    setSellingPoints('');
    setError(null);
    setScriptDraft(null);
    setLoadingScript(false);
    imagePreviews.forEach(url => URL.revokeObjectURL(url));
    setImages([]);
    setImagePreviews([]);
    setUploadId(null);
    setSectionImages([]);
    setSectionPreviews([]);
    setPickerSection(-1);
  }

  const isGenerating    = loading && jobId;
  const isDone          = jobStatus?.status === 'done';
  const isFailed        = jobStatus?.status === 'failed';
  const isScriptReview  = !loading && !loadingScript && !jobId && scriptDraft !== null && !isDone && !isFailed;
  const showForm        = !loading && !isGenerating && !isDone && !isFailed && !isScriptReview && !loadingScript;
  const canStart        = businessName.trim().length > 0 && businessType.length > 0 && sellingPoints.trim().length > 0 && images.length >= MIN_IMAGES && !loading && !loadingScript;

  return (
    <main className="min-h-screen bg-[#0B0A14] text-white">
      {/* Header */}
      <div className="border-b border-white/5 bg-[#0B0A14]/80 backdrop-blur-xl sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-6 h-14 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 text-gray-400 hover:text-white transition-colors text-sm">
            <ArrowLeft className="w-4 h-4" />
            홈으로
          </Link>
          <div className="flex items-center gap-2 font-bold">
            <Megaphone className="w-4 h-4 text-emerald-400" />
            <span className="text-sm" style={{ background: 'linear-gradient(135deg, #10b981, #059669)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
              ShortsAI
            </span>
          </div>
          {usage && (
            <div className="text-xs text-gray-500">
              {usage.limit === null ? '무제한' : `${usage.remaining}개 남음`}
            </div>
          )}
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-6 py-10">
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">
            홍보 영상{' '}
            <span style={{ background: 'linear-gradient(135deg, #10b981, #059669)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
              자동 생성
            </span>
          </h1>
          <p className="text-gray-400">업체 정보를 입력하면 AI가 SNS 홍보 영상을 만들어드립니다</p>
        </div>

        {/* Usage warning */}
        {usage && usage.remaining === 0 && (
          <div className="mb-6 p-4 rounded-xl bg-yellow-500/10 border border-yellow-500/20 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-yellow-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-yellow-300 font-medium text-sm">이번 달 한도 초과</p>
              <p className="text-yellow-400/70 text-xs mt-0.5">
                더 만들려면 <Link href="/#pricing" className="underline">플랜을 업그레이드</Link>해주세요
              </p>
            </div>
          </div>
        )}

        {/* Form */}
        {showForm && (
          <div className="glass-card p-6 space-y-5">

            {/* 업체명 */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                업체명 <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                value={businessName}
                onChange={(e) => setBusinessName(e.target.value)}
                placeholder="예: 스타벅스 강남점, 홍길동 영어학원"
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-emerald-500/50 focus:bg-white/8 transition-all text-sm"
              />
            </div>

            {/* 업종 */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                업종 <span className="text-red-400">*</span>
              </label>
              <div className="flex flex-wrap gap-2">
                {BUSINESS_TYPES.map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setBusinessType(t)}
                    className={`px-3 py-1.5 rounded-lg text-sm transition-all border ${
                      businessType === t
                        ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300'
                        : 'bg-white/5 border-white/10 text-gray-400 hover:text-white hover:border-white/20'
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>

            {/* 핵심 홍보 포인트 */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                핵심 홍보 포인트 <span className="text-red-400">*</span>
              </label>
              <textarea
                value={sellingPoints}
                onChange={(e) => setSellingPoints(e.target.value)}
                placeholder="예: 10년 경력 원어민 강사, 소규모 수업(최대 5명), 수능 합격률 98%, 첫 달 50% 할인"
                rows={3}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-emerald-500/50 focus:bg-white/8 transition-all resize-none text-sm"
              />
              <p className="text-gray-600 text-xs mt-1">구체적인 강점, 가격 혜택, 특징을 적어주세요</p>
            </div>

            {/* ── 사진 업로드 ── */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2 flex items-center gap-1.5">
                <ImagePlus className="w-4 h-4 text-emerald-400" />
                매장 사진
                <span className="text-red-400 text-xs ml-1">* 필수 — {MIN_IMAGES}~{MAX_IMAGES}장 (영상 배경으로 사용)</span>
              </label>

              {/* Drop zone */}
              {images.length < MAX_IMAGES && (
                <div
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={onDragOver}
                  onDragLeave={onDragLeave}
                  onDrop={onDrop}
                  className={`cursor-pointer border-2 border-dashed rounded-xl p-6 text-center transition-all ${
                    isDragging
                      ? 'border-emerald-400 bg-emerald-500/10'
                      : 'border-white/15 hover:border-emerald-500/40 hover:bg-white/3'
                  }`}
                >
                  <ImagePlus className={`w-8 h-8 mx-auto mb-2 ${isDragging ? 'text-emerald-400' : 'text-gray-600'}`} />
                  <p className="text-gray-400 text-sm">
                    클릭하거나 사진을 드래그하여 업로드
                  </p>
                  <p className="text-gray-600 text-xs mt-1">
                    JPG, PNG, WEBP · 남은 {MAX_IMAGES - images.length}장
                  </p>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={onFileInputChange}
                  />
                </div>
              )}

              {/* Thumbnails */}
              {images.length > 0 && (
                <div className="flex flex-wrap gap-3 mt-3">
                  {imagePreviews.map((url, idx) => (
                    <div key={idx} className="relative group w-20 h-20">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={url}
                        alt={`업로드 사진 ${idx + 1}`}
                        className="w-20 h-20 object-cover rounded-xl border border-white/10"
                      />
                      <button
                        type="button"
                        onClick={() => removeImage(idx)}
                        className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-red-500 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-lg"
                      >
                        <X className="w-3 h-3 text-white" />
                      </button>
                      <div className="absolute bottom-0 left-0 right-0 bg-black/50 rounded-b-xl text-center text-[9px] text-gray-300 py-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                        {idx + 1}/{images.length}
                      </div>
                    </div>
                  ))}
                  {/* Add more button if under limit */}
                  {images.length < MAX_IMAGES && (
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="w-20 h-20 rounded-xl border-2 border-dashed border-white/15 hover:border-emerald-500/40 flex flex-col items-center justify-center gap-1 text-gray-600 hover:text-emerald-400 transition-all"
                    >
                      <ImagePlus className="w-5 h-5" />
                      <span className="text-[10px]">추가</span>
                    </button>
                  )}
                </div>
              )}

              {images.length > 0 && images.length < MIN_IMAGES && (
                <p className="text-amber-400/70 text-xs mt-2 flex items-center gap-1">
                  <AlertCircle className="w-3 h-3" />
                  {images.length}장 선택됨 — 최소 {MIN_IMAGES}장 필요합니다 ({MIN_IMAGES - images.length}장 더 추가)
                </p>
              )}
              {images.length >= MIN_IMAGES && (
                <p className="text-emerald-400/70 text-xs mt-2 flex items-center gap-1">
                  <Check className="w-3 h-3" />
                  {images.length}장 선택됨 — 업로드된 사진이 영상 배경으로 사용됩니다
                </p>
              )}
            </div>

            {/* 연락처 / 주소 (선택) */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-400 mb-2 flex items-center gap-1">
                  <Phone className="w-3.5 h-3.5" /> 연락처
                  <span className="text-gray-600 text-xs ml-1">(선택)</span>
                </label>
                <input
                  type="text"
                  value={contact}
                  onChange={(e) => setContact(e.target.value)}
                  placeholder="010-1234-5678"
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-emerald-500/50 transition-all text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-400 mb-2 flex items-center gap-1">
                  <MapPin className="w-3.5 h-3.5" /> 위치
                  <span className="text-gray-600 text-xs ml-1">(선택)</span>
                </label>
                <input
                  type="text"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  placeholder="강남역 3번 출구"
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-emerald-500/50 transition-all text-sm"
                />
              </div>
            </div>

            {/* CTA 문구 (선택) */}
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-2">
                마무리 CTA <span className="text-gray-600 text-xs">(선택 — 비워두면 AI가 작성)</span>
              </label>
              <input
                type="text"
                value={cta}
                onChange={(e) => setCta(e.target.value)}
                placeholder="예: 지금 바로 전화하세요! / 이번 달만 특가!"
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-emerald-500/50 transition-all text-sm"
              />
            </div>

            {/* 영상 길이 */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">영상 길이</label>
              <div className="flex gap-3">
                {DURATIONS.map((d) => (
                  <button
                    key={d.value}
                    onClick={() => setDuration(d.value)}
                    className={`flex-1 py-2.5 rounded-xl text-sm font-medium transition-all border ${
                      duration === d.value
                        ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-300'
                        : 'bg-white/5 border-white/10 text-gray-400 hover:text-white hover:border-white/20'
                    }`}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
            </div>

            {/* 톤 */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">영상 톤</label>
              <div className="flex flex-wrap gap-2">
                {TONES.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setTone(t.id)}
                    className={`px-4 py-2 rounded-lg text-sm transition-all border flex items-center gap-1.5 ${
                      tone === t.id
                        ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300'
                        : 'bg-white/5 border-white/10 text-gray-400 hover:text-white'
                    }`}
                  >
                    <span>{t.emoji}</span>
                    <span>{t.label}</span>
                    {t.desc && <span className="text-[10px] text-gray-500">· {t.desc}</span>}
                  </button>
                ))}
              </div>
            </div>

            {/* 배경음악 */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2 flex items-center gap-1.5">
                <Music2 className="w-4 h-4 text-emerald-400" />
                배경음악
                {businessType && !customBgm && (
                  <span className="text-[11px] text-emerald-400/70 ml-1 font-normal">· AI 자동추천</span>
                )}
              </label>
              <div className="flex flex-wrap gap-2">
                {BGM_CATALOG.map((track) => (
                  <button
                    key={track.id}
                    type="button"
                    onClick={() => { setBgmId(track.id); setCustomBgm(null); setCustomBgmName(''); setBgmVolume(getDefaultVolume(track.id)); }}
                    className={`px-3 py-1.5 rounded-lg text-sm transition-all border flex items-center gap-1.5 ${
                      bgmId === track.id && !customBgm
                        ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300'
                        : 'bg-white/5 border-white/10 text-gray-400 hover:text-white hover:border-white/20'
                    }`}
                  >
                    <span>{track.emoji}</span>
                    <span>{track.label}</span>
                  </button>
                ))}
                {/* 직접 업로드 버튼 */}
                <button
                  type="button"
                  onClick={() => bgmInputRef.current?.click()}
                  className={`px-3 py-1.5 rounded-lg text-sm transition-all border flex items-center gap-1.5 ${
                    customBgm
                      ? 'bg-purple-500/20 border-purple-500/40 text-purple-300'
                      : 'bg-white/5 border-white/10 text-gray-400 hover:text-white hover:border-white/20'
                  }`}
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>{customBgm ? customBgmName : '직접 업로드'}</span>
                  {customBgm && (
                    <X
                      className="w-3 h-3 ml-1 hover:text-red-400 cursor-pointer"
                      onClick={(e) => { e.stopPropagation(); setCustomBgm(null); setCustomBgmName(''); }}
                    />
                  )}
                </button>
                <input
                  ref={bgmInputRef}
                  type="file"
                  accept="audio/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      setCustomBgm(file);
                      setCustomBgmName(file.name.length > 15 ? file.name.slice(0, 12) + '...' : file.name);
                      setBgmId('none');
                      setBgmVolume(30);
                    }
                    e.target.value = '';
                  }}
                />
              </div>

              {/* 볼륨 슬라이더 */}
              {(bgmId !== 'none' || customBgm) && (
                <div className="mt-3 flex items-center gap-3">
                  <Volume2 className="w-4 h-4 text-gray-400 flex-shrink-0" />
                  <input
                    type="range"
                    min={5}
                    max={80}
                    value={bgmVolume}
                    onChange={(e) => setBgmVolume(Number(e.target.value))}
                    className="flex-1 h-1.5 rounded-full appearance-none bg-white/10 accent-emerald-500 cursor-pointer"
                  />
                  <span className="text-xs text-gray-400 w-10 text-right">{bgmVolume}%</span>
                </div>
              )}
              {bgmId !== 'none' && !customBgm && (
                <p className="text-gray-600 text-xs mt-1.5">
                  {BGM_CATALOG.find(t => t.id === bgmId)?.desc}
                </p>
              )}
            </div>

            {/* Advanced settings */}
            <div className="border-t border-white/5 pt-4">
              <button
                type="button"
                onClick={() => setShowAdvanced(!showAdvanced)}
                className="flex items-center gap-2 text-sm text-gray-400 hover:text-gray-200 transition-colors"
              >
                <ChevronDown className={`w-4 h-4 transition-transform ${showAdvanced ? 'rotate-180' : ''}`} />
                고급 설정
                <span className="text-xs text-gray-600 ml-1">
                  {VOICES.find(v => v.id === voice)?.label} · {speed}×
                </span>
              </button>

              {showAdvanced && (
                <div className="mt-4 space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">🎙 나레이터 음성</label>
                    <div className="grid grid-cols-2 gap-2">
                      {VOICES.map((v) => (
                        <button
                          key={v.label}
                          type="button"
                          onClick={() => setVoice(v.id)}
                          className={`relative p-3 rounded-xl text-left transition-all border ${
                            voice === v.id
                              ? 'bg-emerald-500/20 border-emerald-500/50'
                              : 'bg-white/3 border-white/8 hover:border-white/20'
                          }`}
                        >
                          {v.badge && (
                            <span className="absolute top-1.5 right-1.5 text-[10px] bg-emerald-500/40 text-emerald-300 px-1.5 py-0.5 rounded-full">
                              {v.badge}
                            </span>
                          )}
                          <p className={`font-semibold text-sm ${voice === v.id ? 'text-emerald-200' : 'text-gray-200'}`}>{v.label}</p>
                          <p className="text-[11px] text-gray-500 mt-0.5">{v.desc}</p>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">⚡ 음성 속도</label>
                    <div className="flex gap-2">
                      {SPEEDS.map((s) => (
                        <button
                          key={s.value}
                          type="button"
                          onClick={() => setSpeed(s.value)}
                          className={`flex-1 py-2.5 rounded-xl text-center transition-all border ${
                            speed === s.value
                              ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300'
                              : 'bg-white/3 border-white/8 text-gray-400 hover:text-white hover:border-white/20'
                          }`}
                        >
                          <p className="font-semibold text-sm">{s.label}</p>
                          <p className="text-[10px] text-gray-500 mt-0.5">{s.desc}</p>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Error */}
            {error && (
              <div className="flex items-start gap-3 p-3 rounded-xl bg-red-500/10 border border-red-500/20">
                <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
                <p className="text-red-300 text-sm">{error}</p>
              </div>
            )}

            {/* Submit */}
            <button
              onClick={generateScriptPreview}
              disabled={!canStart || (usage?.remaining === 0)}
              className="w-full py-4 rounded-xl text-white font-bold text-base disabled:opacity-40 hover:opacity-90 transition-all flex items-center justify-center gap-2"
              style={{ background: 'linear-gradient(135deg, #10b981, #059669)' }}
            >
              <Sparkles className="w-5 h-5" />
              AI 스크립트 생성
            </button>
          </div>
        )}

        {/* Loading script preview */}
        {loadingScript && (
          <div className="glass-card p-8 text-center">
            <Loader2 className="w-8 h-8 text-emerald-400 animate-spin mx-auto mb-4" />
            <p className="text-gray-300 font-medium">AI가 홍보 스크립트를 작성하는 중...</p>
            <p className="text-gray-500 text-xs mt-2">잠시만 기다려주세요</p>
          </div>
        )}

        {/* Script review phase */}
        {isScriptReview && scriptDraft && (
          <div className="space-y-4">
            {/* Header — business name + editable script title */}
            <div className="flex items-start justify-between">
              <div className="flex-1 min-w-0">
                <h2 className="font-bold text-2xl flex items-center gap-2">
                  <Megaphone className="w-5 h-5 text-emerald-400 flex-shrink-0" />
                  <span className="text-amber-400 drop-shadow-[0_1px_2px_rgba(0,0,0,0.6)]">{businessName}</span>
                </h2>
                <div className="mt-3 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
                  <span className="text-sm sm:text-lg font-semibold text-gray-400 shrink-0">스크립트 제목</span>
                  <input
                    type="text"
                    value={scriptDraft.title}
                    onChange={(e) => setScriptDraft({ ...scriptDraft, title: e.target.value })}
                    className="flex-1 text-lg font-semibold text-emerald-300 bg-transparent border-b border-white/10 focus:outline-none focus:border-emerald-500/50 transition-all placeholder-gray-600 px-3 py-1 drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]"
                    placeholder="AI가 생성한 캐치프레이즈"
                  />
                </div>
              </div>
              <button
                onClick={() => { setScriptDraft(null); setError(null); }}
                className="text-xs text-gray-500 hover:text-gray-300 transition-colors flex-shrink-0 ml-4 mt-1"
              >
                ← 처음으로
              </button>
            </div>

            <div className="glass-card p-5 space-y-3">
              {/* Sections */}
              {scriptDraft.sections.map((section, i) => (
                <div key={i} className="bg-white/3 rounded-xl p-4 space-y-2">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-gray-500 font-medium uppercase tracking-wide">
                      {section.type === 'hook' ? '💡 훅' : section.type === 'cta' ? '📣 CTA' : `📌 포인트 ${i}`}
                    </span>
                    <span className="text-xs text-gray-600">{section.duration}초</span>
                  </div>

                  {/* Photo (left) + Text (right) */}
                  <div className="flex gap-3 items-start">
                    {/* Photo column */}
                    <div className="flex-shrink-0 w-24">
                      {sectionPreviews[i] ? (
                        <div className="space-y-1">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={sectionPreviews[i]!}
                            alt={`섹션 ${i + 1}`}
                            className="w-24 h-24 object-cover rounded-lg border border-white/10 cursor-pointer hover:border-emerald-500/50 hover:opacity-80 transition-all"
                            onClick={() => setPickerSection(pickerSection === i ? -1 : i)}
                          />
                          <button
                            type="button"
                            onClick={() => setPickerSection(pickerSection === i ? -1 : i)}
                            className="w-full text-[10px] text-gray-500 hover:text-emerald-400 transition-colors text-center"
                          >
                            사진 변경
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setPickerSection(pickerSection === i ? -1 : i)}
                          className="w-24 h-24 rounded-lg border border-dashed border-white/20 text-gray-600 hover:border-emerald-500/40 hover:text-emerald-400 transition-colors flex flex-col items-center justify-center gap-1 text-[10px]"
                        >
                          <ImagePlus className="w-4 h-4" />
                          사진 선택
                        </button>
                      )}

                      {/* Photo picker — stacked vertically under photo */}
                      {pickerSection === i && imagePreviews.length > 0 && (
                        <div className="mt-1.5 p-1.5 bg-[#1a1825] rounded-lg border border-white/10 flex flex-col gap-1">
                          {imagePreviews.map((url, pi) => (
                            <button
                              key={pi}
                              type="button"
                              onClick={() => {
                                const newImgs = [...sectionImages];
                                const newPrevs = [...sectionPreviews];
                                newImgs[i] = images[pi];
                                newPrevs[i] = url;
                                setSectionImages(newImgs);
                                setSectionPreviews(newPrevs);
                                setPickerSection(-1);
                              }}
                              className={`relative rounded overflow-hidden border-2 transition-all ${
                                sectionImages[i] === images[pi]
                                  ? 'border-emerald-500'
                                  : 'border-transparent hover:border-white/30'
                              }`}
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={url} alt={`사진 ${pi + 1}`} className="w-full h-14 object-cover" />
                              <div className="absolute bottom-0 left-0 right-0 text-center text-[8px] text-white/60 bg-black/40">{pi + 1}</div>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Script text column */}
                    <textarea
                      value={section.text}
                      onChange={(e) => {
                        const newSections = [...scriptDraft.sections];
                        newSections[i] = { ...newSections[i], text: e.target.value };
                        setScriptDraft({ ...scriptDraft, sections: newSections });
                      }}
                      rows={4}
                      className="flex-1 bg-transparent border border-white/10 rounded-lg px-3 py-2 text-gray-200 text-sm focus:outline-none focus:border-emerald-500/40 transition-all resize-none"
                    />
                  </div>
                </div>
              ))}

              {/* Hashtags */}
              <div>
                <label className="text-xs text-gray-500 mb-1 block">해시태그</label>
                <div className="flex flex-wrap gap-2">
                  {scriptDraft.hashtags.map((tag, i) => (
                    <span key={i} className="px-2 py-1 rounded-lg bg-emerald-500/10 text-emerald-300 text-xs">{tag}</span>
                  ))}
                </div>
              </div>
            </div>

            {error && (
              <div className="flex items-start gap-3 p-3 rounded-xl bg-red-500/10 border border-red-500/20">
                <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
                <p className="text-red-300 text-sm">{error}</p>
              </div>
            )}

            <div className="flex flex-col sm:flex-row gap-2 sm:gap-3">
              <div className="flex gap-2 sm:gap-3">
                <button
                  onClick={generateScriptPreview}
                  disabled={loadingScript}
                  className="flex-1 py-3 rounded-xl bg-white/10 text-white font-medium hover:bg-white/15 transition-all border border-white/10 text-sm flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {loadingScript ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                  재생성
                </button>
                <button
                  onClick={() => { setScriptDraft(null); setError(null); }}
                  className="flex-1 py-3 rounded-xl bg-white/10 text-white font-medium hover:bg-white/15 transition-all border border-white/10 text-sm flex items-center justify-center gap-2"
                >
                  <ArrowLeft className="w-4 h-4" />
                  이전
                </button>
              </div>
              <button
                onClick={startGeneration}
                disabled={usage?.remaining === 0}
                className="w-full sm:flex-grow py-3 rounded-xl text-white font-bold text-sm hover:opacity-90 transition-all disabled:opacity-40 flex items-center justify-center gap-2 px-6"
                style={{ background: 'linear-gradient(135deg, #10b981, #059669)' }}
              >
                <Megaphone className="w-4 h-4" />
                이 스크립트로 영상 생성
              </button>
            </div>
          </div>
        )}

        {/* Generation progress */}
        {isGenerating && jobStatus && (() => {
          const isVideoPhase = jobStatus.status === 'generating_video';
          // Blend real progress with fake progress during video phase
          const displayProgress = isVideoPhase
            ? Math.round(65 + (fakeProgress / 100) * 35)
            : (jobStatus.progress ?? 0);
          return (
            <div className="glass-card p-6 space-y-4">
              <div className="flex items-center justify-between mb-2">
                <h2 className="font-bold text-lg">영상 생성 중...</h2>
                <span className="text-emerald-400 font-bold">{displayProgress}%</span>
              </div>
              <div className="h-2 bg-white/5 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-1000 ease-out"
                  style={{ width: `${displayProgress}%`, background: 'linear-gradient(135deg, #10b981, #059669)' }}
                />
              </div>
              <div className="space-y-2 mt-4">
                {(['script', 'audio', 'video'] as const).map((key) => {
                  const status = (jobStatus.steps ?? {})[key] as StepStatus | undefined;
                  if (!status) return null;
                  return (
                    <StepIndicator
                      key={key}
                      label={STEP_LABELS[key]}
                      status={status}
                      subMessage={
                        key === 'video' && status === 'running' ? videoSubMsg :
                        key === 'audio' && status === 'running' ? `음성 생성 중... ${Math.min(Math.round(((jobStatus.progress ?? 30) - 30) / 35 * 100), 99)}%` :
                        undefined
                      }
                    />
                  );
                })}
              </div>
              <p className="text-center text-gray-500 text-xs mt-4">보통 1-2분 소요됩니다. 잠시만 기다려주세요</p>
            </div>
          );
        })()}

        {/* Loading before first status */}
        {loading && !jobStatus && !loadingScript && (
          <div className="glass-card p-8 text-center">
            <Loader2 className="w-8 h-8 text-emerald-400 animate-spin mx-auto mb-4" />
            <p className="text-gray-300">영상 생성을 시작하는 중...</p>
          </div>
        )}

        {/* Error state */}
        {isFailed && (
          <div className="glass-card p-6 space-y-4">
            <div className="flex items-center gap-3 text-red-400">
              <AlertCircle className="w-6 h-6" />
              <h2 className="font-bold text-lg">생성 실패</h2>
            </div>
            <p className="text-gray-400 text-sm">{jobStatus?.error || '알 수 없는 오류가 발생했습니다.'}</p>
            <button
              onClick={() => { setJobId(null); setJobStatus(null); setLoading(false); setError(null); }}
              className="w-full py-3 rounded-xl bg-white/10 text-white font-medium hover:bg-white/15 transition-all"
            >
              다시 시도
            </button>
          </div>
        )}

        {/* Done state */}
        {isDone && jobStatus && (
          <div className="space-y-4">
            <div className="glass-card p-4 flex items-center gap-3 border-green-500/20 bg-green-500/5">
              <div className="w-10 h-10 rounded-full bg-green-500/20 flex items-center justify-center">
                <Check className="w-5 h-5 text-green-400" />
              </div>
              <div>
                <p className="font-bold text-green-300">홍보 영상 생성 완료!</p>
                <p className="text-gray-400 text-xs">{jobStatus.script?.title}</p>
              </div>
            </div>

            {jobStatus.videoUrl && (
              <div className="glass-card overflow-hidden">
                <video controls className="w-full max-h-96 object-contain bg-black" src={jobStatus.videoUrl}>
                  영상을 재생할 수 없습니다.
                </video>
              </div>
            )}

            <div className="flex gap-3">
              {jobStatus.videoUrl && (
                <a
                  href={jobStatus.videoUrl}
                  download={`promo_${Date.now()}.mp4`}
                  onClick={() => setDownloaded(true)}
                  className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-white font-bold hover:opacity-90 transition-all"
                  style={{ background: 'linear-gradient(135deg, #10b981, #059669)' }}
                >
                  <Download className="w-4 h-4" />
                  MP4 다운로드
                </a>
              )}
              {scriptDraft && (
                <button
                  onClick={goBackToScript}
                  className="flex-1 py-3 rounded-xl bg-white/10 text-white font-medium hover:bg-white/15 transition-all border border-white/10 flex items-center justify-center gap-2 text-sm"
                >
                  <Edit3 className="w-4 h-4" />
                  스크립트 수정
                </button>
              )}
              <button
                onClick={resetForm}
                className="flex-1 py-3 rounded-xl bg-white/8 text-gray-400 font-medium hover:bg-white/12 transition-all border border-white/8 text-sm"
              >
                새 영상 만들기
              </button>
            </div>

            {/* 후기 남기기 */}
            {!reviewSubmitted ? (
              <button
                onClick={() => setShowReviewModal(true)}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-yellow-500/10 border border-yellow-500/20 text-yellow-300 font-medium hover:bg-yellow-500/20 transition-all text-sm"
              >
                <MessageSquarePlus className="w-4 h-4" />
                후기 남기기 ⭐
              </button>
            ) : (
              <div className="w-full text-center py-3 rounded-xl bg-green-500/10 border border-green-500/20 text-green-300 text-sm">
                ✅ 후기를 남겨주셔서 감사합니다! 승인 후 홈페이지에 표시됩니다.
              </div>
            )}

            {jobStatus.script && (
              <div className="glass-card">
                <button
                  onClick={() => setShowScript(!showScript)}
                  className="w-full flex items-center justify-between p-4 text-left hover:bg-white/3 transition-colors rounded-2xl"
                >
                  <span className="font-medium text-sm">스크립트 보기</span>
                  <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${showScript ? 'rotate-180' : ''}`} />
                </button>
                {showScript && (
                  <div className="px-4 pb-4 space-y-3">
                    <div className="flex flex-wrap gap-2 mb-3">
                      {jobStatus.script.hashtags.map((tag) => (
                        <span key={tag} className="px-2 py-1 rounded-lg bg-emerald-500/10 text-emerald-300 text-xs">{tag}</span>
                      ))}
                    </div>
                    {jobStatus.script.sections.map((section, i) => (
                      <div key={i} className="bg-white/3 rounded-xl p-3">
                        <div className="text-xs text-gray-500 mb-1 uppercase tracking-wide">
                          {section.type === 'hook' ? '💡 훅' : section.type === 'cta' ? '📣 CTA' : `📌 포인트 ${i}`}
                          <span className="ml-2">{section.duration}초</span>
                        </div>
                        <p className="text-gray-300 text-sm">{section.text}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

          </div>
        )}
      </div>

      {/* Review Modal */}
      {showReviewModal && (
        <ReviewModal
          jobId={jobId ?? undefined}
          onClose={() => setShowReviewModal(false)}
          onSubmitted={() => {
            setShowReviewModal(false);
            setReviewSubmitted(true);
          }}
        />
      )}
    </main>
  );
}
