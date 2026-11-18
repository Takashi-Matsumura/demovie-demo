import { describe, expect, it } from "vitest";
import { createDocument, documentSchema, newId, type DemoDocument } from "./document";
import { mosaicGrid, thumbnailDoc, thumbnailSec } from "./render";
import {
  addBlur,
  addCaption,
  addZoom,
  applySteps,
  blursAt,
  cameraAt,
  captionAt,
  captionBounds,
  captionSpans,
  captionTextAt,
  canExclude,
  clipSpans,
  deleteClip,
  layoutDuration,
  layoutPosition,
  locate,
  moveClip,
  pointAtLayout,
  removeBlur,
  setBlurRange,
  setBlurStyle,
  setCaptionRange,
  setChapter,
  setClipIncluded,
  setStepText,
  setZoomLength,
  splitAt,
  splitAtSources,
  stepLayout,
  stepSpans,
  totalDuration,
  zoomAt,
  zoomWindow,
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

describe("splitAtSources", () => {
  it("splits one clip at several detected points", () => {
    const base = makeDoc();
    const clipId = base.clips[0].id;
    const doc = splitAtSources(base, [
      { clipId, sourceSec: 3 },
      { clipId, sourceSec: 7 },
    ]);
    expect(doc.clips.map((clip) => [clip.sourceStartSec, clip.sourceEndSec])).toEqual([
      [0, 3],
      [3, 7],
      [7, 10],
    ]);
    expect(doc.clips[0].id).toBe(clipId);
  });

  it("ignores points at a clip edge or in unknown clips", () => {
    const base = makeDoc();
    const clipId = base.clips[0].id;
    const doc = splitAtSources(base, [
      { clipId, sourceSec: 0 },
      { clipId: "missing", sourceSec: 5 },
    ]);
    expect(doc.clips).toHaveLength(1);
  });
});

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

describe("steps", () => {
  function caption(clipId: string, sourceStartSec: number, sourceEndSec: number, text: string) {
    return { id: newId(), clipId, sourceStartSec, sourceEndSec, text };
  }

  it("cuts at each caption and keeps the text until the next one", () => {
    const doc = makeDoc();
    const clipId = doc.clips[0].id;
    const steps = applySteps(doc, [caption(clipId, 2, 3, "開く"), caption(clipId, 6, 7, "保存")]);
    expect(stepSpans(steps).map((step) => [step.startSec, step.endSec, step.caption?.text])).toEqual([
      [0, 2, undefined],
      [2, 6, "開く"],
      [6, 10, "保存"],
    ]);
    expect(totalDuration(steps)).toBe(10);
    expect(documentSchema.safeParse(steps).success).toBe(true);
  });

  it("does not leave a sliver when a caption starts at a clip edge", () => {
    const doc = makeDoc();
    const steps = applySteps(doc, [caption(doc.clips[0].id, 0, 2, "開く")]);
    expect(steps.clips).toHaveLength(1);
    expect(steps.captions[0].sourceEndSec).toBe(10);
  });

  it("replaces earlier captions and drops ones whose clip is gone", () => {
    const base = makeDoc();
    const doc = setStepText(base, base.clips[0].id, "古い説明");
    expect(applySteps(doc, [caption("missing", 1, 2, "x")]).captions).toEqual([]);
  });

  it("skips a suggested zoom that overlaps a manual one", () => {
    const { doc } = withZoom(makeDoc(), 1);
    const clipId = doc.clips[0].id;
    const zoom = (sourceStartSec: number, sourceEndSec: number) => ({
      id: newId(),
      clipId,
      sourceStartSec,
      sourceEndSec,
      depth: 2,
      focusX: 0.5,
      focusY: 0.5,
    });
    const steps = applySteps(
      doc,
      [caption(clipId, 2, 3, "開く"), caption(clipId, 6, 7, "保存")],
      [zoom(2, 3), zoom(6, 7)],
    );
    expect(zoomSpans(steps).map(({ startSec, endSec }) => [startSec, endSec])).toEqual([
      [1, 2],
      [2, 3],
      [6, 7],
    ]);
    expect(steps.zooms).toHaveLength(3);
    expect(documentSchema.safeParse(steps).success).toBe(true);
  });

  it("creates a caption for a step without text, then updates it", () => {
    const doc = splitAt(makeDoc(), 4);
    const clipId = doc.clips[1].id;
    const typed = setStepText(doc, clipId, "保存");
    expect(typed.captions[0]).toMatchObject({ sourceStartSec: 4, sourceEndSec: 10 });
    const changed = setStepText(typed, clipId, "保存します");
    expect(changed.captions).toHaveLength(1);
    expect(stepSpans(changed)[1].caption?.text).toBe("保存します");
  });

  it("removes the text and the video together when a step is deleted", () => {
    const split = splitAt(makeDoc(), 4);
    const named = setStepText(split, split.clips[1].id, "保存");
    const deleted = deleteClip(named, split.clips[1].id);
    expect(deleted.captions).toEqual([]);
    expect(totalDuration(deleted)).toBe(4);
  });
});

describe("blurs", () => {
  const rect = { x: 0.1, y: 0.1, width: 0.2, height: 0.1 };

  it("covers the whole video by default", () => {
    const doc = addBlur(makeDoc(), rect);
    expect(blursAt(doc, 0)).toHaveLength(1);
    expect(blursAt(doc, 9.9)).toHaveLength(1);
    expect(documentSchema.safeParse(doc).success).toBe(true);
  });

  it("stays on the same footage through splits, moves and deletes", () => {
    const doc = addBlur(splitAt(makeDoc(), 4), rect);
    const moved = moveClip(doc, doc.clips[1].id, -1);
    const deleted = deleteClip(splitAt(moved, 2), moved.clips[0].id);
    expect(deleted.blurs).toEqual(doc.blurs);
    expect(blursAt(deleted, 7)).toHaveLength(1);
  });

  it("can be narrowed and removed", () => {
    const doc = addBlur(makeDoc(), rect);
    const { id } = doc.blurs[0];
    const narrowed = setBlurRange(doc, id, 2, 4);
    expect(blursAt(narrowed, 1)).toEqual([]);
    expect(blursAt(narrowed, 2)).toHaveLength(1);
    expect(blursAt(narrowed, 4.1)).toEqual([]);
    expect(removeBlur(doc, id).blurs).toEqual([]);
  });

  it("covers the frames at both ends of its range", () => {
    const doc = addBlur(makeDoc(), rect);
    const { id } = doc.blurs[0];
    expect(blursAt(doc, doc.asset.durationSec)).toHaveLength(1);
    const narrowed = setBlurRange(doc, id, 2, 4);
    expect(blursAt(narrowed, 4)).toHaveLength(1);
    expect(blursAt(narrowed, 1.98)).toHaveLength(1);
  });

  it("sizes mosaic blocks by the recording, not the zoomed output", () => {
    expect(mosaicGrid(380, 100, 1920, 1080)).toEqual({ columns: 9, rows: 2 });
    expect(mosaicGrid(5, 5, 1920, 1080)).toEqual({ columns: 1, rows: 1 });
  });

  it("keeps mosaic blocks large on portrait and small recordings", () => {
    const portrait = mosaicGrid(1080, 400, 1080, 1920);
    expect(1080 / portrait.columns).toBeGreaterThanOrEqual(1920 * (16 / 9) * 0.02);
    expect(mosaicGrid(320, 160, 320, 180)).toEqual({ columns: 20, rows: 10 });
  });

  it("switches to a solid box and back", () => {
    const doc = addBlur(makeDoc(), rect);
    expect(doc.blurs[0].style).toBe("mosaic");
    const solid = setBlurStyle(doc, doc.blurs[0].id, "solid");
    expect(solid.blurs[0].style).toBe("solid");
    expect(documentSchema.safeParse(solid).success).toBe(true);
  });

  it("opens blurs saved before styles existed as mosaics", () => {
    const doc = addBlur(makeDoc(), rect);
    const { style: _style, ...saved } = doc.blurs[0];
    expect(_style).toBe("mosaic");
    expect(documentSchema.parse({ ...doc, blurs: [saved] }).blurs[0].style).toBe("mosaic");
  });

  it("opens work saved before blurs existed", () => {
    const saved: Record<string, unknown> = { ...makeDoc() };
    delete saved.blurs;
    expect(documentSchema.parse(saved).blurs).toEqual([]);
  });
});

describe("thumbnails", () => {
  it("shows the screen shortly after the step begins", () => {
    expect(thumbnailSec({ sourceStartSec: 2, sourceEndSec: 9 })).toBe(3);
    expect(thumbnailSec({ sourceStartSec: 2, sourceEndSec: 3 })).toBe(2.5);
  });

  it("keeps blurs while dropping the frame around the video", () => {
    const doc = addBlur(makeDoc(), { x: 0, y: 0, width: 0.5, height: 0.5 });
    const plain = thumbnailDoc(doc);
    expect(plain.blurs).toEqual(doc.blurs);
    expect(plain.look.paddingPct).toBe(0);
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

describe("excluded steps", () => {
  function threeSteps() {
    return splitAt(splitAt(makeDoc(), 3), 6);
  }

  it("drops an excluded step from the timeline but keeps it in the step list", () => {
    const base = threeSteps();
    const doc = setClipIncluded(base, base.clips[1].id, false);
    expect(totalDuration(doc)).toBe(7);
    expect(clipSpans(doc).map((span) => [span.startSec, span.endSec])).toEqual([
      [0, 3],
      [3, 7],
    ]);
    const steps = stepSpans(doc).map((step) => [
      step.startSec,
      step.endSec,
      step.durationSec,
      step.included,
    ]);
    expect(steps).toEqual([
      [0, 3, 3, true],
      [3, 3, 3, false],
      [3, 7, 4, true],
    ]);
    expect(documentSchema.safeParse(doc).success).toBe(true);
  });

  it("restores the step with its caption and zoom when included again", () => {
    const base = threeSteps();
    const clipId = base.clips[1].id;
    const edited = withZoom(setStepText(base, clipId, "保存"), 4).doc;
    const hidden = setClipIncluded(edited, clipId, false);
    expect(stepSpans(hidden)[1].caption?.text).toBe("保存");
    expect(captionAt(hidden, 4)).toBeUndefined();
    expect(zoomSpans(hidden)).toHaveLength(0);

    const shown = setClipIncluded(hidden, clipId, true);
    expect(shown.clips[1]).not.toHaveProperty("hidden");
    expect(captionAt(shown, 4)?.caption.text).toBe("保存");
    expect(zoomSpans(shown)).toHaveLength(1);
  });

  it("numbers steps across excluded ones", () => {
    const base = threeSteps();
    const doc = setClipIncluded(base, base.clips[1].id, false);
    expect(locate(doc, 4)).toMatchObject({ index: 1, step: 2, clip: { id: base.clips[2].id } });
  });

  it("keeps at least one step in the video", () => {
    const base = makeDoc();
    const clipId = base.clips[0].id;
    expect(canExclude(base, clipId)).toBe(false);
    expect(setClipIncluded(base, clipId, false)).toBe(base);

    const two = splitAt(base, 5);
    const hidden = setClipIncluded(two, two.clips[0].id, false);
    expect(setClipIncluded(hidden, two.clips[1].id, false)).toBe(hidden);
    expect(deleteClip(hidden, two.clips[1].id)).toBe(hidden);
    expect(deleteClip(hidden, two.clips[0].id).clips).toHaveLength(1);
    const allHidden = { ...hidden, clips: hidden.clips.map((clip) => ({ ...clip, hidden: true })) };
    expect(documentSchema.safeParse(allHidden).success).toBe(false);
  });

  it("keeps excluded steps excluded when a neighbor is split", () => {
    const base = threeSteps();
    const doc = splitAt(setClipIncluded(base, base.clips[0].id, false), 2);
    expect(doc.clips.map((clip) => !!clip.hidden)).toEqual([true, false, false, false]);
  });

  it("keeps captions of excluded steps when AI writes new ones", () => {
    const base = threeSteps();
    const hiddenId = base.clips[1].id;
    const doc = setClipIncluded(setStepText(base, hiddenId, "残す"), hiddenId, false);
    const next = applySteps(doc, [
      { id: newId(), clipId: base.clips[2].id, sourceStartSec: 7, sourceEndSec: 8, text: "新しい" },
    ]);
    const texts = stepSpans(next).map((step) => [step.included, step.caption?.text]);
    expect(texts).toEqual([
      [true, undefined],
      [false, "残す"],
      [true, undefined],
      [true, "新しい"],
    ]);
  });
});

describe("step bar layout", () => {
  // 3 秒ずつの 3 手順で、真ん中を動画に含めない。
  function withMiddleExcluded() {
    const doc = splitAt(splitAt(makeDoc(), 3), 6);
    return setClipIncluded(doc, doc.clips[1].id, false);
  }

  it("lays out every step, including excluded ones, by length", () => {
    const doc = withMiddleExcluded();
    expect(layoutDuration(doc)).toBe(10);
    expect(stepLayout(doc).map((step) => [step.layoutStartSec, step.layoutEndSec])).toEqual([
      [0, 3],
      [3, 6],
      [6, 10],
    ]);
  });

  it("places the playhead past the excluded step", () => {
    const doc = withMiddleExcluded();
    expect(layoutPosition(doc, 1)).toBe(1);
    expect(layoutPosition(doc, 4)).toBe(7);
    expect(layoutPosition(doc, totalDuration(doc))).toBe(10);
  });

  it("maps a point on an included step to the playhead there", () => {
    const doc = withMiddleExcluded();
    expect(pointAtLayout(doc, 8)).toEqual({
      clipId: doc.clips[2].id,
      included: true,
      timelineSec: 5,
    });
  });

  it("maps a point on an excluded step to where it would be inserted", () => {
    const doc = withMiddleExcluded();
    expect(pointAtLayout(doc, 4.5)).toEqual({
      clipId: doc.clips[1].id,
      included: false,
      timelineSec: 3,
    });
  });

  it("clamps points outside the bar", () => {
    const doc = withMiddleExcluded();
    expect(pointAtLayout(doc, -1).timelineSec).toBe(0);
    expect(pointAtLayout(doc, 99)).toMatchObject({ clipId: doc.clips[2].id, timelineSec: 7 });
  });
});

describe("zoomWindow", () => {
  it("centers on the given point", () => {
    expect(zoomWindow(120, 60, 30)).toEqual({ startSec: 45, endSec: 75 });
  });

  it("stays inside both ends", () => {
    expect(zoomWindow(120, 5, 30)).toEqual({ startSec: 0, endSec: 30 });
    expect(zoomWindow(120, 118, 30)).toEqual({ startSec: 90, endSec: 120 });
  });

  it("shows everything when it already fits", () => {
    expect(zoomWindow(20, 10, 30)).toEqual({ startSec: 0, endSec: 20 });
  });
});

describe("chapter screens", () => {
  // 3 秒ずつの 3 手順で、2 番目の前に 2 秒のカテゴリ画面を入れる。
  function withChapter() {
    const doc = splitAt(splitAt(makeDoc(), 3), 6);
    return setChapter(doc, doc.clips[1].id, { title: "保存", note: "", durationSec: 2 });
  }

  it("adds the chapter time before the step's video", () => {
    const doc = withChapter();
    expect(totalDuration(doc)).toBe(12);
    expect(clipSpans(doc).map((span) => [span.startSec, span.videoStartSec, span.endSec])).toEqual([
      [0, 0, 3],
      [3, 5, 8],
      [8, 8, 12],
    ]);
  });

  it("locates the chapter screen before the video", () => {
    const doc = withChapter();
    expect(locate(doc, 4)).toMatchObject({ step: 1, inChapter: true, sourceSec: 3 });
    expect(locate(doc, 6)).toMatchObject({ step: 1, inChapter: false, sourceSec: 4 });
  });

  it("keeps captions and zooms on the video, after the chapter", () => {
    const base = withChapter();
    const clipId = base.clips[1].id;
    const doc = setStepText(base, clipId, "保存します");
    expect(captionAt(doc, 4)).toBeUndefined();
    expect(captionAt(doc, 6)?.caption.text).toBe("保存します");
    expect(captionSpans(doc)[0]).toMatchObject({ startSec: 5, endSec: 8 });
  });

  it("leaves the chapter on the first half when the step is split", () => {
    const doc = splitAt(withChapter(), 6.5);
    expect(doc.clips.map((clip) => clip.chapter?.title ?? null)).toEqual([
      null,
      "保存",
      null,
      null,
    ]);
  });

  it("moves, hides and removes the chapter with its step", () => {
    const base = withChapter();
    const clipId = base.clips[1].id;
    expect(moveClip(base, clipId, 1).clips[2].chapter?.title).toBe("保存");
    expect(totalDuration(setClipIncluded(base, clipId, false))).toBe(7);
    expect(totalDuration(setChapter(base, clipId, null))).toBe(10);
    expect(setChapter(base, clipId, null).clips[1]).not.toHaveProperty("chapter");
  });

  it("lays out the chapter on the step bar", () => {
    const doc = withChapter();
    expect(layoutDuration(doc)).toBe(12);
    expect(stepLayout(doc)[1]).toMatchObject({ layoutStartSec: 3, layoutEndSec: 8, chapterSec: 2 });
    expect(layoutPosition(doc, 4)).toBe(4);
    expect(pointAtLayout(doc, 4)).toMatchObject({ clipId: doc.clips[1].id, timelineSec: 4 });
  });
});
