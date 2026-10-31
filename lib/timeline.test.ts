import { describe, expect, it } from "vitest";
import { createDocument, documentSchema, newId, type DemoDocument } from "./document";
import {
  addCaption,
  addZoom,
  cameraAt,
  captionAt,
  captionBounds,
  captionSpans,
  captionTextAt,
  deleteClip,
  locate,
  moveClip,
  setCaptionRange,
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

describe("captions", () => {
  function withCaption(doc: DemoDocument, clipIndex: number, from: number, to: number) {
    const caption = {
      id: newId(),
      clipId: doc.clips[clipIndex].id,
      sourceStartSec: from,
      sourceEndSec: to,
      text: "保存する",
    };
    return { ...doc, captions: [...doc.captions, caption] };
  }

  it("divides a caption that crosses the cut", () => {
    const split = splitAt(withCaption(makeDoc(), 0, 3, 5), 4);
    expect(captionSpans(split).map(({ startSec, endSec }) => [startSec, endSec])).toEqual([
      [3, 4],
      [4, 5],
    ]);
    expect(documentSchema.safeParse(split).success).toBe(true);
  });

  it("moves with its clip and goes away with it", () => {
    const doc = withCaption(splitAt(makeDoc(), 4), 1, 5, 7);
    const moved = moveClip(doc, doc.clips[1].id, -1);
    expect(captionAt(moved, 2)?.caption.text).toBe("保存する");
    expect(deleteClip(doc, doc.clips[1].id).captions).toEqual([]);
  });

  it("adds an empty caption at the playhead and stops at the next one", () => {
    const doc = addCaption(withCaption(makeDoc(), 0, 3, 5), 1);
    expect(doc.captions).toHaveLength(2);
    expect(doc.captions[1]).toMatchObject({ sourceStartSec: 1, sourceEndSec: 3, text: "" });
    expect(documentSchema.safeParse(doc).success).toBe(true);
  });

  it("refuses to add where there is no room", () => {
    const taken = withCaption(makeDoc(), 0, 3, 5);
    expect(addCaption(taken, 4)).toBe(taken);
    expect(addCaption(taken, 2.9)).toBe(taken);
    const doc = makeDoc();
    expect(addCaption(doc, 9.9)).toBe(doc);
  });

  it("clamps a range to its neighbours and the clip", () => {
    const doc = withCaption(withCaption(makeDoc(), 0, 1, 2), 0, 4, 5);
    const { id } = doc.captions[1];
    expect(captionBounds(doc, id)).toMatchObject({ minSec: 2, maxSec: 10 });
    expect(setCaptionRange(doc, id, 0, 20).captions[1]).toMatchObject({
      sourceStartSec: 2,
      sourceEndSec: 10,
    });
    expect(setCaptionRange(doc, id, 4, 4.1)).toBe(doc);
  });

  it("takes timeline time after a reorder", () => {
    const doc = withCaption(splitAt(makeDoc(), 4), 1, 5, 7);
    const moved = moveClip(doc, doc.clips[1].id, -1);
    const { id } = moved.captions[0];
    expect(captionBounds(moved, id)).toMatchObject({ minSec: 0, maxSec: 6 });
    expect(setCaptionRange(moved, id, 2, 4).captions[0]).toMatchObject({
      sourceStartSec: 6,
      sourceEndSec: 8,
    });
  });

  it("finds the text by source time", () => {
    const doc = withCaption(makeDoc(), 0, 3, 5);
    const clipId = doc.clips[0].id;
    expect(captionTextAt(doc, clipId, 2.9)).toBeUndefined();
    expect(captionTextAt(doc, clipId, 3)).toBe("保存する");
    expect(captionTextAt(doc, clipId, 5)).toBeUndefined();
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
