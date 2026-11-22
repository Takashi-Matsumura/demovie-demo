import { assetOf, type Chapter, type DemoDocument } from "./document";
import { narrationCredit } from "./narration";
import { blursAt, cameraAt, captionTextAt, locate } from "./timeline";

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

// 余白に置く見出し（チャプター名）と字幕の大きさ。出力の幅に対する比率。
const HEADER_FONT_RATIO = 0.017;
const HEADER_BAND_RATIO = 0.045;
const CAPTION_FONT_RATIO = 0.021;
const CAPTION_LINE_HEIGHT = 1.4;
const CAPTION_MAX_LINES = 2;
const MIN_CAPTION_FONT_SCALE = 0.7;
const CREDIT_FONT_RATIO = 0.012;
const FONT_FAMILY = `system-ui, "Hiragino Sans", sans-serif`;

function hasHeader(doc: DemoDocument) {
  return doc.clips.some((clip) => !clip.hidden && clip.chapter?.title.trim());
}

function hasCaptions(doc: DemoDocument) {
  const visible = new Set(doc.clips.filter((clip) => !clip.hidden).map((clip) => clip.id));
  return doc.captions.some((caption) => visible.has(caption.clipId) && caption.text.trim());
}

/**
 * 映像の枠を置く位置。見出しや字幕があるときは、上下の余白にその帯を確保して映像に重ねない。
 * 帯は動画全体で固定する。字幕の有無で枠が伸び縮みすると、見ている側が追いにくい。
 * 余白（paddingPct）が帯より広ければ、その内側に収めて映像は小さくしない。
 */
function layoutOf(doc: DemoDocument, width: number, height: number, vw: number, vh: number) {
  const padding = (width * doc.look.paddingPct) / 100;
  const headerBand = hasHeader(doc) ? width * HEADER_BAND_RATIO : 0;
  const captionFont = width * CAPTION_FONT_RATIO;
  const captionBand = hasCaptions(doc)
    ? captionFont * CAPTION_LINE_HEIGHT * CAPTION_MAX_LINES + captionFont * 1.6
    : 0;
  const top = Math.max(padding, headerBand);
  const bottom = Math.max(padding, captionBand);
  const fit = Math.min((width - padding * 2) / vw, (height - top - bottom) / vh);
  const frameWidth = vw * fit;
  const frameHeight = vh * fit;
  const frame: Rect = {
    x: (width - frameWidth) / 2,
    y: top + (height - top - bottom - frameHeight) / 2,
    width: frameWidth,
    height: frameHeight,
  };
  return { frame, padding, captionFont };
}

function frameRectOf(doc: DemoDocument, width: number, height: number, vw: number, vh: number) {
  return layoutOf(doc, width, height, vw, vh).frame;
}

