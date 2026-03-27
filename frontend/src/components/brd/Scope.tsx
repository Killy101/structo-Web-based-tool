import CellImageUploader, { UploadedCellImage } from "./CellImageUploader";
import React, { useEffect, useRef, useState } from "react";
import api from "@/app/lib/api";
import { buildBrdImageBlobUrl } from "@/utils/brdImageUrl";

/* ─────────────── types ─────────────── */
interface ScopeRow {
  id: string; stableKey: string; title: string; referenceLink: string; contentUrl: string;
  issuingAuth: string; asrbId: string; smeComments: string;
  initialEvergreen: string; dateOfIngestion: string; isOutOfScope: boolean;
}
interface ScopeEntry {
  document_title?: string; regulator_url?: string; content_url?: string;
  issuing_authority?: string; issuing_authority_code?: string;
  geography?: string; asrb_id?: string; sme_comments?: string;
  initial_evergreen?: string; date_of_ingestion?: string; strikethrough?: boolean;
}

interface Props { initialData?: Record<string, unknown>; brdId?: string; onDataChange?: (data: Record<string, unknown>) => void; }

/* ─────────────── validation types ─────────────── */
type Severity = "error" | "warning";
interface ValidationIssue {
  rowId: string;
  rowTitle: string;
  rowNumber: number;           // 1-based position in the table
  rowData: ScopeRow;           // full snapshot of the row at validation time
  affectedValue: string;       // exact cell value that triggered the issue
  field: "title" | "referenceLink" | "contentUrl";
  kind: "duplicate_title" | "duplicate_url" | "broken_link" | "empty_link";
  message: string;
  severity: Severity;
  duplicateWith?: string;
  duplicateRowNumbers?: number[];
}
interface ValidationState {
  phase: "idle" | "running" | "done";
  progress: number; currentStep: string;
  issues: ValidationIssue[]; checkedCount: number; totalLinks: number;
}

/* ─────────────── helpers ─────────────── */
function asScopeEntryArray(v: unknown): ScopeEntry[] {
  if (!Array.isArray(v)) return [];
  return v.filter((i) => i !== null && typeof i === "object") as ScopeEntry[];
}
function toRow(e: ScopeEntry, id: string, oos: boolean, stableKey: string): ScopeRow {
  const authLabel = e.issuing_authority
    ? `${e.issuing_authority}${e.issuing_authority_code ? ` (${e.issuing_authority_code})` : ""}` : "";
  return {
    id, stableKey, isOutOfScope: oos || !!e.strikethrough,
    title: e.document_title ?? "", referenceLink: e.regulator_url ?? "",
    contentUrl: e.content_url ?? "", issuingAuth: authLabel,
    asrbId: e.asrb_id ?? "", smeComments: e.sme_comments ?? "",
    initialEvergreen: e.initial_evergreen ?? "", dateOfIngestion: e.date_of_ingestion ?? "",
  };
}
function rowsToScopeData(rows: ScopeRow[]): Record<string, unknown> {
  const inScope  = rows.filter(r => !r.isOutOfScope).map(r => ({
    document_title: r.title, regulator_url: r.referenceLink, content_url: r.contentUrl,
    issuing_authority: r.issuingAuth, asrb_id: r.asrbId, sme_comments: r.smeComments,
    initial_evergreen: r.initialEvergreen, date_of_ingestion: r.dateOfIngestion,
  }));
  const outOfScope = rows.filter(r => r.isOutOfScope).map(r => ({
    document_title: r.title, regulator_url: r.referenceLink, content_url: r.contentUrl,
    issuing_authority: r.issuingAuth, asrb_id: r.asrbId, sme_comments: r.smeComments,
    initial_evergreen: r.initialEvergreen, date_of_ingestion: r.dateOfIngestion, strikethrough: true,
  }));
  return { in_scope: inScope, out_of_scope: outOfScope };
}

function buildRows(d?: Record<string, unknown>): ScopeRow[] {
  if (!d) return [];
  const now = Date.now().toString(); const rows: ScopeRow[] = [];
  asScopeEntryArray(d.in_scope).forEach((e, i) => rows.push(toRow(e, `${now}-in-${i}`, false, `in-${i}`)));
  asScopeEntryArray(d.out_of_scope).forEach((e, i) => rows.push(toRow(e, `${now}-out-${i}`, true, `out-${i}`)));
  return rows;
}

function normalizeScopeRow(row: ScopeRow) {
  return {
    stableKey: row.stableKey,
    title: row.title,
    referenceLink: row.referenceLink,
    contentUrl: row.contentUrl,
    issuingAuth: row.issuingAuth,
    asrbId: row.asrbId,
    smeComments: row.smeComments,
    initialEvergreen: row.initialEvergreen,
    dateOfIngestion: row.dateOfIngestion,
    isOutOfScope: row.isOutOfScope,
  };
}

function scopeRowsEqualIgnoringIds(a: ScopeRow[], b: ScopeRow[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (JSON.stringify(normalizeScopeRow(a[i])) !== JSON.stringify(normalizeScopeRow(b[i]))) {
      return false;
    }
  }
  return true;
}
function hasExtraCols(rows: ScopeRow[]) {
  return { evergreen: rows.some((r) => r.initialEvergreen), ingestion: rows.some((r) => r.dateOfIngestion) };
}

/* ─────────────── link checker ─────────────── */
async function checkLink(url: string): Promise<"ok" | "broken"> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    await fetch(url, { method: "HEAD", mode: "no-cors", signal: ctrl.signal, redirect: "follow" });
    clearTimeout(timer);
    return "ok";
  } catch {
    return "broken";
  }
}

/* ─────────────── validation engine ─────────────── */
async function runValidation(
  rows: ScopeRow[],
  onProgress: (s: ValidationState) => void
): Promise<ValidationIssue[]> {
  // Build a rowNumber lookup: rowId -> 1-based index
  const rowIndex = new Map<string, number>();
  rows.forEach((r, i) => rowIndex.set(r.id, i + 1));

  const issues: ValidationIssue[] = [];
  onProgress({ phase: "running", progress: 5, currentStep: "Checking duplicate titles…", issues: [], checkedCount: 0, totalLinks: 0 });
  await new Promise(r => setTimeout(r, 300));

  // Duplicate titles
  const titleMap = new Map<string, ScopeRow[]>();
  rows.forEach(r => {
    if (!r.title.trim()) return;
    const key = r.title.trim().toLowerCase();
    if (!titleMap.has(key)) titleMap.set(key, []);
    titleMap.get(key)!.push(r);
  });
  titleMap.forEach((dupes) => {
    if (dupes.length < 2) return;
    dupes.forEach((r, i) => {
      const others = dupes.filter((_, j) => j !== i);
      const othersLabel = others.map(d => `Row ${rowIndex.get(d.id)} "${d.title}"`).join(", ");
      issues.push({
        rowId: r.id, rowTitle: r.title, rowNumber: rowIndex.get(r.id)!,
        rowData: { ...r }, affectedValue: r.title,
        field: "title", kind: "duplicate_title", severity: "error",
        message: `Duplicate title — also found in: ${othersLabel}`,
        duplicateWith: othersLabel,
        duplicateRowNumbers: others.map(d => rowIndex.get(d.id)!),
      });
    });
  });

  onProgress({ phase: "running", progress: 15, currentStep: "Checking duplicate URLs…", issues: [...issues], checkedCount: 0, totalLinks: 0 });
  await new Promise(r => setTimeout(r, 300));

  // Duplicate content URLs
  const urlMap = new Map<string, ScopeRow[]>();
  rows.forEach(r => {
    if (!r.contentUrl.trim()) return;
    const key = r.contentUrl.trim().toLowerCase();
    if (!urlMap.has(key)) urlMap.set(key, []);
    urlMap.get(key)!.push(r);
  });
  urlMap.forEach((dupes) => {
    if (dupes.length < 2) return;
    dupes.forEach((r, i) => {
      const others = dupes.filter((_, j) => j !== i);
      const othersLabel = others.map(d => `Row ${rowIndex.get(d.id)} "${d.title || d.contentUrl}"`).join(", ");
      issues.push({
        rowId: r.id, rowTitle: r.title || r.contentUrl, rowNumber: rowIndex.get(r.id)!,
        rowData: { ...r }, affectedValue: r.contentUrl,
        field: "contentUrl", kind: "duplicate_url", severity: "error",
        message: `Duplicate content URL — same as: ${othersLabel}`,
        duplicateWith: othersLabel,
        duplicateRowNumbers: others.map(d => rowIndex.get(d.id)!),
      });
    });
  });

  // Link checks
  const linksToCheck: Array<{ row: ScopeRow; field: "referenceLink" | "contentUrl"; url: string }> = [];
  rows.forEach(r => {
    if (r.referenceLink.trim()) linksToCheck.push({ row: r, field: "referenceLink", url: r.referenceLink.trim() });
    if (r.contentUrl.trim()) linksToCheck.push({ row: r, field: "contentUrl", url: r.contentUrl.trim() });
  });
  const totalLinks = linksToCheck.length;
  let checkedCount = 0;
  for (const item of linksToCheck) {
    const progressPct = 20 + Math.round((checkedCount / Math.max(totalLinks, 1)) * 75);
    onProgress({ phase: "running", progress: progressPct, currentStep: `Checking link ${checkedCount + 1} of ${totalLinks}…`, issues: [...issues], checkedCount, totalLinks });
    try {
      new URL(item.url);
      const result = await checkLink(item.url);
      if (result === "broken") {
        issues.push({
          rowId: item.row.id, rowTitle: item.row.title || item.url,
          rowNumber: rowIndex.get(item.row.id)!, rowData: { ...item.row },
          affectedValue: item.url,
          field: item.field, kind: "broken_link", severity: "error",
          message: `Link unreachable or timed out: ${item.url}`,
        });
      }
    } catch {
      issues.push({
        rowId: item.row.id, rowTitle: item.row.title || item.url,
        rowNumber: rowIndex.get(item.row.id)!, rowData: { ...item.row },
        affectedValue: item.url,
        field: item.field, kind: "empty_link", severity: "warning",
        message: `Invalid URL format: "${item.url}"`,
      });
    }
    checkedCount++;
  }
  return issues;
}

