import type { DemoDocument } from "./document";
import { pickMimeType, seekTo, waitForEvent, type VideoSources } from "./media";
import { prepareNarration, voiceKey } from "./narration";
import { drawChapter, drawFrame, OUTPUT_HEIGHT, OUTPUT_WIDTH } from "./render";
import { clipSpans, totalDuration } from "./timeline";

const FPS = 30;
const LAST_FRAME_MARGIN_SEC = 0.01;
const FRAME_SEC = 1 / FPS;

/** 書き出す動画に入れる音。両方 false なら音声なしで書き出す。 */
export type ExportAudio = { narration: boolean; original: boolean };

// 書き出しの設定の初期値。右パネルのナレーション設定に合わせる。
export function defaultExportAudio(doc: DemoDocument): ExportAudio {
  return {
    narration: doc.narration.enabled,
    original: !doc.narration.enabled || doc.narration.keepOriginalAudio,
  };
}

type ExportOptions = {
  doc: DemoDocument;
  audio: ExportAudio;
  glossary: string;
  sources: VideoSources;
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

function playVoice(
  context: AudioContext,
  buffer: AudioBuffer | undefined,
  output: AudioNode,
) {
  return new Promise<void>((resolve) => {
    if (!buffer) {
      resolve();
      return;
    }
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(output);
    source.addEventListener("ended", () => resolve());
    source.start();
  });
}

// 読み上げが手順より長いときは切らず、最後の画面のまま読み終わるのを待つ。
function holdLastFrame(voiceEnded: Promise<void>, signal: AbortSignal, draw: () => void) {
  let speaking = true;
  void voiceEnded.then(() => {
    speaking = false;
  });
  return new Promise<void>((resolve, reject) => {
    const hold = () => {
      if (signal.aborted) {
        reject(new DOMException("書き出しを中止しました。", "AbortError"));
      } else if (speaking) {
        draw();
        requestAnimationFrame(hold);
      } else {
        resolve();
      }
    };
    hold();
  });
}

// チャプター画面を決まった秒数だけ描き続ける。読み上げが長いときは読み終わるまで延ばす。
function showFor(
  durationSec: number,
  voiceEnded: Promise<void>,
  signal: AbortSignal,
  draw: (elapsedSec: number) => void,
) {
  let speaking = true;
  void voiceEnded.then(() => {
    speaking = false;
  });
  const startedAt = performance.now();
  return new Promise<void>((resolve, reject) => {
    const tick = () => {
      if (signal.aborted) {
        reject(new DOMException("書き出しを中止しました。", "AbortError"));
        return;
      }
      const elapsedSec = (performance.now() - startedAt) / 1000;
      draw(Math.min(elapsedSec, durationSec));
      if (elapsedSec >= durationSec && !speaking) resolve();
      else requestAnimationFrame(tick);
    };
    tick();
  });
}

// 動画を実際に再生しながら Canvas を録画するので、書き出しには動画と同じ時間がかかる。
export async function exportVideo({
  doc: edited,
  audio,
  glossary,
  sources,
  signal,
  onProgress,
}: ExportOptions) {
  // ナレーションを入れないときは、読み上げもクレジットの表示も、ナレーションが無いものとして扱う。
  const doc = audio.narration
    ? edited
    : { ...edited, narration: { ...edited.narration, enabled: false } };
  const withAudio = audio.narration || audio.original;

  const canvas = document.createElement("canvas");
  canvas.width = OUTPUT_WIDTH;
  canvas.height = OUTPUT_HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas を初期化できませんでした。");

  // 動画に含める手順が使う動画だけを開く。
  const assetIds = [...new Set(clipSpans(doc).map((span) => span.clip.assetId))];
  const videos = new Map<string, HTMLVideoElement>();
  for (const assetId of assetIds) {
    const src = sources[assetId];
    if (!src) throw new Error("手順の動画が見つかりませんでした。");
    const video = document.createElement("video");
    video.playsInline = true;
    // 音声なしのときは音の経路を作らないので、スピーカーへ出ないよう消音しておく。
    video.muted = !withAudio;
    videos.set(assetId, video);
    const loaded = waitForEvent(video, "loadeddata");
    video.src = src;
    await loaded;
  }

  const audioContext = withAudio ? new AudioContext() : null;
  const audioOutput = audioContext?.createMediaStreamDestination() ?? null;
  let narration = new Map<string, AudioBuffer>();
  if (audioContext && audioOutput) {
    await resumeAudio(audioContext);
    narration = await prepareNarration(doc, audioContext, glossary, signal);
    // 接続しないと動画の音がスピーカーへ出るので、消すときは音量 0 を通す。
    const originalGain = audioContext.createGain();
    originalGain.gain.value = audio.original ? 1 : 0;
    originalGain.connect(audioOutput);
    for (const video of videos.values()) {
      audioContext.createMediaElementSource(video).connect(originalGain);
    }
  }

  const stream = new MediaStream([
    ...canvas.captureStream(FPS).getVideoTracks(),
    ...(audioOutput?.stream.getAudioTracks() ?? []),
  ]);
  const mimeType = pickMimeType({ audio: withAudio });
  const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 12_000_000 });
  const chunks: Blob[] = [];
  recorder.addEventListener("dataavailable", (event) => chunks.push(event.data));
  const stopped = waitForEvent(recorder, "stop");

  const total = totalDuration(doc);
  const record = () => {
    if (recorder.state === "inactive") recorder.start(250);
    else recorder.resume();
  };
  const speak = (key: string) => {
    const voice = narration.get(key);
    return audioContext && audioOutput && voice
      ? playVoice(audioContext, voice, audioOutput)
      : Promise.resolve();
  };
  try {
    for (const span of clipSpans(doc)) {
      const { clip } = span;
      if (recorder.state === "recording") recorder.pause();

      if (clip.chapter) {
        const { chapter } = clip;
        drawChapter(ctx, doc, chapter);
        record();
        await showFor(chapter.durationSec, speak(voiceKey(clip.id, "chapter")), signal, (sec) => {
          drawChapter(ctx, doc, chapter);
          onProgress((span.startSec + sec) / total);
        });
        recorder.pause();
      }

      const video = videos.get(clip.assetId);
      if (!video) throw new Error("手順の動画が見つかりませんでした。");
      // 開始時刻ちょうどだと直前のコマ、つまり削除した区間の最後が映ることがある。
      const firstSec = clip.sourceStartSec + FRAME_SEC;
      await seekTo(video, firstSec);
      drawFrame(ctx, video, doc, clip.id, firstSec);
      record();

      await video.play();
      const voiceEnded = speak(voiceKey(clip.id, "step"));
      await new Promise<void>((resolve, reject) => {
        const tick = () => {
          if (signal.aborted) {
            reject(new DOMException("書き出しを中止しました。", "AbortError"));
            return;
          }
          // 終わりを過ぎたコマは削除した区間かもしれないので、描く前に止める。
          if (video.ended || video.currentTime >= clip.sourceEndSec) {
            resolve();
            return;
          }
          const sourceSec = video.currentTime;
          drawFrame(ctx, video, doc, clip.id, sourceSec);
          onProgress((span.videoStartSec + sourceSec - clip.sourceStartSec) / total);
          requestAnimationFrame(tick);
        };
        tick();
      });
      video.pause();

      if (narration.has(voiceKey(clip.id, "step"))) {
        // 止まった位置は手順の外なので、手順の中へ戻してから待つ。
        const lastSec = clip.sourceEndSec - LAST_FRAME_MARGIN_SEC;
        await seekTo(video, lastSec);
        await holdLastFrame(voiceEnded, signal, () => drawFrame(ctx, video, doc, clip.id, lastSec));
      }
    }
    recorder.stop();
    await stopped;
    return { blob: new Blob(chunks, { type: mimeType }), mimeType };
  } finally {
    for (const video of videos.values()) video.pause();
    if (recorder.state !== "inactive") recorder.stop();
    stream.getTracks().forEach((track) => track.stop());
    await audioContext?.close();
    for (const video of videos.values()) {
      video.removeAttribute("src");
      video.load();
    }
  }
}
