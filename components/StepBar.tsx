"use client";

import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { layoutActivity, type ActivityMark } from "@/lib/activity";
import type { CaptionActivity } from "@/lib/captions";
import type { DemoDocument } from "@/lib/document";
import { formatTime } from "@/lib/format";
import {
  clipEdgeLimits,
  layoutDuration,
  layoutPosition,
  locate,
  mergeBlocker,
  moveClipEdge,
  pointAtLayout,
  splitAt,
  stepLayout,
  totalDuration,
  zoomWindow,
  type ClipEdge,
} from "@/lib/timeline";
import { ActivityLayer } from "./ActivityLayer";

type StepBarProps = {
  doc: DemoDocument;
  timeSec: number;
  selectedClipId: string;
  /** キャプションの生成中に、解析している位置。 */
  activity?: CaptionActivity | null;
  /** 手順の範囲を編集できるか。生成中や書き出し中は止める。 */
  editable?: boolean;
  onSeek: (timelineSec: number) => void;
  onSelectStep: (clipId: string) => void;
  /** 手順の始まりか終わりを、素材時刻へ動かす。 */
  onEdge: (clipId: string, edge: ClipEdge, sourceSec: number) => void;
  /** 手順を次の手順と結合する。 */
  onMerge: (clipId: string) => void;
  /** 再生位置で手順を分ける。 */
  onSplit: () => void;
};

type Step = ReturnType<typeof stepLayout>[number];

type View = { startSec: number; endSec: number };

type Drag = { clipId: string; edge: ClipEdge; sourceSec: number };

/** 選んだ手順の端を動かす操作。つまみはドラッグ中も元の並びの上に描き、放したときに確定する。 */
type EdgeEdit = {
  step: Step;
  number: number;
  drag: Drag | null;
  onDrag: (edge: ClipEdge, sourceSec: number) => void;
  onCommit: () => void;
  onNudge: (edge: ClipEdge, sourceSec: number) => void;
};

