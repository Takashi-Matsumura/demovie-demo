import { newId, type Caption, type Clip, type DemoDocument } from "./document";
import { seekTo, waitForEvent } from "./media";

// 手元の llama-server を直接呼ぶ。動画のフレームはこの PC の外へは出ない。
const VISION_URL = process.env.NEXT_PUBLIC_VISION_URL ?? "http://127.0.0.1:8084";

const SAMPLE_SEC = 1;
const SIGNATURE_WIDTH = 64;
const SIGNATURE_HEIGHT = 36;
const PIXEL_THRESHOLD = 12;
// 2304 マス中の約 12 マス。カーソル移動の 2〜3 マスは操作として拾わない。
const CHANGE_RATIO = 0.005;
const MERGE_GAP_SEC = 2;
const MAX_OPERATION_SEC = 10;
const SETTLE_SEC = 0.5;
const HOLD_SEC = 1.5;
const END_MARGIN_SEC = 0.05;
const FRAME_WIDTH = 1024;

const PROMPT = `1枚目は操作の前、2枚目は操作の後の画面です。ユーザーが行った操作を、操作説明動画の手順として日本語で1文にしてください。
・「〜を開きます」「〜を設定します」のように、30字以内の丁寧語で書く
・画面に実際に見える文字を根拠にし、推測で固有名詞を足さない
・説明文だけを出力する`;

export function buildPrompt(purpose: string) {
  const context = purpose.trim();
  return context ? `この動画の目的: ${context}\n${PROMPT}` : PROMPT;
}

export type Sample = { sec: number; ratio: number };
export type Operation = { beforeSec: number; afterSec: number };

export function changedRatio(previous: Uint8ClampedArray, current: Uint8ClampedArray) {
  let changed = 0;
  for (let index = 0; index < current.length; index += 1) {
    if (Math.abs(current[index] - previous[index]) > PIXEL_THRESHOLD) changed += 1;
  }
  return changed / current.length;
}

// 続けて変化したサンプルは 1 つの操作にまとめる。入力やスクロールで細切れにしないため。
export function findOperations(samples: Sample[]) {
  const operations: Operation[] = [];
  samples.forEach((sample, index) => {
    if (index === 0 || sample.ratio < CHANGE_RATIO) return;
    const previous = samples[index - 1];
    const last = operations.at(-1);
    if (
      last &&
      previous.sec - last.afterSec < MERGE_GAP_SEC &&
      sample.sec - last.beforeSec <= MAX_OPERATION_SEC
    ) {
      last.afterSec = sample.sec;
    } else {
      operations.push({ beforeSec: previous.sec, afterSec: sample.sec });
    }
  });
  return operations;
}

export function cleanCaption(reply: string) {
  const [line = ""] = reply.trim().split("\n");
  return line.replace(/^(?:キャプション[:：]\s*)?[「『"]?|[」』"]$/g, "").trim();
}

// 分割済みのクリップでは境界そのものが操作なので、1 サンプル手前から比べる。
function sampleTimes(clip: Clip) {
  const last = clip.sourceEndSec - END_MARGIN_SEC;
  const times: number[] = [];
  const first = Math.max(0, clip.sourceStartSec - SAMPLE_SEC);
  for (let sec = first; sec < last; sec += SAMPLE_SEC) times.push(sec);
  times.push(last);
  return times;
}

function signatureOf(ctx: CanvasRenderingContext2D, video: HTMLVideoElement) {
  ctx.drawImage(video, 0, 0, SIGNATURE_WIDTH, SIGNATURE_HEIGHT);
  const { data } = ctx.getImageData(0, 0, SIGNATURE_WIDTH, SIGNATURE_HEIGHT);
  return data.filter((_, index) => index % 4 === 0);
}

function frameUrl(video: HTMLVideoElement) {
  const canvas = document.createElement("canvas");
  canvas.width = FRAME_WIDTH;
  canvas.height = Math.round((FRAME_WIDTH * video.videoHeight) / video.videoWidth);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas を初期化できませんでした。");
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.7);
}

async function describe(before: string, after: string, prompt: string, signal: AbortSignal) {
  const image = (url: string) => ({ type: "image_url", image_url: { url } });
  let response: Response;
  try {
    response = await fetch(`${VISION_URL}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal,
      body: JSON.stringify({
        messages: [
          {
            role: "user",
            content: [image(before), image(after), { type: "text", text: prompt }],
          },
        ],
        max_tokens: 80,
        temperature: 0.2,
        // サーバ既定の 1.5 は短い日本語文を崩すので打ち消す。
        presence_penalty: 0,
      }),
    });
  } catch (cause) {
    if (signal.aborted) throw cause;
    throw new Error(`VLM サーバ（${VISION_URL}）に接続できません。起動しているか確認してください。`);
  }
  if (!response.ok) throw new Error(`VLM サーバがエラーを返しました（${response.status}）。`);
  const data: { choices?: { message?: { content?: string } }[] } = await response.json();
  return cleanCaption(data.choices?.[0]?.message?.content ?? "");
}

type GenerateOptions = {
  doc: DemoDocument;
  src: string;
  signal: AbortSignal;
  onProgress: (message: string) => void;
};

// 変化のあった箇所だけ VLM に渡す。全区間を送ると 1 枚ごとに数秒かかり、静止画面の説明も増える。
export async function generateCaptions({ doc, src, signal, onProgress }: GenerateOptions) {
  const canvas = document.createElement("canvas");
  canvas.width = SIGNATURE_WIDTH;
  canvas.height = SIGNATURE_HEIGHT;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas を初期化できませんでした。");

  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  const loaded = waitForEvent(video, "loadeddata");
  video.src = src;
  await loaded;

  try {
    const found: { clip: Clip; operation: Operation; endSec: number }[] = [];
    for (const clip of doc.clips) {
      const samples: Sample[] = [];
      let previous: Uint8ClampedArray | null = null;
      for (const sec of sampleTimes(clip)) {
        signal.throwIfAborted();
        await seekTo(video, sec);
        const signature: Uint8ClampedArray = signatureOf(ctx, video);
        samples.push({ sec, ratio: previous ? changedRatio(previous, signature) : 0 });
        previous = signature;
      }
      const operations = findOperations(samples);
      operations.forEach((operation, index) => {
        const next = operations[index + 1]?.beforeSec ?? clip.sourceEndSec;
        found.push({ clip, operation, endSec: Math.min(operation.afterSec + HOLD_SEC, next) });
      });
    }
    if (found.length === 0) throw new Error("画面の変化が見つかりませんでした。");

    const captions: Caption[] = [];
    for (const [index, { clip, operation, endSec }] of found.entries()) {
      signal.throwIfAborted();
      onProgress(`キャプションを生成中 ${index + 1} / ${found.length}`);
      await seekTo(video, operation.beforeSec);
      const before = frameUrl(video);
      const settled = operation.afterSec + SETTLE_SEC;
      await seekTo(video, Math.min(settled, clip.sourceEndSec - END_MARGIN_SEC));
      const text = await describe(before, frameUrl(video), buildPrompt(doc.purpose), signal);
      const sourceStartSec = Math.max(operation.beforeSec, clip.sourceStartSec);
      if (!text || endSec <= sourceStartSec) continue;
      captions.push({ id: newId(), clipId: clip.id, sourceStartSec, sourceEndSec: endSec, text });
    }
    return captions;
  } finally {
    video.removeAttribute("src");
    video.load();
  }
}
