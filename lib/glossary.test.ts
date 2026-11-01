import { describe, expect, it } from "vitest";
import { formatGlossary, parseGlossary } from "./glossary";

describe("parseGlossary", () => {
  it("reads terms and optional readings", () => {
    expect(parseGlossary(" 楽楽精算 \n\nDemovie = デモービー\nSAP＝エスエーピー")).toEqual([
      { term: "楽楽精算", reading: "" },
      { term: "Demovie", reading: "デモービー" },
      { term: "SAP", reading: "エスエーピー" },
    ]);
  });

  it("drops duplicates and lines without a term", () => {
    const parsed = parseGlossary("SAP\nSAP = エスエーピー\n= 読みだけ");
    expect(parsed).toEqual([{ term: "SAP", reading: "" }]);
  });

  it("limits the number of terms", () => {
    const text = Array.from({ length: 150 }, (_, index) => `語${index}`).join("\n");
    expect(parseGlossary(text)).toHaveLength(100);
  });
});

describe("formatGlossary", () => {
  it("lists terms for the prompt", () => {
    expect(formatGlossary("楽楽精算\nDemovie=デモービー")).toBe(
      "楽楽精算\nDemovie（読み: デモービー）",
    );
    expect(formatGlossary("")).toBe("");
  });
});
