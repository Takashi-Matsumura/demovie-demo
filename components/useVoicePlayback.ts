"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import type { DemoDocument } from "@/lib/document";
import { applyReadings } from "@/lib/glossary";
import { narratedSteps, synthesize } from "@/lib/narration";
import { stepSpans } from "@/lib/timeline";

export type VoicePlayback = {
  active: () => boolean;
  speaking: () => boolean;
  start: (clipId: string) => void;
  stop: () => void;
};

// ナレーション付きの再生で、手順に入ったら説明文を読み上げる。
export function useVoicePlayback(
  doc: DemoDocument,
  glossary: string,
  videoRef: RefObject<HTMLVideoElement | null>,
) {
  const [error, setError] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const latestRef = useRef({ doc, glossary });
  const contextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const activeRef = useRef(false);
  const speakingRef = useRef(false);
  const requestRef = useRef(0);

  useEffect(() => {
    latestRef.current = { doc, glossary };
  }, [doc, glossary]);

  const voiceRef = useRef<VoicePlayback>({
    active: () => activeRef.current,
    speaking: () => speakingRef.current,
    start: (clipId) => {
      if (!activeRef.current) return;
      const { doc: current, glossary: terms } = latestRef.current;
      const text = stepSpans(current)
        .find((step) => step.clip.id === clipId)
        ?.caption?.text.trim();
      if (!text) return;

      const request = ++requestRef.current;
      speakingRef.current = true;
      const { voiceId, speed } = current.narration;
      const context = (contextRef.current ??= new AudioContext());
      synthesize(applyReadings(text, terms), voiceId, speed)
        .then((audio) => context.decodeAudioData(audio.slice(0)))
        .then((buffer) => {
          if (request !== requestRef.current) return;
          const source = context.createBufferSource();
          source.buffer = buffer;
          source.connect(context.destination);
          source.addEventListener("ended", () => {
            if (request === requestRef.current) speakingRef.current = false;
          });
          source.start();
          sourceRef.current = source;
        })
        .catch((cause: unknown) => {
          speakingRef.current = false;
          setError(cause instanceof Error ? cause.message : "読み上げられませんでした。");
        });
    },
    stop: () => {
      activeRef.current = false;
      speakingRef.current = false;
      requestRef.current += 1;
      sourceRef.current?.stop();
      sourceRef.current = null;
      if (videoRef.current) videoRef.current.muted = false;
    },
  });

  // 再生中に生成すると読み上げが遅れ、書き出しと間合いが変わるので、先に全部用意する。
  const activate = async () => {
    setError(null);
    setPreparing(true);
    try {
      const context = (contextRef.current ??= new AudioContext());
      await context.resume();
      const { doc: current, glossary: terms } = latestRef.current;
      const { voiceId, speed, keepOriginalAudio } = current.narration;
      for (const { text } of narratedSteps(current)) {
        await synthesize(applyReadings(text, terms), voiceId, speed);
      }
      activeRef.current = true;
      if (videoRef.current) videoRef.current.muted = !keepOriginalAudio;
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "読み上げられませんでした。");
      return false;
    } finally {
      setPreparing(false);
    }
  };

  return { voiceRef, activate, preparing, error };
}
