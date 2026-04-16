import React from "react";
import "@testing-library/jest-dom";
import { render, screen, waitFor, within } from "@testing-library/react";
import Metadata from "../components/brd/Metadata";
import Scope from "../components/brd/Scope";
import ContentProfile from "../components/brd/ContentProf";
import api from "@/app/lib/api";

jest.mock("@/app/lib/api", () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
    delete: jest.fn(),
    put: jest.fn(),
  },
}));

describe("BRD image placement regressions", () => {
  const mockedApi = api as jest.Mocked<typeof api>;

  beforeAll(() => {
    class MockIntersectionObserver {
      observe() {}
      disconnect() {}
      unobserve() {}
    }
    Object.defineProperty(window, "IntersectionObserver", {
      writable: true,
      configurable: true,
      value: MockIntersectionObserver,
    });
    Object.defineProperty(global, "IntersectionObserver", {
      writable: true,
      configurable: true,
      value: MockIntersectionObserver,
    });
  });

  beforeEach(() => {
    mockedApi.get.mockReset();
    mockedApi.delete.mockReset();
    mockedApi.put.mockReset();
  });

  it("keeps a metadata image in the correct field instead of duplicating it into other rows", async () => {
    mockedApi.get.mockResolvedValue({
      data: {
        images: [
          {
            id: 701,
            tableIndex: 5,
            rowIndex: 1,
            colIndex: 1,
            rid: "rId701",
            mediaName: "source-name.png",
            mimeType: "image/png",
            cellText: "Source",
            section: "metadata",
            fieldLabel: "",
          },
        ],
      },
    } as never);

    render(<Metadata format="old" brdId="BRD-123" initialData={{}} />);

    await waitFor(() => {
      expect(screen.getByAltText(/source/i)).toBeInTheDocument();
    });

    expect(screen.getAllByAltText(/source/i)).toHaveLength(1);

    const sourceNameRow = screen.getByText(/source name/i).closest("tr");
    const sourceTypeRow = screen.getByText(/source type/i).closest("tr");

    expect(sourceNameRow).not.toBeNull();
    expect(sourceTypeRow).not.toBeNull();
    expect(within(sourceNameRow as HTMLElement).getByAltText(/source/i)).toBeInTheDocument();
    expect(within(sourceTypeRow as HTMLElement).queryByAltText(/source/i)).not.toBeInTheDocument();
  });

  it("does not show a fake scope checkpoint image that actually came from a table field", async () => {
    mockedApi.get
      .mockResolvedValueOnce({
        data: {
          images: [
            {
              id: 801,
              tableIndex: 3,
              rowIndex: 8,
              colIndex: 2,
              rid: "rId801",
              mediaName: "wrong-scope-checkpoint.png",
              mimeType: "image/png",
              cellText: "SME Checkpoint",
              section: "scope",
              fieldLabel: "SME Checkpoint",
            },
          ],
        },
      } as never);

    render(<Scope initialData={{ in_scope: [], out_of_scope: [], smeCheckpoint: "Review links only" }} brdId="BRD-123" />);

    await waitFor(() => {
      expect(mockedApi.get).toHaveBeenCalled();
    });

    expect(screen.queryByAltText(/wrong-scope-checkpoint/i)).not.toBeInTheDocument();
  });

  it("does not show a generic unknown SME checkpoint image when the scope checkpoint text has no matching image", async () => {
    mockedApi.get.mockResolvedValue({
      data: {
        images: [
          {
            id: 802,
            tableIndex: -1,
            rowIndex: 0,
            colIndex: 0,
            rid: "rId802",
            mediaName: "generic-checkpoint.png",
            mimeType: "image/png",
            cellText: "Ghost screenshot from another section",
            section: "unknown",
            fieldLabel: "SME Checkpoint",
          },
        ],
      },
    } as never);

    render(<Scope initialData={{ in_scope: [], out_of_scope: [], smeCheckpoint: "SMEs to check if weblink is correct" }} brdId="BRD-123" />);

    await waitFor(() => {
      expect(mockedApi.get).toHaveBeenCalled();
    });

    expect(screen.queryByAltText(/ghost screenshot from another section/i)).not.toBeInTheDocument();
  });

  it("does not surface TOC screenshots inside content profiling just because the cell text mentions a level", async () => {
    mockedApi.get.mockResolvedValue({
      data: {
        images: [
          {
            id: 901,
            tableIndex: 2,
            rowIndex: 1,
            colIndex: 0,
            rid: "rId901",
            mediaName: "toc-level-0.png",
            mimeType: "image/png",
            cellText: "Level 0 screenshot from TOC",
            section: "unknown",
            fieldLabel: "SME Checkpoint",
          },
        ],
      },
    } as never);

    render(
      <ContentProfile
        brdId="BRD-123"
        initialData={{
          levels: [
            {
              levelNumber: "Level 0",
              description: "Definition: Hardcoded – /DE",
              redjayXmlTag: "Hardcoded",
              path: "/DE",
              remarksNotes: "",
            },
          ],
        }}
      />,
    );

    await waitFor(() => {
      expect(mockedApi.get).toHaveBeenCalled();
    });

    expect(screen.queryByAltText(/level 0 screenshot from toc/i)).not.toBeInTheDocument();
  });
});
