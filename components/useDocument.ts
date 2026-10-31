"use client";

import { useCallback, useState } from "react";
import { documentSchema, type DemoDocument } from "@/lib/document";

type History = { past: DemoDocument[]; present: DemoDocument | null; future: DemoDocument[] };

const EMPTY: History = { past: [], present: null, future: [] };

// 編集は必ずここを通す。スキーマ検証を通らない変更は反映しない。
export function useDocument() {
  const [history, setHistory] = useState<History>(EMPTY);

  const load = useCallback((doc: DemoDocument) => {
    setHistory({ past: [], present: documentSchema.parse(doc), future: [] });
  }, []);

  const edit = useCallback((change: (doc: DemoDocument) => DemoDocument) => {
    setHistory((current) => {
      if (!current.present) return current;
      const next = change(current.present);
      if (next === current.present || !documentSchema.safeParse(next).success) return current;
      return { past: [...current.past, current.present], present: next, future: [] };
    });
  }, []);

  const undo = useCallback(() => {
    setHistory((current) => {
      const previous = current.past.at(-1);
      if (!previous || !current.present) return current;
      return {
        past: current.past.slice(0, -1),
        present: previous,
        future: [current.present, ...current.future],
      };
    });
  }, []);

  const redo = useCallback(() => {
    setHistory((current) => {
      const [next, ...future] = current.future;
      if (!next || !current.present) return current;
      return { past: [...current.past, current.present], present: next, future };
    });
  }, []);

  const reset = useCallback(() => setHistory(EMPTY), []);

  return {
    doc: history.present,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    load,
    edit,
    undo,
    redo,
    reset,
  };
}
