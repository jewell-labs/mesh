# Security

Auth keys and service-account tokens stay in the environment or in 1Password. They are not committed.

`mesh setup` runs Tailscale in userspace mode. It does not call sudo. Containers should use an ephemeral, tagged, expiring auth key. VMs may use a reusable preauthorized key that is still tagged and expiring. The key is passed to `tailscale up` and is redacted from the command log and the agent context.

`mesh serve` binds `127.0.0.1` only. Put it on the tailnet with Tailscale Serve, which strips a client-supplied capability header. Do not turn on Funnel. Do not add a shell tool.

The Grok plugin node stays untagged. Tagging it makes the plugin report not connected. Every bot on that computer shares one node, so the gateway treats them as one caller.

`npm run scan` fails the build when a file contains an email address, a MagicDNS name, a Stripe account id, a home path for a private host, or an `op://` reference outside `op://Mesh/`.
