import React from "react";
import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import Generate from "../components/brd/Generate";
import BrdFlow from "../components/brd/BrdFlow";
import api from "@/app/lib/api";

jest.mock("@/app/lib/api", () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
    post: jest.fn(),
    patch: jest.fn(),
    put: jest.fn(),
    delete: jest.fn(),
  },
}));

jest.mock("@/context/AuthContext", () => ({
  useAuth: () => ({
    user: {
      role: "ADMIN",
      team: { slug: "pre-production" },
    },
  }),
}));

jest.mock("../components/brd/Upload", () => ({
  __esModule: true,
  default: ({ onComplete }: { onComplete?: (result: unknown) => void }) => (
    <button
      type="button"
      onClick={() => onComplete?.({
        format: "old",
        brdId: "BRD-NEW",
        title: "In-progress BRD",
        status: "DRAFT",
        scope: { in_scope: [] },
        metadata: {},
        toc: {},
        citations: {},
        contentProfile: {},
      })}
    >
      Complete mock upload
    </button>
  ),
}));

jest.mock("../components/brd/Scope", () => ({
  __esModule: true,
  default: () => <div>Mock Scope Step</div>,
}));

jest.mock("../components/brd/Metadata", () => ({
  __esModule: true,
  default: () => <div>Mock Metadata Step</div>,
}));

jest.mock("../components/brd/TOC", () => ({
  __esModule: true,
  default: () => <div>Mock TOC Step</div>,
}));

jest.mock("../components/brd/Citation", () => ({
  __esModule: true,
  default: () => <div>Mock Citation Step</div>,
}));

jest.mock("../components/brd/ContentProf", () => ({
  __esModule: true,
  default: () => <div>Mock Content Profile Step</div>,
}));

jest.mock("../components/brd/CitationGuide", () => ({
  __esModule: true,
  default: () => <div>Mock Citation Guide Step</div>,
}));

describe("BRD flow discard and scope image placement", () => {
  const mockedApi = api as jest.Mocked<typeof api>;

  beforeEach(() => {
    mockedApi.get.mockReset();
    mockedApi.post.mockReset();
    mockedApi.patch.mockReset();
    mockedApi.put.mockReset();
    mockedApi.delete.mockReset();
  });

  it("keeps scope images in their correct row and field instead of bleeding across the table", async () => {
    mockedApi.get.mockResolvedValue({
      data: {
        images: [
          {
            id: 401,
            tableIndex: 3,
            rowIndex: 1,
            colIndex: 0,
            rid: "rId401",
            mediaName: "row-1-title.png",
            mimeType: "image/png",
            cellText: "Row 1 title image",
            blobUrl: null,
            section: "scope",
            fieldLabel: "Document Title",
          },
          {
            id: 402,
            tableIndex: 3,
            rowIndex: 2,
            colIndex: 5,
            rid: "rId402",
            mediaName: "row-2-sme.png",
            mimeType: "image/png",
            cellText: "Row 2 SME image",
            blobUrl: null,
            section: "scope",
            fieldLabel: "SME Comments",
          },
        ],
      },
    } as never);

    render(
      <Generate
        brdId="BRD-123"
        format="old"
        status="DRAFT"
        initialData={{
          scope: {
            in_scope: [
              {
                stable_key: "row-1",
                document_title: "Row 1 Title",
                regulator_url: "https://example.com/ref-1",
                content_url: "https://example.com/content-1",
                issuing_authority: "Authority 1",
                asrb_id: "ASRB-1",
                sme_comments: "Comment 1",
              },
              {
                stable_key: "row-2",
                document_title: "Row 2 Title",
                regulator_url: "https://example.com/ref-2",
                content_url: "https://example.com/content-2",
                issuing_authority: "Authority 2",
                asrb_id: "ASRB-2",
                sme_comments: "Comment 2",
              },
            ],
          },
        }}
      />,
    );

    await waitFor(() => {
      expect(screen.getByAltText("Row 1 title image")).toBeInTheDocument();
      expect(screen.getByAltText("Row 2 SME image")).toBeInTheDocument();
    });

    const rowOne = screen.getByText("Row 1 Title").closest("tr");
    const rowTwo = screen.getByText("Row 2 Title").closest("tr");
    expect(rowOne).not.toBeNull();
    expect(rowTwo).not.toBeNull();

    const rowOneCells = within(rowOne as HTMLElement).getAllByRole("cell");
    const rowTwoCells = within(rowTwo as HTMLElement).getAllByRole("cell");

    expect(within(rowOneCells[0]).getByAltText("Row 1 title image")).toBeInTheDocument();
    expect(within(rowOneCells[5]).queryByAltText("Row 1 title image")).not.toBeInTheDocument();
    expect(within(rowOneCells[5]).queryByAltText("Row 2 SME image")).not.toBeInTheDocument();

    expect(within(rowTwoCells[0]).queryByAltText("Row 1 title image")).not.toBeInTheDocument();
    expect(within(rowTwoCells[5]).getByAltText("Row 2 SME image")).toBeInTheDocument();
  });

  it("deletes the in-progress BRD when discard and exit is confirmed", async () => {
    mockedApi.delete.mockResolvedValue({ data: { success: true } } as never);

    const onClose = jest.fn();
    const { container } = render(<BrdFlow onClose={onClose} />);

    fireEvent.click(screen.getByText("Complete mock upload"));
    expect(screen.getByText("Mock Citation Guide Step")).toBeInTheDocument();

    const closeButton = Array.from(container.querySelectorAll("button")).find(
      (button) => (button.textContent || "").trim() === "",
    );

    expect(closeButton).toBeTruthy();
    fireEvent.click(closeButton as HTMLButtonElement);

    expect(await screen.findByText("Discard & Exit")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Discard & Exit" }));

    await waitFor(() => {
      expect(mockedApi.delete).toHaveBeenCalledWith("/brd/BRD-NEW");
      expect(mockedApi.delete).toHaveBeenCalledWith("/brd/BRD-NEW/permanent");
    });
    expect(onClose).toHaveBeenCalled();
  });
});
