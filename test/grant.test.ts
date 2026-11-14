import assert from "node:assert/strict";
import { test } from "node:test";
import { allowedTools, parseGrant } from "../src/grant.ts";
import { CAPABILITY } from "../src/names.ts";

const header = (body: unknown) => JSON.stringify({ [CAPABILITY]: body });

test("missing or two bots is no grant", () => {
  assert.equal(parseGrant(undefined, CAPABILITY), null);
  assert.equal(parseGrant("{}", CAPABILITY), null);
  assert.equal(parseGrant(header([{ bot: "a", tools: [] }, { bot: "b", tools: [] }]), CAPABILITY), null);
});

test("role node unlocks the tools and a wildcard does not", () => {
  const role = parseGrant(header([{ bot: "worker", roles: ["node"] }]), CAPABILITY);
  assert.ok(role);
  assert.deepEqual(allowedTools(role), ["setup", "ping", "host", "models", "chat", "decide", "logs"]);
  const wildcard = parseGrant(header([{ bot: "worker", tools: ["*"] }]), CAPABILITY);
  assert.ok(wildcard);
  assert.deepEqual(allowedTools(wildcard), []);
  const named = parseGrant(header([{ bot: "worker", tools: ["ping", "host"] }]), CAPABILITY);
  assert.ok(named);
  assert.deepEqual(allowedTools(named), ["ping", "host"]);
});
