const STORAGE_KEY = "demovie:glossary";
const MAX_TERMS = 100;

export type Term = { term: string; reading: string };

// 1 行に 1 語。「Demovie = デモービー」のように読みも書ける。
export function parseGlossary(text: string) {
  const terms = new Map<string, Term>();
  for (const line of text.split("\n")) {
    const [term = "", reading = ""] = line.split(/[=＝]/).map((part) => part.trim());
    if (term && !terms.has(term)) terms.set(term, { term, reading });
  }
  return [...terms.values()].slice(0, MAX_TERMS);
}

export function formatGlossary(text: string) {
  return parseGlossary(text)
    .map(({ term, reading }) => (reading ? `${term}（読み: ${reading}）` : term))
    .join("\n");
}

// 保存できない環境でも編集は続けられるので、読み書きの失敗は無視する。
export function loadGlossary() {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

export function saveGlossary(text: string) {
  try {
    localStorage.setItem(STORAGE_KEY, text);
  } catch {
    // 次回の起動で読めないだけなので、編集は止めない。
  }
}
