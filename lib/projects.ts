import { documentSchema, LEGACY_ASSET_ID, type DemoDocument } from "./document";

const DB_NAME = "demovie";
const DB_VERSION = 1;
const PROJECTS = "projects";
const VIDEOS = "videos";

export type ProjectSummary = {
  id: string;
  name: string;
  updatedAt: number;
  durationSec: number;
  stepCount: number;
};

type ProjectRecord = { id: string; updatedAt: number; doc: DemoDocument };

/** 保存する動画。id は動画（asset）の ID。 */
export type StoredVideo = { id: string; blob: Blob };

// 動画本体はプロジェクトと動画の ID の組で保存する。
// 動画が 1 本だけだった頃の保存データは、プロジェクトの ID だけを鍵にしている。
function videoKey(projectId: string, assetId: string) {
  return assetId === LEGACY_ASSET_ID ? projectId : `${projectId}:${assetId}`;
}

function projectVideoRange(projectId: string) {
  return IDBKeyRange.bound(`${projectId}:`, `${projectId}:\uffff`);
}

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      // 一覧のたびに動画本体を読まないよう、ストアを分ける。
      request.result.createObjectStore(PROJECTS, { keyPath: "id" });
      request.result.createObjectStore(VIDEOS);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStores<T>(
  mode: IDBTransactionMode,
  run: (transaction: IDBTransaction) => IDBRequest<T> | void,
) {
  const database = await openDatabase();
  return new Promise<T | undefined>((resolve, reject) => {
    const transaction = database.transaction([PROJECTS, VIDEOS], mode);
    const request = run(transaction);
    transaction.oncomplete = () => {
      database.close();
      resolve(request ? request.result : undefined);
    };
    transaction.onabort = transaction.onerror = () => {
      database.close();
      reject(transaction.error);
    };
  });
}

/**
 * 一覧に出す要約。保存データは古い版のこともあるので、開くときと同じく新しい形へ直してから読む。
 * 読めない保存データがあっても一覧全体は壊さず、削除できるよう名前だけ出す。
 */
export function summaryOf({ id, updatedAt, doc: raw }: { id: string; updatedAt: number; doc: unknown }): ProjectSummary {
  const parsed = documentSchema.safeParse(raw);
  if (!parsed.success) {
    return { id, updatedAt, name: "（読み込めない作業）", durationSec: 0, stepCount: 0 };
  }
  const doc = parsed.data;
  return {
    id,
    updatedAt,
    name:
      doc.assets.length > 1
        ? `${doc.assets[0].name} ほか ${doc.assets.length - 1} 本`
        : doc.assets[0].name,
    // 一覧には仕上がりの長さを出す。動画に含めない手順は数えず、チャプター画面は数える。
    durationSec: doc.clips
      .filter((clip) => !clip.hidden)
      .reduce(
        (total, clip) =>
          total + (clip.chapter?.durationSec ?? 0) + clip.sourceEndSec - clip.sourceStartSec,
        0,
      ),
    stepCount: doc.clips.length,
  };
}

export async function listProjects() {
  const records = await withStores<ProjectRecord[]>("readonly", (transaction) =>
    transaction.objectStore(PROJECTS).getAll(),
  );
  return (records ?? []).map(summaryOf).sort((a, b) => b.updatedAt - a.updatedAt);
}

export function createProject(id: string, doc: DemoDocument, videos: StoredVideo[]) {
  return withStores("readwrite", (transaction) => {
    for (const video of videos) {
      transaction.objectStore(VIDEOS).put(video.blob, videoKey(id, video.id));
    }
    transaction.objectStore(PROJECTS).put({ id, updatedAt: Date.now(), doc });
  });
}

/** 編集中に足した動画を保存する。作業内容（doc）は自動保存で別に保存される。 */
export function addProjectVideos(id: string, videos: StoredVideo[]) {
  return withStores("readwrite", (transaction) => {
    for (const video of videos) {
      transaction.objectStore(VIDEOS).put(video.blob, videoKey(id, video.id));
    }
  });
}

export function saveProject(id: string, doc: DemoDocument) {
  return withStores("readwrite", (transaction) => {
    transaction.objectStore(PROJECTS).put({ id, updatedAt: Date.now(), doc });
  });
}

export async function loadProject(id: string) {
  const database = await openDatabase();
  const record = await new Promise<ProjectRecord | undefined>((resolve, reject) => {
    const transaction = database.transaction([PROJECTS], "readonly");
    const project = transaction.objectStore(PROJECTS).get(id);
    transaction.oncomplete = () => resolve(project.result);
    transaction.onabort = transaction.onerror = () => reject(transaction.error);
  });
  const parsed = documentSchema.safeParse(record?.doc);
  if (!parsed.success) {
    database.close();
    throw new Error("保存データを読み込めませんでした。");
  }
  const doc = parsed.data;
  const blobs = await new Promise<(Blob | undefined)[]>((resolve, reject) => {
    const transaction = database.transaction([VIDEOS], "readonly");
    const requests = doc.assets.map((asset) =>
      transaction.objectStore(VIDEOS).get(videoKey(id, asset.id)),
    );
    transaction.oncomplete = () => resolve(requests.map((request) => request.result));
    transaction.onabort = transaction.onerror = () => reject(transaction.error);
  });
  database.close();
  const videos: StoredVideo[] = [];
  for (const [index, asset] of doc.assets.entries()) {
    const blob = blobs[index];
    if (!blob) throw new Error(`動画「${asset.name}」の保存データが見つかりませんでした。`);
    videos.push({ id: asset.id, blob });
  }
  return { doc, videos };
}

export function deleteProject(id: string) {
  return withStores("readwrite", (transaction) => {
    transaction.objectStore(PROJECTS).delete(id);
    transaction.objectStore(VIDEOS).delete(id);
    transaction.objectStore(VIDEOS).delete(projectVideoRange(id));
  });
}