const NUDGE_SEC = 0.1;
const NUDGE_JUMP_SEC = 1;

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
export function StepBar({
  doc,
  timeSec,
  selectedClipId,
  activity = null,
  editable = true,
  onSeek,
  onSelectStep,
  onEdge,
  onMerge,
  onSplit,
}: StepBarProps) {
  const [drag, setDrag] = useState<Drag | null>(null);
  const layout = stepLayout(doc);
  const layoutTotal = layoutDuration(doc);
  const total = totalDuration(doc);
  const position = layoutPosition(doc, timeSec);
  const selectedIndex = layout.findIndex((step) => step.clip.id === selectedClipId);
  const selected = layout[selectedIndex];
  const excludedCount = layout.filter((step) => !step.included).length;
  const { marks, focusSec } = layoutActivity(doc, activity);

  // 生成中は解析している位置を、含めない手順を選んでいるときはその手順を、
  // それ以外は再生位置を中心に拡大する。
  const center =
    focusSec ??
    (selected && !selected.included
      ? (selected.layoutStartSec + selected.layoutEndSec) / 2
      : position);
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

  const clampEdge = (clipId: string, edge: ClipEdge, sourceSec: number) => {
    const limits = clipEdgeLimits(doc, clipId, edge);
    return limits ? Math.min(Math.max(sourceSec, limits.minSec), limits.maxSec) : sourceSec;
  };

  const edgeEdit: EdgeEdit | null =
    editable && selected
      ? {
          step: selected,
          number: selectedIndex + 1,
          drag: drag?.clipId === selected.clip.id ? drag : null,
          onDrag: (edge, sourceSec) =>
            setDrag({
              clipId: selected.clip.id,
              edge,
              sourceSec: clampEdge(selected.clip.id, edge, sourceSec),
            }),
          onCommit: () => {
            if (drag) onEdge(drag.clipId, drag.edge, drag.sourceSec);
            setDrag(null);
          },
          onNudge: (edge, sourceSec) => onEdge(selected.clip.id, edge, sourceSec),
        }
      : null;

  // ドラッグ中は、放したときの範囲を下の行に出す。
  const previewDoc = drag ? moveClipEdge(doc, drag.clipId, drag.edge, drag.sourceSec) : doc;
  const shownStep = stepLayout(previewDoc).find((step) => step.clip.id === selectedClipId);
  const previous = layout[selectedIndex - 1];
  const mergePrevBlocker = previous
    ? mergeBlocker(doc, previous.clip.id)
    : "結合する前の手順がありません。";
  const mergeNextBlocker = selected
    ? mergeBlocker(doc, selected.clip.id)
    : "結合する次の手順がありません。";
  const canSplit =
    !!selected?.included &&
    locate(doc, timeSec).clip.id === selected.clip.id &&
    splitAt(doc, timeSec) !== doc;

  return (
    <div className="flex flex-col gap-1.5">
      <Track
        layout={layout}
        view={{ startSec: 0, endSec: layoutTotal }}
        lens={detail}
        marks={marks}
        position={position}
        selectedClipId={selectedClipId}
        edit={detail ? null : edgeEdit}
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
          marks={marks}
          position={position}
          selectedClipId={selectedClipId}
          edit={edgeEdit}
          variant="detail"
          onPoint={pointTo}
        />
      )}

      <div className="flex flex-wrap items-center justify-between gap-x-3 text-xs text-ink-2">
        {shownStep && (
          <span aria-live={drag ? "polite" : undefined}>
            <span className="font-semibold text-ink">手順 {selectedIndex + 1}</span>
            {shownStep.included
              ? `　${formatTime(shownStep.startSec)} 〜 ${formatTime(shownStep.endSec)}`
              : `　動画に含めない（${shownStep.durationSec.toFixed(1)}秒）`}
          </span>
        )}
        {editable && selected && (
          <span className="flex flex-wrap items-center gap-1">
            <EditButton
              blocker={mergePrevBlocker}
              onClick={() => previous && onMerge(previous.clip.id)}
            >
              前と結合
            </EditButton>
            <EditButton blocker={mergeNextBlocker} onClick={() => onMerge(selected.clip.id)}>
              次と結合
            </EditButton>
            <EditButton
              blocker={canSplit ? null : "再生位置を手順の途中に合わせると分けられます。"}
              onClick={onSplit}
            >
              ここで分ける
            </EditButton>
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
  marks: ActivityMark[];
  position: number;
  selectedClipId: string;
  edit?: EdgeEdit | null;
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
  marks,
  position,
  selectedClipId,
  edit = null,
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
      // つまみは読み上げとキーボードで操作できるよう、隠す範囲から外す。
      aria-hidden={slider || edit ? undefined : true}
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
      {piecesOf(layout)
        .filter((piece) => piece.endSec > shown.startSec && piece.startSec < shown.endSec)
        .map(({ step, kind, startSec, endSec }) => {
          // 範囲の端にかかる手順は見えている部分だけ描く。番号が範囲の外へ出て読めなくならないように。
          const fromSec = Math.max(startSec, shown.startSec);
          const toSec = Math.min(endSec, shown.endSec);
          const playedSec = Math.min(Math.max(position, fromSec), toSec);
          return (
            <Segment
              key={`${step.clip.id}-${kind}`}
              step={step}
              kind={kind}
              number={layout.indexOf(step) + 1}
              left={percent(fromSec)}
              width={`${((toSec - fromSec) / length) * 100}%`}
              played={(playedSec - fromSec) / (toSec - fromSec)}
              selected={step.clip.id === selectedClipId}
              detail={detail}
            />
          );
        })}
      <ActivityLayer marks={marks} view={shown} detail={detail} />
      {edit && (
        <EdgeHandles
          edit={edit}
          percent={percent}
          layoutAt={(clientX) => {
            const rect = trackRef.current?.getBoundingClientRect();
            if (!rect || rect.width === 0) return null;
            return shown.startSec + ((clientX - rect.left) / rect.width) * length;
          }}
        />
      )}
      <div
        aria-hidden
        style={{ left: percent(position) }}
        className="pointer-events-none absolute inset-y-0 z-20 w-0.5 -translate-x-1/2 rounded bg-ink"
      />
    </div>
  );
}

