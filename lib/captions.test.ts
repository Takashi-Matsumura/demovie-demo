import { describe, expect, it } from "vitest";
import {
  buildPrompt,
  changedRatio,
  changedRegion,
  cleanCaption,
  findOperations,
  sampleChanges,
  suggestZoom,
  type Sample,
} from "./captions";

function samples(ratios: number[]): Sample[] {
  return ratios.map((ratio, sec) => ({ sec, ratio }));
}

describe("findOperations", () => {
  it("ignores a still screen", () => {
    expect(findOperations(samples([0, 0, 0.0005, 0]))).toEqual([]);
  });

  it("merges a burst of changes and starts before it", () => {
    expect(findOperations(samples([0, 0, 0.1, 0.1, 0, 0, 0, 0]))).toEqual([
      { beforeSec: 1, afterSec: 3 },
    ]);
  });

  it("merges changes across a short pause and splits across a long one", () => {
    expect(findOperations(samples([0, 0.1, 0, 0.1]))).toEqual([{ beforeSec: 0, afterSec: 3 }]);
    expect(findOperations(samples([0, 0.1, 0, 0, 0, 0.1]))).toEqual([
      { beforeSec: 0, afterSec: 1 },
      { beforeSec: 4, afterSec: 5 },
    ]);
  });

  it("splits continuous change at the maximum length", () => {
    const operations = findOperations(samples(Array.from({ length: 15 }, () => 0.1)));
    expect(operations).toEqual([
      { beforeSec: 0, afterSec: 10 },
      { beforeSec: 10, afterSec: 14 },
    ]);
  });

  it("does not treat the first sample as a change", () => {
    expect(findOperations(samples([0.5, 0, 0]))).toEqual([]);
  });
});

describe("sampleChanges", () => {
  // 基準は 0.1% なので 20 マス。カーソルは実測と同じく、1 か所で基準の半分ほどにする。
  const SIZE = 20000;
  const cells = (start: number, length: number) =>
    Array.from({ length }, (_, index) => start + index);
  const frame = (changed: number[]) => {
    const pixels = new Uint8ClampedArray(SIZE);
    changed.forEach((index) => {
      pixels[index] = 255;
    });
    return pixels;
  };
  const run = (frames: Uint8ClampedArray[]) =>
    findOperations(sampleChanges(frames.map((signature, sec) => ({ sec, signature }))));

  it("adds up small changes such as slow typing", () => {
    const typed = [0, 10, 20, 20, 20].map((length) => frame(cells(0, length)));
    expect(run(typed)).toEqual([{ beforeSec: 1, afterSec: 2, referenceSec: 0 }]);
  });

  it("ignores a cursor that keeps moving", () => {
    const moving = [0, 100, 200, 300, 400, 500].map((start) => frame(cells(start, 10)));
    expect(run(moving)).toEqual([]);
  });

  it("detects a change that stays on screen", () => {
    const after = frame(cells(0, 30));
    expect(run([frame([]), after, after, after])).toEqual([
      { beforeSec: 0, afterSec: 1, referenceSec: 0 },
    ]);
  });

  it("does not trust a change it cannot confirm on the last sample", () => {
    expect(run([frame([]), frame([]), frame(cells(0, 30))])).toEqual([]);
  });

  it("handles a single frame", () => {
    expect(run([frame([])])).toEqual([]);
  });
});

describe("changedRatio", () => {
  it("counts only values past the threshold", () => {
    const base = new Uint8ClampedArray([10, 10, 10, 10]);
    expect(changedRatio(base, new Uint8ClampedArray([12, 10, 200, 10]))).toBe(0.25);
  });
});

describe("cleanCaption", () => {
  it("keeps the first line and removes quotes and labels", () => {
    expect(cleanCaption("  「ズームを設定」\n補足です")).toBe("ズームを設定");
    expect(cleanCaption("キャプション：設定を開く")).toBe("設定を開く");
    expect(cleanCaption("")).toBe("");
  });

  it("keeps quotes that belong to the sentence", () => {
    expect(cleanCaption("「保存」ボタンを押します。")).toBe("「保存」ボタンを押します。");
    expect(cleanCaption("「A」と「B」")).toBe("「A」と「B」");
  });
});

describe("buildPrompt", () => {
  it("adds the purpose only when it is given", () => {
    expect(buildPrompt("  経費精算の手順  ").startsWith("この動画の目的: 経費精算の手順\n")).toBe(true);
    expect(buildPrompt("  ")).not.toContain("この動画の目的");
  });

  it("adds the glossary only when it is given", () => {
    expect(buildPrompt("", "楽楽精算")).toContain("この表記で書く:\n楽楽精算");
    expect(buildPrompt("", "  ")).not.toContain("この表記で書く");
  });
});

describe("changedRegion", () => {
  const WIDTH = 10;
  const blank = () => new Uint8ClampedArray(100);
  function withCells(cells: [number, number][]) {
    const frame = blank();
    cells.forEach(([x, y]) => {
      frame[y * WIDTH + x] = 255;
    });
    return frame;
  }

  it("returns nothing when too little changed", () => {
    expect(changedRegion(blank(), blank(), WIDTH)).toBeNull();
  });

  it("measures the changed cells as ratios", () => {
    const cells: [number, number][] = [
      [2, 6],
      [3, 6],
      [2, 7],
      [3, 7],
    ];
    expect(changedRegion(blank(), withCells(cells), WIDTH)).toEqual({
      centerX: 0.3,
      centerY: 0.7,
      width: 0.2,
      height: 0.2,
    });
  });

  it("ignores a stray change far from the rest", () => {
    const cluster = [7, 8, 9].flatMap((y) =>
      [0, 1, 2, 3].map((x): [number, number] => [x, y]),
    );
    const stray: [number, number][] = [[9, 0]];
    const region = changedRegion(blank(), withCells([...cluster, ...stray]), WIDTH);
    expect(region?.width).toBeLessThanOrEqual(0.4);
    expect(region?.centerX).toBeLessThan(0.3);
  });
});

describe("suggestZoom", () => {
  const region = (size: number) => ({ centerX: 0.3, centerY: 0.7, width: size, height: size });

  it("does not zoom without a region or on a full screen change", () => {
    expect(suggestZoom(null)).toBeNull();
    expect(suggestZoom(region(0.9))).toBeNull();
  });

  it("frames the change within the depth limits", () => {
    expect(suggestZoom(region(0.4))).toEqual({ depth: 2, focusX: 0.3, focusY: 0.7 });
    expect(suggestZoom(region(0.05))?.depth).toBe(2.2);
    expect(suggestZoom(region(0.6))?.depth).toBe(1.3);
  });
});
