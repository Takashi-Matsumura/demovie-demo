import { newId, type Caption, type Clip, type DemoDocument, type Zoom } from "./document";
import { formatGlossary } from "./glossary";
import { seekTo, waitForEvent } from "./media";

// 手元の llama-server を直接呼ぶ。動画のフレームはこの PC の外へは出ない。
export const VISION_URL = process.env.NEXT_PUBLIC_VISION_URL ?? "http://127.0.0.1:8084";

const SAMPLE_SEC = 1;
// 64×36 だと文字入力がカーソルの移動と同じ大きさに潰れて、入力を検出できない。
const SIGNATURE_WIDTH = 160;
const SIGNATURE_HEIGHT = 90;
const PIXEL_THRESHOLD = 12;
// 実画面の測定で、カーソルの移動は約 0.07%、12 文字の入力は約 0.13% だった。
const CHANGE_RATIO = 0.001;
const MERGE_GAP_SEC = 2;
const MAX_OPERATION_SEC = 10;
const SETTLE_SEC = 0.5;
const HOLD_SEC = 1.5;
const END_MARGIN_SEC = 0.05;
const FRAME_WIDTH = 1024;
const FIRST_READ_SEC = 0.01;
// 外れ値を落とす割合。離れた場所のカーソル移動で範囲が広がるのを防ぐ。
const REGION_TRIM = 0.1;
// これより広い変化は画面遷移とみなし、拡大しない。
const MAX_ZOOM_REGION = 0.6;
const MIN_ZOOM_DEPTH = 1.3;
const MAX_ZOOM_DEPTH = 2.2;
const REGION_FILL = 0.8;
const MIN_AUTO_ZOOM_SEC = 1;

const PROMPT = `操作の後の画面で新しく表示された内容を重視して、ユーザーが行った操作を、操作説明動画の手順として日本語で1文にしてください。
・「〜を開きます」「〜を入力します」のように、30字以内の丁寧語で書く
・操作は、その結果が画面に現れていて、対象の名前が読めるときだけ書く
・対象がわからないときや、グラフの描画、ツールチップ、カーソルの移動のように画面の表示が変わっただけのときは「クリック」と書かず、「〜が表示されます」と書く
・画面に実際に見える文字を根拠にし、推測で固有名詞を足さない
・説明文だけを出力する`;

export function buildPrompt(purpose: string, glossary = "") {
  const context = purpose.trim();
  const terms = formatGlossary(glossary);
  const heading = context ? `この動画の目的: ${context}\n` : "";
  const glossarySection = terms ? `\n画面に出てくる用語は、この表記で書く:\n${terms}` : "";
  return `${heading}${PROMPT}${glossarySection}`;
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

export type Region = { centerX: number; centerY: number; width: number; height: number };

// 変化したマスの範囲を 0〜1 の比率で返す。
export function changedRegion(
  previous: Uint8ClampedArray,
  current: Uint8ClampedArray,
  width: number,
): Region | null {
  const xs: number[] = [];
  const ys: number[] = [];
  for (let index = 0; index < current.length; index += 1) {
    if (Math.abs(current[index] - previous[index]) <= PIXEL_THRESHOLD) continue;
    xs.push(index % width);
    ys.push(Math.floor(index / width));
  }
  if (xs.length / current.length < CHANGE_RATIO) return null;

  const height = current.length / width;
  const range = (values: number[], size: number) => {
    const sorted = [...values].sort((a, b) => a - b);
    const trim = Math.floor(sorted.length * REGION_TRIM);
    const from = sorted[trim];
    const to = sorted[sorted.length - 1 - trim] + 1;
    return { center: (from + to) / 2 / size, length: (to - from) / size };
  };
  const x = range(xs, width);
  const y = range(ys, height);
  return { centerX: x.center, centerY: y.center, width: x.length, height: y.length };
}

export function suggestZoom(region: Region | null) {
  if (!region || Math.max(region.width, region.height) > MAX_ZOOM_REGION) return null;
  const fit = REGION_FILL / Math.max(region.width, region.height);
  const depth = Math.min(MAX_ZOOM_DEPTH, Math.max(MIN_ZOOM_DEPTH, fit));
  return {
    depth: Math.round(depth * 10) / 10,
    focusX: region.centerX,
    focusY: region.centerY,
  };
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

const QUOTE_PAIRS: Record<string, string> = { "「": "」", "『": "』", '"': '"' };

// 文全体を囲む引用符だけを外す。「保存」ボタンを押します、のような部分の引用符は残す。
export function cleanCaption(reply: string) {
  const [line = ""] = reply.trim().split("\n");
  const text = line.replace(/^キャプション[:：]\s*/, "").trim();
  const closing = QUOTE_PAIRS[text[0]];
  const wrapped = closing && text.endsWith(closing) && !text.slice(1, -1).includes(closing);
  return wrapped ? text.slice(1, -1).trim() : text;
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

export function frameUrl(video: HTMLVideoElement) {
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
            // 画像の順番だけで前後を伝えると、操作の後の画面を無視しやすい。
            content: [
              { type: "text", text: "操作の前の画面:" },
              image(before),
              { type: "text", text: "操作の後の画面:" },
              image(after),
              { type: "text", text: prompt },
            ],
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
  glossary: string;
  src: string;
  signal: AbortSignal;
  onProgress: (message: string) => void;
};

// 変化のあった箇所だけ VLM に渡す。全区間を送ると 1 枚ごとに数秒かかり、静止画面の説明も増える。
export async function generateCaptions({
  doc,
  glossary,
  src,
  signal,
  onProgress,
}: GenerateOptions) {
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
    // 読み込み直後の最初の読み取りが黒くなり、全画面の変化と誤判定することがある。
    await seekTo(video, FIRST_READ_SEC);
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
    const zooms: Zoom[] = [];
    for (const [index, { clip, operation, endSec }] of found.entries()) {
      signal.throwIfAborted();
      onProgress(`キャプションを生成中 ${index + 1} / ${found.length}`);
      await seekTo(video, operation.beforeSec);
      const before = frameUrl(video);
      const beforeSignature: Uint8ClampedArray = signatureOf(ctx, video);
      const settled = operation.afterSec + SETTLE_SEC;
      await seekTo(video, Math.min(settled, clip.sourceEndSec - END_MARGIN_SEC));
      const region = changedRegion(beforeSignature, signatureOf(ctx, video), SIGNATURE_WIDTH);
      const text = await describe(before, frameUrl(video), buildPrompt(doc.purpose, glossary), signal);
      const sourceStartSec = Math.max(operation.beforeSec, clip.sourceStartSec);
      if (!text || endSec <= sourceStartSec) continue;
      captions.push({ id: newId(), clipId: clip.id, sourceStartSec, sourceEndSec: endSec, text });
      const zoom = suggestZoom(region);
      if (zoom && endSec - sourceStartSec >= MIN_AUTO_ZOOM_SEC) {
        zooms.push({ id: newId(), clipId: clip.id, sourceStartSec, sourceEndSec: endSec, ...zoom });
      }
    }
    return { captions, zooms };
  } finally {
    video.removeAttribute("src");
    video.load();
  }
}
