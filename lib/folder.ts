import { z } from "zod";
import { documentSchema, type Asset, type DemoDocument } from "./document";

// 作業をフォルダにまとめて保存する形式。ブラウザの保存領域とは別に、手元に残して開き直せるようにする。
//
//   <フォルダ>/
//     project.json        作業データ（manifest）
//     videos/01_xxx.mp4   使っている動画。名前は project.json の videos に書く
//
// 動画の名前は人が見て分かるよう、並び順と元の名前から付ける。

export const MANIFEST_FILE = "project.json";
export const VIDEO_DIR = "videos";
const FORMAT = "demovie-project";
const FORMAT_VERSION = 1;

const manifestSchema = z.object({
  format: z.literal(FORMAT),
  version: z.literal(FORMAT_VERSION),
  projectId: z.string(),
  savedAt: z.number(),
  // 動画（asset）の ID ごとの、フォルダの中での場所。
  videos: z.record(z.string(), z.string()),
  doc: z.unknown(),
});

export type ProjectManifest = Omit<z.infer<typeof manifestSchema>, "doc"> & { doc: DemoDocument };

// ファイル名に使えない文字を避ける。拡張子が無ければ動画の種類から補う。
export function videoFileName(index: number, asset: Asset, mimeType = "") {
  const safe = asset.name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").trim() || "video";
  const hasExtension = /\.[a-z0-9]{2,5}$/i.test(safe);
  const extension = hasExtension ? "" : mimeType.includes("webm") ? ".webm" : ".mp4";
  return `${String(index + 1).padStart(2, "0")}_${safe}${extension}`;
}

export function buildManifest(
  projectId: string,
  doc: DemoDocument,
  mimeTypes: Record<string, string> = {},
  savedAt = Date.now(),
): ProjectManifest {
  const videos = Object.fromEntries(
    doc.assets.map((asset, index) => [
      asset.id,
      `${VIDEO_DIR}/${videoFileName(index, asset, mimeTypes[asset.id])}`,
    ]),
  );
  return { format: FORMAT, version: FORMAT_VERSION, projectId, savedAt, videos, doc };
}

/** project.json を読む。作業データは保存領域と同じく、古い版でも新しい形へ直して受け取る。 */
export function parseManifest(json: unknown): ProjectManifest {
  const manifest = manifestSchema.safeParse(json);
  if (!manifest.success) throw new Error("Demovie のプロジェクトフォルダではありません。");
  const doc = documentSchema.safeParse(manifest.data.doc);
  if (!doc.success) throw new Error("プロジェクトの作業データを読み込めませんでした。");
  for (const asset of doc.data.assets) {
    const path = manifest.data.videos[asset.id];
    if (!path || !isInsideFolder(path)) {
      throw new Error(`動画「${asset.name}」の場所が project.json に書かれていません。`);
    }
  }
  return { ...manifest.data, doc: doc.data };
}

// フォルダの外を指す場所（../ や絶対パス）は読まない。
function isInsideFolder(path: string) {
  const parts = path.split("/");
  return parts.length > 0 && parts.every((part) => part !== "" && part !== "." && part !== "..");
}

// --- ここから下はブラウザでフォルダを読み書きする部分 ---

type PermissionMode = { mode: "read" | "readwrite" };
type PermissionedHandle = FileSystemDirectoryHandle & {
  queryPermission?: (options: PermissionMode) => Promise<PermissionState>;
  requestPermission?: (options: PermissionMode) => Promise<PermissionState>;
};
type DirectoryPicker = (options?: { id?: string; mode?: "read" | "readwrite" }) => Promise<FileSystemDirectoryHandle>;

export function canUseFolders() {
  return typeof window !== "undefined" && "showDirectoryPicker" in window;
}

/** フォルダを選んでもらう。キャンセルされたら null。 */
export async function pickFolder(mode: "read" | "readwrite") {
  if (!canUseFolders()) {
    throw new Error("このブラウザはフォルダの読み書きに対応していません。デスクトップ版の Chrome か Edge を使ってください。");
  }
  const picker = (window as unknown as { showDirectoryPicker: DirectoryPicker }).showDirectoryPicker;
  try {
    return await picker({ id: "demovie-project", mode });
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === "AbortError") return null;
    throw cause;
  }
}

