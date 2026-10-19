#!/usr/bin/env node
/**
 * Private G5 operator-only test. Checks Google service-account OAuth and
 * spreadsheet TAB METADATA only; never requests or prints spreadsheet rows,
 * personnel records, the admin PIN, credential values or the sheet ID.
 * Not a deployment health check, nor proof of Production cutover readiness.
 */
import { createSign } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

function refuse() {
  throw new Error("Private Google Sheets metadata verification failed");
}

async function readLimitedJson(response, limit = 65536) {
  if (!response.ok || !response.body) refuse();
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) refuse();
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let cursor = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, cursor);
    cursor += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    refuse();
  }
}

export async function checkPrivateGoogleSheetsMetadata(env, fetchImpl = fetch) {
  if (env.PAYROLL_RELEASE_TARGET !== "production" ||
      env.PAYROLL_ROSTER_MODE !== "server_sheet" ||
      env.STAFF_DIRECTORY_DISABLED !== "false" ||
      env.STAFF_SHEET_ACCESS_MODE !== "service_account") refuse();
  const email = env.GOOGLE_SHEETS_SERVICE_ACCOUNT_EMAIL;
  const privateKey = env.GOOGLE_SHEETS_SERVICE_ACCOUNT_PRIVATE_KEY;
  const id = env.STAFF_SHEET_ID;
  if (!/^[^@\s]+@[^@\s]+\.iam\.gserviceaccount\.com$/.test(email || "") ||
      !/^[A-Za-z0-9_-]{20,100}$/.test(id || "") ||
      typeof privateKey !== "string" ||
      !privateKey.includes("-----BEGIN PRIVATE KEY-----")) refuse();

  const now = Math.floor(Date.now() / 1000);
  const encode = x => Buffer.from(JSON.stringify(x)).toString("base64url");
  const header = encode({ alg: "RS256", typ: "JWT" });
  const claims = encode({
    iss: email,
    scope: "https://www.googleapis.com/auth/spreadsheets.readonly",
    aud: "https://oauth2.googleapis.com/token",
    iat: now, exp: now + 3600,
  });
  const signed = header + "." + claims;
  let assertion;
  try {
    assertion = signed + "." + createSign("RSA-SHA256").update(signed)
      .sign(privateKey.replace(/\\n/g, "\n"), "base64url");
  } catch {
    refuse();
  }
  const tokenResponse = await fetchImpl("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion,
    }),
    cache: "no-store", signal: AbortSignal.timeout(9000),
  });
  const tokenBody = await readLimitedJson(tokenResponse, 16384);
  if (typeof tokenBody?.access_token !== "string" ||
      tokenBody.access_token.length < 20 ||
      tokenBody.access_token.length > 8000 ||
      /[\s\u0000-\u001f\u007f]/.test(tokenBody.access_token) ||
      tokenBody.token_type !== "Bearer" ||
      !Number.isInteger(tokenBody.expires_in) ||
      tokenBody.expires_in < 30 || tokenBody.expires_in > 86400 ||
      (tokenBody.scope !== undefined &&
       (typeof tokenBody.scope !== "string" ||
        !tokenBody.scope.split(/\s+/).includes(
          "https://www.googleapis.com/auth/spreadsheets.readonly")))) refuse();

  const metadataResponse = await fetchImpl(
    "https://sheets.googleapis.com/v4/spreadsheets/" + id +
    "?fields=sheets(properties(sheetId,title))", {
      headers: { Authorization: "Bearer " + tokenBody.access_token },
      cache: "no-store", signal: AbortSignal.timeout(9000),
    });
  const metadata = await readLimitedJson(metadataResponse, 65536);
  const sheets = metadata?.sheets;
  if (!Array.isArray(sheets) || sheets.length < 2 || sheets.length > 1000) refuse();
  const roster = sheets.filter(x => x?.properties?.sheetId === 0);
  const settings = sheets.filter(x => x?.properties?.title === "Settings");
  if (roster.length !== 1 || settings.length !== 1 ||
      typeof roster[0]?.properties?.title !== "string" ||
      !roster[0].properties.title.trim() ||
      !Number.isInteger(settings[0]?.properties?.sheetId)) refuse();
  // No Sheets "values" endpoint, no real roster/PIN contents, no mutations.
  return { result: "PASS", checks: "private-google-oauth-and-tab-metadata" };
}

if (process.argv[1] &&
    import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.length !== 2) {
    process.stdout.write('{"result":"NO_GO","checks":"private-google-metadata"}\n');
    process.exitCode = 2;
  } else {
    try {
      const result = await checkPrivateGoogleSheetsMetadata(process.env);
      process.stdout.write(JSON.stringify(result) + "\n");
    } catch {
      // Do not log raw Google errors, responses, private keys, emails or IDs.
      process.stdout.write('{"result":"NO_GO","checks":"private-google-metadata"}\n');
      process.exitCode = 1;
    }
  }
}
