import { describe, expect, it } from "vitest";
import { createDocument, type DemoDocument } from "./document";
import { applyReview, timelineAt } from "./review";
import { addZoom, setStepText, splitAt, stepSpans, totalDuration } from "./timeline";

function threeSteps(): DemoDocument {
  const doc = createDocument({ name: "a.webm", durationSec: 9, width: 1920, height: 1080 });
  return splitAt(splitAt(doc, 3), 6);
}

describe("timelineAt", () => {
  it("follows a clip that moved and reports a removed one", () => {
    const base = threeSteps();
    const trimmed = { ...base, clips: base.clips.slice(1) };
    expect(timelineAt(trimmed, 4)).toBe(1);
    expect(timelineAt(trimmed, 1)).toBeNull();
  });
});

describe("applyReview", () => {
  it("keeps step numbers fixed across instructions", () => {
    const base = threeSteps();
    const { doc, done, failed } = applyReview(base, [
      { commands: [{ type: "delete_step", step: 1 }], sourceSec: 0 },
      { commands: [{ type: "set_step_text", step: 3, text: "最後" }], sourceSec: 7 },
    ]);
    expect(failed).toEqual([]);
    expect(done).toHaveLength(2);
    expect(stepSpans(doc).map((step) => step.caption?.text)).toEqual([undefined, "最後"]);
  });

  it("uses the spoken position after earlier steps are gone", () => {
    const { doc } = applyReview(threeSteps(), [
      { commands: [{ type: "delete_step", step: 1 }], sourceSec: 0 },
      { commands: [{ type: "split_here" }], sourceSec: 4.5 },
    ]);
    expect(doc.clips.map((clip) => [clip.sourceStartSec, clip.sourceEndSec])).toEqual([
      [3, 4.5],
      [4.5, 6],
      [6, 9],
    ]);
  });

  it("reports a failure and still applies the rest", () => {
    const base = threeSteps();
    const { doc, done, failed } = applyReview(base, [
      { commands: [{ type: "delete_step", step: 1 }], sourceSec: 7 },
      { commands: [{ type: "split_here" }], sourceSec: 1 },
      { commands: [{ type: "delete_step", step: 1 }], sourceSec: 7 },
      { commands: [{ type: "delete_step", step: 2 }], sourceSec: 7 },
    ]);
    expect(done).toHaveLength(2);
    expect(failed).toEqual(["指示した位置の手順がなくなっています。", "手順 1 はすでにありません。"]);
    expect(totalDuration(doc)).toBe(3);
  });

  it("carries zoom and text edits on the original clips", () => {
    const base = threeSteps();
    const zoomed = addZoom(base, 4);
    if (!zoomed) throw new Error("zoom was not added");
    const named = setStepText(zoomed.doc, base.clips[1].id, "元の文");
    const { doc } = applyReview(named, [
      { commands: [{ type: "set_zoom_depth", step: 2, depth: 3 }], sourceSec: 4 },
    ]);
    expect(doc.zooms[0].depth).toBe(3);
  });

  it("does not run undo in a batch", () => {
    const { failed } = applyReview(threeSteps(), [{ commands: [{ type: "undo" }], sourceSec: 0 }]);
    expect(failed).toHaveLength(1);
  });
});
