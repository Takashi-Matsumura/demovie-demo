"use client";

import { useEffect, useRef } from "react";
import { DEFAULT_CHAPTER_SEC, type Chapter, type DemoDocument } from "@/lib/document";
import { canExclude, stepSpans } from "@/lib/timeline";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  ChapterIcon,
  CloseIcon,
  EyeIcon,
  EyeOffIcon,
  IconButton,
  SpeakerIcon,
  TrashIcon,
} from "./IconButton";

type StepsProps = {
  doc: DemoDocument;
  selectedClipId: string;
  thumbnailOf: (clip: { sourceStartSec: number; sourceEndSec: number }) => string | undefined;
  onPurpose: (purpose: string) => void;
  onSelect: (clipId: string) => void;
  onText: (clipId: string, text: string) => void;
  onSpeak: (text: string) => void;
  onMove: (clipId: string, delta: -1 | 1) => void;
  onInclude: (clipId: string, included: boolean) => void;
  onChapter: (clipId: string, chapter: Chapter | null) => void;
  onDelete: (clipId: string) => void;
};

export function Steps({
  doc,
  selectedClipId,
  thumbnailOf,
  onPurpose,
  onSelect,
  onText,
  onSpeak,
  onMove,
  onInclude,
  onChapter,
  onDelete,
}: StepsProps) {
  const steps = stepSpans(doc);
  const listRef = useRef<HTMLOListElement>(null);

  // 再生バーや再生で選ぶ手順が変わったとき、一覧でもその手順が見えるようにする。
  useEffect(() => {
    listRef.current
      ?.querySelector('[aria-current="step"]')
      ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selectedClipId]);
  const excluded = steps.filter((step) => !step.included);
  const excludedSec = excluded.reduce(
    (total, step) => total + step.chapterSec + step.durationSec,
    0,
  );

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
        <h2 className="flex flex-wrap items-baseline gap-x-2 text-sm font-semibold">
          手順（{steps.length}）
          {excluded.length > 0 && (
            <span className="text-xs font-normal text-ink-2">
              {excluded.length} 件を含めない（−{excludedSec.toFixed(1)}秒）
            </span>
          )}
        </h2>
        <ol ref={listRef} className="flex flex-col gap-2 overflow-y-auto lg:max-h-[calc(100dvh-16rem)]">
          {steps.map(({ clip, caption, durationSec, included }, index) => (
            // カードのどこを押しても選べるようにする。ボタンと入力欄は自分の操作を優先し、
            // キーボードでは「手順 n へ移動」ボタンで選ぶ。
            <li
              key={clip.id}
              aria-current={clip.id === selectedClipId ? "step" : undefined}
              className={`flex cursor-pointer flex-col gap-1 rounded p-2 ring-inset ${
                included ? "bg-paper-3" : "border border-dashed border-rule bg-paper-2"
              } ${clip.id === selectedClipId ? "ring-2 ring-accent" : ""}`}
              onClick={(event) => {
                const target = event.target as HTMLElement;
                if (target.closest("button, textarea, input, select")) return;
                onSelect(clip.id);
              }}
            >
              {clip.chapter && (
                <ChapterEditor
                  number={index + 1}
                  chapter={clip.chapter}
                  onFocus={() => onSelect(clip.id)}
                  onChange={(chapter) => onChapter(clip.id, chapter)}
                />
              )}
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  aria-label={`手順 ${index + 1} へ移動`}
                  className="mr-auto rounded px-1 font-mono text-xs text-ink-2 tabular-nums hover:bg-rule"
                  onClick={() => onSelect(clip.id)}
                >
                  {index + 1} · {durationSec.toFixed(1)}秒
                  {!included && <span className="ml-1.5 font-sans">含めない</span>}
                </button>
                {included && doc.narration.enabled && caption?.text.trim() && (
                  <IconButton
                    label={`手順 ${index + 1} を試聴`}
                    tone="quiet"
                    size="sm"
                    onClick={() => onSpeak(caption.text)}
                  >
                    <SpeakerIcon className="size-3.5" />
                  </IconButton>
                )}
                {!clip.chapter && (
                  <IconButton
                    label={`手順 ${index + 1} の前にカテゴリ画面を入れる`}
                    tone="quiet"
                    size="sm"
                    onClick={() => {
                      onChapter(clip.id, { title: "", note: "", durationSec: DEFAULT_CHAPTER_SEC });
                      onSelect(clip.id);
                    }}
                  >
                    <ChapterIcon className="size-3.5" />
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
                {/* 消す前に仕上がりを確かめられるよう、まず外す。削除は外した手順にだけ出す。
                    続けて切り替えられるよう、目のアイコンは常に右端に置く。 */}
                {!included && (
                  <IconButton
                    label={`手順 ${index + 1} を映像ごと削除`}
                    align="end"
                    tone="quiet"
                    size="sm"
                    onClick={() => onDelete(clip.id)}
                  >
                    <TrashIcon className="size-3.5" />
                  </IconButton>
                )}
                <IconButton
                  label={`手順 ${index + 1} を動画に${included ? "含めない" : "含める"}`}
                  align="end"
                  tone="quiet"
                  size="sm"
                  aria-pressed={!included}
                  disabled={included && !canExclude(doc, clip.id)}
                  onClick={() => onInclude(clip.id, !included)}
                >
                  {included ? (
                    <EyeIcon className="size-3.5" />
                  ) : (
                    <EyeOffIcon className="size-3.5" />
                  )}
                </IconButton>
              </div>
              <div className={`flex gap-2 ${included ? "" : "opacity-50"}`}>
                <button
                  type="button"
                  aria-label={`手順 ${index + 1} の画面へ移動`}
                  className="aspect-video w-20 shrink-0 self-start overflow-hidden rounded bg-paper-2"
                  onClick={() => onSelect(clip.id)}
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
                    if (clip.id !== selectedClipId) onSelect(clip.id);
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

const CHAPTER_SEC_OPTIONS = [2, 3, 5, 7, 10];

type ChapterEditorProps = {
  number: number;
  chapter: Chapter;
  onFocus: () => void;
  onChange: (chapter: Chapter | null) => void;
};

// 手順の前に差し込むカテゴリ画面の中身。手順のカードの上に見出しとして置く。
function ChapterEditor({ number, chapter, onFocus, onChange }: ChapterEditorProps) {
  const options = CHAPTER_SEC_OPTIONS.includes(chapter.durationSec)
    ? CHAPTER_SEC_OPTIONS
    : [...CHAPTER_SEC_OPTIONS, chapter.durationSec].sort((a, b) => a - b);
  return (
    <div className="mb-1 flex flex-col gap-1.5 rounded border-l-4 border-accent bg-zoom/40 p-2">
      <div className="flex items-center gap-1.5">
        <ChapterIcon className="size-3.5 text-accent" />
        <span className="mr-auto text-xs font-semibold">カテゴリ画面</span>
        <select
          aria-label={`手順 ${number} の前のカテゴリ画面の表示時間`}
          className="rounded bg-paper-2 px-1 py-0.5 text-xs"
          value={chapter.durationSec}
          onFocus={onFocus}
          onChange={(event) => onChange({ ...chapter, durationSec: Number(event.target.value) })}
        >
          {options.map((sec) => (
            <option key={sec} value={sec}>
              {sec}秒
            </option>
          ))}
        </select>
        <IconButton
          label={`手順 ${number} の前のカテゴリ画面を外す`}
          align="end"
          tone="quiet"
          size="sm"
          onClick={() => onChange(null)}
        >
          <CloseIcon className="size-3.5" />
        </IconButton>
      </div>
      <input
        aria-label={`手順 ${number} の前のカテゴリ名`}
        className="rounded bg-paper-2 px-2 py-1 text-sm font-semibold"
        placeholder="カテゴリ名（例: 初期設定）"
        value={chapter.title}
        onFocus={onFocus}
        onChange={(event) => onChange({ ...chapter, title: event.target.value })}
      />
      <input
        aria-label={`手順 ${number} の前のカテゴリの補足`}
        className="rounded bg-paper-2 px-2 py-1 text-xs"
        placeholder="補足（任意）"
        value={chapter.note}
        onFocus={onFocus}
        onChange={(event) => onChange({ ...chapter, note: event.target.value })}
      />
    </div>
  );
}
