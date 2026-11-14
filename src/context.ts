export interface Probe {
  readonly id: string;
  readonly ok: boolean;
  readonly detail: string;
}

export interface NodeFacts {
  readonly os: string;
  readonly arch: string;
  readonly kind: "container" | "vm" | "plugin";
  readonly userspace: boolean;
  readonly hostname: string;
  readonly probes: readonly Probe[];
  readonly tools: readonly string[];
}

/** Text an agent gets from `setup`. It never includes a secret or an account id. */
export function renderContext(facts: NodeFacts): string {
  const probes = facts.probes.map((probe) => `- ${probe.id}: ${probe.ok ? "ok" : "not ready"} (${probe.detail})`).join("\n");
  const examples = [
    "setup",
    "ping",
    "host { seconds: 5 }",
    "models",
    "chat { model, messages }",
    "decide { model, state, questions }",
    "evals",
    "logs",
  ].join(", ");
  return [
    "# This computer",
    "",
    `Hostname ${facts.hostname}. ${facts.os} ${facts.arch}. Kind ${facts.kind}. Userspace networking ${facts.userspace ? "on" : "off"}.`,
    "",
    "Join with `mesh setup`. It does not prompt and it does not use sudo.",
    "",
    "## Probes",
    probes.length > 0 ? probes : "- none",
    "",
    "## Tools",
    facts.tools.join(", ") || "(none granted)",
    "",
    `Call setup first. Call evals last. Examples: ${examples}.`,
    "",
    "## Next",
    "Call evals. A local chat model completes each task. A local decision model decides whether the work is satisfactory. Weights are not downloaded. A missing model leaves evals unavailable, and setup is still finished.",
    "",
    "## Limits",
    "- No shell tool.",
    "- Funnel is off. The gateway listens on 127.0.0.1.",
    "- A missing model is a finished setup. Weights are not downloaded.",
    "- Power, GPU, or bandwidth is unavailable when this operating system cannot read it without extra privilege.",
    "- decide and evals are unavailable when no decision runtime is configured.",
    "- Validation is the evals tool. There is no test suite.",
    "- The plugin path shares one tailnet node across bots. A caller-supplied id is not a second identity.",
    "",
  ].join("\n");
}
