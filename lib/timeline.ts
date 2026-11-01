import { newId, type Blur, type Caption, type Clip, type DemoDocument, type Zoom } from "./document";

// タイムライン時刻と素材時刻の変換はこのファイルだけが行う。
// クリップは常に隙間なく連続するので、タイムライン時刻はクリップ長の累積で決まる。

const MIN_ZOOM_SEC = 0.3;
const DEFAULT_ZOOM_SEC = 2;
const MIN_CAPTION_SEC = 0.3;
const DEFAULT_CAPTION_SEC = 3;
const MIN_CLIP_SEC = 0.05;
const RAMP_SEC = 0.4;
const BLUR_MARGIN_SEC = 1 / 30;

export type ClipSpan = { clip: Clip; startSec: number; endSec: number };

export type Location = { clip: Clip; index: number; sourceSec: number };

export type Camera = { scale: number; centerX: number; centerY: number };

export function clipSpans(doc: DemoDocument): ClipSpan[] {
  let cursor = 0;
  return doc.clips.map((clip) => {
    const startSec = cursor;
    cursor += clip.sourceEndSec - clip.sourceStartSec;
    return { clip, startSec, endSec: cursor };
  });
}

export function totalDuration(doc: DemoDocument) {
  const spans = clipSpans(doc);
  return spans[spans.length - 1].endSec;
}

export function locate(doc: DemoDocument, timelineSec: number): Location {
  const spans = clipSpans(doc);
  const time = Math.max(0, timelineSec);
  const index = spans.findIndex((span) => time < span.endSec);
  const resolved = index === -1 ? spans.length - 1 : index;
  const span = spans[resolved];
  const offset = Math.min(time - span.startSec, span.endSec - span.startSec);
  return {
    clip: span.clip,
    index: resolved,
    sourceSec: span.clip.sourceStartSec + offset,
  };
}

function rangeSpans<T extends Zoom | Caption>(doc: DemoDocument, items: T[]) {
  return clipSpans(doc).flatMap((span) =>
    items
      .filter((item) => item.clipId === span.clip.id)
      .flatMap((item) => {
        const from = Math.max(item.sourceStartSec, span.clip.sourceStartSec);
        const to = Math.min(item.sourceEndSec, span.clip.sourceEndSec);
        if (to <= from) return [];
        const shift = span.startSec - span.clip.sourceStartSec;
        return [{ item, startSec: from + shift, endSec: to + shift }];
      }),
  );
}

export function zoomSpans(doc: DemoDocument) {
  return rangeSpans(doc, doc.zooms).map(({ item, ...span }) => ({ zoom: item, ...span }));
}

export function captionSpans(doc: DemoDocument) {
  return rangeSpans(doc, doc.captions).map(({ item, ...span }) => ({ caption: item, ...span }));
}

export function zoomAt(doc: DemoDocument, timelineSec: number) {
  return zoomSpans(doc).find(
    ({ startSec, endSec }) => timelineSec >= startSec && timelineSec < endSec,
  );
}

export function captionAt(doc: DemoDocument, timelineSec: number) {
  return captionSpans(doc).find(
    ({ startSec, endSec }) => timelineSec >= startSec && timelineSec < endSec,
  );
}

function splitRanges<T extends Zoom | Caption>(
  items: T[],
  clipId: string,
  tailId: string,
  sourceSec: number,
): T[] {
  return items.flatMap((item): T[] => {
    if (item.clipId !== clipId || item.sourceEndSec <= sourceSec) return [item];
    if (item.sourceStartSec >= sourceSec) return [{ ...item, clipId: tailId }];
    return [
      { ...item, sourceEndSec: sourceSec },
      { ...item, id: newId(), clipId: tailId, sourceStartSec: sourceSec },
    ];
  });
}

function splitSource(doc: DemoDocument, clip: Clip, sourceSec: number): DemoDocument {
  if (
    sourceSec - clip.sourceStartSec < MIN_CLIP_SEC ||
    clip.sourceEndSec - sourceSec < MIN_CLIP_SEC
  ) {
    return doc;
  }
  const head: Clip = { ...clip, sourceEndSec: sourceSec };
  const tail: Clip = { id: newId(), sourceStartSec: sourceSec, sourceEndSec: clip.sourceEndSec };
  const clips = doc.clips.flatMap((item) => (item.id === clip.id ? [head, tail] : [item]));
  return {
    ...doc,
    clips,
    zooms: splitRanges(doc.zooms, clip.id, tail.id, sourceSec),
    captions: splitRanges(doc.captions, clip.id, tail.id, sourceSec),
  };
}

