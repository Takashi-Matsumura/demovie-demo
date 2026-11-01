import { afterEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "../app/api/intent/route";
import { classifyIntent, isChatter } from "./intent";

function request(
  body: unknown,
  origin: string | null = "http://localhost:3001",
  host = "localhost:3001",
) {
  const headers: Record<string, string> = { host, "content-type": "application/json" };
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

  it("rejects a DNS rebinding request where the origin matches the host", async () => {
    vi.stubEnv("TYPESAFE_API_KEY", "test");
    const rebound = request({ text: "a" }, "http://evil.example:3001", "evil.example:3001");
    expect((await POST(rebound)).status).toBe(403);
  });

  it("rejects a forged local origin that arrives through a public host", async () => {
    vi.stubEnv("TYPESAFE_API_KEY", "test");
    const forged = request({ text: "a" }, "http://localhost:3001", "demovie.example");
    expect((await POST(forged)).status).toBe(403);
  });

  it("rejects another site on a different local port", async () => {
    vi.stubEnv("TYPESAFE_API_KEY", "test");
    expect((await POST(request({ text: "a" }, "http://localhost:3000"))).status).toBe(403);
  });

  it("rejects bodies that are not JSON", async () => {
    vi.stubEnv("TYPESAFE_API_KEY", "test");
    const plain = new Request("http://localhost:3001/api/intent", {
      method: "POST",
      headers: {
        host: "localhost:3001",
        origin: "http://localhost:3001",
        "content-type": "text/plain",
      },
      body: JSON.stringify({ text: "a" }),
    });
    expect((await POST(plain)).status).toBe(415);
  });

  it("stops trusting localhost once APP_ORIGIN is set", async () => {
    vi.stubEnv("TYPESAFE_API_KEY", "test");
    vi.stubEnv("APP_ORIGIN", "https://demovie.example");
    expect((await POST(request({ text: "a" }))).status).toBe(403);
  });

  it("allows a deployment only through APP_ORIGIN", async () => {
    vi.stubEnv("TYPESAFE_API_KEY", "test");
    vi.stubEnv("APP_ORIGIN", "https://demovie.example");
    vi.stubGlobal("fetch", async () => jevReply(0.1));
    const allowed = request({ text: "a" }, "https://demovie.example", "demovie.example");
    expect((await POST(allowed)).status).toBe(200);
    const other = request({ text: "a" }, "https://other.example", "other.example");
    expect((await POST(other)).status).toBe(403);
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

describe("GET /api/intent", () => {
  const read = (host: string) => new Request("http://localhost/api/intent", { headers: { host } });

  it("tells whether a key is set without revealing it", async () => {
    vi.stubEnv("TYPESAFE_API_KEY", "secret");
    const body = await GET(read("localhost:3001")).text();
    expect(JSON.parse(body)).toEqual({ configured: true });
    expect(body).not.toContain("secret");
    vi.stubEnv("TYPESAFE_API_KEY", "");
    expect(await GET(read("localhost:3001")).json()).toEqual({ configured: false });
  });

  it("does not answer other hosts", () => {
    expect(GET(read("evil.example")).status).toBe(403);
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
