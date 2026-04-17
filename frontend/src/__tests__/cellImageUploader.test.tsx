import React from "react";
import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import CellImageUploader from "../components/brd/CellImageUploader";
import api from "@/app/lib/api";

jest.mock("@/app/lib/api", () => ({
  __esModule: true,
  default: {
    post: jest.fn(),
    delete: jest.fn(),
  },
}));

describe("CellImageUploader edit workflow", () => {
  const mockedApi = api as jest.Mocked<typeof api>;

  beforeEach(() => {
    mockedApi.post.mockReset();
    mockedApi.delete.mockReset();

    Object.defineProperty(URL, "createObjectURL", {
      writable: true,
      value: jest.fn(() => "blob:preview-image"),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      writable: true,
      value: jest.fn(),
    });

    class MockFileReader {
      result: string | ArrayBuffer | null = null;
      onload: null | ((event: ProgressEvent<FileReader>) => void) = null;
      onerror: null | ((event: ProgressEvent<FileReader>) => void) = null;

      readAsDataURL() {
        this.result = "data:image/png;base64,ZmFrZQ==";
        this.onload?.({ target: this } as unknown as ProgressEvent<FileReader>);
      }
    }

    Object.defineProperty(window, "FileReader", {
      writable: true,
      value: MockFileReader,
    });
  });

  it("keeps add-image available in edit mode and uploads with image text", async () => {
    mockedApi.post.mockResolvedValue({
      data: {
        success: true,
        image: {
          id: 12,
          mediaName: "policy-shot.png",
          mimeType: "image/png",
          cellText: "Publication screenshot",
          section: "metadata",
          fieldLabel: "Publication Date",
        },
      },
    });

    const onUploaded = jest.fn();
    const { container } = render(
      <CellImageUploader
        brdId="BRD-123"
        section="metadata"
        fieldLabel="Publication Date"
        rowIndex={4}
        colIndex={1}
        defaultCellText="Existing publication text"
        onUploaded={onUploaded}
      />,
    );

    const addButton = screen.getByRole("button", { name: /add image to publication date/i });
    expect(addButton).toBeVisible();

    fireEvent.click(addButton);

    const fileInput = container.querySelector("input[type='file']") as HTMLInputElement;
    const file = new File(["png-bytes"], "policy-shot.png", { type: "image/png" });
    fireEvent.change(fileInput, { target: { files: [file] } });

    const imageText = await screen.findByLabelText(/image text/i);
    fireEvent.change(imageText, { target: { value: "Publication screenshot" } });
    fireEvent.click(screen.getByRole("button", { name: /upload/i }));

    await waitFor(() => {
      expect(mockedApi.post).toHaveBeenCalledWith(
        "/brd/BRD-123/images/upload",
        expect.objectContaining({
          section: "metadata",
          fieldLabel: "Publication Date",          rowIndex: 4,
          colIndex: 1,          cellText: "Publication screenshot",
        }),
      );
    });

    expect(onUploaded).toHaveBeenCalledWith(
      expect.objectContaining({ id: 12, cellText: "Publication screenshot" }),
    );
  });

  it("deletes an existing image from the edit popover", async () => {
    mockedApi.delete.mockResolvedValue({ data: { success: true } });
    const onDeleted = jest.fn();

    render(
      <CellImageUploader
        brdId="BRD-123"
        section="scope"
        fieldLabel="doc-title"
        existingImages={[
          {
            id: 9,
            mediaName: "reference.png",
            mimeType: "image/png",
            cellText: "Reference document screenshot",
            section: "scope",
            fieldLabel: "doc-title",
          },
        ]}
        onDeleted={onDeleted}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /manage images for doc-title/i }));
    fireEvent.click(screen.getByRole("button", { name: /delete/i }));

    await waitFor(() => {
      expect(mockedApi.delete).toHaveBeenCalledWith("/brd/BRD-123/images/9");
    });

    expect(onDeleted).toHaveBeenCalledWith(9);
  });
});
