"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { DemoDocument } from "@/lib/document";
import { voiceKey } from "@/lib/narration";
import { drawAt } from "@/lib/render";
import { clipSpans, locate, totalDuration } from "@/lib/timeline";
import type { VoicePlayback } from "./useVoicePlayback";

const END_EPSILON_SEC = 0.02;
// 手順の途中から再生したときは、文の頭から読むと映像とズレるので読まない。
const VOICE_START_WINDOW_SEC = 0.5;
// 読み上げを待つ間、カテゴリ画面の区間に留まるための小さな余白。
const CHAPTER_HOLD_SEC = 0.001;

export function usePlayer(
  doc: DemoDocument,
  videoRef: RefObject<HTMLVideoElement | null>,
  canvasRef: RefObject<HTMLCanvasElement | null>,
  voiceRef: RefObject<VoicePlayback>,
) {
  const [timeSec, setTimeSec] = useState(0);
  const [playing, setPlaying] = useState(false);
  const docRef = useRef(doc);
  const timeRef = useRef(0);
  const playingRef = useRef(false);
  const spokenClipRef = useRef<string | null>(null);

  const updatePlaying = useCallback((next: boolean) => {
    playingRef.current = next;
    setPlaying(next);
  }, []);

  const paint = useCallback(() => {
    const ctx = canvasRef.current?.getContext("2d");
    const video = videoRef.current;
    if (!ctx || !video) return;
    drawAt(ctx, video, docRef.current, timeRef.current);
  }, [canvasRef, videoRef]);

  const placeVideo = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    const { sourceSec } = locate(docRef.current, timeRef.current);
    if (Math.abs(video.currentTime - sourceSec) > 0.001) video.currentTime = sourceSec;
    paint();
  }, [paint, videoRef]);

  const seek = useCallback(
    (nextSec: number) => {
      videoRef.current?.pause();
      voiceRef.current.stop();
      spokenClipRef.current = null;
      updatePlaying(false);
      const clamped = Math.min(Math.max(0, nextSec), totalDuration(docRef.current));
      timeRef.current = clamped;
      setTimeSec(clamped);
      placeVideo();
    },
    [placeVideo, updatePlaying, videoRef, voiceRef],
  );

  const toggle = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return;
    // 読み上げの待ち時間は動画が止まっているので、再生中かどうかは自前の状態で判断する。
    if (playingRef.current) {
      video.pause();
      voiceRef.current.stop();
      spokenClipRef.current = null;
      updatePlaying(false);
      return;
    }
    if (timeRef.current >= totalDuration(docRef.current) - END_EPSILON_SEC) seek(0);
    // カテゴリ画面の区間は映像を止めたまま進めるので、映像は区間が終わってから流す。
    if (locate(docRef.current, timeRef.current).inChapter) {
      updatePlaying(true);
      return;
    }
    try {
      await video.play();
      updatePlaying(true);
    } catch {
      // ブラウザが自動再生を拒否した場合は停止状態のままにする。
      updatePlaying(false);
    }
  }, [seek, updatePlaying, videoRef, voiceRef]);

  useEffect(() => {
    docRef.current = doc;
    if (playing) return;
    timeRef.current = Math.min(timeRef.current, totalDuration(doc));
    placeVideo();
  }, [doc, placeVideo, playing]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.addEventListener("seeked", paint);
    video.addEventListener("loadeddata", placeVideo);
    return () => {
      video.removeEventListener("seeked", paint);
      video.removeEventListener("loadeddata", placeVideo);
    };
  }, [paint, placeVideo, videoRef]);

  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    let lastAt = performance.now();
    const tick = (now: number) => {
      const elapsedSec = Math.max(0, (now - lastAt) / 1000);
      lastAt = now;
      const video = videoRef.current;
      if (!video) return;
      const spans = clipSpans(docRef.current);
      const { index, inChapter } = locate(docRef.current, timeRef.current);
      const span = spans[index];
      const voice = voiceRef.current;

      if (inChapter) {
        // カテゴリ画面は映像を止めたまま、経過時間で進める。読み上げ中は区間の終わりで待つ。
        if (!video.paused) video.pause();
        const key = voiceKey(span.clip.id, "chapter");
        if (voice.active() && spokenClipRef.current !== key) {
          spokenClipRef.current = key;
          if (timeRef.current - span.startSec < VOICE_START_WINDOW_SEC) {
            voice.start(span.clip.id, "chapter");
          }
        }
        const nextSec = timeRef.current + elapsedSec;
        if (nextSec < span.videoStartSec) {
          timeRef.current = nextSec;
        } else if (voice.speaking()) {
          timeRef.current = span.videoStartSec - CHAPTER_HOLD_SEC;
        } else {
          timeRef.current = span.videoStartSec;
          video.currentTime = span.clip.sourceStartSec;
          void video.play();
        }
        setTimeSec(timeRef.current);
        paint();
        frame = requestAnimationFrame(tick);
        return;
      }

      const reachedEnd = video.ended || video.currentTime >= span.clip.sourceEndSec - END_EPSILON_SEC;
      const key = voiceKey(span.clip.id, "step");
      if (voice.active() && spokenClipRef.current !== key) {
        spokenClipRef.current = key;
        if (timeRef.current - span.videoStartSec < VOICE_START_WINDOW_SEC) {
          voice.start(span.clip.id, "step");
        }
      }

      if (reachedEnd && voice.speaking()) {
        // 書き出しと同じく、読み上げが終わるまで最後の画面で待つ。
        video.pause();
        paint();
        frame = requestAnimationFrame(tick);
        return;
      }

      if (reachedEnd) {
        const next = spans[index + 1];
        if (!next) {
          video.pause();
          voice.stop();
          spokenClipRef.current = null;
          timeRef.current = span.endSec;
          setTimeSec(span.endSec);
          updatePlaying(false);
          paint();
          return;
        }
        timeRef.current = next.startSec;
        video.currentTime = next.clip.sourceStartSec;
        // 次の手順がカテゴリ画面から始まるなら、映像はその区間が終わるまで流さない。
        if (next.clip.chapter) video.pause();
        else if (video.paused) void video.play();
      } else {
        timeRef.current =
          span.videoStartSec + Math.max(0, video.currentTime - span.clip.sourceStartSec);
      }
      setTimeSec(timeRef.current);
      paint();
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [paint, playing, updatePlaying, videoRef, voiceRef]);

  return { timeSec: Math.min(timeSec, totalDuration(doc)), playing, seek, toggle };
}
