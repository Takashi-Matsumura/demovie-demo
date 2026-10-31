"use client";

import { useRef, type PointerEvent } from "react";
import type { DemoDocument } from "@/lib/document";
import { clipSpans, totalDuration, zoomSpans } from "@/lib/timeline";

type TimelineProps = {
  doc: DemoDocument;
  timeSec: number;
  selectedZoomId: string | null;
  onSeek: (timeSec: number) => void;
};

export function Timeline({ doc, timeSec, selectedZoomId, onSeek }: TimelineProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const total = totalDuration(doc);
  const percent = (sec: number) => `${(sec / total) * 100}%`;

  const seekFromPointer = (event: PointerEvent) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect) return;
    onSeek((Math.min(Math.max(0, event.clientX - rect.left), rect.width) / rect.width) * total);
  };

  return (
    <div
      ref={trackRef}
      role="slider"
      tabIndex={0}
      aria-label="再生位置"
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={timeSec}
      className="relative flex h-28 touch-none cursor-text flex-col gap-1 select-none"
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        seekFromPointer(event);
      }}
      onPointerMove={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) seekFromPointer(event);
      }}
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft") onSeek(timeSec - 0.5);
        if (event.key === "ArrowRight") onSeek(timeSec + 0.5);
      }}
    >
      <div className="relative h-9 rounded bg-paper-2">
        {zoomSpans(doc).map(({ zoom, startSec, endSec }) => (
          <button
            key={zoom.id}
            type="button"
            aria-label={`ズーム ${zoom.depth.toFixed(1)}倍を選択`}
            aria-pressed={zoom.id === selectedZoomId}
            style={{ left: percent(startSec), width: percent(endSec - startSec) }}
            className={`absolute inset-y-1 overflow-hidden rounded-sm px-1.5 text-left font-mono text-xs whitespace-nowrap transition-colors duration-(--dur-fast) ${
              zoom.id === selectedZoomId
                ? "bg-accent text-accent-ink"
                : "bg-zoom text-ink hover:bg-accent hover:text-accent-ink"
            }`}
            onPointerDown={(event) => event.stopPropagation()}
            // 始端はまだ拡大が始まっていないので、効果が見える中央へ移動する。
            onClick={() => onSeek((startSec + endSec) / 2)}
          >
            {zoom.depth.toFixed(1)}×
          </button>
        ))}
      </div>

      <div className="relative flex-1 overflow-hidden rounded bg-paper-2">
        {clipSpans(doc).map(({ clip, startSec, endSec }, index) => (
          <div
            key={clip.id}
            style={{ left: percent(startSec), width: percent(endSec - startSec) }}
            className="absolute inset-y-0 border-r-2 border-paper bg-paper-3 px-2 py-1.5 font-mono text-xs text-ink-2 last:border-r-0"
          >
            {index + 1}
          </div>
        ))}
      </div>

      <div
        aria-hidden
        style={{ left: percent(timeSec) }}
        className="pointer-events-none absolute inset-y-0 w-0.5 -translate-x-1/2 bg-accent"
      />
    </div>
  );
}