export function splitAt(doc: DemoDocument, timelineSec: number): DemoDocument {
  const { clip, sourceSec } = locate(doc, timelineSec);
  return splitSource(doc, clip, sourceSec);
}

// ステップはクリップそのもの。削除や並べ替えは映像ごと動くようクリップの操作をそのまま使う。
export function stepSpans(doc: DemoDocument) {
  const captions = captionSpans(doc);
  return clipSpans(doc).map((span) => ({
    ...span,
    caption:
      captions
        .filter(({ caption }) => caption.clipId === span.clip.id)
        .sort((a, b) => a.startSec - b.startSec)[0]?.caption ?? null,
  }));
}

export function setStepText(doc: DemoDocument, clipId: string, text: string): DemoDocument {
  const step = stepSpans(doc).find((item) => item.clip.id === clipId);
  if (!step) return doc;
  if (step.caption) return updateCaption(doc, step.caption.id, text);
  const caption: Caption = {
    id: newId(),
    clipId,
    sourceStartSec: step.clip.sourceStartSec,
    sourceEndSec: step.clip.sourceEndSec,
    text,
  };
  return { ...doc, captions: [...doc.captions, caption] };
}

// 説明の始まりでクリップを分け、次の説明が始まるまで表示し続ける。
// 手動のズームは残し、重なる提案は捨てる。
export function applySteps(
  doc: DemoDocument,
  captions: Caption[],
  zooms: Zoom[] = [],
): DemoDocument {
  const hasClip = (item: Caption | Zoom) => doc.clips.some((clip) => clip.id === item.clipId);
  const isFree = (zoom: Zoom) =>
    !doc.zooms.some(
      (item) =>
        item.clipId === zoom.clipId &&
        item.sourceStartSec < zoom.sourceEndSec &&
        zoom.sourceStartSec < item.sourceEndSec,
    );
  let next: DemoDocument = {
    ...doc,
    captions: captions.filter(hasClip),
    zooms: [...doc.zooms, ...zooms.filter(hasClip).filter(isFree)],
  };
  for (const { id } of next.captions) {
    const caption = next.captions.find((item) => item.id === id);
    const clip = next.clips.find((item) => item.id === caption?.clipId);
    if (caption && clip) next = splitSource(next, clip, caption.sourceStartSec);
  }
  const { captions: placed, clips } = next;
  return {
    ...next,
    captions: placed.map((caption) => {
      const clip = clips.find((item) => item.id === caption.clipId);
      const sourceEndSec = placed
        .filter(
          (item) =>
            item.clipId === caption.clipId && item.sourceStartSec > caption.sourceStartSec,
        )
        .reduce(
          (limit, item) => Math.min(limit, item.sourceStartSec),
          clip?.sourceEndSec ?? caption.sourceEndSec,
        );
      return { ...caption, sourceEndSec };
    }),
  };
}

export function deleteClip(doc: DemoDocument, clipId: string): DemoDocument {
  if (doc.clips.length <= 1) return doc;
  return {
    ...doc,
    clips: doc.clips.filter((clip) => clip.id !== clipId),
    zooms: doc.zooms.filter((zoom) => zoom.clipId !== clipId),
    captions: doc.captions.filter((caption) => caption.clipId !== clipId),
  };
}

export function moveClip(doc: DemoDocument, clipId: string, delta: -1 | 1): DemoDocument {
  const from = doc.clips.findIndex((clip) => clip.id === clipId);
  const to = from + delta;
  if (from === -1 || to < 0 || to >= doc.clips.length) return doc;
  const clips = [...doc.clips];
  [clips[from], clips[to]] = [clips[to], clips[from]];
  return { ...doc, clips };
}

