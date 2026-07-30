import { describe, expect, it } from "vitest";
import {
  expandApprovedSearchTerms,
  normalizeSearchText
} from "./normalize-query.js";

describe("normalizeSearchText", () => {
  it.each([
    {
      input: "  ＣＲＯＩＳＳＡＮＴ!!\u0000 ",
      normalizedText: "croissant",
      compactKey: "croissant"
    },
    {
      input: "홍대-입구 / 3번 출구",
      normalizedText: "홍대 입구 3번 출구",
      compactKey: "홍대입구3번출구"
    },
    {
      input: "  천연   발효빵 ",
      normalizedText: "천연 발효빵",
      compactKey: "천연발효빵"
    }
  ])(
    "normalizes $input deterministically",
    ({ input, normalizedText, compactKey }) => {
      expect(normalizeSearchText(input)).toEqual({
        normalizedText,
        compactKey
      });
    }
  );
});

describe("expandApprovedSearchTerms", () => {
  it.each([
    {
      input: "SOURDOUGH",
      expected: ["사워도우", "sourdough", "천연발효빵"]
    },
    {
      input: "크로와상",
      expected: ["크루아상", "크로와상", "croissant"]
    },
    {
      input: "패스트리",
      expected: ["페이스트리", "패스트리", "pastry"]
    },
    {
      input: "시오빵",
      expected: ["소금빵", "시오빵"]
    },
    {
      input: "baguette",
      expected: ["바게트", "baguette"]
    },
    {
      input: "loaf",
      expected: ["식빵", "loaf"]
    }
  ])("expands $input in approved order", ({ input, expected }) => {
    expect(
      expandApprovedSearchTerms(input).map(
        (term) => term.compactKey
      )
    ).toEqual(expected);
  });

  it("returns only the normalized unknown term", () => {
    expect(expandApprovedSearchTerms("  무화과 깜빠뉴 ")).toEqual([
      {
        normalizedText: "무화과 깜빠뉴",
        compactKey: "무화과깜빠뉴"
      }
    ]);
  });

  it("does not widen aliases across structured fields", () => {
    const regionAliases = ["홍대입구", "합정역"];
    const menuTerms = expandApprovedSearchTerms("소금빵").map(
      (term) => term.compactKey
    );

    expect(menuTerms).toEqual(["소금빵", "시오빵"]);
    expect(menuTerms).not.toEqual(
      expect.arrayContaining(regionAliases)
    );
  });
});