/** 覚えておいたフォルダに書き込めるか確かめ、必要なら許可を求める。 */
export async function ensurePermission(handle: FileSystemDirectoryHandle, mode: "read" | "readwrite") {
  const target = handle as PermissionedHandle;
  if (!target.queryPermission || !target.requestPermission) return true;
  if ((await target.queryPermission({ mode })) === "granted") return true;
  return (await target.requestPermission({ mode })) === "granted";
}

async function fileAt(root: FileSystemDirectoryHandle, path: string, create: boolean) {
  const parts = path.split("/");
  let dir = root;
  for (const part of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(part, { create });
  return dir.getFileHandle(parts[parts.length - 1], { create });
}

async function writeFile(root: FileSystemDirectoryHandle, path: string, data: Blob | string) {
  const handle = await fileAt(root, path, true);
  const writable = await handle.createWritable();
  try {
    await writable.write(data);
  } finally {
    await writable.close();
  }
}

async function existingSize(root: FileSystemDirectoryHandle, path: string) {
  try {
    return (await (await fileAt(root, path, false)).getFile()).size;
  } catch {
    return null;
  }
}

type IterableDirectory = FileSystemDirectoryHandle & { keys: () => AsyncIterable<string> };

// OS が勝手に作るファイルは、空のフォルダかどうかの判定で数えない。
const IGNORED_ENTRIES = new Set([".DS_Store", "Thumbs.db", "desktop.ini"]);

/**
 * 保存してよいフォルダか確かめる。別の作業のフォルダや、関係のないファイルがあるフォルダには書かない。
 * 選び間違えたときに、ほかのファイルを上書きしたり散らかしたりしないため。
 */
async function assertSaveTarget(root: FileSystemDirectoryHandle, projectId: string) {
  let manifest: unknown = null;
  try {
    manifest = JSON.parse(await (await (await root.getFileHandle(MANIFEST_FILE)).getFile()).text());
  } catch {
    manifest = null;
  }
  if (manifest !== null) {
    const parsed = manifestSchema.safeParse(manifest);
    if (parsed.success && parsed.data.projectId === projectId) return;
    throw new Error("別の作業が保存されているフォルダです。空のフォルダか、この作業を保存したフォルダを選んでください。");
  }
  for await (const name of (root as IterableDirectory).keys()) {
    if (!IGNORED_ENTRIES.has(name)) {
      throw new Error("ほかのファイルがあるフォルダには保存できません。空のフォルダを選んでください。");
    }
  }
}

/**
 * 作業をフォルダに保存する。動画は同じ大きさのファイルがすでにあれば書き直さない（上書き保存を速くするため）。
 * project.json は最後に書く。途中で失敗しても、前の project.json と動画の組み合わせが残る。
 */
export async function saveToFolder(
  root: FileSystemDirectoryHandle,
  projectId: string,
  doc: DemoDocument,
  blobOf: (assetId: string) => Promise<Blob>,
  onProgress?: (message: string) => void,
) {
  await assertSaveTarget(root, projectId);
  const blobs = new Map<string, Blob>();
  for (const asset of doc.assets) blobs.set(asset.id, await blobOf(asset.id));
  const mimeTypes = Object.fromEntries([...blobs].map(([id, blob]) => [id, blob.type]));
  const manifest = buildManifest(projectId, doc, mimeTypes);
  for (const [index, asset] of doc.assets.entries()) {
    const path = manifest.videos[asset.id];
    const blob = blobs.get(asset.id);
    if (!blob) continue;
    if ((await existingSize(root, path)) === blob.size) continue;
    onProgress?.(`動画を保存中 ${index + 1} / ${doc.assets.length}`);
    await writeFile(root, path, blob);
  }
  await writeFile(root, MANIFEST_FILE, JSON.stringify(manifest, null, 2));
  return manifest;
}

/** フォルダから作業と動画を読む。 */
export async function readFolder(root: FileSystemDirectoryHandle) {
  let json: unknown;
  try {
    const text = await (await (await root.getFileHandle(MANIFEST_FILE)).getFile()).text();
    json = JSON.parse(text);
  } catch {
    throw new Error(`フォルダに ${MANIFEST_FILE} が見つかりませんでした。Demovie で保存したフォルダを選んでください。`);
  }
  const manifest = parseManifest(json);
  const videos: { id: string; blob: Blob }[] = [];
  for (const asset of manifest.doc.assets) {
    const path = manifest.videos[asset.id];
    try {
      videos.push({ id: asset.id, blob: await (await fileAt(root, path, false)).getFile() });
    } catch {
      throw new Error(`動画「${path}」がフォルダに見つかりませんでした。`);
    }
  }
  return { manifest, videos };
}
