"use client";

export type ReviewItem = {
  id: string;
  sourceSec: number;
  label: string;
  state: "listening" | "instruction" | "chatter" | "failed";
  transcript: string;
  summary: string;
  selected: boolean;
  applicable: boolean;
};

export type ReviewStage = "listening" | "interpreting" | "ready";

type ReviewPanelProps = {
  stage: ReviewStage;
  items: ReviewItem[];
  onToggle: (id: string) => void;
  onFinish: () => void;
  onApply: () => void;
  onCancel: () => void;
};

const BUTTON = "rounded-md bg-paper-3 px-3 py-1.5 text-sm whitespace-nowrap hover:bg-rule";

export function ReviewPanel({
  stage,
  items,
  onToggle,
  onFinish,
  onApply,
  onCancel,
}: ReviewPanelProps) {
  const selected = items.filter((item) => item.selected).length;

  return (
    <section aria-label="通しの確認" className="flex flex-col gap-2 rounded-lg bg-paper-3 p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <p className="mr-auto" aria-live="polite">
          {stage === "listening" && `再生しながら V を押して指示してください（${items.length} 件）`}
          {stage === "interpreting" && "指示をまとめて解釈しています…"}
          {stage === "ready" && "適用する指示を選んでください"}
        </p>
        {stage === "listening" && (
          <button type="button" className={BUTTON} onClick={onFinish}>
            確認を終える
          </button>
        )}
        {stage === "ready" && (
          <button
            type="button"
            disabled={selected === 0}
            className="rounded-md bg-accent px-3 py-1.5 font-medium whitespace-nowrap text-accent-ink disabled:cursor-not-allowed disabled:opacity-50"
            onClick={onApply}
          >
            {selected} 件を適用
          </button>
        )}
        <button type="button" className={BUTTON} onClick={onCancel}>
          破棄
        </button>
      </div>

      {items.length > 0 && (
        <ul className="flex flex-col gap-1">
          {items.map((item) => (
            <li key={item.id}>
              <label className="flex items-start gap-2 rounded bg-paper-2 p-2">
                <input
                  type="checkbox"
                  className="mt-0.5 size-4 accent-accent"
                  aria-label={`${item.label} の指示を適用`}
                  checked={item.selected}
                  disabled={stage !== "ready" || !item.applicable}
                  onChange={() => onToggle(item.id)}
                />
                <span className="flex min-w-0 flex-col">
                  <span className="text-ink-2">
                    {item.label}
                    {item.transcript ? `「${item.transcript}」` : "（聞き取り中…）"}
                  </span>
                  {item.state === "chatter" && (
                    <span className="text-ink-2">独り言と判断しました。適用するなら選んでください。</span>
                  )}
                  {item.summary && <span>{item.summary}</span>}
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
