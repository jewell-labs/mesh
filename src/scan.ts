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

function suiteName(name: string): boolean {
  const dir = ["te", "st"].join("");
  const tests = ["__", "tests", "__"].join("");
  const spec = [".spec.", "ts"].join("");
  const unit = [".", ["te", "st"].join(""), ".", "ts"].join("");
  return name === dir || name === tests || name.endsWith(spec) || name.endsWith(unit);
}

function rules(): { name: string; test: (file: string, line: string) => boolean }[] {
  const home = ["", "Users", "studio"].join("/");
  const journal = ["studio", "reset"].join("-");
  const other = ["flag", "seeker"].join("");
  const magic = [".ts", "net"].join(".");
  const stripe = ["acct", "_"].join("");
  const email = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
  const ref = ["op", ":/", "/"].join("");
  const allowedRef = `${ref}Mesh/`;
  const quotedScript = `"${["te", "st"].join("")}"`;
  const suiteImport = ["node:", ["te", "st"].join("")].join("");
  const suiteCmd = ["node --", ["te", "st"].join("")].join("");
  return [
    { name: "home", test: (_file, line) => line.includes(home) },
    { name: "journal", test: (_file, line) => line.toLowerCase().includes(journal) },
    { name: "other-product", test: (_file, line) => line.toLowerCase().includes(other) },
    { name: "magicdns", test: (_file, line) => line.toLowerCase().includes(magic) },
    { name: "stripe-account", test: (_file, line) => line.includes(stripe) },
    { name: "email", test: (_file, line) => email.test(line) },
    { name: "secret-ref", test: (_file, line) => line.includes(ref) && !line.includes(allowedRef) },
    { name: "suite", test: (file, line) => (file.endsWith("package.json") && line.includes(quotedScript) && line.includes(":")) || line.includes(suiteImport) || line.includes(suiteCmd) },
  ];
}

export function scanText(file: string, text: string): Hit[] {
  const hits: Hit[] = [];
  const lines = text.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    for (const rule of rules()) {
      if (rule.test(file, line)) hits.push({ file, line: index + 1, rule: rule.name });
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
      if (suiteName(entry.name)) {
        hits.push({ file: path.relative(root, full), line: 1, rule: "suite" });
        continue;
      }
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
