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

// API キーを持つのはサーバ側だけ。他のサイトから課金 API を踏み台にされないよう同一オリジンに限る。
function isSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  return URL.canParse(origin) && new URL(origin).host === request.headers.get("host");
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return Response.json({ error: "forbidden" }, { status: 403 });

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
