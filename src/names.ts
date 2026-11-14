/** Public names. No product prefix on tools. */
export const CAPABILITY = "jewell-labs.com/cap/node";
export const TAG = "tag:node";
export const AUTHKEY_REF = "op://Mesh/authkey/credential";
export const TOOLS = ["setup", "ping", "host", "models", "chat", "decide", "evals", "logs"] as const;
export type ToolName = (typeof TOOLS)[number];

export function machineHostname(raw: string): string {
  const cleaned = raw.toLowerCase().replace(/[^a-z0-9-]/g, "").replace(/^-+|-+$/g, "").slice(0, 32);
  return cleaned.length > 0 ? cleaned : "node";
}
