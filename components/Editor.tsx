"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type PointerEvent,
} from "react";
import { detectSplitPoints, generateCaptions, type CaptionActivity } from "@/lib/captions";
import {
  addAssets,
  assetOf,
  createDocument,
  newId,
  type Asset,
  type DemoDocument,
} from "@/lib/document";
import { defaultExportAudio, exportVideo, type ExportAudio } from "@/lib/export";
import { formatTime } from "@/lib/format";
import {
  extensionFor,
  generateSample,
  probeVideo,
  startScreenRecording,
  type ScreenRecording,
  type VideoSources,
} from "@/lib/media";
import {
  addProjectVideos,
  createProject,
  deleteProject,
  listProjects,
  loadProject,
  saveProject,
  type ProjectSummary,
} from "@/lib/projects";
import { OUTPUT_HEIGHT, OUTPUT_WIDTH, previewToVideo } from "@/lib/render";
import {
  addBlur,
  addCaption,
  addZoom,
  applySteps,
  captionAt,
  captionBounds,
  captionSpans,
  clipSpans,
  deleteClip,
  locate,
  mergeWithNext,
  moveClip,
  moveClipEdge,
  removeBlur,
  removeCaption,
  removeZoom,
  setBlurRange,
  setBlurStyle,
  setCaptionRange,
  setChapter,
  setClipIncluded,
  setStepText,
  stepSpans,
  setZoomLength,
  splitAt,
  splitAtSources,
  totalDuration,
  updateCaption,
  updateZoom,
  zoomAt,
  zoomSpans,
} from "@/lib/timeline";
import { Assistant } from "./Assistant";
import { CapturePanel } from "./CapturePanel";
import {
  BlurIcon,
  CaptionAddIcon,
  CloseIcon,
  ExportIcon,
  IconButton,
  MinusIcon,
  NarratedPlayIcon,
  PanelLeftIcon,
  PanelRightIcon,
  PauseIcon,
  PlayIcon,
  PlusIcon,
  RedoIcon,
  SceneSplitIcon,
  SparkleIcon,
  SpinnerIcon,
  SplitIcon,
  StopIcon,
  TuneIcon,
  UndoIcon,
  VideoAddIcon,
  ZoomIcon,
} from "./IconButton";
import { Inspector } from "./Inspector";
import { isDown } from "@/lib/services";
import { ServiceStatusBar } from "./ServiceStatus";
import { useServices } from "./useServices";
import { Steps } from "./Steps";
import { useGlossary } from "./useGlossary";
import { useSpeech } from "./useSpeech";
import { useThumbnails } from "./useThumbnails";
import { useVoicePlayback } from "./useVoicePlayback";
import { StepBar } from "./StepBar";
import { Timeline } from "./Timeline";
import { useDocument } from "./useDocument";
import { usePlayer } from "./usePlayer";

const BUTTON =
  "rounded-md bg-paper-3 px-3 py-1.5 text-sm whitespace-nowrap transition-colors duration-(--dur-fast) hover:bg-rule disabled:cursor-not-allowed disabled:text-ink-2 disabled:opacity-50 disabled:hover:bg-paper-3";
const PRIMARY =
  "rounded-md bg-accent px-3 py-1.5 text-sm font-medium whitespace-nowrap text-accent-ink transition-opacity duration-(--dur-fast) hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50";

/** urls は動画（asset）の ID ごとの再生用 URL。動画を足すと増える。 */
type Source = { projectId: string; urls: VideoSources };

/** 読み込む動画。name は元のファイル名などの表示名。 */
type NamedVideo = { blob: Blob; name: string };

type PreparedVideo = { asset: Asset; blob: Blob; url: string };

// 動画の長さと大きさを読み取って、編集に使える形にする。1 本でも読めなければ全部やめる。
async function prepareVideos(videos: NamedVideo[]): Promise<PreparedVideo[]> {
  const prepared: PreparedVideo[] = [];
  try {
    for (const { blob, name } of videos) {
      const url = URL.createObjectURL(blob);
      try {
        const info = await probeVideo(url);
        prepared.push({ asset: { id: newId(), name, ...info }, blob, url });
      } catch (cause) {
        URL.revokeObjectURL(url);
        throw new Error(videos.length > 1 ? `「${name}」: ${messageOf(cause)}` : messageOf(cause));
      }
    }
    return prepared;
  } catch (cause) {
    for (const { url } of prepared) URL.revokeObjectURL(url);
    throw cause;
  }
}

function urlsOf(prepared: PreparedVideo[]): VideoSources {
  return Object.fromEntries(prepared.map(({ asset, url }) => [asset.id, url]));
}

// 複数選んだときの順番は OS によって違うので、ファイル名の順（数字は数として）に並べる。
function filesOf(list: FileList | null): NamedVideo[] {
  return [...(list ?? [])]
    .sort((a, b) => a.name.localeCompare(b.name, "ja", { numeric: true }))
    .map((file) => ({ blob: file, name: file.name }));
}