function nextZoomStart(doc: DemoDocument, clip: Clip, sourceSec: number, ignoreId?: string) {
  return doc.zooms
    .filter(
      (zoom) =>
        zoom.clipId === clip.id && zoom.id !== ignoreId && zoom.sourceStartSec >= sourceSec,
    )
    .reduce((limit, zoom) => Math.min(limit, zoom.sourceStartSec), clip.sourceEndSec);
}

// 空きが足りないときは null を返す。呼び出し側はそのまま何もしない。
export function addZoom(
  doc: DemoDocument,
  timelineSec: number,
): { doc: DemoDocument; zoomId: string } | null {
  const { clip, sourceSec } = locate(doc, timelineSec);
  const insideZoom = doc.zooms.some(
    (zoom) =>
      zoom.clipId === clip.id &&
      sourceSec >= zoom.sourceStartSec &&
      sourceSec < zoom.sourceEndSec,
  );
  if (insideZoom) return null;

  const limit = nextZoomStart(doc, clip, sourceSec);
  const sourceEndSec = Math.min(sourceSec + DEFAULT_ZOOM_SEC, limit);
  if (sourceEndSec - sourceSec < MIN_ZOOM_SEC) return null;

  const zoom: Zoom = {
    id: newId(),
    clipId: clip.id,
    sourceStartSec: sourceSec,
    sourceEndSec,
    depth: 1.8,
    focusX: 0.5,
    focusY: 0.5,
  };
  return { doc: { ...doc, zooms: [...doc.zooms, zoom] }, zoomId: zoom.id };
}

export function updateZoom(
  doc: DemoDocument,
  zoomId: string,
  patch: Partial<Pick<Zoom, "depth" | "focusX" | "focusY">>,
): DemoDocument {
  return {
    ...doc,
    zooms: doc.zooms.map((zoom) => (zoom.id === zoomId ? { ...zoom, ...patch } : zoom)),
  };
}

export function setZoomLength(doc: DemoDocument, zoomId: string, lengthSec: number): DemoDocument {
  const zoom = doc.zooms.find((item) => item.id === zoomId);
  const clip = doc.clips.find((item) => item.id === zoom?.clipId);
  if (!zoom || !clip) return doc;
  const limit = nextZoomStart(doc, clip, zoom.sourceStartSec, zoom.id);
  const sourceEndSec = Math.min(zoom.sourceStartSec + Math.max(lengthSec, MIN_ZOOM_SEC), limit);
  return {
    ...doc,
    zooms: doc.zooms.map((item) => (item.id === zoomId ? { ...item, sourceEndSec } : item)),
  };
}

export function removeZoom(doc: DemoDocument, zoomId: string): DemoDocument {
  return { ...doc, zooms: doc.zooms.filter((zoom) => zoom.id !== zoomId) };
}

// 空きが足りないときは元の doc を返す。本文は右パネルで入力してもらう。
export function addCaption(doc: DemoDocument, timelineSec: number): DemoDocument {
  if (captionAt(doc, timelineSec)) return doc;
  const { clip, sourceSec } = locate(doc, timelineSec);
  const sourceEndSec = doc.captions
    .filter((item) => item.clipId === clip.id && item.sourceStartSec >= sourceSec)
    .reduce(
      (limit, item) => Math.min(limit, item.sourceStartSec),
      Math.min(sourceSec + DEFAULT_CAPTION_SEC, clip.sourceEndSec),
    );
  if (sourceEndSec - sourceSec < MIN_CAPTION_SEC) return doc;
  const caption: Caption = {
    id: newId(),
    clipId: clip.id,
    sourceStartSec: sourceSec,
    sourceEndSec,
    text: "",
  };
  return { ...doc, captions: [...doc.captions, caption] };
}

// 前後のキャプションとクリップの端に挟まれた、動かせる範囲をタイムライン時刻で返す。
export function captionBounds(doc: DemoDocument, captionId: string) {
  const caption = doc.captions.find((item) => item.id === captionId);
  const span = clipSpans(doc).find((item) => item.clip.id === caption?.clipId);
  if (!caption || !span) return null;
  const others = doc.captions.filter(
    (item) => item.clipId === caption.clipId && item.id !== caption.id,
  );
  const minSec = others
    .filter((item) => item.sourceEndSec <= caption.sourceStartSec)
    .reduce((limit, item) => Math.max(limit, item.sourceEndSec), span.clip.sourceStartSec);
  const maxSec = others
    .filter((item) => item.sourceStartSec >= caption.sourceEndSec)
    .reduce((limit, item) => Math.min(limit, item.sourceStartSec), span.clip.sourceEndSec);
  const shift = span.startSec - span.clip.sourceStartSec;
  return { minSec: minSec + shift, maxSec: maxSec + shift, shift };
}

