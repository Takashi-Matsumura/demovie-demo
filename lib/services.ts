import { LLM_URL } from "./assistant";
import { VISION_URL } from "./captions";
import { WHISPER_URL } from "./speech";

export type ServiceId = "vision" | "llm" | "whisper" | "intent";

export type ServiceState = "ok" | "down" | "off";

export type ServiceStatus = { id: ServiceId; label: string; state: ServiceState; impact: string };

export const SERVICES: Omit<ServiceStatus, "state">[] = [
  { id: "vision", label: "画面の解析", impact: "「AI で手順を作成」が使えません。" },
  { id: "llm", label: "指示の解釈", impact: "AI への指示と、説明文を整える処理が使えません。" },
  { id: "whisper", label: "音声認識", impact: "音声の指示と「説明文を話す」が使えません。" },
  { id: "intent", label: "独り言の判定", impact: "判定を省いて、発話を指示として扱います。" },
];

const TIMEOUT_MS = 2000;

async function getJson(url: string): Promise<unknown> {
  const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!response.ok) throw new Error(String(response.status));
  return response.json();
}

// 別のモデルが動いていても正常に見えないよう、画像を扱えるかまで確かめる。
export function canReadImages(props: unknown) {
  const { modalities } = (props ?? {}) as { modalities?: { vision?: unknown } };
  return modalities?.vision === true;
}

const checks: Record<ServiceId, () => Promise<ServiceState>> = {
  vision: async () => (canReadImages(await getJson(`${VISION_URL}/props`)) ? "ok" : "down"),
  llm: async () => {
    await getJson(`${LLM_URL}/health`);
    return "ok";
  },
  whisper: async () => {
    await getJson(`${WHISPER_URL}/health`);
    return "ok";
  },
  // 判定は課金されるので実際には呼ばず、キーの有無だけを確かめる。
  intent: async () => {
    const { configured } = (await getJson("/api/intent")) as { configured?: boolean };
    return configured ? "ok" : "off";
  },
};

export async function checkServices(): Promise<ServiceStatus[]> {
  return Promise.all(
    SERVICES.map(async (service) => ({
      ...service,
      state: await checks[service.id]().catch((): ServiceState => "down"),
    })),
  );
}
