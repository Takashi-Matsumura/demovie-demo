"use client";

import { useEffect, useMemo, useState } from "react";
import type { DemoDocument } from "@/lib/document";
import { seekTo, waitForEvent } from "@/lib/media";
import { drawFrame, thumbnailDoc, thumbnailSec } from "@/lib/render";

const WIDTH = 240;
const HEIGHT = 135;
const FIRST_READ_SEC = 0.01;

// 説明文を直すたびに作り直さないよう、見た目に関わる情報だけをキーにする。
function keyOf(sourceStartSec: number, sourceEndSec: number, doc: DemoDocument) {
  return `${sourceStartSec}:${sourceEndSec}:${JSON.stringify(doc.blurs)}`;
}

export function useThumbnails(doc: DemoDocument, src: string) {
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({});
  const spec = useMemo(
    () =>
      JSON.stringify({
        clips: doc.clips.map(({ id, sourceStartSec, sourceEndSec }) => ({
          id,
          sourceStartSec,
          sourceEndSec,
        })),
        blurs: doc.blurs,
      }),
    [doc.blurs, doc.clips],
  );

  useEffect(() => {
    const snapshot = { ...doc, ...JSON.parse(spec), captions: [], zooms: [] } as DemoDocument;
    const missing = snapshot.clips.filter(
      (clip) => !thumbnails[keyOf(clip.sourceStartSec, clip.sourceEndSec, snapshot)],
    );
    if (missing.length === 0) return;

    let cancelled = false;
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;

    const run = async () => {
      const canvas = document.createElement("canvas");
      canvas.width = WIDTH;
      canvas.height = HEIGHT;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const loaded = waitForEvent(video, "loadeddata");
      video.src = src;
      await loaded;
      await seekTo(video, FIRST_READ_SEC);

      const plain = thumbnailDoc(snapshot);
      for (const clip of missing) {
        if (cancelled) return;
        const sec = thumbnailSec(clip);
        await seekTo(video, sec);
        if (cancelled) return;
        drawFrame(ctx, video, plain, clip.id, sec);
        const url = canvas.toDataURL("image/jpeg", 0.7);
        const key = keyOf(clip.sourceStartSec, clip.sourceEndSec, snapshot);
        setThumbnails((current) => ({ ...current, [key]: url }));
      }
    };
    // サムネイルは補助の表示なので、作れなくても編集は続けられる。
    run().catch(() => undefined);

    return () => {
      cancelled = true;
      video.removeAttribute("src");
      video.load();
    };
    // 生成結果を依存に入れると、1 枚できるたびに処理をやり直してしまう。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spec, src]);

  return (clip: { sourceStartSec: number; sourceEndSec: number }) =>
    thumbnails[keyOf(clip.sourceStartSec, clip.sourceEndSec, doc)];
}
