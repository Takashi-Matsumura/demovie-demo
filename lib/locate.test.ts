import { describe, expect, it } from "vitest";
import { parseLocation } from "./locate";

describe("parseLocation", () => {
  it("reads a location from the reply", () => {
    expect(parseLocation('{"found": true, "x": 250, "y": 750}')).toEqual({
      focusX: 0.25,
      focusY: 0.75,
    });
    expect(parseLocation('座標です。\n```json\n{"found": true, "x": 0, "y": 1000}\n```')).toEqual({
      focusX: 0,
      focusY: 1,
    });
  });

  it("does not guess when the element is missing or the reply is broken", () => {
    expect(parseLocation('{"found": false}')).toBeNull();
    expect(parseLocation('{"found": true}')).toBeNull();
    expect(parseLocation('{"found": true, "x": 2000, "y": 10}')).toBeNull();
    expect(parseLocation("見つかりません")).toBeNull();
  });
});
