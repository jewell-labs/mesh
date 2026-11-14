import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport, type StreamableHTTPServerTransportOptions } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { readingText, runEvals, type DecisionQuestion } from "./evals.ts";
import { allowedTools, parseGrant, type Grant } from "./grant.ts";
import { collect, type HostSource, type Reading } from "./host.ts";
import { CAPABILITY, TOOLS, type ToolName } from "./names.ts";

export interface GatewayDeps {
  readonly context: () => Promise<string>;
  readonly host: HostSource;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly ready?: () => Promise<boolean>;
  readonly models?: () => Promise<readonly { id: string; kind: "chat" | "decide"; present: boolean }[]>;
  readonly chat?: (input: { model: string; messages: readonly { role: string; content: string }[]; maxTokens?: number }) => Promise<string>;
  readonly decide?: (input: { model: string; state: string; questions: readonly DecisionQuestion[] }) => Promise<string>;
  readonly logs?: (summary: boolean) => Promise<string>;
}

export interface Gateway {
  handle(req: IncomingMessage, res: ServerResponse): Promise<void>;
  listen(port: number): Promise<Server>;
}

const text = (body: string) => ({ content: [{ type: "text" as const, text: body }] });

function headerValue(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw === undefined) return undefined;
  const cleaned = raw.replace(/[\r\n\0]/g, "").trim();
  return cleaned === "" ? undefined : cleaned.slice(0, 8000);
}

function can(grant: Grant, tool: ToolName): boolean {
  return allowedTools(grant).includes(tool);
}

function buildServer(grant: Grant, deps: GatewayDeps): McpServer {
  const server = new McpServer({ name: "node", version: "0.1.0" });
  const allow = allowedTools(grant);
  if (can(grant, "setup")) {
    server.registerTool("setup", {
      description: "Read this first. Context, probes, and limits for this computer. Does not join the tailnet. Call evals last.",
      annotations: { readOnlyHint: true },
    }, async () => text(await deps.context()));
  }
  if (can(grant, "ping")) {
    server.registerTool("ping", {
      description: "Who the gateway thinks you are, and which tools you may call.",
      annotations: { readOnlyHint: true },
    }, async () => text(JSON.stringify({ bot: grant.bot, tools: allow })));
  }
  if (can(grant, "host")) {
    server.registerTool("host", {
      description: "One sample per second of memory, swap, load, GPU, bandwidth, and power. A missing source is unavailable, not zero.",
      inputSchema: { seconds: z.number().int().min(1).max(60).default(5) },
      annotations: { readOnlyHint: true },
    }, async ({ seconds }) => {
      const sleep = deps.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
      const readings: Reading[] = await collect(deps.host, seconds, sleep);
      return text(JSON.stringify({ seconds: readings.length, readings }));
    });
  }
  if (can(grant, "models")) {
    server.registerTool("models", {
      description: "Chat and decision models configured on this computer.",
      annotations: { readOnlyHint: true },
    }, async () => text(JSON.stringify({ models: deps.models ? await deps.models() : [] })));
  }
  if (can(grant, "chat")) {
    server.registerTool("chat", {
      description: "One local chat completion. Unavailable when no chat runtime is configured.",
      inputSchema: {
        model: z.string().min(1),
        messages: z.array(z.object({ role: z.enum(["system", "user", "assistant"]), content: z.string() })).min(1).max(32),
        maxTokens: z.number().int().min(1).max(1024).default(512),
      },
    }, async (input) => {
      if (!deps.chat) return text(JSON.stringify({ state: "unavailable", reason: "no chat runtime" }));
      return text(await deps.chat(input));
    });
  }
  if (can(grant, "decide")) {
    server.registerTool("decide", {
      description: "One local decision. Unavailable when no decision runtime is configured.",
      inputSchema: {
        model: z.string().min(1),
        state: z.string().min(1).max(16384),
        questions: z.array(z.object({
          name: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),
          type: z.enum(["noul", "choice", "score"]),
          instructions: z.string().min(1).max(1024),
          criteria: z.array(z.string().min(1).max(80)).min(2).max(16).optional(),
        })).min(1).max(16),
      },
    }, async (input) => {
      if (!deps.decide) return text(JSON.stringify({ state: "unavailable", reason: "no decision runtime" }));
      const questions: DecisionQuestion[] = input.questions.map((question) => {
        const base = { name: question.name, type: question.type, instructions: question.instructions };
        return question.criteria === undefined ? base : { ...base, criteria: question.criteria };
      });
      return text(await deps.decide({ model: input.model, state: input.state, questions }));
    });
  }
  if (can(grant, "evals")) {
    server.registerTool("evals", {
      description: "Last step after setup. A local chat model completes each task. A local decision model decides if the work is satisfactory. Unavailable when setup has not finished or either model is missing.",
      inputSchema: {
        chatModel: z.string().min(1).max(256).optional(),
        decideModel: z.string().min(1).max(256).optional(),
      },
      annotations: { readOnlyHint: true },
    }, async ({ chatModel, decideModel }) => {
      if (deps.ready && !(await deps.ready())) return text(JSON.stringify({ state: "unavailable", reason: "setup has not finished" }));
      const models = deps.models ? await deps.models() : [];
      const chatId = chatModel ?? models.find((model) => model.kind === "chat" && model.present)?.id;
      const decideId = decideModel ?? models.find((model) => model.kind === "decide" && model.present)?.id;
      if (!chatId) return text(JSON.stringify({ state: "unavailable", reason: "no chat model" }));
      if (!decideId) return text(JSON.stringify({ state: "unavailable", reason: "no decision model" }));
      const chat = deps.chat;
      const decide = deps.decide;
      if (!chat || !decide) return text(JSON.stringify({ state: "unavailable", reason: "no model runtime" }));
      let host = "no reading";
      try {
        const sleep = deps.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
        host = readingText(await collect(deps.host, 1, sleep));
      } catch {
        host = "no reading";
      }
      const report = await runEvals({
        context: await deps.context(),
        host,
        chatModel: chatId,
        decideModel: decideId,
        chat,
        decide,
      });
      return text(JSON.stringify(report));
    });
  }
  if (can(grant, "logs")) {
    server.registerTool("logs", {
      description: "Call log for this node. Omit summary to list rows. Arguments are stored as a hash.",
      inputSchema: { summary: z.boolean().default(false) },
      annotations: { readOnlyHint: true },
    }, async ({ summary }) => text(deps.logs ? await deps.logs(summary) : JSON.stringify({ rows: [] })));
  }
  return server;
}

export function createGateway(deps: GatewayDeps): Gateway {
  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (req.method === "GET" && url.pathname === "/healthz") {
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify({ ok: true, tools: TOOLS }));
      return;
    }
    if (url.pathname !== "/mcp") {
      res.writeHead(404).end();
      return;
    }
    const grant = parseGrant(headerValue(req.headers["tailscale-app-capabilities"]), CAPABILITY);
    if (!grant) {
      res.writeHead(403, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify({ error: "no grant" }));
      return;
    }
    const server = buildServer(grant, deps);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined } as unknown as StreamableHTTPServerTransportOptions);
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res);
  }

  return {
    handle,
    listen(port: number): Promise<Server> {
      const server = createServer((req, res) => {
        void handle(req, res).catch(() => {
          if (!res.headersSent) res.writeHead(500).end();
        });
      });
      return new Promise((resolve) => {
        server.listen(port, "127.0.0.1", () => resolve(server));
      });
    },
  };
}
