"use client";

import { useCallback, useState } from "react";
import { loadGlossary, saveGlossary } from "@/lib/glossary";

export function useGlossary() {
  const [glossary, setGlossary] = useState(loadGlossary);

  const update = useCallback((text: string) => {
    setGlossary(text);
    saveGlossary(text);
  }, []);

  return [glossary, update] as const;
}
