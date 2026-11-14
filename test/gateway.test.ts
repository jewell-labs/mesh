import assert from "node:assert/strict";
import { once } from "node:events";
import { request } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { createGateway } from "../src/gateway.ts";
import { readLinux } from "../src/host.ts";
import { CAPABILITY } from "../src/names.ts";

function texts(rx: number) {
  return {
    meminfo: "MemTotal:       1000 kB\nMemAvailable:   500 kB\n",
    loadavg: "0.10 0.10 0.10 1/1 1\n",
    swaps: "",
    netDev: `eth0: ${rx} 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0\n`,
  };
}

test("health is open and mcp without a grant is refused", async () => {
  const gateway = createGateway({
    async context() { return "context"; },
    host: { async read(previous) { return readLinux(texts(previous ? 50 : 10), previous); } },
    sleep: async () => {},
  });
  const server = await gateway.listen(0);
  const address = server.address() as AddressInfo;
  try {
    const health = await call(address.port, "GET", "/healthz");
    assert.equal(health.status, 200);
    assert.match(health.body, /"ok":true/);
    const denied = await call(address.port, "POST", "/mcp", "{}");
    assert.equal(denied.status, 403);
    const granted = await call(address.port, "POST", "/mcp", JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "test", version: "0" } },
    }), { "tailscale-app-capabilities": JSON.stringify({ [CAPABILITY]: [{ bot: "worker", roles: ["node"] }] }) });
    assert.notEqual(granted.status, 403);
  } finally {
    server.close();
    await once(server, "close");
  }
});

function call(port: number, method: string, path: string, body?: string, headers?: Record<string, string>): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request({ hostname: "127.0.0.1", port, method, path, headers: { ...headers, ...(body ? { "content-type": "application/json" } : {}) } }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}
