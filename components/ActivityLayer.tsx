"use client";

import type { ActivityMark } from "@/lib/activity";

type ActivityLayerProps = {
  marks: ActivityMark[];
  view: { startSec: number; endSec: number };
  /** 文字を載せられる高さのバーか。 */
  detail: boolean;
};

const STATE_CLASS: Record<ActivityMark["state"], string> = {
  scanned: "bg-accent/15",
  scanning: "bg-accent/30",
  pending: "border border-dashed border-accent/60",
  current: "bg-accent/45 outline-2 -outline-offset-2 outline-accent motion-safe:animate-pulse",
  // 隣り合う区間が 1 本に見えないよう、内側に下地の色の縁を付ける。
  done: "bg-accent text-accent-ink ring-1 ring-inset ring-paper-2",
  skipped: "border border-dotted border-ink-2/60",
};

/**
 * キャプションの生成中に、どこを解析しているかをバーに重ねて見せる。
 * 画面の変化を探している間は読み終えた範囲を塗り、見つけた区間は説明文を作るたびに塗りつぶす。
 * 操作の邪魔をしないよう、ポインタは下のバーへ通す。
 */
export function ActivityLayer({ marks, view, detail }: ActivityLayerProps) {
  const length = view.endSec - view.startSec;
  if (length <= 0) return null;
  const percent = (sec: number) => `${((sec - view.startSec) / length) * 100}%`;

  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 z-15">
      {marks
        .filter((mark) => mark.endSec > view.startSec && mark.startSec < view.endSec)
        .map((mark) => {
          const fromSec = Math.max(mark.startSec, view.startSec);
          const toSec = Math.min(mark.endSec, view.endSec);
          return (
            <div
              key={mark.key}
              style={{ left: percent(fromSec), width: `${((toSec - fromSec) / length) * 100}%` }}
              className={`absolute flex items-center overflow-hidden rounded-sm text-xs whitespace-nowrap ${
                detail ? "inset-y-1 px-1" : "top-1/2 h-4 -translate-y-1/2"
              } ${STATE_CLASS[mark.state]}`}
            >
              {detail && mark.state === "done" && <span className="truncate">{mark.text}</span>}
              {detail && mark.state === "current" && (
                <span className="truncate text-ink">生成中…</span>
              )}
              {mark.state === "scanning" && (
                <span className="absolute inset-y-0 right-0 w-0.5 bg-accent motion-safe:animate-pulse" />
              )}
            </div>
          );
        })}
    </div>
  );
}
