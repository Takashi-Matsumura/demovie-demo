"use client";

import type { DemoDocument } from "@/lib/document";
import { stepSpans } from "@/lib/timeline";
import { ArrowDownIcon, ArrowUpIcon, IconButton, SpeakerIcon, TrashIcon } from "./IconButton";

type StepsProps = {
  doc: DemoDocument;
  currentClipId: string;
  thumbnailOf: (clip: { sourceStartSec: number; sourceEndSec: number }) => string | undefined;
  onPurpose: (purpose: string) => void;
  onSelect: (startSec: number) => void;
  onText: (clipId: string, text: string) => void;
  onSpeak: (text: string) => void;
  onMove: (clipId: string, delta: -1 | 1) => void;
  onDelete: (clipId: string) => void;
};

export function Steps({
  doc,
  currentClipId,
  thumbnailOf,
  onPurpose,
  onSelect,
  onText,
  onSpeak,
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
                {doc.narration.enabled && caption?.text.trim() && (
                  <IconButton
                    label={`手順 ${index + 1} を試聴`}
                    tone="quiet"
                    size="sm"
                    onClick={() => onSpeak(caption.text)}
                  >
                    <SpeakerIcon className="size-3.5" />
                  </IconButton>
                )}
                <IconButton
                  label={`手順 ${index + 1} を前へ移動`}
                  tone="quiet"
                  size="sm"
                  disabled={index === 0}
                  onClick={() => onMove(clip.id, -1)}
                >
                  <ArrowUpIcon className="size-3.5" />
                </IconButton>
                <IconButton
                  label={`手順 ${index + 1} を後ろへ移動`}
                  tone="quiet"
                  size="sm"
                  disabled={index === steps.length - 1}
                  onClick={() => onMove(clip.id, 1)}
                >
                  <ArrowDownIcon className="size-3.5" />
                </IconButton>
                <IconButton
                  label={`手順 ${index + 1} を映像ごと削除`}
                  align="end"
                  tone="quiet"
                  size="sm"
                  disabled={steps.length < 2}
                  onClick={() => onDelete(clip.id)}
                >
                  <TrashIcon className="size-3.5" />
                </IconButton>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  aria-label={`手順 ${index + 1} の画面へ移動`}
                  className="aspect-video w-20 shrink-0 self-start overflow-hidden rounded bg-paper-2"
                  onClick={() => onSelect(startSec)}
                >
                  {thumbnailOf(clip) && (
                    // 生成した data URL なので next/image の最適化は使えない。
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={thumbnailOf(clip)} alt="" className="size-full object-cover" />
                  )}
                </button>
                <textarea
                  aria-label={`手順 ${index + 1} の説明文`}
                  rows={2}
                  className="min-w-0 flex-1 resize-none rounded bg-paper-2 p-2 text-sm"
                  placeholder="説明文を入力"
                  value={caption?.text ?? ""}
                  onFocus={() => {
                    if (clip.id !== currentClipId) onSelect(startSec);
                  }}
                  onChange={(event) => onText(clip.id, event.target.value)}
                />
              </div>
            </li>
          ))}
        </ol>
      </section>
    </aside>
  );
}
