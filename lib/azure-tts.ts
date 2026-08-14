/**
 * Azure(Microsoft) Speech Text-to-Speech.
 * 한국어 네이티브 음성 + 네이티브 피치/속도(prosody)로 캐릭터 톤 구현.
 * (Google에 없는 귀여운 아이 톤 등에 사용 — 예: 카툰 강아지 '뭉치')
 */
import fs from 'fs';

/** XML 특수문자 이스케이프 */
function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/**
 * Azure TTS로 mp3 생성.
 * @param voice  ko-KR-YuJinNeural 등 Azure 음성 ShortName
 * @param pitch  네이티브 피치 (예 '+45%' / '+3st' / '0%')
 * @param rate   속도 (예 '+8%' / '0%')
 */
export async function generateAzureTTS(
  text: string, outputPath: string, voice: string, pitch = '0%', rate = '0%',
): Promise<void> {
  const key = process.env.AZURE_SPEECH_KEY;
  const region = process.env.AZURE_SPEECH_REGION || 'koreacentral';
  if (!key) throw new Error('AZURE_SPEECH_KEY not set');
  // 콤마는 띄어쓰기 수준으로(과도한 쉼 방지). 마침표·느낌표·물음표는 Azure 자연 쉼.
  const clean = esc(text.replace(/\s*,\s*/g, ' '));
  const ssml =
    `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='ko-KR'>` +
    `<voice name='${voice}'><prosody pitch='${pitch}' rate='${rate}'>${clean}</prosody></voice></speak>`;
  const res = await fetch(`https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
    method: 'POST',
    headers: {
      'Ocp-Apim-Subscription-Key': key,
      'Content-Type': 'application/ssml+xml',
      'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3',
      'User-Agent': 'shortsai',
    },
    body: ssml,
  });
  if (!res.ok) throw new Error(`Azure TTS ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 500) throw new Error('Azure TTS: empty audio');
  fs.writeFileSync(outputPath, buf);
}
