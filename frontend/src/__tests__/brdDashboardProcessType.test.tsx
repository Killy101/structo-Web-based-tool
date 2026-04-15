import React from "react";
import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import BrdPage from "../app/dashboard/brd/page";
import api from "@/app/lib/api";

jest.mock("@/app/lib/api", () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
    patch: jest.fn(),
    post: jest.fn(),
    delete: jest.fn(),
  },
}));

jest.mock("../context/AuthContext", () => ({
  useAuth: () => ({
    user: {
      role: "ADMIN",
      team: { slug: "pre-production" },
    },
  }),
}));

describe("BRD dashboard process type editing", () => {
  const mockedApi = api as jest.Mocked<typeof api>;

  beforeEach(() => {
    mockedApi.get.mockReset();
    mockedApi.patch.mockReset();
    mockedApi.post.mockReset();
    mockedApi.delete.mockReset();
  });

  it("lets admins change the process type directly from the dashboard", async () => {
    mockedApi.get
      .mockResolvedValueOnce({
        data: [
          {
            id: "BRD-001",
            title: "Sample BRD",
            status: "DRAFT",
            processType: "New source - Initial",
            version: "v1.0",
            lastUpdated: "2026-04-15",
            geography: "Europe",
            format: "new",
          },
        ],
      } as never)
      .mockResolvedValueOnce({
        data: [
          {
            id: "BRD-001",
            title: "Sample BRD",
            status: "DRAFT",
            processType: "Updating - Evergreen",
            version: "v1.0",
            lastUpdated: "2026-04-15",
            geography: "Europe",
            format: "new",
          },
        ],
      } as never);
    mockedApi.patch.mockResolvedValue({ data: { success: true } } as never);

    render(<BrdPage />);

    const processTypeSelect = await screen.findByDisplayValue("New source - Initial");
    expect(processTypeSelect).toHaveAttribute("data-process-type-tone", "blue");

    fireEvent.change(processTypeSelect, { target: { value: "Updating - Evergreen" } });

    await waitFor(() => {
      expect(mockedApi.patch).toHaveBeenCalledWith("/brd/BRD-001", { processType: "Updating - Evergreen" });
    });

    await waitFor(() => {
      expect(processTypeSelect).toHaveAttribute("data-process-type-tone", "green");
    });
  });
});
