import { describe, expect, it } from "vitest";
import { applyCommands, commandListSchema, describeState, type Command } from "./commands";
import { createDocument, type DemoDocument } from "./document";
import { addZoom, setStepText, splitAt, stepSpans, totalDuration } from "./timeline";

function threeSteps(): DemoDocument {
  const doc = createDocument({ name: "a.webm", durationSec: 9, width: 1920, height: 1080 });
  return splitAt(splitAt(doc, 3), 6);
}

function applied(doc: DemoDocument, commands: Command[], timeSec = 0) {
  const result = applyCommands(doc, commands, timeSec);
  if (result.kind !== "applied") throw new Error(`not applied: ${JSON.stringify(result)}`);
  return result;
}

describe("applyCommands", () => {
  it("edits the text of a step", () => {
    const { doc } = applied(threeSteps(), [{ type: "set_step_text", step: 2, text: "保存します" }]);
    expect(stepSpans(doc)[1].caption?.text).toBe("保存します");
  });

  it("resolves step numbers as they were when the instruction was given", () => {
    const base = threeSteps();
    const named = setStepText(base, base.clips[2].id, "三番目");
    const { doc } = applied(named, [
      { type: "delete_step", step: 1 },
      { type: "set_step_text", step: 3, text: "更新" },
    ]);
    expect(stepSpans(doc).map((item) => item.caption?.text)).toEqual([undefined, "更新"]);
  });

  it("moves a step to the requested position", () => {
    const base = threeSteps();
    const lastId = base.clips[2].id;
    expect(applied(base, [{ type: "move_step", step: 3, to: 1 }]).doc.clips[0].id).toBe(lastId);
    const firstId = base.clips[0].id;
    expect(applied(base, [{ type: "move_step", step: 1, to: 9 }]).doc.clips[2].id).toBe(firstId);
  });

  it("uses the playhead for split and zoom", () => {
    expect(applied(threeSteps(), [{ type: "split_here" }], 1).doc.clips).toHaveLength(4);
    expect(applied(threeSteps(), [{ type: "add_zoom" }], 1).doc.zooms[0].sourceStartSec).toBe(1);
  });

  it("clamps the zoom depth", () => {
    const result = addZoom(threeSteps(), 1);
    if (!result) throw new Error("zoom was not added");
    const { doc } = applied(result.doc, [{ type: "set_zoom_depth", step: 1, depth: 99 }]);
    expect(doc.zooms[0].depth).toBe(4);
  });

  it("reports where to seek", () => {
    expect(applied(threeSteps(), [{ type: "seek_step", step: 3 }]).seekSec).toBe(6);
  });

  it("applies nothing when one command fails", () => {
    const doc = threeSteps();
    const result = applyCommands(
      doc,
      [
        { type: "delete_step", step: 1 },
        { type: "set_step_text", step: 9, text: "x" },
      ],
      0,
    );
    expect(result).toEqual({ kind: "failed", message: "手順 9 はありません。" });
    expect(totalDuration(doc)).toBe(9);
  });

  it("does not delete the last step or a missing zoom", () => {
    const single = createDocument({ name: "a", durationSec: 3, width: 10, height: 10 });
    expect(applyCommands(single, [{ type: "delete_step", step: 1 }], 0).kind).toBe("failed");
    expect(applyCommands(single, [{ type: "remove_zoom", step: 1 }], 0).kind).toBe("failed");
  });

  it("asks back instead of editing", () => {
    const result = applyCommands(
      threeSteps(),
      [
        { type: "delete_step", step: 1 },
        { type: "clarify", question: "どの手順ですか？" },
      ],
      0,
    );
    expect(result).toEqual({ kind: "question", question: "どの手順ですか？" });
  });

  it("treats undo as its own instruction", () => {
    expect(applyCommands(threeSteps(), [{ type: "undo" }], 0)).toEqual({ kind: "undo" });
    const mixed = applyCommands(
      threeSteps(),
      [{ type: "undo" }, { type: "delete_step", step: 1 }],
      0,
    );
    expect(mixed.kind).toBe("failed");
  });

  it("fails on an empty list", () => {
    expect(applyCommands(threeSteps(), [], 0).kind).toBe("failed");
  });
});

describe("describeState", () => {
  it("tells the step under the playhead", () => {
    const doc = threeSteps();
    expect(describeState(doc, 4).playheadStep).toBe(2);
    expect(describeState(doc, 4).steps[2]).toMatchObject({ step: 3, seconds: 3, zoomDepth: null });
  });
});

describe("commandListSchema", () => {
  it("rejects operations outside the list", () => {
    const parsed = commandListSchema.safeParse({ commands: [{ type: "drop_table" }] });
    expect(parsed.success).toBe(false);
  });
});
