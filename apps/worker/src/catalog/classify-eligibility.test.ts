import {
  brandEligibilityEvidenceSchema,
  canonicalStoreCandidateSchema
} from "@bread-map/contracts";
import { storeEligibilityCases } from "@bread-map/testkit";
import { describe, expect, it } from "vitest";
import { classifyEligibility } from "./classify-eligibility.js";

describe("store eligibility classification", () => {
  it.each(storeEligibilityCases)(
    "$name",
    ({ input, expected }) => {
      const result = classifyEligibility({
        bakeryId: input.bakeryId,
        stores: input.stores.map((store) =>
          canonicalStoreCandidateSchema.parse(store)
        ),
        evidence: brandEligibilityEvidenceSchema.parse(
          input.evidence
        )
      });

      expect(result).toMatchObject({
        classification: expected.classification,
        status: expected.status
      });
      expect(
        result.reasons.map((reason) => reason.code)
      ).toEqual(
        expect.arrayContaining([...expected.reasonCodes])
      );
    }
  );
});
