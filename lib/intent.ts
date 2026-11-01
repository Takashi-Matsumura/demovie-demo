// 指示を取りこぼすほうが不便なので、はっきり雑談と判定されたときだけ止める。
const CHATTER_THRESHOLD = 0.7;

export function isChatter(probability: number) {
  return probability >= CHATTER_THRESHOLD;
}

// 判定できないときは指示として扱う。編集は元に戻せるので、音声操作そのものを止めない。
export async function classifyIntent(text: string, signal: AbortSignal) {
  try {
    const response = await fetch("/api/intent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal,
      body: JSON.stringify({ text }),
    });
    if (!response.ok) return "instruction";
    const data: { chatter?: number } = await response.json();
    return isChatter(data.chatter ?? 0) ? "chatter" : "instruction";
  } catch (cause) {
    if (signal.aborted) throw cause;
    return "instruction";
  }
}
