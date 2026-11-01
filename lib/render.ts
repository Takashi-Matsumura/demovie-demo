import type { DemoDocument } from "./document";
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
const MOSAIC_BLOCK_RATIO = 0.02;

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
  const block = ctx.canvas.width * MOSAIC_BLOCK_RATIO;
  const scale = frame.width / crop.width;

  for (const blur of blursAt(doc, sourceSec)) {
    const left = Math.max(blur.x * vw, crop.x);
    const top = Math.max(blur.y * vh, crop.y);
    const right = Math.min((blur.x + blur.width) * vw, crop.x + crop.width);
    const bottom = Math.min((blur.y + blur.height) * vh, crop.y + crop.height);
    if (right <= left || bottom <= top) continue;

    const destWidth = (right - left) * scale;
    const destHeight = (bottom - top) * scale;
    const columns = Math.max(1, Math.ceil(destWidth / block));
    const rows = Math.max(1, Math.ceil(destHeight / block));
    mosaicCanvas.width = columns;
    mosaicCanvas.height = rows;
    mosaic.drawImage(video, left, top, right - left, bottom - top, 0, 0, columns, rows);

    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(
      mosaicCanvas,
      frame.x + (left - crop.x) * scale,
      frame.y + (top - crop.y) * scale,
      destWidth,
      destHeight,
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
