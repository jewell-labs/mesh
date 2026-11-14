import assert from "node:assert/strict";
import { test } from "node:test";
import { collect, readLinux, type HostSource } from "../src/host.ts";

const meminfo = "MemTotal:       100000 kB\nMemAvailable:   25000 kB\n";
const loadavg = "1.50 1.00 0.50 1/10 9\n";
const swaps = "Filename\tType\tSize\tUsed\tPriority\n/swap file 1000 250 -2\n";
const net = "Inter-|   Receive                                                |  Transmit\n face |bytes packets\n    lo: 9 0 0 0 0 0 0 0 9 0 0 0 0 0 0 0\n  eth0: 1000 0 0 0 0 0 0 0 4000 0 0 0 0 0 0 0\n";

test("linux readers report memory, swap, and load, and omit power", () => {
  const first = readLinux({ meminfo, loadavg, swaps, netDev: net }, null);
  assert.equal(first.reading.memoryPercent.state, "ok");
  assert.equal(first.reading.memoryPercent.value, 75);
  assert.equal(first.reading.swapPercent.value, 25);
  assert.equal(first.reading.load1.value, 1.5);
  assert.equal(first.reading.powerW.state, "unavailable");
  assert.equal(first.reading.gpu.state, "unavailable");
  assert.equal(first.reading.bandwidth.state, "unavailable");
  assert.equal(first.net.rxBytes, 1000);
  assert.equal(first.net.txBytes, 4000);
});

test("bandwidth is the delta per second and skips loopback", () => {
  const previous = { rxBytes: 1000, txBytes: 4000 };
  const nextNet = net.replace("eth0: 1000", "eth0: 3000").replace("0 0 4000", "0 0 5000");
  const second = readLinux({ meminfo, loadavg, swaps, netDev: nextNet }, previous, 1);
  assert.equal(second.reading.bandwidth.value?.rxBytesPerSecond, 2000);
  assert.equal(second.reading.bandwidth.value?.txBytesPerSecond, 1000);
});

test("collect waits between samples", async () => {
  let calls = 0;
  const source: HostSource = {
    async read(previous) {
      calls += 1;
      const net = { rxBytes: calls * 100, txBytes: 0 };
      const sample = readLinux({
        meminfo, loadavg, swaps,
        netDev: `eth0: ${net.rxBytes} 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0\n`,
      }, previous, 1);
      return sample;
    },
  };
  const waits: number[] = [];
  const readings = await collect(source, 2, async (ms) => { waits.push(ms); });
  assert.equal(readings.length, 2);
  assert.deepEqual(waits, [1000]);
  assert.equal(readings[1]?.bandwidth.value?.rxBytesPerSecond, 100);
});
