import { describe, expect, it } from "vitest";
import { layoutActivity, timelineActivity } from "./activity";
import { createDocument } from "./document";
import { setClipIncluded, splitAt } from "./timeline";

// 0〜4 秒、4〜10 秒の 2 手順に分けた文書。
function twoSteps() {
  const doc = createDocument([{ id: "a", name: "a.webm", durationSec: 10, width: 1920, height: 1080 }]);
  return splitAt(doc, 4);
}

describe("activity", () => {
  it("returns nothing while idle", () => {
    expect(layoutActivity(twoSteps(), null)).toEqual({ marks: [], focusSec: null });
  });

  it("fills scanned steps and the scanned part of the current step", () => {
    const doc = twoSteps();
    const [first, second] = doc.clips;
    const view = layoutActivity(doc, {
      phase: "scan",
      clipId: second.id,
      sourceSec: 6,
      scannedClipIds: [first.id],
    });
    expect(view.marks).toEqual([
      { key: first.id, state: "scanned", startSec: 0, endSec: 4 },
      { key: second.id, state: "scanning", startSec: 4, endSec: 6 },
    ]);
    expect(view.focusSec).toBe(6);
  });

  it("marks caption targets by how far generation has gone", () => {
    const doc = twoSteps();
    const [first, second] = doc.clips;
    const targets = [
      { clipId: first.id, sourceStartSec: 1, sourceEndSec: 2 },
      { clipId: first.id, sourceStartSec: 2, sourceEndSec: 3 },
      { clipId: second.id, sourceStartSec: 5, sourceEndSec: 7 },
      { clipId: second.id, sourceStartSec: 8, sourceEndSec: 9 },
    ];
    const view = layoutActivity(doc, { phase: "caption", targets, results: ["開く", null] });
    expect(view.marks.map(({ state, text }) => [state, text])).toEqual([
      ["done", "開く"],
      ["skipped", undefined],
      ["current", undefined],
      ["pending", undefined],
    ]);
    expect(view.focusSec).toBe(5);
  });

  it("keeps excluded steps on the bar but off the timeline", () => {
    const doc = twoSteps();
    const [first, second] = doc.clips;
    const hidden = setClipIncluded(doc, first.id, false);
    const targets = [{ clipId: second.id, sourceStartSec: 5, sourceEndSec: 7 }];
    const activity = { phase: "caption" as const, targets, results: [] };
    expect(layoutActivity(hidden, activity).marks[0]).toMatchObject({ startSec: 5, endSec: 7 });
    expect(timelineActivity(hidden, activity).marks[0]).toMatchObject({ startSec: 1, endSec: 3 });
  });

  it("drops targets whose step was removed", () => {
    const targets = [{ clipId: "gone", sourceStartSec: 1, sourceEndSec: 2 }];
    expect(layoutActivity(twoSteps(), { phase: "caption", targets, results: [] }).marks).toEqual(
      [],
    );
  });
});
