"use client";

import type { DemoDocument } from "@/lib/document";
import { stepSpans } from "@/lib/timeline";

type StepsProps = {
  doc: DemoDocument;
  currentClipId: string;
  onPurpose: (purpose: string) => void;
  onSelect: (startSec: number) => void;
  onText: (clipId: string, text: string) => void;
  onMove: (clipId: string, delta: -1 | 1) => void;
  onDelete: (clipId: string) => void;
};

const ICON_BUTTON =
  "rounded px-2 py-1 text-xs text-ink-2 hover:bg-rule disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent";

export function Steps({
  doc,
  currentClipId,
  onPurpose,
  onSelect,
  onText,
  onMove,
  onDelete,
}: StepsProps) {
  const steps = stepSpans(doc);

  return (
    <aside className="flex min-h-0 flex-col gap-4 rounded-lg bg-paper-2 p-4">
      <label className="flex flex-col gap-1.5 text-sm font-semibold">
        何を説明する動画ですか？
        <textarea
          rows={2}
          className="w-full resize-none rounded bg-paper-3 p-2 text-sm font-normal"
          placeholder="例: 経費精算システムの申請手順"
          value={doc.purpose}
          onChange={(event) => onPurpose(event.target.value)}
        />
      </label>

      <section className="flex min-h-0 flex-col gap-2">
        <h2 className="text-sm font-semibold">手順（{steps.length}）</h2>
        <ol className="flex flex-col gap-2 overflow-y-auto lg:max-h-[calc(100dvh-16rem)]">
          {steps.map(({ clip, caption, startSec, endSec }, index) => (
            <li
              key={clip.id}
              aria-current={clip.id === currentClipId ? "step" : undefined}
              className={`flex flex-col gap-1 rounded bg-paper-3 p-2 ring-inset ${
                clip.id === currentClipId ? "ring-2 ring-accent" : ""
              }`}
            >
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  aria-label={`手順 ${index + 1} へ移動`}
                  className="mr-auto rounded px-1 font-mono text-xs text-ink-2 tabular-nums hover:bg-rule"
                  onClick={() => onSelect(startSec)}
                >
                  {index + 1} · {(endSec - startSec).toFixed(1)}秒
                </button>
                <button
                  type="button"
                  aria-label={`手順 ${index + 1} を前へ移動`}
                  className={ICON_BUTTON}
                  disabled={index === 0}
                  onClick={() => onMove(clip.id, -1)}
                >
                  ↑
                </button>
                <button
                  type="button"
                  aria-label={`手順 ${index + 1} を後ろへ移動`}
                  className={ICON_BUTTON}
                  disabled={index === steps.length - 1}
                  onClick={() => onMove(clip.id, 1)}
                >
                  ↓
                </button>
                <button
                  type="button"
                  aria-label={`手順 ${index + 1} を映像ごと削除`}
                  className={ICON_BUTTON}
                  disabled={steps.length < 2}
                  onClick={() => onDelete(clip.id)}
                >
                  削除
                </button>
              </div>
              <textarea
                aria-label={`手順 ${index + 1} の説明文`}
                rows={2}
                className="w-full resize-none rounded bg-paper-2 p-2 text-sm"
                placeholder="説明文を入力"
                value={caption?.text ?? ""}
                onFocus={() => {
                  if (clip.id !== currentClipId) onSelect(startSec);
                }}
                onChange={(event) => onText(clip.id, event.target.value)}
              />
            </li>
          ))}
        </ol>
      </section>
    </aside>
  );
}
