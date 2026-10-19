import test from "node:test";
import assert from "node:assert/strict";
import { serverSheetRosterEnabled } from "../src/lib/server/roster-config.ts";

const production = {
  PAYROLL_RELEASE_TARGET: "production",
  PAYROLL_ROSTER_MODE: "server_sheet",
  STAFF_DIRECTORY_DISABLED: "false",
};

test("real server Sheet fetch requires explicit production opt-in", () => {
  assert.equal(serverSheetRosterEnabled(production), true);
});

test("server Sheet defaults to OFF in Test, Preview and incomplete configuration", () => {
  const variants = [
    {},
    { ...production, PAYROLL_RELEASE_TARGET: "test" },
    { ...production, PAYROLL_RELEASE_TARGET: undefined },
    { ...production, PAYROLL_ROSTER_MODE: undefined },
    { ...production, PAYROLL_ROSTER_MODE: "local_csv" },
    { ...production, STAFF_DIRECTORY_DISABLED: undefined },
    { ...production, STAFF_DIRECTORY_DISABLED: "true" },
    { ...production, STAFF_DIRECTORY_DISABLED: "FALSE" },
  ];
  for (const env of variants) {
    assert.equal(serverSheetRosterEnabled(env), false, JSON.stringify(env));
  }
});

test("both Admin and staff routes use the shared fail-closed policy", async () => {
  const { readFile } = await import("node:fs/promises");
  const admin = await readFile("src/app/api/admin/roster/route.ts", "utf8");
  const staff = await readFile("src/lib/server/staff-directory.ts", "utf8");
  for (const source of [admin, staff]) {
    assert.match(source, /if \(!serverSheetRosterEnabled\(\)\)/);
    assert.doesNotMatch(source, /NEXT_PUBLIC_STAFF_SHEET_URL/);
  }
});