/* ─────────────── Excel report generator ─────────────── */
const KIND_LABEL: Record<string, string> = {
  duplicate_title: "Duplicate Title",
  duplicate_url:   "Duplicate URL",
  broken_link:     "Broken Link",
  empty_link:      "Invalid URL",
};
const FIELD_LABEL: Record<string, string> = {
  title: "Document Title",
  referenceLink: "Reference Link",
  contentUrl: "Content URL",
};

/* ─────────────── pure-JS xlsx builder ─────────────── */
function escXml(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// styleIndex: 0=normal, 1=bold, 2=bold+red bg (error), 3=bold+amber bg (warning), 4=red text, 5=amber text
function buildSheetXml(rows: (string | number)[][], styleMap?: Map<string, number>): string {
  if (!rows.length) return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData/></worksheet>`;

  const colWidths = rows[0].map((_, ci) =>
    Math.min(80, Math.max(10, ...rows.map(r => String(r[ci] ?? "").length)))
  );
  const colsXml = colWidths.map((w, i) =>
    `<col min="${i+1}" max="${i+1}" width="${w * 1.15}" customWidth="1"/>`
  ).join("");

  const rowsXml = rows.map((row, ri) => {
    const cells = row.map((cell, ci) => {
      const col = ci < 26 ? String.fromCharCode(65 + ci) : String.fromCharCode(64 + Math.floor(ci/26)) + String.fromCharCode(65 + (ci%26));
      const addr = `${col}${ri + 1}`;
      const sIdx = styleMap?.get(addr) ?? (ri === 0 ? 1 : 0);
      const style = sIdx > 0 ? ` s="${sIdx}"` : "";
      const isNum = typeof cell === "number";
      return isNum
        ? `<c r="${addr}"${style}><v>${cell}</v></c>`
        : `<c r="${addr}" t="inlineStr"${style}><is><t>${escXml(cell)}</t></is></c>`;
    }).join("");
    return `<row r="${ri + 1}">${cells}</row>`;
  }).join("");

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <cols>${colsXml}</cols>
  <sheetData>${rowsXml}</sheetData>
</worksheet>`;
}

function buildXlsx(sheets: { name: string; rows: (string | number)[][]; styleMap?: Map<string, number> }[]): Blob {
  const sheetXmls = sheets.map(s => buildSheetXml(s.rows, s.styleMap));

  // styles: 0=normal, 1=bold, 2=bold+red fill, 3=bold+amber fill, 4=red text normal, 5=amber text normal
  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts>
    <font><sz val="11"/><name val="Arial"/></font>
    <font><b/><sz val="11"/><name val="Arial"/></font>
    <font><b/><sz val="11"/><color rgb="FF721C1C"/><name val="Arial"/></font>
    <font><b/><sz val="11"/><color rgb="FF78350F"/><name val="Arial"/></font>
    <font><sz val="11"/><color rgb="FF991B1B"/><name val="Arial"/></font>
    <font><sz val="11"/><color rgb="FF92400E"/><name val="Arial"/></font>
  </fonts>
  <fills>
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFFEE2E2"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFFEF3C7"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF1E3A5F"/></patternFill></fill>
  </fills>
  <borders><border><left/><right/><top/><bottom/><diagonal/></border></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="4" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
    <xf numFmtId="0" fontId="2" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
    <xf numFmtId="0" fontId="3" fillId="3" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
    <xf numFmtId="0" fontId="4" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
    <xf numFmtId="0" fontId="5" fillId="3" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
  </cellXfs>
</styleSheet>`;

  const sheetRels = sheets.map((_, i) =>
    `<Override PartName="/xl/worksheets/sheet${i+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
  ).join("\n");
  const workbookSheets = sheets.map((s, i) =>
    `<sheet name="${escXml(s.name)}" sheetId="${i+1}" r:id="rId${i+2}"/>`
  ).join("\n");
  const workbookRels = sheets.map((_, i) =>
    `<Relationship Id="rId${i+2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i+1}.xml"/>`
  ).join("\n");

  const files: Record<string, string> = {
    "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  ${sheetRels}
</Types>`,
    "_rels/.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`,
    "xl/workbook.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>${workbookSheets}</sheets>
</workbook>`,
    "xl/styles.xml": stylesXml,
    "xl/_rels/workbook.xml.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
  ${workbookRels}
</Relationships>`,
    ...Object.fromEntries(sheetXmls.map((xml, i) => [`xl/worksheets/sheet${i+1}.xml`, xml])),
  };

  function toBytes(str: string): Uint8Array { return new TextEncoder().encode(str); }
  function u32le(n: number): number[] { return [n&0xff,(n>>8)&0xff,(n>>16)&0xff,(n>>24)&0xff]; }
  function u16le(n: number): number[] { return [n&0xff,(n>>8)&0xff]; }
  function crc32(data: Uint8Array): number {
    let crc = 0xffffffff;
    const table = (crc32 as any)._t ?? (() => {
      const t = new Uint32Array(256);
      for (let i = 0; i < 256; i++) { let c = i; for (let j = 0; j < 8; j++) c = (c&1)?(0xedb88320^(c>>>1)):(c>>>1); t[i]=c; }
      return ((crc32 as any)._t = t);
    })();
    for (const b of data) crc = table[(crc^b)&0xff]^(crc>>>8);
    return (crc^0xffffffff)>>>0;
  }

  const localHeaders: number[] = [];
  const centralDir: number[] = [];
  let offset = 0;
  for (const [path, content] of Object.entries(files)) {
    const nameBytes = new TextEncoder().encode(path);
    const dataBytes = toBytes(content);
    const crc = crc32(dataBytes);
    const size = dataBytes.length;
    const local = [0x50,0x4b,0x03,0x04,...u16le(20),...u16le(0),...u16le(0),...u16le(0),...u16le(0),...u32le(crc),...u32le(size),...u32le(size),...u16le(nameBytes.length),...u16le(0),...Array.from(nameBytes),...Array.from(dataBytes)];
    const central = [0x50,0x4b,0x01,0x02,...u16le(20),...u16le(20),...u16le(0),...u16le(0),...u16le(0),...u16le(0),...u32le(crc),...u32le(size),...u32le(size),...u16le(nameBytes.length),...u16le(0),...u16le(0),...u16le(0),...u16le(0),...u32le(0),...u32le(offset),...Array.from(nameBytes)];
    localHeaders.push(...local);
    centralDir.push(...central);
    offset += local.length;
  }
  const numFiles = Object.keys(files).length;
  const eocd = [0x50,0x4b,0x05,0x06,...u16le(0),...u16le(0),...u16le(numFiles),...u16le(numFiles),...u32le(centralDir.length),...u32le(offset),...u16le(0)];
  return new Blob([new Uint8Array([...localHeaders,...centralDir,...eocd])], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

/* ─── column letter helper for >26 cols ─── */
function colLetter(ci: number): string {
  return ci < 26
    ? String.fromCharCode(65 + ci)
    : String.fromCharCode(64 + Math.floor(ci / 26)) + String.fromCharCode(65 + (ci % 26));
}

function downloadExcelReport(issues: ValidationIssue[], totalLinks: number, allRows: ScopeRow[]) {
  const now = new Date();
  const stamp = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-${String(now.getDate()).padStart(2,"0")}`;
  const errors   = issues.filter(i => i.severity === "error");
  const warnings = issues.filter(i => i.severity === "warning");

  /* ══════════════════════════════════════════════
     SHEET 1 — Summary
  ══════════════════════════════════════════════ */

  // Build per-kind detail blocks: each kind gets a header + one row per issue of that kind
  const KINDS = ["duplicate_title","duplicate_url","broken_link","empty_link"] as const;

  const summaryRows: (string | number)[][] = [
    ["Scope Validation Report", "", ""],
    ["", "", ""],
    ["Generated",       now.toLocaleString(), ""],
    ["Total Documents", allRows.length,        ""],
    ["In Scope",        allRows.filter(r => !r.isOutOfScope).length, ""],
    ["Out of Scope",    allRows.filter(r => r.isOutOfScope).length,  ""],
    ["Links Checked",   totalLinks,            ""],
    ["", "", ""],
    ["Errors",          errors.length,         ""],
    ["Warnings",        warnings.length,       ""],
    ["Status",          errors.length === 0 ? "✓ PASSED" : "✗ FAILED", ""],
    ["", "", ""],
    ["Issue Breakdown", "Count", ""],
    ...KINDS.map(k => [KIND_LABEL[k], issues.filter(i => i.kind === k).length, ""] as (string|number)[]),
    ["", "", ""],
  ];

  // Append a details block for every kind that has issues
  const summaryStyleMap = new Map<string, number>();
  // Fixed row styles (1-indexed in Excel = summaryRows index + 1)
  summaryStyleMap.set("A1", 1); summaryStyleMap.set("B1", 1); summaryStyleMap.set("C1", 1);
  summaryStyleMap.set("A9", 4); summaryStyleMap.set("B9", 4);
  summaryStyleMap.set("A10", 5); summaryStyleMap.set("B10", 5);
  const statusStyle = errors.length === 0 ? 1 : 2;
  summaryStyleMap.set("A11", statusStyle); summaryStyleMap.set("B11", statusStyle); summaryStyleMap.set("C11", statusStyle);
  summaryStyleMap.set("A13", 1); summaryStyleMap.set("B13", 1); summaryStyleMap.set("C13", 1);

  KINDS.forEach(k => {
    const kindIssues = issues.filter(i => i.kind === k);
    if (!kindIssues.length) return;

    // Section header row
    const headerRowIdx = summaryRows.length; // 0-based
    summaryRows.push([KIND_LABEL[k], "Row #", "Affected Value / Document Title"]);
    ["A","B","C"].forEach(col => summaryStyleMap.set(`${col}${headerRowIdx + 1}`, 1));

    kindIssues.forEach(issue => {
      const dataRowIdx = summaryRows.length;
      const affectedDisplay = issue.affectedValue || issue.rowData?.title || issue.rowTitle || "(untitled)";
      summaryRows.push([
        issue.rowData?.title || issue.rowTitle || "(untitled)",
        issue.rowNumber ?? "",
        affectedDisplay,
      ]);
      // Color error rows red, warning rows amber
      const sty = issue.severity === "error" ? 4 : 5;
      ["A","B","C"].forEach(col => summaryStyleMap.set(`${col}${dataRowIdx + 1}`, sty));
    });

    summaryRows.push(["", "", ""]);
  });

  /* ══════════════════════════════════════════════
     SHEET 2 — Issues
     Mirrors the modal: Error Type | Location | Row # | Document Title | Affected Value | Detail
  ══════════════════════════════════════════════ */
  const issueHeaders = [
    "Issue #",
    "Severity",
    "Error Type",
    "Location (Field)",
    "Row #",
    "Document Title",
    "Affected Value",
    "Conflicting Row(s)",
    "Detail / Message",
  ];
  const issueDataRows: (string | number)[][] = issues.map((issue, i) => [
    i + 1,
    issue.severity === "error" ? "ERROR" : "WARNING",
    KIND_LABEL[issue.kind] ?? issue.kind,
    FIELD_LABEL[issue.field] ?? issue.field,
    issue.rowNumber ?? "",
    issue.rowData?.title || issue.rowTitle || "(untitled)",
    issue.affectedValue ?? "",
    issue.duplicateRowNumbers?.length
      ? `Row(s) ${issue.duplicateRowNumbers.join(", ")}`
      : "",
    issue.message,
  ]);

  // Style map: header row = style 1 (bold dark), error rows = style 4 (red), warning rows = style 5 (amber)
  const issueStyleMap = new Map<string, number>();
  issueHeaders.forEach((_, ci) => issueStyleMap.set(`${colLetter(ci)}1`, 1));
  issues.forEach((issue, ri) => {
    const excelRow = ri + 2;
    const sty = issue.severity === "error" ? 4 : 5;
    issueHeaders.forEach((_, ci) => issueStyleMap.set(`${colLetter(ci)}${excelRow}`, sty));
  });

  /* ══════════════════════════════════════════════
     SHEET 3 — All Documents snapshot
     Full table of every document with their row #
  ══════════════════════════════════════════════ */
  const docHeaders = [
    "Row #", "Document Title", "Reference Link", "Content URL",
    "Issuing Authority", "ASRB ID", "Scope Status",
    "SME Comments", "Initial / Evergreen", "Date of Ingestion",
    "Issues Found", "Issue Detail",
  ];
  const issueCountByRowId = issues.reduce<Record<string, number>>((acc, iss) => {
    acc[iss.rowId] = (acc[iss.rowId] ?? 0) + 1;
    return acc;
  }, {});
  // Build a readable summary of issues per row: "Broken Link (Reference Link); Duplicate Title"
  const issueDetailByRowId = issues.reduce<Record<string, string[]>>((acc, iss) => {
    if (!iss.rowId) return acc;
    if (!acc[iss.rowId]) acc[iss.rowId] = [];
    const label = `${KIND_LABEL[iss.kind]} (${FIELD_LABEL[iss.field] ?? iss.field})`;
    if (!acc[iss.rowId].includes(label)) acc[iss.rowId].push(label);
    return acc;
  }, {});
  // allRows is already in original table order — never sort or reorder
  const docDataRows: (string | number)[][] = allRows.map((row, i) => [
    i + 1,
    row.title,
    row.referenceLink,
    row.contentUrl,
    row.issuingAuth,
    row.asrbId,
    row.isOutOfScope ? "Out of Scope" : "In Scope",
    row.smeComments,
    row.initialEvergreen,
    row.dateOfIngestion,
    issueCountByRowId[row.id] ?? 0,
    issueDetailByRowId[row.id]?.join("; ") ?? "",
  ]);

  const docStyleMap = new Map<string, number>();
  docHeaders.forEach((_, ci) => docStyleMap.set(`${colLetter(ci)}1`, 1));
  allRows.forEach((row, ri) => {
    const excelRow = ri + 2;
    const rowIssues = issues.filter(i => i.rowId === row.id);
    if (!rowIssues.length) return;
    // Use amber if only warnings, red if any error
    const hasError = rowIssues.some(i => i.severity === "error");
    const sty = hasError ? 4 : 5;
    docHeaders.forEach((_, ci) => docStyleMap.set(`${colLetter(ci)}${excelRow}`, sty));
  });

  const blob = buildXlsx([
    { name: "Summary",   rows: summaryRows,  styleMap: summaryStyleMap },
    { name: "Issues",    rows: [issueHeaders, ...issueDataRows], styleMap: issueStyleMap },
    { name: "Documents", rows: [docHeaders,   ...docDataRows],   styleMap: docStyleMap },
  ]);

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `scope-validation-report-${stamp}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/* ─────────────── style constants ─────────────── */
const MONO = { fontFamily: "'DM Mono', monospace" } as const;
const TH = "px-3 py-2 text-left font-bold text-[10px] uppercase tracking-[0.1em] text-black dark:text-slate-300 border-b border-r border-slate-200 dark:border-[#2a3147]";
const CELL = "px-3 py-2 border-r border-slate-100 dark:border-[#2a3147] align-top";

/* ─────────────── inline editable cell ─────────────── */
// Uses local draft state so typing doesn't trigger parent re-renders mid-edit.
// onChange is only called on commit (Enter / click-outside), not on every keystroke.
function InlineCell({ value, placeholder, onChange, href, strikethrough, wrap }: {
  value: string; placeholder: string; strikethrough?: boolean;
  onChange: (val: string) => void; href?: boolean;
   wrap?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft,   setDraft]   = useState(value);
  const inputRef     = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Sync draft when value changes externally (e.g. data reload)
  useEffect(() => { if (!editing) setDraft(value); }, [value, editing]);

  useEffect(() => {
    if (editing) { setDraft(value); inputRef.current?.focus(); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  function commit() {
    setEditing(false);
    if (draft !== value) onChange(draft);
  }

  useEffect(() => {
    if (!editing) return;
    function onMD(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) commit();
    }
    document.addEventListener("mousedown", onMD);
    return () => document.removeEventListener("mousedown", onMD);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, draft]);

  if (editing) {
    return (
      <div ref={containerRef}>
        <input ref={inputRef} value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => {
            if (e.key === "Enter") { e.preventDefault(); commit(); }
            if (e.key === "Escape") { setEditing(false); setDraft(value); }
          }}
          onClick={e => e.stopPropagation()}
          className="w-full min-w-[80px] bg-white dark:bg-[#1e2235] border border-blue-400 dark:border-blue-500 rounded-md px-2 py-1 text-[11.5px] text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-400"
          placeholder={placeholder}
        />
      </div>
    );
  }
  const baseText = strikethrough ? "line-through text-slate-400 dark:text-slate-600" : "";
  if (!value) return (
    <span onClick={e => { e.stopPropagation(); setEditing(true); }}
      className="text-slate-300 dark:text-slate-700 italic cursor-text hover:text-slate-400 select-none text-[11px]">—</span>
  );
  if (href) return (
    <div className="flex items-center gap-1 group/link min-w-0">
      <a href={value} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}
      className={`text-blue-600 dark:text-blue-400 hover:underline text-[11px] truncate block ${baseText}`} title={value}>{value}</a>      <button onClick={e => { e.stopPropagation(); setEditing(true); }}
        className="opacity-0 group-hover/link:opacity-100 flex-shrink-0 w-4 h-4 rounded flex items-center justify-center text-slate-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-500/10 transition-all">
        <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"/>
        </svg>
      </button>
    </div>
  );
  return (
    <span onClick={e => { e.stopPropagation(); setEditing(true); }}
    className={`cursor-text text-[11.5px] text-slate-700 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 transition-colors block ${wrap ? "whitespace-normal break-words" : "truncate"} ${baseText}`}     title="Click to edit">{value}</span>
  );
}

/* ─────────────── row action toolbar ─────────────── */
function RowToolbar({ row, onUpdate, onRemove }: {
  row: ScopeRow;
  onUpdate: (id: string, field: string, value: string | boolean) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <div className="flex items-center gap-0.5">
      <button onClick={e => { e.stopPropagation(); onUpdate(row.id, "isOutOfScope", !row.isOutOfScope); }}
        title={row.isOutOfScope ? "Remove strikethrough" : "Mark as out of scope (strikethrough)"}
        className={`w-6 h-6 flex items-center justify-center rounded transition-all text-[10px] font-bold
          ${row.isOutOfScope ? "bg-amber-100 dark:bg-amber-500/20 text-amber-600 dark:text-amber-400 border border-amber-300 dark:border-amber-500/40"
            : "text-slate-400 dark:text-slate-600 hover:bg-slate-100 dark:hover:bg-[#252d45] hover:text-slate-600 dark:hover:text-slate-400"}`}
        style={{ fontFamily: "serif", textDecoration: "line-through" }}>S</button>
      <button onClick={e => { e.stopPropagation(); onRemove(row.id); }}
        title="Delete row"
        className="w-6 h-6 flex items-center justify-center rounded text-slate-400 dark:text-slate-600 hover:bg-red-50 dark:hover:bg-red-500/10 hover:text-red-500 dark:hover:text-red-400 transition-all">
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
        </svg>
      </button>
    </div>
  );
}

/* ─────────────── kind metadata ─────────────── */
const KIND_META = {
  duplicate_title: { label: "Duplicate Title", icon: "M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" },
  duplicate_url:   { label: "Duplicate URL",   icon: "M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" },
  broken_link:     { label: "Broken Link",     icon: "M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" },
  empty_link:      { label: "Invalid URL",     icon: "M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" },
};

/* ─────────────── validation modal ─────────────── */
interface ModalProps {
  validation: ValidationState; onClose: () => void;
  highlightedRowId: string | null; onHighlight: (id: string | null) => void;
  filterRowId?: string | null;
}
function ValidationModal({ validation, onClose, onHighlight, filterRowId }: ModalProps) {
  const backdropRef = useRef<HTMLDivElement>(null);
  const [showErrors, setShowErrors] = useState(!!filterRowId);
  const visibleIssues = filterRowId
    ? validation.issues.filter(i => i.rowId === filterRowId)
    : validation.issues;
  const errors   = visibleIssues.filter(i => i.severity === "error");
  const warnings = visibleIssues.filter(i => i.severity === "warning");
  const allGood  = validation.phase === "done" && validation.issues.length === 0;
  const isDone   = validation.phase === "done";
  const isRun    = validation.phase === "running";
  const stepIndex = validation.progress < 15 ? 0 : validation.progress < 20 ? 1 : 2;
  const STEPS = ["Scanning for duplicate titles", "Checking for duplicate URLs", "Verifying link accessibility"];

  function handleBackdrop(e: React.MouseEvent) {
    if (e.target === backdropRef.current && isDone) onClose();
  }

  const iconBg = isRun ? "linear-gradient(135deg,#2563eb,#60a5fa)"
    : allGood ? "linear-gradient(135deg,#059669,#34d399)"
    : "linear-gradient(135deg,#dc2626,#f97316)";
  const progressCls = isRun
    ? "bg-gradient-to-r from-blue-500 to-blue-300 shadow-[0_0_10px_rgba(59,130,246,0.45)]"
    : allGood ? "bg-gradient-to-r from-emerald-600 to-emerald-400"
    : "bg-gradient-to-r from-red-600 to-orange-400";
  const pctCls = isRun ? "text-blue-500"
    : allGood ? "text-emerald-600 dark:text-emerald-400"
    : "text-red-600 dark:text-red-400";

  return (
    <div ref={backdropRef} onClick={handleBackdrop}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-md">
      <div className="flex flex-col w-[min(510px,93vw)] max-h-[82vh] rounded-[18px] overflow-hidden
        bg-white dark:bg-[#131722] border border-black/[0.09] dark:border-white/[0.07]
        shadow-[0_32px_72px_rgba(0,0,0,0.22),0_4px_20px_rgba(0,0,0,0.1)]">
        {/* Header */}
        <div className="flex-shrink-0 px-[22px] pt-5 pb-4 border-b border-black/[0.07] dark:border-white/[0.06] bg-[#f8f9fb] dark:bg-white/[0.025]">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-[42px] h-[42px] rounded-[13px] flex-shrink-0 flex items-center justify-center transition-all duration-[400ms]" style={{ background: iconBg }}>
                {isRun ? (
                  <svg className="w-5 h-5 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="9" stroke="rgba(255,255,255,0.22)" strokeWidth="2.5"/>
                    <path d="M12 3a9 9 0 019 9" stroke="white" strokeWidth="2.5" strokeLinecap="round"/>
                  </svg>
                ) : allGood ? (
                  <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7"/>
                  </svg>
                ) : (
                  <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 9v3m0 3h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
                  </svg>
                )}
              </div>
              <div>
                <p className="m-0 text-[14px] font-bold tracking-[-0.022em] leading-tight text-gray-900 dark:text-[#e2e8f5]">
                  {isRun ? "Validating Documents" : allGood ? "All Clear" : "Issues Found"}
                </p>
                <p className="mt-[3px] mb-0 text-[11px] leading-[1.35] text-gray-500 dark:text-[#8892a4]" style={MONO}>
                  {isRun ? STEPS[stepIndex] + "…"
                    : filterRowId
                      ? `${visibleIssues.length} issue${visibleIssues.length !== 1 ? "s" : ""} for this row`
                      : `${validation.issues.length} issue${validation.issues.length !== 1 ? "s" : ""} · ${validation.totalLinks} link${validation.totalLinks !== 1 ? "s" : ""} checked`}
                </p>
              </div>
            </div>
            {isDone && (
              <button onClick={onClose}
                className="flex-shrink-0 w-[30px] h-[30px] rounded-[9px] flex items-center justify-center border border-black/10 dark:border-white/10 bg-gray-100 dark:bg-white/[0.07] text-gray-500 dark:text-[#8892a4] hover:bg-gray-200 dark:hover:bg-white/[0.12] transition-colors cursor-pointer">
                <svg className="w-[13px] h-[13px]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/>
                </svg>
              </button>
            )}
          </div>
          <div className="mt-4 h-[5px] rounded-full overflow-hidden bg-black/[0.08] dark:bg-white/[0.07]">
            <div className={`h-full rounded-full ${progressCls} transition-[width] duration-[350ms] ease-linear`} style={{ width: `${validation.progress}%` }}/>
          </div>
          <div className="flex justify-end mt-[5px]">
            <span className={`text-[10px] font-semibold ${pctCls}`} style={MONO}>{validation.progress}%</span>
          </div>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-grow">
          {isRun && (
            <div className="p-[22px] space-y-[7px]">
              {STEPS.map((s, i) => {
                const done = i < stepIndex; const active = i === stepIndex;
                return (
                  <div key={i} className={`flex items-center gap-[10px] px-[14px] py-[11px] rounded-[11px] border transition-all duration-300
                    ${active ? "bg-blue-500/[0.07] border-blue-500/[0.22]" : "bg-gray-100 dark:bg-white/[0.035] border-black/[0.07] dark:border-white/[0.055]"}`}>
                    <div className={`w-[22px] h-[22px] rounded-full flex-shrink-0 flex items-center justify-center border-2 transition-all duration-300
                      ${done ? "bg-emerald-600 border-emerald-600" : active ? "bg-blue-600 border-blue-500" : "bg-transparent border-black/[0.07] dark:border-white/[0.055]"}`}>
                      {done ? <svg className="w-[11px] h-[11px] text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7"/></svg>
                        : active ? <div className="w-[7px] h-[7px] rounded-full bg-white animate-pulse"/>
                        : <div className="w-[5px] h-[5px] rounded-full bg-gray-400 dark:bg-slate-600"/>}
                    </div>
                    <span className={`text-[12px] transition-colors duration-300 ${active ? "font-semibold text-gray-900 dark:text-[#e2e8f5]" : "font-normal text-gray-500 dark:text-[#8892a4]"}`}>{s}</span>
                    <span className={`ml-auto text-[10px] font-medium ${done ? "text-emerald-600 dark:text-emerald-400" : active ? "text-blue-500" : "text-gray-400 dark:text-slate-600"}`} style={MONO}>
                      {done ? "done" : active ? (i === 2 ? `${validation.checkedCount}/${validation.totalLinks}` : "running") : "waiting"}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
          {isDone && allGood && (
            <div className="px-[22px] py-[38px] text-center">
              <div className="w-[66px] h-[66px] rounded-full mx-auto mb-[18px] flex items-center justify-center bg-emerald-500/10 border border-emerald-500/[0.22]">
                <svg className="w-[30px] h-[30px] text-emerald-600 dark:text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z"/>
                </svg>
              </div>
              <p className="text-[17px] font-bold text-gray-900 dark:text-[#e2e8f5] mb-[7px] mt-0">All documents passed!</p>
              <p className="text-[12px] text-gray-500 dark:text-[#8892a4] m-0">No duplicates · All {validation.totalLinks} links reachable</p>
            </div>
          )}
          {isDone && !allGood && !showErrors && (
            <div className="px-[22px] py-[30px] text-center">
              <div className="w-[58px] h-[58px] rounded-full mx-auto mb-[15px] flex items-center justify-center bg-red-500/[0.07] border border-red-500/[0.18]">
                <svg className="w-[25px] h-[25px] text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v3m0 3h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
                </svg>
              </div>
              <p className="text-[16px] font-bold text-gray-900 dark:text-[#e2e8f5] m-0">{visibleIssues.length} issue{visibleIssues.length !== 1 ? "s" : ""} detected</p>
            </div>
          )}
          {isDone && !allGood && showErrors && (
            <div className="px-[22px] pt-[14px] pb-5">
              <div className="flex flex-wrap gap-[6px] mb-[14px]">
                {errors.length > 0 && <span className="text-[10.5px] font-semibold px-[10px] py-[3px] rounded-full bg-red-50 dark:bg-red-500/[0.12] border border-red-200 dark:border-red-500/25 text-red-600 dark:text-red-400" style={MONO}>{errors.length} error{errors.length !== 1 ? "s" : ""}</span>}
                {warnings.length > 0 && <span className="text-[10.5px] font-semibold px-[10px] py-[3px] rounded-full bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/[0.22] text-amber-600 dark:text-amber-400" style={MONO}>{warnings.length} warning{warnings.length !== 1 ? "s" : ""}</span>}
              </div>
              <div className="flex flex-col gap-[7px]">
                {visibleIssues.map((issue, idx) => {
                  const meta = KIND_META[issue.kind]; const isErr = issue.severity === "error";
                  return (
                    <div key={idx} onClick={() => { onHighlight(issue.rowId); onClose(); }}
                      className={`rounded-[11px] border px-[13px] py-[10px] cursor-pointer transition-colors
                        ${isErr ? "bg-red-50 dark:bg-red-500/[0.06] border-red-200 dark:border-red-500/[0.18] hover:bg-red-100 dark:hover:bg-red-500/10"
                          : "bg-amber-50 dark:bg-amber-500/[0.05] border-amber-200 dark:border-amber-500/[0.16] hover:bg-amber-100 dark:hover:bg-amber-500/[0.09]"}`}>
                      <div className="flex items-start gap-[10px]">
                        <svg className={`w-[14px] h-[14px] flex-shrink-0 mt-[2px] ${isErr ? "text-red-500" : "text-amber-500"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={meta.icon}/>
                        </svg>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center flex-wrap gap-[5px] mb-[3px]">
                            <span className={`text-[9.5px] font-bold tracking-[0.07em] uppercase ${isErr ? "text-red-600 dark:text-red-400" : "text-amber-600 dark:text-amber-500"}`} style={MONO}>{meta.label}</span>
                            <span className="text-[9.5px] text-gray-400">·</span>
                            <span className="text-[9.5px] text-gray-500 dark:text-[#8892a4]" style={MONO}>Row {issue.rowNumber}</span>
                            <span className="text-[9.5px] text-gray-400">·</span>
                            <span className="text-[9.5px] text-gray-500 dark:text-[#8892a4]" style={MONO}>{FIELD_LABEL[issue.field]}</span>
                          </div>
                          <p className="text-[12px] font-semibold text-gray-900 dark:text-[#e2e8f5] m-0 mb-[2px] truncate">{issue.rowTitle || "(untitled)"}</p>
                          {issue.affectedValue && issue.affectedValue !== issue.rowTitle && (
                            <p className="text-[10px] text-slate-500 dark:text-slate-500 m-0 mb-[2px] break-all line-clamp-1 font-mono">{issue.affectedValue}</p>
                          )}
                          <p className="text-[11px] text-gray-500 dark:text-[#8892a4] m-0 leading-[1.5] break-words line-clamp-2">{issue.message}</p>
                        </div>
                        <svg className="w-[12px] h-[12px] text-gray-400 flex-shrink-0 mt-[4px]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7"/>
                        </svg>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        {isDone && (
          <div className="flex-shrink-0 flex justify-end gap-2 px-[22px] py-3 border-t border-black/[0.07] dark:border-white/[0.06] bg-gray-100 dark:bg-black/[0.28]">
            {allGood ? (
              <button onClick={onClose} className="px-[22px] py-2 rounded-[10px] text-[12.5px] font-semibold text-white bg-gradient-to-br from-emerald-600 to-emerald-400 hover:opacity-90 transition-opacity shadow-[0_2px_8px_rgba(5,150,105,0.22)] cursor-pointer border-none">Close</button>
            ) : (
              <>
                <button onClick={onClose} className="px-4 py-2 rounded-[10px] text-[12px] font-medium cursor-pointer bg-gray-100 dark:bg-white/[0.07] border border-black/10 dark:border-white/10 text-gray-700 dark:text-[#c5cdd9] hover:bg-gray-200 dark:hover:bg-white/[0.12] transition-colors">Close</button>
                <button onClick={() => setShowErrors(v => !v)}
                  className="flex items-center gap-[6px] px-[18px] py-2 rounded-[10px] text-[12px] font-semibold text-white cursor-pointer border-none bg-gradient-to-br from-red-600 to-orange-500 hover:opacity-90 transition-opacity shadow-[0_2px_8px_rgba(220,38,38,0.22)]">
                  <svg className="w-[13px] h-[13px]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    {showErrors ? <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7"/> : <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7"/>}
                  </svg>
                  {showErrors ? "Hide errors" : `Show ${visibleIssues.length} issue${visibleIssues.length !== 1 ? "s" : ""}`}
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ─────────────── main component ─────────────── */
export default function Scope({ initialData, brdId, onDataChange }: Props) {
  const [rows, setRows]                         = useState<ScopeRow[]>([]);
  const [saved, setSaved]                       = useState(false);
  const [highlightedRowId, setHighlightedRowId] = useState<string | null>(null);
  const [showModal, setShowModal]               = useState(false);
  const [filterRowId, setFilterRowId]           = useState<string | null>(null);
  const [validation, setValidation]             = useState<ValidationState>({
    phase: "idle", progress: 0, currentStep: "", issues: [], checkedCount: 0, totalLinks: 0,
  });
  const highlightRefs = useRef<Record<string, HTMLTableRowElement | null>>({});
  const isInitializing = useRef(false);
  const rowsRef = useRef<ScopeRow[]>([]);
  const [cellImages, setCellImages] = useState<Record<string, UploadedCellImage[]>>({});
  const API_BASE_SCOPE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
  function cellKey(a: string, b: string) { return `${a}-${b}`; }
  function getCellImgs(a: string, b: string): UploadedCellImage[] { return cellImages[cellKey(a, b)] ?? []; }
  function onCellUploaded(a: string, b: string, img: UploadedCellImage) { const k = cellKey(a, b); setCellImages(prev => ({ ...prev, [k]: [...(prev[k] ?? []), img] })); }
  function onCellDeleted(a: string, b: string, id: number) { const k = cellKey(a, b); setCellImages(prev => ({ ...prev, [k]: (prev[k] ?? []).filter(i => i.id !== id) })); }

  useEffect(() => {
    const nextRows = buildRows(initialData);
    if (scopeRowsEqualIgnoringIds(rowsRef.current, nextRows)) return;

    isInitializing.current = true;
    setRows(nextRows);
    setSaved(false);
  }, [initialData]);

  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);

  useEffect(() => {
    if (!brdId) return;
    api.get<{ images: Array<{ id: number; mediaName: string; mimeType: string; cellText: string; section: string; fieldLabel: string; rid: string }> }>(`/brd/${brdId}/images?section=scope`, { timeout: 30000 })
      .then(res => {
        const scoped = res.data.images ?? [];
        if (scoped.length > 0) return scoped;
        return api.get<{ images: Array<{ id: number; mediaName: string; mimeType: string; cellText: string; section: string; fieldLabel: string; rid: string }> }>(`/brd/${brdId}/images`, { timeout: 30000 }).then(fallback => fallback.data.images ?? []);
      })
      .then(allImages => {
        const manualImgs = (allImages ?? []).filter(img => img.section === "scope" && img.rid?.startsWith("manual-"));
        const restored: Record<string, UploadedCellImage[]> = {};
        manualImgs.forEach(img => {
          const key = img.fieldLabel ?? "";
          if (!key) return;
          if (!restored[key]) restored[key] = [];
          restored[key].push({ id: img.id, mediaName: img.mediaName, mimeType: img.mimeType, cellText: img.cellText, section: img.section, fieldLabel: img.fieldLabel });
        });
        setCellImages(restored);
      })
      .catch(err => console.error("[Scope] Error fetching images:", err));
  }, [brdId]);

  useEffect(() => {
    if (isInitializing.current) { isInitializing.current = false; return; }
    if (onDataChange) onDataChange(rowsToScopeData(rows));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);

  useEffect(() => {
    if (!highlightedRowId) return;
    const el = highlightRefs.current[highlightedRowId];
    if (el) { el.scrollIntoView({ behavior: "smooth", block: "center" }); el.focus(); }
    const t = setTimeout(() => setHighlightedRowId(null), 3200);
    return () => clearTimeout(t);
  }, [highlightedRowId]);

  const extra    = hasExtraCols(rows);
  const colCount = 6 + (extra.evergreen ? 1 : 0) + (extra.ingestion ? 1 : 0) + 1; // +1 actions
  const showReportButton = validation.phase === "done" && validation.issues.length > 0;

  function addRow() {
    const r: ScopeRow = {
      id: Date.now().toString(), stableKey: `new-${Date.now()}`, title: "", referenceLink: "", contentUrl: "",
      issuingAuth: "", asrbId: "", smeComments: "", initialEvergreen: "",
      dateOfIngestion: "", isOutOfScope: false,
    };
    setRows(p => [...p, r]);
  }
  function updateRow(id: string, field: string, value: string | boolean) {
    setRows(p => p.map(r => r.id === id ? { ...r, [field]: value } : r));
  }
  function removeRow(id: string) { setRows(p => p.filter(r => r.id !== id)); }
  function handleSave() { setSaved(true); setTimeout(() => setSaved(false), 2000); }
  function openModalForRow(rowId: string) { setFilterRowId(rowId); setShowModal(true); }

  function handleGenerateReport() {
    downloadExcelReport(validation.issues, validation.totalLinks, rows);
  }

  async function handleValidate() {
    setFilterRowId(null);
    setValidation({ phase: "running", progress: 0, currentStep: "Initializing…", issues: [], checkedCount: 0, totalLinks: 0 });
    setShowModal(true);
    try {
      const issues = await runValidation(rows, s => setValidation(s));
      setValidation(prev => ({ ...prev, phase: "done", progress: 100, issues, currentStep: "Done" }));
    } catch (err) {
      setValidation(prev => ({
        ...prev, phase: "done", progress: 100, currentStep: "Error",
        issues: [{
          rowId: "", rowTitle: "System", rowNumber: 0,
          rowData: { id:"", stableKey:"", title:"", referenceLink:"", contentUrl:"", issuingAuth:"", asrbId:"", smeComments:"", initialEvergreen:"", dateOfIngestion:"", isOutOfScope:false },
          affectedValue: "", field: "title", kind: "broken_link", severity: "error",
          message: String(err),
        }],
      }));
    }
  }

  const issuesByRow = validation.issues.reduce<Record<string, number>>((acc, i) => {
    if (i.rowId) acc[i.rowId] = (acc[i.rowId] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div>
      <div className="rounded-2xl border border-slate-300 dark:border-slate-600 bg-white/80 dark:bg-slate-900/30 p-4">
        {/* Toolbar */}
        <div className="flex items-center justify-between mb-3 px-3 py-2 rounded-lg border bg-blue-50 dark:bg-blue-500/10 border-blue-200 dark:border-blue-700/40">
          <div className="flex items-center gap-2">
            <span className="text-base text-blue-600 dark:text-blue-400">≡</span>
            <h3 className="text-[13px] font-semibold text-blue-800 dark:text-blue-300 tracking-tight">Scope Documents</h3>
            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-600/40" style={MONO}>{rows.length}</span>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={handleValidate}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium relative bg-white dark:bg-[#1e2235] text-orange-600 dark:text-orange-400 border border-orange-300 dark:border-orange-700/40 hover:bg-orange-50 dark:hover:bg-orange-500/10 transition-all">
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z"/></svg>
              Validate
              {validation.phase === "done" && validation.issues.length > 0 && (
                <span className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center">{validation.issues.length}</span>
              )}
            </button>

            {showReportButton && (
              <button onClick={handleGenerateReport}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium bg-white dark:bg-[#1e2235] text-violet-700 dark:text-violet-300 border border-violet-300 dark:border-violet-700/40 hover:bg-violet-50 dark:hover:bg-violet-500/10 transition-all"
                title="Download Excel error report">
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-6m6 6v-3m3 7H6a2 2 0 01-2-2V5a2 2 0 012-2h7l5 5v11a2 2 0 01-2 2z"/></svg>
                Report (.xlsx)
              </button>
            )}

            <button onClick={handleSave}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium transition-all ${saved ? "bg-emerald-500 text-white" : "bg-white dark:bg-[#1e2235] text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-[#2a3147] hover:bg-slate-50 dark:hover:bg-[#252d45]"}`}>
              {saved
                ? <><svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7"/></svg>Saved!</>
                : <><svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4"/></svg>Save</>}
            </button>
            <button onClick={addRow}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium bg-blue-600 text-white hover:bg-blue-700 dark:hover:bg-blue-500 transition-all">
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4"/></svg>
              Add Row
            </button>
          </div>
        </div>

        {/* Hint */}
        <p className="text-[10.5px] text-slate-400 dark:text-slate-600 mb-2 ml-0.5" style={MONO}>
          Click any cell to edit · <span style={{ textDecoration: "line-through" }}>S</span> = strikethrough toggle · hover row for actions
        </p>

        {/* Table */}
        <div className="rounded-xl border border-slate-200 dark:border-[#2a3147] overflow-hidden">
          <div>
            <table className="w-full text-[11.5px]">
              <thead>
                <tr className="bg-slate-100 dark:bg-[#1e2235]">
                  <th rowSpan={2} className={`${TH} w-[180px]`} style={MONO}>Document Title</th>
                  <th rowSpan={2} className={`${TH} w-[120px]`} style={MONO}>Reference Link</th>
                  <th rowSpan={2} className={`${TH} w-[160px]`} style={MONO}>Content URL</th>
                  <th colSpan={2} className={`${TH} text-center bg-slate-200/60 dark:bg-[#252d45]`} style={MONO}>Issuing Agency</th>
                  <th rowSpan={2} className={`${TH} w-[130px]`} style={MONO}>SME Comments</th>
                  {extra.evergreen && <th rowSpan={2} className={`${TH} w-[90px]`} style={MONO}>Initial / Evergreen</th>}
                  {extra.ingestion && <th rowSpan={2} className={`${TH} w-[110px]`} style={MONO}>Date of Ingestion</th>}
                  <th rowSpan={2} className="px-3 py-2 text-center font-bold text-[10px] uppercase tracking-[0.1em] text-black dark:text-slate-300 border-b border-slate-200 dark:border-[#2a3147] w-[60px]" style={MONO}>···</th>
                </tr>
                <tr className="bg-slate-100 dark:bg-[#1e2235]">
                  <th className="px-3 py-1.5 text-left font-bold text-[10px] uppercase tracking-[0.08em] text-black dark:text-slate-300 border-b border-r border-slate-200 dark:border-[#2a3147] w-[140px] bg-slate-200/60 dark:bg-[#252d45]/70" style={MONO}>Issuing Authority</th>
                  <th className="px-3 py-1.5 text-left font-bold text-[10px] uppercase tracking-[0.08em] text-black dark:text-slate-300 border-b border-r border-slate-200 dark:border-[#2a3147] w-[100px] bg-slate-200/60 dark:bg-[#252d45]/70" style={MONO}>ASRB ID</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-[#2a3147]">
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={colCount} className="px-4 py-10 text-center">
                      <div className="flex flex-col items-center gap-2">
                        <svg className="w-5 h-5 text-slate-400 dark:text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
                        </svg>
                        <p className="text-[12px] text-slate-500 dark:text-slate-500">No documents added yet</p>
                        <button onClick={addRow} className="text-[11.5px] text-blue-600 dark:text-blue-400 hover:underline font-medium">+ Add first row</button>
                      </div>
                    </td>
                  </tr>
                ) : rows.map((row, idx) => {
                  const isHighlighted = highlightedRowId === row.id;
                  const rowIssues     = issuesByRow[row.id] ?? 0;
                  const oos           = row.isOutOfScope;
                  const rowCls = [
                    "group/row transition-colors",
                    isHighlighted
                      ? "bg-amber-50 dark:bg-amber-500/10 ring-2 ring-amber-400/40"
                      : idx % 2 === 0 ? "bg-white dark:bg-[#161b2e]" : "bg-slate-50/60 dark:bg-[#1a1f35]",
                    !isHighlighted && "hover:bg-blue-50/20 dark:hover:bg-[#1e2235]/50",
                    oos ? "opacity-60" : "",
                  ].join(" ");

                  return (
                    <tr key={row.id} className={rowCls} tabIndex={-1} ref={el => { highlightRefs.current[row.id] = el; }}>
                     <td className={CELL} style={{ minWidth: 200, maxWidth: 320 }}>
                        <div className="group">
                          <div className="flex items-start gap-1.5">
                            {rowIssues > 0 && (<button onClick={e => { e.stopPropagation(); openModalForRow(row.id); }} title="View issues" className="mt-0.5 flex-shrink-0 w-4 h-4 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center hover:bg-red-600 transition-colors border-none p-0 cursor-pointer">{rowIssues}</button>)}
                            <InlineCell value={row.title} placeholder="Document title…" wrap strikethrough={oos} onChange={val => updateRow(row.id, "title", val)}/>
                          </div>
                          {getCellImgs(row.stableKey, "title").map(img => (
                            <img key={img.id} src={buildBrdImageBlobUrl(brdId, img.id, API_BASE_SCOPE)} alt={img.cellText || img.mediaName} className="mt-1 max-w-full rounded border border-slate-200 dark:border-[#2a3147]" loading="lazy" onError={e => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}/>
                          ))}
                          {brdId && <CellImageUploader brdId={brdId} section="scope" fieldLabel={cellKey(row.stableKey, "title")} existingImages={getCellImgs(row.stableKey, "title")} onUploaded={img => onCellUploaded(row.stableKey, "title", img)} onDeleted={id => onCellDeleted(row.stableKey, "title", id)}/>}
                        </div>
                      </td>
                      <td className={CELL} style={{ maxWidth: 160, width: 160 }}>
                        <div className="group">
                          <InlineCell value={row.referenceLink} placeholder="https://…" href strikethrough={oos} onChange={val => updateRow(row.id, "referenceLink", val)}/>
                          {getCellImgs(row.stableKey, "referenceLink").map(img => (
                            <img key={img.id} src={buildBrdImageBlobUrl(brdId, img.id, API_BASE_SCOPE)} alt={img.cellText || img.mediaName} className="mt-1 max-w-full rounded border border-slate-200 dark:border-[#2a3147]" loading="lazy" onError={e => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}/>
                          ))}
                          {brdId && <CellImageUploader brdId={brdId} section="scope" fieldLabel={cellKey(row.stableKey, "referenceLink")} existingImages={getCellImgs(row.stableKey, "referenceLink")} onUploaded={img => onCellUploaded(row.stableKey, "referenceLink", img)} onDeleted={id => onCellDeleted(row.stableKey, "referenceLink", id)}/>}
                        </div>
                      </td>
                      <td className={CELL} style={{ maxWidth: 180, width: 180 }}>
                        <div className="group">
                          <InlineCell value={row.contentUrl} placeholder="https://…" href strikethrough={oos} onChange={val => updateRow(row.id, "contentUrl", val)}/>
                          {getCellImgs(row.stableKey, "contentUrl").map(img => (
                            <img key={img.id} src={buildBrdImageBlobUrl(brdId, img.id, API_BASE_SCOPE)} alt={img.cellText || img.mediaName} className="mt-1 max-w-full rounded border border-slate-200 dark:border-[#2a3147]" loading="lazy" onError={e => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}/>
                          ))}
                          {brdId && <CellImageUploader brdId={brdId} section="scope" fieldLabel={cellKey(row.stableKey, "contentUrl")} existingImages={getCellImgs(row.stableKey, "contentUrl")} onUploaded={img => onCellUploaded(row.stableKey, "contentUrl", img)} onDeleted={id => onCellDeleted(row.stableKey, "contentUrl", id)}/>}
                        </div>
                      </td>
                      <td className={CELL}>
                        <div className="group">
                          <InlineCell value={row.issuingAuth} placeholder="Authority…" strikethrough={oos} onChange={val => updateRow(row.id, "issuingAuth", val)}/>
                          {getCellImgs(row.stableKey, "issuingAuth").map(img => (
                            <img key={img.id} src={buildBrdImageBlobUrl(brdId, img.id, API_BASE_SCOPE)} alt={img.cellText || img.mediaName} className="mt-1 max-w-full rounded border border-slate-200 dark:border-[#2a3147]" loading="lazy" onError={e => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}/>
                          ))}
                          {brdId && <CellImageUploader brdId={brdId} section="scope" fieldLabel={cellKey(row.stableKey, "issuingAuth")} existingImages={getCellImgs(row.stableKey, "issuingAuth")} onUploaded={img => onCellUploaded(row.stableKey, "issuingAuth", img)} onDeleted={id => onCellDeleted(row.stableKey, "issuingAuth", id)}/>}
                        </div>
                      </td>
                      <td className={CELL}>
                        <div className="group" onClick={e => e.stopPropagation()}>
                          <InlineCell value={row.asrbId} placeholder="ASRB…" strikethrough={oos} onChange={val => updateRow(row.id, "asrbId", val)}/>
                          {getCellImgs(row.stableKey, "asrbId").map(img => (
                            <img key={img.id} src={buildBrdImageBlobUrl(brdId, img.id, API_BASE_SCOPE)} alt={img.cellText || img.mediaName} className="mt-1 max-w-full rounded border border-slate-200 dark:border-[#2a3147]" loading="lazy" onError={e => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}/>
                          ))}
                          {brdId && <CellImageUploader brdId={brdId} section="scope" fieldLabel={cellKey(row.stableKey, "asrbId")} existingImages={getCellImgs(row.stableKey, "asrbId")} onUploaded={img => onCellUploaded(row.stableKey, "asrbId", img)} onDeleted={id => onCellDeleted(row.stableKey, "asrbId", id)}/>}
                        </div>
                      </td>
                      <td className={CELL}>
                        <div className="group">
                          <InlineCell value={row.smeComments} placeholder="Comments…" wrap strikethrough={oos} onChange={val => updateRow(row.id, "smeComments", val)}/>
                          {getCellImgs(row.stableKey, "smeComments").map(img => (
                            <img key={img.id} src={buildBrdImageBlobUrl(brdId, img.id, API_BASE_SCOPE)} alt={img.cellText || img.mediaName} className="mt-1 max-w-full rounded border border-slate-200 dark:border-[#2a3147]" loading="lazy" onError={e => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}/>
                          ))}
                          {brdId && <CellImageUploader brdId={brdId} section="scope" fieldLabel={cellKey(row.stableKey, "smeComments")} existingImages={getCellImgs(row.stableKey, "smeComments")} onUploaded={img => onCellUploaded(row.stableKey, "smeComments", img)} onDeleted={id => onCellDeleted(row.stableKey, "smeComments", id)}/>}
                        </div>
                      </td>
                      {extra.evergreen && <td className={CELL}><InlineCell value={row.initialEvergreen} placeholder="Initial / Evergreen…" strikethrough={oos} onChange={val => updateRow(row.id, "initialEvergreen", val)}/></td>}
                      {extra.ingestion && <td className={CELL}><InlineCell value={row.dateOfIngestion} placeholder="Date…" strikethrough={oos} onChange={val => updateRow(row.id, "dateOfIngestion", val)}/></td>}
                      <td className="px-2 py-2 text-center align-top">
                        <div className="flex items-center justify-center">
                          <RowToolbar row={row} onUpdate={updateRow} onRemove={removeRow}/>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {rows.length > 0 && (
            <div className="px-4 py-2 bg-slate-50 dark:bg-[#1e2235] border-t border-slate-200 dark:border-[#2a3147] flex items-center justify-between">
              <p className="text-[10.5px] text-slate-500 dark:text-slate-600 m-0" style={MONO}>
                {rows.length} {rows.length === 1 ? "document" : "documents"} · {rows.filter(r => r.isOutOfScope).length} struck through
              </p>
              {rows.some(r => r.isOutOfScope) && (
                <button onClick={() => setRows(p => p.map(r => ({ ...r, isOutOfScope: false })))}
                  className="text-[10.5px] text-slate-400 dark:text-slate-600 hover:text-slate-600 dark:hover:text-slate-400 underline transition-colors"
                  style={MONO}>clear all strikethroughs</button>
              )}
            </div>
          )}
        </div>
      </div>

      {showModal && (
        <ValidationModal
          validation={validation}
          onClose={() => { setShowModal(false); setFilterRowId(null); }}
          highlightedRowId={highlightedRowId}
          onHighlight={id => setHighlightedRowId(id)}
          filterRowId={filterRowId}
        />
      )}
    </div>
  );
}