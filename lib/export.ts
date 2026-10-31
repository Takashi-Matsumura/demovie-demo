import type { DemoDocument } from "./document";
import { pickMimeType, seekTo, waitForEvent } from "./media";
import { drawFrame, OUTPUT_HEIGHT, OUTPUT_WIDTH } from "./render";
import { clipSpans, totalDuration } from "./timeline";

const FPS = 30;

type ExportOptions = {
  doc: DemoDocument;
  src: string;
  signal: AbortSignal;
  onProgress: (ratio: number) => void;
};

// ユーザー操作なしだと resume() は解決しないまま止まるので、時間で打ち切る。
async function resumeAudio(audioContext: AudioContext) {
  const timeout = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error("音声を開始できませんでした。もう一度お試しください。")), 3000);
  });
  await Promise.race([audioContext.resume(), timeout]);
}

// 動画を実際に再生しながら Canvas を録画するので、書き出しには動画と同じ時間がかかる。
export async function exportVideo({ doc, src, signal, onProgress }: ExportOptions) {
  const canvas = document.createElement("canvas");
  canvas.width = OUTPUT_WIDTH;
  canvas.height = OUTPUT_HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas を初期化できませんでした。");

  const video = document.createElement("video");
  video.playsInline = true;
  const loaded = waitForEvent(video, "loadeddata");
  video.src = src;
  await loaded;

  const audioContext = new AudioContext();
  await resumeAudio(audioContext);
  const audioOutput = audioContext.createMediaStreamDestination();
  audioContext.createMediaElementSource(video).connect(audioOutput);

  const stream = new MediaStream([
    ...canvas.captureStream(FPS).getVideoTracks(),
    ...audioOutput.stream.getAudioTracks(),
  ]);
  const mimeType = pickMimeType();
  const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 12_000_000 });
  const chunks: Blob[] = [];
  recorder.addEventListener("dataavailable", (event) => chunks.push(event.data));
  const stopped = waitForEvent(recorder, "stop");

  const total = totalDuration(doc);
  try {
    for (const span of clipSpans(doc)) {
      const { clip } = span;
      if (recorder.state === "recording") recorder.pause();
      await seekTo(video, clip.sourceStartSec);
      drawFrame(ctx, video, doc, clip.id, clip.sourceStartSec);
      if (recorder.state === "inactive") recorder.start(250);
      else recorder.resume();

      await video.play();
      await new Promise<void>((resolve, reject) => {
        const tick = () => {
          if (signal.aborted) {
            reject(new DOMException("書き出しを中止しました。", "AbortError"));
            return;
          }
          const sourceSec = Math.min(video.currentTime, clip.sourceEndSec);
          drawFrame(ctx, video, doc, clip.id, sourceSec);
          onProgress((span.startSec + sourceSec - clip.sourceStartSec) / total);
          if (video.ended || video.currentTime >= clip.sourceEndSec) resolve();
          else requestAnimationFrame(tick);
        };
        tick();
      });
      video.pause();
    }
    recorder.stop();
    await stopped;
    return { blob: new Blob(chunks, { type: mimeType }), mimeType };
  } finally {
    video.pause();
    if (recorder.state !== "inactive") recorder.stop();
    stream.getTracks().forEach((track) => track.stop());
    await audioContext.close();
    video.removeAttribute("src");
    video.load();
  }
}
