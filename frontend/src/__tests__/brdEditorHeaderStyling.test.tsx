import React from "react";
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import Scope from "../components/brd/Scope";
import Metadata from "../components/brd/Metadata";
import TOC from "../components/brd/TOC";
import Citation from "../components/brd/Citation";

describe("BRD editor header styling", () => {
  it("shows styled guidance headers in the Scope editor during upload/process flow", () => {
    render(
      <Scope
        initialData={{ in_scope: [], out_of_scope: [] }}
        citationStyleGuide={{
          description: "SME Checkpoint",
          rows: [{ label: "Product Owner", value: "Raut, Divya" }],
        }}
      />
    );

    expect(screen.getByText(/Innodata only - Document Title as appearing on regulator weblink/i)).toBeInTheDocument();
    expect(screen.getAllByText(/SME Checkpoint/i).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Citation Style Guide Link/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Product Owner/i)).not.toBeInTheDocument();
  });

  it("shows styled guidance headers in the Metadata editor during upload/process flow", () => {
    render(<Metadata format="new" initialData={{}} />);

    expect(screen.getByText(/Source text, date, image, or URL captured from the BRD/i)).toBeInTheDocument();
    expect(screen.getAllByText(/SME Checkpoint/i).length).toBeGreaterThan(0);
  });

  it("shows only TOC-specific fields in the TOC editor during upload/process flow", () => {
    const { rerender } = render(
      <TOC
        initialData={{
          sections: [],
          tocSortingOrder: "Sort numerically in descending order.",
          tocHidingLevels: "Level 8-14 not to be included in the TOC.",
          citationStyleGuide: {
            description: "SME Checkpoint",
            rows: [{ label: "Link", value: "https://example.com" }],
          },
        }}
      />
    );

    expect(screen.getByText(/Innodata only - From regulator website/i)).toBeInTheDocument();
    expect(screen.getByText(/For SMEs - To specify on how they want ToC to appear in ELA/i)).toBeInTheDocument();
    expect(screen.getByText(/ToC - Sorting Order/i)).toBeInTheDocument();
    expect(screen.getByText(/ToC - Hiding Level/i)).toBeInTheDocument();
    expect(screen.getByText(/Document Structure Levels/i)).toBeInTheDocument();
    expect(screen.queryByText(/Citation Style Guide Link/i)).not.toBeInTheDocument();

    rerender(<Citation initialData={{ references: [] }} />);

    expect(screen.getByText(/Include the levels and punctuation that should appear in ELA citations/i)).toBeInTheDocument();
  });
});
