import { describe, expect, it } from "vitest";
import { encodeWav } from "./speech";

describe("encodeWav", () => {
  it("writes a 16-bit mono PCM file and clamps the samples", async () => {
    const wav = encodeWav(new Float32Array([0, 2, -2]), 16_000);
    const view = new DataView(await wav.arrayBuffer());
    const text = (offset: number) =>
      String.fromCharCode(...Array.from({ length: 4 }, (_, i) => view.getUint8(offset + i)));

    expect(wav.size).toBe(50);
    expect(text(0)).toBe("RIFF");
    expect(text(8)).toBe("WAVE");
    expect(text(36)).toBe("data");
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(16_000);
    expect(view.getInt16(44, true)).toBe(0);
    expect(view.getInt16(46, true)).toBe(0x7fff);
    expect(view.getInt16(48, true)).toBe(-0x7fff);
  });
});