type PieceKind = "chapter" | "video";

// チャプター画面を持つ手順は、チャプター画面と映像の 2 つに分けて描く。
function piecesOf(layout: Step[]) {
  return layout.flatMap((step) => {
    const videoStartSec = step.layoutStartSec + step.chapterSec;
    const video = {
      step,
      kind: "video" as PieceKind,
      startSec: videoStartSec,
      endSec: step.layoutEndSec,
    };
    if (step.chapterSec === 0) return [video];
    const chapter = {
      step,
      kind: "chapter" as PieceKind,
      startSec: step.layoutStartSec,
      endSec: videoStartSec,
    };
    return [chapter, video];
  });
}

type SegmentProps = {
  step: Step;
  kind: PieceKind;
  number: number;
  left: string;
  width: string;
  played: number;
  selected: boolean;
  detail: boolean;
};

function Segment({ step, kind, number, left, width, played, selected, detail }: SegmentProps) {
  const chapter = kind === "chapter";
  const title = step.clip.chapter?.title.trim() || "チャプター画面";
  const text = chapter ? title : step.caption?.text.trim();
  const label = chapter
    ? `手順 ${number} の前のチャプター画面: ${title}`
    : `手順 ${number}${step.included ? "" : "（含めない）"}${text ? `: ${text}` : ""}`;
  // チャプター画面は映像の手順と見分けられるよう、色を変えて左端に太い線を引く。
  const fill = chapter ? "bg-zoom" : "bg-paper-3";

  if (!detail) {
    return (
      <div
        aria-hidden
        style={{
          left,
          width,
          backgroundImage: step.included ? undefined : EXCLUDED_PATTERN,
        }}
        className={`absolute top-1/2 h-3 -translate-y-1/2 overflow-hidden rounded-sm border-x border-paper-2 ${
          step.included ? (selected && !chapter ? "bg-accent/25" : fill) : "bg-paper-2"
        } ${chapter ? "border-l-2 border-l-accent" : ""} ${
          selected ? "z-10 h-4 outline-2 outline-accent" : ""
        }`}
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
  // 手順の並びは全体バーの読み上げに任せる。
  return (
    <div
      aria-hidden
      title={label}
      style={{
        left,
        width,
        backgroundImage: step.included ? undefined : EXCLUDED_PATTERN,
      }}
      className={`absolute inset-y-1 flex items-center gap-1.5 overflow-hidden rounded-sm border-x border-paper-2 px-1.5 text-xs ${
        step.included ? `${fill} text-ink` : "bg-paper-2 text-ink-2"
      } ${chapter ? "border-l-4 border-l-accent font-semibold" : ""} ${
        selected ? "z-10 outline-2 -outline-offset-2 outline-accent" : ""
      }`}
    >
      {chapter ? (
        <span className="shrink-0 text-accent">■</span>
      ) : (
        <span className={`shrink-0 font-mono ${selected ? "font-semibold text-accent" : ""}`}>
          {number}
        </span>
      )}
      <span className="truncate">{step.included || chapter ? text : "含めない"}</span>
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

type EditButtonProps = {
  blocker: string | null;
  onClick: () => void;
  children: string;
};

// できないときは押せなくし、理由を添える。
function EditButton({ blocker, onClick, children }: EditButtonProps) {
  return (
    <button
      type="button"
      disabled={blocker !== null}
      title={blocker ?? undefined}
      className="rounded px-2 py-1 text-ink-2 transition-colors duration-(--dur-fast) hover:bg-paper-3 hover:text-ink disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-ink-2"
      onClick={onClick}
    >
      {children}
    </button>
  );
}

type EdgeHandlesProps = {
  edit: EdgeEdit;
  percent: (layoutSec: number) => string;
  /** 画面上の横位置を、バー上の位置に変換する。 */
  layoutAt: (clientX: number) => number | null;
};

/**
 * 選んだ手順の両端に出すつまみ。ドラッグで端を動かし、矢印キーで 0.1 秒（Shift で 1 秒）ずつ動かす。
 * ドラッグ中は元の並びの上でつまみだけを動かし、増える範囲と削る範囲を塗って見せる。
 */
function EdgeHandles({ edit, percent, layoutAt }: EdgeHandlesProps) {
  const { step, number, drag } = edit;
  const videoStartSec = step.layoutStartSec + step.chapterSec;
  // 素材時刻と、元の並びでのバー上の位置を行き来する。
  const toLayout = (sourceSec: number) => videoStartSec + sourceSec - step.clip.sourceStartSec;
  const toSource = (layoutSec: number) => step.clip.sourceStartSec + layoutSec - videoStartSec;
  const edges: { edge: ClipEdge; sourceSec: number; label: string }[] = [
    { edge: "start", sourceSec: step.clip.sourceStartSec, label: "開始位置" },
    { edge: "end", sourceSec: step.clip.sourceEndSec, label: "終了位置" },
  ];
  // ドラッグで増える（または削る）範囲。
  const dragFrom = drag ? toLayout(edgeSec(step, drag.edge)) : 0;
  const dragTo = drag ? toLayout(drag.sourceSec) : 0;
  const changedFrom = Math.min(dragFrom, dragTo);
  const changedTo = Math.max(dragFrom, dragTo);

  return (
    <>
      {drag && (
        <div
          aria-hidden
          style={{ left: percent(changedFrom), width: `calc(${percent(changedTo)} - ${percent(changedFrom)})` }}
          className="pointer-events-none absolute inset-y-0 z-20 bg-accent/25"
        />
      )}
      {edges.map(({ edge, sourceSec, label }) => {
        const shownSec = drag?.edge === edge ? drag.sourceSec : sourceSec;
        return (
          <div
            key={edge}
            role="slider"
            tabIndex={0}
            aria-label={`手順 ${number} の${label}`}
            aria-valuenow={Math.round(shownSec * 10) / 10}
            aria-valuetext={`元の映像の ${formatTime(shownSec)}`}
            title={`${label}をドラッグで調整`}
            style={{ left: percent(toLayout(shownSec)) }}
            className={`group absolute inset-y-0 z-30 flex w-3 cursor-ew-resize touch-none justify-center ${
              edge === "start" ? "" : "-translate-x-full"
            }`}
            onPointerDown={(event) => {
              // 下のバーの再生位置の移動にしない。
              event.stopPropagation();
              event.currentTarget.setPointerCapture(event.pointerId);
              edit.onDrag(edge, sourceSec);
            }}
            onPointerMove={(event) => {
              if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
              const layoutSec = layoutAt(event.clientX);
              if (layoutSec !== null) edit.onDrag(edge, toSource(layoutSec));
            }}
            onPointerUp={edit.onCommit}
            onPointerCancel={edit.onCommit}
            onKeyDown={(event) => {
              const delta = event.shiftKey ? NUDGE_JUMP_SEC : NUDGE_SEC;
              const sign =
                event.key === "ArrowRight" || event.key === "ArrowUp"
                  ? 1
                  : event.key === "ArrowLeft" || event.key === "ArrowDown"
                    ? -1
                    : 0;
              if (sign === 0) return;
              event.preventDefault();
              event.stopPropagation();
              edit.onNudge(edge, sourceSec + sign * delta);
            }}
          >
            <span className="h-full w-1 rounded-sm bg-accent shadow-[0_0_0_1px_var(--color-paper)] transition-[width] duration-(--dur-fast) group-hover:w-1.5 group-focus-visible:w-1.5" />
          </div>
        );
      })}
    </>
  );
}

function edgeSec(step: Step, edge: ClipEdge) {
  return edge === "start" ? step.clip.sourceStartSec : step.clip.sourceEndSec;
}
