import { describe, expect, it } from "vitest";
import {
  addAssets,
  createDocument,
  documentSchema,
  LEGACY_ASSET_ID,
  type Asset,
} from "./document";
import { timelineAt } from "./review";
import {
  addBlur,
  blursAt,
  clipEdgeLimits,
  clipSpans,
  mergeBlocker,
  moveClip,
  moveClipEdge,
  totalDuration,
} from "./timeline";

const first: Asset = { id: "a", name: "a.webm", durationSec: 10, width: 1920, height: 1080 };
const second: Asset = { id: "b", name: "b.webm", durationSec: 6, width: 1280, height: 720 };

function twoVideos() {
  return createDocument([first, second]);
}

describe("several videos", () => {
  it("starts with one step per video, in the given order", () => {
    const doc = twoVideos();
    expect(doc.clips.map((clip) => [clip.assetId, clip.sourceEndSec])).toEqual([
      ["a", 10],
      ["b", 6],
    ]);
    expect(totalDuration(doc)).toBe(16);
    expect(documentSchema.safeParse(doc).success).toBe(true);
  });

  it("adds a video as a new step at the end", () => {
    const doc = addAssets(createDocument([first]), [second]);
    expect(doc.assets.map((asset) => asset.id)).toEqual(["a", "b"]);
    expect(clipSpans(doc).map((span) => [span.clip.assetId, span.startSec])).toEqual([
      ["a", 0],
      ["b", 10],
    ]);
  });

  it("rejects steps that point to a missing video", () => {
    const doc = twoVideos();
    const broken = { ...doc, clips: [{ ...doc.clips[0], assetId: "missing" }] };
    expect(documentSchema.safeParse(broken).success).toBe(false);
  });

  it("does not merge steps from different videos even when the times line up", () => {
    const base = createDocument([first, { ...second, durationSec: 10 }]);
    // b の手順を 10 秒から始まるように見せても、別の動画なのでつながっていない。
    const doc = { ...base, clips: [base.clips[0], { ...base.clips[1], sourceStartSec: 10 - 1e-4 }] };
    expect(mergeBlocker(doc, doc.clips[0].id)).toBe("別の動画の手順とは結合できません。");
  });

  it("limits a step's edges by its own video", () => {
    const doc = twoVideos();
    const [a, b] = doc.clips;
    const trimmed = moveClipEdge(doc, b.id, "end", 4);
    expect(clipEdgeLimits(trimmed, b.id, "end")?.maxSec).toBe(6);
    // 別の動画の手順は重なりの判定に入らないので、a は自分の動画の終わりまで伸ばせる。
    const shortened = moveClipEdge(doc, a.id, "end", 3);
    expect(clipEdgeLimits(shortened, a.id, "end")?.maxSec).toBe(10);
  });

  it("keeps blurs on their own video", () => {
    const doc = addBlur(twoVideos(), "b", { x: 0, y: 0, width: 0.5, height: 0.5 });
    expect(doc.blurs[0].sourceEndSec).toBe(6);
    expect(blursAt(doc, "b", 3)).toHaveLength(1);
    expect(blursAt(doc, "a", 3)).toEqual([]);
  });

  it("finds a spoken position by video, even after reordering", () => {
    const doc = twoVideos();
    const swapped = moveClip(doc, doc.clips[1].id, -1);
    expect(timelineAt(swapped, "b", 2)).toBe(2);
    expect(timelineAt(swapped, "a", 2)).toBe(8);
  });
});

describe("saved before several videos", () => {
  it("opens a version 1 document as a single video", () => {
    const saved = {
      schemaVersion: 1,
      asset: { name: "old.webm", durationSec: 8, width: 1280, height: 720 },
      purpose: "",
      clips: [{ id: "c1", sourceStartSec: 0, sourceEndSec: 8 }],
      zooms: [],
      captions: [],
      blurs: [{ id: "b1", sourceStartSec: 0, sourceEndSec: 8, x: 0, y: 0, width: 0.1, height: 0.1 }],
      look: { background: "dusk", paddingPct: 6, radiusPct: 2, shadow: true },
    };
    const doc = documentSchema.parse(saved);
    expect(doc.schemaVersion).toBe(2);
    expect(doc.assets).toEqual([{ id: LEGACY_ASSET_ID, ...saved.asset }]);
    expect(doc.clips[0].assetId).toBe(LEGACY_ASSET_ID);
    expect(doc.blurs[0].assetId).toBe(LEGACY_ASSET_ID);
  });
});
