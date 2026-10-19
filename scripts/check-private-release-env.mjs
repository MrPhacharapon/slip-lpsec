#!/usr/bin/env node
/**
 * Read-only release configuration check on an authorized private workstation.
 * This script neither connects to Supabase nor reads salaries.
 * It never prints secret values or service endpoint hostnames.
 */
const REQUIRED_SECRET_LENGTHS = {
  SUPABASE_SERVICE_ROLE_KEY: 30,
  ADMIN_SESSION_SECRET: 32,
  PAYROLL_RATE_LIMIT_SECRET: 32,
};
const REQUIRED_FIELDS = ["SUPABASE_URL", "APP_ORIGIN"];
const EXPECTED_PRODUCTION = "https://cpwefjcpqykpxdumgogo.supabase.co";
const EXPECTED_TEST = "https://dpaqvxtbpaduknergflm.supabase.co";

function validate(env) {
  const errors = [];
  for (const [key, length] of Object.entries(REQUIRED_SECRET_LENGTHS)) {
    if (!env[key] || env[key].length < length) errors.push(key);
  }
  for (const key of REQUIRED_FIELDS) {
    if (!env[key] || !env[key].trim()) errors.push(key);
  }
  const stage = env.PAYROLL_RELEASE_TARGET;
  // ADMIN_PASSWORD is only a synthetic/local Test fixture. Production
  // authenticates the user's existing short PIN from the private Settings tab.
  if (stage === "test" &&
      (!env.ADMIN_PASSWORD || env.ADMIN_PASSWORD.length < 12)) {
    errors.push("ADMIN_PASSWORD");
  }
  if (stage === "production") {
    for (const [key, minimum] of Object.entries({
      CRON_SECRET: 32, LINE_CHANNEL_SECRET: 20,
      LINE_CHANNEL_ACCESS_TOKEN: 20, LINE_GROUP_ID: 20,
    })) {
      if (!env[key] || env[key].length < minimum) errors.push(key);
    }
  }
  // Local CSV mode never accesses a public Google roster at runtime; Admin
  // selects a fresh private CSV for each upload. Server Sheet is the legacy
  // default, requiring the private server-only Sheet ID.
  const rosterMode = env.PAYROLL_ROSTER_MODE || "server_sheet";
  // Never silently rely on the legacy default during Production cutover:
  // the roster source is an explicit operator-selected privacy decision.
  if (!["server_sheet", "local_csv"].includes(rosterMode) ||
      (stage === "production" && !env.PAYROLL_ROSTER_MODE)) {
    errors.push("PAYROLL_ROSTER_MODE");
  }
  if (stage === "test") {
    if (env.STAFF_DIRECTORY_DISABLED !== "true") {
      errors.push("STAFF_DIRECTORY_DISABLED");
    }
  } else if (stage === "production") {
    if (rosterMode === "local_csv") {
      if (env.STAFF_DIRECTORY_DISABLED !== "true") errors.push("STAFF_DIRECTORY_DISABLED");
    } else {
      // Require explicit enabled flag; an omitted/typo flag is not proof
      // that the operator intentionally approved live Google Sheets reads.
      if (env.STAFF_DIRECTORY_DISABLED !== "false") errors.push("STAFF_DIRECTORY_DISABLED");
      if (!env.STAFF_SHEET_ID?.trim()) errors.push("STAFF_SHEET_ID");
      // The legacy source Sheet currently permits anyone-with-link reading.
      // A Production PASS requires authenticated Google Sheets API access.
      if (env.STAFF_SHEET_ACCESS_MODE !== "service_account") {
        errors.push("STAFF_SHEET_ACCESS_MODE");
      }
      if (!/^[^@\s]+@[^@\s]+\.iam\.gserviceaccount\.com$/.test(
        env.GOOGLE_SHEETS_SERVICE_ACCOUNT_EMAIL || ""
      )) errors.push("GOOGLE_SHEETS_SERVICE_ACCOUNT_EMAIL");
      if (!env.GOOGLE_SHEETS_SERVICE_ACCOUNT_PRIVATE_KEY?.includes(
        "-----BEGIN PRIVATE KEY-----"
      ) || !env.GOOGLE_SHEETS_SERVICE_ACCOUNT_PRIVATE_KEY?.includes(
        "-----END PRIVATE KEY-----"
      )) errors.push("GOOGLE_SHEETS_SERVICE_ACCOUNT_PRIVATE_KEY");
    }
  }
  if (!["production", "test"].includes(stage)) errors.push("PAYROLL_RELEASE_TARGET");
  if ((stage === "production" && env.SUPABASE_URL !== EXPECTED_PRODUCTION) ||
      (stage === "test" && env.SUPABASE_URL !== EXPECTED_TEST)) {
    errors.push("SUPABASE_URL_TARGET");
  }
  if (env.NEXT_PUBLIC_SUPABASE_URL &&
      env.NEXT_PUBLIC_SUPABASE_URL !== env.SUPABASE_URL) {
    errors.push("NEXT_PUBLIC_SUPABASE_URL_TARGET");
  }
  try {
    const origin = new URL(env.APP_ORIGIN);
    if (origin.protocol !== "https:" ||
        !origin.hostname || origin.pathname !== "/" ||
        origin.search || origin.hash ||
        origin.username || origin.password) errors.push("APP_ORIGIN");
  } catch { errors.push("APP_ORIGIN"); }
  if (env.STAFF_SHEET_ID && !/^[A-Za-z0-9_-]{20,100}$/.test(env.STAFF_SHEET_ID)) {
    errors.push("STAFF_SHEET_ID");
  }
  // NEXT_PUBLIC_* variables can be embedded into browser JavaScript at build time.
  // Reject even an accidentally duplicated server-only credential.
  const serverOnlyKeys = [
    ...Object.keys(REQUIRED_SECRET_LENGTHS),
    "ADMIN_PASSWORD",
    "CRON_SECRET", "LINE_CHANNEL_SECRET", "LINE_CHANNEL_ACCESS_TOKEN",
    "LINE_GROUP_ID", "STAFF_SHEET_ID",
    "GOOGLE_SHEETS_SERVICE_ACCOUNT_EMAIL", "GOOGLE_SHEETS_SERVICE_ACCOUNT_PRIVATE_KEY",
  ];
  for (const key of serverOnlyKeys) {
    const publicName = "NEXT_PUBLIC_" + key;
    if (Object.prototype.hasOwnProperty.call(env, publicName)) {
      errors.push(publicName);
    }
  }
  const secrets = [...Object.keys(REQUIRED_SECRET_LENGTHS),
    "ADMIN_PASSWORD", "CRON_SECRET", "LINE_CHANNEL_SECRET", "LINE_CHANNEL_ACCESS_TOKEN"]
    .map(key => env[key]).filter(Boolean);
  if (new Set(secrets).size !== secrets.length) errors.push("SECRET_REUSE");
  for (const key of ["SUPABASE_SERVICE_ROLE_KEY", "ADMIN_PASSWORD",
    "ADMIN_SESSION_SECRET", "PAYROLL_RATE_LIMIT_SECRET"]) {
    if (env[key] && env[key] === env.STAFF_SHEET_ID) errors.push("SECRET_REUSE");
  }
  return [...new Set(errors)];
}

if (process.argv.length !== 2) {
  process.stderr.write("FAIL: no arguments permitted\n");
  process.exitCode = 2;
} else {
  const violations = validate(process.env);
  // Key names are safe configuration metadata. Secret values and URLs
  // are never printed, even on failure.
  process.stdout.write(JSON.stringify({
    result: violations.length ? "NO_GO" : "PASS",
    checks: "release-environment",
    missingOrInvalid: violations,
  }) + "\n");
  if (violations.length) process.exitCode = 1;
}
