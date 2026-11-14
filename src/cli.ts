#!/usr/bin/env node
import { execFile } from "node:child_process";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderContext } from "./context.ts";
import { createGateway } from "./gateway.ts";
import { readLinux, type LinuxTexts, type NetCounters } from "./host.ts";
import { TOOLS } from "./names.ts";
import { DEFAULT_CHAT_URL, DEFAULT_DECIDE_URL, createRuntime, loopbackBase } from "./runtime.ts";
import { runSetup, type CommandResult, type SetupEnv } from "./setup.ts";

export interface CliIO {
  readonly argv: readonly string[];
  readonly stdout: (line: string) => void;
  readonly stderr: (line: string) => void;
  readonly setupEnv?: SetupEnv;
}

function flag(argv: readonly string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  if (index < 0) return undefined;
  return argv[index + 1];
}

function has(argv: readonly string[], name: string): boolean {
  return argv.includes(name);
}

async function readText(file: string): Promise<string> {
  try {
    return await readFile(file, "utf8");
  } catch {
    return "";
  }
}

function run(argv: readonly string[]): Promise<CommandResult> {
  const [file, ...args] = argv;
  if (file === undefined) return Promise.resolve({ code: 127, stdout: "", stderr: "missing command" });
  return new Promise((resolve) => {
    execFile(file, args, { timeout: 60_000 }, (error, stdout, stderr) => {
      const status = error && typeof error === "object" && "code" in error ? error.code : 0;
      const code = typeof status === "number" ? status : 1;
      resolve({ code: error && code === 0 ? 1 : code, stdout, stderr });
    });
  });
}

function liveEnv(): SetupEnv {
  return {
    readSecret(ref) {
      return new Promise((resolve, reject) => {
        execFile("op", ["read", ref], { timeout: 30_000 }, (error, stdout, stderr) => {
          if (error) reject(new Error((stderr || error.message).trim().slice(0, 200)));
          else resolve(stdout.trim());
        });
      });
    },
    run,
    async writeFile(file, body) {
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, body, { mode: 0o600 });
    },
    async exists(file) {
      try {
        await access(file);
        return true;
      } catch {
        return false;
      }
    },
    hostname: () => os.hostname(),
    async facts() {
      return { os: os.platform(), arch: os.arch(), kind: "container", userspace: true };
    },
  };
}

export async function runCli(io: CliIO): Promise<number> {
  const [command] = io.argv;
  if (command === "setup") {
    const stateDir = flag(io.argv, "--state-dir") ?? path.join(os.homedir(), ".local", "state", "mesh");
    const port = Number(flag(io.argv, "--port") ?? "8787");
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      io.stderr("port must be an integer from 1 to 65535\n");
      return 2;
    }
    await mkdir(stateDir, { recursive: true });
    const result = await runSetup(io.setupEnv ?? liveEnv(), { stateDir, port, fixture: has(io.argv, "--fixture") });
    io.stdout(result.context.endsWith("\n") ? result.context : `${result.context}\n`);
    return result.ok ? 0 : 1;
  }
  if (command === "serve") {
    const host = flag(io.argv, "--host") ?? "127.0.0.1";
    if (host !== "127.0.0.1") {
      io.stderr("serve binds 127.0.0.1 only\n");
      return 1;
    }
    const port = Number(flag(io.argv, "--port") ?? "8787");
    const stateDir = flag(io.argv, "--state-dir") ?? path.join(os.homedir(), ".local", "state", "mesh");
    let chatURL: string;
    let decideURL: string;
    try {
      chatURL = loopbackBase(flag(io.argv, "--chat") ?? DEFAULT_CHAT_URL);
      decideURL = loopbackBase(flag(io.argv, "--decide") ?? DEFAULT_DECIDE_URL);
    } catch (error) {
      io.stderr(`${error instanceof Error ? error.message : "bad model url"}\n`);
      return 1;
    }
    const decideModel = flag(io.argv, "--decide-model");
    const runtime = createRuntime({ chatURL, decideURL, ...(decideModel ? { decideModel } : {}) });
    const gateway = createGateway({
      context: async () => {
        const saved = await readText(path.join(stateDir, "context.md"));
        if (saved.trim() !== "") return saved;
        return renderContext({
          os: os.platform(),
          arch: os.arch(),
          kind: "container",
          userspace: true,
          hostname: os.hostname(),
          probes: [],
          tools: [...TOOLS],
        });
      },
      ready: async () => {
        try {
          await access(path.join(stateDir, "ready"));
          return true;
        } catch {
          return false;
        }
      },
      host: {
        async read(previous: NetCounters | null) {
          const texts: LinuxTexts = {
            meminfo: await readText("/proc/meminfo"),
            loadavg: await readText("/proc/loadavg"),
            swaps: await readText("/proc/swaps"),
            netDev: await readText("/proc/net/dev"),
          };
          return readLinux(texts, previous);
        },
      },
      models: () => runtime.models(),
      chat: (input) => runtime.chat(input),
      decide: (input) => runtime.decide(input),
    });
    await gateway.listen(port);
    io.stdout(`listening ${host}:${port}\n`);
    return 0;
  }
  io.stderr("usage: mesh setup [--fixture] [--state-dir DIR] [--port N]\n       mesh serve [--state-dir DIR] [--port N] [--chat URL] [--decide URL] [--decide-model ID]\n");
  return 2;
}

const entry = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (entry !== "" && fileURLToPath(import.meta.url) === entry) {
  runCli({
    argv: process.argv.slice(2),
    stdout: (line) => process.stdout.write(line),
    stderr: (line) => process.stderr.write(line),
  }).then((code) => {
    if (code !== 0) process.exitCode = code;
  }).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : "mesh failed"}\n`);
    process.exitCode = 1;
  });
}
