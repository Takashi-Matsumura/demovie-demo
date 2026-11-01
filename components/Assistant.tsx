"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { interpret, tidyNarration } from "@/lib/assistant";
import { applyCommands, type CommandResult, type ResolvedCommand } from "@/lib/commands";
import { newId, type DemoDocument } from "@/lib/document";
import { classifyIntent } from "@/lib/intent";
import { resolveTargets } from "@/lib/locate";
import { applyReview, timelineAt } from "@/lib/review";
import { startRecording, toWav, transcribe, type VoiceRecording } from "@/lib/speech";
import { locate } from "@/lib/timeline";
import { ReviewPanel, type ReviewItem, type ReviewStage } from "./ReviewPanel";

type Phase = "idle" | "recording" | "transcribing" | "classifying" | "thinking" | "tidying";

type Mode = "instruct" | "dictate";

type Reply = {
  heard: string;
  tone: "done" | "question" | "failed" | "ignored";
  message: string;
  startSec?: number;
};

const PHASE_LABEL: Record<Exclude<Phase, "idle">, string> = {
  recording: "聞いています…",
  transcribing: "文字にしています…",
  classifying: "指示かどうかを確認しています…",
  thinking: "AI が操作を考えています…",
  tidying: "説明文に整えています…",
};

const KEY_MODES: Record<string, Mode> = { KeyV: "instruct", KeyC: "dictate" };

type AssistantProps = {
  doc: DemoDocument;
  src: string;
  timeSec: number;
  glossary: string;
  disabled: boolean;
  onListen: () => void;
  onApply: (result: Extract<CommandResult, { kind: "applied" }>) => void;
  onUndo: () => void;
  onStartReview: () => void;
};

