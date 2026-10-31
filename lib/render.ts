import type { DemoDocument } from "./document";
import { cameraAt, captionTextAt } from "./timeline";

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
  const padding = (width * look.paddingPct) / 100;
  const fit = Math.min(
    (width - padding * 2) / videoWidth,
    (height - padding * 2) / videoHeight,
  );
  const frameWidth = videoWidth * fit;
  const frameHeight = videoHeight * fit;
  const frameX = (width - frameWidth) / 2;
  const frameY = (height - frameHeight) / 2;
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

  const camera = cameraAt(doc, clipId, sourceSec);
  const sourceWidth = videoWidth / camera.scale;
  const sourceHeight = videoHeight / camera.scale;
  const sourceX = clamp(
    camera.centerX * videoWidth - sourceWidth / 2,
    0,
    videoWidth - sourceWidth,
  );
  const sourceY = clamp(
    camera.centerY * videoHeight - sourceHeight / 2,
    0,
    videoHeight - sourceHeight,
  );

  ctx.save();
  ctx.beginPath();
  ctx.roundRect(frameX, frameY, frameWidth, frameHeight, radius);
  ctx.clip();
  if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
    ctx.drawImage(
      video,
      sourceX,
      sourceY,
      sourceWidth,
      sourceHeight,
      frameX,
      frameY,
      frameWidth,
      frameHeight,
    );
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
