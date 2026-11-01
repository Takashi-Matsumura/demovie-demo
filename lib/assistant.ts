import { z } from "zod";
import { commandListSchema, describeState, type Command } from "./commands";
import type { DemoDocument } from "./document";
import { formatGlossary } from "./glossary";

// 手元の llama-server を直接呼ぶ。指示の内容はこの PC の外へは出ない。
const LLM_URL = process.env.NEXT_PUBLIC_LLM_URL ?? "http://127.0.0.1:8080";

const SYSTEM_PROMPT = `あなたは説明動画エディタの操作担当です。ユーザーの指示を commands の JSON に変換します。
・「ここ」「今の」「これ」は playheadStep の手順を指す
・「短く」「丁寧に」「わかりやすく」などの文章の直しは、聞き返さず、現在の text を実際に書き換えて set_step_text の text に入れる
・本文に書き込むのは説明文だけで、指示の言葉は含めない
・「強く」「弱く」のようなズームの指示は、現在の zoomDepth を基準に 0.5 ほど増減する
・「最初」は 1、「最後」は最も大きい手順番号として扱う
・手順の指定に番号を使うときは、現在の手順番号をそのまま使う
・指示の順に commands を並べる
・「消して」のように映像が消える指示で、対象がはっきりしないときと、「いい感じに」のように何をすべきか判断できないときだけ clarify で聞き返す
操作:
set_step_text(step, text): 説明文を変更
delete_step(step): 手順を映像ごと削除
move_step(step, to): 手順を移動
split_here: 再生位置で手順を分ける
add_zoom: 再生位置にズームを追加
remove_zoom(step): ズームを削除
set_zoom_depth(step, depth): ズームの倍率を変更
seek_step(step): 手順へ移動
set_background(background): 背景を変更。dusk=夕闇 ember=残り火 slate=石板 paper=紙
undo: 直前の操作を元に戻す
clarify(question): 聞き返す`;

// 音声認識の聞き間違いは文脈で直せるので、用語は聞き取りのあとの工程で使う。
function glossaryRule(glossary: string) {
  const terms = formatGlossary(glossary);
  if (!terms) return "";
  return `\n音声認識の聞き間違いで、下の用語と読みが同じか近い語は、用語の表記に直して扱う。それ以外の語は変えない。\n用語:\n${terms}`;
}

type InterpretOptions = {
  transcript: string;
  glossary: string;
  doc: DemoDocument;
  timeSec: number;
  previousQuestion: string | null;
  signal: AbortSignal;
};

export async function interpret({
  transcript,
  glossary,
  doc,
  timeSec,
  previousQuestion,
  signal,
}: InterpretOptions): Promise<Command[]> {
  const context = previousQuestion ? `直前にあなたが聞き返した内容: ${previousQuestion}\n` : "";
  let response: Response;
  try {
    response = await fetch(`${LLM_URL}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal,
      body: JSON.stringify({
        messages: [
          { role: "system", content: SYSTEM_PROMPT + glossaryRule(glossary) },
          {
            role: "user",
            content: `現在の状態: ${JSON.stringify(describeState(doc, timeSec))}\n${context}指示: ${transcript}`,
          },
        ],
        temperature: 0.1,
        max_tokens: 400,
        // 思考を出力させると 1 回に 20 秒ほどかかり、音声操作の応答として遅すぎる。
        chat_template_kwargs: { enable_thinking: false },
        response_format: {
          type: "json_schema",
          json_schema: { schema: z.toJSONSchema(commandListSchema) },
        },
      }),
    });
  } catch (cause) {
    if (signal.aborted) throw cause;
    throw new Error(`AI サーバ（${LLM_URL}）に接続できません。起動しているか確認してください。`);
  }
  if (!response.ok) throw new Error(`AI サーバがエラーを返しました（${response.status}）。`);

  const data: { choices?: { message?: { content?: string } }[] } = await response.json();
  try {
    const content = JSON.parse(data.choices?.[0]?.message?.content ?? "");
    return commandListSchema.parse(content).commands;
  } catch {
    throw new Error("AI の返答を理解できませんでした。言い方を変えてお試しください。");
  }
}

const TIDY_PROMPT = `動画の説明文を担当します。話し言葉を、画面に表示する説明文に整えてください。
・「えーと」「あの」などのつなぎ言葉と、言い直しの前半を取り除く
・「ですます」の丁寧語にする
・話した内容だけを使い、情報を足さない。固有名詞、数字、ボタン名は変えない
・整えた説明文だけを出力する`;

const MAX_TIDY_GROWTH = 1.5;

// 話した内容より大幅に長い返答は、情報が足されている恐れがあるので使わない。
export function acceptTidied(spoken: string, tidied: string) {
  const text = tidied.trim();
  const limit = spoken.length * MAX_TIDY_GROWTH + 10;
  return text && text.length <= limit ? text : spoken;
}

// 整えられないときは話した言葉のまま使う。言葉そのものは聞き取れているので失わない。
export async function tidyNarration(spoken: string, glossary: string, signal: AbortSignal) {
  try {
    const response = await fetch(`${LLM_URL}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal,
      body: JSON.stringify({
        messages: [
          { role: "system", content: TIDY_PROMPT + glossaryRule(glossary) },
          { role: "user", content: spoken },
        ],
        temperature: 0.1,
        max_tokens: 300,
        chat_template_kwargs: { enable_thinking: false },
      }),
    });
    if (!response.ok) return spoken;
    const data: { choices?: { message?: { content?: string } }[] } = await response.json();
    return acceptTidied(spoken, data.choices?.[0]?.message?.content ?? "");
  } catch (cause) {
    if (signal.aborted) throw cause;
    return spoken;
  }
}
