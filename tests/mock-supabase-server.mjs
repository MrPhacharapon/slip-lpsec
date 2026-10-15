/** Test-only HTTP mock for server->Supabase requests. Never runs in the app. */
import { createServer } from "node:http";

let current = { rows: [], history: [] };
export function setMockState(next) { current = next; }

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
    if (!table) { res.writeHead(404); res.end("{}"); return; }
    let payload = "";
    for await (const chunk of req) payload += chunk.toString();
    const headers = { "Content-Type": "application/json; charset=utf-8", "Content-Range": "*/*" };
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
