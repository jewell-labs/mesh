# mesh

Set up a Tailscale mesh on a computer, then hand an agent one tool that explains the machine.

```sh
mesh setup --fixture
mesh serve
```

`mesh setup` is the same command everywhere. In a container or VM it expects `OP_SERVICE_ACCOUNT_TOKEN` and reads `op://Mesh/authkey/credential`. It does not prompt and it does not use sudo. `--fixture` writes the agent context without joining a tailnet, for a dry run.

On the Grok Bot the join is the Tailscale consent click in chat. The plugin cannot take an auth key and the node stays untagged. After that, the agent calls `setup`.

The gateway listens on `127.0.0.1` only. Tailscale Serve publishes it. Funnel stays off.

## Tools

| Tool | What it does |
|---|---|
| `setup` | Context, probes, and limits. Read-only. Does not join the tailnet. |
| `ping` | Caller id and allowed tools. |
| `host` | One sample per second: memory, swap, load, GPU, bandwidth, power. A missing source is `unavailable`. |
| `models` | Chat and decision models configured here. |
| `chat` | One local completion, or `unavailable`. |
| `decide` | One local decision, or `unavailable`. |
| `logs` | This node's call log. `summary: true` counts instead of listing rows. |

A missing model is a finished setup. Weights are not downloaded.

## Support

A cell is tested only when `docs/evidence/` has a redacted run. Everything else is not tested.

| Environment | join | mcp | host | chat | decide | model-runs-setup |
|---|---|---|---|---|---|---|
| Mac Studio Linux container | not tested | not tested | not tested | not tested | not tested | not tested |
| Mac Studio macOS VM | not tested | not tested | not tested | not tested | not tested | not tested |
| MacBook Pro Linux container | not tested | not tested | not tested | not tested | not tested | not tested |
| MacBook Pro macOS VM | not tested | not tested | not tested | not tested | not tested | not tested |
| Grok Bot plugin | not tested | not tested | not tested | not tested | not tested | not tested |

Supported means the setup contract is the same. It does not mean the cell has passed.

## Layout

| Path | What |
|---|---|
| `src/` | CLI, grant check, host sample, setup |
| `deployments/example/` | Placeholder bot, role, and grant |
| `docs/evidence/` | Redacted runs. Empty until a cell passes. |

Check the tree with `npm test`, `npm run check`, and `npm run scan`.
