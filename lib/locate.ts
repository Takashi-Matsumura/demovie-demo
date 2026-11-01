import { z } from "zod";
import { VISION_URL, frameUrl } from "./captions";
import type { Command, ResolvedCommand } from "./commands";
import { seekTo, waitForEvent } from "./media";

const FIRST_READ_SEC = 0.01;
const COORDINATE_SCALE = 1000;

const replySchema = z.object({
  found: z.boolean(),
  x: z.number().min(0).max(COORDINATE_SCALE).optional(),
  y: z.number().min(0).max(COORDINATE_SCALE).optional(),
});

export function parseLocation(reply: string) {
  const json = reply.match(/\{[^}]*\}/)?.[0];
  if (!json) return null;
  try {
    const { found, x, y } = replySchema.parse(JSON.parse(json));
    if (!found || x === undefined || y === undefined) return null;
    return { focusX: x / COORDINATE_SCALE, focusY: y / COORDINATE_SCALE };
  } catch {
    return null;
  }
}

async function captureFrame(src: string, sourceSec: number) {
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  const loaded = waitForEvent(video, "loadeddata");
  video.src = src;
  try {
    await loaded;
    await seekTo(video, FIRST_READ_SEC);
    await seekTo(video, sourceSec);
    return frameUrl(video);
  } finally {
    video.removeAttribute("src");
    video.load();
  }
}

async function locateElement(frame: string, target: string, signal: AbortSignal) {
  let response: Response;
  try {
    response = await fetch(`${VISION_URL}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal,
      body: JSON.stringify({
        messages: [
          {
            role: "user",
            content: [
              { type: "image_url", image_url: { url: frame } },
              {
                type: "text",
                text: `画面の中で「${target}」の中心の位置を答えてください。画像の左上を(0,0)、右下を(${COORDINATE_SCALE},${COORDINATE_SCALE})とします。見つかれば {"found": true, "x": 数値, "y": 数値}、画面になければ {"found": false} のJSONだけを出力してください。`,
              },
            ],
          },
        ],
        max_tokens: 40,
        temperature: 0,
        presence_penalty: 0,
      }),
    });
  } catch (cause) {
    if (signal.aborted) throw cause;
    throw new Error(`画面の解析サーバ（${VISION_URL}）に接続できません。`);
  }
  if (!response.ok) throw new Error(`画面の解析サーバがエラーを返しました（${response.status}）。`);
  const data: { choices?: { message?: { content?: string } }[] } = await response.json();
  return parseLocation(data.choices?.[0]?.message?.content ?? "");
}

// 座標は言葉から推測させず、指示した時点の実際の画面から求める。
export async function resolveTargets(
  commands: Command[],
  src: string,
  sourceSec: number,
  signal: AbortSignal,
): Promise<ResolvedCommand[]> {
  if (!commands.some((command) => command.type === "zoom_to")) {
    return commands as ResolvedCommand[];
  }
  const frame = await captureFrame(src, sourceSec);
  const resolved: ResolvedCommand[] = [];
  for (const command of commands) {
    if (command.type !== "zoom_to") {
      resolved.push(command);
      continue;
    }
    const location = await locateElement(frame, command.target, signal);
    if (!location) throw new Error(`画面に「${command.target}」が見つかりませんでした。`);
    resolved.push({ type: "zoom_focus", target: command.target, ...location });
  }
  return resolved;
}