/** その手順が属するチャプターの名前。直前までで最後にチャプター画面を持つ手順のものを使う。 */
export function chapterTitleOf(doc: DemoDocument, clipId: string) {
  let title = "";
  for (const clip of doc.clips) {
    if (!clip.hidden && clip.chapter) title = clip.chapter.title.trim();
    if (clip.id === clipId) return title;
  }
  return "";
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
  const clip = doc.clips.find((item) => item.id === clipId);
  const { width: vw, height: vh } = assetOf(doc, clip?.assetId ?? "");
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
    // 見出しや字幕の帯を取ると映像が小さくなるので、サムネイルには描かない。
    clips: doc.clips.map((clip) => ({ ...clip, chapter: undefined })),
    captions: [],
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
  assetId: string,
) {
  mosaicCanvas ??= document.createElement("canvas");
  const mosaic = mosaicCanvas.getContext("2d");
  if (!mosaic) return;
  const scale = frame.width / crop.width;

  for (const blur of blursAt(doc, assetId, sourceSec)) {
    const blurX = blur.x * vw;
    const blurY = blur.y * vh;
    const blurWidth = blur.width * vw;
    const blurHeight = blur.height * vh;
    const left = Math.max(blurX, crop.x);
    const top = Math.max(blurY, crop.y);
    const right = Math.min(blurX + blurWidth, crop.x + crop.width);
    const bottom = Math.min(blurY + blurHeight, crop.y + crop.height);
    if (right <= left || bottom <= top) continue;

    if (blur.style === "solid") {
      // 元の画素を読まないので、映像の情報は一切残らない。
      ctx.fillStyle = "#000";
      ctx.fillRect(
        frame.x + (left - crop.x) * scale,
        frame.y + (top - crop.y) * scale,
        (right - left) * scale,
        (bottom - top) * scale,
      );
      continue;
    }

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

  const assetId = doc.clips.find((clip) => clip.id === clipId)?.assetId ?? "";
  const asset = assetOf(doc, assetId);
  const videoWidth = video.videoWidth || asset.width;
  const videoHeight = video.videoHeight || asset.height;
  const layout = layoutOf(doc, width, height, videoWidth, videoHeight);
  const { frame } = layout;
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
    drawBlurs(ctx, video, doc, sourceSec, frame, crop, videoWidth, videoHeight, asset.id);
  }
  ctx.restore();

  const ink = inkOf(doc);
  const chapterTitle = chapterTitleOf(doc, clipId);
  if (chapterTitle) drawHeader(ctx, chapterTitle, frame, ink);
  const caption = captionTextAt(doc, clipId, sourceSec)?.trim();
  if (caption) drawCaption(ctx, caption, frame, layout, ink);

  // 音声の利用条件でクレジットが必須なので、書き忘れないよう動画に入れる。
  const credit = narrationCredit(doc);
  if (credit) drawCredit(ctx, credit);
}

/**
 * 手順の前に差し込むチャプター画面。映像は映さず、見た目の背景の上にチャプター名と補足を置く。
 * 字幕やズームは映像の区間にだけ付くので、ここでは描かない。
 */
export function drawChapter(ctx: CanvasRenderingContext2D, doc: DemoDocument, chapter: Chapter) {
  const { width, height } = ctx.canvas;
  const palette = BACKGROUNDS[doc.look.background];
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, palette.from);
  gradient.addColorStop(1, palette.to);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  const { ink, sub } = inkOf(doc);
  const titleSize = width * 0.045;
  const noteSize = width * 0.022;
  const maxWidth = width * 0.7;

  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `700 ${titleSize}px system-ui, "Hiragino Sans", sans-serif`;
  const titleLines = chapter.title.trim() ? wrapText(ctx, chapter.title.trim(), maxWidth) : [];
  ctx.font = `500 ${noteSize}px system-ui, "Hiragino Sans", sans-serif`;
  const noteLines = chapter.note.trim() ? wrapText(ctx, chapter.note.trim(), maxWidth) : [];

  const titleLineHeight = titleSize * 1.3;
  const noteLineHeight = noteSize * 1.6;
  const gap = titleLines.length && noteLines.length ? titleSize * 0.8 : 0;
  const blockHeight =
    titleLines.length * titleLineHeight + gap + noteLines.length * noteLineHeight;
  let y = (height - blockHeight) / 2;

  ctx.fillStyle = ink;
  ctx.font = `700 ${titleSize}px system-ui, "Hiragino Sans", sans-serif`;
  for (const line of titleLines) {
    ctx.fillText(line, width / 2, y + titleLineHeight / 2);
    y += titleLineHeight;
  }
  if (titleLines.length) {
    // 見出しと補足の区切り線。チャプターの切り替わりだと一目で分かるようにする。
    ctx.fillStyle = ink;
    ctx.globalAlpha = 0.35;
    ctx.fillRect(width / 2 - titleSize, y + gap / 2 - 1, titleSize * 2, 2);
    ctx.globalAlpha = 1;
  }
  y += gap;
  ctx.fillStyle = sub;
  ctx.font = `500 ${noteSize}px system-ui, "Hiragino Sans", sans-serif`;
  for (const line of noteLines) {
    ctx.fillText(line, width / 2, y + noteLineHeight / 2);
    y += noteLineHeight;
  }
  ctx.restore();

  const credit = narrationCredit(doc);
  if (credit) drawCredit(ctx, credit);
}

