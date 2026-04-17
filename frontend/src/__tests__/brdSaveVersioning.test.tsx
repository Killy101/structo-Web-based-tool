import React from "react";
import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import Generate from "../components/brd/Generate";
import api from "@/app/lib/api";

jest.mock("@/app/lib/api", () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    patch: jest.fn(),
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

describe("BRD save versioning", () => {
  const mockedApi = api as jest.Mocked<typeof api>;

  beforeAll(() => {
    class MockIntersectionObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
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
    mockedApi.post.mockReset();
    mockedApi.put.mockReset();
    mockedApi.patch.mockReset();
    mockedApi.delete.mockReset();

    mockedApi.get.mockImplementation((url) => {
      if (url === "/brd/BRD-001/versions") {
        return Promise.resolve({ data: { versions: [] } } as never);
      }
      if (url === "/brd/BRD-001/sections") {
        return Promise.resolve({
          data: {
            scope: {},
            metadata: {},
            toc: {},
            citations: {},
            contentProfile: {},
            brdConfig: {},
          },
        } as never);
      }
      return Promise.resolve({ data: {} } as never);
    });

    mockedApi.post.mockImplementation((url) => {
      if (url === "/brd/save") {
        return Promise.resolve({ data: { success: true } } as never);
      }
      if (url === "/brd/generate/metajson") {
        return Promise.resolve({ data: { success: true, metajson: {} } } as never);
      }
      if (url === "/brd/BRD-001/versions") {
        return Promise.resolve({ data: { versionNum: 1, label: "v1.0" } } as never);
      }
      return Promise.resolve({ data: {} } as never);
    });

    mockedApi.put.mockResolvedValue({ data: { success: true } } as never);
  });

  it("creates only one v1.0 snapshot on the first draft save", async () => {
    render(
      <Generate
        brdId="BRD-001"
        title="Sample BRD"
        format="new"
        status="DRAFT"
        showCellImages={false}
        canEdit={true}
        initialData={{
          scope: {},
          metadata: {},
          toc: {},
          citations: {},
          contentProfile: {},
          brdConfig: {},
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /save brd/i }));

    await waitFor(() => {
      expect(mockedApi.post).toHaveBeenCalledWith(
        "/brd/save",
        expect.objectContaining({ brdId: "BRD-001", status: "DRAFT" }),
      );
    });

    await waitFor(() => {
      expect(screen.getByText(/snapshot/i)).toHaveTextContent("v1.0");
    });

    const versionCalls = mockedApi.post.mock.calls.filter(([url]) => url === "/brd/BRD-001/versions");
    expect(versionCalls).toHaveLength(1);
    expect(mockedApi.get).not.toHaveBeenCalledWith("/brd/BRD-001/sections");
  });
});
