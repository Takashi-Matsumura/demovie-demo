import { describe, expect, it } from "vitest";
import { createDocument, LEGACY_ASSET_ID, type Asset } from "./document";
import { buildManifest, parseManifest, videoFileName } from "./folder";

const first: Asset = { id: "a", name: "交通費の申請.mp4", durationSec: 10, width: 1600, height: 900 };
const second: Asset = { id: "b", name: "録画", durationSec: 6, width: 1280, height: 720 };

describe("videoFileName", () => {
  it("numbers videos in order and keeps their names", () => {
    expect(videoFileName(0, first)).toBe("01_交通費の申請.mp4");
    expect(videoFileName(9, first)).toBe("10_交通費の申請.mp4");
  });

  it("adds an extension from the video type when the name has none", () => {
    expect(videoFileName(1, second, "video/webm;codecs=vp9")).toBe("02_録画.webm");
    expect(videoFileName(1, second, "video/mp4")).toBe("02_録画.mp4");
  });

  it("replaces characters that cannot be used in file names", () => {
    expect(videoFileName(0, { ...first, name: 'a/b:c*?"<>|.mp4' })).toBe("01_a_b_c______.mp4");
  });
});

describe("project manifest", () => {
  const doc = createDocument([first, second]);

  it("round-trips a project with several videos", () => {
    const manifest = buildManifest("p1", doc, { b: "video/webm" }, 123);
    expect(manifest.videos).toEqual({ a: "videos/01_交通費の申請.mp4", b: "videos/02_録画.webm" });
    const parsed = parseManifest(JSON.parse(JSON.stringify(manifest)));
    expect(parsed.projectId).toBe("p1");
    expect(parsed.savedAt).toBe(123);
    expect(parsed.doc).toEqual(doc);
  });

  it("opens a project folder whose document was saved before several videos", () => {
    const legacy = {
      schemaVersion: 1,
      asset: { name: "old.webm", durationSec: 8, width: 1280, height: 720 },
      purpose: "",
      clips: [{ id: "c1", sourceStartSec: 0, sourceEndSec: 8 }],
      zooms: [],
      captions: [],
      look: { background: "dusk", paddingPct: 6, radiusPct: 2, shadow: true },
    };
    const parsed = parseManifest({
      format: "demovie-project",
      version: 1,
      projectId: "p1",
      savedAt: 1,
      videos: { [LEGACY_ASSET_ID]: "videos/01_old.webm" },
      doc: legacy,
    });
    expect(parsed.doc.assets[0].id).toBe(LEGACY_ASSET_ID);
  });

  it("rejects a folder that is not a Demovie project", () => {
    expect(() => parseManifest({ hello: "world" })).toThrow("Demovie のプロジェクトフォルダではありません。");
  });

  it("rejects video paths outside the folder or missing ones", () => {
    const manifest = buildManifest("p1", doc);
    const outside = { ...manifest, videos: { ...manifest.videos, a: "../secret.mp4" } };
    expect(() => parseManifest(outside)).toThrow("交通費の申請.mp4");
    const absolute = { ...manifest, videos: { ...manifest.videos, a: "/etc/passwd" } };
    expect(() => parseManifest(absolute)).toThrow("交通費の申請.mp4");
    const missing = { ...manifest, videos: { a: manifest.videos.a } };
    expect(() => parseManifest(missing)).toThrow("録画");
  });
});
