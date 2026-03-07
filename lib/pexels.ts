import axios from 'axios';
import fs from 'fs';

interface PexelsVideoFile {
  quality: string;
  width: number;
  height: number;
  link: string;
}

interface PexelsVideo {
  video_files: PexelsVideoFile[];
}

interface PexelsResponse {
  videos: PexelsVideo[];
}

// English keyword mapping for Pexels search
const KO_EN_PEXELS: Array<[string, string]> = [
  // 동물 / 반려동물
  ['강아지', 'dog puppy'],
  ['고양이', 'cat kitten'],
  ['반려동물', 'pet dog cat'],
  ['애완', 'pet animal'],
  ['동물', 'animal wildlife'],
  ['새', 'bird nature'],
  ['물고기', 'fish aquarium'],
  ['토끼', 'rabbit bunny'],
  ['햄스터', 'hamster pet'],
  // 음식 / 건강
  ['다이어트', 'diet fitness'],
  ['건강', 'health wellness'],
  ['요리', 'cooking food kitchen'],
  ['음식', 'food meal'],
  ['커피', 'coffee cafe'],
  ['베이킹', 'baking bread'],
  ['채식', 'vegetables healthy food'],
  // 돈 / 비즈니스
  ['재테크', 'money finance'],
  ['투자', 'investment finance'],
  ['돈', 'money coins'],
  ['취업', 'office career'],
  ['창업', 'startup business'],
  ['부동산', 'real estate building'],
  ['주식', 'stock market'],
  ['경제', 'finance business'],
  // 라이프스타일
  ['여행', 'travel landscape'],
  ['운동', 'workout gym'],
  ['공부', 'studying books'],
  ['독서', 'reading books'],
  ['영어', 'studying education'],
  ['마음', 'meditation calm'],
  ['행복', 'happy lifestyle'],
  ['자기계발', 'motivation success'],
  ['성공', 'success achievement'],
  ['관계', 'people friendship'],
  ['심리', 'psychology mind'],
  ['육아', 'parenting children family'],
  // 뷰티 / 패션
  ['패션', 'fashion style'],
  ['뷰티', 'beauty makeup'],
  ['헤어', 'hair salon'],
  ['스킨케어', 'skincare beauty'],
  // 기술 / 문화
  ['과학', 'science laboratory'],
  ['기술', 'technology digital'],
  ['음악', 'music guitar'],
  ['역사', 'history architecture'],
  ['스포츠', 'sports action'],
  ['한국', 'korea city'],
  ['게임', 'gaming computer'],
  ['영화', 'cinema movie'],
];

export function getPexelsKeyword(text: string): string {
  // 긴 키워드부터 먼저 매칭 (예: '반려동물'이 '동물'보다 먼저)
  const sorted = [...KO_EN_PEXELS].sort((a, b) => b[0].length - a[0].length);
  for (const [ko, en] of sorted) {
    if (text.includes(ko)) {
      // 첫 번째 영어 단어 반환
      return en.split(' ')[0];
    }
  }
  return 'lifestyle';
}

export async function fetchPexelsVideoUrl(keyword: string, apiKey: string): Promise<string | null> {
  try {
    const { data } = await axios.get<PexelsResponse>('https://api.pexels.com/videos/search', {
      headers: { Authorization: apiKey },
      params: {
        query: keyword,
        orientation: 'portrait',
        size: 'medium',
        per_page: 10,
      },
      timeout: 12000,
    });

    const videos = data?.videos ?? [];
    if (!videos.length) return null;

    // 후보 링크들 수집 후 랜덤 선택 (매번 다른 영상)
    const candidates: string[] = [];
    for (const video of videos) {
      const files = video.video_files ?? [];
      const portrait = files.filter((f) => f.height > f.width);
      const chosen =
        portrait.find((f) => f.quality === 'hd') ??
        portrait.find((f) => f.quality === 'sd') ??
        portrait[0] ??
        files[0];
      if (chosen?.link) candidates.push(chosen.link);
    }
    if (!candidates.length) return null;

    // 랜덤 선택
    return candidates[Math.floor(Math.random() * candidates.length)];
  } catch (e) {
    console.warn('[Pexels] API error:', e);
    return null;
  }
}

export async function downloadVideo(url: string, outputPath: string): Promise<void> {
  const res = await axios.get(url, {
    responseType: 'stream',
    timeout: 120000,
    maxRedirects: 5,
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ShortsAI/1.0)' },
  });
  return new Promise((resolve, reject) => {
    const writer = fs.createWriteStream(outputPath);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (res.data as any).pipe(writer);
    writer.on('finish', resolve);
    writer.on('error', reject);
  });
}
