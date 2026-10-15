/** Test-only HTTP mock for server->Supabase requests. Never runs in the app. */
import { createServer } from "node:http";

let current = { rows: [], history: [] };
let rateBuckets = new Map();
export function setMockState(next) { current = next; rateBuckets = new Map(); }

function filterRows(values, params) {
  let rows = values.slice();
  for (const [key, raw] of params.entries()) {
    if (["select", "order", "limit", "offset"].includes(key)) continue;
    if (!raw.startsWith("eq.")) continue;
    const expected = raw.slice(3);
    rows = rows.filter(row => String(row[key]) === expected);
  }
  const order = params.get("order");
  if (order?.includes("created_at.desc")) rows.sort((a,b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")));
  const limit = Number(params.get("limit"));
  if (Number.isInteger(limit) && limit > 0) rows = rows.slice(0, limit);
  const projection = params.get("select");
  if (projection && projection !== "*") {
    const keys = projection.split(",");
    rows = rows.map(row => Object.fromEntries(keys.map(k => [k,row[k]])));
  }
  return rows;
}
export async function startMockSupabase() {
  const server = createServer(async (req,res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const table = url.pathname === "/rest/v1/slips" ? "rows" :
      url.pathname === "/rest/v1/upload_history" ? "history" : null;
    const isPayrollRpc = [
      "/rest/v1/rpc/stage_payroll_slips",
      "/rest/v1/rpc/publish_payroll_period",
    ].includes(url.pathname);
    if (!table && !isPayrollRpc && url.pathname !== "/rest/v1/rpc/check_payroll_rate_limit") {
      res.writeHead(404); res.end("{}"); return;
    }
    let payload = "";
    for await (const chunk of req) payload += chunk.toString();
    const headers = { "Content-Type": "application/json; charset=utf-8", "Content-Range": "*/*" };
    if (isPayrollRpc) {
      const fail = (status, code, message) => {
        res.writeHead(status, headers);
        res.end(JSON.stringify({ code, message }));
      };
      if (req.method !== "POST") { fail(405, "405", "POST required"); return; }
      try {
        const args = JSON.parse(payload);
        const month = args.p_month, year = args.p_year;
        const exists = current.history.some(r => r.month === month && r.year === year);
        if (exists) { fail(409, "23505", "period published"); return; }
        if (url.pathname.endsWith("/stage_payroll_slips")) {
          const rows = args.p_rows;
          if (!Array.isArray(rows) || rows.length < 1 || rows.length > 8 ||
              rows.some(r => r.month !== month || r.year !== year || !/^\d{10}$/.test(r.bank_account))) {
            fail(400, "22023", "invalid rows"); return;
          }
          const keys = new Set(current.rows.map(r => r.bank_account + ":" + r.month + ":" + r.year));
          if (rows.some(r => keys.has(r.bank_account + ":" + month + ":" + year)) ||
              new Set(rows.map(r => r.bank_account)).size !== rows.length) {
            fail(409, "23505", "duplicate person"); return;
          }
          for (const row of rows) current.rows.push({ ...row, id: String(current.rows.length + 1) });
          res.writeHead(200, headers); res.end(JSON.stringify(rows.length));
        } else {
          const count = args.p_expected_count;
          const rows = current.rows.filter(r => r.month === month && r.year === year);
          if (!Number.isInteger(count) || count < 1 || count > 500 ||
              rows.length !== count || new Set(rows.map(r => r.bank_account)).size !== count) {
            fail(400, "22023", "count mismatch"); return;
          }
          current.history.push({
            id: String(current.history.length + 1),
            month, year, file_name: args.p_file_name, storage_path: null,
            created_at: new Date().toISOString(),
          });
          res.writeHead(200, headers); res.end("true");
        }
      } catch (error) {
        fail(500, "MOCK_RPC_ERROR", String(error));
      }
      return;
    }
    if (url.pathname === "/rest/v1/rpc/check_payroll_rate_limit") {
      if (current.rateLimiterUnavailable) {
        res.writeHead(503, headers);
        res.end(JSON.stringify({ code: "MOCK_DB_DOWN", message: "Synthetic rate-limiter unavailable" }));
        return;
      }
      try {
        if (req.method !== "POST") { res.writeHead(405, headers); res.end("{}"); return; }
        const { p_key_hash, p_window_seconds, p_max_requests } = JSON.parse(payload);
        if (!/^[a-f0-9]{64}$/.test(p_key_hash) || p_window_seconds !== 600 ||
            !Number.isInteger(p_max_requests) || p_max_requests < 1) {
          res.writeHead(400, headers); res.end("false"); return;
        }
        const bucket = Math.floor(Date.now() / (p_window_seconds * 1000));
        const id = p_key_hash + ":" + bucket;
        const count = (rateBuckets.get(id) || 0) + 1;
        rateBuckets.set(id, count);
        res.writeHead(200, headers); res.end(JSON.stringify(count <= p_max_requests));
      } catch {
        res.writeHead(500, headers); res.end("{}");
      }
      return;
    }
    let code = 200, result = [];
    try {
      if (req.method === "GET") {
        result = filterRows(current[table], url.searchParams);
      } else if (req.method === "POST") {
        const input = JSON.parse(payload);
        const rows = Array.isArray(input) ? input : [input];
        for (const row of rows) {
          if (table === "history") {
            row.id = String(current.history.length + 1);
            row.created_at = new Date().toISOString();
          }
          if (table === "rows") {
            row.id = String(current.rows.length + 1);
          }
        }
        current[table].push(...rows);
        code = 201;
        result = rows;
      } else if (req.method === "PATCH") {
        const patch = JSON.parse(payload);
        for (const row of current[table]) {
          if (filterRows([row],url.searchParams).length) Object.assign(row, patch);
        }
      } else if (req.method === "DELETE") {
        current[table] = current[table].filter(row => !filterRows([row],url.searchParams).length);
      } else { code = 405; }
      res.writeHead(code, headers);
      res.end(JSON.stringify(result));
    } catch (error) {
      res.writeHead(500, headers);
      res.end(JSON.stringify({ error: String(error) }));
    }
  });
  await new Promise((resolve,reject) => {
    server.once("error",reject);
    server.listen(3200,"127.0.0.1",resolve);
  });
  return server;
}
