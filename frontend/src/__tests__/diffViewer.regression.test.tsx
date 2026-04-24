import React from "react";
import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import DiffPane from "../components/compare/DiffPane";
import DiffViewer from "../components/compare/DiffViewer";
import XmlPanel from "../components/compare/XmlPanel";
import type { DiffResult, PaneData } from "../components/compare/types";

jest.mock("../components/compare/api", () => ({
  apiApply: jest.fn(),
  apiLocate: jest.fn().mockResolvedValue({ span_start: null, span_end: null }),
}));

jest.mock("../context/ThemContext", () => ({
  useTheme: () => ({ dark: false }),
}));

function makePane(overrides: Partial<PaneData> = {}): PaneData {
  return {
    segments: [["Line 1", "default"], ["\n", "default"], ["Line 2", "default"]],
    tag_cfgs: { default: {} },
    offsets: {},
    offset_ends: {},
    ...overrides,
  };
}

describe("Diff viewer regressions", () => {
  beforeEach(() => {
    jest.spyOn(window, "requestAnimationFrame").mockImplementation((cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("removes underline styling from unchanged PDF content", () => {
    render(
      <DiffPane
        pane={makePane({
          segments: [["No changes detected", "underlined"]],
          tag_cfgs: { underlined: { underline: true } },
        })}
        chunks={[]}
        activeChunkId={null}
        filename="old.pdf"
        side="a"
      />,
    );

    expect(screen.getByText("No changes detected")).not.toHaveStyle("text-decoration: underline");
  });

  it("shows line numbers in the PDF and XML panes", () => {
    const { rerender } = render(
      <DiffPane
        pane={makePane()}
        chunks={[]}
        activeChunkId={null}
        filename="old.pdf"
        side="a"
      />,
    );

    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();

    rerender(
      <XmlPanel
        mode="wf2"
        xmlText={'<root>\n  <item />\n</root>'}
        xmlFilename="test.xml"
        activeChunk={null}
        appliedIds={new Set()}
        navSpan={null}
        status=""
        onLoad={jest.fn()}
        onApply={jest.fn()}
        onDownload={jest.fn()}
      />,
    );

    expect(screen.getAllByText("1").length).toBeGreaterThan(0);
    expect(screen.getAllByText("2").length).toBeGreaterThan(0);
  });

  it("shows navigation and alignment controls for easier diff review", () => {
    const result: DiffResult = {
      success: true,
      chunks: [
        {
          id: 1,
          kind: "mod",
          block_a: 1,
          block_b: 1,
          text_a: "old",
          text_b: "new",
          confidence: 1,
          reason: "modified",
          section: "Section 1",
        },
      ],
      pane_a: makePane({ offsets: { "1": 0 }, offset_ends: { "1": 4 } }),
      pane_b: makePane({ offsets: { "1": 0 }, offset_ends: { "1": 4 } }),
      stats: { total: 1, additions: 0, deletions: 0, modifications: 1, emphasis: 0 },
      file_a: "old.pdf",
      file_b: "new.pdf",
      xml_sections: [],
    };

    render(
      <DiffViewer
        mode="wf2"
        result={result}
        onReset={jest.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: /previous change/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /next change/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /aligned lines/i })).toBeInTheDocument();
  });

  it("synchronizes scroll positions across old, new, and XML panes immediately", async () => {
    const result: DiffResult = {
      success: true,
      chunks: [
        {
          id: 1,
          kind: "mod",
          block_a: 1,
          block_b: 1,
          text_a: "old",
          text_b: "new",
          confidence: 1,
          reason: "modified",
          section: "Section 1",
        },
      ],
      pane_a: makePane({ offsets: { "1": 0 }, offset_ends: { "1": 4 } }),
      pane_b: makePane({ offsets: { "1": 0 }, offset_ends: { "1": 4 } }),
      stats: { total: 1, additions: 0, deletions: 0, modifications: 1, emphasis: 0 },
      file_a: "old.pdf",
      file_b: "new.pdf",
      xml_sections: [],
    };

    const file = new File(["<root>\n<item/>\n</root>"], "test.xml", { type: "text/xml" });

    render(
      <DiffViewer
        mode="wf2"
        result={result}
        onReset={jest.fn()}
        initialXmlFile={file}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText(/loaded test\.xml/i)).toBeInTheDocument();
    });

    const oldScroll = screen.getByTestId("diff-pane-scroll-a");
    const newScroll = screen.getByTestId("diff-pane-scroll-b");
    const xmlScroll = screen.getByTestId("xml-panel-scroll");

    Object.defineProperty(oldScroll, "scrollHeight", { value: 1000, configurable: true });
    Object.defineProperty(oldScroll, "clientHeight", { value: 200, configurable: true });
    Object.defineProperty(newScroll, "scrollHeight", { value: 1000, configurable: true });
    Object.defineProperty(newScroll, "clientHeight", { value: 200, configurable: true });
    Object.defineProperty(xmlScroll, "scrollHeight", { value: 1000, configurable: true });
    Object.defineProperty(xmlScroll, "clientHeight", { value: 200, configurable: true });

    oldScroll.scrollTop = 400;
    fireEvent.scroll(oldScroll);

    expect(newScroll.scrollTop).toBe(400);
    expect(xmlScroll.scrollTop).toBe(400);
  });
});
