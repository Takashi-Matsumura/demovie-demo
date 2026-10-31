import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "../app/api/intent/route";
import { classifyIntent, isChatter } from "./intent";

function request(body: unknown, origin: string | null = "http://localhost:3001") {
  const headers: Record<string, string> = { host: "localhost:3001" };
  if (origin) headers.origin = origin;
  return new Request("http://localhost:3001/api/intent", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

function jevReply(chatter: number) {
  return Response.json({
    answers: {
      intent: { probabilities: { chatter, instruction: 1 - chatter } },
    },
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("isChatter", () => {
  it("stops only clear chatter", () => {
    expect(isChatter(0.69)).toBe(false);
    expect(isChatter(0.7)).toBe(true);
  });
});

describe("POST /api/intent", () => {
  it("rejects other origins and requests without an origin", async () => {
    vi.stubEnv("TYPESAFE_API_KEY", "test");
    expect((await POST(request({ text: "a" }, "https://evil.example"))).status).toBe(403);
    expect((await POST(request({ text: "a" }, null))).status).toBe(403);
  });

  it("reports a missing key", async () => {
    vi.stubEnv("TYPESAFE_API_KEY", "");
    expect((await POST(request({ text: "a" }))).status).toBe(503);
  });

  it("rejects empty and oversized text without calling Jev", async () => {
    vi.stubEnv("TYPESAFE_API_KEY", "test");
    const upstream = vi.fn();
    vi.stubGlobal("fetch", upstream);
    expect((await POST(request({ text: "" }))).status).toBe(400);
    expect((await POST(request({ text: "あ".repeat(501) }))).status).toBe(400);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("sends the key only to Jev and returns only the probability", async () => {
    vi.stubEnv("TYPESAFE_API_KEY", "secret");
    const upstream = vi.fn(async () => jevReply(0.9));
    vi.stubGlobal("fetch", upstream);
    const response = await POST(request({ text: "お昼どうしよう" }));
    const [url, init] = upstream.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.typesafe.ai/v1/systemone");
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer secret");
    expect(await response.json()).toEqual({ chatter: 0.9 });
  });

  it("does not trust a failed or malformed reply", async () => {
    vi.stubEnv("TYPESAFE_API_KEY", "test");
    vi.stubGlobal("fetch", async () => new Response("no", { status: 429 }));
    expect((await POST(request({ text: "a" }))).status).toBe(502);
    vi.stubGlobal("fetch", async () => Response.json({ answers: {} }));
    expect((await POST(request({ text: "a" }))).status).toBe(502);
  });
});

describe("classifyIntent", () => {
  const signal = new AbortController().signal;

  it("treats chatter as chatter and failures as instructions", async () => {
    vi.stubGlobal("fetch", async () => Response.json({ chatter: 0.95 }));
    expect(await classifyIntent("a", signal)).toBe("chatter");
    vi.stubGlobal("fetch", async () => new Response("", { status: 503 }));
    expect(await classifyIntent("a", signal)).toBe("instruction");
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("network");
    });
    expect(await classifyIntent("a", signal)).toBe("instruction");
  });
});
