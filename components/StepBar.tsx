"use client";

import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import type { DemoDocument } from "@/lib/document";
import { formatTime } from "@/lib/format";
import {
  layoutDuration,
  layoutPosition,
  pointAtLayout,
  stepLayout,
  totalDuration,
  zoomWindow,
} from "@/lib/timeline";

type StepBarProps = {
  doc: DemoDocument;
  timeSec: number;
  selectedClipId: string;
  onSeek: (timelineSec: number) => void;
  onSelectStep: (clipId: string) => void;
};

type Step = ReturnType<typeof stepLayout>[number];

type View = { startSec: number; endSec: number };

const KEY_STEP_SEC = 1;
const KEY_JUMP_SEC = 5;
// 拡大バーに映す長さ。手順の番号と説明文の冒頭が読める幅になるよう 30 秒にする。
const DETAIL_SEC = 30;
// 全体がこれより短ければ全体バーだけで読めるので、拡大バーは出さない。
const DETAIL_MIN_TOTAL_SEC = DETAIL_SEC * 1.5;

// 含めない区間は斜線で示す。色だけに頼らず、形でも区別できるようにする。
const EXCLUDED_PATTERN =
  "repeating-linear-gradient(135deg, var(--color-rule) 0 3px, transparent 3px 6px)";

/**
 * 再生位置のバー。全手順を長さどおりに並べ、選んだ手順がどこに当たるかと、
 * 動画に含めない区間がどこにあるかを見せる。再生は含める手順だけをたどる。
 * 長い動画では手順が詰まって読めないので、再生位置の近くを拡大したバーを下に添える。
 */
