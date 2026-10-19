#!/usr/bin/env node
// Private local-only Google Sheets OAuth and tab-metadata test.
// Never reads staff/PIN rows or logs private Google data.
import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createInterface } from "node:readline/promises";
import { checkPrivateGoogleSheetsMetadata } from "./check-private-google-sheets-access.mjs";

const FAIL = '{"result":"NO_GO","checks":"private-google-metadata"}';
export function parseSpreadsheetId(raw) {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (/^[A-Za-z0-9_-]{20,100}$/.test(value)) return value;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.hostname !== "docs.google.com" ||
        url.username || url.password || url.port) return null;
    const matched = url.pathname.match(
      /^\/spreadsheets\/d\/([A-Za-z0-9_-]{20,100})(?:\/(?:edit|view))?\/?$/
    );
    return matched?.[1] || null;
  } catch { return null; }
}
export function normalizeLocalJsonPath(raw) {
  if (typeof raw !== "string") return null;
  let path = raw.trim();
  if (path.length >= 2 &&
     ((path[0] === '"' && path.at(-1) === '"') ||
      (path[0] === "'" && path.at(-1) === "'"))) path = path.slice(1, -1);
  if (!path || path.length > 1024 || /[\0\r\n]/.test(path) ||
      !path.toLowerCase().endsWith(".json")) return null;
  return path;
}
export function parseServiceAccountJson(raw) {
  if (typeof raw !== "string" || raw.length > 65536) return null;
  try {
    const value = JSON.parse(raw);
    if (value?.type !== "service_account" ||
        !/^[^@\s]+@[^@\s]+\.iam\.gserviceaccount\.com$/.test(
          value.client_email || "") ||
        typeof value.private_key !== "string" ||
        !value.private_key.includes("-----BEGIN PRIVATE KEY-----") ||
        !value.private_key.includes("-----END PRIVATE KEY-----")) return null;
    return {
      GOOGLE_SHEETS_SERVICE_ACCOUNT_EMAIL: value.client_email,
      GOOGLE_SHEETS_SERVICE_ACCOUNT_PRIVATE_KEY: value.private_key,
    };
  } catch { return null; }
}
async function run() {
  const input = createInterface({ input: process.stdin, output: process.stdout });
  try {
    process.stdout.write("Google Sheets private test (OAuth + tab names only)\n");
    const path = normalizeLocalJsonPath(await input.question(
      "1) Drag your downloaded service-account JSON file here; press Enter: "));
    if (!path) throw Error("invalid local path");
    const info = await stat(path);
    if (!info.isFile() || info.size > 65536) throw Error("invalid JSON size");
    const credential = parseServiceAccountJson(await readFile(path, "utf8"));
    if (!credential) throw Error("invalid service account");
    const id = parseSpreadsheetId(await input.question(
      "2) Paste the original Google Sheets URL here; press Enter: "));
    if (!id) throw Error("invalid Sheet URL");
    const result = await checkPrivateGoogleSheetsMetadata({
      PAYROLL_RELEASE_TARGET: "production",
      PAYROLL_ROSTER_MODE: "server_sheet",
      STAFF_DIRECTORY_DISABLED: "false",
      STAFF_SHEET_ACCESS_MODE: "service_account",
      STAFF_SHEET_ID: id,
      ...credential,
    });
    process.stdout.write(JSON.stringify(result) + "\n");
  } catch {
    process.stdout.write(FAIL + "\n");
    process.exitCode = 1;
  } finally {
    input.close();
  }
}
if (process.argv[1] &&
    import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.length !== 2) {
    process.stdout.write(FAIL + "\n");
    process.exitCode = 2;
  } else {
    await run();
  }
}
