import { mergeWithPreservedSections, validateMetajsonSchema } from "@/lib/metajsonValidation";

describe("metajson validation", () => {
  const fullNewSchema = {
    name: "The Diet (JP.Diet) Acts",
    files: { file0001: { name: "" } },
    rootPath: "/JP/JPDietActs",
    meta: {
      "Content Category Name": "The Diet (JP.Diet) Acts",
      "Publication Date": "{iso-date}",
      "Last Updated Date": "{iso-date}",
      "Processing Date": "{iso-date}",
      "Issuing Agency": "Diet (JP.Diet)",
      "Content URI": "{string}",
      "Geography": "Japan",
      "Language": "Japanese",
      "Delivery Type": "{string}",
      "Unique File Id": "{string}",
      "Tag Set": { requiredLevels: [], allowedLevels: [] },
    },
    levelRange: [2, 17],
    headingRequired: [2],
    childLevelSameAsParent: false,
    childLevelLessThanParent: false,
    levelPatterns: { "2": ["^.*$"] },
    whitespaceHandling: { "0": ["2"], "1": [], "2": [] },
    headingAnnotation: ["2"],
    tagSet: { headingFromLevels: [], appliedToLevels: [] },
    parentalGuidance: [0, 0],
    requiredLevels: [2],
    pathTransform: { "2": { patterns: [["foo", "bar", 0, ""]], case: "" } },
    custom_toc: { "2": { tags: "title", patterns: [] } },
  };

  const fullLegacySchema = {
    ...fullNewSchema,
    name: "BR.ANBIMA Regras",
    meta: {
      "Source Name": "BR.ANBIMA Regras",
      "Source Type": "Free",
      "Publication Date": "{iso-date}",
      "Last Updated Date": "{iso-date}",
      "Processing Date": "{iso-date}",
      "Issuing Agency": "ANBIMA",
      "Content URI": "{string}",
      "Geography": "Brazil",
      "Language": "Portuguese",
      "Payload Subtype": "Regras",
      "Status": "Effective",
      "Delivery Type": "{string}",
      "Unique File Id": "{string}",
      "Tag Set": { requiredLevels: [], allowedLevels: [] },
    },
  };

  it("accepts engineering-style new schema for innod", () => {
    const result = validateMetajsonSchema(fullNewSchema, { requireTransforms: true });
    expect(result.valid).toBe(true);
  });

  it("accepts engineering-style legacy schema for innod", () => {
    const result = validateMetajsonSchema(fullLegacySchema, { requireTransforms: true });
    expect(result.valid).toBe(true);
  });

  it("accepts simplified schema for simple metajson", () => {
    const { levelPatterns, pathTransform, custom_toc, ...simple } = fullNewSchema;
    void levelPatterns;
    void pathTransform;
    void custom_toc;

    const result = validateMetajsonSchema(simple, { requireTransforms: false });
    expect(result.valid).toBe(true);
  });

  it("requires transform sections for innod validation", () => {
    const { levelPatterns, pathTransform, ...simple } = fullNewSchema;
    void levelPatterns;
    void pathTransform;

    const result = validateMetajsonSchema(simple, { requireTransforms: true });
    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toMatch(/levelPatterns|pathTransform/i);
  });

  it("preserves stripped sections when merging simple edits", () => {
    const editedSimple = {
      ...fullNewSchema,
      name: "Updated Title",
      meta: {
        ...fullNewSchema.meta,
        "Content Category Name": "Updated Title",
      },
    } as Record<string, unknown>;
    delete editedSimple.levelPatterns;
    delete editedSimple.pathTransform;
    delete editedSimple.custom_toc;

    const merged = mergeWithPreservedSections(editedSimple, fullNewSchema as Record<string, unknown>);

    expect(merged.name).toBe("Updated Title");
    expect((merged.meta as Record<string, unknown>)["Content Category Name"]).toBe("Updated Title");
    expect(merged.levelPatterns).toEqual(fullNewSchema.levelPatterns);
    expect(merged.pathTransform).toEqual(fullNewSchema.pathTransform);
    expect(merged.custom_toc).toEqual(fullNewSchema.custom_toc);
  });
});
