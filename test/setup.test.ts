import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { machineHostname } from "../src/names.ts";
import { assertNoSudo, joinCommands, runSetup, type SetupEnv } from "../src/setup.ts";

test("hostname keeps letters and digits", () => {
  assert.equal(machineHostname("Box_01.local"), "box01local");
  assert.equal(machineHostname("..."), "node");
});

test("join commands do not use sudo and redact the key", () => {
  const commands = joinCommands({ hostname: "box", stateDir: "/state", socket: "/state/tailscaled.sock", port: 8787 });
  assertNoSudo(commands);
  assert.equal(commands.some((argv) => argv.includes("sudo")), false);
  assert.equal(commands.some((argv) => argv.includes("--auth-key=REDACTED")), true);
  assert.equal(JSON.stringify(commands).includes(["ts", "net"].join(".")), false);
});

test("fixture setup writes context once and does not read a secret", async () => {
  const stateDir = await mkdtemp(path.join(tmpdir(), "mesh-"));
  let reads = 0;
  const files = new Map<string, string>();
  const env: SetupEnv = {
    async readSecret() { reads += 1; return "secret-value"; },
    async run() { throw new Error("fixture must not run commands"); },
    async writeFile(file, body) { files.set(file, body); },
    async exists(file) { return files.has(file); },
    hostname: () => "demo",
    async facts() { return { os: "linux", arch: "arm64", kind: "container", userspace: true }; },
  };
  const first = await runSetup(env, { stateDir, port: 8787, fixture: true });
  assert.equal(first.ok, true);
  assert.equal(first.changed, true);
  assert.equal(reads, 0);
  assert.equal(first.context.includes("secret-value"), false);
  assert.match(first.context, /Kind container/);
  const second = await runSetup(env, { stateDir, port: 8787, fixture: true });
  assert.equal(second.changed, false);
  const written = await readFile(path.join(stateDir, "context.md"), "utf8").catch(() => files.get(`${stateDir}/context.md`) ?? "");
  assert.match(written, /No shell tool/);
});
