"use client";

import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import { generateCaptions } from "@/lib/captions";
import { createDocument, newId, type DemoDocument } from "@/lib/document";
import { exportVideo } from "@/lib/export";
import {
  extensionFor,
  generateSample,
  probeVideo,
  startScreenRecording,
  type ScreenRecording,
} from "@/lib/media";
import {
  createProject,
  deleteProject,
  listProjects,
  loadProject,
  saveProject,
  type ProjectSummary,
} from "@/lib/projects";
import { OUTPUT_HEIGHT, OUTPUT_WIDTH } from "@/lib/render";
import {
  addCaption,
  addZoom,
  applySteps,
  captionAt,
  captionBounds,
  captionSpans,
  deleteClip,
  locate,
  moveClip,
  removeCaption,
  removeZoom,
  setCaptionRange,
  setStepText,
  setZoomLength,
  splitAt,
  totalDuration,
  updateCaption,
  updateZoom,
  zoomAt,
  zoomSpans,
} from "@/lib/timeline";
import { Assistant } from "./Assistant";
import { Inspector } from "./Inspector";
import { Steps } from "./Steps";
import { Timeline } from "./Timeline";
import { useDocument } from "./useDocument";
import { usePlayer } from "./usePlayer";

const BUTTON =
  "rounded-md bg-paper-3 px-3 py-1.5 text-sm whitespace-nowrap transition-colors duration-(--dur-fast) hover:bg-rule disabled:cursor-not-allowed disabled:text-ink-2 disabled:opacity-50 disabled:hover:bg-paper-3";
const PRIMARY =
  "rounded-md bg-accent px-3 py-1.5 text-sm font-medium whitespace-nowrap text-accent-ink transition-opacity duration-(--dur-fast) hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50";

type Source = { url: string; name: string; projectId: string };

export function Editor() {
  const { doc, canUndo, canRedo, load, edit, undo, redo, reset } = useDocument();
  const [source, setSource] = useState<Source | null>(null);
  const [error, setError] = useState<string | null>(null);

  const openBlob = useCallback(
    async (blob: Blob, name: string) => {
      const url = URL.createObjectURL(blob);
      try {
        const info = await probeVideo(url);
        const created = createDocument({ name, ...info });
        const projectId = newId();
        // 保存できなくても編集は続けられる。失敗は編集画面の保存表示で伝える。
        await createProject(projectId, created, blob).catch(() => undefined);
        load(created);
        setSource({ url, name, projectId });
        setError(null);
      } catch (cause) {
        URL.revokeObjectURL(url);
        setError(messageOf(cause));
      }
    },
    [load],
  );

  const resume = useCallback(
    async (projectId: string) => {
      try {
        const { doc: saved, video } = await loadProject(projectId);
        load(saved);
        setSource({ url: URL.createObjectURL(video), name: saved.asset.name, projectId });
        setError(null);
      } catch (cause) {
        setError(messageOf(cause));
      }
    },
    [load],
  );

  useEffect(() => {
    if (!source) return;
    return () => URL.revokeObjectURL(source.url);
  }, [source]);

  if (!doc || !source) {
    return <StartScreen error={error} onError={setError} onOpen={openBlob} onResume={resume} />;
  }

  return (
    <Workspace
      doc={doc}
      source={source}
      canUndo={canUndo}
      canRedo={canRedo}
      edit={edit}
      undo={undo}
      redo={redo}
      onClose={() => {
        reset();
        setSource(null);
      }}
    />
  );
}

type StartScreenProps = {
  error: string | null;
  onError: (message: string | null) => void;
  onOpen: (blob: Blob, name: string) => Promise<void>;
  onResume: (projectId: string) => Promise<void>;
};

