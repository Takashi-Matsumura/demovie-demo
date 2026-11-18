"use client";

import { useRef, type KeyboardEvent, type PointerEvent } from "react";
import type { DemoDocument } from "@/lib/document";
import { formatTime } from "@/lib/format";
import {
  layoutDuration,
  layoutPosition,
  pointAtLayout,
  stepLayout,
  totalDuration,
} from "@/lib/timeline";

type StepBarProps = {
  doc: DemoDocument;
  timeSec: number;
  selectedClipId: string;
  onSeek: (timelineSec: number) => void;
  onSelectStep: (clipId: string) => void;
};

const KEY_STEP_SEC = 1;
const KEY_JUMP_SEC = 5;

// 含めない区間は斜線で示す。色だけに頼らず、形でも区別できるようにする。
const EXCLUDED_PATTERN =
  "repeating-linear-gradient(135deg, var(--color-rule) 0 3px, transparent 3px 6px)";

/**
 * 再生位置のバー。全手順を長さどおりに並べ、選んだ手順がどこに当たるかと、
 * 動画に含めない区間がどこにあるかを見せる。再生は含める手順だけをたどる。
 */
export function StepBar({ doc, timeSec, selectedClipId, onSeek, onSelectStep }: StepBarProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const layout = stepLayout(doc);
  const layoutTotal = layoutDuration(doc);
  const total = totalDuration(doc);
  const position = layoutPosition(doc, timeSec);
  const percent = (sec: number) => `${(sec / layoutTotal) * 100}%`;
  const selectedIndex = layout.findIndex((step) => step.clip.id === selectedClipId);
  const selected = layout[selectedIndex];
  const excludedCount = layout.filter((step) => !step.included).length;

  const pointTo = (clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    const point = pointAtLayout(doc, ((clientX - rect.left) / rect.width) * layoutTotal);
    if (point.included) onSeek(point.timelineSec);
    else onSelectStep(point.clipId);
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    pointTo(event.clientX);
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) pointTo(event.clientX);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const delta = event.shiftKey ? KEY_JUMP_SEC : KEY_STEP_SEC;
    const next =
      event.key === "ArrowRight" || event.key === "ArrowUp"
        ? timeSec + delta
        : event.key === "ArrowLeft" || event.key === "ArrowDown"
          ? timeSec - delta
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? total
              : null;
    if (next === null) return;
    event.preventDefault();
    onSeek(Math.min(Math.max(0, next), total));
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div
        ref={trackRef}
        role="slider"
        tabIndex={0}
        aria-label="再生位置"
        aria-valuemin={0}
        aria-valuemax={Math.round(total * 10) / 10}
        aria-valuenow={Math.round(timeSec * 10) / 10}
        aria-valuetext={`${formatTime(timeSec)}、手順 ${selectedIndex + 1}`}
        className="relative h-6 cursor-pointer touch-none select-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onKeyDown={onKeyDown}
      >
        {layout.map((step) => {
          const isSelected = step.clip.id === selectedClipId;
          const played = Math.min(
            1,
            Math.max(0, (position - step.layoutStartSec) / step.durationSec),
          );
          return (
            <div
              key={step.clip.id}
              aria-hidden
              style={{
                left: percent(step.layoutStartSec),
                width: percent(step.durationSec),
                backgroundImage: step.included ? undefined : EXCLUDED_PATTERN,
              }}
              className={`absolute top-1/2 h-3 -translate-y-1/2 overflow-hidden rounded-sm border-x border-paper-2 ${
                step.included ? (isSelected ? "bg-accent/25" : "bg-paper-3") : "bg-paper-2"
              } ${isSelected ? "z-10 h-4 outline-2 outline-accent" : ""}`}
            >
              {step.included && (
                <div
                  style={{ width: `${played * 100}%` }}
                  className={`h-full ${isSelected ? "bg-accent" : "bg-accent/60"}`}
                />
              )}
            </div>
          );
        })}
        <div
          aria-hidden
          style={{ left: percent(position) }}
          className="pointer-events-none absolute inset-y-0 z-20 w-0.5 -translate-x-1/2 rounded bg-ink"
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-x-3 text-xs text-ink-2">
        {selected && (
          <span>
            <span className="font-semibold text-ink">手順 {selectedIndex + 1}</span>
            {selected.included
              ? `　${formatTime(selected.startSec)} 〜 ${formatTime(selected.endSec)}`
              : `　動画に含めない（${selected.durationSec.toFixed(1)}秒）`}
          </span>
        )}
        {excludedCount > 0 && (
          <span className="flex items-center gap-1.5">
            <span
              aria-hidden
              style={{ backgroundImage: EXCLUDED_PATTERN }}
              className="inline-block h-2.5 w-5 rounded-sm bg-paper-2"
            />
            含めない区間
          </span>
        )}
      </div>
    </div>
  );
}
