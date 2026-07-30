import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { publishSearchEvidenceCommand } from "./publish-search-evidence.js";

const cleanupPaths: string[] = [];

afterEach(async () => {
  await Promise.all(
    cleanupPaths.splice(0).map((path) =>
      rm(path, { recursive: true, force: true })
    )
  );
});

describe("publishSearchEvidenceCommand", () => {
  it("requires one explicit input file", async () => {
    await expect(
      publishSearchEvidenceCommand({ argv: [], env: {} })
    ).rejects.toThrow("SEARCH_EVIDENCE_INPUT_REQUIRED");
    await expect(
      publishSearchEvidenceCommand({
        argv: ["--unknown", "value"],
        env: {}
      })
    ).rejects.toThrow("SEARCH_EVIDENCE_ARGUMENT_INVALID");
  });

  it("maps missing and malformed local files to safe errors", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "bread-map-evidence-command-")
    );
    cleanupPaths.push(directory);
    const malformedPath = join(directory, "malformed.json");
    await writeFile(malformedPath, "{");

    await expect(
      publishSearchEvidenceCommand({
        argv: ["--input", join(directory, "missing.json")],
        env: {}
      })
    ).rejects.toThrow("SEARCH_EVIDENCE_FILE_READ_FAILED");
    await expect(
      publishSearchEvidenceCommand({
        argv: ["--input", malformedPath],
        env: {}
      })
    ).rejects.toThrow("SEARCH_EVIDENCE_FILE_INVALID");
  });
});
