import { Response, NextFunction } from "express";
import { AuthRequest } from "./authenticate";

export function normalizeRole(role: string | null | undefined): string {
  const normalized = String(role ?? "").trim().toUpperCase();
  return normalized === "SADMIN" ? "SUPER_ADMIN" : normalized;
}

export function isSuperAdminRole(role: string | null | undefined): boolean {
  return normalizeRole(role) === "SUPER_ADMIN";
}

export const authorize = (roles: string[]) => {
  const allowedRoles = roles.map(normalizeRole);

  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const userRole = normalizeRole(req.user.role);
    req.user.role = userRole;

    if (!allowedRoles.includes(userRole)) {
      return res
        .status(403)
        .json({ error: "Forbidden: insufficient permissions" });
    }

    next();
  };
};
