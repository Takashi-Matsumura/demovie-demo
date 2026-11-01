import type { DemoDocument } from "./document";
import { narrationCredit } from "./narration";
import { blursAt, cameraAt, captionTextAt } from "./timeline";

export const OUTPUT_WIDTH = 1920;
export const OUTPUT_HEIGHT = 1080;

// 動画に焼き込む色なので UI トークンとは別に持つ。
export const BACKGROUNDS: Record<
  DemoDocument["look"]["background"],
  { label: string; from: string; to: string }
> = {
  dusk: { label: "夕闇", from: "#2a2140", to: "#0f1420" },
  ember: { label: "残り火", from: "#7a3412", to: "#1f0f0a" },
  slate: { label: "石板", from: "#3a424d", to: "#14181d" },
  paper: { label: "紙", from: "#f4efe6", to: "#dcd5c7" },
};

// 文字を読み取れないよう、1 ブロックを本文の文字より大きくする。
// 大きさは録画の幅が基準。出力側で決めると、ズームするほど元の映像の情報が残る。
const MOSAIC_BLOCK_RATIO = 0.02;
const MIN_MOSAIC_BLOCK = 16;

type Rect = { x: number; y: number; width: number; height: number };

function frameRectOf(doc: DemoDocument, width: number, height: number, vw: number, vh: number) {
  const padding = (width * doc.look.paddingPct) / 100;
  const fit = Math.min((width - padding * 2) / vw, (height - padding * 2) / vh);
  const frameWidth = vw * fit;
  const frameHeight = vh * fit;
  return {
    x: (width - frameWidth) / 2,
    y: (height - frameHeight) / 2,
    width: frameWidth,
    height: frameHeight,
  };
}

function cropOf(doc: DemoDocument, clipId: string, sourceSec: number, vw: number, vh: number) {
  const camera = cameraAt(doc, clipId, sourceSec);
  const width = vw / camera.scale;
  const height = vh / camera.scale;
  return {
    x: clamp(camera.centerX * vw - width / 2, 0, vw - width),
    y: clamp(camera.centerY * vh - height / 2, 0, vh - height),
    width,
    height,
  };
}

// プレビュー上の座標を、ズームを考慮して動画の座標（0〜1）に変換する。
export function previewToVideo(
  doc: DemoDocument,
  clipId: string,
  sourceSec: number,
  canvasX: number,
  canvasY: number,
) {
  const { width: vw, height: vh } = doc.asset;
  const frame = frameRectOf(doc, OUTPUT_WIDTH, OUTPUT_HEIGHT, vw, vh);
  const crop = cropOf(doc, clipId, sourceSec, vw, vh);
  const ratioX = clamp((canvasX - frame.x) / frame.width, 0, 1);
  const ratioY = clamp((canvasY - frame.y) / frame.height, 0, 1);
  return {
    x: (crop.x + ratioX * crop.width) / vw,
    y: (crop.y + ratioY * crop.height) / vh,
  };
}

// ブロックの区切りは録画の座標に固定する。ズームで動くと、コマを重ねて元の内容を推測されやすい。
// 縦長や低解像度の録画でも弱くならないよう、基準は 16:9 換算の幅にして下限も設ける。
// 切り捨てで分割するので、実際のブロックが基準より小さくなることはない。
export function mosaicGrid(
  blurWidth: number,
  blurHeight: number,
  videoWidth: number,
  videoHeight: number,
) {
  const block = Math.max(
    Math.max(videoWidth, (videoHeight * 16) / 9) * MOSAIC_BLOCK_RATIO,
    MIN_MOSAIC_BLOCK,
  );
  return {
    columns: Math.max(1, Math.floor(blurWidth / block)),
    rows: Math.max(1, Math.floor(blurHeight / block)),
  };
}

const THUMBNAIL_OFFSET_SEC = 1;

// 手順の冒頭は操作の前の画面なので、少し進めた時点を代表の画面にする。
export function thumbnailSec(clip: { sourceStartSec: number; sourceEndSec: number }) {
  const middle = (clip.sourceStartSec + clip.sourceEndSec) / 2;
  return Math.min(clip.sourceStartSec + THUMBNAIL_OFFSET_SEC, middle);
}

// 画面を大きく見せるため、背景の余白をなくす。モザイクはそのまま残す。
export function thumbnailDoc(doc: DemoDocument): DemoDocument {
  return {
    ...doc,
    narration: { ...doc.narration, enabled: false },
    look: { ...doc.look, paddingPct: 0, radiusPct: 0, shadow: false },
  };
}

let mosaicCanvas: HTMLCanvasElement | null = null;

