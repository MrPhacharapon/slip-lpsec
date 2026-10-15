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
    if (!table && url.pathname !== "/rest/v1/rpc/check_payroll_rate_limit") {
      res.writeHead(404); res.end("{}"); return;
    }
    let payload = "";
    for await (const chunk of req) payload += chunk.toString();
    const headers = { "Content-Type": "application/json; charset=utf-8", "Content-Range": "*/*" };
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
