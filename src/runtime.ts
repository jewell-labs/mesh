import type { DecisionQuestion } from "./evals.ts";

export const DEFAULT_CHAT_URL = "http://127.0.0.1:8080";
export const DEFAULT_DECIDE_URL = "http://127.0.0.1:8082";

/** Accept only http on loopback, and return the base with no trailing slash. */
export function loopbackBase(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("model url is not a url");
  }
  const host = url.hostname;
  if (url.protocol !== "http:" || (host !== "127.0.0.1" && host !== "localhost" && host !== "::1")) {
    throw new Error("model servers must be http on loopback");
  }
  return url.toString().replace(/\/$/, "");
}

export interface RuntimeOptions {
  readonly chatURL: string;
  readonly decideURL: string;
  readonly decideModel?: string;
  readonly fetchImpl?: typeof fetch;
}

export interface ListedModel {
  readonly id: string;
  readonly kind: "chat" | "decide";
  readonly present: boolean;
}

function idsOf(body: unknown): string[] {
  if (!body || typeof body !== "object") return [];
  const record = body as { data?: unknown; models?: unknown };
  const list = Array.isArray(record.data) ? record.data : Array.isArray(record.models) ? record.models : [];
  const ids: string[] = [];
  for (const item of list) {
    if (typeof item === "string" && item.trim() !== "") ids.push(item.trim());
    else if (item && typeof item === "object" && "id" in item && typeof item.id === "string" && item.id.trim() !== "") ids.push(item.id.trim());
  }
  return ids;
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const part of content) {
    if (part && typeof part === "object" && "text" in part && typeof part.text === "string") parts.push(part.text);
  }
  return parts.join("").trim();
}

function contentOf(body: unknown): string {
  if (!body || typeof body !== "object") return "";
  const choices = (body as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return "";
  const first = choices[0];
  if (!first || typeof first !== "object") return "";
  const message = (first as { message?: unknown }).message;
  if (!message || typeof message !== "object") return "";
  return textOf((message as { content?: unknown }).content);
}

function questionBody(question: DecisionQuestion): Record<string, unknown> {
  if (question.type === "noul") return { type: "noul", instructions: question.instructions };
  const criteria = question.criteria ?? [];
  if (criteria.length < 2) throw new Error(`${question.type} needs at least two criteria`);
  if (question.type === "score") return { type: "score", instructions: question.instructions, criteria };
  const record: Record<string, string> = {};
  for (const item of criteria) record[item] = item;
  return { type: "choice", instructions: question.instructions, criteria: record };
}

async function readJSON(response: Response): Promise<unknown> {
  if (!response.ok) throw new Error(`model server returned ${response.status}`);
  const text = await response.text();
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error("model server returned non-json");
  }
}

export function createRuntime(options: RuntimeOptions): {
  models(): Promise<ListedModel[]>;
  chat(input: { model: string; messages: readonly { role: string; content: string }[]; maxTokens?: number }): Promise<string>;
  decide(input: { model: string; state: string; questions: readonly DecisionQuestion[] }): Promise<string>;
} {
  const chatURL = loopbackBase(options.chatURL);
  const decideURL = loopbackBase(options.decideURL);
  const fetchImpl = options.fetchImpl ?? fetch;
  const namedDecide = options.decideModel?.trim() ?? "";

  async function list(base: string): Promise<string[]> {
    const response = await fetchImpl(`${base}/v1/models`, { redirect: "error", signal: AbortSignal.timeout(3_000) });
    return idsOf(await readJSON(response));
  }

  return {
    async models() {
      const same = chatURL === decideURL;
      const [chatIds, listedDecide] = await Promise.all([
        list(chatURL).catch(() => [] as string[]),
        same ? Promise.resolve([] as string[]) : list(decideURL).catch(() => [] as string[]),
      ]);
      const decideIds = namedDecide !== "" && !listedDecide.includes(namedDecide) ? [...listedDecide, namedDecide] : listedDecide;
      const chat = chatIds.filter((id) => id !== namedDecide).map((id) => ({ id, kind: "chat" as const, present: true }));
      const decide = decideIds.map((id) => ({ id, kind: "decide" as const, present: true }));
      return [...chat, ...decide];
    },
    async chat(input) {
      const response = await fetchImpl(`${chatURL}/v1/chat/completions`, {
        method: "POST",
        redirect: "error",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: input.model,
          messages: input.messages,
          max_tokens: input.maxTokens ?? 512,
          temperature: 0,
          stream: false,
        }),
        signal: AbortSignal.timeout(180_000),
      });
      const content = contentOf(await readJSON(response));
      if (content === "") throw new Error("chat returned nothing");
      return content;
    },
    async decide(input) {
      const questions: Record<string, unknown> = {};
      for (const question of input.questions) questions[question.name] = questionBody(question);
      const response = await fetchImpl(`${decideURL}/v1/systemone`, {
        method: "POST",
        redirect: "error",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: input.model, state: input.state, questions, truncate: false }),
        signal: AbortSignal.timeout(180_000),
      });
      return JSON.stringify(await readJSON(response));
    },
  };
}
