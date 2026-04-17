import React from "react";
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import ComparePage from "../app/dashboard/compare/page";

const mockAuthState = {
  user: {
    role: "USER",
    userId: "tester",
    effectiveFeatures: [] as string[],
  },
};

jest.mock("../context/AuthContext", () => ({
  useAuth: () => mockAuthState,
}));

jest.mock("next/dynamic", () => () => {
  const MockComponent = () => null;
  MockComponent.displayName = "DynamicMock";
  return MockComponent;
});

jest.mock("../utils/compareAnalytics", () => ({
  trackCompareUsage: jest.fn(),
}));

jest.mock("../services/api", () => ({
  userLogsApi: { logCompare: jest.fn() },
}));

describe("Compare workflow access", () => {
  it("shows only Workflow 1 as available for compare-basic users", () => {
    mockAuthState.user.effectiveFeatures = ["compare-basic"];

    render(<ComparePage />);

    const workflow1Card = screen.getByText("Workflow 1").closest("div");
    const workflow2Card = screen.getByText("Workflow 2").closest("div");

    expect(workflow1Card).toBeInTheDocument();
    expect(workflow2Card).toBeInTheDocument();
    expect(screen.getAllByText("Start Workflow")).toHaveLength(1);
    expect(screen.getByText("Locked")).toBeInTheDocument();
  });

  it("shows Workflow 1 and Workflow 2 for advanced compare users", () => {
    mockAuthState.user.effectiveFeatures = ["compare-basic", "compare-pdf-xml-only"];

    render(<ComparePage />);

    expect(screen.getByText("Workflow 1")).toBeInTheDocument();
    expect(screen.getByText("Workflow 2")).toBeInTheDocument();
    expect(screen.getAllByText("Start Workflow")).toHaveLength(2);
    expect(screen.queryByText("Locked")).not.toBeInTheDocument();
  });
});
