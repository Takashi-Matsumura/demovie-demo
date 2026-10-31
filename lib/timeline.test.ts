import { describe, expect, it } from "vitest";
import { createDocument, documentSchema, type DemoDocument } from "./document";
import {
  addZoom,
  cameraAt,
  deleteClip,
  locate,
  moveClip,
  setZoomLength,
  splitAt,
  totalDuration,
  zoomAt,
  zoomSpans,
} from "./timeline";

function makeDoc(): DemoDocument {
  return createDocument({ name: "a.webm", durationSec: 10, width: 1920, height: 1080 });
}

function withZoom(doc: DemoDocument, timelineSec: number) {
  const result = addZoom(doc, timelineSec);
  if (!result) throw new Error("zoom was not added");
  return result;
}

describe("split", () => {
  it("keeps the total duration and stays contiguous", () => {
    const doc = splitAt(makeDoc(), 4);
    expect(doc.clips).toHaveLength(2);
    expect(totalDuration(doc)).toBe(10);
    expect(doc.clips[0].sourceEndSec).toBe(doc.clips[1].sourceStartSec);
    expect(locate(doc, 4)).toMatchObject({ index: 1, sourceSec: 4 });
  });

  it("does nothing at a clip edge", () => {
    const doc = makeDoc();
    expect(splitAt(doc, 0)).toBe(doc);
    expect(splitAt(doc, 10)).toBe(doc);
  });

  it("divides a zoom that crosses the cut, without moving it", () => {
    const { doc } = withZoom(makeDoc(), 3);
    const split = splitAt(doc, 4);
    expect(split.zooms).toHaveLength(2);
    expect(zoomSpans(split).map(({ startSec, endSec }) => [startSec, endSec])).toEqual([
      [3, 4],
      [4, 5],
    ]);
    expect(documentSchema.safeParse(split).success).toBe(true);
  });
});

describe("clip edits carry zooms", () => {
  it("moves a zoom with its clip on reorder", () => {
    const { doc } = withZoom(splitAt(makeDoc(), 4), 5);
    const moved = moveClip(doc, doc.clips[1].id, -1);
    const [span] = zoomSpans(moved);
    expect(span.startSec).toBe(1);
    expect(span.endSec).toBe(3);
    expect(locate(moved, 1).sourceSec).toBe(5);
  });

  it("drops the zooms of a deleted clip and shifts the rest", () => {
    const first = withZoom(splitAt(makeDoc(), 4), 1);
    const { doc } = withZoom(first.doc, 5);
    const deleted = deleteClip(doc, doc.clips[0].id);
    expect(totalDuration(deleted)).toBe(6);
    expect(zoomSpans(deleted).map(({ startSec }) => startSec)).toEqual([1]);
  });

  it("refuses to delete the last clip", () => {
    const doc = makeDoc();
    expect(deleteClip(doc, doc.clips[0].id)).toBe(doc);
  });

  it("shows nothing for a zoom cut out of the clip range", () => {
    const { doc } = withZoom(makeDoc(), 8);
    const shrunk = { ...doc, clips: [{ ...doc.clips[0], sourceEndSec: 5 }] };
    expect(zoomSpans(shrunk)).toEqual([]);
  });
});

describe("zoom limits", () => {
  it("stops a new zoom at the next one and at the clip end", () => {
    const { doc } = withZoom(makeDoc(), 2);
    expect(addZoom(doc, 2.5)).toBeNull();
    const before = withZoom(doc, 1);
    expect(before.doc.zooms[1].sourceEndSec).toBe(2);
    expect(withZoom(makeDoc(), 9).doc.zooms[0].sourceEndSec).toBe(10);
    expect(addZoom(makeDoc(), 9.9)).toBeNull();
  });

  it("clamps a length change to the next zoom", () => {
    const first = withZoom(makeDoc(), 1);
    const { doc } = withZoom(first.doc, 4);
    const resized = setZoomLength(doc, first.zoomId, 9);
    expect(resized.zooms[0].sourceEndSec).toBe(4);
  });
});

describe("zoom under the playhead", () => {
  it("finds a zoom only inside its span", () => {
    const { doc, zoomId } = withZoom(makeDoc(), 2);
    expect(zoomAt(doc, 1.9)).toBeUndefined();
    expect(zoomAt(doc, 2)?.zoom.id).toBe(zoomId);
    expect(zoomAt(doc, 3.9)?.zoom.id).toBe(zoomId);
    expect(zoomAt(doc, 4)).toBeUndefined();
  });

  it("follows a zoom when its clip is reordered", () => {
    const { doc, zoomId } = withZoom(splitAt(makeDoc(), 4), 5);
    const moved = moveClip(doc, doc.clips[1].id, -1);
    expect(zoomAt(moved, 2)?.zoom.id).toBe(zoomId);
    expect(zoomAt(moved, 5)).toBeUndefined();
  });
});

describe("camera", () => {
  it("ramps in, holds the depth, then returns to rest", () => {
    const { doc, zoomId } = withZoom(makeDoc(), 2);
    const clipId = doc.clips[0].id;
    const depth = doc.zooms[0].depth;
    expect(zoomId).toBe(doc.zooms[0].id);
    expect(cameraAt(doc, clipId, 1).scale).toBe(1);
    expect(cameraAt(doc, clipId, 2).scale).toBe(1);
    expect(cameraAt(doc, clipId, 3).scale).toBeCloseTo(depth);
    expect(cameraAt(doc, clipId, 4).scale).toBe(1);
  });
});
