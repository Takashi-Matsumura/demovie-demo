import { afterEach, describe, expect, it, vi } from "vitest";
import { createDocument, documentSchema } from "./document";
import { listVoices, narratedSteps, narrationCredit, synthesize } from "./narration";
import { setStepText, splitAt } from "./timeline";

afterEach(() => vi.unstubAllGlobals());

function doc() {
  return createDocument({ name: "a", durationSec: 6, width: 1920, height: 1080 });
}

describe("narrationCredit", () => {
  it("names the voice only while narration is on", () => {
    expect(narrationCredit(doc())).toBeNull();
    const on = doc();
    const narration = { ...on.narration, enabled: true, voiceName: "青山龍星" };
    expect(narrationCredit({ ...on, narration })).toBe("VOICEVOX:青山龍星");
  });
});

describe("narratedSteps", () => {
  it("skips steps without text", () => {
    const base = splitAt(doc(), 3);
    const named = setStepText(base, base.clips[1].id, " 保存します ");
    expect(narratedSteps(named)).toEqual([{ clipId: base.clips[1].id, text: "保存します" }]);
  });
});

describe("listVoices", () => {
  it("lists every style of every speaker", async () => {
    vi.stubGlobal("fetch", async () =>
      Response.json([{ name: "青山龍星", styles: [{ id: 13, name: "ノーマル" }] }]),
    );
    expect(await listVoices()).toEqual([{ id: 13, name: "青山龍星", style: "ノーマル" }]);
  });
});

describe("synthesize", () => {
  it("applies the speed, keeps text out of the body, and caches", async () => {
    const calls: string[] = [];
    let body = "";
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      calls.push(url);
      if (url.includes("audio_query")) return Response.json({ speedScale: 1, kana: "ア" });
      body = String(init.body);
      return new Response(new Uint8Array([1, 2, 3]));
    });
    const first = await synthesize("保存します", 13, 1.2);
    await synthesize("保存します", 13, 1.2);
    expect(first.byteLength).toBe(3);
    expect(calls).toHaveLength(2);
    expect(JSON.parse(body).speedScale).toBe(1.2);
  });

  it("explains a stopped server", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("network");
    });
    await expect(synthesize("未起動の確認", 13, 1)).rejects.toThrow("読み上げサーバ");
  });
});

describe("saved work", () => {
  it("opens work saved before narration existed", () => {
    const saved: Record<string, unknown> = { ...doc() };
    delete saved.narration;
    expect(documentSchema.parse(saved).narration.enabled).toBe(false);
  });
});
