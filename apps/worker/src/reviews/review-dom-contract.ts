import { readFile } from "node:fs/promises";
import { z } from "zod";

export interface ReviewDomContract {
  version: "kakao-review-dom-v2";
  paginationMode: "append" | "replace";
  reviewItem: string;
  body: string;
  rating: string;
  publishedDate: string;
  nickname: string;
  nextButton: string;
  loginWall: string;
  captcha: string;
  accessDenial: string;
}

export class ReviewDomContractError extends Error {
  readonly code = "REVIEW_DOM_CONTRACT_INVALID";

  constructor() {
    super("REVIEW_DOM_CONTRACT_INVALID");
    this.name = "ReviewDomContractError";
  }
}

const safeSelectorSchema = z
  .string()
  .trim()
  .min(1)
  .max(256)
  .refine(
    (selector) =>
      !/(?:script|iframe|https?:\/\/|data:|javascript:)/iu.test(
        selector
      )
  );

const reviewDomContractSchema = z
  .object({
    version: z.literal("kakao-review-dom-v2"),
    paginationMode: z.enum(["append", "replace"]),
    reviewItem: safeSelectorSchema,
    body: safeSelectorSchema,
    rating: safeSelectorSchema,
    publishedDate: safeSelectorSchema,
    nickname: safeSelectorSchema,
    nextButton: safeSelectorSchema,
    loginWall: safeSelectorSchema,
    captcha: safeSelectorSchema,
    accessDenial: safeSelectorSchema
  })
  .strict();

export async function loadReviewDomContract(
  path: string
): Promise<ReviewDomContract> {
  try {
    const text = await readFile(path, "utf8");
    return reviewDomContractSchema.parse(JSON.parse(text));
  } catch {
    throw new ReviewDomContractError();
  }
}
