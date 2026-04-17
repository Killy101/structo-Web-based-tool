import React from "react";
import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import Metadata from "../components/brd/Metadata";
import Toc from "../components/brd/TOC";
import Generate from "../components/brd/Generate";
import Scope from "../components/brd/Scope";
import CitationGuide from "../components/brd/CitationGuide";
import Citation from "../components/brd/Citation";
import RichTextEditableField from "../components/brd/RichTextEditableField";
import api from "@/app/lib/api";

jest.mock("@/app/lib/api", () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
    delete: jest.fn(),
    put: jest.fn(),
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

describe("BRD metadata and document structure regressions", () => {
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

  it("shows metadata images after upload even when the extractor saved them with an unknown section", async () => {
    mockedApi.get.mockResolvedValue({
      data: {
        images: [
          {
            id: 77,
            tableIndex: 9,
            rowIndex: 5,
            colIndex: 1,
            rid: "rId77",
            mediaName: "publication-date.png",
            mimeType: "image/png",
            cellText: "Publication date screenshot",
            section: "unknown",
            fieldLabel: "Publication Date",
          },
        ],
      },
    } as never);

    render(<Metadata format="old" brdId="BRD-123" initialData={{}} />);

    await waitFor(() => {
      expect(screen.getByAltText(/publication date screenshot/i)).toBeInTheDocument();
    });
  });

  it("shows metadata images even when legacy row indexes are offset by extra header rows", async () => {
    mockedApi.get.mockResolvedValue({
      data: {
        images: [
          {
            id: 79,
            tableIndex: 5,
            rowIndex: 6,
            colIndex: 1,
            rid: "rId79",
            mediaName: "publication-date-offset.png",
            mimeType: "image/png",
            cellText: "Issue date screenshot",
            section: "metadata",
            fieldLabel: "",
          },
        ],
      },
    } as never);

    render(<Metadata format="old" brdId="BRD-123" initialData={{}} />);

    await waitFor(() => {
      expect(screen.getByAltText(/issue date screenshot/i)).toBeInTheDocument();
    });
  });

  it("renders a dedicated Structuring Requirements processing view without the metadata grid", () => {
    render(
      <Metadata
        format="old"
        brdId="BRD-123"
        viewMode="structuring"
        initialData={{
          source_name: "Federal Register",
          source_name_sme_checkpoint: "SMEs to validate if the Source Name is correct - Correct",
        }}
      />,
    );

    expect(screen.getAllByText(/Structuring Requirements/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/^Source Name$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/SME Checkpoint/i)).toHaveValue("SMEs to validate if the Source Name is correct - Correct");
    expect(screen.queryByText(/^Metadata Fields$/i)).not.toBeInTheDocument();
  });

  it("prefers the extracted structuring checkpoint over generic metadata comments", () => {
    render(
      <Metadata
        format="old"
        brdId="BRD-123"
        viewMode="structuring"
        initialData={{
          source_name: "Code of Federal Regulations",
          sme_comments: "Source Name: Wrong generic metadata note",
          source_name_sme_checkpoint: "SMEs to validate if the Source Name is correct - Correct",
        }}
      />,
    );

    expect(screen.getByLabelText(/SME Checkpoint/i)).toHaveValue("SMEs to validate if the Source Name is correct - Correct");
  });

  it("does not use generic metadata SME comments as the structuring checkpoint when no dedicated checkpoint exists", () => {
    render(
      <Metadata
        format="old"
        viewMode="structuring"
        initialData={{
          source_name: "Code of Federal Regulations",
          sme_comments: "Source Name: Generic metadata comment should not appear here",
        }}
      />,
    );

    expect(screen.getByLabelText(/SME Checkpoint/i)).toHaveValue("");
  });

  it("does not show the redundant process type panel in Metadata", () => {
    render(<Metadata format="old" brdId="BRD-123" initialData={{ process_type: "Updating - Evergreen" }} />);

    expect(screen.queryByText(/BRD \/ Process Type/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/managed from the BRD Dashboard/i)).not.toBeInTheDocument();
  });

  it("shows uploaded metadata images in the Generate step after processing", async () => {
    mockedApi.get.mockResolvedValue({
      data: {
        images: [
          {
            id: 88,
            tableIndex: 9,
            rowIndex: 5,
            colIndex: 1,
            rid: "rId88",
            mediaName: "generate-publication-date.png",
            mimeType: "image/png",
            cellText: "Publication date screenshot",
            section: "unknown",
            fieldLabel: "Publication Date",
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
          metadata: {
            publication_date: "01/01/2026",
          },
        }}
      />,
    );

    await waitFor(() => {
      expect(screen.getByAltText(/publication date screenshot/i)).toBeInTheDocument();
    });
  });

  it("does not display uploaded images inside Content Profiling in the Generate step", async () => {
    mockedApi.get.mockResolvedValue({
      data: {
        images: [
          {
            id: 91,
            tableIndex: 2,
            rowIndex: 1,
            colIndex: 5,
            rid: "rId91",
            mediaName: "content-profile-preview.png",
            mimeType: "image/png",
            cellText: "Level 0 screenshot",
            section: "toc",
            fieldLabel: "0",
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
          contentProfile: {
            levels: [
              {
                levelNumber: "Level 0",
                description: "Definition: Hardcoded – /DE",
                redjayXmlTag: "Hardcoded",
                path: "/DE",
                remarksNotes: "note",
              },
            ],
          },
        }}
      />,
    );

    await waitFor(() => {
      expect(mockedApi.get).toHaveBeenCalled();
    });
    expect(screen.queryByAltText(/level 0 screenshot/i)).not.toBeInTheDocument();
  });

  it("adds level 0 and level 1 rows to the document structure when the uploaded BRD starts at level 2", () => {
    render(
      <Toc
        initialData={{
          sections: [
            {
              level: "2",
              name: "Document Title",
              required: "true",
              definition: "document title",
              example: "Sample Act",
            },
          ],
        }}
      />,
    );

    expect(screen.getByText(/^0$/)).toBeInTheDocument();
    expect(screen.getByText(/^1$/)).toBeInTheDocument();
    expect(screen.getByText(/^2$/)).toBeInTheDocument();
  });

  it("decodes quoted HTML entities in document structure fields", () => {
    render(
      <Toc
        initialData={{
          sections: [
            {
              level: "3",
              name: "Title",
              required: "true",
              definition: "&quot;Titre&quot; + incrementing number",
              example: "&quot;Chapitre&quot; 1",
            },
          ],
        }}
      />,
    );

    expect(screen.getByText('"Titre" + incrementing number')).toBeInTheDocument();
    expect(screen.getByText('"Chapitre" 1')).toBeInTheDocument();
    expect(screen.queryByText(/&quot;Titre&quot;/i)).not.toBeInTheDocument();
  });

  it("preserves red bold italic formatting in document structure cells", () => {
    const { container } = render(
      <Toc
        initialData={{
          sections: [
            {
              level: "4",
              name: "Chapter",
              required: "true",
              definition: '<span style="color:red"><strong><em>Important chapter note</em></strong></span>',
              example: "Example 1",
            },
          ],
        }}
      />,
    );

    const text = screen.getByText(/important chapter note/i);
    expect(text).toBeInTheDocument();
    expect(container.innerHTML).toContain("color:red");
    expect(container.querySelector("strong em")).not.toBeNull();
  });

  it("renders citation guide checkpoint and owner links without exposing raw HTML", () => {
    render(
      <CitationGuide
        initialData={{
          citationStyleGuide: {
            description: 'SME Checkpoint <span style="color: #1D7AFC">When applicable, SME must edit region\'s Citation Style Guide.</span> Link: <a href="file:///C:/confluence/pages/viewpage.action?pageId=2365329841"><span style="color: #0055CC">Obligation Drafting / Updates</span></a>',
            rows: [
              { label: "Product Owner", value: '<a href="file:///C:/confluence/display/~W620263">Raut, Divya</a>' },
            ],
          },
        }}
      />,
    );

    expect(screen.getByText(/when applicable, sme must edit region's citation style guide\./i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /obligation drafting \/ updates/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /raut, divya/i })).toBeInTheDocument();
    expect(screen.queryByDisplayValue(/<a href=/i)).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue(/<span style=/i)).not.toBeInTheDocument();
  });

  it("shows the citation guide checkpoint as a separate section block in the review screen", () => {
    mockedApi.get.mockResolvedValue({ data: { images: [] } } as never);

    const { container } = render(
      <Generate
        brdId="BRD-123"
        format="old"
        status="DRAFT"
        initialData={{
          toc: {
            citationStyleGuide: {
              description: "SME Check-point When applicable, SME must edit region's Citation Style Guide.",
              rows: [
                { label: "Product Owner", value: '<a href="file:///C:/confluence/display/~W620263">Raut, Divya</a>' },
              ],
            },
          },
        }}
      />,
    );

    expect(screen.getByText(/citation guide · sme checkpoint/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /raut, divya/i })).toBeInTheDocument();
    expect(screen.getAllByText(/when applicable, sme must edit region's citation style guide\./i)).toHaveLength(1);
    expect(container.textContent).not.toContain("SME Check-point When applicable");
  });

  it("supports keyboard shortcuts for adding and deleting citation guide rows", () => {
    render(
      <CitationGuide
        initialData={{
          citationStyleGuide: {
            rows: [{ label: "Product Owner", value: "Raut, Divya" }],
          },
        }}
      />,
    );

    const initialInputs = screen.getAllByPlaceholderText(/e\.g\. link/i);
    expect(initialInputs).toHaveLength(1);

    fireEvent.focus(initialInputs[0]);
    fireEvent.keyDown(document, { key: "w", ctrlKey: true });
    expect(screen.getAllByPlaceholderText(/e\.g\. link/i)).toHaveLength(2);

    const secondInputs = screen.getAllByPlaceholderText(/e\.g\. link/i);
    fireEvent.focus(secondInputs[1]);
    fireEvent.keyDown(document, { key: "Delete" });
    expect(screen.getAllByPlaceholderText(/e\.g\. link/i)).toHaveLength(1);
  });

  it("lets imported citation guide fields be edited or removed without snapping back", async () => {
    render(
      <CitationGuide
        initialData={{
          citationStyleGuide: {
            description: "SME Checkpoint Initial note",
            rows: [
              { label: "SME Checkpoint", value: "Remove me" },
              { label: "Product Owner", value: "Raut, Divya" },
            ],
          },
        }}
      />,
    );

    fireEvent.click(screen.getAllByLabelText(/remove citation guide row/i)[0]);

    await waitFor(() => {
      expect(screen.queryByDisplayValue("SME Checkpoint")).not.toBeInTheDocument();
    });

    const remainingLabel = screen.getByDisplayValue("Product Owner");
    fireEvent.change(remainingLabel, { target: { value: "Guide Owner" } });

    await waitFor(() => {
      expect(screen.getByDisplayValue("Guide Owner")).toBeInTheDocument();
    });
  });

  it("renders scope checkpoint images and preserves red bold scope text in the review screen", async () => {
    mockedApi.get.mockResolvedValue({
      data: {
        images: [
          {
            id: 95,
            tableIndex: 3,
            rowIndex: 0,
            colIndex: 0,
            rid: "rId95",
            mediaName: "scope-checkpoint.png",
            mimeType: "image/png",
            cellText: "Scope checkpoint flow diagram",
            section: "scope",
            fieldLabel: "SME Checkpoint",
          },
        ],
      },
    } as never);

    const { container } = render(
      <Generate
        brdId="BRD-123"
        format="old"
        status="DRAFT"
        initialData={{
          scope: {
            smeCheckpoint: "Scope checkpoint note",
            in_scope: [
              {
                document_title: '<span style="color:red"><strong>Critical scope item</strong></span>',
                regulator_url: '<span style="color:#ae2e24"><a href="https://example.com/ref">https://example.com/ref</a></span>',
                content_url: '<span style="color:#ae2e24"><a href="https://example.com/content">https://example.com/content</a></span>',
                issuing_authority: "Agency",
                asrb_id: "ASRB-100",
                sme_comments: "Review required",
                initial_evergreen: '<span style="color:#ae2e24"><strong>Evergreen</strong></span>',
                date_of_ingestion: '<span style="color:#ae2e24"><strong>WIP</strong></span>',
              },
            ],
          },
        }}
      />,
    );

    await waitFor(() => {
      expect(screen.getByAltText(/scope checkpoint flow diagram/i)).toBeInTheDocument();
    });

    expect(screen.getByText(/critical scope item/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /example\.com\/ref/i })).toHaveAttribute("href", "https://example.com/ref");
    expect(container.innerHTML).toContain("color:red");
    expect(container.querySelector("strong")).not.toBeNull();
  });

  it("preserves rich-text scope links in the editable scope table", async () => {
    mockedApi.get.mockResolvedValue({ data: { images: [] } } as never);

    render(
      <Scope
        brdId="BRD-123"
        initialData={{
          smeCheckpoint: "Scope note",
          in_scope: [
            {
              document_title: '<span style="color:#ae2e24"><strong>Ordonnance test</strong></span>',
              regulator_url: '<span style="color:#ae2e24"><a href="https://example.com/reference">https://example.com/reference</a></span>',
              content_url: '<span style="color:#ae2e24"><a href="https://example.com/content">https://example.com/content</a></span>',
              issuing_authority: "Authority",
              asrb_id: "ASRB-777",
              sme_comments: "Review",
            },
          ],
        }}
      />,
    );

    await waitFor(() => {
      expect(screen.getByRole("link", { name: /example\.com\/reference/i })).toHaveAttribute("href", "https://example.com/reference");
    });
  });

  it("allows citation SME checkpoint text to be cleared and propagated", async () => {
    const onDataChange = jest.fn();

    render(
      <Citation
        initialData={{
          references: [],
          citationLevelSmeCheckpoint: "Original checkpoint guidance",
          citationRulesSmeCheckpoint: "Rules note",
        }}
        onDataChange={onDataChange}
      />,
    );

    fireEvent.click(screen.getByText(/original checkpoint guidance/i));
    const textarea = screen.getByDisplayValue("Original checkpoint guidance");
    fireEvent.change(textarea, { target: { value: "" } });

    await waitFor(() => {
      expect(textarea).toHaveValue("");
    });

    await waitFor(() => {
      expect(onDataChange).toHaveBeenLastCalledWith(expect.objectContaining({
        references: [],
        citationLevelSmeCheckpoint: "",
        citationRulesSmeCheckpoint: "Rules note",
      }));
    });
  });

  it("shows plain text in the SME checkpoint editor even when the source value contains BRD HTML", async () => {
    const onChange = jest.fn();

    render(
      <RichTextEditableField
        value={'<strong><span style="color:#1D7AFC">SME Checkpoint:</span></strong><br/><span style="text-decoration:line-through">Old rule</span><br/>New guidance'}
        onChange={onChange}
        labelPrefix="SME Checkpoint"
      />,
    );

    fireEvent.click(screen.getByText(/old rule/i));

    await waitFor(() => {
      expect(screen.getByRole("textbox")).toHaveValue("Old rule\nNew guidance");
    });
  });

  it("shows the citable column and values in the Generate review screen", async () => {
    mockedApi.get.mockResolvedValue({ data: { images: [] } } as never);

    render(
      <Generate
        brdId="BRD-123"
        format="old"
        status="DRAFT"
        initialData={{
          citations: {
            references: [
              { level: "1", isCitable: "N", citationRules: "", sourceOfLaw: "", smeComments: "" },
              { level: "4", isCitable: "Y", citationRules: "Rule text", sourceOfLaw: "Level 2", smeComments: "Reviewed" },
            ],
          },
        }}
      />,
    );

    await waitFor(() => {
      expect(screen.getAllByText(/Citable Levels/i).length).toBeGreaterThan(0);
    });
    expect(screen.getAllByText(/^Y$/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/^N$/).length).toBeGreaterThan(0);
  });

  it("automatically uses the BRD-native structuring label with no manual selector", async () => {
    mockedApi.get.mockResolvedValue({ data: { images: [] } } as never);

    const { rerender } = render(
      <Generate
        brdId="BRD-OLD"
        format="old"
        status="DRAFT"
        initialData={{
          metadata: {
            source_name: "Legacy source name",
            sme_comments: "Source Name: Validate this legacy source name",
          },
        }}
      />,
    );

    expect(screen.getAllByText("Source Name").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Content Category Name" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Source Name" })).not.toBeInTheDocument();

    rerender(
      <Generate
        brdId="BRD-NEW"
        format="new"
        status="DRAFT"
        initialData={{
          metadata: {
            content_category_name: "Modern content category",
            sme_comments: "Content Category Name: Validate this content category",
          },
        }}
      />,
    );

    expect(screen.getAllByText("Content Category Name").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Content Category Name" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Source Name" })).not.toBeInTheDocument();
  });

  it("uses the BRD citation terminology in Section IV", async () => {
    mockedApi.get.mockResolvedValue({ data: { images: [] } } as never);

    render(
      <Generate
        brdId="BRD-CIT"
        format="new"
        status="DRAFT"
        initialData={{
          citations: {
            citationLevelSmeCheckpoint: "Indicate which levels are citable.",
            citationRulesSmeCheckpoint: "Citation rules stand for how the citations should appear in ELA. Source of Law identifies the governing level.",
            references: [
              { level: "2", isCitable: "Y", citationRules: "Level 2 | Level 3", sourceOfLaw: "Level 2", smeComments: "Reviewed" },
            ],
          },
        }}
      />,
    );

    expect(screen.getAllByText(/Citation Format Requirements/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Citable Levels/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Citation Standardization Rules/i).length).toBeGreaterThan(0);
  });
});
