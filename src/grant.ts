// Identity comes from the tailnet. Tailscale Serve puts the grant in
// Tailscale-App-Capabilities and strips a client-supplied copy.
import { z } from "zod";
import { TOOLS, type ToolName } from "./names.ts";

const GrantEntry = z.object({
  bot: z.string().min(1),
  tools: z.array(z.string()).default([]),
  roles: z.array(z.string()).default([]),
});

export interface Grant {
  readonly bot: string;
  readonly tools: ReadonlySet<string>;
  readonly roles: ReadonlySet<string>;
}

/** The grant, or null when the header is absent, malformed, or names two bots. */
export function parseGrant(header: string | undefined, capability: string): Grant | null {
  if (header === undefined || header === "") return null;
  let json: unknown;
  try {
    json = JSON.parse(header);
  } catch {
    return null;
  }
  const entries = z.record(z.string(), z.array(z.unknown())).safeParse(json);
  const list = entries.success ? entries.data[capability] : undefined;
  if (list === undefined || list.length === 0) return null;
  const parsed = z.array(GrantEntry).safeParse(list);
  if (!parsed.success) return null;
  const bots = new Set(parsed.data.map((entry) => entry.bot));
  const [bot] = [...bots];
  if (bots.size !== 1 || bot === undefined) return null;
  return {
    bot,
    tools: new Set(parsed.data.flatMap((entry) => entry.tools)),
    roles: new Set(parsed.data.flatMap((entry) => entry.roles)),
  };
}

/** Role `node` unlocks the role tools. A wildcard does not. A named tool does. */
export function allowedTools(grant: Grant): ToolName[] {
  const named = new Set(grant.tools);
  const fromRole = grant.roles.has("node");
  return TOOLS.filter((tool) => fromRole || named.has(tool));
}
