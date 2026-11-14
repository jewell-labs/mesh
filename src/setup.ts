import { AUTHKEY_REF, TAG, TOOLS, machineHostname } from "./names.ts";
import { renderContext, type NodeFacts, type Probe } from "./context.ts";

export interface CommandResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface SetupEnv {
  readSecret(ref: string): Promise<string>;
  run(argv: readonly string[]): Promise<CommandResult>;
  writeFile(path: string, body: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  hostname(): string;
  facts(): Promise<Pick<NodeFacts, "os" | "arch" | "kind" | "userspace">>;
}

export interface SetupRequest {
  readonly stateDir: string;
  readonly port: number;
  readonly fixture: boolean;
}

export interface SetupResult {
  readonly changed: boolean;
  readonly context: string;
  readonly commands: readonly (readonly string[])[];
  readonly ok: boolean;
}

export function joinCommands(input: { hostname: string; stateDir: string; socket: string; port: number }): string[][] {
  return [
    ["tailscaled", "--tun=userspace-networking", `--statedir=${input.stateDir}`, `--socket=${input.socket}`],
    ["tailscale", `--socket=${input.socket}`, "up", "--auth-key=REDACTED", `--hostname=${input.hostname}`, `--advertise-tags=${TAG}`, "--accept-dns=false"],
    ["tailscale", `--socket=${input.socket}`, "serve", "--bg", `http://127.0.0.1:${input.port}`],
  ];
}

export function assertNoSudo(commands: readonly (readonly string[])[]): void {
  for (const argv of commands) {
    if (argv.some((arg) => arg === "sudo" || arg.startsWith("sudo "))) throw new Error("setup does not use sudo");
  }
}

export async function runSetup(env: SetupEnv, request: SetupRequest): Promise<SetupResult> {
  const hostname = machineHostname(env.hostname());
  const socket = `${request.stateDir}/tailscaled.sock`;
  const commands = joinCommands({ hostname, stateDir: request.stateDir, socket, port: request.port });
  assertNoSudo(commands);
  const marker = `${request.stateDir}/ready`;
  if (await env.exists(marker)) {
    const facts = await env.facts();
    const context = renderContext({ ...facts, hostname, probes: readyProbes(request.fixture), tools: [...TOOLS] });
    return { changed: false, context, commands: [], ok: true };
  }

  const probes: Probe[] = [];
  if (!request.fixture) {
    const secret = await env.readSecret(AUTHKEY_REF);
    if (secret.trim() === "") throw new Error("auth key is empty");
    for (const argv of commands) {
      const live = argv.map((arg) => (arg === "--auth-key=REDACTED" ? `--auth-key=${secret}` : arg));
      const result = await env.run(live);
      probes.push({
        id: argv[0] ?? "command",
        ok: result.code === 0,
        detail: result.code === 0 ? "exited 0" : `exit ${result.code}`,
      });
      if (result.code !== 0) {
        const facts = await env.facts();
        const context = renderContext({ ...facts, hostname, probes, tools: [...TOOLS] });
        await env.writeFile(`${request.stateDir}/context.md`, context);
        return { changed: true, context, commands, ok: false };
      }
    }
  } else {
    probes.push({ id: "fixture", ok: true, detail: "no tailnet join in fixture mode" });
  }

  const facts = await env.facts();
  const context = renderContext({ ...facts, hostname, probes, tools: [...TOOLS] });
  await env.writeFile(`${request.stateDir}/context.md`, context);
  await env.writeFile(marker, "ok\n");
  return { changed: true, context, commands: request.fixture ? [] : commands, ok: true };
}

function readyProbes(fixture: boolean): Probe[] {
  return [{ id: fixture ? "fixture" : "ready", ok: true, detail: "already set up" }];
}
