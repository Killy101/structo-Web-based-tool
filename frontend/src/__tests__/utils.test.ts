/**
 * Unit tests for utility functions in src/utils/index.ts
 */

import {
  formatFileSize,
  formatTimeAgo,
  getInitials,
  canCreate,
  canDeactivate,
  canChangePassword,
  teamHasAccess,
  ROLE_LABELS,
  getUserRoleLabel,
} from "../utils";

// ─── formatFileSize ────────────────────────────────────────
describe("formatFileSize", () => {
  it("formats bytes correctly", () => {
    expect(formatFileSize(512)).toBe("512 B");
  });

  it("formats kilobytes correctly", () => {
    expect(formatFileSize(2048)).toBe("2.0 KB");
  });

  it("formats megabytes correctly", () => {
    expect(formatFileSize(2 * 1024 * 1024)).toBe("2.0 MB");
  });
});

// ─── formatTimeAgo ────────────────────────────────────────
describe("formatTimeAgo", () => {
  it("returns 'Just now' for very recent times", () => {
    const now = new Date().toISOString();
    expect(formatTimeAgo(now)).toBe("Just now");
  });

  it("returns minutes ago for times less than an hour", () => {
    const thirtyMinsAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    expect(formatTimeAgo(thirtyMinsAgo)).toBe("30m ago");
  });

  it("returns hours ago for times less than a day", () => {
    const fiveHoursAgo = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString();
    expect(formatTimeAgo(fiveHoursAgo)).toBe("5h ago");
  });

  it("returns days ago for older times", () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    expect(formatTimeAgo(threeDaysAgo)).toBe("3d ago");
  });
});

// ─── getInitials ──────────────────────────────────────────
describe("getInitials", () => {
  it("returns initials from first and last name", () => {
    expect(getInitials("Alice", "Smith")).toBe("AS");
  });

  it("handles null values gracefully", () => {
    expect(getInitials(null, null)).toBe("");
    expect(getInitials("Alice", null)).toBe("A");
    expect(getInitials(null, "Smith")).toBe("S");
  });
});

// ─── Role permission helpers ──────────────────────────────
describe("canCreate", () => {
  it("allows SUPER_ADMIN to create ADMIN", () => {
    expect(canCreate("SUPER_ADMIN", "ADMIN")).toBe(true);
  });

  it("allows SADMIN to create ADMIN", () => {
    expect(canCreate("SADMIN", "ADMIN")).toBe(true);
  });

  it("allows ADMIN to create USER", () => {
    expect(canCreate("ADMIN", "USER")).toBe(true);
  });

  it("prevents USER from creating any role", () => {
    expect(canCreate("USER", "USER")).toBe(false);
  });

  it("prevents ADMIN from creating ADMIN", () => {
    expect(canCreate("ADMIN", "ADMIN")).toBe(false);
  });
});

describe("canDeactivate", () => {
  it("allows SUPER_ADMIN to deactivate any non-super role", () => {
    expect(canDeactivate("SUPER_ADMIN", "ADMIN")).toBe(true);
    expect(canDeactivate("SUPER_ADMIN", "USER")).toBe(true);
  });

  it("allows ADMIN to deactivate USER", () => {
    expect(canDeactivate("ADMIN", "USER")).toBe(true);
  });

  it("prevents USER from deactivating anyone", () => {
    expect(canDeactivate("USER", "USER")).toBe(false);
  });
});

describe("canChangePassword", () => {
  it("allows SUPER_ADMIN to change any user password", () => {
    expect(canChangePassword("SUPER_ADMIN", "ADMIN")).toBe(true);
    expect(canChangePassword("SUPER_ADMIN", "USER")).toBe(true);
  });

  it("prevents USER from changing others passwords", () => {
    expect(canChangePassword("USER", "USER")).toBe(false);
  });
});

// ─── teamHasAccess ────────────────────────────────────────
describe("teamHasAccess", () => {
  it("grants access to pre-production team features", () => {
    expect(teamHasAccess("pre-production", "brd-process")).toBe(true);
  });

  it("denies access to features not in team", () => {
    expect(teamHasAccess("production", "brd-process")).toBe(false);
  });

  it("returns false for undefined team slug", () => {
    expect(teamHasAccess(undefined, "brd-process")).toBe(false);
  });
});

// ─── ROLE_LABELS ──────────────────────────────────────────
describe("ROLE_LABELS", () => {
  it("has labels for the supported base roles and aliases", () => {
    expect(Object.keys(ROLE_LABELS)).toEqual(
      expect.arrayContaining(["SUPER_ADMIN", "SADMIN", "ADMIN", "USER"]),
    );
    expect(ROLE_LABELS.SUPER_ADMIN).toBe("Super Admin");
    expect(ROLE_LABELS.SADMIN).toBe("Super Admin");
    expect(ROLE_LABELS.USER).toBe("User");
  });
});

// ─── getUserRoleLabel ─────────────────────────────────────
describe("getUserRoleLabel", () => {
  it("returns custom role name when userRole is set", () => {
    const user = {
      role: "USER" as const,
      userRole: { id: 1, name: "QA Specialist", slug: "qa-specialist", features: [] },
    };
    expect(getUserRoleLabel(user)).toBe("QA Specialist");
  });

  it("falls back to ROLE_LABELS when no custom role", () => {
    const user = { role: "ADMIN" as const };
    expect(getUserRoleLabel(user)).toBe("Admin");
  });
});