function StartScreen({ error, onError, onOpen, onResume }: StartScreenProps) {
  const [busy, setBusy] = useState<"sample" | null>(null);
  const [recording, setRecording] = useState<ScreenRecording | null>(null);

  const startRecording = async () => {
    onError(null);
    try {
      const session = await startScreenRecording();
      setRecording(session);
      const blob = await session.finished;
      setRecording(null);
      await onOpen(blob, `録画.${extensionFor(session.mimeType)}`);
    } catch (cause) {
      setRecording(null);
      // 共有ダイアログのキャンセルはエラーとして扱わない。
      if (cause instanceof DOMException && cause.name === "NotAllowedError") return;
      onError(messageOf(cause));
    }
  };

  const startSample = async () => {
    onError(null);
    setBusy("sample");
    try {
      const { blob, mimeType } = await generateSample();
      await onOpen(blob, `サンプル.${extensionFor(mimeType)}`);
    } catch (cause) {
      onError(messageOf(cause));
    } finally {
      setBusy(null);
    }
  };

  const importFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) void onOpen(file, file.name);
  };

  return (
    <main className="flex flex-1 items-center px-4 py-16">
      <div className="mx-auto flex w-full max-w-xl flex-col gap-6">
        <div className="flex flex-col gap-3">
          <h1 className="text-4xl font-semibold tracking-tight">Demovie</h1>
          <p className="leading-7 text-ink-2">
            画面を録画すると、AI が操作の手順と説明文を下書きします。文章を直すだけで、説明動画が完成します。動画はこの PC の中だけで処理し、外部には送信しません。
          </p>
        </div>

        {recording ? (
          <button type="button" className={PRIMARY} onClick={recording.stop}>
            録画を止めて編集する
          </button>
        ) : (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={PRIMARY}
              disabled={busy !== null}
              onClick={startRecording}
            >
              画面を録画
            </button>
            <label
              className={`${BUTTON} cursor-pointer focus-within:outline-2 focus-within:outline-accent`}
            >
              動画を読み込む
              <input type="file" accept="video/*" className="sr-only" onChange={importFile} />
            </label>
            <button
              type="button"
              className={BUTTON}
              disabled={busy !== null}
              onClick={startSample}
            >
              {busy === "sample" ? "サンプルを作成中…" : "サンプルで試す"}
            </button>
          </div>
        )}

        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}

        <RecentProjects onError={onError} onResume={onResume} />
      </div>
    </main>
  );
}

type RecentProjectsProps = {
  onError: (message: string | null) => void;
  onResume: (projectId: string) => Promise<void>;
};

