"use client";

import { useEffect, useRef, useState } from "react";
import {
  captureErrorMessage,
  listCaptureDevices,
  openCaptureStream,
  preferCaptureDevice,
  type CaptureDevice,
} from "@/lib/capture";
import { extensionFor, startStreamRecording, type ScreenRecording } from "@/lib/media";

const BUTTON =
  "rounded-md bg-paper-3 px-3 py-1.5 text-sm whitespace-nowrap transition-colors duration-(--dur-fast) hover:bg-rule disabled:cursor-not-allowed disabled:opacity-50";
const PRIMARY =
  "rounded-md bg-accent px-3 py-1.5 text-sm font-medium whitespace-nowrap text-accent-ink transition-opacity duration-(--dur-fast) hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50";

type Props = {
  onCancel: () => void;
  onOpen: (blob: Blob, name: string) => Promise<void>;
};

/** HDMI キャプチャ機器などの映像を見ながら録画する。BIOS など、録画ソフトが動かない画面向け。 */
export function CapturePanel({ onCancel, onOpen }: Props) {
  const [devices, setDevices] = useState<CaptureDevice[] | null>(null);
  const [deviceId, setDeviceId] = useState("");
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [recording, setRecording] = useState<ScreenRecording | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  // 機器の一覧。USB を後から挿しても選べるように、接続の変化で取り直す。
  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      listCaptureDevices()
        .then((list) => {
          if (cancelled) return;
          setDevices(list);
          setDeviceId((current) =>
            list.some((device) => device.deviceId === current)
              ? current
              : (preferCaptureDevice(list)?.deviceId ?? ""),
          );
        })
        .catch((cause) => {
          if (!cancelled) setError(captureErrorMessage(cause));
        });
    };
    refresh();
    navigator.mediaDevices?.addEventListener("devicechange", refresh);
    return () => {
      cancelled = true;
      navigator.mediaDevices?.removeEventListener("devicechange", refresh);
    };
  }, []);

  // 選んだ機器を開く。切り替えや画面を閉じたときは、前の機器を必ず解放する。
  useEffect(() => {
    if (!deviceId) return;
    let cancelled = false;
    let opened: MediaStream | null = null;
    openCaptureStream(deviceId)
      .then((next) => {
        if (cancelled) {
          next.getTracks().forEach((track) => track.stop());
          return;
        }
        opened = next;
        setError(null);
        setStream(next);
      })
      .catch((cause) => {
        if (!cancelled) setError(captureErrorMessage(cause));
      });
    return () => {
      cancelled = true;
      opened?.getTracks().forEach((track) => track.stop());
      setStream(null);
    };
  }, [deviceId]);

  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = stream;
  }, [stream]);

  useEffect(() => {
    if (!recording) return;
    const startedAt = Date.now();
    const timer = setInterval(() => setElapsedSec((Date.now() - startedAt) / 1000), 500);
    return () => {
      clearInterval(timer);
      setElapsedSec(0);
    };
  }, [recording]);

  const start = async () => {
    if (!stream) return;
    setError(null);
    try {
      const session = startStreamRecording(stream);
      setRecording(session);
      const blob = await session.finished;
      setRecording(null);
      await onOpen(blob, `キャプチャ.${extensionFor(session.mimeType)}`);
    } catch (cause) {
      setRecording(null);
      setError(captureErrorMessage(cause));
    }
  };

  const settings = stream?.getVideoTracks()[0]?.getSettings();
  const audioLabel = stream?.getAudioTracks()[0]?.label;

  return (
    <section aria-label="キャプチャ機器から録画" className="flex flex-col gap-3 rounded-lg bg-paper-2 p-3">
      <p className="text-sm leading-6 text-ink-2">
        録画したい PC の映像出力（HDMI など）をキャプチャ機器につなぎ、機器をこの PC の USB に挿してください。BIOS など、OS が起動する前の画面も録画できます。
      </p>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">機器</span>
        <select
          className="rounded bg-paper-3 px-2 py-1.5"
          value={deviceId}
          disabled={!devices?.length || recording !== null}
          onChange={(event) => setDeviceId(event.target.value)}
        >
          {devices === null && <option value="">機器を探しています…</option>}
          {devices?.length === 0 && <option value="">キャプチャ機器が見つかりません</option>}
          {devices?.map((device) => (
            <option key={device.deviceId} value={device.deviceId}>
              {device.label}
            </option>
          ))}
        </select>
      </label>

      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        aria-label="キャプチャ機器の映像"
        className="aspect-video w-full rounded bg-black object-contain"
      />

      {settings?.width && (
        <p className="font-mono text-xs text-ink-2 tabular-nums">
          {settings.width}×{settings.height}
          {settings.frameRate ? ` · ${Math.round(settings.frameRate)}fps` : ""} · 音声:{" "}
          {audioLabel ?? "なし"}
        </p>
      )}

      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {recording ? (
          <>
            <button type="button" className={PRIMARY} onClick={recording.stop}>
              録画を止めて編集する
            </button>
            <span aria-live="off" className="font-mono text-sm text-danger tabular-nums">
              ● {formatElapsed(elapsedSec)}
            </span>
          </>
        ) : (
          <>
            <button type="button" className={PRIMARY} disabled={!stream} onClick={() => void start()}>
              録画を開始
            </button>
            <button type="button" className={BUTTON} onClick={onCancel}>
              やめる
            </button>
          </>
        )}
      </div>
    </section>
  );
}

function formatElapsed(totalSec: number) {
  const minutes = Math.floor(totalSec / 60);
  const seconds = Math.floor(totalSec % 60);
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
