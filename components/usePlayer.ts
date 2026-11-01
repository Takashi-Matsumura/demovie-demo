"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { DemoDocument } from "@/lib/document";
import { drawFrame } from "@/lib/render";
import { clipSpans, locate, totalDuration } from "@/lib/timeline";
import type { VoicePlayback } from "./useVoicePlayback";

const END_EPSILON_SEC = 0.02;
// 手順の途中から再生したときは、文の頭から読むと映像とズレるので読まない。
const VOICE_START_WINDOW_SEC = 0.5;

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
    const { clip, sourceSec } = locate(docRef.current, timeRef.current);
    drawFrame(ctx, video, docRef.current, clip.id, sourceSec);
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
    const tick = () => {
      const video = videoRef.current;
      if (!video) return;
      const spans = clipSpans(docRef.current);
      const index = locate(docRef.current, timeRef.current).index;
      const span = spans[index];
      const reachedEnd = video.ended || video.currentTime >= span.clip.sourceEndSec - END_EPSILON_SEC;

      const voice = voiceRef.current;
      if (voice.active() && spokenClipRef.current !== span.clip.id) {
        spokenClipRef.current = span.clip.id;
        if (timeRef.current - span.startSec < VOICE_START_WINDOW_SEC) voice.start(span.clip.id);
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
        if (video.paused) void video.play();
      } else {
        timeRef.current = span.startSec + Math.max(0, video.currentTime - span.clip.sourceStartSec);
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