function RecentProjects({ onError, onResume }: RecentProjectsProps) {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  useEffect(() => {
    listProjects()
      .then(setProjects)
      .catch(() => onError("保存した作業の一覧を読み込めませんでした。"));
  }, [onError]);

  const remove = async (id: string) => {
    try {
      await deleteProject(id);
      setProjects((current) => current.filter((project) => project.id !== id));
    } catch (cause) {
      onError(messageOf(cause));
    }
  };

  if (projects.length === 0) return null;

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold">続きから編集</h2>
      <ul className="flex flex-col gap-1">
        {projects.map((project) => (
          <li key={project.id} className="flex items-center gap-2 rounded-md bg-paper-2 px-3 py-2">
            <button
              type="button"
              className="min-w-0 flex-1 text-left text-sm hover:underline"
              onClick={() => void onResume(project.id)}
            >
              <span className="block truncate">{project.name}</span>
              <span className="block font-mono text-xs text-ink-2 tabular-nums">
                {new Date(project.updatedAt).toLocaleString("ja-JP")} · 手順 {project.stepCount} ·{" "}
                {formatTime(project.durationSec)}
              </span>
            </button>
            {confirmingId === project.id ? (
              <button
                type="button"
                className="rounded px-2 py-1 text-sm text-danger hover:bg-paper-3"
                onClick={() => void remove(project.id)}
                onBlur={() => setConfirmingId(null)}
              >
                完全に削除
              </button>
            ) : (
              <button
                type="button"
                aria-label={`${project.name} を削除`}
                className="rounded px-2 py-1 text-sm text-ink-2 hover:bg-paper-3"
                onClick={() => setConfirmingId(project.id)}
              >
                削除
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

type ExportState =
  | { status: "idle" }
  | { status: "running"; ratio: number }
  | { status: "done"; url: string; fileName: string }
  | { status: "failed"; message: string };

type CaptionState =
  | { status: "idle" }
  | { status: "running"; message: string }
  | { status: "failed"; message: string };

type WorkspaceProps = {
  doc: DemoDocument;
  source: Source;
  canUndo: boolean;
  canRedo: boolean;
  edit: (change: (doc: DemoDocument) => DemoDocument) => void;
  undo: () => void;
  redo: () => void;
  onClose: () => void;
};

function Workspace({ doc, source, canUndo, canRedo, edit, undo, redo, onClose }: WorkspaceProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const captionAbortRef = useRef<AbortController | null>(null);
  const { timeSec, playing, seek, toggle } = usePlayer(doc, videoRef, canvasRef);
  const [exportState, setExportState] = useState<ExportState>({ status: "idle" });
  const [captionState, setCaptionState] = useState<CaptionState>({ status: "idle" });
  const [timelineOpen, setTimelineOpen] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);

  // 編集対象のズームとキャプションは選択状態を持たず、再生位置から決める。
  const zoom = zoomAt(doc, timeSec)?.zoom ?? null;
  const captionSpan = captionAt(doc, timeSec) ?? null;
  const caption = captionSpan?.caption ?? null;
  const bounds = caption && captionBounds(doc, caption.id);
  const currentClip = locate(doc, timeSec).clip;
  const exporting = exportState.status === "running";
  const generating = captionState.status === "running";

  useEffect(() => {
    saveProject(source.projectId, doc)
      .then(() => setSaveFailed(false))
      .catch(() => setSaveFailed(true));
  }, [doc, source.projectId]);

  useEffect(() => {
    if (exportState.status !== "done") return;
    const { url } = exportState;
    return () => URL.revokeObjectURL(url);
  }, [exportState]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target.closest("input, textarea, button, [role='slider']")) return;
      if (event.code === "Space") {
        event.preventDefault();
        void toggle();
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [redo, toggle, undo]);

  const startExport = async () => {
    if (playing) void toggle();
    const controller = new AbortController();
    abortRef.current = controller;
    setExportState({ status: "running", ratio: 0 });
    try {
      const { blob, mimeType } = await exportVideo({
        doc,
        src: source.url,
        signal: controller.signal,
        onProgress: (ratio) => setExportState({ status: "running", ratio }),
      });
      const baseName = source.name.replace(/\.[^.]+$/, "");
      setExportState({
        status: "done",
        url: URL.createObjectURL(blob),
        fileName: `${baseName}-demovie.${extensionFor(mimeType)}`,
      });
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") {
        setExportState({ status: "idle" });
      } else {
        setExportState({ status: "failed", message: messageOf(cause) });
      }
    }
  };

  const startCaptions = async () => {
    if (playing) void toggle();
    const controller = new AbortController();
    captionAbortRef.current = controller;
    setCaptionState({ status: "running", message: "画面の変化を解析中…" });
    try {
      const { captions, zooms } = await generateCaptions({
        doc,
        src: source.url,
        signal: controller.signal,
        onProgress: (message) => setCaptionState({ status: "running", message }),
      });
      edit((current) => applySteps(current, captions, zooms));
      setCaptionState({ status: "idle" });
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") {
        setCaptionState({ status: "idle" });
      } else {
        setCaptionState({ status: "failed", message: messageOf(cause) });
      }
    }
  };

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-3 p-4">
      <video ref={videoRef} src={source.url} playsInline preload="auto" className="hidden" />

      <header className="flex flex-wrap items-center gap-2">
        <h1 className="min-w-0 truncate text-sm font-semibold">{source.name}</h1>
        <span
          role={saveFailed ? "alert" : undefined}
          className={`mr-auto text-xs ${saveFailed ? "text-danger" : "text-ink-2"}`}
        >
          {saveFailed ? "保存できませんでした" : "自動保存"}
        </span>
        <button type="button" className={BUTTON} disabled={!canUndo} onClick={undo}>
          元に戻す
        </button>
        <button type="button" className={BUTTON} disabled={!canRedo} onClick={redo}>
          やり直す
        </button>
        <button type="button" className={BUTTON} disabled={exporting || generating} onClick={onClose}>
          閉じる
        </button>
        {exporting ? (
          <button type="button" className={BUTTON} onClick={() => abortRef.current?.abort()}>
            中止
          </button>
        ) : (
          <button type="button" className={PRIMARY} disabled={generating} onClick={startExport}>
            書き出す
          </button>
        )}
      </header>

      <ExportStatus state={exportState} />
      <CaptionStatus state={captionState} />

      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[20rem_minmax(0,1fr)] xl:grid-cols-[20rem_minmax(0,1fr)_16rem]">
        <Steps
          doc={doc}
          currentClipId={currentClip.id}
          onPurpose={(purpose) => edit((current) => ({ ...current, purpose }))}
          onSelect={seek}
          onText={(clipId, text) => edit((current) => setStepText(current, clipId, text))}
          onMove={(clipId, delta) => edit((current) => moveClip(current, clipId, delta))}
          onDelete={(clipId) => edit((current) => deleteClip(current, clipId))}
        />

        <div className="flex min-w-0 flex-col gap-3">
          <canvas
            ref={canvasRef}
            width={OUTPUT_WIDTH}
            height={OUTPUT_HEIGHT}
            aria-label="プレビュー"
            className="aspect-video max-h-[calc(100dvh-17rem)] w-full rounded-lg object-contain lg:min-h-64"
          />

          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className={PRIMARY} disabled={exporting} onClick={toggle}>
              {playing ? "一時停止" : "再生"}
            </button>
            <span className="font-mono text-sm text-ink-2 tabular-nums">
              {formatTime(timeSec)} / {formatTime(totalDuration(doc))}
            </span>
            <div className="ml-auto flex flex-wrap gap-2">
              <button
                type="button"
                className={BUTTON}
                onClick={() => edit((current) => splitAt(current, timeSec))}
              >
                ここで手順を分ける
              </button>
              <button
                type="button"
                className={BUTTON}
                onClick={() => edit((current) => addZoom(current, timeSec)?.doc ?? current)}
              >
                ズーム
              </button>
              <button
                type="button"
                aria-expanded={timelineOpen}
                className={BUTTON}
                onClick={() => setTimelineOpen((open) => !open)}
              >
                微調整
              </button>
              {generating ? (
                <button
                  type="button"
                  className={BUTTON}
                  onClick={() => captionAbortRef.current?.abort()}
                >
                  生成を中止
                </button>
              ) : (
                <button
                  type="button"
                  className={PRIMARY}
                  disabled={exporting}
                  onClick={startCaptions}
                >
                  AI で手順を作成
                </button>
              )}
            </div>
          </div>

          <Assistant
            doc={doc}
            timeSec={timeSec}
            disabled={exporting || generating}
            onListen={() => {
              if (playing) void toggle();
            }}
            onApply={({ doc: next, seekSec }) => {
              edit(() => next);
              if (seekSec !== undefined) seek(seekSec);
            }}
            onUndo={undo}
          />

          {timelineOpen ? (
            <>
              <Timeline
                doc={doc}
                timeSec={timeSec}
                selectedZoomId={zoom?.id ?? null}
                selectedCaptionId={caption?.id ?? null}
                onSeek={seek}
              />
              <div>
                <button
                  type="button"
                  className={BUTTON}
                  disabled={generating || caption !== null}
                  onClick={() => edit((current) => addCaption(current, timeSec))}
                >
                  キャプションを追加
                </button>
              </div>
            </>
          ) : (
            <input
              type="range"
              aria-label="再生位置"
              value={timeSec}
              min={0}
              max={totalDuration(doc)}
              step={0.1}
              onChange={(event) => seek(Number(event.target.value))}
            />
          )}
        </div>

        <Inspector
          doc={doc}
          zoom={zoom}
          caption={captionSpan && bounds && { ...captionSpan, ...bounds }}
          onLook={(patch) => edit((current) => ({ ...current, look: { ...current.look, ...patch } }))}
          onZoom={(patch) => {
            if (zoom) edit((current) => updateZoom(current, zoom.id, patch));
          }}
          onZoomLength={(lengthSec) => {
            if (!zoom) return;
            const next = setZoomLength(doc, zoom.id, lengthSec);
            edit(() => next);
            // 短くして再生位置が外れるとパネルごと消えるので、区間の中へ戻す。
            const span = zoomSpans(next).find((item) => item.zoom.id === zoom.id);
            if (span && timeSec >= span.endSec) seek((span.startSec + span.endSec) / 2);
          }}
          onZoomRemove={() => {
            if (zoom) edit((current) => removeZoom(current, zoom.id));
          }}
          onCaptionText={(text) => {
            if (caption) edit((current) => updateCaption(current, caption.id, text));
          }}
          onCaptionRange={(startSec, endSec) => {
            if (!caption) return;
            const next = setCaptionRange(doc, caption.id, startSec, endSec);
            edit(() => next);
            // 再生位置が外れるとパネルごと消えるので、区間の中へ戻す。
            const span = captionSpans(next).find((item) => item.caption.id === caption.id);
            if (span && (timeSec < span.startSec || timeSec >= span.endSec)) {
              seek((span.startSec + span.endSec) / 2);
            }
          }}
          onCaptionRemove={() => {
            if (caption) edit((current) => removeCaption(current, caption.id));
          }}
        />
      </div>
    </main>
  );
}

function ExportStatus({ state }: { state: ExportState }) {
  if (state.status === "running") {
    return (
      <p aria-live="polite" className="text-sm text-ink-2">
        書き出し中 {Math.round(state.ratio * 100)}%（動画と同じ時間がかかります。このタブを開いたままにしてください）
      </p>
    );
  }
  if (state.status === "done") {
    return (
      <p aria-live="polite" className="text-sm text-ink-2">
        書き出しが完了しました。{" "}
        <a href={state.url} download={state.fileName} className="text-accent underline">
          {state.fileName} を保存
        </a>
      </p>
    );
  }
  if (state.status === "failed") {
    return (
      <p role="alert" className="text-sm text-danger">
        書き出しに失敗しました。{state.message}
      </p>
    );
  }
  return null;
}

function CaptionStatus({ state }: { state: CaptionState }) {
  if (state.status === "running") {
    return (
      <p aria-live="polite" className="text-sm text-ink-2">
        {state.message}
      </p>
    );
  }
  if (state.status === "failed") {
    return (
      <p role="alert" className="text-sm text-danger">
        キャプションを生成できませんでした。{state.message}
      </p>
    );
  }
  return null;
}

function formatTime(totalSec: number) {
  const minutes = Math.floor(totalSec / 60);
  const seconds = (totalSec - minutes * 60).toFixed(1).padStart(4, "0");
  return `${minutes}:${seconds}`;
}

function messageOf(cause: unknown) {
  return cause instanceof Error ? cause.message : "予期しないエラーが発生しました。";
}
