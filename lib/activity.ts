import type { CaptionActivity } from "./captions";
import type { DemoDocument } from "./document";
import { isIncluded, layoutOfSource, timelineOfSource } from "./timeline";

/**
 * 解析中の様子を、バー上の区間として表したもの。
 * scanned は解析を終えた手順、scanning は解析中の手順の読み終えた部分、
 * pending / current / done / skipped はキャプションを付ける区間の、未着手・作成中・作成済み・説明なし。
 */
export type ActivityMark = {
  key: string;
  state: "scanned" | "scanning" | "pending" | "current" | "done" | "skipped";
  startSec: number;
  endSec: number;
  text?: string;
};

export type ActivityView = {
  marks: ActivityMark[];
  /** 解析している位置。拡大バーはここを中心に映す。 */
  focusSec: number | null;
};

type ToSec = (doc: DemoDocument, clipId: string, sourceSec: number) => number | null;

function activityView(
  doc: DemoDocument,
  activity: CaptionActivity | null,
  toSec: ToSec,
): ActivityView {
  if (!activity) return { marks: [], focusSec: null };
  const range = (clipId: string, fromSec: number, toSourceSec: number) => {
    const startSec = toSec(doc, clipId, fromSec);
    const endSec = toSec(doc, clipId, toSourceSec);
    return startSec === null || endSec === null ? null : { startSec, endSec };
  };

  if (activity.phase === "scan") {
    const marks: ActivityMark[] = [];
    for (const clip of doc.clips) {
      if (!isIncluded(clip)) continue;
      const scanned = activity.scannedClipIds.includes(clip.id);
      const scanning = clip.id === activity.clipId;
      if (!scanned && !scanning) continue;
      const span = range(
        clip.id,
        clip.sourceStartSec,
        scanning ? activity.sourceSec : clip.sourceEndSec,
      );
      if (span) marks.push({ key: clip.id, state: scanning ? "scanning" : "scanned", ...span });
    }
    return { marks, focusSec: toSec(doc, activity.clipId, activity.sourceSec) };
  }

  const current = activity.results.length;
  let focusSec: number | null = null;
  const marks = activity.targets.flatMap((target, index): ActivityMark[] => {
    const span = range(target.clipId, target.sourceStartSec, target.sourceEndSec);
    if (!span) return [];
    if (index === current) focusSec = span.startSec;
    const result = activity.results[index];
    const state =
      index === current
        ? "current"
        : index > current
          ? "pending"
          : result === null
            ? "skipped"
            : "done";
    return [{ key: `${index}`, state, text: result ?? undefined, ...span }];
  });
  return { marks, focusSec };
}

/** 再生バー（含めない手順も並べる）の上での位置。 */
export function layoutActivity(doc: DemoDocument, activity: CaptionActivity | null) {
  return activityView(doc, activity, layoutOfSource);
}

/** タイムライン時刻での位置。 */
export function timelineActivity(doc: DemoDocument, activity: CaptionActivity | null) {
  return activityView(doc, activity, timelineOfSource);
}