function drawBlurs(
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  doc: DemoDocument,
  sourceSec: number,
  frame: Rect,
  crop: Rect,
  vw: number,
  vh: number,
) {
  mosaicCanvas ??= document.createElement("canvas");
  const mosaic = mosaicCanvas.getContext("2d");
  if (!mosaic) return;
  const scale = frame.width / crop.width;

  for (const blur of blursAt(doc, sourceSec)) {
    const blurX = blur.x * vw;
    const blurY = blur.y * vh;
    const blurWidth = blur.width * vw;
    const blurHeight = blur.height * vh;
    const left = Math.max(blurX, crop.x);
    const top = Math.max(blurY, crop.y);
    const right = Math.min(blurX + blurWidth, crop.x + crop.width);
    const bottom = Math.min(blurY + blurHeight, crop.y + crop.height);
    if (right <= left || bottom <= top) continue;

    const { columns, rows } = mosaicGrid(blurWidth, blurHeight, vw, vh);
    mosaicCanvas.width = columns;
    mosaicCanvas.height = rows;
    mosaic.drawImage(video, blurX, blurY, blurWidth, blurHeight, 0, 0, columns, rows);

    const toColumns = columns / blurWidth;
    const toRows = rows / blurHeight;
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(
      mosaicCanvas,
      (left - blurX) * toColumns,
      (top - blurY) * toRows,
      (right - left) * toColumns,
      (bottom - top) * toRows,
      frame.x + (left - crop.x) * scale,
      frame.y + (top - crop.y) * scale,
      (right - left) * scale,
      (bottom - top) * scale,
    );
    ctx.restore();
  }
}

// プレビューと書き出しはどちらもこの関数を通す。経路を分けると見た目がズレる。
export function drawFrame(
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  doc: DemoDocument,
  clipId: string,
  sourceSec: number,
) {
  const { width, height } = ctx.canvas;
  const { look } = doc;
  const palette = BACKGROUNDS[look.background];

  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, palette.from);
  gradient.addColorStop(1, palette.to);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  const videoWidth = video.videoWidth || doc.asset.width;
  const videoHeight = video.videoHeight || doc.asset.height;
  const frame = frameRectOf(doc, width, height, videoWidth, videoHeight);
  const { x: frameX, y: frameY, width: frameWidth, height: frameHeight } = frame;
  const radius = (width * look.radiusPct) / 100;

  if (look.shadow) {
    ctx.save();
    ctx.shadowColor = "rgba(0, 0, 0, 0.45)";
    ctx.shadowBlur = width * 0.03;
    ctx.shadowOffsetY = width * 0.01;
    ctx.fillStyle = "#000";
    ctx.beginPath();
    ctx.roundRect(frameX, frameY, frameWidth, frameHeight, radius);
    ctx.fill();
    ctx.restore();
  }

  const crop = cropOf(doc, clipId, sourceSec, videoWidth, videoHeight);

  ctx.save();
  ctx.beginPath();
  ctx.roundRect(frameX, frameY, frameWidth, frameHeight, radius);
  ctx.clip();
  if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
    ctx.drawImage(
      video,
      crop.x,
      crop.y,
      crop.width,
      crop.height,
      frameX,
      frameY,
      frameWidth,
      frameHeight,
    );
    drawBlurs(ctx, video, doc, sourceSec, frame, crop, videoWidth, videoHeight);
  }
  ctx.restore();

  const caption = captionTextAt(doc, clipId, sourceSec)?.trim();
  if (caption) drawCaption(ctx, caption, frameY + frameHeight);

  // 音声の利用条件でクレジットが必須なので、書き忘れないよう動画に入れる。
  const credit = narrationCredit(doc);
  if (credit) drawCredit(ctx, credit);
}

function drawCredit(ctx: CanvasRenderingContext2D, credit: string) {
  const { width, height } = ctx.canvas;
  const fontSize = width * 0.012;
  ctx.save();
  ctx.font = `500 ${fontSize}px system-ui, "Hiragino Sans", sans-serif`;
  ctx.textAlign = "right";
  ctx.textBaseline = "bottom";
  ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
  ctx.fillText(credit, width - fontSize * 0.9, height - fontSize * 0.45);
  ctx.fillStyle = "#fff";
  ctx.fillText(credit, width - fontSize, height - fontSize * 0.55);
  ctx.restore();
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number) {
  const lines = [""];
  for (const char of text) {
    const line = lines[lines.length - 1];
    if (line && ctx.measureText(line + char).width > maxWidth) lines.push(char);
    else lines[lines.length - 1] = line + char;
  }
  return lines;
}

// ズームの影響を受けないよう、映像の切り抜きとは別に最前面へ描く。
function drawCaption(ctx: CanvasRenderingContext2D, text: string, frameBottom: number) {
  const { width } = ctx.canvas;
  const fontSize = width * 0.024;
  const lineHeight = fontSize * 1.4;
  const paddingX = fontSize * 0.9;
  const paddingY = fontSize * 0.5;

  ctx.save();
  ctx.font = `600 ${fontSize}px system-ui, "Hiragino Sans", sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const lines = wrapText(ctx, text, width * 0.7);
  const boxWidth = Math.max(...lines.map((line) => ctx.measureText(line).width)) + paddingX * 2;
  const boxHeight = lines.length * lineHeight + paddingY * 2;
  const boxY = frameBottom - boxHeight - fontSize;

  ctx.fillStyle = "rgba(0, 0, 0, 0.72)";
  ctx.beginPath();
  ctx.roundRect((width - boxWidth) / 2, boxY, boxWidth, boxHeight, fontSize * 0.4);
  ctx.fill();

  ctx.fillStyle = "#fff";
  lines.forEach((line, index) => {
    ctx.fillText(line, width / 2, boxY + paddingY + lineHeight * (index + 0.5));
  });
  ctx.restore();
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
