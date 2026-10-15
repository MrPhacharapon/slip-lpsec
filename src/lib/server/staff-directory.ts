// Only return the matched public-roster row, never the whole CSV to the browser.
// This preserves the legacy staff-position badge when the Sheet is reachable.
// @ts-expect-error - papaparse has no bundled declarations in this project
import Papa from "papaparse";

export async function lookupStaffDirectory(account: string):
  Promise<{ name: string; position: string } | null> {
  // Prevent isolated environments from reading the production staff roster.
  if (process.env.STAFF_DIRECTORY_DISABLED === "true") return null;
  const sheetId = process.env.STAFF_SHEET_ID;
  if (!sheetId) return null;
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(sheetId)) return null;
  try {
    const url = "https://docs.google.com/spreadsheets/d/" + sheetId + "/export?format=csv&gid=0";
    const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(2500) });
    if (!response.ok) return null;
    const csv = await response.text();
    if (csv.length > 1_000_000) return null;
    const rows: string[][] = Papa.parse(csv, { skipEmptyLines: true }).data;
    const match = rows.find(row => String(row[2] ?? "").trim() === account);
    if (!match || !String(match[0] ?? "").trim()) return null;
    return { name: String(match[0]).trim(), position: String(match[1] ?? "").trim() };
  } catch { return null; }
}
