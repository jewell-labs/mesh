#!/usr/bin/env node
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface Hit {
  readonly file: string;
  readonly line: number;
  readonly rule: string;
}

const SKIP = new Set(["node_modules", ".git"]);

function rules(): { name: string; test: (line: string) => boolean }[] {
  const home = ["", "Users", "studio"].join("/");
  const journal = ["studio", "reset"].join("-");
  const other = ["flag", "seeker"].join("");
  const magic = [".ts", "net"].join(".");
  const stripe = ["acct", "_"].join("");
  const email = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
  const ref = ["op", ":/", "/"].join("");
  const allowedRef = `${ref}Mesh/`;
  return [
    { name: "home", test: (line) => line.includes(home) },
    { name: "journal", test: (line) => line.toLowerCase().includes(journal) },
    { name: "other-product", test: (line) => line.toLowerCase().includes(other) },
    { name: "magicdns", test: (line) => line.toLowerCase().includes(magic) },
    { name: "stripe-account", test: (line) => line.includes(stripe) },
    { name: "email", test: (line) => email.test(line) },
    { name: "secret-ref", test: (line) => line.includes(ref) && !line.includes(allowedRef) },
  ];
}

export function scanText(file: string, text: string): Hit[] {
  const hits: Hit[] = [];
  const lines = text.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    for (const rule of rules()) {
      if (rule.test(line)) hits.push({ file, line: index + 1, rule: rule.name });
    }
  }
  return hits;
}

export async function scanDir(root: string): Promise<Hit[]> {
  const hits: Hit[] = [];
  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (SKIP.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
        continue;
      }
      if (!entry.isFile()) continue;
      const text = await readFile(full, "utf8");
      hits.push(...scanText(path.relative(root, full), text));
    }
  }
  await walk(root);
  return hits;
}

export function packageRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}

async function main(): Promise<void> {
  const hits = await scanDir(packageRoot());
  if (hits.length === 0) {
    process.stdout.write("scan ok\n");
    return;
  }
  for (const hit of hits) process.stderr.write(`${hit.file}:${hit.line} ${hit.rule}\n`);
  process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : "scan failed"}\n`);
    process.exitCode = 1;
  });
}
