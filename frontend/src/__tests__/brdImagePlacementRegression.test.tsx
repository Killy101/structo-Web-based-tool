import React from "react";
import "@testing-library/jest-dom";
import { render, screen, waitFor, within } from "@testing-library/react";
import Metadata from "../components/brd/Metadata";
import Scope from "../components/brd/Scope";
import ContentProfile from "../components/brd/ContentProf";
import TOC from "../components/brd/TOC";
import Citation from "../components/brd/Citation";
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

  it("shows a level 9 TOC screenshot even when engineering metadata stores it as unknown section", async () => {
    mockedApi.get.mockResolvedValue({
      data: {
        images: [
          {
            id: 902,
            tableIndex: -1,
            rowIndex: 9,
            colIndex: 7,
            rid: "rId902",
            mediaName: "level-9-sme.png",
            mimeType: "image/png",
            cellText: "Level 9 paragraph screenshot",
            section: "unknown",
            fieldLabel: "Level 9",
          },
        ],
      },
    } as never);

    render(
      <TOC
        brdId="BRD-123"
        initialData={{
          sections: [
            { level: "2", name: "", required: "true", definition: "Title", example: "Act title", note: "", tocRequirements: "", smeComments: "" },
            { level: "9", name: "", required: "false", definition: "Incrementing number next to article number", example: "5", note: "", tocRequirements: "", smeComments: "It should be noted that the number 1 is not visible." },
          ],
        }}
      />,
    );

    await waitFor(() => {
      expect(screen.getByAltText(/level 9 paragraph screenshot/i)).toBeInTheDocument();
    });
  });

  it("keeps a scope cell image on the matching row instead of repeating it across rows with the same text", async () => {
    mockedApi.get.mockResolvedValue({
      data: {
        images: [
          {
            id: 903,
            tableIndex: 4,
            rowIndex: 1,
            colIndex: 5,
            rid: "rId903",
            mediaName: "scope-sme-comment.png",
            mimeType: "image/png",
            cellText: "Shared comment screenshot",
            section: "scope",
            fieldLabel: "same comment",
          },
        ],
      },
    } as never);

    render(
      <Scope
        brdId="BRD-123"
        initialData={{
          smeCheckpoint: "Review links only",
          in_scope: [
            {
              document_title: "Doc 1",
              reference_link: "https://example.com/1",
              content_url: "https://example.com/content-1",
              issuing_authority: "Authority 1",
              asrb_id: "ASRB-1",
              sme_comments: "Same comment",
            },
            {
              document_title: "Doc 2",
              reference_link: "https://example.com/2",
              content_url: "https://example.com/content-2",
              issuing_authority: "Authority 2",
              asrb_id: "ASRB-2",
              sme_comments: "Same comment",
            },
          ],
          out_of_scope: [],
        }}
      />,
    );

    await waitFor(() => {
      expect(screen.getAllByAltText(/shared comment screenshot/i)).toHaveLength(1);
    });

    const firstRow = screen.getByText("Doc 1").closest("tr");
    const secondRow = screen.getByText("Doc 2").closest("tr");

    expect(firstRow).not.toBeNull();
    expect(secondRow).not.toBeNull();
    expect(within(firstRow as HTMLElement).getByAltText(/shared comment screenshot/i)).toBeInTheDocument();
    expect(within(secondRow as HTMLElement).queryByAltText(/shared comment screenshot/i)).not.toBeInTheDocument();
  });

  it("keeps a citation image on the intended row when multiple rows share the same level", async () => {
    mockedApi.get.mockResolvedValue({
      data: {
        images: [
          {
            id: 904,
            tableIndex: 4,
            rowIndex: 1,
            colIndex: 3,
            rid: "rId904",
            mediaName: "citation-level-1.png",
            mimeType: "image/png",
            cellText: "Citation row screenshot",
            section: "citations",
            fieldLabel: "Level 1",
          },
        ],
      },
    } as never);

    render(
      <Citation
        brdId="BRD-123"
        initialData={{
          references: [
            { level: "1", citationRules: "Rule A", sourceOfLaw: "Law A", isCitable: "Y", smeComments: "Comment A" },
            { level: "1", citationRules: "Rule B", sourceOfLaw: "Law B", isCitable: "N", smeComments: "Comment B" },
          ],
        }}
      />,
    );

    await waitFor(() => {
      expect(screen.getAllByAltText(/citation row screenshot/i)).toHaveLength(1);
    });
  });

  it("keeps a TOC image on the intended row when multiple rows share the same level", async () => {
    mockedApi.get.mockResolvedValue({
      data: {
        images: [
          {
            id: 905,
            tableIndex: 2,
            rowIndex: 2,
            colIndex: 7,
            rid: "rId905",
            mediaName: "toc-level-1.png",
            mimeType: "image/png",
            cellText: "TOC row screenshot",
            section: "toc",
            fieldLabel: "Level 1",
          },
        ],
      },
    } as never);

    render(
      <TOC
        brdId="BRD-123"
        initialData={{
          sections: [
            { level: "1", name: "Heading A", required: "true", definition: "Definition A", example: "Example A", note: "", tocRequirements: "", smeComments: "Comment A" },
            { level: "1", name: "Heading B", required: "false", definition: "Definition B", example: "Example B", note: "", tocRequirements: "", smeComments: "Comment B" },
          ],
        }}
      />,
    );

    await waitFor(() => {
      expect(screen.getAllByAltText(/toc row screenshot/i)).toHaveLength(1);
    });
  });
});