export function setCaptionRange(
  doc: DemoDocument,
  captionId: string,
  startSec: number,
  endSec: number,
): DemoDocument {
  const bounds = captionBounds(doc, captionId);
  if (!bounds) return doc;
  const from = Math.max(startSec, bounds.minSec);
  const to = Math.min(endSec, bounds.maxSec);
  if (to - from < MIN_CAPTION_SEC) return doc;
  return {
    ...doc,
    captions: doc.captions.map((item) =>
      item.id === captionId
        ? { ...item, sourceStartSec: from - bounds.shift, sourceEndSec: to - bounds.shift }
        : item,
    ),
  };
}

export function updateCaption(doc: DemoDocument, captionId: string, text: string): DemoDocument {
  return {
    ...doc,
    captions: doc.captions.map((item) => (item.id === captionId ? { ...item, text } : item)),
  };
}

export function removeCaption(doc: DemoDocument, captionId: string): DemoDocument {
  return { ...doc, captions: doc.captions.filter((caption) => caption.id !== captionId) };
}

export type BlurRect = Pick<Blur, "x" | "y" | "width" | "height">;

// 隠し忘れを防ぐため、新しいぼかしは動画全体にかける。
export function addBlur(doc: DemoDocument, rect: BlurRect): DemoDocument {
  const blur: Blur = {
    id: newId(),
    sourceStartSec: 0,
    sourceEndSec: doc.asset.durationSec,
    ...rect,
  };
  return { ...doc, blurs: [...doc.blurs, blur] };
}

export function setBlurRange(
  doc: DemoDocument,
  blurId: string,
  sourceStartSec: number,
  sourceEndSec: number,
): DemoDocument {
  return {
    ...doc,
    blurs: doc.blurs.map((item) =>
      item.id === blurId ? { ...item, sourceStartSec, sourceEndSec } : item,
    ),
  };
}

export function removeBlur(doc: DemoDocument, blurId: string): DemoDocument {
  return { ...doc, blurs: doc.blurs.filter((item) => item.id !== blurId) };
}

// 書き出しでは終了時刻ちょうどのコマも描く。隠し損ねないよう、両端を 1 コマ分広げる。
export function blursAt(doc: DemoDocument, sourceSec: number) {
  return doc.blurs.filter(
    (item) =>
      sourceSec >= item.sourceStartSec - BLUR_MARGIN_SEC &&
      sourceSec <= item.sourceEndSec + BLUR_MARGIN_SEC,
  );
}

export function captionTextAt(doc: DemoDocument, clipId: string, sourceSec: number) {
  return doc.captions.find(
    (item) =>
      item.clipId === clipId && sourceSec >= item.sourceStartSec && sourceSec < item.sourceEndSec,
  )?.text;
}

function smoothstep(value: number) {
  const x = Math.min(1, Math.max(0, value));
  return x * x * (3 - 2 * x);
}

export function cameraAt(doc: DemoDocument, clipId: string, sourceSec: number): Camera {
  const zoom = doc.zooms.find(
    (item) =>
      item.clipId === clipId && sourceSec >= item.sourceStartSec && sourceSec < item.sourceEndSec,
  );
  if (!zoom) return { scale: 1, centerX: 0.5, centerY: 0.5 };

  const ramp = Math.min(RAMP_SEC, (zoom.sourceEndSec - zoom.sourceStartSec) / 2);
  const weight = smoothstep(
    Math.min(sourceSec - zoom.sourceStartSec, zoom.sourceEndSec - sourceSec) / ramp,
  );
  return {
    scale: 1 + (zoom.depth - 1) * weight,
    centerX: 0.5 + (zoom.focusX - 0.5) * weight,
    centerY: 0.5 + (zoom.focusY - 0.5) * weight,
  };
}
