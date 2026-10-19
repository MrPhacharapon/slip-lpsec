/**
 * Fail closed before any outbound request to a real Google staff directory.
 * Production operator must explicitly opt in to the same server-side Sheet
 * lookup for both Admin validation and staff name/position display.
 * Neither an omitted roster mode nor a missing disabled flag may imply access.
 * The Sheet ID is never embedded in a browser bundle or logged here.
 */
export function serverSheetRosterEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.PAYROLL_RELEASE_TARGET === "production" &&
    env.PAYROLL_ROSTER_MODE === "server_sheet" &&
    env.STAFF_DIRECTORY_DISABLED === "false";
}
