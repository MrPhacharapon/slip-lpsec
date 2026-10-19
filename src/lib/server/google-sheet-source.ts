import { signGoogleSheetsAssertion } from "./google-sheet-auth";
import { readBoundedResponseText } from "./bounded-response";
import { serverSheetRosterEnabled } from "./roster-config";
import { parsePrivateStaffSheetTitle, parsePrivateStaffSheetRows, parsePrivateSheetsOAuthToken, parsePrivateAdminSettingsTitle, parsePrivateAdminSettingsPin } from "./google-sheet-payload";

/**
 * Fetch A:D of the legacy gid=0 roster using a private read-only Google
 * service account. There is deliberately NO unauthenticated CSV fallback:
 * the legacy Sheet currently has anyone-with-link sharing and contains
 * staff bank account identifiers.
 *
 * Called only on the server and only with explicit Production opt-in.
 */
async function loadPrivateSheetPayload(target: "roster" | "admin_pin"): Promise<unknown> {
  if (!serverSheetRosterEnabled() ||
      process.env.STAFF_SHEET_ACCESS_MODE !== "service_account") {
    throw new Error("Private Google Sheets access is unavailable");
  }
  const id = process.env.STAFF_SHEET_ID;
  const email = process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_EMAIL;
  const key = process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_PRIVATE_KEY;
  if (!id || !/^[A-Za-z0-9_-]{20,100}$/.test(id) || !email || !key)
    throw new Error("Private Google Sheets credentials are unavailable");
  const assertion = signGoogleSheetsAssertion(email, key);
  const auth = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(9000),
  });
  if (!auth.ok) throw new Error("Private Google Sheets authorization failed");
  const tokenPayload: unknown = JSON.parse(await readBoundedResponseText(auth, 16_384));
  const accessToken = parsePrivateSheetsOAuthToken(tokenPayload);
  const headers = { Authorization: "Bearer " + accessToken };
  const origin = "https://sheets.googleapis.com/v4/spreadsheets/" + id;
  const details = await fetch(origin + "?fields=sheets(properties(sheetId,title))", {
    headers, cache: "no-store", signal: AbortSignal.timeout(9000),
  });
  if (!details.ok) throw new Error("Private Google Sheet is not accessible");
  const metadata: unknown = JSON.parse(await readBoundedResponseText(details, 100_000));
  const title = target === "roster"
    ? parsePrivateStaffSheetTitle(metadata)
    : parsePrivateAdminSettingsTitle(metadata);
  const safeTitle = title.replace(/'/g, "''");
  const range = encodeURIComponent(
    "'" + safeTitle + "'" + (target === "roster" ? "!A:D" : "!A1:B100"),
  );
  const data = await fetch(origin + "/values/" + range + "?majorDimension=ROWS", {
    headers, cache: "no-store", signal: AbortSignal.timeout(9000),
  });
  if (!data.ok) throw new Error("Private Google Sheet data not readable");
  // Keep the existing one-megabyte roster streaming guard unchanged;
  // Settings contains only a short private range with a tighter 16KB cap.
  const content: unknown = JSON.parse(target === "roster"
    ? await readBoundedResponseText(data, 1_000_000)
    : await readBoundedResponseText(data, 16_384));
  return content;
}

export async function loadPrivateStaffSheetRows(): Promise<string[][]> {
  return parsePrivateStaffSheetRows(await loadPrivateSheetPayload("roster"));
}

/** Load only the pre-existing admin PIN on the server; never expose Settings. */
export async function loadPrivateAdminPin(): Promise<string> {
  return parsePrivateAdminSettingsPin(await loadPrivateSheetPayload("admin_pin"));
}
