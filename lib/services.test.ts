import { afterEach, describe, expect, it, vi } from "vitest";
import { canReadImages, checkServices } from "./services";

afterEach(() => vi.unstubAllGlobals());

function stub(routes: Record<string, unknown>) {
  vi.stubGlobal("fetch", async (url: string) => {
    const key = Object.keys(routes).find((item) => url.includes(item));
    if (!key || routes[key] === null) throw new TypeError("network");
    return Response.json(routes[key]);
  });
}

const up = {
  "/props": { modalities: { vision: true } },
  ":8080/health": { status: "ok" },
  ":8090/health": { status: "ok" },
  "/api/intent": { configured: true },
};

const states = async () =>
  Object.fromEntries((await checkServices()).map(({ id, state }) => [id, state]));

describe("canReadImages", () => {
  it("needs a server with vision", () => {
    expect(canReadImages({ modalities: { vision: true } })).toBe(true);
    expect(canReadImages({ modalities: { vision: false } })).toBe(false);
    expect(canReadImages(null)).toBe(false);
  });
});

describe("checkServices", () => {
  it("reports every service as ready", async () => {
    stub(up);
    expect(await states()).toEqual({ vision: "ok", llm: "ok", whisper: "ok", intent: "ok" });
  });

  it("reports only the one that stopped", async () => {
    stub({ ...up, ":8090/health": null });
    expect((await states()).whisper).toBe("down");
    expect((await states()).llm).toBe("ok");
  });

  it("treats a text-only model as down for screen analysis", async () => {
    stub({ ...up, "/props": { modalities: { vision: false } } });
    expect((await states()).vision).toBe("down");
  });

  it("treats a missing Jev key as off, not as a failure", async () => {
    stub({ ...up, "/api/intent": { configured: false } });
    expect((await states()).intent).toBe("off");
  });
});
