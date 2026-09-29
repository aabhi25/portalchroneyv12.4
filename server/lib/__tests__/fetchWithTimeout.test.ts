/**
 * fetchWithTimeout against a local, deliberately slow HTTP server.
 * Run manually: `npx tsx server/lib/__tests__/fetchWithTimeout.test.ts`
 */
import http from "http";
import type { AddressInfo } from "net";
import { fetchWithTimeout, isTimeoutError, DEFAULT_FETCH_TIMEOUT_MS } from "../fetchWithTimeout";

let failed = 0;
function expect(cond: any, label: string, detail?: unknown) {
  if (!cond) { failed++; console.error(`✗ ${label}${detail !== undefined ? ` — got: ${JSON.stringify(detail)}` : ''}`); } else { console.log(`✓ ${label}`); }
}

async function main() {
  const server = http.createServer((req, res) => {
    if (req.url === "/fast") { res.end("ok"); return; }
    if (req.url === "/slow-headers") { setTimeout(() => { if (!res.destroyed) res.end("late"); }, 3_000); return; }
    if (req.url === "/slow-body") {
      res.writeHead(200, { "content-type": "text/plain" });
      res.write("partial");
      setTimeout(() => { if (!res.destroyed) res.end("rest"); }, 3_000);
      return;
    }
    res.statusCode = 404; res.end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  expect(DEFAULT_FETCH_TIMEOUT_MS === 20_000, "default timeout is 20s");

  {
    const r = await fetchWithTimeout(`${base}/fast`, {}, 1_000);
    expect(r.ok && (await r.text()) === "ok", "fast response resolves normally");
  }
  {
    const t0 = Date.now();
    let err: any;
    try { await fetchWithTimeout(`${base}/slow-headers`, {}, 300); } catch (e) { err = e; }
    const elapsed = Date.now() - t0;
    expect(err && isTimeoutError(err), "slow server → rejects with TimeoutError", err?.name);
    expect(elapsed < 1_500, "aborts near the deadline, not when the server finally answers", elapsed);
  }
  {
    // The deadline also covers reading the body (downloads cannot hang forever).
    const t0 = Date.now();
    let err: any;
    try {
      const r = await fetchWithTimeout(`${base}/slow-body`, {}, 300);
      await r.text();
    } catch (e) { err = e; }
    expect(err && isTimeoutError(err), "stalled body read → TimeoutError", err?.name);
    expect(Date.now() - t0 < 1_500, "body stall aborted near the deadline");
  }
  {
    // A caller-supplied signal still works alongside the timeout.
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 100);
    let err: any;
    try { await fetchWithTimeout(`${base}/slow-headers`, { signal: ac.signal }, 5_000); } catch (e) { err = e; }
    expect(err && err.name === "AbortError", "caller's own AbortSignal is honoured", err?.name);
  }
  {
    // POST init (method/headers/body) is passed through untouched.
    const echo = http.createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => res.end(JSON.stringify({ method: req.method, ct: req.headers["content-type"], body })));
    });
    await new Promise<void>((r) => echo.listen(0, "127.0.0.1", r));
    const url = `http://127.0.0.1:${(echo.address() as AddressInfo).port}/`;
    const r = await fetchWithTimeout(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: '{"a":1}' });
    const j = await r.json();
    expect(j.method === "POST" && j.ct === "application/json" && j.body === '{"a":1}', "init is forwarded", j);
    echo.close();
  }

  server.closeAllConnections();
  server.close();
  if (failed) { console.error(`\n${failed} assertion(s) failed`); process.exit(1); }
  console.log("\nAll fetchWithTimeout tests passed");
}

main().catch((e) => { console.error(e); process.exit(1); });
