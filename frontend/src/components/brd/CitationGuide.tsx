import React, { useEffect, useRef, useState } from "react";
import BrdTableHeaderCell from "./BrdTableHeaderCell";
import RichTextEditableField from "./RichTextEditableField";
import { brdRichTextToPlain } from "@/utils/brdRichText";

interface CitationGuideRow {
  label: string;
  value: string;
}

interface CitationGuideState {
  description: string;
  rows: CitationGuideRow[];
}

interface Props {
  initialData?: {
    citationStyleGuide?: {
      description?: string;
      rows?: Array<{ label?: string; value?: string }>;
    };
  };
  onDataChange?: (data: Record<string, unknown>) => void;
}

function hasMeaningfulRichText(value: string): boolean {
  return brdRichTextToPlain(value).trim().length > 0;
}

function normalizeCitationGuide(raw?: Props["initialData"]): CitationGuideState {
  const source = raw?.citationStyleGuide;
  const description = typeof source?.description === "string" ? source.description : "";
  const rows = Array.isArray(source?.rows)
    ? source.rows
        .map((row) => ({
          label: typeof row?.label === "string" ? row.label : "",
          value: typeof row?.value === "string" ? row.value : "",
        }))
        .filter((row) => row.label.trim() || hasMeaningfulRichText(row.value))
    : [];

  return { description, rows };
}

function citationGuideStatesEqual(a: CitationGuideState, b: CitationGuideState): boolean {
  if (a.description !== b.description) return false;
  if (a.rows.length !== b.rows.length) return false;
  return a.rows.every((row, index) => row.label === b.rows[index]?.label && row.value === b.rows[index]?.value);
}

