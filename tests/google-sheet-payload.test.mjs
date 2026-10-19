import test from "node:test";
import assert from "node:assert/strict";
import {
  parsePrivateStaffSheetTitle,
  parsePrivateStaffSheetRows,
} from "../src/lib/server/google-sheet-payload.ts";

const fakeRows = [
  ["Name", "Position", "Bank account", "Position ID"],
  ["Example Person", "Example Position", "0000000000", "0000001"],
];

test("G5 private Sheets reads precisely gid=0 regardless of sheet array order", () => {
  const metadata = { sheets: [
    { properties: { sheetId: 15, title: "Unrelated" } },
    { properties: { sheetId: 0, title: "Personnel" } },
  ] };
  assert.equal(parsePrivateStaffSheetTitle(metadata), "Personnel");
});

test("G5 private Sheets fails closed when gid=0 is absent, repeated or malformed", () => {
  for (const metadata of [
    null, {}, { sheets: "not-an-array" }, { sheets: [] },
    { sheets: [{ properties: { sheetId: 1, title: "Other" } }] },
    { sheets: [{ properties: { sheetId: "0", title: "Roster" } }] },
    { sheets: [{ properties: { sheetId: 0, title: "A" } }, { properties: { sheetId: 0, title: "B" } }] },
    { sheets: [{ properties: { sheetId: 0, title: "" } }] },
    { sheets: [{ properties: { sheetId: 0, title: " " } }] },
    { sheets: [{ properties: { sheetId: 0, title: "Bad\nTitle" } }] },
    { sheets: [{ properties: { sheetId: 0, title: "X".repeat(201) } }] },
  ]) {
    assert.throws(() => parsePrivateStaffSheetTitle(metadata));
  }
});

test("G5 private Sheets preserves leading zeros as strings; never coerces accounts", () => {
  assert.deepEqual(parsePrivateStaffSheetRows({ values: fakeRows }), fakeRows);
  assert.equal(parsePrivateStaffSheetRows({ values: fakeRows })[1][2], "0000000000");
});

test("G5 private Sheets refuses malformed, numeric, over-column and excessive rows", () => {
  for (const payload of [
    null, {}, { values: [] }, { values: "not-an-array" },
    { values: [{ bank: "0000000000" }] },
    { values: [["A", "B", 1234567890, "0000001"]] },
    { values: [["A", "B", "C", "D", "E"]] },
    { values: Array.from({ length: 1001 }, () => ["Synthetic"]) },
  ]) {
    assert.throws(() => parsePrivateStaffSheetRows(payload));
  }
});

test("G5 private Sheets error messages do not expose upstream roster fields", () => {
  const sensitiveMarker = "FICTIONAL_PRIVATE_FIELD_TEST_ONLY";
  try {
    parsePrivateStaffSheetRows({ values: [[sensitiveMarker, "B", 123, "D"]] });
    assert.fail("malformed Sheet response should be rejected");
  } catch (error) {
    assert.ok(error instanceof Error);
    assert.ok(!error.message.includes(sensitiveMarker));
  }
});
