import test from "node:test";
import assert from "node:assert/strict";
import { payrollDb } from "../src/lib/server/payroll-db.ts";

// Synthetic config only. Do not connect to a live Supabase endpoint.
test("server client refuses implicit public production URL fallback", () => {
  const previous = {
    url: process.env.SUPABASE_URL,
    key: process.env.SUPABASE_SERVICE_ROLE_KEY,
    publicUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
  };
  try {
    delete process.env.SUPABASE_URL;
    process.env.SUPABASE_SERVICE_ROLE_KEY = "synthetic-test-only-key";
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://production-should-not-be-used.example";
    assert.throws(() => payrollDb(), /Server-only Supabase credentials/);
  } finally {
    if (previous.url === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = previous.url;
    if (previous.key === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = previous.key;
    if (previous.publicUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = previous.publicUrl;
  }
});

test("server client uses explicitly isolated Supabase URL only", () => {
  const prevUrl = process.env.SUPABASE_URL, prevKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  try {
    process.env.SUPABASE_URL = "https://synthetic-isolated-project.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "synthetic-test-only-key";
    assert.equal(payrollDb().supabaseUrl, "https://synthetic-isolated-project.supabase.co");
  } finally {
    if (prevUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = prevUrl;
    if (prevKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = prevKey;
  }
});
