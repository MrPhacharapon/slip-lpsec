/**
 * Validate Google Sheets API JSON before it can reach the roster parser.
 * No staff rows, Sheet IDs or upstream response fragments are included in errors.
 * This module is pure so isolated Node tests never call Google APIs.
 */
type SheetTab = { properties?: { sheetId?: unknown; title?: unknown } };

export function parsePrivateStaffSheetTitle(payload: unknown): string {
  const sheets = (payload as { sheets?: unknown } | null)?.sheets;
  if (!Array.isArray(sheets) || sheets.length > 1_000) {
    throw new Error("Missing Google Sheet tabs");
  }
  const rosterTabs = sheets.filter(
    (value: unknown) => value !== null && typeof value === "object" &&
      (value as SheetTab).properties?.sheetId === 0,
  ) as SheetTab[];
  if (rosterTabs.length !== 1) {
    throw new Error("Expected gid=0 staff roster tab not found");
  }
  const title = rosterTabs[0].properties?.title;
  if (typeof title !== "string" || !title.trim() || title.length > 200 ||
      /[\u0000-\u001f\u007f]/.test(title)) {
    throw new Error("Invalid gid=0 staff roster tab title");
  }
  return title;
}

export function parsePrivateStaffSheetRows(payload: unknown): string[][] {
  const values = (payload as { values?: unknown } | null)?.values;
  if (!Array.isArray(values) || values.length < 1 || values.length > 1_000 ||
      !values.every(row => Array.isArray(row) && row.length <= 4 &&
        row.every((cell: unknown) => typeof cell === "string"))) {
    throw new Error("Private Google Sheet row format is invalid");
  }
  return values as string[][];
}