export function StepBar({ doc, timeSec, selectedClipId, onSeek, onSelectStep }: StepBarProps) {
  const layout = stepLayout(doc);
  const layoutTotal = layoutDuration(doc);
  const total = totalDuration(doc);
  const position = layoutPosition(doc, timeSec);
  const selectedIndex = layout.findIndex((step) => step.clip.id === selectedClipId);
  const selected = layout[selectedIndex];
  const excludedCount = layout.filter((step) => !step.included).length;

  // 含めない手順を選んでいるときは、再生位置ではなくその手順を中心に拡大する。
  const center =
    selected && !selected.included
      ? (selected.layoutStartSec + selected.layoutEndSec) / 2
      : position;
  const detail =
    layoutTotal > DETAIL_MIN_TOTAL_SEC ? zoomWindow(layoutTotal, center, DETAIL_SEC) : null;

  const pointTo = (layoutSec: number) => {
    const point = pointAtLayout(doc, layoutSec);
    if (point.included) onSeek(point.timelineSec);
    else onSelectStep(point.clipId);
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
      <Track
        layout={layout}
        view={{ startSec: 0, endSec: layoutTotal }}
        lens={detail}
        position={position}
        selectedClipId={selectedClipId}
        variant="overview"
        onPoint={pointTo}
        slider={{
          role: "slider",
          tabIndex: 0,
          "aria-label": "再生位置",
          "aria-valuemin": 0,
          "aria-valuemax": Math.round(total * 10) / 10,
          "aria-valuenow": Math.round(timeSec * 10) / 10,
          "aria-valuetext": `${formatTime(timeSec)}、手順 ${selectedIndex + 1}`,
          onKeyDown,
        }}
      />

      {detail && (
        // 全体バーと同じ操作の拡大版なので、読み上げとキーボードは全体バーに任せる。
        <Track
          layout={layout}
          view={detail}
          lens={null}
          position={position}
          selectedClipId={selectedClipId}
          variant="detail"
          onPoint={pointTo}
        />
      )}

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

type TrackProps = {
  layout: Step[];
  view: View;
  /** 全体バーに重ねる、拡大バーが映している範囲。 */
  lens: View | null;
  position: number;
  selectedClipId: string;
  variant: "overview" | "detail";
  onPoint: (layoutSec: number) => void;
  slider?: Record<string, unknown> & {
    onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
  };
};

function Track({
  layout,
  view,
  lens,
  position,
  selectedClipId,
  variant,
  onPoint,
  slider,
}: TrackProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  // ドラッグ中は表示範囲を止める。拡大バーは再生位置を追って動くので、止めないと指の下で流れる。
  const [dragView, setDragView] = useState<View | null>(null);
  const shown = dragView ?? view;
  const length = shown.endSec - shown.startSec;
  const percent = (sec: number) => `${((sec - shown.startSec) / length) * 100}%`;
  const detail = variant === "detail";

  const pointTo = (clientX: number, range: View) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    const ratio = (clientX - rect.left) / rect.width;
    onPoint(range.startSec + ratio * (range.endSec - range.startSec));
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragView(view);
    pointTo(event.clientX, view);
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) pointTo(event.clientX, shown);
  };

  const onPointerEnd = () => setDragView(null);

  return (
    <div
      ref={trackRef}
      {...slider}
      aria-hidden={slider ? undefined : true}
      className={`relative cursor-pointer touch-none overflow-hidden select-none ${
        detail ? "h-9 rounded bg-paper-2" : "h-6"
      }`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
    >
      {lens && (
        <div
          aria-hidden
          style={{
            left: percent(lens.startSec),
            width: `${((lens.endSec - lens.startSec) / length) * 100}%`,
          }}
          className="pointer-events-none absolute inset-y-0 rounded border border-ink-2/50 bg-ink/5"
        />
      )}
      {layout
        .filter((step) => step.layoutEndSec > shown.startSec && step.layoutStartSec < shown.endSec)
        .map((step) => {
          // 範囲の端にかかる手順は見えている部分だけ描く。番号が範囲の外へ出て読めなくならないように。
          const fromSec = Math.max(step.layoutStartSec, shown.startSec);
          const toSec = Math.min(step.layoutEndSec, shown.endSec);
          const playedSec = Math.min(Math.max(position, fromSec), toSec);
          return (
            <Segment
              key={step.clip.id}
              step={step}
              number={layout.indexOf(step) + 1}
              left={percent(fromSec)}
              width={`${((toSec - fromSec) / length) * 100}%`}
              played={(playedSec - fromSec) / (toSec - fromSec)}
              selected={step.clip.id === selectedClipId}
              detail={detail}
            />
          );
        })}
      <div
        aria-hidden
        style={{ left: percent(position) }}
        className="pointer-events-none absolute inset-y-0 z-20 w-0.5 -translate-x-1/2 rounded bg-ink"
      />
    </div>
  );
}

type SegmentProps = {
  step: Step;
  number: number;
  left: string;
  width: string;
  played: number;
  selected: boolean;
  detail: boolean;
};

function Segment({ step, number, left, width, played, selected, detail }: SegmentProps) {
  const text = step.caption?.text.trim();
  const label = `手順 ${number}${step.included ? "" : "（含めない）"}${text ? `: ${text}` : ""}`;

  if (!detail) {
    return (
      <div
        style={{
          left,
          width,
          backgroundImage: step.included ? undefined : EXCLUDED_PATTERN,
        }}
        className={`absolute top-1/2 h-3 -translate-y-1/2 overflow-hidden rounded-sm border-x border-paper-2 ${
          step.included ? (selected ? "bg-accent/25" : "bg-paper-3") : "bg-paper-2"
        } ${selected ? "z-10 h-4 outline-2 outline-accent" : ""}`}
      >
        {step.included && (
          <div
            style={{ width: `${played * 100}%` }}
            className={`h-full ${selected ? "bg-accent" : "bg-accent/60"}`}
          />
        )}
      </div>
    );
  }

  // 拡大バーは文字を載せるので、再生済みは塗りつぶさず下端の線で示す。
  return (
    <div
      title={label}
      style={{
        left,
        width,
        backgroundImage: step.included ? undefined : EXCLUDED_PATTERN,
      }}
      className={`absolute inset-y-1 flex items-center gap-1.5 overflow-hidden rounded-sm border-x border-paper-2 px-1.5 text-xs ${
        step.included ? "bg-paper-3 text-ink" : "bg-paper-2 text-ink-2"
      } ${selected ? "z-10 outline-2 -outline-offset-2 outline-accent" : ""}`}
    >
      <span className={`shrink-0 font-mono ${selected ? "font-semibold text-accent" : ""}`}>
        {number}
      </span>
      <span className="truncate">{step.included ? text : "含めない"}</span>
      {step.included && (
        <span
          aria-hidden
          style={{ width: `${played * 100}%` }}
          className={`absolute bottom-0 left-0 h-1 ${selected ? "bg-accent" : "bg-accent/60"}`}
        />
      )}
    </div>
  );
}