export default function CitationGuide({ initialData, onDataChange }: Props) {
  const [guide, setGuide] = useState<CitationGuideState>(() => normalizeCitationGuide(initialData));
  const [saved, setSaved] = useState(false);
  const [activeRowIndex, setActiveRowIndex] = useState<number | null>(null);
  const isInitializing = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const nextGuide = normalizeCitationGuide(initialData);
    if (citationGuideStatesEqual(guide, nextGuide)) return;

    isInitializing.current = true;
    const frame = window.requestAnimationFrame(() => {
      setGuide((prev) => (citationGuideStatesEqual(prev, nextGuide) ? prev : nextGuide));
    });

    return () => window.cancelAnimationFrame(frame);
    // Only rehydrate when upstream initial data changes, not on every local edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialData]);

  useEffect(() => {
    if (!onDataChange) return;
    if (isInitializing.current) {
      isInitializing.current = false;
      return;
    }

    const normalizedRows = guide.rows
      .map((row) => ({ label: row.label.trim(), value: row.value.trim() }))
      .filter((row) => row.label || hasMeaningfulRichText(row.value));

    const hasCitationGuide = hasMeaningfulRichText(guide.description) || normalizedRows.length > 0;

    onDataChange({
      citationStyleGuide: hasCitationGuide
        ? {
            ...(guide.description.trim() && { description: guide.description.trim() }),
            ...(normalizedRows.length > 0 && { rows: normalizedRows }),
          }
        : undefined,
    });
  }, [guide, onDataChange]);

  function updateRow(index: number, field: keyof CitationGuideRow, value: string) {
    setGuide((prev) => ({
      ...prev,
      rows: prev.rows.map((row, rowIndex) => (rowIndex === index ? { ...row, [field]: value } : row)),
    }));
  }

  function addRow() {
    setGuide((prev) => {
      const nextRows = [...prev.rows, { label: "", value: "" }];
      setActiveRowIndex(nextRows.length - 1);
      return { ...prev, rows: nextRows };
    });
  }

  function removeRow(index: number) {
    setGuide((prev) => ({ ...prev, rows: prev.rows.filter((_, rowIndex) => rowIndex !== index) }));
    setActiveRowIndex((prev) => {
      if (prev === null) return prev;
      if (prev === index) return null;
      return prev > index ? prev - 1 : prev;
    });
  }

  function handleSave() {
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1800);
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const root = containerRef.current;
      if (!root) return;
      const activeElement = document.activeElement;
      const targetNode = e.target as Node | null;
      const withinEditor = (activeElement ? root.contains(activeElement) : false)
        || (targetNode ? root.contains(targetNode) : false)
        || activeRowIndex !== null;
      if (!withinEditor) return;

      const target = e.target as HTMLElement | null;
      const isTypingTarget = !!target && (
        target.tagName === "INPUT"
        || target.tagName === "TEXTAREA"
        || target.isContentEditable
      );

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "w") {
        e.preventDefault();
        addRow();
        return;
      }

      if (e.key === "Delete" && !isTypingTarget && activeRowIndex !== null) {
        e.preventDefault();
        removeRow(activeRowIndex);
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [activeRowIndex, guide.rows.length]);

  return (
    <div ref={containerRef} className="space-y-4 rounded-2xl border border-slate-300 dark:border-slate-600 bg-white/80 dark:bg-slate-900/30 p-4">
      <div className="flex items-center justify-between px-3 py-2 rounded-lg border bg-sky-50 dark:bg-sky-500/10 border-sky-200 dark:border-sky-700/40">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-sky-800 dark:text-sky-300" style={{ fontFamily: "'DM Mono', monospace" }}>
            Citation Guide Link
          </p>
          <p className="text-[11.5px] text-slate-500 dark:text-slate-400 mt-0.5">
            Maintain source-specific citation guidance separately from scope and TOC.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleSave}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium transition-all ${
              saved
                ? "bg-emerald-500 text-white"
                : "bg-white dark:bg-[#1e2235] text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-[#2a3147] hover:bg-slate-50 dark:hover:bg-[#252d45]"
            }`}
          >
            {saved ? "Saved!" : "Save"}
          </button>
          <button
            type="button"
            onClick={addRow}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium bg-slate-800 dark:bg-[#252d45] text-white dark:text-slate-200 border border-transparent dark:border-[#3a4460] hover:bg-slate-700 dark:hover:bg-[#2e3a55] transition-all"
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" /></svg>
            Add Row
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 dark:border-[#2a3147] overflow-hidden">
        <div className="px-3 py-2 bg-slate-100 dark:bg-[#1e2235] border-b border-slate-200 dark:border-[#2a3147]">
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-700 dark:text-slate-300" style={{ fontFamily: "'DM Mono', monospace" }}>
            SME Checkpoint
          </p>
        </div>
        <div className="p-3">
          <RichTextEditableField
            value={guide.description}
            onChange={(value) => setGuide((prev) => ({ ...prev, description: value }))}
            rows={4}
            labelPrefix="SME Checkpoint"
            placeholder="Add citation guide notes, external links, or source-specific instructions"
          />
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 dark:border-[#2a3147] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-[11.5px] border-collapse" style={{ minWidth: "640px" }}>
            <thead>
              <tr className="bg-slate-100 dark:bg-[#1e2235] border-b border-slate-200 dark:border-[#2a3147]">
                <BrdTableHeaderCell className="w-52" title="Label" checkpoint="SME Checkpoint" blueNote="Field name shown to the delivery team" />
                <BrdTableHeaderCell title="Value" checkpoint="SME Checkpoint" blueNote="Paste the citation guide URL or instruction text" />
                <th className="w-10 px-2 py-2.5 bg-slate-50 dark:bg-[#1e2235]" />
              </tr>
            </thead>
            <tbody>
              {guide.rows.length === 0 ? (
                <tr>
                  <td colSpan={3} className="px-3 py-8 text-center text-[12px] text-slate-400 dark:text-slate-500 italic">
                    No citation guide rows yet
                  </td>
                </tr>
              ) : (
                guide.rows.map((row, index) => (
                  <tr
                    key={`citation-guide-row-${index}`}
                    onClick={() => setActiveRowIndex(index)}
                    onFocusCapture={() => setActiveRowIndex(index)}
                    className={`${index % 2 === 0 ? "bg-white dark:bg-[#161b2e]" : "bg-slate-50/60 dark:bg-[#1a1f35]"} ${activeRowIndex === index ? "ring-1 ring-blue-300 dark:ring-blue-700/40" : ""}`}
                  >
                    <td className="px-3 py-2 align-top border-r border-slate-100 dark:border-[#2a3147]">
                      <input
                        value={row.label}
                        onChange={(e) => updateRow(index, "label", e.target.value)}
                        placeholder="e.g. Link"
                        className="w-full text-[11.5px] bg-white dark:bg-[#252d45] border border-slate-300 dark:border-[#2a3147] rounded px-2 py-1 outline-none text-slate-700 dark:text-slate-200"
                      />
                    </td>
                    <td className="px-3 py-2 align-top border-r border-slate-100 dark:border-[#2a3147]">
                      <RichTextEditableField
                        value={row.value}
                        onChange={(value) => updateRow(index, "value", value)}
                        rows={2}
                        placeholder="Enter citation guide value"
                        previewClassName="min-h-[44px] cursor-text rounded border border-slate-300 dark:border-[#2a3147] bg-white dark:bg-[#161b2e] px-2 py-1 text-[11.5px] text-slate-700 dark:text-slate-200 whitespace-pre-wrap break-words"
                        inputClassName="w-full text-[11.5px] bg-white dark:bg-[#252d45] border border-slate-300 dark:border-[#2a3147] rounded px-2 py-1 outline-none text-slate-700 dark:text-slate-200 leading-snug"
                      />
                    </td>
                    <td className="px-2 py-2 align-top">
                      <button
                        type="button"
                        onClick={() => removeRow(index)}
                        className="w-7 h-7 flex items-center justify-center rounded text-slate-400 dark:text-slate-600 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 transition-all"
                        aria-label="Remove citation guide row"
                      >
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
