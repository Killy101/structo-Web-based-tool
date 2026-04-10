import { buildBrdExportFilename, buildWordDocxBlob, prepareBrdExportElement } from "../components/brd/Generate";
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
});

describe("buildBrdImageBlobUrl", () => {
  afterEach(() => {
    window.localStorage.clear();
  });

  it("uses a harmless placeholder until a client token is available", () => {
    expect(buildBrdImageBlobUrl("BRD-001", 7, "http://localhost:4000")).toMatch(/^data:image\/gif;base64,/);
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
