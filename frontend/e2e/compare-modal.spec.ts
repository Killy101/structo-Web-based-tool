// e2e/compare-modal.spec.ts
// Patch 9 — Smoke test that catches Issue 1 regressions:
//   "View All" from ChangeSummaryModal must open DiffViewer, not fall back to DiffUpload.
//
// Requirements:
//   - fixtures/small/  : ≤100 pages (goes through apiDiff)       — includes ref.xml
//   - fixtures/large/  : >100 pages (goes through apiDiffLarge)  — includes ref.xml
//   Both fixtures must include XML to trigger the modal code path.

import { test, expect } from "@playwright/test";
import path from "path";

test.describe("Compare workflow modal", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/compare");
    // Select Workflow 1 (Chunk & Compare)
    await page.getByRole("button", { name: /Workflow 1/ }).click();
  });

  for (const sizeLabel of ["small", "large"]) {
    test(`View All from modal opens DiffViewer (${sizeLabel} doc)`, async ({ page }) => {
      const fixtureDir = path.join(__dirname, "fixtures", sizeLabel);

      await page.locator('input[type="file"]').nth(0).setInputFiles(path.join(fixtureDir, "old.pdf"));
      await page.locator('input[type="file"]').nth(1).setInputFiles(path.join(fixtureDir, "new.pdf"));
      await page.locator('input[type="file"]').nth(2).setInputFiles(path.join(fixtureDir, "ref.xml"));

      // Pick chunk level — Section is the most common level
      await page.getByRole("button", { name: /Section/ }).first().click();

      await page.getByRole("button", { name: /Run Diff/ }).click();

      // Modal should appear within 30s (small) or 90s (large)
      const timeout = sizeLabel === "small" ? 30_000 : 90_000;
      await expect(page.getByText("Changes Summary")).toBeVisible({ timeout });

      // Click View All
      await page.getByRole("button", { name: "View All" }).click();

      // DiffViewer should be visible — NOT back at upload
      await expect(page.locator('[data-testid="xml-panel-scroll"]')).toBeVisible({ timeout: 5_000 });
      await expect(page.getByRole("button", { name: /Run Diff/ })).not.toBeVisible();
    });
  }
});
