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
// 読み上げを待つ間、チャプター画面の区間に留まるための小さな余白。
const CHAPTER_HOLD_SEC = 0.001;

/** 動画（asset）の ID ごとの <video>。再生位置の手順の動画を使う。 */
export type VideoBank = RefObject<Map<string, HTMLVideoElement>>;

export function usePlayer(
  doc: DemoDocument,
  videosRef: VideoBank,
  canvasRef: RefObject<HTMLCanvasElement | null>,
  voiceRef: RefObject<VoicePlayback>,
) {
  const [timeSec, setTimeSec] = useState(0);
  const [playing, setPlaying] = useState(false);
  const docRef = useRef(doc);
  const timeRef = useRef(0);
  const playingRef = useRef(false);
  const spokenClipRef = useRef<string | null>(null);

  // 動画が増えたら、増えた <video> にも再生の合図をつなぎ直す。
  const assetKey = doc.assets.map((asset) => asset.id).join("\n");

  const updatePlaying = useCallback((next: boolean) => {
    playingRef.current = next;
    setPlaying(next);
  }, []);

  const videoAt = useCallback(
    (timelineSec: number) =>
      videosRef.current.get(locate(docRef.current, timelineSec).clip.assetId) ?? null,
    [videosRef],
  );

  const pauseAll = useCallback(() => {
    for (const video of videosRef.current.values()) video.pause();
  }, [videosRef]);

  const paint = useCallback(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    drawAt(ctx, (assetId) => videosRef.current.get(assetId), docRef.current, timeRef.current);
  }, [canvasRef, videosRef]);

  const placeVideo = useCallback(() => {
    const video = videoAt(timeRef.current);
    if (!video) return;
    const { sourceSec } = locate(docRef.current, timeRef.current);
    if (Math.abs(video.currentTime - sourceSec) > 0.001) video.currentTime = sourceSec;
    paint();
  }, [paint, videoAt]);

  const seek = useCallback(
    (nextSec: number) => {
      pauseAll();
      voiceRef.current.stop();
      spokenClipRef.current = null;
      updatePlaying(false);
      const clamped = Math.min(Math.max(0, nextSec), totalDuration(docRef.current));
      timeRef.current = clamped;
      setTimeSec(clamped);
      placeVideo();
    },
    [pauseAll, placeVideo, updatePlaying, voiceRef],
  );

  const toggle = useCallback(async () => {
    // 読み上げの待ち時間は動画が止まっているので、再生中かどうかは自前の状態で判断する。
    if (playingRef.current) {
      pauseAll();
      voiceRef.current.stop();
      spokenClipRef.current = null;
      updatePlaying(false);
      return;
    }
    if (timeRef.current >= totalDuration(docRef.current) - END_EPSILON_SEC) seek(0);
    // チャプター画面の区間は映像を止めたまま進めるので、映像は区間が終わってから流す。
    if (locate(docRef.current, timeRef.current).inChapter) {
      updatePlaying(true);
      return;
    }
    const video = videoAt(timeRef.current);
    if (!video) return;
    try {
      await video.play();
      updatePlaying(true);
    } catch {
      // ブラウザが自動再生を拒否した場合は停止状態のままにする。
      updatePlaying(false);
    }
  }, [pauseAll, seek, updatePlaying, videoAt, voiceRef]);

  useEffect(() => {
    docRef.current = doc;
    if (playing) return;
    timeRef.current = Math.min(timeRef.current, totalDuration(doc));
    placeVideo();
  }, [doc, placeVideo, playing]);

  useEffect(() => {
    const videos = [...videosRef.current.values()];
    for (const video of videos) {
      video.addEventListener("seeked", paint);
      video.addEventListener("loadeddata", placeVideo);
    }
    return () => {
      for (const video of videos) {
        video.removeEventListener("seeked", paint);
        video.removeEventListener("loadeddata", placeVideo);
      }
    };
  }, [assetKey, paint, placeVideo, videosRef]);

  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    let lastAt = performance.now();
    const tick = (now: number) => {
      const elapsedSec = Math.max(0, (now - lastAt) / 1000);
      lastAt = now;
      const spans = clipSpans(docRef.current);
      const { index, inChapter } = locate(docRef.current, timeRef.current);
      const span = spans[index];
      const video = videosRef.current.get(span.clip.assetId);
      if (!video) return;
      const voice = voiceRef.current;

      if (inChapter) {
        // チャプター画面は映像を止めたまま、経過時間で進める。読み上げ中は区間の終わりで待つ。
        pauseAll();
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
        // 次の手順が別の動画なら、いまの動画を止めて次の動画に切り替える。
        const nextVideo = videosRef.current.get(next.clip.assetId);
        if (nextVideo !== video) video.pause();
        if (!nextVideo) {
          updatePlaying(false);
          return;
        }
        nextVideo.currentTime = next.clip.sourceStartSec;
        // 次の手順がチャプター画面から始まるなら、映像はその区間が終わるまで流さない。
        if (next.clip.chapter) nextVideo.pause();
        else if (nextVideo.paused) void nextVideo.play();
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
  }, [paint, pauseAll, playing, updatePlaying, videosRef, voiceRef]);

  return { timeSec: Math.min(timeSec, totalDuration(doc)), playing, seek, toggle };
}
