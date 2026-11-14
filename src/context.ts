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
    "logs",
  ].join(", ");
  return [
    "# This computer",
    "",
    `Hostname ${facts.hostname}. ${facts.os} ${facts.arch}. Kind ${facts.kind}. Userspace networking ${facts.userspace ? "on" : "off"}.`,
    "",
    "## Probes",
    probes.length > 0 ? probes : "- none",
    "",
    "## Tools",
    facts.tools.join(", ") || "(none granted)",
    "",
    `Call setup first. Examples: ${examples}.`,
    "",
    "## Limits",
    "- No shell tool.",
    "- Funnel is off. The gateway listens on loopback.",
    "- A missing model is a finished setup. Weights are not downloaded.",
    "- Power, GPU, or bandwidth is unavailable when this operating system cannot read it without extra privilege.",
    "- decide is unavailable when no decision runtime is configured.",
    "- The plugin path shares one tailnet node across bots. A caller-supplied id is not a second identity.",
    "",
  ].join("\n");
}
