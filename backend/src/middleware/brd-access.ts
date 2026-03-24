import { NextFunction, Response } from "express";
import prisma from "../lib/prisma";
import { AuthRequest } from "./authenticate";

export type BrdStatus = "DRAFT" | "PAUSED" | "COMPLETED" | "APPROVED" | "ON_HOLD";

export interface BrdAccessPolicy {
  userId: number;
  role: string;
  teamSlug: string | null;
  canCreate: boolean;
  canEdit: boolean;
  canChangeStatus: boolean;
  canDelete: boolean;
  canUseTrash: boolean;
  visibleStatuses: BrdStatus[] | null;
}

const PRE_PRODUCTION_SLUG = "pre-production";
const RESTRICTED_STATUSES: BrdStatus[] = ["APPROVED", "ON_HOLD"];

function forbidden(res: Response, message: string) {
  return res.status(403).json({ error: message });
}

function isPreProductionTeam(teamSlug: string | null): boolean {
  return String(teamSlug ?? "").toLowerCase() === PRE_PRODUCTION_SLUG;
}

function buildPolicy(params: {
  userId: number;
  role: string;
  teamSlug: string | null;
}): BrdAccessPolicy {
  const role = params.role;
  const preProduction = isPreProductionTeam(params.teamSlug);

  if (role === "SUPER_ADMIN") {
    return {
      userId: params.userId,
      role,
      teamSlug: params.teamSlug,
      canCreate: true,
      canEdit: true,
      canChangeStatus: true,
      canDelete: true,
      canUseTrash: true,
      visibleStatuses: null,
    };
  }

  if (role === "ADMIN" || role === "USER") {
    if (preProduction) {
      const canDelete = role === "ADMIN";
      return {
        userId: params.userId,
        role,
        teamSlug: params.teamSlug,
        canCreate: true,
        canEdit: true,
        canChangeStatus: true,
        canDelete,
        canUseTrash: canDelete,
        visibleStatuses: null,
      };
    }

    return {
      userId: params.userId,
      role,
      teamSlug: params.teamSlug,
      canCreate: false,
      canEdit: false,
      canChangeStatus: false,
      canDelete: false,
      canUseTrash: false,
      visibleStatuses: RESTRICTED_STATUSES,
    };
  }

  return {
    userId: params.userId,
    role,
    teamSlug: params.teamSlug,
    canCreate: false,
    canEdit: false,
    canChangeStatus: false,
    canDelete: false,
    canUseTrash: false,
    visibleStatuses: RESTRICTED_STATUSES,
  };
}

export async function attachBrdAccessPolicy(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        role: true,
        team: { select: { slug: true } },
      },
    });

    if (!user) {
      return res.status(401).json({ error: "User not found" });
    }

    res.locals.brdAccess = buildPolicy({
      userId: user.id,
      role: user.role,
      teamSlug: user.team?.slug ?? null,
    });

    return next();
  } catch (error) {
    console.error("[BRD access policy]", error);
    return res.status(500).json({ error: "Internal server error" });
  }
}

export function getBrdAccessPolicy(res: Response): BrdAccessPolicy {
  return res.locals.brdAccess as BrdAccessPolicy;
}

export function getBrdVisibilityStatuses(policy: BrdAccessPolicy): BrdStatus[] | null {
  return policy.visibleStatuses;
}

export function canReadBrdStatus(policy: BrdAccessPolicy, status: unknown): boolean {
  if (!policy.visibleStatuses || policy.visibleStatuses.length === 0) {
    return true;
  }

  const normalized = String(status ?? "").toUpperCase() as BrdStatus;
  return policy.visibleStatuses.includes(normalized);
}

export function requireBrdCreate(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) {
  const policy = getBrdAccessPolicy(res);
  if (!policy.canCreate) {
    return forbidden(
      res,
      "Only Pre-Production team (Admin/User) can create BRDs. Other teams are view and generate only.",
    );
  }
  return next();
}

export function requireBrdEdit(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) {
  const policy = getBrdAccessPolicy(res);
  if (!policy.canEdit) {
    return forbidden(
      res,
      "Only Pre-Production team (Admin/User) can edit BRDs. Other teams are view and generate only.",
    );
  }
  return next();
}

export function requireBrdStatusChange(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) {
  const policy = getBrdAccessPolicy(res);
  if (!policy.canChangeStatus) {
    return forbidden(
      res,
      "Only Pre-Production team (Admin/User) can change BRD status.",
    );
  }
  return next();
}

export function requireBrdDelete(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) {
  const policy = getBrdAccessPolicy(res);
  if (!policy.canDelete) {
    return forbidden(
      res,
      "Only Super Admin and Pre-Production Admin can delete BRDs.",
    );
  }
  return next();
}

export function requireBrdTrashAccess(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) {
  const policy = getBrdAccessPolicy(res);
  if (!policy.canUseTrash) {
    return forbidden(
      res,
      "Only Super Admin and Pre-Production Admin can access deleted BRDs.",
    );
  }
  return next();
}
