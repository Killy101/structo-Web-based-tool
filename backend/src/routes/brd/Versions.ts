// routes/brd/versions.ts
// Handles BRD version snapshots.
// A version is created every time the user clicks "Save BRD" in Generate.tsx.
//
// GET    /brd/:brdId/versions              — list all versions (summary)
// GET    /brd/:brdId/versions/:versionNum  — fetch one version's full section data
// POST   /brd/:brdId/versions              — create a new version snapshot
// DELETE /brd/:brdId/versions/:versionNum  — delete a specific version

import { Router, Request, Response } from "express";
import { Prisma } from "@prisma/client";
import prisma from "../../lib/prisma";
import { AuthRequest } from "../../middleware/authenticate";
import {
  canReadBrdStatus,
  getBrdAccessPolicy,
  requireBrdEdit,
} from "../../middleware/brd-access";
import {
  downloadJsonObject,
  extractStoragePath,
  makeStoragePointer,
  removeObjects,
  uploadJsonObject,
} from "../../lib/supabase-storage";

const router = Router();

async function ensureReadableBrd(req: AuthRequest, res: Response): Promise<boolean> {
  const brd = await prisma.brd.findUnique({
    where: { brdId: String(req.params.brdId) },
    select: { status: true, deletedAt: true },
  });

  if (!brd || brd.deletedAt !== null) {
    res.status(404).json({ error: "BRD not found" });
    return false;
  }

  const accessPolicy = getBrdAccessPolicy(res);
  if (!canReadBrdStatus(accessPolicy, brd.status)) {
    res
      .status(403)
      .json({ error: "You can only view BRDs with APPROVED or ON_HOLD status." });
    return false;
  }

  return true;
}

// ── Helper ────────────────────────────────────────────────────────────────────
async function resolveMaybeStored(raw: unknown): Promise<unknown> {
  const path = extractStoragePath(raw);
  if (!path) return raw ?? null;
  try {
    return await downloadJsonObject(path);
  } catch {
    return null;
  }
}

