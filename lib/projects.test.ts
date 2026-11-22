import { describe, expect, it } from "vitest";
import { createDocument } from "./document";
import { summaryOf } from "./projects";

describe("summaryOf", () => {
  it("lists a project saved before several videos", () => {
    const saved = {
      schemaVersion: 1,
      asset: { name: "old.webm", durationSec: 8, width: 1280, height: 720 },
      purpose: "",
      clips: [
        { id: "c1", sourceStartSec: 0, sourceEndSec: 5, chapter: { title: "", note: "", durationSec: 3 } },
        { id: "c2", sourceStartSec: 5, sourceEndSec: 8, hidden: true },
      ],
      zooms: [],
      captions: [],
      look: { background: "dusk", paddingPct: 6, radiusPct: 2, shadow: true },
    };
    expect(summaryOf({ id: "p", updatedAt: 1, doc: saved })).toEqual({
      id: "p",
      updatedAt: 1,
      name: "old.webm",
      durationSec: 8,
      stepCount: 2,
    });
  });

  it("names a project with several videos after the first one", () => {
    const doc = createDocument([
      { id: "a", name: "a.webm", durationSec: 4, width: 10, height: 10 },
      { id: "b", name: "b.webm", durationSec: 6, width: 10, height: 10 },
    ]);
    expect(summaryOf({ id: "p", updatedAt: 1, doc })).toMatchObject({
      name: "a.webm ほか 1 本",
      durationSec: 10,
    });
  });

  it("keeps an unreadable project in the list so it can be deleted", () => {
    expect(summaryOf({ id: "p", updatedAt: 1, doc: { schemaVersion: 99 } })).toMatchObject({
      name: "（読み込めない作業）",
      stepCount: 0,
    });
  });
});
