import { afterEach, describe, expect, it, vi } from "vitest";
import { acceptTidied, tidyNarration } from "./assistant";

const signal = new AbortController().signal;

afterEach(() => vi.unstubAllGlobals());

describe("acceptTidied", () => {
  it("uses the tidied text", () => {
    expect(acceptTidied("えーと保存します", " 保存します。\n")).toBe("保存します。");
  });

  it("keeps the spoken text when the reply is empty or padded with new information", () => {
    expect(acceptTidied("保存します", "  ")).toBe("保存します");
    expect(acceptTidied("保存します", "あ".repeat(40))).toBe("保存します");
  });
});

describe("tidyNarration", () => {
  it("falls back to the spoken text when the server fails", async () => {
    vi.stubGlobal("fetch", async () => new Response("", { status: 500 }));
    expect(await tidyNarration("保存します", "", signal)).toBe("保存します");
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("network");
    });
    expect(await tidyNarration("保存します", "", signal)).toBe("保存します");
  });

  it("passes the glossary to the model only when there is one", async () => {
    const requests: string[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      requests.push(String(init.body));
      return Response.json({ choices: [{ message: { content: "保存します" } }] });
    });
    await tidyNarration("保存します", "Demovie=デモービー", signal);
    await tidyNarration("保存します", "", signal);
    expect(requests[0]).toContain("Demovie（読み: デモービー）");
    expect(requests[1]).not.toContain("用語:");
  });

  it("does not swallow a cancelled request", async () => {
    const controller = new AbortController();
    controller.abort();
    vi.stubGlobal("fetch", async () => {
      throw new DOMException("aborted", "AbortError");
    });
    await expect(tidyNarration("保存します", "", controller.signal)).rejects.toThrow();
  });
});
