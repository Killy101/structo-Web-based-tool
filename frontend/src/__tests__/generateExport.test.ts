import {
  buildBrdExportFilename,
  buildExportDocumentOutline,
  buildMetadataDocumentLocationText,
  buildReviewSectionOrder,
  buildWordDocxBlob,
  formatMetadataDateValue,
  getMetadataRowImagesForField,
  prepareBrdExportElement,
} from "../components/brd/Generate";
import { buildVisibleFlowStepIds } from "../components/brd/BrdFlow";
import { buildBrdImageBlobUrl } from "../utils/brdImageUrl";

function readBlobAsArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

describe("buildWordDocxBlob", () => {
  it("creates a DOCX file for BRD export", async () => {
    const blob = buildWordDocxBlob("<div><h1>BRD Export</h1><p>Structured content</p></div>", "BRD Export");

    expect(blob.type).toBe("application/vnd.openxmlformats-officedocument.wordprocessingml.document");

    const bytes = new Uint8Array(await readBlobAsArrayBuffer(blob));
    expect(Array.from(bytes.slice(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04]);

    const text = Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");
    expect(text).toContain("word/document.xml");
    expect(text).toContain("word/afchunk.html");
    expect(text).toContain("BRD Export");
  });

  it("handles large BRD exports without overflowing the call stack", () => {
    const largeHtml = `<div>${"<p>large export row</p>".repeat(20000)}</div>`;
    expect(() => buildWordDocxBlob(largeHtml, "Large Export")).not.toThrow();
  });
});

describe("buildReviewSectionOrder", () => {
  it("starts with Structuring Requirements and keeps the BRD sequence aligned for export", () => {
    expect(buildReviewSectionOrder(true).map((section) => section.id)).toEqual([
      "section-structuring-requirements",
      "section-scope",
      "section-toc",
      "section-citations",
      "section-metadata",
      "section-citation-guide",
      "section-content-profile",
      "section-generate",
    ]);
  });

  it("builds a linked export outline with nested section entries", () => {
    expect(
      buildExportDocumentOutline({
        format: "old",
        metadata: { source_name: "Federal Register" },
        tocData: {
          tocSortingOrder: "Alphabetical",
          sections: [
            { level: "1", name: "Levels" },
            { level: "2", name: "Exceptions" },
          ],
        },
        contentProfileData: {
          file_separation: "Separate files per title",
          rc_naming_convention: "CFR - <Level 2>",
          zip_naming_convention: "Innodata - CFR.zip",
        },
        showCitationGuide: true,
      }),
    ).toEqual([
      {
        id: "section-structuring-requirements",
        label: "Structuring Requirements",
        children: [
          { id: "section-structuring-field", label: "Source Name" },
          { id: "section-scope", label: "Scope" },
          { id: "section-toc-sorting-order", label: "ToC - Sorting Order" },
        ],
      },
      {
        id: "section-toc",
        label: "Document Structure",
        children: [
          { id: "section-toc-levels", label: "Levels" },
          { id: "section-toc", label: "Exceptions" },
        ],
      },
      {
        id: "section-citations",
        label: "Citation Format Requirements",
        children: [
          { id: "section-citable-levels", label: "Citable Levels" },
          { id: "section-citation-standardization-rules", label: "Citation Standardization Rules" },
        ],
      },
      { id: "section-metadata", label: "Metadata" },
      {
        id: "section-file-delivery",
        label: "File Delivery Requirements",
        children: [
          { id: "section-file-separation", label: "File Separation" },
          { id: "section-rc-file-naming", label: "RC File Naming Conventions" },
          { id: "section-zip-file-naming", label: "Zip File Naming Conventions" },
        ],
      },
      { id: "section-citation-guide", label: "Citation Style Guide Link" },
      { id: "section-content-profile", label: "Content Profile" },
    ]);
  });

  it("falls back to Levels when document structure names only contain stray break markup", () => {
    expect(
      buildExportDocumentOutline({
        format: "new",
        metadata: { content_category_name: "Sample Source" },
        tocData: {
          sections: [
            { level: "1", name: "<br/>" },
          ],
        },
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "section-toc",
          label: "Document Structure",
          children: [{ id: "section-toc-levels", label: "Levels" }],
        }),
      ]),
    );
  });

  it("starts the wizard with Structuring Requirements after upload and keeps Metadata later in the flow", () => {
    expect(buildVisibleFlowStepIds(false, true)).toEqual([
      "upload",
      "structuring",
      "scope",
      "toc",
      "citationRules",
      "metadata",
      "citationGuide",
      "contentProfile",
      "generate",
    ]);
  });
});

