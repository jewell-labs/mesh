export interface Field<T> {
  readonly state: "ok" | "unavailable";
  readonly value?: T;
  readonly reason?: string;
}

export interface Bandwidth {
  readonly rxBytesPerSecond: number;
  readonly txBytesPerSecond: number;
}

export interface Reading {
  readonly memoryPercent: Field<number>;
  readonly swapPercent: Field<number>;
  readonly load1: Field<number>;
  readonly gpu: Field<string>;
  readonly bandwidth: Field<Bandwidth>;
  readonly powerW: Field<number>;
}

export interface NetCounters {
  readonly rxBytes: number;
  readonly txBytes: number;
}

export interface LinuxTexts {
  readonly meminfo: string;
  readonly loadavg: string;
  readonly swaps: string;
  readonly netDev: string;
  readonly gpu?: string;
  readonly powerW?: number;
}

function unavailable<T>(reason: string): Field<T> {
  return { state: "unavailable", reason };
}
const ok = <T>(value: T): Field<T> => ({ state: "ok", value });

function kib(text: string, key: string): number | undefined {
  const match = new RegExp(`^${key}:\\s+(\\d+)\\s+kB`, "m").exec(text);
  return match?.[1] === undefined ? undefined : Number(match[1]);
}

export function memoryPercent(meminfo: string): Field<number> {
  const total = kib(meminfo, "MemTotal");
  const available = kib(meminfo, "MemAvailable");
  if (total === undefined || available === undefined || total <= 0) return unavailable("memory counters missing");
  return ok(Math.round(((total - available) / total) * 1000) / 10);
}

export function load1(loadavg: string): Field<number> {
  const match = /^\s*([0-9]*\.?[0-9]+)/.exec(loadavg);
  if (match?.[1] === undefined) return unavailable("load average missing");
  return ok(Number(match[1]));
}

export function swapPercent(swaps: string): Field<number> {
  const rows = swaps.split("\n").map((line) => line.trim()).filter((line) => line.length > 0 && !line.startsWith("Filename"));
  let size = 0;
  let used = 0;
  for (const row of rows) {
    const parts = row.split(/\s+/);
    const rowSize = Number(parts[2]);
    const rowUsed = Number(parts[3]);
    if (!Number.isFinite(rowSize) || !Number.isFinite(rowUsed)) continue;
    size += rowSize;
    used += rowUsed;
  }
  if (size <= 0) return unavailable("no swap");
  return ok(Math.round((used / size) * 1000) / 10);
}

/** Sum every interface except loopback. Columns are rx bytes then tx bytes. */
export function netCounters(netDev: string): NetCounters {
  let rxBytes = 0;
  let txBytes = 0;
  for (const line of netDev.split("\n")) {
    const split = line.split(":");
    if (split.length !== 2) continue;
    const name = split[0]?.trim();
    if (name === undefined || name === "lo" || name.startsWith("Inter") || name.startsWith("face")) continue;
    const cols = split[1]?.trim().split(/\s+/) ?? [];
    const rx = Number(cols[0]);
    const tx = Number(cols[8]);
    if (Number.isFinite(rx)) rxBytes += rx;
    if (Number.isFinite(tx)) txBytes += tx;
  }
  return { rxBytes, txBytes };
}

export function bandwidth(previous: NetCounters | null, current: NetCounters, seconds: number): Field<Bandwidth> {
  if (previous === null || seconds <= 0) return unavailable("need a second sample");
  return ok({
    rxBytesPerSecond: Math.max(0, Math.round((current.rxBytes - previous.rxBytes) / seconds)),
    txBytesPerSecond: Math.max(0, Math.round((current.txBytes - previous.txBytes) / seconds)),
  });
}

export function readLinux(texts: LinuxTexts, previous: NetCounters | null, seconds = 1): { reading: Reading; net: NetCounters } {
  const net = netCounters(texts.netDev);
  const reading: Reading = {
    memoryPercent: memoryPercent(texts.meminfo),
    swapPercent: swapPercent(texts.swaps),
    load1: load1(texts.loadavg),
    gpu: texts.gpu !== undefined && texts.gpu.trim() !== "" ? ok(texts.gpu.trim()) : unavailable("no gpu source"),
    bandwidth: bandwidth(previous, net, seconds),
    powerW: texts.powerW !== undefined ? ok(texts.powerW) : unavailable("no unprivileged power source"),
  };
  return { reading, net };
}

export interface HostSource {
  read(previous: NetCounters | null): Promise<{ reading: Reading; net: NetCounters }>;
}

export async function collect(source: HostSource, seconds: number, sleep: (ms: number) => Promise<void>): Promise<Reading[]> {
  const count = Math.min(60, Math.max(1, Math.floor(seconds)));
  const readings: Reading[] = [];
  let previous: NetCounters | null = null;
  for (let index = 0; index < count; index += 1) {
    if (index > 0) await sleep(1000);
    const sample = await source.read(previous);
    previous = sample.net;
    readings.push(sample.reading);
  }
  return readings;
}
