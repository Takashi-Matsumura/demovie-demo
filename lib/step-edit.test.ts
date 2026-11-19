import { describe, expect, it } from "vitest";
import { createDocument, newId, type DemoDocument } from "./document";
import {
  clipEdgeLimits,
  deleteClip,
  mergeBlocker,
  mergeWithNext,
  moveClip,
  moveClipEdge,
  setClipIncluded,
  splitAt,
} from "./timeline";

// 0〜4、4〜7、7〜10 秒の 3 手順。それぞれ手順全体を覆う説明文を持つ。
function threeSteps(): DemoDocument {
  const base = splitAt(
    splitAt(createDocument({ name: "a.webm", durationSec: 10, width: 1920, height: 1080 }), 4),
    7,
  );
  return {
    ...base,
    captions: base.clips.map((clip, index) => ({
      id: newId(),
      clipId: clip.id,
      sourceStartSec: clip.sourceStartSec,
      sourceEndSec: clip.sourceEndSec,
      text: `手順${index + 1}`,
    })),
  };
}

const ranges = (doc: DemoDocument) =>
  doc.clips.map((clip) => [clip.sourceStartSec, clip.sourceEndSec]);
const captionOf = (doc: DemoDocument, text: string) =>
  doc.captions.find((caption) => caption.text === text);

describe("moveClipEdge", () => {
  it("moves the boundary shared with the joined neighbor", () => {
    const doc = threeSteps();
    const next = moveClipEdge(doc, doc.clips[1].id, "start", 3);
    expect(ranges(next)).toEqual([
      [0, 3],
      [3, 7],
      [7, 10],
    ]);
    // 端に揃っていた説明文は、手順の新しい範囲に付いていく。
    expect(captionOf(next, "手順1")).toMatchObject({ sourceStartSec: 0, sourceEndSec: 3 });
    expect(captionOf(next, "手順2")).toMatchObject({ sourceStartSec: 3, sourceEndSec: 7 });
  });

  it("keeps the neighbor at least a minimum length", () => {
    const doc = threeSteps();
    const limits = clipEdgeLimits(doc, doc.clips[1].id, "end");
    expect(limits?.maxSec).toBeCloseTo(9.95);
    const next = moveClipEdge(doc, doc.clips[1].id, "end", 20);
    expect(next.clips[1].sourceEndSec).toBeCloseTo(9.95);
    expect(next.clips[2].sourceStartSec).toBeCloseTo(9.95);
  });

  it("trims and extends an outer edge on its own", () => {
    const doc = threeSteps();
    const trimmed = moveClipEdge(doc, doc.clips[0].id, "start", 1);
    expect(ranges(trimmed)[0]).toEqual([1, 4]);
    expect(captionOf(trimmed, "手順1")).toMatchObject({ sourceStartSec: 1 });
    // 素材の始まりより前には伸ばせない。
    expect(ranges(moveClipEdge(trimmed, doc.clips[0].id, "start", -5))[0]).toEqual([0, 4]);
  });

  it("does not extend over footage another step uses", () => {
    const doc = threeSteps();
    // 手順 2 を消すと、手順 1 と 3 は元の映像が続いていない。
    const gap = deleteClip(doc, doc.clips[1].id);
    const next = moveClipEdge(gap, gap.clips[0].id, "end", 9);
    expect(ranges(next)).toEqual([
      [0, 7],
      [7, 10],
    ]);
  });

  it("drops zooms squeezed out of the step", () => {
    const doc = threeSteps();
    const zoom = {
      id: newId(),
      clipId: doc.clips[0].id,
      sourceStartSec: 3,
      sourceEndSec: 3.8,
      depth: 2,
      focusX: 0.5,
      focusY: 0.5,
    };
    const next = moveClipEdge({ ...doc, zooms: [zoom] }, doc.clips[1].id, "start", 3.2);
    expect(next.zooms).toEqual([]);
  });
});

describe("mergeWithNext", () => {
  it("joins the next step and keeps its captions", () => {
    const doc = threeSteps();
    const next = mergeWithNext(doc, doc.clips[0].id);
    expect(ranges(next)).toEqual([
      [0, 7],
      [7, 10],
    ]);
    expect(next.clips[0].id).toBe(doc.clips[0].id);
    expect(captionOf(next, "手順2")?.clipId).toBe(doc.clips[0].id);
  });

  it("refuses steps whose footage is not continuous", () => {
    const doc = threeSteps();
    const moved = moveClip(doc, doc.clips[0].id, 1);
    expect(mergeBlocker(moved, moved.clips[0].id)).toMatch("続いていない");
    expect(mergeWithNext(moved, moved.clips[0].id)).toBe(moved);
  });

  it("refuses to join included and excluded steps", () => {
    const doc = threeSteps();
    const hidden = setClipIncluded(doc, doc.clips[1].id, false);
    expect(mergeBlocker(hidden, hidden.clips[0].id)).toMatch("含めない");
  });

  it("refuses the last step", () => {
    const doc = threeSteps();
    expect(mergeBlocker(doc, doc.clips[2].id)).not.toBeNull();
  });
});
