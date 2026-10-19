import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { spawnSync } from "node:child_process";
import { checkPrivateGoogleSheetsMetadata } from "../scripts/check-private-google-sheets-access.mjs";

const privateKey = generateKeyPairSync("rsa", { modulusLength: 2048 })
  .privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const env = Object.freeze({
  PAYROLL_RELEASE_TARGET: "production",
  PAYROLL_ROSTER_MODE: "server_sheet",
  STAFF_DIRECTORY_DISABLED: "false",
  STAFF_SHEET_ACCESS_MODE: "service_account",
  STAFF_SHEET_ID: "SYNTHETIC_SHEET_ID_FOR_FAKE_ONLY_12345",
  GOOGLE_SHEETS_SERVICE_ACCOUNT_EMAIL:
    "fake@synthetic-project.iam.gserviceaccount.com",
  GOOGLE_SHEETS_SERVICE_ACCOUNT_PRIVATE_KEY: privateKey,
});
const fakeResponse = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { "Content-Type": "application/json" },
});
const sampleMetadata = { sheets: [
  { properties: { sheetId: 0, title: "Fixture roster" } },
  { properties: { sheetId: 9, title: "Settings" } },
] };
function privateMock(overrides = {}) {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push(String(url));
    if (url === "https://oauth2.googleapis.com/token") {
      assert.equal(options.method, "POST");
      const jwt = options.body.get("assertion");
      const claims = JSON.parse(Buffer.from(jwt.split(".")[1], "base64url"));
      assert.equal(claims.iss, env.GOOGLE_SHEETS_SERVICE_ACCOUNT_EMAIL);
      assert.equal(claims.scope,
        "https://www.googleapis.com/auth/spreadsheets.readonly");
      assert.equal(claims.aud, "https://oauth2.googleapis.com/token");
      return fakeResponse(overrides.token ?? {
        token_type: "Bearer", expires_in: 3600,
        access_token: "SYNTHETIC_FAKE_OAUTH_TOKEN_123456789",
      }, overrides.tokenStatus ?? 200);
    }
    assert.equal(url,
      "https://sheets.googleapis.com/v4/spreadsheets/" + env.STAFF_SHEET_ID +
      "?fields=sheets(properties(sheetId,title))");
    assert.match(options.headers.Authorization, /^Bearer /);
    assert.doesNotMatch(url, /\/values\//);
    return fakeResponse(overrides.metadata ?? sampleMetadata,
      overrides.metadataStatus ?? 200);
  };
  return { fetchImpl, calls };
}
test("private service account OAuth and tab metadata succeeds without reading rows", async () => {
  const mock = privateMock();
  assert.deepEqual(await checkPrivateGoogleSheetsMetadata(env, mock.fetchImpl), {
    result: "PASS", checks: "private-google-oauth-and-tab-metadata",
  });
  assert.equal(mock.calls.length, 2);
  assert.ok(mock.calls.every(x => !x.includes("/values/")));
});
test("fail closed for missing production configuration before any outbound requests", async () => {
  for (const modification of [
    { GOOGLE_SHEETS_SERVICE_ACCOUNT_PRIVATE_KEY: undefined },
    { STAFF_SHEET_ID: "" },
    { STAFF_DIRECTORY_DISABLED: "true" },
    { PAYROLL_RELEASE_TARGET: "test" },
  ]) {
    const mock = privateMock();
    await assert.rejects(checkPrivateGoogleSheetsMetadata(
      { ...env, ...modification }, mock.fetchImpl));
    assert.deepEqual(mock.calls, []);
  }
});
test("reject wrong OAuth type or rejected credentials with no row access", async () => {
  for (const overrides of [
    { tokenStatus: 403 },
    { token: { access_token: "FAKE_LONG_TOKEN_1234567890123",
      token_type: "MAC", expires_in: 3600 } },
    { token: { access_token: "FAKE_LONG_TOKEN_1234567890123",
      token_type: "Bearer", expires_in: 1 } },
  ]) {
    const mock = privateMock(overrides);
    await assert.rejects(checkPrivateGoogleSheetsMetadata(env, mock.fetchImpl));
    assert.equal(mock.calls.length, 1);
  }
});
test("reject Sheet metadata lacking the roster or admin Settings tab", async () => {
  for (const overrides of [
    { metadataStatus: 403 },
    { metadata: { sheets: [{ properties: { sheetId: 0, title: "Roster" } }] } },
    { metadata: { sheets: [{ properties: { sheetId: 5, title: "Settings" } }] } },
    { metadata: { sheets: [
      { properties: { sheetId: 0, title: "Roster" } },
      { properties: { sheetId: 1, title: "Settings" } },
      { properties: { sheetId: 2, title: "Settings" } },
    ] } },
    { metadata: { sheets: [
      { properties: { sheetId: 0, title: "Roster" } },
      { properties: { sheetId: 0, title: "Settings" } },
    ] } },
  ]) {
    const mock = privateMock(overrides);
    if (overrides.metadata?.sheets?.[1]?.properties?.sheetId === 0 &&
      overrides.metadata.sheets.length === 2) continue;
    await assert.rejects(checkPrivateGoogleSheetsMetadata(env, mock.fetchImpl));
    assert.equal(mock.calls.length, 2);
  }
});
test("standalone checker with missing credentials never logs credential values", () => {
  const marker = "SYNTHETIC_DO_NOT_PRINT_CREDENTIAL";
  const run = spawnSync(process.execPath,
    ["scripts/check-private-google-sheets-access.mjs"], {
      env: { PATH: process.env.PATH || "",
        STAFF_SHEET_ID: marker,
        GOOGLE_SHEETS_SERVICE_ACCOUNT_PRIVATE_KEY: marker },
      encoding: "utf8", timeout: 12000,
    });
  assert.equal(run.status, 1);
  assert.equal(JSON.parse(run.stdout).result, "NO_GO");
  assert.ok(!(run.stdout + run.stderr).includes(marker));
});
