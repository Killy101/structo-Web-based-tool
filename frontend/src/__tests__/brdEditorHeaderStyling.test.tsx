import React from "react";
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import Scope from "../components/brd/Scope";
import Metadata from "../components/brd/Metadata";
import TOC from "../components/brd/TOC";
import Citation from "../components/brd/Citation";

describe("BRD editor header styling", () => {
  it("shows styled guidance headers in the Scope editor during upload/process flow", () => {
    render(<Scope initialData={{ in_scope: [], out_of_scope: [] }} />);

    expect(screen.getByText(/Innodata only - Document Title as appearing on regulator weblink/i)).toBeInTheDocument();
    expect(screen.getByText(/SME Checkpoint/i)).toBeInTheDocument();
  });

  it("shows styled guidance headers in the Metadata editor during upload/process flow", () => {
    render(<Metadata format="new" initialData={{}} />);

    expect(screen.getByText(/Source text, date, image, or URL captured from the BRD/i)).toBeInTheDocument();
    expect(screen.getAllByText(/SME Checkpoint/i).length).toBeGreaterThan(0);
  });

  it("shows styled guidance headers in the TOC and Citation editors during upload/process flow", () => {
    const { rerender } = render(<TOC initialData={{ sections: [] }} />);

    expect(screen.getByText(/Innodata only - From regulator website/i)).toBeInTheDocument();
    expect(screen.getByText(/For SMEs - To specify on how they want ToC to appear in ELA/i)).toBeInTheDocument();

    rerender(<Citation initialData={{ references: [] }} />);

    expect(screen.getByText(/Include the levels and punctuation that should appear in ELA citations/i)).toBeInTheDocument();
  });
});
