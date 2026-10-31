import { describe, expect, it } from "vitest";
import { changedRatio, cleanCaption, findOperations, type Sample } from "./captions";

function samples(ratios: number[]): Sample[] {
  return ratios.map((ratio, sec) => ({ sec, ratio }));
}

describe("findOperations", () => {
  it("ignores a still screen", () => {
    expect(findOperations(samples([0, 0, 0.001, 0]))).toEqual([]);
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
});
