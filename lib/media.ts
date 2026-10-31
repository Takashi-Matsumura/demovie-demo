const MIME_CANDIDATES = [
  "video/mp4;codecs=avc1.640028,mp4a.40.2",
  "video/mp4",
  "video/webm;codecs=vp9,opus",
  "video/webm",
];

// MP4 を優先する。MediaRecorder の WebM は長さの情報を持たず、シークも遅い。
export function pickMimeType() {
  const mimeType = MIME_CANDIDATES.find((type) => MediaRecorder.isTypeSupported(type));
  if (!mimeType) throw new Error("このブラウザは動画の記録に対応していません。");
  return mimeType;
}

export function extensionFor(mimeType: string) {
  return mimeType.startsWith("video/mp4") ? "mp4" : "webm";
}

export function waitForEvent(target: EventTarget, name: string) {
  return new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      target.removeEventListener(name, onEvent);
      target.removeEventListener("error", onError);
    };
    const onEvent = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("動画を読み込めませんでした。別の形式のファイルを試してください。"));
    };
    target.addEventListener(name, onEvent);
    target.addEventListener("error", onError);
  });
}

export async function seekTo(video: HTMLVideoElement, sourceSec: number) {
  if (video.currentTime === sourceSec) return;
  const seeked = waitForEvent(video, "seeked");
  video.currentTime = sourceSec;
  await seeked;
}

export async function probeVideo(url: string) {
  const video = document.createElement("video");
  video.preload = "metadata";
  video.muted = true;
  const loaded = waitForEvent(video, "loadedmetadata");
  video.src = url;
  await loaded;

  // 長さ不明の録画は、末尾へシークするとブラウザが実際の長さを確定する。
  if (!Number.isFinite(video.duration)) {
    const known = waitForEvent(video, "durationchange");
    video.currentTime = Number.MAX_SAFE_INTEGER;
    await known;
  }
  const info = {
    durationSec: video.duration,
    width: video.videoWidth,
    height: video.videoHeight,
  };
  video.removeAttribute("src");
  video.load();
  if (!Number.isFinite(info.durationSec) || info.durationSec <= 0 || !info.width) {
    throw new Error("動画の長さやサイズを読み取れませんでした。");
  }
  return info;
}

function recordStream(stream: MediaStream) {
  const mimeType = pickMimeType();
  const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 8_000_000 });
  const chunks: Blob[] = [];
  recorder.addEventListener("dataavailable", (event) => chunks.push(event.data));
  const finished = new Promise<Blob>((resolve) => {
    recorder.addEventListener("stop", () => resolve(new Blob(chunks, { type: mimeType })));
  });
  return { recorder, finished, mimeType };
}

export type ScreenRecording = { stop: () => void; finished: Promise<Blob>; mimeType: string };

export async function startScreenRecording(): Promise<ScreenRecording> {
  if (!navigator.mediaDevices?.getDisplayMedia) {
    throw new Error("このブラウザは画面録画に対応していません。デスクトップ版の Chrome か Edge を使ってください。");
  }
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: { frameRate: 30 },
    audio: true,
  });
  const { recorder, finished, mimeType } = recordStream(stream);
  const stop = () => {
    if (recorder.state !== "inactive") recorder.stop();
    stream.getTracks().forEach((track) => track.stop());
  };
  // ブラウザ側の「共有を停止」でも録画を終わらせる。
  stream.getVideoTracks()[0].addEventListener("ended", stop);
  recorder.start(1000);
  return { stop, finished, mimeType };
}

const SAMPLE_SEC = 6;

// 権限なしで編集を試せるよう、架空の管理画面を Canvas で描いて録画する。
export async function generateSample() {
  const canvas = document.createElement("canvas");
  canvas.width = 1280;
  canvas.height = 720;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas を初期化できませんでした。");

  const { recorder, finished, mimeType } = recordStream(canvas.captureStream(30));
  const startedAt = performance.now();
  const paint = () => {
    const elapsed = (performance.now() - startedAt) / 1000;
    drawSampleFrame(ctx, elapsed);
  };
  paint();
  recorder.start(250);
  const timer = setInterval(paint, 33);
  await new Promise((resolve) => setTimeout(resolve, SAMPLE_SEC * 1000));
  clearInterval(timer);
  recorder.stop();
  return { blob: await finished, mimeType };
}

function drawSampleFrame(ctx: CanvasRenderingContext2D, elapsed: number) {
  const progress = (elapsed % SAMPLE_SEC) / SAMPLE_SEC;
  ctx.fillStyle = "#f7f7f5";
  ctx.fillRect(0, 0, 1280, 720);
  ctx.fillStyle = "#1d2433";
  ctx.fillRect(0, 0, 220, 720);

  ctx.fillStyle = "#c9d1de";
  ctx.font = "20px sans-serif";
  ["概要", "顧客", "請求", "設定"].forEach((label, index) => {
    ctx.fillText(label, 32, 70 + index * 52);
  });

  ctx.fillStyle = "#1d2433";
  ctx.font = "bold 34px sans-serif";
  ctx.fillText("サンプル画面", 268, 76);
  ctx.font = "20px sans-serif";
  ctx.fillStyle = "#5b6472";
  ctx.fillText(`経過 ${elapsed.toFixed(1)} 秒`, 268, 112);

  [0.62, 0.84, 0.41, 0.73, 0.55].forEach((value, index) => {
    const height = 320 * value * Math.min(1, progress * 3 + index * 0.12);
    ctx.fillStyle = index === 1 ? "#d9822b" : "#8fa3bf";
    ctx.fillRect(280 + index * 180, 620 - height, 120, height);
  });

  const cursorX = 300 + Math.sin(progress * Math.PI * 2) * 40 + progress * 820;
  const cursorY = 360 + Math.cos(progress * Math.PI * 4) * 160;
  ctx.fillStyle = "#111";
  ctx.beginPath();
  ctx.moveTo(cursorX, cursorY);
  ctx.lineTo(cursorX, cursorY + 26);
  ctx.lineTo(cursorX + 18, cursorY + 19);
  ctx.closePath();
  ctx.fill();
}
