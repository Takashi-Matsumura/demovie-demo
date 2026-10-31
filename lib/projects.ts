import { documentSchema, type DemoDocument } from "./document";

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

function summaryOf({ id, updatedAt, doc }: ProjectRecord): ProjectSummary {
  return {
    id,
    updatedAt,
    name: doc.asset.name,
    durationSec: doc.clips.reduce(
      (total, clip) => total + clip.sourceEndSec - clip.sourceStartSec,
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

export function createProject(id: string, doc: DemoDocument, video: Blob) {
  return withStores("readwrite", (transaction) => {
    transaction.objectStore(VIDEOS).put(video, id);
    transaction.objectStore(PROJECTS).put({ id, updatedAt: Date.now(), doc });
  });
}

export function saveProject(id: string, doc: DemoDocument) {
  return withStores("readwrite", (transaction) => {
    transaction.objectStore(PROJECTS).put({ id, updatedAt: Date.now(), doc });
  });
}

export async function loadProject(id: string) {
  const database = await openDatabase();
  const [record, video] = await new Promise<[ProjectRecord | undefined, Blob | undefined]>(
    (resolve, reject) => {
      const transaction = database.transaction([PROJECTS, VIDEOS], "readonly");
      const project = transaction.objectStore(PROJECTS).get(id);
      const blob = transaction.objectStore(VIDEOS).get(id);
      transaction.oncomplete = () => resolve([project.result, blob.result]);
      transaction.onabort = transaction.onerror = () => reject(transaction.error);
    },
  );
  database.close();
  const parsed = documentSchema.safeParse(record?.doc);
  if (!parsed.success || !video) throw new Error("保存データを読み込めませんでした。");
  return { doc: parsed.data, video };
}

export function deleteProject(id: string) {
  return withStores("readwrite", (transaction) => {
    transaction.objectStore(PROJECTS).delete(id);
    transaction.objectStore(VIDEOS).delete(id);
  });
}