export function Assistant({
  doc,
  src,
  timeSec,
  glossary,
  disabled,
  onListen,
  onApply,
  onUndo,
  onStartReview,
}: AssistantProps) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [reply, setReply] = useState<Reply | null>(null);
  const [text, setText] = useState("");
  const [applied, setApplied] = useState(false);
  const [mode, setMode] = useState<Mode>("instruct");
  const [reviewStage, setReviewStage] = useState<ReviewStage | null>(null);
  const [reviewItems, setReviewItems] = useState<ReviewItem[]>([]);
  const reviewStageRef = useRef<ReviewStage | null>(null);
  const reviewItemsRef = useRef<ReviewItem[]>([]);
  const reviewCommandsRef = useRef(new Map<string, ResolvedCommand[]>());
  const reviewPendingRef = useRef<Promise<void>[]>([]);
  const reviewControllerRef = useRef<AbortController | null>(null);
  const recordingRef = useRef<Promise<VoiceRecording> | null>(null);
  const modeRef = useRef<Mode>("instruct");
  const startSecRef = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);
  const questionRef = useRef<string | null>(null);
  // 非同期の処理が終わった時点の最新の状態で操作を適用する。
  const latestRef = useRef({ doc, timeSec, glossary });

  useEffect(() => {
    latestRef.current = { doc, timeSec, glossary };
  }, [doc, timeSec, glossary]);

  const run = useCallback(
    async (transcript: string, startSec: number, signal: AbortSignal) => {
      setPhase("thinking");
      const commands = await interpret({
        transcript,
        glossary: latestRef.current.glossary,
        doc: latestRef.current.doc,
        timeSec: startSec,
        previousQuestion: questionRef.current,
        signal,
      });
      const { doc: current } = latestRef.current;
      const { sourceSec } = locate(current, startSec);
      const resolved = await resolveTargets(commands, src, sourceSec, signal);
      const result = applyCommands(current, resolved, startSec);
      questionRef.current = result.kind === "question" ? result.question : null;
      setApplied(result.kind === "applied");

      if (result.kind === "applied") {
        onApply(result);
        setReply({ heard: transcript, tone: "done", message: result.message });
      } else if (result.kind === "undo") {
        onUndo();
        setReply({ heard: transcript, tone: "done", message: "直前の操作を元に戻しました。" });
      } else if (result.kind === "question") {
        setReply({ heard: transcript, tone: "question", message: result.question });
      } else {
        setReply({ heard: transcript, tone: "failed", message: result.message });
      }
    },
    [onApply, onUndo, src],
  );

  const handle = useCallback(async (work: (signal: AbortSignal) => Promise<void>) => {
    const controller = new AbortController();
    controllerRef.current = controller;
    try {
      await work(controller.signal);
    } catch (cause) {
      if (!controller.signal.aborted) {
        const message = cause instanceof Error ? cause.message : "予期しないエラーが発生しました。";
        setApplied(false);
        setReply({ heard: "", tone: "failed", message });
      }
    } finally {
      setPhase("idle");
    }
  }, []);

  // 説明文は見ながら話せるよう再生を止めず、話し始めた時点の手順に入れる。
  const updateReviewItems = useCallback((change: (items: ReviewItem[]) => ReviewItem[]) => {
    reviewItemsRef.current = change(reviewItemsRef.current);
    setReviewItems(reviewItemsRef.current);
  }, []);

  const setStage = useCallback((stage: ReviewStage | null) => {
    reviewStageRef.current = stage;
    setReviewStage(stage);
  }, []);

  const captureReviewItem = useCallback(
    async (id: string, started: Promise<VoiceRecording>, signal: AbortSignal) => {
      const patch = (values: Partial<ReviewItem>) =>
        updateReviewItems((items) =>
          items.map((item) => (item.id === id ? { ...item, ...values } : item)),
        );
      try {
        const recording = await started;
        const transcript = await transcribe(await toWav(await recording.stop()), signal);
        if (!transcript) {
          updateReviewItems((items) => items.filter((item) => item.id !== id));
          return;
        }
        patch({ transcript });
        patch({ state: await classifyIntent(transcript, signal) });
      } catch {
        if (!signal.aborted) patch({ state: "failed", summary: "聞き取れませんでした。" });
      }
    },
    [updateReviewItems],
  );

  const startListening = useCallback(
    (nextMode: Mode) => {
    if (recordingRef.current || disabled) return;
    if (nextMode === "instruct" && reviewStageRef.current === "listening") {
      // 通しの確認では再生を止めない。
    } else if (reviewStageRef.current) {
      return;
    } else if (nextMode === "instruct") {
      onListen();
    }
    modeRef.current = nextMode;
    setMode(nextMode);
    startSecRef.current = latestRef.current.timeSec;
    setPhase("recording");
    setReply(null);
    const started = startRecording();
    recordingRef.current = started;
    started.catch((cause: unknown) => {
      recordingRef.current = null;
      setPhase("idle");
      const denied = cause instanceof DOMException && cause.name === "NotAllowedError";
      setReply({
        heard: "",
        tone: "failed",
        message: denied
          ? "マイクの使用が許可されていません。ブラウザの設定を確認してください。"
          : "マイクを開始できませんでした。",
      });
    });
    },
    [disabled, onListen],
  );

  const stopListening = useCallback(() => {
    const started = recordingRef.current;
    if (!started) return;
    recordingRef.current = null;
    const startSec = startSecRef.current;
    const dictating = modeRef.current === "dictate";
    if (reviewStageRef.current === "listening" && reviewControllerRef.current) {
      const { doc: current } = latestRef.current;
      const { index, sourceSec } = locate(current, startSec);
      const item: ReviewItem = {
        id: newId(),
        sourceSec,
        label: `手順 ${index + 1}`,
        state: "listening",
        transcript: "",
        summary: "",
        selected: false,
        applicable: false,
      };
      updateReviewItems((items) => [...items, item]);
      setPhase("idle");
      reviewPendingRef.current.push(
        captureReviewItem(item.id, started, reviewControllerRef.current.signal),
      );
      return;
    }
    void handle(async (signal) => {
      const recording = await started;
      setPhase("transcribing");
      const blob = await recording.stop();
      const transcript = await transcribe(await toWav(blob), signal).catch((cause: unknown) => {
        if (signal.aborted) throw cause;
        throw cause instanceof Error && cause.message.includes("サーバ")
          ? cause
          : new Error("音声を聞き取れませんでした。もう少し長く話してください。");
      });
      if (!transcript) throw new Error("音声を聞き取れませんでした。もう一度話してください。");
      if (dictating) {
        setPhase("tidying");
        const narration = await tidyNarration(transcript, latestRef.current.glossary, signal);
        const { doc: current } = latestRef.current;
        const step = locate(current, startSec).index + 1;
        const result = applyCommands(
          current,
          [{ type: "set_step_text", step, text: narration }],
          startSec,
        );
        if (result.kind === "applied") onApply(result);
        setApplied(result.kind === "applied");
        setReply({
          heard: transcript,
          tone: result.kind === "applied" ? "done" : "failed",
          message:
            result.kind === "applied"
              ? `手順 ${step} の説明文を入れました。`
              : "説明文を入れられませんでした。",
        });
        return;
      }
      // 聞き返しへの返事は「はい」のように短く、単独では指示に見えないので判定しない。
      if (!questionRef.current) {
        setPhase("classifying");
        if ((await classifyIntent(transcript, signal)) === "chatter") {
          setApplied(false);
          setReply({
            heard: transcript,
            tone: "ignored",
            message: "指示ではないと判断しました。",
            startSec,
          });
          return;
        }
      }
      await run(transcript, startSec, signal);
    });
  }, [captureReviewItem, handle, onApply, run, updateReviewItems]);

  const beginReview = () => {
    reviewControllerRef.current = new AbortController();
    reviewPendingRef.current = [];
    reviewCommandsRef.current = new Map();
    updateReviewItems(() => []);
    setReply(null);
    setStage("listening");
    onStartReview();
  };

  const closeReview = () => {
    reviewControllerRef.current?.abort();
    reviewControllerRef.current = null;
    updateReviewItems(() => []);
    setStage(null);
  };

  // 手順番号が変わらないよう、指示は確認を終えてからまとめて解釈し、適用まで編集には触れない。
  const finishReview = async () => {
    const signal = reviewControllerRef.current?.signal;
    if (!signal) return;
    onListen();
    setStage("interpreting");
    await Promise.all(reviewPendingRef.current);
    const { doc: current } = latestRef.current;

    for (const item of reviewItemsRef.current) {
      if (signal.aborted) return;
      if (item.state !== "instruction" && item.state !== "chatter") continue;
      const patch = (values: Partial<ReviewItem>) =>
        updateReviewItems((items) =>
          items.map((other) => (other.id === item.id ? { ...other, ...values } : other)),
        );
      const itemSec = timelineAt(current, item.sourceSec) ?? 0;
      try {
        const commands = await interpret({
          transcript: item.transcript,
          glossary: latestRef.current.glossary,
          doc: current,
          timeSec: itemSec,
          previousQuestion: null,
          signal,
        });
        const resolved = await resolveTargets(commands, src, item.sourceSec, signal);
        const result = applyCommands(current, resolved, itemSec);
        if (result.kind === "applied") {
          reviewCommandsRef.current.set(item.id, resolved);
          patch({
            summary: result.message,
            applicable: true,
            selected: item.state === "instruction",
          });
        } else if (result.kind === "undo") {
          patch({ summary: "「元に戻す」は通しの確認では実行できません。" });
        } else {
          patch({ summary: result.kind === "question" ? result.question : result.message });
        }
      } catch (cause) {
        if (signal.aborted) return;
        patch({ summary: cause instanceof Error ? cause.message : "解釈できませんでした。" });
      }
    }
    setStage("ready");
  };

  const applySelected = () => {
    const plans = reviewItemsRef.current.flatMap((item) => {
      const commands = reviewCommandsRef.current.get(item.id);
      return item.selected && commands ? [{ commands, sourceSec: item.sourceSec }] : [];
    });
    const { doc: next, done, failed } = applyReview(latestRef.current.doc, plans);
    onApply({ kind: "applied", doc: next, message: done.join(" ") });
    setApplied(done.length > 0);
    setReply({
      heard: "",
      tone: failed.length > 0 ? "failed" : "done",
      message: [`${done.length} 件を適用しました。`, ...failed].join(" "),
    });
    closeReview();
  };

  useEffect(() => {
    const isEditing = (target: EventTarget | null) =>
      target instanceof HTMLElement && target.closest("input, textarea") !== null;
    const onKeyDown = (event: KeyboardEvent) => {
      const nextMode = KEY_MODES[event.code];
      if (!nextMode || event.repeat || event.metaKey || event.ctrlKey) return;
      if (isEditing(event.target)) return;
      event.preventDefault();
      startListening(nextMode);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (KEY_MODES[event.code]) stopListening();
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [startListening, stopListening]);

  // 上の effect は再生中のコマごとに作り直されるので、中止は画面を閉じるときだけに分ける。
  useEffect(
    () => () => {
      controllerRef.current?.abort();
      reviewControllerRef.current?.abort();
    },
    [],
  );

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const transcript = text.trim();
    if (!transcript || phase !== "idle") return;
    setText("");
    setReply(null);
    const startSec = latestRef.current.timeSec;
    void handle((signal) => run(transcript, startSec, signal));
  };

  const busy = phase !== "idle";

  return (
    <section aria-label="AI への指示" className="flex flex-col gap-2 rounded-lg bg-paper-2 p-3">
      <form onSubmit={submit} className="flex flex-wrap items-center gap-2">
        {(["instruct", "dictate"] as const).map((item) => {
          const active = phase === "recording" && mode === item;
          return (
            <button
              key={item}
              type="button"
              aria-pressed={active}
              disabled={disabled || (busy && !active)}
              className={`touch-none rounded-md px-3 py-1.5 text-sm font-medium whitespace-nowrap select-none disabled:cursor-not-allowed disabled:opacity-50 ${
                active
                  ? "bg-danger text-paper"
                  : item === "instruct"
                    ? "bg-accent text-accent-ink"
                    : "bg-paper-3 text-ink"
              }`}
              onPointerDown={() => startListening(item)}
              onPointerUp={stopListening}
              onPointerCancel={stopListening}
              onPointerLeave={stopListening}
            >
              {item === "instruct" ? "押して指示（V）" : "説明文を話す（C）"}
            </button>
          );
        })}
        <input
          aria-label="AI への指示を入力"
          className="min-w-40 flex-1 rounded bg-paper-3 px-2 py-1.5 text-sm"
          placeholder="例: ここの説明を短くして"
          value={text}
          disabled={disabled || busy || reviewStage !== null}
          onChange={(event) => setText(event.target.value)}
        />
        {!reviewStage && (
          <button
            type="button"
            disabled={disabled || busy}
            className="rounded-md bg-paper-3 px-3 py-1.5 text-sm whitespace-nowrap hover:bg-rule disabled:cursor-not-allowed disabled:opacity-50"
            onClick={beginReview}
          >
            通しで確認
          </button>
        )}
      </form>

      {reviewStage && (
        <ReviewPanel
          stage={reviewStage}
          items={reviewItems}
          onToggle={(id) =>
            updateReviewItems((items) =>
              items.map((item) =>
                item.id === id ? { ...item, selected: !item.selected } : item,
              ),
            )
          }
          onFinish={() => void finishReview()}
          onApply={applySelected}
          onCancel={closeReview}
        />
      )}

      {phase !== "idle" && (
        <p aria-live="polite" className="text-sm text-ink-2">
          {phase === "recording" && mode === "dictate"
            ? "説明を聞いています。再生はそのまま続きます…"
            : PHASE_LABEL[phase]}
        </p>
      )}
      {phase === "idle" && reply && (
        <div
          role={reply.tone === "failed" ? "alert" : "status"}
          className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm"
        >
          {reply.heard && <span className="text-ink-2">「{reply.heard}」</span>}
          <span className={reply.tone === "failed" ? "text-danger" : "text-ink"}>
            {reply.message}
          </span>
          {reply.tone === "ignored" && (
            <button
              type="button"
              className="text-accent underline"
              onClick={() => {
                const { heard, startSec = latestRef.current.timeSec } = reply;
                setReply(null);
                void handle((signal) => run(heard, startSec, signal));
              }}
            >
              指示として実行
            </button>
          )}
          {applied && reply.tone !== "ignored" && reply.tone !== "question" && (
            <button
              type="button"
              className="text-accent underline"
              onClick={() => {
                onUndo();
                setReply(null);
              }}
            >
              元に戻す
            </button>
          )}
        </div>
      )}
    </section>
  );
}
