import test from "node:test";
import assert from "node:assert/strict";
import {
  parsePrivateStaffSheetTitle,
  parsePrivateStaffSheetRows,
  parsePrivateSheetsOAuthToken,
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

const goodOAuthResponse = {
  access_token: "FICTIONAL_ONLY_BEARER_TOKEN_01234567890",
  token_type: "Bearer",
  expires_in: 3599,
  scope: "https://www.googleapis.com/auth/spreadsheets.readonly",
};

test("G5 OAuth accepts well-formed synthetic read-only Bearer response", () => {
  assert.equal(parsePrivateSheetsOAuthToken(goodOAuthResponse),
    goodOAuthResponse.access_token);
  assert.equal(parsePrivateSheetsOAuthToken({
    ...goodOAuthResponse, scope: undefined,
  }), goodOAuthResponse.access_token);
});

test("G5 OAuth rejects incomplete, expired, wrong-type and unsafe token responses", () => {
  for (const payload of [
    null, {}, [], { ...goodOAuthResponse, access_token: 1 },
    { ...goodOAuthResponse, access_token: "too-short" },
    { ...goodOAuthResponse, access_token: "X".repeat(8001) },
    { ...goodOAuthResponse, access_token: "FICTIONAL_ONLY_TOKEN_WITH_NEWLINE_012345\n" },
    { ...goodOAuthResponse, token_type: "MAC" },
    { ...goodOAuthResponse, token_type: undefined },
    { ...goodOAuthResponse, expires_in: 0 },
    { ...goodOAuthResponse, expires_in: 29 },
    { ...goodOAuthResponse, expires_in: "3599" },
    { ...goodOAuthResponse, expires_in: Number.NaN },
  ]) assert.throws(() => parsePrivateSheetsOAuthToken(payload));
});

test("G5 OAuth rejects token scoped away from read-only Google Sheets", () => {
  const bad = { ...goodOAuthResponse,
    scope: "https://www.googleapis.com/auth/drive.readonly" };
  assert.throws(() => parsePrivateSheetsOAuthToken(bad));
});

test("G5 OAuth validation never includes sensitive token values in errors", () => {
  const marker = "FICTIONAL_PRIVATE_BEARER_TOKEN_NOT_A_REAL_SECRET";
  try {
    parsePrivateSheetsOAuthToken({
      ...goodOAuthResponse, access_token: marker, expires_in: 0,
    });
    assert.fail("expired token must be rejected");
  } catch (e) {
    assert.ok(e instanceof Error);
    assert.ok(!e.message.includes(marker));
  }
});


test("G5 service account loader uses validated OAuth, never public CSV", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync("src/lib/server/google-sheet-source.ts", "utf8");
  assert.match(source, /parsePrivateSheetsOAuthToken\(tokenPayload\)/);
  assert.doesNotMatch(source, /\/export\?format=csv/);
});
