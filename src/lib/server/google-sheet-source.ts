import { signGoogleSheetsAssertion } from "./google-sheet-auth";
import { readBoundedResponseText } from "./bounded-response";
import { serverSheetRosterEnabled } from "./roster-config";
import { parsePrivateStaffSheetTitle, parsePrivateStaffSheetRows } from "./google-sheet-payload";

/**
 * Fetch A:D of the legacy gid=0 roster using a private read-only Google
 * service account. There is deliberately NO unauthenticated CSV fallback:
 * the legacy Sheet currently has anyone-with-link sharing and contains
 * staff bank account identifiers.
 *
 * Called only on the server and only with explicit Production opt-in.
 */
export async function loadPrivateStaffSheetRows(): Promise<string[][]> {
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
  const accessToken = (tokenPayload as { access_token?: unknown } | null)?.access_token;
  if (typeof accessToken !== "string" || accessToken.length < 20 ||
      accessToken.length > 8_000) {
    throw new Error("Private Google Sheets authorization failed");
  }
  const headers = { Authorization: "Bearer " + accessToken };
  const origin = "https://sheets.googleapis.com/v4/spreadsheets/" + id;
  const details = await fetch(origin + "?fields=sheets(properties(sheetId,title))", {
    headers, cache: "no-store", signal: AbortSignal.timeout(9000),
  });
  if (!details.ok) throw new Error("Private Google Sheet is not accessible");
  const metadata: unknown = JSON.parse(await readBoundedResponseText(details, 100_000));
  const title = parsePrivateStaffSheetTitle(metadata);
  const safeTitle = title.replace(/'/g, "''");
  const range = encodeURIComponent("'" + safeTitle + "'!A:D");
  const data = await fetch(origin + "/values/" + range + "?majorDimension=ROWS", {
    headers, cache: "no-store", signal: AbortSignal.timeout(9000),
  });
  if (!data.ok) throw new Error("Private Google Sheet data not readable");
  const content: unknown = JSON.parse(await readBoundedResponseText(data, 1_000_000));
  return parsePrivateStaffSheetRows(content);
}
