"use client";
import React, { useState, useRef } from "react";
import { Button, Input, Card } from "../ui";

const PROCESSING_URL =
  process.env.NEXT_PUBLIC_PROCESSING_URL || "http://localhost:8000";

interface ChunkResult {
  tag: string;
  attributes: Record<string, string>;
  content: string;
  size: number;
}

interface ChunkResponse {
  success: boolean;
  identifier: string;
  filename: string;
  tag_name: string;
  attribute: string | null;
  value: string | null;
  max_file_size: number | null;
  total_chunks: number;
  chunks: ChunkResult[];
}

type FileSlot = "old" | "new" | "xml";

export default function ChunkPanel() {
  const [identifier, setIdentifier] = useState("");
  const [tagName, setTagName] = useState("");
  const [attribute, setAttribute] = useState("");
  const [value, setValue] = useState("");
  const [maxFileSize, setMaxFileSize] = useState("");
  const [sizeUnit, setSizeUnit] = useState<"B" | "KB" | "MB">("KB");

  const [files, setFiles] = useState<Record<FileSlot, File | null>>({
    old: null,
    new: null,
    xml: null,
  });
  const [activeSlot, setActiveSlot] = useState<FileSlot>("xml");
  const [results, setResults] = useState<Record<FileSlot, ChunkResponse | null>>({
    old: null,
    new: null,
    xml: null,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedChunk, setExpandedChunk] = useState<number | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const slotLabel: Record<FileSlot, string> = {
    old: "Old XML",
    new: "New XML",
    xml: "XML",
  };

  const slotColor: Record<FileSlot, string> = {
    old: "text-amber-600 border-amber-300 bg-amber-50 dark:bg-amber-900/20",
    new: "text-emerald-600 border-emerald-300 bg-emerald-50 dark:bg-emerald-900/20",
    xml: "text-[#1a56f0] border-blue-300 bg-blue-50 dark:bg-blue-900/20",
  };

  function handleFileButton(slot: FileSlot) {
    setActiveSlot(slot);
    fileInputRef.current?.click();
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    setFiles((prev) => ({ ...prev, [activeSlot]: file }));
    e.target.value = "";
  }

  function getSizeBytes(): number | undefined {
    const n = parseFloat(maxFileSize);
    if (!n || isNaN(n)) return undefined;
    const multipliers = { B: 1, KB: 1024, MB: 1024 * 1024 };
    return Math.round(n * multipliers[sizeUnit]);
  }

  async function handleChunk() {
    const file = files[activeSlot];
    if (!file) {
      setError(`Please select a file for ${slotLabel[activeSlot]}`);
      return;
    }
    if (!tagName.trim()) {
      setError("Tag name is required");
      return;
    }
    setError(null);
    setLoading(true);

    try {
      const form = new FormData();
      form.append("file", file);
      form.append("tag_name", tagName.trim());
      if (attribute.trim()) form.append("attribute", attribute.trim());
      if (value.trim()) form.append("value", value.trim());
      if (identifier.trim()) form.append("identifier", identifier.trim());
      const sizeBytes = getSizeBytes();
      if (sizeBytes) form.append("max_file_size", String(sizeBytes));

      const res = await fetch(`${PROCESSING_URL}/compare/chunk`, {
        method: "POST",
        body: form,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: "Unknown error" }));
        throw new Error(err.detail || "Chunking failed");
      }
      const data: ChunkResponse = await res.json();
      setResults((prev) => ({ ...prev, [activeSlot]: data }));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "An error occurred");
    } finally {
      setLoading(false);
    }
  }

  const result = results[activeSlot];

  return (
    <div className="flex flex-col gap-4 h-full">
      {/* Config panel */}
      <Card className="p-5">
        <div className="grid grid-cols-1 gap-4">
          {/* Identifier */}
          <Input
            label="Identifier / Name"
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            placeholder="e.g. regulation-v2"
          />

          {/* Split criteria */}
          <div className="grid grid-cols-3 gap-3">
            <Input
              label="Split by Tag Name"
              value={tagName}
              onChange={(e) => setTagName(e.target.value)}
              placeholder="e.g. section"
              required
            />
            <Input
              label="Attribute"
              value={attribute}
              onChange={(e) => setAttribute(e.target.value)}
              placeholder="e.g. id"
            />
            <Input
              label="Value"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="e.g. chapter-1"
            />
          </div>

          {/* Max file size */}
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
              Max File Size per Chunk
            </label>
            <div className="flex gap-2">
              <input
                type="number"
                min={0}
                value={maxFileSize}
                onChange={(e) => setMaxFileSize(e.target.value)}
                placeholder="e.g. 500"
                className="flex-1 px-3 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 text-sm bg-white dark:bg-slate-800 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#1a56f0] focus:border-transparent"
              />
              <select
                value={sizeUnit}
                onChange={(e) => setSizeUnit(e.target.value as "B" | "KB" | "MB")}
                className="px-3 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 text-sm bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#1a56f0]"
              >
                <option value="B">B</option>
                <option value="KB">KB</option>
                <option value="MB">MB</option>
              </select>
            </div>
          </div>

          {/* File buttons */}
          <div className="space-y-2">
            <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
              Select File to Chunk
            </p>
            <div className="flex gap-3 flex-wrap">
              {(["old", "new", "xml"] as FileSlot[]).map((slot) => (
                <button
                  key={slot}
                  onClick={() => handleFileButton(slot)}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg border text-sm font-medium transition-all
                    ${activeSlot === slot ? slotColor[slot] + " ring-2 ring-offset-1 ring-current" : "border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700"}`}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                  </svg>
                  {slotLabel[slot]}
                  {files[slot] && (
                    <span className="ml-1 w-2 h-2 rounded-full bg-current opacity-70" />
                  )}
                </button>
              ))}
            </div>
            {files[activeSlot] && (
              <p className="text-xs text-slate-500">
                Selected: <span className="font-medium text-slate-700 dark:text-slate-300">{files[activeSlot]!.name}</span>
                {" "}({(files[activeSlot]!.size / 1024).toFixed(1)} KB)
              </p>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept=".xml,text/xml,application/xml"
              className="hidden"
              onChange={handleFileChange}
            />
          </div>

          {error && (
            <p className="text-sm text-red-500 bg-red-50 dark:bg-red-900/20 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <Button
            onClick={handleChunk}
            loading={loading}
            disabled={!files[activeSlot] || !tagName.trim()}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h8m-8 6h16" />
            </svg>
            Chunk XML
          </Button>
        </div>
      </Card>

      {/* Results */}
      {result && (
        <div className="flex-1 overflow-auto">
          <div className="flex items-center gap-3 mb-3">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
              Results for{" "}
              <span className="font-bold">{result.identifier}</span>
            </h3>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-[#1a56f0] text-white">
              {result.total_chunks} chunks
            </span>
            <span className="text-xs text-slate-500">
              Tag: <code className="bg-slate-100 dark:bg-slate-800 px-1 rounded">&lt;{result.tag_name}&gt;</code>
            </span>
          </div>

          <div className="space-y-2">
            {result.chunks.map((chunk, idx) => (
              <Card key={idx} className="overflow-hidden">
                <button
                  onClick={() => setExpandedChunk(expandedChunk === idx ? null : idx)}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
                >
                  <span className="w-6 h-6 rounded-full bg-[#1a56f0]/10 text-[#1a56f0] text-xs font-bold flex items-center justify-center shrink-0">
                    {idx + 1}
                  </span>
                  <code className="text-sm font-mono text-slate-700 dark:text-slate-300">
                    &lt;{chunk.tag}&gt;
                  </code>
                  {Object.entries(chunk.attributes).map(([k, v]) => (
                    <span key={k} className="text-xs text-slate-500 bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded">
                      {k}="{v}"
                    </span>
                  ))}
                  <span className="ml-auto text-xs text-slate-400">
                    {(chunk.size / 1024).toFixed(1)} KB
                  </span>
                  <svg
                    className={`w-4 h-4 text-slate-400 transition-transform ${expandedChunk === idx ? "rotate-180" : ""}`}
                    fill="none" stroke="currentColor" viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {expandedChunk === idx && (
                  <div className="border-t border-slate-100 dark:border-slate-800">
                    <pre className="p-4 text-xs font-mono text-slate-700 dark:text-slate-300 overflow-x-auto bg-slate-50 dark:bg-slate-900 max-h-64 overflow-y-auto">
                      {chunk.content}
                    </pre>
                  </div>
                )}
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
