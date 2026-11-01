import { z } from "zod";

const JEV_URL = "https://api.typesafe.ai/v1/systemone";
// しきい値は特定のバージョンに合わせて調整するので、別名ではなくバージョンを固定する。
const JEV_MODEL = "jev-1.14.0";
const TIMEOUT_MS = 3000;

const requestSchema = z.object({ text: z.string().min(1).max(500) });

const responseSchema = z.object({
  answers: z.object({
    intent: z.object({ probabilities: z.object({ chatter: z.number() }) }),
  }),
});

const LOCAL_HOSTNAMES = ["localhost", "127.0.0.1", "[::1]"];

// API キーを持つのはサーバ側だけ。Origin と Host の一致で別のポートのサイトを、
// 許可先との照合で DNS リバインディングを防ぐ。両方そろわないと通さない。
function isTrustedHost(url: URL) {
  const appOrigin = process.env.APP_ORIGIN;
  return appOrigin ? url.origin === appOrigin : LOCAL_HOSTNAMES.includes(url.hostname);
}

function isTrusted(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin || !URL.canParse(origin)) return false;
  const url = new URL(origin);
  return url.host === request.headers.get("host") && isTrustedHost(url);
}

// 同一オリジンの GET には Origin が付かないので、Host だけで確かめる。
function isTrustedRead(request: Request) {
  const host = request.headers.get("host");
  if (!host || !URL.canParse(`http://${host}`)) return false;
  const url = new URL(`http://${host}`);
  return process.env.APP_ORIGIN
    ? url.host === new URL(process.env.APP_ORIGIN).host
    : isTrustedHost(url);
}

// キーの値は返さず、設定の有無だけを返す。
export function GET(request: Request) {
  if (!isTrustedRead(request)) return Response.json({ error: "forbidden" }, { status: 403 });
  return Response.json({ configured: Boolean(process.env.TYPESAFE_API_KEY) });
}

export async function POST(request: Request) {
  if (!isTrusted(request)) return Response.json({ error: "forbidden" }, { status: 403 });
  // JSON に限ると、他のサイトからの送信にはブラウザの事前確認が必要になる。
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    return Response.json({ error: "unsupported_media_type" }, { status: 415 });
  }

  const apiKey = process.env.TYPESAFE_API_KEY;
  if (!apiKey) return Response.json({ error: "not_configured" }, { status: 503 });

  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid_request" }, { status: 400 });

  const upstream = await fetch(JEV_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    body: JSON.stringify({
      model: JEV_MODEL,
      state: parsed.data.text,
      questions: {
        intent: {
          type: "choice",
          instructions:
            "The state is a Japanese transcript of what a user said while editing a screen-recorded tutorial video. Decide whether the user is giving the editor an instruction.",
          criteria: {
            instruction:
              "A request to the editor to change the video, its steps, captions, zoom, background or playback, or to undo. Examples: ここの説明を短くして, 3番目の手順を消して, 元に戻して",
            chatter:
              "Thinking aloud, talking to someone else, small talk, or filler that asks nothing of the editor. Examples: えーと何だっけ, 今日のお昼どうしよう, ちょっと待ってください",
          },
        },
      },
    }),
  }).catch(() => null);

  if (!upstream?.ok) return Response.json({ error: "upstream_failed" }, { status: 502 });
  const answer = responseSchema.safeParse(await upstream.json().catch(() => null));
  if (!answer.success) return Response.json({ error: "upstream_failed" }, { status: 502 });

  return Response.json({ chatter: answer.data.answers.intent.probabilities.chatter });
}