/**
 * 再生位置の画面を描く。チャプター画面の区間ならチャプター画面、それ以外は映像の手順。
 * 映像はその手順の動画から取る。
 */
export function drawAt(
  ctx: CanvasRenderingContext2D,
  videoOf: (assetId: string) => HTMLVideoElement | undefined,
  doc: DemoDocument,
  timelineSec: number,
) {
  const { clip, sourceSec, inChapter } = locate(doc, timelineSec);
  if (inChapter && clip.chapter) {
    drawChapter(ctx, doc, clip.chapter);
    return;
  }
  const video = videoOf(clip.assetId);
  if (video) drawFrame(ctx, video, doc, clip.id, sourceSec);
}

function drawCredit(ctx: CanvasRenderingContext2D, credit: string) {
  const { width, height } = ctx.canvas;
  const fontSize = width * CREDIT_FONT_RATIO;
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

type Ink = { ink: string; sub: string };

// 背景の上に直接文字を置くので、明るい背景（紙）だけは文字を暗くして読めるようにする。
function inkOf(doc: DemoDocument): Ink {
  return doc.look.background === "paper"
    ? { ink: "#1f1b16", sub: "rgba(31, 27, 22, 0.7)" }
    : { ink: "#ffffff", sub: "rgba(255, 255, 255, 0.75)" };
}

// 上の余白に、いまの手順が属するチャプター名を出す。どの話の途中かが分かるようにする。
function drawHeader(ctx: CanvasRenderingContext2D, title: string, frame: Rect, { sub }: Ink) {
  const { width } = ctx.canvas;
  const fontSize = width * HEADER_FONT_RATIO;
  const centerY = frame.y / 2;
  const barWidth = fontSize * 0.25;

  ctx.save();
  ctx.font = `700 ${fontSize}px ${FONT_FAMILY}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  const textX = frame.x + barWidth + fontSize * 0.6;
  const maxWidth = frame.x + frame.width - textX;
  let text = title;
  if (ctx.measureText(text).width > maxWidth) {
    while (text && ctx.measureText(`${text}…`).width > maxWidth) text = text.slice(0, -1);
    text = `${text}…`;
  }
  ctx.fillStyle = sub;
  ctx.beginPath();
  ctx.roundRect(frame.x, centerY - fontSize * 0.6, barWidth, fontSize * 1.2, barWidth / 2);
  ctx.fill();
  ctx.fillText(text, textX, centerY);
  ctx.restore();
}

// 字幕は映像に重ねず、映像の下の余白に置く。ズームの影響も受けない。
// 帯に収まらないほど長い文は、文字を小さくして収める。
function drawCaption(
  ctx: CanvasRenderingContext2D,
  text: string,
  frame: Rect,
  layout: { padding: number; captionFont: number },
  { ink }: Ink,
) {
  const { width, height } = ctx.canvas;
  const maxWidth = Math.max(frame.width, width - Math.max(layout.padding, width * 0.05) * 2);

  ctx.save();
  let fontSize = layout.captionFont;
  let lines: string[] = [];
  for (;;) {
    ctx.font = `600 ${fontSize}px ${FONT_FAMILY}`;
    lines = wrapText(ctx, text, maxWidth);
    if (lines.length <= CAPTION_MAX_LINES) break;
    const next = fontSize * 0.92;
    if (next < layout.captionFont * MIN_CAPTION_FONT_SCALE) break;
    fontSize = next;
  }
  const lineHeight = fontSize * CAPTION_LINE_HEIGHT;
  const blockHeight = lines.length * lineHeight;
  // 右下のクレジットと重ならないよう、その高さを除いた範囲の中央に置く。
  const bandTop = frame.y + frame.height;
  const bandBottom = height - width * CREDIT_FONT_RATIO * 1.2;
  const top = bandTop + Math.max(0, (bandBottom - bandTop - blockHeight) / 2);

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = ink;
  lines.forEach((line, index) => {
    ctx.fillText(line, width / 2, top + lineHeight * (index + 0.5));
  });
  ctx.restore();
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
