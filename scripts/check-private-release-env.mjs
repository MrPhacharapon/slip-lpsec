#!/usr/bin/env node
/**
 * Read-only release configuration check on an authorized private workstation.
 * This script neither connects to Supabase nor reads salaries.
 * It never prints secret values or service endpoint hostnames.
 */
const REQUIRED_SECRET_LENGTHS = {
  SUPABASE_SERVICE_ROLE_KEY: 30,
  ADMIN_PASSWORD: 12,
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
  if (stage === "production") {
    for (const key of ["CRON_SECRET", "LINE_CHANNEL_SECRET",
      "LINE_CHANNEL_ACCESS_TOKEN", "LINE_GROUP_ID"]) {
      if (!env[key] || env[key].length < 20) errors.push(key);
    }
  }
  // Production must never skip the staff directory. The isolated test
  // environment must never silently contact the actual staff sheet.
  if ((stage === "production" && env.STAFF_DIRECTORY_DISABLED === "true") ||
      (stage === "test" && env.STAFF_DIRECTORY_DISABLED !== "true")) {
    errors.push("STAFF_DIRECTORY_DISABLED");
  }
  if (stage !== "test" || env.STAFF_DIRECTORY_DISABLED !== "true") {
    if (!env.STAFF_SHEET_ID?.trim()) errors.push("STAFF_SHEET_ID");
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
  if (env.STAFF_SHEET_ID && !/^[a-zA-Z0-9_-]{15,}$/.test(env.STAFF_SHEET_ID)) {
    errors.push("STAFF_SHEET_ID");
  }
  const secrets = [...Object.keys(REQUIRED_SECRET_LENGTHS),
    "CRON_SECRET", "LINE_CHANNEL_SECRET", "LINE_CHANNEL_ACCESS_TOKEN"]
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
