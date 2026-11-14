import assert from "node:assert/strict";
import { test } from "node:test";
import { packageRoot, scanDir, scanText } from "../src/scan.ts";

test("scanner flags private material and allows the documented secret reference", () => {
  const email = ["owner", "example.com"].join("@");
  const magic = ["node", ["ts", "net"].join(".")].join(".");
  const stripe = ["acct", "123"].join("_");
  const other = ["flag", "seeker"].join("");
  const journal = ["studio", "reset"].join("-");
  const badRef = ["op", ":/", "/", "Other/item"].join("");
  const hits = scanText("sample", [email, magic, stripe, other, journal, badRef, "op://Mesh/authkey/credential"].join("\n"));
  const rules = new Set(hits.map((hit) => hit.rule));
  assert.equal(rules.has("email"), true);
  assert.equal(rules.has("magicdns"), true);
  assert.equal(rules.has("stripe-account"), true);
  assert.equal(rules.has("other-product"), true);
  assert.equal(rules.has("journal"), true);
  assert.equal(rules.has("secret-ref"), true);
  const allowed = scanText("sample", "op://Mesh/authkey/credential\nMac Studio Linux container\n");
  assert.deepEqual(allowed, []);
});

test("this tree has no private material", async () => {
  const hits = await scanDir(packageRoot());
  assert.deepEqual(hits, []);
});
