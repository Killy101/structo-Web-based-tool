import { derivedFormat, resolveProcessType } from "../routes/brd/crud";

describe("BRD process type derivation", () => {
  it("honors the stored BRD format so the type only changes when authorized edits change the BRD", () => {
    expect(derivedFormat("OLD", { content_category_name: "Imported value" })).toBe("old");
    expect(derivedFormat("NEW", { source_name: "Legacy source", source_type: "Regulation" })).toBe("new");
  });

  it("prefers an explicit admin-selected process type override when present", () => {
    expect(
      resolveProcessType("new", {
        process_type: "Updating - Evergreen",
        in_scope: [{ initial_evergreen: "Initial" }],
        out_of_scope: [],
      }),
    ).toBe("Updating - Evergreen");
  });

  it("derives the cadence from explicit Initial/Evergreen scope values", () => {
    expect(
      resolveProcessType("new", {
        in_scope: [{ initial_evergreen: "Initial" }],
        out_of_scope: [],
      }),
    ).toBe("New source - Initial");

    expect(
      resolveProcessType("old", {
        in_scope: [{ initial_evergreen: "Evergreen" }],
      }),
    ).toBe("Updating - Evergreen");
  });
});