// ── GET /brd/:brdId/versions ──────────────────────────────────────────────────
router.get("/:brdId/versions", async (req: AuthRequest, res: Response) => {
  try {
    if (!(await ensureReadableBrd(req, res))) {
      return;
    }

    const brdId = String(req.params.brdId);

    const versions = await prisma.brdVersion.findMany({
      where:   { brdId },
      orderBy: { versionNum: "desc" },
      select: {
        id:         true,
        brdId:      true,
        versionNum: true,
        label:      true,
        savedAt:    true,
      },
    });

    return res.json({ versions });
  } catch (err) {
    console.error("[GET /brd/:brdId/versions]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /brd/:brdId/versions/:versionNum ─────────────────────────────────────
router.get("/:brdId/versions/:versionNum", async (req: AuthRequest, res: Response) => {
  try {
    if (!(await ensureReadableBrd(req, res))) {
      return;
    }

    const brdId      = String(req.params.brdId);
    const versionNum = parseInt(String(req.params.versionNum), 10);

    if (isNaN(versionNum)) {
      return res.status(400).json({ error: "Invalid versionNum" });
    }

    const version = await prisma.brdVersion.findFirst({
      where: { brdId, versionNum },
    });

    if (!version) {
      return res.status(404).json({ error: "Version not found" });
    }

    const [scope, metadata, toc, citations, contentProfile, brdConfig] = await Promise.all([
      resolveMaybeStored(version.scope),
      resolveMaybeStored(version.metadata),
      resolveMaybeStored(version.toc),
      resolveMaybeStored(version.citations),
      resolveMaybeStored(version.contentProfile),
      resolveMaybeStored(version.brdConfig),
    ]);

    return res.json({
      id:             version.id,
      brdId:          version.brdId,
      versionNum:     version.versionNum,
      label:          version.label,
      savedAt:        version.savedAt,
      scope,
      metadata,
      toc,
      citations,
      contentProfile,
      brdConfig,
    });
  } catch (err) {
    console.error("[GET /brd/:brdId/versions/:versionNum]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /brd/:brdId/versions ─────────────────────────────────────────────────
router.post("/:brdId/versions", requireBrdEdit, async (req: Request, res: Response) => {
  try {
    const brdId = String(req.params.brdId);
    const { scope, metadata, toc, citations, contentProfile, brdConfig, label } = req.body;

    const latest = await prisma.brdVersion.findFirst({
      where:   { brdId },
      orderBy: { versionNum: "desc" },
      select:  { id: true, versionNum: true, label: true, savedAt: true },
    });
    const nextNum = (latest?.versionNum ?? 0) + 1;
    const vLabel  = label || `v${nextNum}.0`;

    const base = `brd/${brdId}/versions/${nextNum}`;

    const [scopePath, metaPath, tocPath, citPath, cpPath, cfgPath] = await Promise.all([
      uploadJsonObject(`${base}/scope.json`,          scope          ?? null).catch(() => null),
      uploadJsonObject(`${base}/metadata.json`,       metadata       ?? null).catch(() => null),
      uploadJsonObject(`${base}/toc.json`,            toc            ?? null).catch(() => null),
      uploadJsonObject(`${base}/citations.json`,      citations      ?? null).catch(() => null),
      uploadJsonObject(`${base}/contentProfile.json`, contentProfile ?? null).catch(() => null),
      uploadJsonObject(`${base}/brdConfig.json`,      brdConfig      ?? null).catch(() => null),
    ]);

    const toPtr = (p: string | null): Prisma.InputJsonValue | typeof Prisma.JsonNull =>
      p ? (makeStoragePointer(p) as unknown as Prisma.InputJsonValue) : Prisma.JsonNull;

    let version;
    try {
      version = await prisma.brdVersion.create({
        data: {
          brdId,
          versionNum: nextNum,
          label:      vLabel,
          scope:          toPtr(scopePath),
          metadata:       toPtr(metaPath),
          toc:            toPtr(tocPath),
          citations:      toPtr(citPath),
          contentProfile: toPtr(cpPath),
          brdConfig:      toPtr(cfgPath),
        },
      });
    } catch (createErr: any) {
      // P2002 = unique constraint violation — another request beat us to it.
      // Re-fetch the latest and return it instead of failing.
      if (createErr?.code === "P2002") {
        const existing = await prisma.brdVersion.findFirst({
          where:   { brdId },
          orderBy: { versionNum: "desc" },
        });
        if (existing) {
          return res.status(200).json({
            id:         existing.id,
            brdId:      existing.brdId,
            versionNum: existing.versionNum,
            label:      existing.label,
            savedAt:    existing.savedAt,
          });
        }
      }
      throw createErr;
    }

    return res.status(201).json({
      id:         version.id,
      brdId:      version.brdId,
      versionNum: version.versionNum,
      label:      version.label,
      savedAt:    version.savedAt,
    });
  } catch (err) {
    console.error("[POST /brd/:brdId/versions]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ── DELETE /brd/:brdId/versions/:versionNum ───────────────────────────────────
router.delete("/:brdId/versions/:versionNum", requireBrdEdit, async (req: Request, res: Response) => {
  try {
    const brdId      = String(req.params.brdId);
    const versionNum = parseInt(String(req.params.versionNum), 10);

    if (isNaN(versionNum)) {
      return res.status(400).json({ error: "Invalid versionNum" });
    }

    const version = await prisma.brdVersion.findFirst({
      where:  { brdId, versionNum },
      select: { id: true },
    });

    if (!version) {
      return res.status(404).json({ error: "Version not found" });
    }

    // Best-effort storage cleanup — don't block on failure
    const base = `brd/${brdId}/versions/${versionNum}`;
    removeObjects([
      `${base}/scope.json`,
      `${base}/metadata.json`,
      `${base}/toc.json`,
      `${base}/citations.json`,
      `${base}/contentProfile.json`,
      `${base}/brdConfig.json`,
    ]).catch(err => console.warn("[DELETE versions] storage cleanup failed:", err));

    await prisma.brdVersion.delete({ where: { id: version.id } });

    return res.json({ success: true });
  } catch (err) {
    console.error("[DELETE /brd/:brdId/versions/:versionNum]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;