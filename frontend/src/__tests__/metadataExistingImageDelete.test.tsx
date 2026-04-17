import React from "react";
import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import Metadata from "../components/brd/Metadata";
import api from "@/app/lib/api";

jest.mock("@/app/lib/api", () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
    delete: jest.fn(),
    put: jest.fn(),
  },
}));

describe("Metadata existing image delete flow", () => {
  const mockedApi = api as jest.Mocked<typeof api>;

  beforeEach(() => {
    mockedApi.get.mockReset();
    mockedApi.delete.mockReset();
    mockedApi.put.mockReset();
  });

  it("allows deleting a fetched persisted metadata image", async () => {
    mockedApi.get.mockResolvedValue({
      data: {
        images: [
          {
            id: 42,
            tableIndex: 5,
            rowIndex: 5,
            colIndex: 0,
            rid: "rId7",
            mediaName: "publication-date.png",
            mimeType: "image/png",
            cellText: "Publication date screenshot",
            section: "metadata",
            fieldLabel: "Publication Date",
          },
        ],
      },
    } as never);
    mockedApi.delete.mockResolvedValue({ data: { success: true } } as never);

    render(
      <Metadata
        format="old"
        brdId="BRD-123"
        initialData={{}}
      />,
    );

    const manageButton = await screen.findByRole("button", { name: /manage images for publicationdate/i });
    fireEvent.click(manageButton);
    fireEvent.click(await screen.findByRole("button", { name: /delete/i }));

    await waitFor(() => {
      expect(mockedApi.delete).toHaveBeenCalledWith("/brd/BRD-123/images/42");
    });
  });
});