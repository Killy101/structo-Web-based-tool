import { buildReuploadSummary } from "../app/dashboard/brd/reuploadSummary";

describe("buildReuploadSummary", () => {
  it("identifies changed sections and sections needing review after re-upload", () => {
    const summary = buildReuploadSummary(
      {
        title: "Original BRD",
        format: "new",
        status: "DRAFT",
        metadata: {
          content_category_name: "Payments",
          jurisdiction: "Europe",
          document_title: "PSD3",
          summary: "Original summary",
        },
        toc: { document_structure: ["1. Intro", "2. Scope"] },
        citations: { references: ["Ref A"] },
        contentProfile: { content_type: "Policy", target_audience: "Analysts" },
      },
      {
        title: "Updated BRD",
        format: "old",
        status: "DRAFT",
        metadata: {
          source_name: "Payments Source",
          jurisdiction: "Europe",
          document_title: "PSD3 Final",
        },
        toc: { document_structure: ["1. Intro", "2. Scope", "3. Metadata"] },
        citations: {},
        contentProfile: { content_type: "Policy" },
      },
      "final-upload.docx",
    );

    expect(summary.title).toBe("Updated BRD");
    expect(summary.changedSections).toEqual(expect.arrayContaining(["Metadata", "Document Structure", "Citations"]));
    expect(summary.sections.find((section) => section.key === "citations")?.status).toBe("Needs review");
    expect(summary.sections.find((section) => section.key === "metadata")?.status).toBe("Partially extracted");
    expect(summary.missingItems).toEqual(expect.arrayContaining(["Metadata: Summary", "Citations: References"]));
  });

  it("marks well-populated sections as extracted", () => {
    const summary = buildReuploadSummary(
      null,
      {
        title: "Healthy BRD",
        format: "new",
        status: "COMPLETED",
        scope: { in_scope: ["Topic A"], out_of_scope: ["Topic B"], checkpoints: ["Check 1"] },
        metadata: {
          content_category_name: "Safety",
          jurisdiction: "Global",
          document_title: "Safety Standard",
          summary: "Key obligations",
          content_type: "Regulation",
          target_audience: "Compliance",
        },
        toc: { document_structure: ["1", "2", "3", "4"] },
        citations: { references: ["ISO 1", "ISO 2", "ISO 3"] },
        contentProfile: { content_type: "Regulation", target_audience: "Compliance", language: "EN", region: "Global" },
      },
      "healthy.pdf",
    );

    expect(summary.sections.every((section) => section.status === "Extracted")).toBe(true);
    expect(summary.needsReviewCount).toBe(0);
  });
});
