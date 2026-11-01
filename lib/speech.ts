// 手元の whisper-server を直接呼ぶ。音声はこの PC の外へは出ない。
export const WHISPER_URL = process.env.NEXT_PUBLIC_WHISPER_URL ?? "http://127.0.0.1:8090";

const SAMPLE_RATE = 16_000;

export type VoiceRecording = { stop: () => Promise<Blob> };

export async function startRecording(): Promise<VoiceRecording> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("このブラウザはマイクに対応していません。");
  }
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const recorder = new MediaRecorder(stream);
  const chunks: Blob[] = [];
  recorder.addEventListener("dataavailable", (event) => chunks.push(event.data));
  recorder.start();
  return {
    stop: () =>
      new Promise((resolve) => {
        recorder.addEventListener("stop", () => {
          stream.getTracks().forEach((track) => track.stop());
          resolve(new Blob(chunks, { type: recorder.mimeType }));
        });
        recorder.stop();
      }),
  };
}

// ブラウザごとに録音形式が違うので、Whisper が確実に読める 16kHz モノラルの WAV に揃える。
export function encodeWav(samples: Float32Array, sampleRate: number) {
  const bytesPerSample = 2;
  const header = 44;
  const dataSize = samples.length * bytesPerSample;
  const view = new DataView(new ArrayBuffer(header + dataSize));
  const writeText = (offset: number, text: string) => {
    for (let index = 0; index < text.length; index += 1) {
      view.setUint8(offset + index, text.charCodeAt(index));
    }
  };

  writeText(0, "RIFF");
  view.setUint32(4, header - 8 + dataSize, true);
  writeText(8, "WAVE");
  writeText(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, bytesPerSample * 8, true);
  writeText(36, "data");
  view.setUint32(40, dataSize, true);
  samples.forEach((sample, index) => {
    const clamped = Math.max(-1, Math.min(1, sample));
    view.setInt16(header + index * bytesPerSample, clamped * 0x7fff, true);
  });
  return new Blob([view.buffer], { type: "audio/wav" });
}

export async function toWav(recording: Blob) {
  const context = new AudioContext();
  try {
    const decoded = await context.decodeAudioData(await recording.arrayBuffer());
    const offline = new OfflineAudioContext(
      1,
      Math.ceil(decoded.duration * SAMPLE_RATE),
      SAMPLE_RATE,
    );
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start();
    const rendered = await offline.startRendering();
    return encodeWav(rendered.getChannelData(0), SAMPLE_RATE);
  } finally {
    await context.close();
  }
}

export async function transcribe(wav: Blob, signal: AbortSignal) {
  const form = new FormData();
  form.append("file", wav, "voice.wav");
  form.append("language", "ja");
  form.append("response_format", "json");

  let response: Response;
  try {
    response = await fetch(`${WHISPER_URL}/inference`, { method: "POST", body: form, signal });
  } catch (cause) {
    if (signal.aborted) throw cause;
    throw new Error(`音声認識サーバ（${WHISPER_URL}）に接続できません。起動しているか確認してください。`);
  }
  if (!response.ok) throw new Error(`音声認識サーバがエラーを返しました（${response.status}）。`);
  const data: { text?: string } = await response.json();
  return data.text?.trim() ?? "";
}
