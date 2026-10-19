import test from "node:test";
import assert from "node:assert/strict";
import { startMockSupabase, setMockState } from "./mock-supabase-server.mjs";

const month = "เมษายน", year = "2598";
const account = i => String(9000000000 + i);
const syntheticRow = i => ({
  id: String(i + 1), name: "SYNTHETIC TEST ONLY",
  bank_account: account(i), month, year,
  pdf_base64: "JVBERi0xLjQK".repeat(20),
});

test("sandbox stage RPC rejects a 501st slip without changing the staged period", async () => {
  const server = await startMockSupabase();
  try {
    const state = {
      rows: Array.from({ length: 500 }, (_, i) => syntheticRow(i)),
      history: [],
    };
    setMockState(state);
    const endpoint = "http://127.0.0.1:3200/rest/v1/rpc/stage_payroll_slips";
    const request = { p_month: month, p_year: year, p_rows: [syntheticRow(500)] };
    const rejected = await fetch(endpoint, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });
    assert.equal(rejected.status, 400);
    assert.equal((await rejected.json()).code, "22023");
    assert.equal(state.rows.length, 500, "no write on invalid cumulative count");
    assert.equal(state.history.length, 0);

    state.rows.pop();
    const allowed = await fetch(endpoint, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });
    assert.equal(allowed.status, 200);
    assert.equal(await allowed.json(), 1);
    assert.equal(state.rows.length, 500);
    assert.equal(state.history.length, 0);
  } finally {
    await new Promise((resolve, reject) =>
      server.close(error => error ? reject(error) : resolve()));
  }
});
