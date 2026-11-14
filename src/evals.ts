import type { Field, Reading } from "./host.ts";

/** A decision model accepts a task at or above this noul probability. */
export const SATISFIED_AT = 0.8;

export interface DecisionQuestion {
  readonly name: string;
  readonly type: "noul" | "choice" | "score";
  readonly instructions: string;
  readonly criteria?: readonly string[];
}

interface Task {
  readonly id: string;
  readonly task: string;
  readonly rubric: string;
  readonly includeHost: boolean;
}

const TASKS: readonly Task[] = [
  {
    id: "join",
    task: "Write the one setup command for an isolated container. It must run without a prompt and without sudo.",
    rubric: "The completion is one command, does not use sudo, and does not ask a person to type.",
    includeHost: false,
  },
  {
    id: "tools",
    task: "Name the first tool an agent calls after join, and the last tool, which runs the eval.",
    rubric: "The completion names setup as the first tool and evals as the last tool.",
    includeHost: false,
  },
  {
    id: "host",
    task: "Report memory percent, swap percent, and load from the reading. When a field is unavailable, say unavailable. Do not invent a number.",
    rubric: "The completion reports the reading and does not invent a number for an unavailable field.",
    includeHost: true,
  },
  {
    id: "isolate",
    task: "State where the gateway listens, whether Funnel is on, and whether a shell tool exists.",
    rubric: "The completion says the gateway listens on 127.0.0.1, Funnel is off, and there is no shell tool.",
    includeHost: false,
  },
];

export interface TaskResult {
  readonly id: string;
  readonly satisfied: boolean;
  readonly completion: string;
  readonly noul: number | null;
  readonly error: string | null;
}

export interface EvalReport {
  readonly state: "done";
  readonly chatModel: string;
  readonly decideModel: string;
  readonly bar: number;
  readonly satisfied: boolean;
  readonly tasks: readonly TaskResult[];
}

export interface EvalDeps {
  readonly context: string;
  readonly host: string;
  readonly chatModel: string;
  readonly decideModel: string;
  chat(input: { model: string; messages: readonly { role: "system" | "user"; content: string }[] }): Promise<string>;
  decide(input: { model: string; state: string; questions: readonly DecisionQuestion[] }): Promise<string>;
}

function show(field: { readonly state: Field<unknown>["state"]; readonly value?: unknown }): string {
  if (field.state !== "ok" || field.value === undefined) return "unavailable";
  if (typeof field.value === "number" || typeof field.value === "string") return String(field.value);
  return JSON.stringify(field.value);
}

export function readingText(readings: readonly Reading[]): string {
  const reading = readings[0];
  if (!reading) return "no reading";
  return [
    `memory ${show(reading.memoryPercent)}`,
    `swap ${show(reading.swapPercent)}`,
    `load ${show(reading.load1)}`,
    `gpu ${show(reading.gpu)}`,
    `bandwidth ${show(reading.bandwidth)}`,
    `power ${show(reading.powerW)}`,
  ].join(", ");
}

function readNoul(body: string): number | null {
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return null;
  }
  if (!json || typeof json !== "object") return null;
  const answers = (json as { answers?: unknown }).answers;
  if (!answers || typeof answers !== "object") return null;
  const row = (answers as { satisfied?: unknown }).satisfied;
  if (!row || typeof row !== "object") return null;
  const typed = row as { type?: unknown; noul?: unknown };
  if (typed.type !== "noul" || typeof typed.noul !== "number") return null;
  if (!Number.isFinite(typed.noul) || typed.noul < 0 || typed.noul > 1) return null;
  return typed.noul;
}

function clip(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max);
}

function failed(id: string, completion: string, error: string): TaskResult {
  return { id, satisfied: false, completion, noul: null, error: clip(error, 200) };
}

/** A local chat model completes each task. A local decision model accepts or rejects the work. */
export async function runEvals(deps: EvalDeps): Promise<EvalReport> {
  const tasks: TaskResult[] = [];
  const system = clip(
    `${deps.context}\nComplete the task. Do not use sudo. Do not ask a person to type. Do not invent a number for an unavailable reading.`,
    12000,
  );
  for (const task of TASKS) {
    const user = task.includeHost ? `${task.task}\n\nReading: ${deps.host}` : task.task;
    let completion = "";
    try {
      completion = (await deps.chat({
        model: deps.chatModel,
        messages: [
          { role: "system", content: system },
          { role: "user", content: clip(user, 4000) },
        ],
      })).trim();
    } catch (error) {
      tasks.push(failed(task.id, "", error instanceof Error ? error.message : "chat failed"));
      continue;
    }
    if (completion === "") {
      tasks.push(failed(task.id, "", "chat returned nothing"));
      continue;
    }
    const state = clip([
      `Task: ${task.task}`,
      task.includeHost ? `Reading: ${deps.host}` : "",
      `Completion:\n${clip(completion, 4000)}`,
    ].filter((line) => line !== "").join("\n\n"), 16000);
    let body = "";
    try {
      body = await deps.decide({
        model: deps.decideModel,
        state,
        questions: [{ name: "satisfied", type: "noul", instructions: task.rubric }],
      });
    } catch (error) {
      tasks.push(failed(task.id, clip(completion, 4000), error instanceof Error ? error.message : "decide failed"));
      continue;
    }
    const noul = readNoul(body);
    if (noul === null) {
      tasks.push(failed(task.id, clip(completion, 4000), "decision was not a noul probability"));
      continue;
    }
    tasks.push({
      id: task.id,
      satisfied: noul >= SATISFIED_AT,
      completion: clip(completion, 4000),
      noul,
      error: null,
    });
  }
  return {
    state: "done",
    chatModel: deps.chatModel,
    decideModel: deps.decideModel,
    bar: SATISFIED_AT,
    satisfied: tasks.length === TASKS.length && tasks.every((task) => task.satisfied),
    tasks,
  };
}
