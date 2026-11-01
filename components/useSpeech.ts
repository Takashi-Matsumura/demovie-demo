"use client";

import { useCallback, useRef, useState } from "react";
import type { DemoDocument } from "@/lib/document";
import { applyReadings } from "@/lib/glossary";
import { synthesize } from "@/lib/narration";

// 手順ごとの試聴用。動画の再生とは別に、説明文だけを読み上げる。
export function useSpeech() {
  const [error, setError] = useState<string | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);

  const speak = useCallback(async (doc: DemoDocument, text: string, glossary: string) => {
    setError(null);
    try {
      contextRef.current ??= new AudioContext();
      const context = contextRef.current;
      await context.resume();
      const { voiceId, speed } = doc.narration;
      const audio = await synthesize(applyReadings(text, glossary), voiceId, speed);
      const buffer = await context.decodeAudioData(audio.slice(0));
      sourceRef.current?.stop();
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(context.destination);
      source.start();
      sourceRef.current = source;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "読み上げられませんでした。");
    }
  }, []);

  return { speak, error };
}
