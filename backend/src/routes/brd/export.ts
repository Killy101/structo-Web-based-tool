// routes/brd/export.ts
// Provides CSV and print-ready HTML exports of BRD data (metadata, scope, TOC).
// No external libraries required — pure Node/TypeScript string generation.
import { Router, Request, Response } from "express";
import prisma from "../../lib/prisma";

const router = Router();

// ── Helpers ────────────────────────────────────────────────────────────────

function escapeCsv(val: unknown): string {
  if (val === null || val === undefined) return "";
  const s = String(val).replace(/"/g, '""');
  return /[,"\n\r]/.test(s) ? `"${s}"` : s;
}

function csvRow(cells: unknown[]): string {
  return cells.map(escapeCsv).join(",");
}

function buildMetadataCsv(
  brdId: string,
  title: string,
  metadata: Record<string, unknown> | null,
  scope: { in_scope?: unknown[]; out_of_scope?: unknown[] } | null,
  toc: { sections?: { title?: string; level?: number; page?: string | number }[] } | null,
): string {
  const rows: string[] = [];

  // ── Sheet 1: Metadata ────────────────────────────────────────────────────
  rows.push("METADATA");
  rows.push(csvRow(["BRD ID", brdId]));
  rows.push(csvRow(["Title", title]));

  if (metadata) {
    for (const [key, value] of Object.entries(metadata)) {
      if (key.startsWith("_")) continue; // skip internal keys
      const displayKey = key.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
      const displayVal = typeof value === "object" ? JSON.stringify(value) : value;
      rows.push(csvRow([displayKey, displayVal]));
    }
  }

  rows.push("");

  // ── Sheet 2: Scope ───────────────────────────────────────────────────────
  rows.push("SCOPE");
  rows.push(csvRow(["Type", "Item"]));

  const inScope    = scope?.in_scope ?? [];
  const outOfScope = scope?.out_of_scope ?? [];

  for (const item of inScope) {
    const label = typeof item === "object" && item !== null
      ? (item as any).label ?? (item as any).text ?? JSON.stringify(item)
      : String(item);
    rows.push(csvRow(["In Scope", label]));
  }
  for (const item of outOfScope) {
    const label = typeof item === "object" && item !== null
      ? (item as any).label ?? (item as any).text ?? JSON.stringify(item)
      : String(item);
    rows.push(csvRow(["Out of Scope", label]));
  }

  rows.push("");

  // ── Sheet 3: Table of Contents ───────────────────────────────────────────
  rows.push("TABLE OF CONTENTS");
  rows.push(csvRow(["Level", "Title", "Page"]));

  const sections = toc?.sections ?? [];
  for (const sec of sections) {
    rows.push(csvRow([sec.level ?? "", sec.title ?? "", sec.page ?? ""]));
  }

  return rows.join("\n");
}

// ── GET /brd/:brdId/export/csv ─────────────────────────────────────────────
router.get("/:brdId/export/csv", async (req: Request, res: Response) => {
  try {
    const brdId = String(req.params.brdId);
    const brd = await prisma.brd.findUnique({
      where:   { brdId },
      include: { sections: true },
    });

    if (!brd) return res.status(404).json({ error: "BRD not found" });
    if (brd.deletedAt) return res.status(410).json({ error: "BRD has been deleted" });

    const metadata = (brd.sections?.metadata ?? null) as Record<string, unknown> | null;
    const scope    = (brd.sections?.scope    ?? null) as { in_scope?: unknown[]; out_of_scope?: unknown[] } | null;
    const toc      = (brd.sections?.toc      ?? null) as { sections?: { title?: string; level?: number; page?: string | number }[] } | null;

    const csv      = buildMetadataCsv(brd.brdId, brd.title, metadata, scope, toc);
    const filename = `${brdId.toLowerCase()}-export.csv`;

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    return res.send("\uFEFF" + csv); // BOM for Excel UTF-8 detection
  } catch (err) {
    console.error("[GET /brd/:brdId/export/csv]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /brd/:brdId/export/pdf-html ───────────────────────────────────────
// Returns a print-ready HTML page. Open in browser and print → Save as PDF.
router.get("/:brdId/export/pdf-html", async (req: Request, res: Response) => {
  try {
    const brdId = String(req.params.brdId);
    const brd = await prisma.brd.findUnique({
      where:   { brdId },
      include: { sections: true },
    });

    if (!brd) return res.status(404).json({ error: "BRD not found" });
    if (brd.deletedAt) return res.status(410).json({ error: "BRD has been deleted" });

    const metadata = (brd.sections?.metadata ?? {}) as Record<string, unknown>;
    const scope    = (brd.sections?.scope    ?? {}) as { in_scope?: unknown[]; out_of_scope?: unknown[] };
    const toc      = (brd.sections?.toc      ?? {}) as { sections?: { title?: string; level?: number; page?: string | number }[] };

    const inScope    = scope.in_scope    ?? [];
    const outOfScope = scope.out_of_scope ?? [];
    const sections   = toc.sections     ?? [];

    const metaRows = Object.entries(metadata)
      .filter(([k]) => !k.startsWith("_"))
      .map(([k, v]) => {
        const label = k.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
        const value = typeof v === "object" ? JSON.stringify(v) : String(v ?? "");
        return `<tr><td class="label">${escapeHtml(label)}</td><td>${escapeHtml(value)}</td></tr>`;
      })
      .join("\n");

    const inScopeRows = inScope.map(item => {
      const label = typeof item === "object" && item !== null
        ? (item as any).label ?? (item as any).text ?? JSON.stringify(item)
        : String(item);
      return `<li class="in-scope">${escapeHtml(label)}</li>`;
    }).join("\n");

    const outScopeRows = outOfScope.map(item => {
      const label = typeof item === "object" && item !== null
        ? (item as any).label ?? (item as any).text ?? JSON.stringify(item)
        : String(item);
      return `<li class="out-scope">${escapeHtml(label)}</li>`;
    }).join("\n");

    const tocRows = sections.map(s =>
      `<tr><td class="toc-level">${escapeHtml(String(s.level ?? ""))}</td><td>${escapeHtml(s.title ?? "")}</td><td class="toc-page">${escapeHtml(String(s.page ?? ""))}</td></tr>`
    ).join("\n");

    const exportDate = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>${escapeHtml(brd.title)} — BRD Export</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 11pt; color: #1a1a2e; background: #fff; padding: 24px; }
    .page-header { border-bottom: 3px solid #2563eb; padding-bottom: 12px; margin-bottom: 20px; display: flex; justify-content: space-between; align-items: flex-end; }
    .page-header h1 { font-size: 18pt; color: #1e40af; font-weight: 700; }
    .page-header .meta { font-size: 9pt; color: #64748b; text-align: right; line-height: 1.6; }
    .badge { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 8pt; font-weight: 600; background: #dbeafe; color: #1d4ed8; border: 1px solid #bfdbfe; margin-left: 8px; }
    section { margin-bottom: 28px; }
    section h2 { font-size: 12pt; font-weight: 700; color: #1e40af; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px; margin-bottom: 12px; }
    table { width: 100%; border-collapse: collapse; font-size: 10pt; }
    th, td { padding: 6px 10px; border: 1px solid #e2e8f0; text-align: left; vertical-align: top; }
    th { background: #f1f5f9; font-weight: 600; color: #475569; font-size: 9pt; }
    td.label { width: 200px; font-weight: 600; color: #374151; background: #f8fafc; }
    td.toc-level { width: 60px; text-align: center; font-weight: 600; }
    td.toc-page { width: 80px; text-align: right; color: #64748b; }
    .scope-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    .scope-box h3 { font-size: 10pt; font-weight: 600; margin-bottom: 8px; }
    .scope-box h3.in { color: #15803d; } .scope-box h3.out { color: #b91c1c; }
    ul { list-style: none; padding: 0; }
    li { padding: 4px 8px; border-radius: 4px; font-size: 10pt; margin-bottom: 4px; border: 1px solid transparent; }
    li.in-scope { background: #f0fdf4; border-color: #bbf7d0; color: #166534; }
    li.out-scope { background: #fef2f2; border-color: #fecaca; color: #991b1b; }
    .footer { margin-top: 32px; padding-top: 12px; border-top: 1px solid #e2e8f0; font-size: 8pt; color: #94a3b8; text-align: center; }
    @media print {
      body { padding: 0; font-size: 10pt; }
      .no-print { display: none; }
      section { page-break-inside: avoid; }
    }
  </style>
</head>
<body>
  <div class="page-header">
    <div>
      <div style="font-size:9pt;color:#64748b;margin-bottom:4px">Business Requirements Document</div>
      <h1>${escapeHtml(brd.title)}<span class="badge">${escapeHtml(brd.brdId)}</span></h1>
    </div>
    <div class="meta">
      <div>Status: <strong>${escapeHtml(brd.status)}</strong></div>
      <div>Format: <strong>${escapeHtml(brd.format)}</strong></div>
      <div>Exported: ${exportDate}</div>
    </div>
  </div>

  <div class="no-print" style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:6px;padding:10px 14px;margin-bottom:20px;font-size:9pt;color:#0369a1;">
    💡 To save as PDF: Press <strong>Ctrl+P</strong> (or ⌘+P on Mac), select <strong>Save as PDF</strong>, then click Save.
  </div>

  <!-- METADATA -->
  <section>
    <h2>Metadata</h2>
    ${metaRows
      ? `<table><thead><tr><th>Field</th><th>Value</th></tr></thead><tbody>${metaRows}</tbody></table>`
      : '<p style="color:#94a3b8;font-style:italic">No metadata available.</p>'}
  </section>

  <!-- SCOPE -->
  <section>
    <h2>Scope</h2>
    <div class="scope-grid">
      <div class="scope-box">
        <h3 class="in">In Scope (${inScope.length})</h3>
        ${inScopeRows ? `<ul>${inScopeRows}</ul>` : '<p style="color:#94a3b8;font-style:italic;font-size:10pt">None defined.</p>'}
      </div>
      <div class="scope-box">
        <h3 class="out">Out of Scope (${outOfScope.length})</h3>
        ${outScopeRows ? `<ul>${outScopeRows}</ul>` : '<p style="color:#94a3b8;font-style:italic;font-size:10pt">None defined.</p>'}
      </div>
    </div>
  </section>

  <!-- TABLE OF CONTENTS -->
  <section>
    <h2>Table of Contents</h2>
    ${tocRows
      ? `<table><thead><tr><th>Level</th><th>Title</th><th>Page</th></tr></thead><tbody>${tocRows}</tbody></table>`
      : '<p style="color:#94a3b8;font-style:italic">No table of contents available.</p>'}
  </section>

  <div class="footer">
    Generated from Structo BRD Registry &bull; ${exportDate} &bull; ${escapeHtml(brd.brdId)}
  </div>
</body>
</html>`;

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Content-Disposition", `inline; filename="${brdId}-export.html"`);
    return res.send(html);
  } catch (err) {
    console.error("[GET /brd/:brdId/export/pdf-html]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export default router;
