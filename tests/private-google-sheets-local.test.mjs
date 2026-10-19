import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  parseSpreadsheetId, normalizeLocalJsonPath, parseServiceAccountJson
} from "../scripts/check-private-google-sheets-local.mjs";

test("local G5 checker parses a real-shape Google Sheet URL", () => {
  const id = "SYNTHETIC_FAKE_SHEET_ID_00000000001";
  assert.equal(parseSpreadsheetId("https://docs.google.com/spreadsheets/d/" +
    id + "/edit?gid=0#gid=0"), id);
  assert.equal(parseSpreadsheetId(id), id);
  for (const bad of [
    null, "http://docs.google.com/spreadsheets/d/" + id,
    "https://docs.google.com.evil.invalid/spreadsheets/d/" + id,
    "https://docs.google.com/spreadsheets/d/" + id + "/copy",
    "https://u:p@docs.google.com/spreadsheets/d/" + id + "/edit",
    "x",
  ]) assert.equal(parseSpreadsheetId(bad), null);
});
test("local JSON path parser handles Windows drag-drop and rejects non-JSON", () => {
  assert.equal(normalizeLocalJsonPath('"C:\\Users\\Example\\Downloads\\key.json"'),
    "C:\\Users\\Example\\Downloads\\key.json");
  for (const bad of ["", "a.txt", "a.json\nx", "x".repeat(1100)])
    assert.equal(normalizeLocalJsonPath(bad), null);
});
test("local JSON key parser uses only fake service-account fields", () => {
  const privateKey = generateKeyPairSync("rsa", { modulusLength: 2048 })
    .privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const email = "fake@synthetic-project.iam.gserviceaccount.com";
  const payload = JSON.stringify({ type:"service_account",
    client_email:email, private_key:privateKey });
  const result = parseServiceAccountJson(payload);
  assert.equal(result.GOOGLE_SHEETS_SERVICE_ACCOUNT_EMAIL, email);
  assert.equal(result.GOOGLE_SHEETS_SERVICE_ACCOUNT_PRIVATE_KEY, privateKey);
  for (const bad of ["{}", "invalid-json",
    JSON.stringify({ type:"service_account", client_email:email,
      private_key:"not a key" }),
  ]) assert.equal(parseServiceAccountJson(bad), null);
});
test("unknown CLI args return generic NO_GO, never echo private markers", () => {
  const marker="FICTIONAL_PRIVATE_MARKER_NOT_REAL";
  const result=spawnSync(process.execPath,
    ["scripts/check-private-google-sheets-local.mjs", marker],{
      encoding:"utf8", timeout:12000, env:{PATH:process.env.PATH||""},
    });
  assert.equal(result.status,2);
  assert.equal(JSON.parse(result.stdout).result,"NO_GO");
  assert.ok(!(result.stdout+result.stderr).includes(marker));
});
