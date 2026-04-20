import { derivedFormat } from "../routes/brd/crud";
import {
  sanitizeStoredBrdConfig,
  serializeBrdSectionsForStorage,
} from "../lib/brdUploadStorage";

describe("BRD re-upload overwrite helpers", () => {
  it("removes runtime-only config keys before persisting a BRD", () => {
    expect(
      sanitizeStoredBrdConfig({
        pathTransform: { sample: true },
        path_transform: { legacy: true },
        levelPatterns: { two: ["x"] },
        level_patterns: { three: ["y"] },
        keepMe: "final-value",
      }),
    ).toEqual({ keepMe: "final-value" });
  });

  it("serializes missing sections as null so a final BRD clears stale draft content", () => {
    const stored = serializeBrdSectionsForStorage({
      scope: null as never,
      metadata: { document_title: "Final BRD" },
      toc: {} as Record<string, unknown>,
      citations: null as never,
      content_profile: null as never,
      brd_config: {
        levelPatterns: { shouldDrop: true },
        displayMode: "final",
      },
    });

    expect(stored.scope).toBe("null");
    expect(stored.citations).toBe("null");
    expect(stored.contentProfile).toBe("null");
    expect(stored.metadata).toBe(JSON.stringify({ document_title: "Final BRD" }));
    expect(stored.cleanBrdConfig).toEqual({ displayMode: "final" });
  });

  it("preserves existing metadata when the re-upload extractor returns an empty metadata block", () => {
    const stored = serializeBrdSectionsForStorage(
      {
        metadata: {} as Record<string, unknown>,
        scope: { in_scope: [] },
      },
      {
        metadata: {
          source_name: "Japan Investment Advisers Association",
          source_name_sme_checkpoint: "Validate the source name",
          content_uri: "https://example.com/jiaa.pdf",
        },
      },
    );

    expect(stored.metadata).toBe(
      JSON.stringify({
        source_name: "Japan Investment Advisers Association",
        source_name_sme_checkpoint: "Validate the source name",
        content_uri: "https://example.com/jiaa.pdf",
      }),
    );
  });

  it("derives the old BRD format from source-name metadata even if the stored format says new", () => {
    expect(
      derivedFormat("new", {
        source_name: "Japan Investment Advisers Association",
      }),
    ).toBe("old");
  });
});
