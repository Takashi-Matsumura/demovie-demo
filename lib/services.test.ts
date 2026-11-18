import { afterEach, describe, expect, it, vi } from "vitest";
import {
  canReadImages,
  checkServices,
  isDown,
  SERVICES,
  type ServiceState,
} from "./services";

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
  "/version": "0.25.2",
};

const states = async () =>
  Object.fromEntries(
    (await checkServices()).map(({ id, state }) => [id, state]),
  );

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
    expect(await states()).toEqual({
      vision: "ok",
      llm: "ok",
      whisper: "ok",
      intent: "ok",
      voice: "ok",
    });
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

  it("does not warn when the optional voice server is stopped", async () => {
    stub({ ...up, "/version": null });
    expect((await states()).voice).toBe("off");
  });

  it("treats a missing Jev key as off, not as a failure", async () => {
    stub({ ...up, "/api/intent": { configured: false } });
    expect((await states()).intent).toBe("off");
  });
});

describe("isDown", () => {
  const withWhisper = (state: ServiceState) =>
    SERVICES.map((service) => ({
      ...service,
      state: service.id === "whisper" ? state : "ok",
    }));

  it("is true only when the service is known to be down", () => {
    expect(isDown(withWhisper("down"), "whisper")).toBe(true);
    expect(isDown(withWhisper("ok"), "whisper")).toBe(false);
    expect(isDown(withWhisper("down"), "llm")).toBe(false);
  });

  it("treats a service as usable until the first check finishes", () => {
    expect(isDown([], "whisper")).toBe(false);
  });
});