export function Editor() {
  const { doc, canUndo, canRedo, load, edit, undo, redo, reset } = useDocument();
  const [source, setSource] = useState<Source | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 作った URL は、プロジェクトを閉じるまで使い続ける。元に戻すで消えた動画も、やり直すで戻るため。
  const urlsRef = useRef<VideoSources>({});

  const openVideos = useCallback(
    async (videos: NamedVideo[]) => {
      try {
        const prepared = await prepareVideos(videos);
        const [first, ...rest] = prepared.map(({ asset }) => asset);
        if (!first) return;
        const created = createDocument([first, ...rest]);
        const projectId = newId();
        const stored = prepared.map(({ asset, blob }) => ({ id: asset.id, blob }));
        // 保存できなくても編集は続けられる。失敗は編集画面の保存表示で伝える。
        await createProject(projectId, created, stored).catch(() => undefined);
        load(created);
        urlsRef.current = urlsOf(prepared);
        setSource({ projectId, urls: urlsRef.current });
        setError(null);
      } catch (cause) {
        setError(messageOf(cause));
      }
    },
    [load],
  );

  const resume = useCallback(
    async (projectId: string) => {
      try {
        const { doc: saved, videos } = await loadProject(projectId);
        load(saved);
        urlsRef.current = Object.fromEntries(
          videos.map(({ id, blob }) => [id, URL.createObjectURL(blob)]),
        );
        setSource({ projectId, urls: urlsRef.current });
        setError(null);
      } catch (cause) {
        setError(messageOf(cause));
      }
    },
    [load],
  );

  // 編集中に動画を足す。足した動画は 1 つの手順として末尾に入る。元に戻すで取り消せる。
  const addVideos = useCallback(
    async (videos: NamedVideo[]) => {
      if (!source) return;
      const prepared = await prepareVideos(videos);
      if (prepared.length === 0) return;
      const stored = prepared.map(({ asset, blob }) => ({ id: asset.id, blob }));
      // 動画本体を先に保存する。作業内容だけ保存されると、次に開いたとき動画が見つからない。
      await addProjectVideos(source.projectId, stored).catch(() => undefined);
      urlsRef.current = { ...urlsRef.current, ...urlsOf(prepared) };
      setSource({ ...source, urls: urlsRef.current });
      edit((current) => addAssets(current, prepared.map(({ asset }) => asset)));
    },
    [edit, source],
  );

  const projectId = source?.projectId;
  useEffect(() => {
    if (!projectId) return;
    return () => {
      for (const url of Object.values(urlsRef.current)) URL.revokeObjectURL(url);
      urlsRef.current = {};
    };
  }, [projectId]);

  if (!doc || !source) {
    return <StartScreen error={error} onError={setError} onOpen={openVideos} onResume={resume} />;
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
      onAddVideos={addVideos}
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
  onOpen: (videos: NamedVideo[]) => Promise<void>;
  onResume: (projectId: string) => Promise<void>;
};

function StartScreen({ error, onError, onOpen, onResume }: StartScreenProps) {
  const [busy, setBusy] = useState<"sample" | null>(null);
  const [recording, setRecording] = useState<ScreenRecording | null>(null);
  const [capturing, setCapturing] = useState(false);
  const services = useServices();

  const startRecording = async () => {
    onError(null);
    try {
      const session = await startScreenRecording();
      setRecording(session);
      const blob = await session.finished;
      setRecording(null);
      await onOpen([{ blob, name: `録画.${extensionFor(session.mimeType)}` }]);
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
      await onOpen([{ blob, name: `サンプル.${extensionFor(mimeType)}` }]);
    } catch (cause) {
      onError(messageOf(cause));
    } finally {
      setBusy(null);
    }
  };

  const importFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const videos = filesOf(event.target.files);
    // 同じファイルを選び直しても change が起きるよう、選択を空に戻す。
    event.target.value = "";
    if (videos.length > 0) void onOpen(videos);
  };

  return (
    <main className="flex flex-1 items-center px-4 py-16">
      <div className="mx-auto flex w-full max-w-xl flex-col gap-6">
        <div className="flex flex-col gap-3">
          <h1 className="text-4xl font-semibold tracking-tight">Demovie</h1>
          <p className="leading-7 text-ink-2">
            画面を録画すると、AI が操作の手順と説明文を下書きします。文章を直すだけで、説明動画が完成します。動画はこの PC の中だけで処理します。音声の指示は、設定している場合のみ、文字にした内容を判定サービスへ送ります。
          </p>
        </div>

        {capturing ? (
          <CapturePanel
            onCancel={() => setCapturing(false)}
            onOpen={(blob, name) => onOpen([{ blob, name }])}
          />
        ) : recording ? (
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
            <button
              type="button"
              className={BUTTON}
              disabled={busy !== null}
              onClick={() => {
                onError(null);
                setCapturing(true);
              }}
            >
              キャプチャ機器から録画
            </button>
            <label
              className={`${BUTTON} cursor-pointer focus-within:outline-2 focus-within:outline-accent`}
            >
              動画を読み込む
              <input
                type="file"
                accept="video/*"
                multiple
                className="sr-only"
                onChange={importFiles}
              />
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

        <ServiceStatusBar services={services} />

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

type DragBox = {
  canvasX: number;
  canvasY: number;
  startLeft: number;
  startTop: number;
  left: number;
  top: number;
};

const MIN_BLUR_SIZE = 0.01;
// プレビューの表示倍率。1 は画面に収まる大きさ。細部を見るときは拡大してスクロールする。
const PREVIEW_SCALES = [0.5, 0.75, 1, 1.25, 1.5, 2, 3] as const;
const END_MARGIN_SEC = 0.05;

type CaptionState =
  | { status: "idle" }
  | { status: "running"; message: string; activity?: CaptionActivity }
  | { status: "done"; message: string }
  | { status: "failed"; message: string };

type WorkspaceProps = {
  doc: DemoDocument;
  source: Source;
  canUndo: boolean;
  canRedo: boolean;
  edit: (change: (doc: DemoDocument) => DemoDocument) => void;
  undo: () => void;
  redo: () => void;
  onAddVideos: (videos: NamedVideo[]) => Promise<void>;
  onClose: () => void;
};

function Workspace({
  doc,
  source,
  canUndo,
  canRedo,
  edit,
  undo,
  redo,
  onAddVideos,
  onClose,
}: WorkspaceProps) {
  // 動画（asset）の ID ごとの <video>。再生位置の手順の動画を使う。
  const videosRef = useRef(new Map<string, HTMLVideoElement>());
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const services = useServices();
  const captionAbortRef = useRef<AbortController | null>(null);
  const [glossary, setGlossary] = useGlossary();
  const { voiceRef, activate, preparing, error: voiceError } = useVoicePlayback(doc, glossary, videosRef);
  const { timeSec, playing, seek, toggle } = usePlayer(doc, videosRef, canvasRef, voiceRef);
  const [exportState, setExportState] = useState<ExportState>({ status: "idle" });
  // 書き出す前に、入れる音を選んでもらう。null のときは設定欄を閉じている。
  const [exportAudio, setExportAudio] = useState<ExportAudio | null>(null);
  const [captionState, setCaptionState] = useState<CaptionState>({ status: "idle" });
  const [timelineOpen, setTimelineOpen] = useState(false);
  const [stepsOpen, setStepsOpen] = useState(true);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [blurring, setBlurring] = useState(false);
  const [dragBox, setDragBox] = useState<DragBox | null>(null);
  const [previewScale, setPreviewScale] = useState(1);
  const previewScrollRef = useRef<HTMLDivElement>(null);
  // 倍率を変えても、見ていた場所が表示の中央に残るようにする。
  const previewCenterRef = useRef<{ x: number; y: number } | null>(null);
  const thumbnailOf = useThumbnails(doc, source.urls);
  const [adding, setAdding] = useState(false);
  const { speak, error: speechError } = useSpeech();
  const [saveFailed, setSaveFailed] = useState(false);

  // 動画に含めない手順は再生位置に乗らないので、選んだときだけ覚えておく。
  // 止まったままその手順の入る位置にいる間だけ有効で、再生や移動をすると再生位置の手順に戻る。
  const [pickedHidden, setPickedHidden] = useState<{ clipId: string; atSec: number } | null>(
    null,
  );
  const hiddenClipId =
    pickedHidden &&
    !playing &&
    pickedHidden.atSec === timeSec &&
    doc.clips.some((clip) => clip.id === pickedHidden.clipId && clip.hidden)
      ? pickedHidden.clipId
      : null;

  // 編集対象のズームとキャプションは選択状態を持たず、再生位置から決める。
  // 含めない手順を選んでいる間は、隣の手順のものを編集しないよう出さない。
  const zoom = hiddenClipId ? null : (zoomAt(doc, timeSec)?.zoom ?? null);
  const captionSpan = hiddenClipId ? null : (captionAt(doc, timeSec) ?? null);
  const caption = captionSpan?.caption ?? null;
  const bounds = caption && captionBounds(doc, caption.id);
  const currentClip = locate(doc, timeSec).clip;
  const selectedClipId = hiddenClipId ?? currentClip.id;

  const selectStep = (clipId: string) => {
    const step = stepSpans(doc).find((item) => item.clip.id === clipId);
    if (!step) return;
    const atSec = Math.min(step.startSec, totalDuration(doc));
    seek(atSec);
    setPickedHidden(step.included ? null : { clipId, atSec });
  };
  const exporting = exportState.status === "running";
  const generating = captionState.status === "running";
  // 含めない手順を選んでいる間は、再生位置が隣の手順にあるので分けない。
  const canSplit =
    !exporting && !generating && !hiddenClipId && splitAt(doc, timeSec) !== doc;
  const captionActivity = captionState.status === "running" ? (captionState.activity ?? null) : null;

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

  const startExport = async (audio: ExportAudio) => {
    setExportAudio(null);
    if (playing) void toggle();
    const controller = new AbortController();
    abortRef.current = controller;
    setExportState({ status: "running", ratio: 0 });
    try {
      const { blob, mimeType } = await exportVideo({
        doc,
        audio,
        glossary,
        sources: source.urls,
        signal: controller.signal,
        onProgress: (ratio) => setExportState({ status: "running", ratio }),
      });
      const baseName = doc.assets[0].name.replace(/\.[^.]+$/, "");
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

  const zoomPreview = useCallback((direction: -1 | 0 | 1) => {
    const el = previewScrollRef.current;
    if (el) {
      previewCenterRef.current = {
        x: (el.scrollLeft + el.clientWidth / 2) / el.scrollWidth,
        y: (el.scrollTop + el.clientHeight / 2) / el.scrollHeight,
      };
    }
    setPreviewScale((scale) => {
      if (direction === 0) return 1;
      const index = PREVIEW_SCALES.findIndex((value) => value >= scale);
      const next = Math.min(Math.max(index + direction, 0), PREVIEW_SCALES.length - 1);
      return PREVIEW_SCALES[next];
    });
  }, []);

  useLayoutEffect(() => {
    const el = previewScrollRef.current;
    const center = previewCenterRef.current;
    previewCenterRef.current = null;
    if (!el || !center) return;
    el.scrollLeft = center.x * el.scrollWidth - el.clientWidth / 2;
    el.scrollTop = center.y * el.scrollHeight - el.clientHeight / 2;
  }, [previewScale]);

  // ⌘ / Ctrl + ホイールで拡大縮小する。ブラウザ自体のズームを止めるため passive にしない。
  useEffect(() => {
    const el = previewScrollRef.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      if (Math.abs(event.deltaY) < 1) return;
      zoomPreview(event.deltaY < 0 ? 1 : -1);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomPreview]);

  // canvas は object-contain なので、表示領域の余白を除いた実際の描画位置から変換する。
  const pointOf = (event: PointerEvent<HTMLElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const scale = Math.min(rect.width / OUTPUT_WIDTH, rect.height / OUTPUT_HEIGHT);
    const offsetX = (rect.width - OUTPUT_WIDTH * scale) / 2;
    const offsetY = (rect.height - OUTPUT_HEIGHT * scale) / 2;
    const left = event.clientX - rect.left;
    const top = event.clientY - rect.top;
    return {
      left,
      top,
      canvasX: (left - offsetX) / scale,
      canvasY: (top - offsetY) / scale,
    };
  };

  const finishBlur = (event: PointerEvent<HTMLElement>) => {
    if (!dragBox) return;
    const { clip, sourceSec } = locate(doc, timeSec);
    const end = pointOf(event);
    const a = previewToVideo(doc, clip.id, sourceSec, dragBox.canvasX, dragBox.canvasY);
    const b = previewToVideo(doc, clip.id, sourceSec, end.canvasX, end.canvasY);
    const width = Math.abs(a.x - b.x);
    const height = Math.abs(a.y - b.y);
    setDragBox(null);
    if (width < MIN_BLUR_SIZE || height < MIN_BLUR_SIZE) return;
    const rect = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width, height };
    edit((current) => addBlur(current, clip.assetId, rect));
    setBlurring(false);
  };

  const playNarrated = async () => {
    seek(clipSpans(doc).find((span) => span.clip.id === currentClip.id)?.startSec ?? 0);
    if (await activate()) await toggle();
  };

  const startCaptions = async () => {
    if (playing) void toggle();
    const controller = new AbortController();
    captionAbortRef.current = controller;
    setCaptionState({ status: "running", message: "画面の変化を解析中…" });
    try {
      const { captions, zooms } = await generateCaptions({
        doc,
        glossary,
        sources: source.urls,
        signal: controller.signal,
        onProgress: (message) =>
          setCaptionState((state) => ({ ...runningOf(state), status: "running", message })),
        onActivity: (activity) =>
          setCaptionState((state) => ({ ...runningOf(state), status: "running", activity })),
      });
      edit((current) => applySteps(current, captions, zooms));
      setCaptionState({ status: "idle" });
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") {
        setCaptionState({ status: "idle" });
      } else {
        setCaptionState({
          status: "failed",
          message: `キャプションを生成できませんでした。${messageOf(cause)}`,
        });
      }
    }
  };

  // AI を使わず、画面が変わった位置で手順を分ける。説明文は空のまま残す。
  const startSceneSplit = async () => {
    if (playing) void toggle();
    const controller = new AbortController();
    captionAbortRef.current = controller;
    setCaptionState({ status: "running", message: "画面の変化を解析中…" });
    try {
      const points = await detectSplitPoints({
        doc,
        sources: source.urls,
        signal: controller.signal,
        onProgress: (message) =>
          setCaptionState((state) => ({ ...runningOf(state), status: "running", message })),
        onActivity: (activity) =>
          setCaptionState((state) => ({ ...runningOf(state), status: "running", activity })),
      });
      const before = doc.clips.length;
      const next = splitAtSources(doc, points);
      const added = next.clips.length - before;
      if (added > 0) edit(() => next);
      setCaptionState({
        status: "done",
        message:
          added > 0
            ? `画面の変化から ${added} か所で手順を分けました。`
            : "新しく分けられる画面の変化は見つかりませんでした。",
      });
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") {
        setCaptionState({ status: "idle" });
      } else {
        setCaptionState({
          status: "failed",
          message: `手順を分けられませんでした。${messageOf(cause)}`,
        });
      }
    }
  };

  return (
    <main className="flex w-full flex-1 flex-col gap-3 p-4">
      {doc.assets.map((asset) => (
        <video
          key={asset.id}
          ref={(video) => {
            if (video) videosRef.current.set(asset.id, video);
            else videosRef.current.delete(asset.id);
          }}
          src={source.urls[asset.id]}
          playsInline
          preload="auto"
          className="hidden"
        />
      ))}

      <header className="flex flex-wrap items-center gap-2">
        {exporting ? (
          <IconButton label="書き出しを中止" align="start" onClick={() => abortRef.current?.abort()}>
            <StopIcon />
          </IconButton>
        ) : (
          <IconButton
            label="書き出す"
            align="start"
            tone="primary"
            aria-expanded={exportAudio !== null}
            disabled={generating}
            onClick={() => setExportAudio((open) => (open ? null : defaultExportAudio(doc)))}
          >
            <ExportIcon />
          </IconButton>
        )}
        <h1 className="min-w-0 truncate text-sm font-semibold">
          {doc.assets.length > 1
            ? `${doc.assets[0].name} ほか ${doc.assets.length - 1} 本`
            : doc.assets[0].name}
        </h1>
        <span
          role={saveFailed ? "alert" : undefined}
          className={`mr-auto text-xs ${saveFailed ? "text-danger" : "text-ink-2"}`}
        >
          {saveFailed ? "保存できませんでした" : "自動保存"}
        </span>
        <IconButton
          label="動画を追加"
          aria-expanded={adding}
          tone={adding ? "default" : "quiet"}
          disabled={exporting || generating}
          onClick={() => {
            if (playing) void toggle();
            setAdding((open) => !open);
          }}
        >
          <VideoAddIcon />
        </IconButton>
        <IconButton
          label={stepsOpen ? "手順パネルを隠す" : "手順パネルを表示"}
          aria-pressed={stepsOpen}
          tone={stepsOpen ? "default" : "quiet"}
          onClick={() => setStepsOpen((open) => !open)}
        >
          <PanelLeftIcon />
        </IconButton>
        <IconButton
          label={inspectorOpen ? "設定パネルを隠す" : "設定パネルを表示"}
          aria-pressed={inspectorOpen}
          tone={inspectorOpen ? "default" : "quiet"}
          onClick={() => setInspectorOpen((open) => !open)}
        >
          <PanelRightIcon />
        </IconButton>
        <span aria-hidden className="mx-1 h-5 w-px bg-rule" />
        <IconButton label="元に戻す" tone="quiet" disabled={!canUndo} onClick={undo}>
          <UndoIcon />
        </IconButton>
        <IconButton label="やり直す" tone="quiet" disabled={!canRedo} onClick={redo}>
          <RedoIcon />
        </IconButton>
        <IconButton
          label="閉じる"
          align="end"
          tone="quiet"
          disabled={exporting || generating}
          onClick={onClose}
        >
          <CloseIcon />
        </IconButton>
      </header>

      {exportAudio && (
        <ExportSettings
          audio={exportAudio}
          narrationAvailable={doc.narration.enabled}
          onChange={setExportAudio}
          onCancel={() => setExportAudio(null)}
          onStart={() => void startExport(exportAudio)}
        />
      )}
      {adding && (
        <AddVideoPanel
          onAdd={async (videos) => {
            await onAddVideos(videos);
            setAdding(false);
          }}
          onClose={() => setAdding(false)}
        />
      )}
      <ExportStatus state={exportState} />
      <CaptionStatus state={captionState} />
      {(speechError ?? voiceError) && (
        <p role="alert" className="text-sm text-danger">
          {speechError ?? voiceError}
        </p>
      )}

      <div className={`grid min-h-0 flex-1 gap-3 ${gridColumns(stepsOpen, inspectorOpen)}`}>
        {stepsOpen && (
          <Steps
            doc={doc}
            selectedClipId={selectedClipId}
            thumbnailOf={thumbnailOf}
            onPurpose={(purpose) => edit((current) => ({ ...current, purpose }))}
            onSelect={selectStep}
            onText={(clipId, text) => edit((current) => setStepText(current, clipId, text))}
            onSpeak={(text) => void speak(doc, text, glossary)}
            onMove={(clipId, delta) => edit((current) => moveClip(current, clipId, delta))}
            onChapter={(clipId, chapter) => edit((current) => setChapter(current, clipId, chapter))}
            onInclude={(clipId, included) =>
              edit((current) => setClipIncluded(current, clipId, included))
            }
            onDelete={(clipId) => edit((current) => deleteClip(current, clipId))}
          />
        )}

        <div className="flex min-w-0 flex-col gap-3">
          {blurring && (
            <p aria-live="polite" className="text-sm text-ink-2">
              隠したい範囲をプレビュー上でドラッグしてください。
              {doc.assets.length > 1 ? "いま表示している動画の全体にかかります。" : "動画全体にかかります。"}
            </p>
          )}
          <div
            ref={previewScrollRef}
            className="max-h-[max(calc(100dvh-17rem),16rem)] overflow-auto rounded-lg"
          >
            <div
              className={`relative mx-auto touch-none ${blurring ? "cursor-crosshair select-none" : ""}`}
              // 倍率 1 で表示領域に収まる幅（横幅か高さのどちらか狭いほう）を基準にする。
              style={{
                width: `calc(min(100%, max(100dvh - 17rem, 16rem) * 16 / 9) * ${previewScale})`,
              }}
              onPointerDown={(event) => {
                if (!blurring) return;
                event.currentTarget.setPointerCapture(event.pointerId);
                const { left, top, canvasX, canvasY } = pointOf(event);
                setDragBox({ canvasX, canvasY, startLeft: left, startTop: top, left, top });
              }}
              onPointerMove={(event) => {
                if (!dragBox) return;
                const { left, top } = pointOf(event);
                setDragBox({ ...dragBox, left, top });
              }}
              onPointerUp={finishBlur}
              onPointerCancel={() => setDragBox(null)}
            >
              <canvas
                ref={canvasRef}
                width={OUTPUT_WIDTH}
                height={OUTPUT_HEIGHT}
                aria-label="プレビュー"
                className="block aspect-video w-full rounded-lg object-contain"
              />
              {dragBox && (
                <div
                  aria-hidden
                  className="pointer-events-none absolute border-2 border-accent"
                  style={{
                    left: Math.min(dragBox.startLeft, dragBox.left),
                    top: Math.min(dragBox.startTop, dragBox.top),
                    width: Math.abs(dragBox.left - dragBox.startLeft),
                    height: Math.abs(dragBox.top - dragBox.startTop),
                  }}
                />
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <IconButton
              label={playing ? "一時停止" : "再生"}
              tone="primary"
              disabled={exporting}
              onClick={toggle}
            >
              {playing ? <PauseIcon /> : <PlayIcon />}
            </IconButton>
            {doc.narration.enabled && !playing && (
              <IconButton
                label={preparing ? "音声を準備中…" : "ナレーション付きで再生"}
                disabled={exporting || preparing}
                onClick={() => void playNarrated()}
              >
                {preparing ? <SpinnerIcon /> : <NarratedPlayIcon />}
              </IconButton>
            )}
            <span className="font-mono text-sm text-ink-2 tabular-nums">
              {formatTime(timeSec)} / {formatTime(totalDuration(doc))}
            </span>
            <div className="flex items-center gap-0.5" role="group" aria-label="プレビューの大きさ">
              <IconButton
                label="プレビューを縮小"
                hint="⌘ + ホイール"
                tone="quiet"
                size="sm"
                disabled={previewScale <= PREVIEW_SCALES[0]}
                onClick={() => zoomPreview(-1)}
              >
                <MinusIcon className="size-3.5" />
              </IconButton>
              <button
                type="button"
                title="画面に合わせる"
                onClick={() => zoomPreview(0)}
                className="min-w-12 rounded px-1 font-mono text-xs text-ink-2 tabular-nums hover:bg-rule hover:text-ink"
              >
                {Math.round(previewScale * 100)}%
              </button>
              <IconButton
                label="プレビューを拡大"
                hint="⌘ + ホイール"
                tone="quiet"
                size="sm"
                disabled={previewScale >= PREVIEW_SCALES[PREVIEW_SCALES.length - 1]}
                onClick={() => zoomPreview(1)}
              >
                <PlusIcon className="size-3.5" />
              </IconButton>
            </div>
            <div className="ml-auto flex flex-wrap gap-1">
              <IconButton
                label="画面の変化で手順を分ける"
                tone="quiet"
                disabled={exporting || generating}
                onClick={() => void startSceneSplit()}
              >
                <SceneSplitIcon />
              </IconButton>
              <IconButton
                label="ズーム"
                tone="quiet"
                onClick={() => edit((current) => addZoom(current, timeSec)?.doc ?? current)}
              >
                <ZoomIcon />
              </IconButton>
              <IconButton
                label={blurring ? "ぼかしをやめる" : "ぼかす"}
                aria-pressed={blurring}
                tone={blurring ? "primary" : "quiet"}
                disabled={exporting}
                onClick={() => {
                  if (playing) void toggle();
                  setBlurring((active) => !active);
                }}
              >
                <BlurIcon />
              </IconButton>
              <IconButton
                label="微調整"
                aria-expanded={timelineOpen}
                tone={timelineOpen ? "default" : "quiet"}
                onClick={() => setTimelineOpen((open) => !open)}
              >
                <TuneIcon />
              </IconButton>
              {generating ? (
                <IconButton label="生成を中止" align="end" onClick={() => captionAbortRef.current?.abort()}>
                  <StopIcon />
                </IconButton>
              ) : (
                <IconButton
                  label="AI で手順を作成"
                  align="end"
                  tone="primary"
                  disabled={exporting}
                  onClick={startCaptions}
                >
                  <SparkleIcon />
                </IconButton>
              )}
            </div>
          </div>

          <Assistant
            doc={doc}
            sources={source.urls}
            timeSec={timeSec}
            glossary={glossary}
            ended={!playing && timeSec >= totalDuration(doc) - END_MARGIN_SEC}
            disabled={exporting || generating}
            speechReady={!isDown(services, "whisper")}
            onListen={() => {
              if (playing) void toggle();
            }}
            onApply={({ doc: next, seekSec }) => {
              edit(() => next);
              if (seekSec !== undefined) seek(seekSec);
            }}
            onUndo={undo}
            onStartReview={() => {
              seek(0);
              void toggle();
            }}
          />

          {timelineOpen ? (
            <>
              <Timeline
                doc={doc}
                timeSec={timeSec}
                selectedZoomId={zoom?.id ?? null}
                selectedCaptionId={caption?.id ?? null}
                activity={captionActivity}
                onSeek={seek}
              />
              <div className="flex gap-1">
                <IconButton
                  label="キャプションを追加"
                  disabled={generating || caption !== null}
                  onClick={() => edit((current) => addCaption(current, timeSec))}
                >
                  <CaptionAddIcon />
                </IconButton>
                {/* 再生バーの「ここで分ける」と同じ操作。微調整を開いている間はこちらで分ける。 */}
                <IconButton
                  label="ここで手順を分ける"
                  hint={canSplit ? undefined : "（手順の途中に合わせると分けられます）"}
                  disabled={!canSplit}
                  onClick={() => edit((current) => splitAt(current, timeSec))}
                >
                  <SplitIcon />
                </IconButton>
              </div>
            </>
          ) : (
            <StepBar
              doc={doc}
              timeSec={timeSec}
              selectedClipId={selectedClipId}
              activity={captionActivity}
              editable={!exporting && !generating}
              onSeek={seek}
              onSelectStep={selectStep}
              onEdge={(clipId, edge, sourceSec) =>
                edit((current) => moveClipEdge(current, clipId, edge, sourceSec))
              }
              onMerge={(clipId) => edit((current) => mergeWithNext(current, clipId))}
              onSplit={() => edit((current) => splitAt(current, timeSec))}
            />
          )}
        </div>

        {inspectorOpen && (
          <Inspector
            services={services}
            doc={doc}
            assetId={currentClip.assetId}
            zoom={zoom}
            caption={captionSpan && bounds && { ...captionSpan, ...bounds }}
            glossary={glossary}
            onGlossary={setGlossary}
            onNarration={(patch) =>
              edit((current) => ({ ...current, narration: { ...current.narration, ...patch } }))
            }
            onBlurScope={(blurId, scope) => {
              const { sourceStartSec, sourceEndSec } = currentClip;
              edit((current) => {
                const blur = current.blurs.find((item) => item.id === blurId);
                if (!blur) return current;
                return scope === "all"
                  ? setBlurRange(current, blurId, 0, assetOf(current, blur.assetId).durationSec)
                  : setBlurRange(current, blurId, sourceStartSec, sourceEndSec);
              });
            }}
            onBlurStyle={(blurId, style) => edit((current) => setBlurStyle(current, blurId, style))}
            onBlurRemove={(blurId) => edit((current) => removeBlur(current, blurId))}
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
        )}
      </div>
    </main>
  );
}

type AddVideoPanelProps = {
  onAdd: (videos: NamedVideo[]) => Promise<void>;
  onClose: () => void;
};

// 編集中に動画を足す入口。開始画面と同じく、ファイル・画面の録画・キャプチャ機器から選べる。
function AddVideoPanel({ onAdd, onClose }: AddVideoPanelProps) {
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState<ScreenRecording | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const add = async (videos: NamedVideo[]) => {
    setBusy(true);
    setError(null);
    try {
      await onAdd(videos);
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusy(false);
    }
  };

  const startRecording = async () => {
    setError(null);
    try {
      const session = await startScreenRecording();
      setRecording(session);
      const blob = await session.finished;
      setRecording(null);
      await add([{ blob, name: `録画.${extensionFor(session.mimeType)}` }]);
    } catch (cause) {
      setRecording(null);
      // 共有ダイアログのキャンセルはエラーとして扱わない。
      if (cause instanceof DOMException && cause.name === "NotAllowedError") return;
      setError(messageOf(cause));
    }
  };

  const importFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const videos = filesOf(event.target.files);
    event.target.value = "";
    if (videos.length > 0) void add(videos);
  };

  return (
    <section
      aria-label="動画を追加"
      className="flex flex-col gap-2 rounded-lg bg-paper-2 px-4 py-3 text-sm"
    >
      <p className="text-ink-2">追加した動画は、手順の最後に入ります。並べ替えは手順パネルでできます。</p>
      {capturing ? (
        <CapturePanel
          onCancel={() => setCapturing(false)}
          onOpen={(blob, name) => add([{ blob, name }])}
        />
      ) : recording ? (
        <div className="flex gap-2">
          <button type="button" className={PRIMARY} onClick={recording.stop}>
            録画を止めて追加する
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <label
            className={`${BUTTON} cursor-pointer focus-within:outline-2 focus-within:outline-accent ${busy ? "pointer-events-none opacity-50" : ""}`}
          >
            {busy ? "読み込み中…" : "ファイルを選ぶ"}
            <input
              type="file"
              accept="video/*"
              multiple
              disabled={busy}
              className="sr-only"
              onChange={importFiles}
            />
          </label>
          <button type="button" className={BUTTON} disabled={busy} onClick={startRecording}>
            画面を録画
          </button>
          <button
            type="button"
            className={BUTTON}
            disabled={busy}
            onClick={() => {
              setError(null);
              setCapturing(true);
            }}
          >
            キャプチャ機器から録画
          </button>
          <button type="button" className={`${BUTTON} ml-auto`} disabled={busy} onClick={onClose}>
            閉じる
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="text-danger">
          {error}
        </p>
      )}
    </section>
  );
}

type ExportSettingsProps = {
  audio: ExportAudio;
  narrationAvailable: boolean;
  onChange: (audio: ExportAudio) => void;
  onCancel: () => void;
  onStart: () => void;
};

/** 両サイドのパネルの開閉に合わせた列構成。Tailwind が拾えるようにクラス名はそのまま書く。 */
function gridColumns(stepsOpen: boolean, inspectorOpen: boolean): string {
  if (stepsOpen && inspectorOpen) {
    return "lg:grid-cols-[20rem_minmax(0,1fr)] xl:grid-cols-[20rem_minmax(0,1fr)_16rem]";
  }
  if (stepsOpen) return "lg:grid-cols-[20rem_minmax(0,1fr)]";
  if (inspectorOpen) return "xl:grid-cols-[minmax(0,1fr)_16rem]";
  return "grid-cols-1";
}

function ExportSettings({
  audio,
  narrationAvailable,
  onChange,
  onCancel,
  onStart,
}: ExportSettingsProps) {
  const silent = !audio.narration && !audio.original;
  return (
    <section
      aria-label="書き出しの設定"
      className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg bg-paper-2 px-4 py-3 text-sm"
    >
      <span className="font-semibold">書き出す音声</span>
      <label
        className={`flex items-center gap-2 ${narrationAvailable ? "" : "text-ink-2 opacity-60"}`}
      >
        <input
          type="checkbox"
          className="size-4 accent-accent"
          checked={audio.narration}
          disabled={!narrationAvailable}
          onChange={(event) => onChange({ ...audio, narration: event.target.checked })}
        />
        ナレーション
      </label>
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          className="size-4 accent-accent"
          checked={audio.original}
          onChange={(event) => onChange({ ...audio, original: event.target.checked })}
        />
        録画の音
      </label>
      <span className="text-xs text-ink-2">
        {silent
          ? "音声なしで書き出します。"
          : !narrationAvailable
            ? "ナレーションは右の「ナレーション」をオンにすると選べます。"
            : ""}
      </span>
      <span className="ml-auto flex gap-2">
        <button type="button" className="rounded px-3 py-1.5 hover:bg-rule" onClick={onCancel}>
          キャンセル
        </button>
        <button
          type="button"
          className="rounded bg-accent px-3 py-1.5 font-semibold text-accent-ink hover:opacity-90"
          onClick={onStart}
        >
          書き出しを始める
        </button>
      </span>
    </section>
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
        書き出しが完了しました。動画はまだこのタブの中にあり、ファイルとして保存されていません。{" "}
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
        {state.message}
      </p>
    );
  }
  if (state.status === "done") {
    return (
      <p role="status" className="text-sm text-ink-2">
        {state.message}
      </p>
    );
  }
  return null;
}

// 進捗の文言と位置は別々に届くので、届いていない方は直前の値を引き継ぐ。
function runningOf(state: CaptionState) {
  return state.status === "running" ? state : { message: "" };
}

function messageOf(cause: unknown) {
  return cause instanceof Error ? cause.message : "予期しないエラーが発生しました。";
}
