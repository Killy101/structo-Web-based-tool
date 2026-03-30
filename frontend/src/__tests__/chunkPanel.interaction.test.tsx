import React from "react";
import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import ChunkPanel from "../components/compare/ChunkPanel";

jest.mock("next/image", () => ({
  __esModule: true,
  default: (props: React.ImgHTMLAttributes<HTMLImageElement>) => {
    // eslint-disable-next-line @next/next/no-img-element
    return <img {...props} alt={props.alt ?? ""} />;
  },
}));

type FetchResponseShape = {
  success: boolean;
  source_name: string;
  old_filename: string;
  new_filename: string;
  xml_filename: string;
  pdf_chunks: Array<{
    index: number;
    label: string;
    filename: string;
    old_text: string;
    new_text: string;
    has_changes: boolean;
    change_types: Array<"addition" | "removal" | "modification" | "emphasis" | "mismatch">;
    change_summary: { addition: number; removal: number; modification: number };
    xml_content: string;
    xml_chunk_file: string;
    xml_tag: string;
    xml_attributes: Record<string, string>;
    xml_size: number;
    old_heading?: string;
    new_heading?: string;
  }>;
  summary: { total: number; changed: number; unchanged: number };
  old_pdf_chunk_count: number;
  new_pdf_chunk_count: number;
  xml_chunk_count: number;
  folder_structure: { base: string; chunked: string; compare: string; merge: string };
};

const mockResponse: FetchResponseShape = {
  success: true,
  source_name: "ManualV2",
  old_filename: "old.pdf",
  new_filename: "new.pdf",
  xml_filename: "old.xml",
  pdf_chunks: [
    {
      index: 1,
      label: "Chunk 1",
      filename: "chunk001.xml",
      old_text: "old",
      new_text: "new",
      has_changes: true,
      change_types: ["modification"],
      change_summary: { addition: 0, removal: 0, modification: 1 },
      xml_content: "<chapter />",
      xml_chunk_file: "chunk001.xml",
      xml_tag: "chapter",
      xml_attributes: {},
      xml_size: 128,
      old_heading: "Section Alpha",
      new_heading: "Section Alpha",
    },
  ],
  summary: { total: 1, changed: 1, unchanged: 0 },
  old_pdf_chunk_count: 1,
  new_pdf_chunk_count: 1,
  xml_chunk_count: 1,
  folder_structure: { base: "base", chunked: "chunked", compare: "compare", merge: "merge" },
};

async function makeReadyForChunking(container: HTMLElement) {
  fireEvent.change(screen.getByPlaceholderText("e.g. ManualV2, ProductGuide"), {
    target: { value: "ManualV2" },
  });

  const fileInputs = Array.from(
    container.querySelectorAll("input[type='file']"),
  ) as HTMLInputElement[];

  const oldFile = new File(["old"], "old.pdf", { type: "application/pdf" });
  const newFile = new File(["new"], "new.pdf", { type: "application/pdf" });

  fireEvent.change(fileInputs[0], { target: { files: [oldFile] } });
  fireEvent.change(fileInputs[1], { target: { files: [newFile] } });

  await waitFor(() => {
    expect(screen.getByRole("button", { name: /chunk now/i })).toBeEnabled();
  });

  return { oldFile, newFile };
}

describe("ChunkPanel interaction flows", () => {
  beforeEach(() => {
    jest.useRealTimers();
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => mockResponse,
    } as Response);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("keeps chunk action disabled until source and files are provided", async () => {
    const { container } = render(<ChunkPanel fileCount={2} />);

    const chunkButton = screen.getByRole("button", { name: /chunk now/i });
    expect(chunkButton).toBeDisabled();

    await makeReadyForChunking(container);

    expect(screen.getByRole("button", { name: /chunk now/i })).toBeEnabled();
  });

  it("calls callbacks after successful chunking", async () => {
    const onJobCreated = jest.fn();
    const onAllChunksReady = jest.fn();
    const onFilesReady = jest.fn();

    const { container } = render(
      <ChunkPanel
        fileCount={2}
        onJobCreated={onJobCreated}
        onAllChunksReady={onAllChunksReady}
        onFilesReady={onFilesReady}
      />,
    );

    const { oldFile, newFile } = await makeReadyForChunking(container);

    fireEvent.click(screen.getByRole("button", { name: /chunk now/i }));

    await waitFor(() => {
      expect(onJobCreated).toHaveBeenCalledWith(
        expect.objectContaining({ status: "done", source_name: "ManualV2" }),
      );
    }, { timeout: 4000 });

    expect(onAllChunksReady).toHaveBeenCalledWith(mockResponse.pdf_chunks);
    expect(onFilesReady).toHaveBeenCalledWith(oldFile, newFile, null);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("navigates to compare tool from compare modal row click", async () => {
    const onNavigateToCompare = jest.fn();

    const { container } = render(
      <ChunkPanel
        fileCount={2}
        onNavigateToCompare={onNavigateToCompare}
      />,
    );

    await makeReadyForChunking(container);
    fireEvent.click(screen.getByRole("button", { name: /chunk now/i }));

    await screen.findByRole("button", { name: /compare/i }, { timeout: 4000 });
    fireEvent.click(screen.getByRole("button", { name: /compare/i }));

    const modalChunkRow = await screen.findByRole("button", { name: /section alpha/i });
    fireEvent.click(modalChunkRow);

    await waitFor(() => {
      expect(onNavigateToCompare).toHaveBeenCalledWith(
        expect.objectContaining({ index: 1, old_heading: "Section Alpha" }),
        "ManualV2",
      );
    }, { timeout: 2000 });
  });
});
