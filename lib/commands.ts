import { z } from "zod";
import { BACKGROUND_IDS, documentSchema, type DemoDocument } from "./document";
import {
  addZoom,
  clipSpans,
  deleteClip,
  locate,
  moveClip,
  removeZoom,
  setStepText,
  splitAt,
  stepSpans,
  updateZoom,
  zoomSpans,
} from "./timeline";

// AI が編集で使える操作はここにあるものだけ。AI にドキュメントを直接書き換えさせない。
const step = z.number().int().min(1);

const commandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("set_step_text"), step, text: z.string() }),
  z.object({ type: z.literal("delete_step"), step }),
  z.object({ type: z.literal("move_step"), step, to: step }),
  z.object({ type: z.literal("split_here") }),
  z.object({ type: z.literal("add_zoom") }),
  z.object({ type: z.literal("remove_zoom"), step }),
  z.object({ type: z.literal("set_zoom_depth"), step, depth: z.number() }),
  z.object({ type: z.literal("seek_step"), step }),
  z.object({ type: z.literal("set_background"), background: z.enum(BACKGROUND_IDS) }),
  z.object({ type: z.literal("undo") }),
  z.object({ type: z.literal("clarify"), question: z.string() }),
]);

export const commandListSchema = z.object({ commands: z.array(commandSchema) });

export type Command = z.infer<typeof commandSchema>;

export type CommandResult =
  | { kind: "applied"; doc: DemoDocument; message: string; seekSec?: number }
  | { kind: "undo" }
  | { kind: "question"; question: string }
  | { kind: "failed"; message: string };

const MIN_DEPTH = 1.1;
const MAX_DEPTH = 4;

// AI に渡す現在の状態。「ここ」は playhead の手順として解釈させる。
export function describeState(doc: DemoDocument, timeSec: number) {
  const zooms = zoomSpans(doc);
  return {
    purpose: doc.purpose,
    playheadStep: locate(doc, timeSec).index + 1,
    background: doc.look.background,
    steps: stepSpans(doc).map(({ clip, caption, startSec, endSec }, index) => ({
      step: index + 1,
      seconds: Math.round((endSec - startSec) * 10) / 10,
      text: caption?.text ?? "",
      zoomDepth: zooms.find((item) => item.zoom.clipId === clip.id)?.zoom.depth ?? null,
    })),
  };
}

class CommandError extends Error {}

function zoomOfClip(doc: DemoDocument, clipId: string, stepNumber: number) {
  const zoom = zoomSpans(doc).find((item) => item.zoom.clipId === clipId)?.zoom;
  if (!zoom) throw new CommandError(`手順 ${stepNumber} にズームはありません。`);
  return zoom;
}

// 途中で失敗したら何も適用しない。手順番号は指示を出した時点の番号として解決する。
export function applyCommands(
  doc: DemoDocument,
  commands: Command[],
  timeSec: number,
  clipIds: string[] = doc.clips.map((clip) => clip.id),
): CommandResult {
  const question = commands.find((command) => command.type === "clarify");
  if (question) return { kind: "question", question: question.question };
  if (commands.length === 0) return { kind: "failed", message: "できる操作が見つかりませんでした。" };
  if (commands.some((command) => command.type === "undo")) {
    return commands.length === 1
      ? { kind: "undo" }
      : { kind: "failed", message: "「元に戻す」は単独で指示してください。" };
  }

  let next = doc;
  const clipOf = (stepNumber: number) => {
    const clipId = clipIds[stepNumber - 1];
    if (!clipId) throw new CommandError(`手順 ${stepNumber} はありません。`);
    if (!next.clips.some((clip) => clip.id === clipId)) {
      throw new CommandError(`手順 ${stepNumber} はすでにありません。`);
    }
    return clipId;
  };

  let seekClipId: string | null = null;
  const done: string[] = [];

  try {
    for (const command of commands) {
      switch (command.type) {
        case "set_step_text":
          next = setStepText(next, clipOf(command.step), command.text);
          done.push(`手順 ${command.step} の説明文を変更しました。`);
          break;
        case "delete_step": {
          if (next.clips.length < 2) throw new CommandError("最後の手順は削除できません。");
          next = deleteClip(next, clipOf(command.step));
          done.push(`手順 ${command.step} を映像ごと削除しました。`);
          break;
        }
        case "move_step": {
          const clipId = clipOf(command.step);
          const target = Math.min(command.to, next.clips.length) - 1;
          const from = next.clips.findIndex((clip) => clip.id === clipId);
          for (let index = from; index !== target; index += Math.sign(target - from)) {
            next = moveClip(next, clipId, target > from ? 1 : -1);
          }
          done.push(`手順 ${command.step} を ${target + 1} 番目へ移動しました。`);
          break;
        }
        case "split_here": {
          const split = splitAt(next, timeSec);
          if (split === next) throw new CommandError("この位置では手順を分けられません。");
          next = split;
          done.push("ここで手順を分けました。");
          break;
        }
        case "add_zoom": {
          const added = addZoom(next, timeSec);
          if (!added) throw new CommandError("この位置にはズームを追加できません。");
          next = added.doc;
          done.push("ここにズームを追加しました。");
          break;
        }
        case "remove_zoom":
          next = removeZoom(next, zoomOfClip(next, clipOf(command.step), command.step).id);
          done.push(`手順 ${command.step} のズームを削除しました。`);
          break;
        case "set_zoom_depth": {
          const zoom = zoomOfClip(next, clipOf(command.step), command.step);
          const depth = Math.min(MAX_DEPTH, Math.max(MIN_DEPTH, command.depth));
          next = updateZoom(next, zoom.id, { depth });
          done.push(`手順 ${command.step} のズームを ${depth.toFixed(1)} 倍にしました。`);
          break;
        }
        case "seek_step":
          seekClipId = clipOf(command.step);
          done.push(`手順 ${command.step} へ移動しました。`);
          break;
        case "set_background":
          next = { ...next, look: { ...next.look, background: command.background } };
          done.push("背景を変更しました。");
          break;
      }
    }
  } catch (cause) {
    if (cause instanceof CommandError) return { kind: "failed", message: cause.message };
    throw cause;
  }

  if (!documentSchema.safeParse(next).success) {
    return { kind: "failed", message: "編集内容を適用できませんでした。" };
  }
  return {
    kind: "applied",
    doc: next,
    message: done.join(" "),
    seekSec: clipSpans(next).find((span) => span.clip.id === seekClipId)?.startSec,
  };
}
