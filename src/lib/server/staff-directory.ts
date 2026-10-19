// Return only the current authorized person's display name and position;
// never return the raw Google roster, spreadsheet identifier, or credentials.
import { serverSheetRosterEnabled } from "./roster-config";
import { loadPrivateStaffSheetRows } from "./google-sheet-source";
import { rosterDisplayForAccount } from "@/lib/slip-validation";

export async function lookupStaffDirectory(account: string):
  Promise<{ name: string; position: string } | null> {
  if (!serverSheetRosterEnabled()) return null;
  try {
    return rosterDisplayForAccount(await loadPrivateStaffSheetRows(), account);
  } catch {
    return null;
  }
}
