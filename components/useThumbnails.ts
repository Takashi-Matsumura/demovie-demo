"use client";

import { useEffect, useMemo, useState } from "react";
import type { DemoDocument } from "@/lib/document";
import { seekTo, waitForEvent, type VideoSources } from "@/lib/media";
import { drawFrame, thumbnailDoc, thumbnailSec } from "@/lib/render";

const WIDTH = 240;
const HEIGHT = 135;
const FIRST_READ_SEC = 0.01;

type ThumbnailClip = { assetId: string; sourceStartSec: number; sourceEndSec: number };

// 説明文を直すたびに作り直さないよう、見た目に関わる情報だけをキーにする。
function keyOf(clip: ThumbnailClip, doc: DemoDocument) {
  const blurs = doc.blurs.filter((blur) => blur.assetId === clip.assetId);
  return `${clip.assetId}:${clip.sourceStartSec}:${clip.sourceEndSec}:${JSON.stringify(blurs)}`;
}

export function useThumbnails(doc: DemoDocument, sources: VideoSources) {
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({});
  const spec = useMemo(
    () =>
      JSON.stringify({
        assets: doc.assets,
        clips: doc.clips.map(({ id, assetId, sourceStartSec, sourceEndSec }) => ({
          id,
          assetId,
          sourceStartSec,
          sourceEndSec,
        })),
        blurs: doc.blurs,
      }),
    [doc.assets, doc.blurs, doc.clips],
  );
  // 動画を足すと URL の一覧が新しいオブジェクトになるので、中身で比べる。
  const sourceKey = JSON.stringify(sources);

  useEffect(() => {
    const snapshot = { ...doc, ...JSON.parse(spec), captions: [], zooms: [] } as DemoDocument;
    const urls = JSON.parse(sourceKey) as VideoSources;
    const missing = snapshot.clips.filter(
      (clip) => urls[clip.assetId] && !thumbnails[keyOf(clip, snapshot)],
    );
    if (missing.length === 0) return;

    let cancelled = false;
    const opened = new Map<string, HTMLVideoElement>();
    const videoOf = async (assetId: string) => {
      const existing = opened.get(assetId);
      if (existing) return existing;
      const video = document.createElement("video");
      video.muted = true;
      video.playsInline = true;
      opened.set(assetId, video);
      const loaded = waitForEvent(video, "loadeddata");
      video.src = urls[assetId];
      await loaded;
      await seekTo(video, FIRST_READ_SEC);
      return video;
    };

    const run = async () => {
      const canvas = document.createElement("canvas");
      canvas.width = WIDTH;
      canvas.height = HEIGHT;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const plain = thumbnailDoc(snapshot);
      for (const clip of missing) {
        if (cancelled) return;
        const video = await videoOf(clip.assetId);
        const sec = thumbnailSec(clip);
        await seekTo(video, sec);
        if (cancelled) return;
        drawFrame(ctx, video, plain, clip.id, sec);
        const url = canvas.toDataURL("image/jpeg", 0.7);
        const key = keyOf(clip, snapshot);
        setThumbnails((current) => ({ ...current, [key]: url }));
      }
    };
    // サムネイルは補助の表示なので、作れなくても編集は続けられる。
    run().catch(() => undefined);

    return () => {
      cancelled = true;
      for (const video of opened.values()) {
        video.removeAttribute("src");
        video.load();
      }
    };
    // 生成結果を依存に入れると、1 枚できるたびに処理をやり直してしまう。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spec, sourceKey]);

  return (clip: ThumbnailClip) => thumbnails[keyOf(clip, doc)];
}
