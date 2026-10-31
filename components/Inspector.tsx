"use client";

import { useState } from "react";
import { BACKGROUND_IDS, type DemoDocument, type Look, type Zoom } from "@/lib/document";
import { BACKGROUNDS } from "@/lib/render";

type InspectorProps = {
  doc: DemoDocument;
  zoom: Zoom | null;
  onLook: (patch: Partial<Look>) => void;
  onZoom: (patch: Partial<Pick<Zoom, "depth" | "focusX" | "focusY">>) => void;
  onZoomLength: (lengthSec: number) => void;
  onZoomRemove: () => void;
};

type SliderProps = {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  onChange: (value: number) => void;
};

function Slider({ label, value, min, max, step, unit, onChange }: SliderProps) {
  return (
    <label className="flex flex-col gap-1.5 text-sm text-ink-2">
      <span className="flex justify-between">
        {label}
        <span className="font-mono text-ink">
          {value.toFixed(step < 1 ? 1 : 0)}
          {unit}
        </span>
      </span>
      <input
        type="range"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

export function Inspector({ doc, zoom, onLook, onZoom, onZoomLength, onZoomRemove }: InspectorProps) {
  const { look } = doc;
  const [lookOpen, setLookOpen] = useState(true);

  return (
    <aside className="flex flex-col gap-6 rounded-lg bg-paper-2 p-4">
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">
          {/* details だと Space が Editor の再生ショートカットに奪われるので button にする。 */}
          <button
            type="button"
            aria-expanded={lookOpen}
            className="flex w-full items-center justify-between"
            onClick={() => setLookOpen((open) => !open)}
          >
            見た目
            <span
              aria-hidden
              className={`text-ink-2 transition-transform duration-(--dur-fast) ${lookOpen ? "rotate-180" : ""}`}
            >
              ▾
            </span>
          </button>
        </h2>
        {lookOpen && (
          <>
            <div role="radiogroup" aria-label="背景" className="grid grid-cols-4 gap-2">
              {BACKGROUND_IDS.map((id) => (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={look.background === id}
                  aria-label={BACKGROUNDS[id].label}
                  title={BACKGROUNDS[id].label}
                  style={{
                    background: `linear-gradient(135deg, ${BACKGROUNDS[id].from}, ${BACKGROUNDS[id].to})`,
                  }}
                  className={`aspect-square rounded ${
                    look.background === id ? "ring-2 ring-accent ring-offset-2 ring-offset-paper-2" : ""
                  }`}
                  onClick={() => onLook({ background: id })}
                />
              ))}
            </div>
            <Slider
              label="余白"
              value={look.paddingPct}
              min={0}
              max={20}
              step={1}
              unit="%"
              onChange={(paddingPct) => onLook({ paddingPct })}
            />
            <Slider
              label="角丸"
              value={look.radiusPct}
              min={0}
              max={6}
              step={0.5}
              unit="%"
              onChange={(radiusPct) => onLook({ radiusPct })}
            />
            <label className="flex items-center justify-between text-sm text-ink-2">
              影
              <input
                type="checkbox"
                className="size-4 accent-accent"
                checked={look.shadow}
                onChange={(event) => onLook({ shadow: event.target.checked })}
              />
            </label>
          </>
        )}
      </section>

      {zoom && (
        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">ズーム</h2>
            <button
              type="button"
              className="rounded px-2 py-1 text-sm text-danger hover:bg-paper-3"
              onClick={onZoomRemove}
            >
              削除
            </button>
          </div>
          <button
            type="button"
            aria-label="ズームの中心を指定"
            className="relative aspect-video w-full cursor-crosshair rounded bg-paper-3"
            onClick={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              onZoom({
                focusX: (event.clientX - rect.left) / rect.width,
                focusY: (event.clientY - rect.top) / rect.height,
              });
            }}
          >
            <span
              aria-hidden
              style={{ left: `${zoom.focusX * 100}%`, top: `${zoom.focusY * 100}%` }}
              className="absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent"
            />
          </button>
          <p className="text-xs text-ink-2">枠内をクリックして、拡大する位置を指定します。</p>
          <Slider
            label="倍率"
            value={zoom.depth}
            min={1.1}
            max={4}
            step={0.1}
            unit="×"
            onChange={(depth) => onZoom({ depth })}
          />
          <Slider
            label="長さ"
            value={zoom.sourceEndSec - zoom.sourceStartSec}
            min={0.3}
            max={10}
            step={0.1}
            unit="秒"
            onChange={onZoomLength}
          />
        </section>
      )}
    </aside>
  );
}
