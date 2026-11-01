import type { DemoDocument } from "./document";
import { stepSpans } from "./timeline";

// 手元の VOICEVOX エンジンを直接呼ぶ。説明文はこの PC の外へは出ない。
export const VOICEVOX_URL = process.env.NEXT_PUBLIC_VOICEVOX_URL ?? "http://127.0.0.1:50021";

export type Voice = { id: number; name: string; style: string };

type SpeakerResponse = { name: string; styles: { id: number; name: string }[] }[];

export async function listVoices(signal?: AbortSignal): Promise<Voice[]> {
  const response = await fetch(`${VOICEVOX_URL}/speakers`, { signal });
  if (!response.ok) throw new Error("声の一覧を取得できませんでした。");
  const speakers: SpeakerResponse = await response.json();
  return speakers.flatMap(({ name, styles }) =>
    styles.map((style) => ({ id: style.id, name, style: style.name })),
  );
}

const cache = new Map<string, ArrayBuffer>();

async function post(url: string, init: RequestInit) {
  let response: Response;
  try {
    response = await fetch(url, { method: "POST", ...init });
  } catch (cause) {
    if (init.signal?.aborted) throw cause;
    throw new Error(`読み上げサーバ（${VOICEVOX_URL}）に接続できません。起動を確認してください。`);
  }
  if (!response.ok) throw new Error(`読み上げサーバがエラーを返しました（${response.status}）。`);
  return response;
}

export async function synthesize(
  text: string,
  voiceId: number,
  speed: number,
  signal?: AbortSignal,
) {
  const key = `${voiceId}:${speed}:${text}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const params = new URLSearchParams({ text, speaker: String(voiceId) });
  const query = await post(`${VOICEVOX_URL}/audio_query?${params}`, { signal });
  const body = JSON.stringify({ ...(await query.json()), speedScale: speed });
  const wave = await post(`${VOICEVOX_URL}/synthesis?speaker=${voiceId}`, {
    signal,
    body,
    headers: { "Content-Type": "application/json" },
  });
  const audio = await wave.arrayBuffer();
  cache.set(key, audio);
  return audio;
}

export function narrationCredit(doc: DemoDocument) {
  return doc.narration.enabled ? `VOICEVOX:${doc.narration.voiceName}` : null;
}

export function narratedSteps(doc: DemoDocument) {
  return stepSpans(doc).flatMap(({ clip, caption }) => {
    const text = caption?.text.trim();
    return text ? [{ clipId: clip.id, text }] : [];
  });
}

// decodeAudioData は渡したバッファを手放すので、キャッシュが壊れないよう複製を渡す。
export async function prepareNarration(
  doc: DemoDocument,
  context: BaseAudioContext,
  signal: AbortSignal,
) {
  const buffers = new Map<string, AudioBuffer>();
  if (!doc.narration.enabled) return buffers;
  const { voiceId, speed } = doc.narration;
  for (const { clipId, text } of narratedSteps(doc)) {
    signal.throwIfAborted();
    const audio = await synthesize(text, voiceId, speed, signal);
    buffers.set(clipId, await context.decodeAudioData(audio.slice(0)));
  }
  return buffers;
}
