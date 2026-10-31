"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { DemoDocument } from "@/lib/document";
import { drawFrame } from "@/lib/render";
import { clipSpans, locate, totalDuration } from "@/lib/timeline";

const END_EPSILON_SEC = 0.02;

export function usePlayer(
  doc: DemoDocument,
  videoRef: RefObject<HTMLVideoElement | null>,
  canvasRef: RefObject<HTMLCanvasElement | null>,
) {
  const [timeSec, setTimeSec] = useState(0);
  const [playing, setPlaying] = useState(false);
  const docRef = useRef(doc);
  const timeRef = useRef(0);

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
      setPlaying(false);
      const clamped = Math.min(Math.max(0, nextSec), totalDuration(docRef.current));
      timeRef.current = clamped;
      setTimeSec(clamped);
      placeVideo();
    },
    [placeVideo, videoRef],
  );

  const toggle = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return;
    if (!video.paused) {
      video.pause();
      setPlaying(false);
      return;
    }
    if (timeRef.current >= totalDuration(docRef.current) - END_EPSILON_SEC) seek(0);
    try {
      await video.play();
      setPlaying(true);
    } catch {
      // ブラウザが自動再生を拒否した場合は停止状態のままにする。
      setPlaying(false);
    }
  }, [seek, videoRef]);

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

      if (reachedEnd) {
        const next = spans[index + 1];
        if (!next) {
          video.pause();
          timeRef.current = span.endSec;
          setTimeSec(span.endSec);
          setPlaying(false);
          paint();
          return;
        }
        timeRef.current = next.startSec;
        video.currentTime = next.clip.sourceStartSec;
      } else {
        timeRef.current = span.startSec + Math.max(0, video.currentTime - span.clip.sourceStartSec);
      }
      setTimeSec(timeRef.current);
      paint();
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [paint, playing, videoRef]);

  return { timeSec: Math.min(timeSec, totalDuration(doc)), playing, seek, toggle };
}