describe("prepareBrdExportElement", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("keeps only the current version value and preserves embedded BRD images for export", async () => {
    const pngBytes = Uint8Array.from([
      137, 80, 78, 71, 13, 10, 26, 10,
      0, 0, 0, 13, 73, 72, 68, 82,
      0, 0, 0, 1, 0, 0, 0, 1,
      8, 6, 0, 0, 0, 31, 21, 196,
      137, 0, 0, 0, 13, 73, 68, 65,
      84, 120, 156, 99, 248, 15, 4, 0,
      9, 251, 3, 253, 160, 90, 201, 249,
      0, 0, 0, 0, 73, 69, 78, 68,
      174, 66, 96, 130,
    ]);
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      blob: async () => new Blob([pngBytes], { type: "image/png" }),
    } as Response) as typeof fetch;

    document.body.innerHTML = `
      <div id="page">
        <div data-draft-current="1">
          <div data-export-part="prev"><span>prev</span><span data-prev-value="1">old value</span></div>
          <div data-export-part="current"><span>latest</span><span data-current-value="1">try</span></div>
        </div>
        <img src="https://example.com/export-image.png" alt="preview" data-brd-export-image="1" />
      </div>
    `;

    const prepared = await prepareBrdExportElement(document.getElementById("page") as HTMLElement);
    expect(prepared.textContent).toContain("try");
    expect(prepared.textContent?.toLowerCase()).not.toContain("prev");
    expect(prepared.textContent?.toLowerCase()).not.toContain("latest");
    const exportedImages = prepared.querySelectorAll("img[data-brd-export-image='1']");
    expect(exportedImages).toHaveLength(1);
    expect(exportedImages[0].getAttribute("src") || "").toMatch(/^data:image\/png;base64,/);
  });

  it("removes metadata rows that have no document location", async () => {
    document.body.innerHTML = `
      <div id="page">
        <table>
          <tbody>
            <tr data-meta-row="1"><td>Source Name</td><td data-doc-location="1">Some location</td><td>comment</td></tr>
            <tr data-meta-row="1"><td>Status</td><td data-doc-location="1">—</td><td>comment</td></tr>
          </tbody>
        </table>
      </div>
    `;

    const prepared = await prepareBrdExportElement(document.getElementById("page") as HTMLElement);
    const rows = prepared.querySelectorAll("tr[data-meta-row='1']");
    expect(rows).toHaveLength(1);
    expect(prepared.textContent).toContain("Source Name");
    expect(prepared.textContent).not.toContain("Status");
  });

  it("keeps export-only blocks in the exported document while they stay hidden in the page UI", async () => {
    document.body.innerHTML = `
      <div id="page">
        <div data-export-only="1" style="display:none">
          <h2>Table of Contents</h2>
          <p>File Delivery Requirements</p>
        </div>
      </div>
    `;

    const prepared = await prepareBrdExportElement(document.getElementById("page") as HTMLElement);
    const exportOnly = prepared.querySelector("[data-export-only='1']") as HTMLElement;
    expect(exportOnly).not.toBeNull();
    expect(exportOnly.style.display).toBe("block");
    expect(prepared.textContent).toContain("Table of Contents");
    expect(prepared.textContent).toContain("File Delivery Requirements");
  });

  it("keeps the content profile section in the exported BRD", async () => {
    document.body.innerHTML = `
      <div id="page">
        <div>
          <section id="section-content-profile">
            <h2>Content Profile</h2>
            <p>RC Filename</p>
            <p>sample.rc</p>
          </section>
        </div>
      </div>
    `;

    const prepared = await prepareBrdExportElement(document.getElementById("page") as HTMLElement);
    expect(prepared.querySelector("#section-content-profile")).not.toBeNull();
    expect(prepared.textContent).toContain("Content Profile");
    expect(prepared.textContent).toContain("RC Filename");
    expect(prepared.textContent).toContain("sample.rc");
  });
});

describe("getMetadataRowImagesForField", () => {
  it("keeps a publication-date image off the source-type row when the image already has a semantic field label", () => {
    const images = [
      {
        id: 41,
        tableIndex: 5,
        rowIndex: 3,
        colIndex: 1,
        rid: "rId7",
        mediaName: "pubdate.png",
        mimeType: "image/png",
        cellText: "Publication date can usually be found on the first page",
        blobUrl: null,
        section: "metadata",
        fieldLabel: "Publication Date",
      },
    ];

    expect(getMetadataRowImagesForField({ label: "Source Type", key: "sourceType" }, 2, images)).toEqual([]);
    expect(getMetadataRowImagesForField({ label: "Publication Date", key: "publicationDate" }, 4, images)).toHaveLength(1);
  });
});

describe("metadata document location helpers", () => {
  it("formats date-like values but leaves instructional text untouched", () => {
    expect(formatMetadataDateValue("2024-01-15")).toBe("15 Jan 2024");
    expect(formatMetadataDateValue("ISO 8601 of date processed (e.g. 2016-06-07T15:10:00Z)")).toBeNull();
  });

  it("preserves the descriptive text above a clickable content URL", () => {
    expect(
      buildMetadataDocumentLocationText(
        "contentUrl",
        "https://www.b3.com.br/data/files/example.pdf",
        { "Content URI Note": "URL of the specific Document (e.g.)" },
      ),
    ).toBe("URL of the specific Document (e.g.)\nhttps://www.b3.com.br/data/files/example.pdf");
  });
});

describe("buildBrdImageBlobUrl", () => {
  afterEach(() => {
    window.localStorage.clear();
  });

  it("returns the image blob path even before a client token is available", () => {
    expect(buildBrdImageBlobUrl("BRD-001", 7, "http://localhost:4000")).toBe(
      "http://localhost:4000/brd/BRD-001/images/7/blob",
    );
  });

  it("appends the auth token for protected image blobs", () => {
    window.localStorage.setItem("token", "abc123");
    expect(buildBrdImageBlobUrl("BRD-001", 7, "http://localhost:4000")).toBe(
      "http://localhost:4000/brd/BRD-001/images/7/blob?token=abc123",
    );
  });
});

describe("buildBrdExportFilename", () => {
  it("uses the BRD title and id in the exported docx filename", () => {
    expect(buildBrdExportFilename("Una blo", "BRD-0008")).toBe("Una_blo-BRD-0008.docx");
  });
});
