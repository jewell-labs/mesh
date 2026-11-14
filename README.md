# mesh

Set up a Tailscale mesh on a computer, then hand an agent one tool that explains the machine.

```sh
mesh setup
mesh serve
```

`mesh setup` is the same command everywhere. In a container or VM it expects `OP_SERVICE_ACCOUNT_TOKEN` and reads `op://Mesh/authkey/credential`. It does not prompt and it does not use sudo. `--fixture` writes the agent context without joining a tailnet, for a dry run.

On the Grok Bot the join is the Tailscale consent click in chat. The plugin cannot take an auth key and the node stays untagged. After that, the agent calls `setup`.

The gateway listens on `127.0.0.1` only. Tailscale Serve publishes it. Funnel stays off.

## Validate

Validation is one MCP call, after setup and install. There is no test suite.

1. `mesh setup` joins and writes context.
2. `mesh serve` listens on loopback.
3. The agent calls `setup`, then calls `evals` last.

`evals` sends each task to the chat model already running on this computer. A decision model then decides whether that completion is satisfactory. A task is accepted when the decision's noul probability is at least 0.8. The whole eval is satisfactory only when every task is accepted.

Chat defaults to `http://127.0.0.1:8080` (`POST /v1/chat/completions`). Decisions default to `http://127.0.0.1:8082` (`POST /v1/systemone`). Both must be http on loopback.

```sh
mesh serve --chat http://127.0.0.1:8080 --decide http://127.0.0.1:8082
```

When one process serves both, pass `--decide-model ID` so the decision model is not treated as a chat model. Weights are not downloaded. A missing model leaves `evals` unavailable, and setup is still finished.

## Tools

| Tool | What it does |
|---|---|
| `setup` | Context, probes, and limits. Read-only. Does not join the tailnet. Call this first. |
| `ping` | Caller id and allowed tools. |
| `host` | One sample per second: memory, swap, load, GPU, bandwidth, power. A missing source is `unavailable`. |
| `models` | Chat and decision models configured here. |
| `chat` | One local completion, or `unavailable`. |
| `decide` | One local decision, or `unavailable`. |
| `evals` | Last step. Local chat completes the tasks. A local decision model accepts or rejects each one. |
| `logs` | This node's call log. `summary: true` counts instead of listing rows. |

## Support

A cell is `run` only when `docs/evidence/` has a redacted eval. Everything else is not run.

| Environment | join | mcp | evals |
|---|---|---|---|
| Mac Studio Linux container | not run | run | run |
| Mac Studio macOS VM | not run | run | run |
| MacBook Pro Linux container | not run | run | run |
| MacBook Pro macOS VM | not run | not run | not run |
| Grok Bot plugin | not run | not run | not run |

Supported means the setup contract is the same. It does not mean the cell has an eval on record.

## Layout

| Path | What |
|---|---|
| `src/` | CLI, grant check, host sample, evals, setup |
| `deployments/example/` | Placeholder bot, role, and grant |
| `docs/evidence/` | Redacted evals. Empty until a cell is run. |

`npm run check` typechecks. `npm run scan` rejects secrets and rejects adding a test suite. Neither one validates behavior.
