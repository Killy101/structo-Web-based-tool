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

const mockAuthState = {
  user: {
    role: "ADMIN",
    team: { slug: "pre-production" },
  },
};

jest.mock("../context/AuthContext", () => ({
  useAuth: () => mockAuthState,
}));

describe("BRD dashboard process type editing", () => {
  const mockedApi = api as jest.Mocked<typeof api>;

  beforeEach(() => {
    mockAuthState.user.role = "ADMIN";
    mockAuthState.user.team.slug = "pre-production";
    mockedApi.get.mockReset();
    mockedApi.patch.mockReset();
    mockedApi.post.mockReset();
    mockedApi.delete.mockReset();
  });

  it("shows regular pre-production users a read-only latest-version view", async () => {
    mockAuthState.user.role = "USER";

    mockedApi.get.mockResolvedValue({
      data: [
        {
          id: "BRD-001",
          title: "Sample BRD",
          status: "APPROVED",
          processType: "Updating - Evergreen",
          version: "v2.0",
          lastUpdated: "2026-04-15",
          geography: "Europe",
          format: "new",
        },
      ],
    } as never);

    render(<BrdPage />);

    expect(await screen.findByTitle(/new brd/i)).toBeDisabled();
    expect(screen.queryByTitle(/version history/i)).not.toBeInTheDocument();
    expect(screen.getByTitle(/edit brd/i)).toBeDisabled();
    expect(screen.getByTitle(/remove/i)).toBeDisabled();

    const statusSelect = screen.getByDisplayValue("All Status") as HTMLSelectElement;
    const optionLabels = Array.from(statusSelect.options).map((option) => option.textContent);
    expect(optionLabels).toEqual(["All Status", "Approved", "On Hold"]);
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

  it("shows a re-upload summary after a draft BRD is re-uploaded", async () => {
    let detailFetchCount = 0;

    mockedApi.get.mockImplementation((url: string) => {
      if (url === "/brd") {
        return Promise.resolve({
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
        }) as never;
      }

      if (url === "/brd/BRD-001") {
        detailFetchCount += 1;
        return Promise.resolve({
          data: detailFetchCount === 1
            ? {
                title: "Sample BRD",
                format: "new",
                status: "DRAFT",
                metadata: {
                  content_category_name: "Payments",
                  jurisdiction: "Europe",
                  document_title: "Draft",
                  summary: "Before upload",
                },
                toc: { document_structure: ["1", "2"] },
                citations: { references: ["Ref A"] },
              }
            : {
                title: "Updated BRD",
                format: "old",
                status: "DRAFT",
                metadata: {
                  source_name: "Payments Source",
                  jurisdiction: "Europe",
                  document_title: "Final",
                },
                toc: { document_structure: ["1", "2", "3"] },
                citations: {},
              },
        }) as never;
      }

      return Promise.resolve({ data: [] }) as never;
    });

    mockedApi.post.mockResolvedValue({
      data: { title: "Updated BRD", format: "old", status: "DRAFT" },
    } as never);

    render(<BrdPage />);

    const reuploadButton = (await screen.findAllByTitle(/re-upload final brd/i))
      .find((element) => element.tagName === "BUTTON") as HTMLButtonElement;

    fireEvent.click(reuploadButton);

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["final brd"], "final.docx", {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });

    fireEvent.change(fileInput, { target: { files: [file] } });

    expect(await screen.findByText(/re-upload summary/i)).toBeInTheDocument();
    expect(screen.getByText(/section extraction health/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /open updated brd/i })).toBeInTheDocument();
  });
});
