import { applyCommands, type ResolvedCommand } from "./commands";
import type { DemoDocument } from "./document";
import { clipSpans } from "./timeline";

/** assetId と sourceSec は、話した位置の動画とその中の時刻。 */
export type ReviewPlan = { commands: ResolvedCommand[]; assetId: string; sourceSec: number };

export type ReviewOutcome = { doc: DemoDocument; done: string[]; failed: string[] };

const NEEDS_PLAYHEAD = new Set<ResolvedCommand["type"]>(["split_here", "add_zoom", "zoom_focus"]);

// 話した位置は動画と素材の時刻で覚える。前の指示で手順が消えても、タイムライン時刻と違ってズレない。
export function timelineAt(doc: DemoDocument, assetId: string, sourceSec: number) {
  const span = clipSpans(doc).find(
    ({ clip }) =>
      clip.assetId === assetId &&
      sourceSec >= clip.sourceStartSec &&
      sourceSec < clip.sourceEndSec,
  );
  return span ? span.videoStartSec + sourceSec - span.clip.sourceStartSec : null;
}

// 手順番号は確認を終えた時点の番号で固定する。1 件の失敗で残りを止めない。
export function applyReview(doc: DemoDocument, plans: ReviewPlan[]): ReviewOutcome {
  const clipIds = doc.clips.map((clip) => clip.id);
  const done: string[] = [];
  const failed: string[] = [];
  let next = doc;

  for (const { commands, assetId, sourceSec } of plans) {
    const timeSec = timelineAt(next, assetId, sourceSec);
    if (timeSec === null && commands.some((command) => NEEDS_PLAYHEAD.has(command.type))) {
      failed.push("指示した位置の手順がなくなっています。");
      continue;
    }
    const result = applyCommands(next, commands, timeSec ?? 0, clipIds);
    if (result.kind === "applied") {
      next = result.doc;
      done.push(result.message);
    } else {
      failed.push(result.kind === "failed" ? result.message : "通しの確認では実行できない指示です。");
    }
  }
  return { doc: next, done, failed };
}
