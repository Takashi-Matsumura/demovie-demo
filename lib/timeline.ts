import { newId, type Clip, type DemoDocument, type Zoom } from "./document";

// タイムライン時刻と素材時刻の変換はこのファイルだけが行う。
// クリップは常に隙間なく連続するので、タイムライン時刻はクリップ長の累積で決まる。

const MIN_ZOOM_SEC = 0.3;
const DEFAULT_ZOOM_SEC = 2;
const MIN_CLIP_SEC = 0.05;
const RAMP_SEC = 0.4;

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

export function zoomSpans(doc: DemoDocument) {
  return clipSpans(doc).flatMap((span) =>
    doc.zooms
      .filter((zoom) => zoom.clipId === span.clip.id)
      .flatMap((zoom) => {
        const from = Math.max(zoom.sourceStartSec, span.clip.sourceStartSec);
        const to = Math.min(zoom.sourceEndSec, span.clip.sourceEndSec);
        if (to <= from) return [];
        const shift = span.startSec - span.clip.sourceStartSec;
        return [{ zoom, startSec: from + shift, endSec: to + shift }];
      }),
  );
}

export function zoomAt(doc: DemoDocument, timelineSec: number) {
  return zoomSpans(doc).find(
    ({ startSec, endSec }) => timelineSec >= startSec && timelineSec < endSec,
  );
}

export function splitAt(doc: DemoDocument, timelineSec: number): DemoDocument {
  const { clip, sourceSec } = locate(doc, timelineSec);
  if (
    sourceSec - clip.sourceStartSec < MIN_CLIP_SEC ||
    clip.sourceEndSec - sourceSec < MIN_CLIP_SEC
  ) {
    return doc;
  }
  const head: Clip = { ...clip, sourceEndSec: sourceSec };
  const tail: Clip = { id: newId(), sourceStartSec: sourceSec, sourceEndSec: clip.sourceEndSec };

  const zooms = doc.zooms.flatMap((zoom): Zoom[] => {
    if (zoom.clipId !== clip.id || zoom.sourceEndSec <= sourceSec) return [zoom];
    if (zoom.sourceStartSec >= sourceSec) return [{ ...zoom, clipId: tail.id }];
    return [
      { ...zoom, sourceEndSec: sourceSec },
      { ...zoom, id: newId(), clipId: tail.id, sourceStartSec: sourceSec },
    ];
  });

  const clips = doc.clips.flatMap((item) => (item.id === clip.id ? [head, tail] : [item]));
  return { ...doc, clips, zooms };
}

export function deleteClip(doc: DemoDocument, clipId: string): DemoDocument {
  if (doc.clips.length <= 1) return doc;
  return {
    ...doc,
    clips: doc.clips.filter((clip) => clip.id !== clipId),
    zooms: doc.zooms.filter((zoom) => zoom.clipId !== clipId),
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
