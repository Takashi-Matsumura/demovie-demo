import { describe, expect, it } from "vitest";
import { createDocument, type DemoDocument } from "./document";
import { defaultExportAudio } from "./export";

function withNarration(patch: Partial<DemoDocument["narration"]>): DemoDocument {
  const doc = createDocument({ name: "a.webm", durationSec: 10, width: 1920, height: 1080 });
  return { ...doc, narration: { ...doc.narration, ...patch } };
}

describe("defaultExportAudio", () => {
  it("keeps the recorded sound when narration is off", () => {
    expect(defaultExportAudio(withNarration({ enabled: false }))).toEqual({
      narration: false,
      original: true,
    });
  });

  it("replaces the recorded sound with narration unless asked to keep it", () => {
    expect(defaultExportAudio(withNarration({ enabled: true, keepOriginalAudio: false }))).toEqual({
      narration: true,
      original: false,
    });
    expect(defaultExportAudio(withNarration({ enabled: true, keepOriginalAudio: true }))).toEqual({
      narration: true,
      original: true,
    });
  });
});
