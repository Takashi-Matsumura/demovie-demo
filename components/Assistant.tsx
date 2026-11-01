"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { interpret } from "@/lib/assistant";
import { applyCommands, type CommandResult } from "@/lib/commands";
import type { DemoDocument } from "@/lib/document";
import { classifyIntent } from "@/lib/intent";
import { startRecording, toWav, transcribe, type VoiceRecording } from "@/lib/speech";

type Phase = "idle" | "recording" | "transcribing" | "classifying" | "thinking";

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
};

type AssistantProps = {
  doc: DemoDocument;
  timeSec: number;
  disabled: boolean;
  onListen: () => void;
  onApply: (result: Extract<CommandResult, { kind: "applied" }>) => void;
  onUndo: () => void;
};

export function Assistant({ doc, timeSec, disabled, onListen, onApply, onUndo }: AssistantProps) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [reply, setReply] = useState<Reply | null>(null);
  const [text, setText] = useState("");
  const [applied, setApplied] = useState(false);
  const recordingRef = useRef<Promise<VoiceRecording> | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const questionRef = useRef<string | null>(null);
  // 非同期の処理が終わった時点の最新の状態で操作を適用する。
  const latestRef = useRef({ doc, timeSec });

  useEffect(() => {
    latestRef.current = { doc, timeSec };
  }, [doc, timeSec]);

  const run = useCallback(
    async (transcript: string, startSec: number, signal: AbortSignal) => {
      setPhase("thinking");
      const commands = await interpret({
        transcript,
        doc: latestRef.current.doc,
        timeSec: startSec,
        previousQuestion: questionRef.current,
        signal,
      });
      const result = applyCommands(latestRef.current.doc, commands, startSec);
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
    [onApply, onUndo],
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

  const startListening = useCallback(() => {
    if (recordingRef.current || disabled) return;
    onListen();
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
  }, [disabled, onListen]);

  const stopListening = useCallback(() => {
    const started = recordingRef.current;
    if (!started) return;
    recordingRef.current = null;
    const startSec = latestRef.current.timeSec;
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
  }, [handle, run]);

  useEffect(() => {
    const isEditing = (target: EventTarget | null) =>
      target instanceof HTMLElement && target.closest("input, textarea") !== null;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== "KeyV" || event.repeat || event.metaKey || event.ctrlKey) return;
      if (isEditing(event.target)) return;
      event.preventDefault();
      startListening();
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === "KeyV") stopListening();
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      controllerRef.current?.abort();
    };
  }, [startListening, stopListening]);

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
        <button
          type="button"
          aria-pressed={phase === "recording"}
          disabled={disabled || (busy && phase !== "recording")}
          className={`touch-none rounded-md px-3 py-1.5 text-sm font-medium whitespace-nowrap select-none disabled:cursor-not-allowed disabled:opacity-50 ${
            phase === "recording" ? "bg-danger text-paper" : "bg-accent text-accent-ink"
          }`}
          onPointerDown={startListening}
          onPointerUp={stopListening}
          onPointerCancel={stopListening}
          onPointerLeave={stopListening}
        >
          押して話す（V）
        </button>
        <input
          aria-label="AI への指示を入力"
          className="min-w-40 flex-1 rounded bg-paper-3 px-2 py-1.5 text-sm"
          placeholder="例: ここの説明を短くして"
          value={text}
          disabled={disabled || busy}
          onChange={(event) => setText(event.target.value)}
        />
      </form>

      {phase !== "idle" && (
        <p aria-live="polite" className="text-sm text-ink-2">
          {PHASE_LABEL[phase]}
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
          {reply.tone === "done" && applied && (
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
