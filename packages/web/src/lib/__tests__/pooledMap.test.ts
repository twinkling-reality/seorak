import { describe, expect, it } from 'vitest';

import { pooledMap } from '../pooledMap.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe('pooledMap', () => {
  it('never runs more than the limit at once', async () => {
    let inFlight = 0;
    let peak = 0;
    const items = Array.from({ length: 25 }, (_, i) => i);

    await pooledMap(items, 6, async (item) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await Promise.resolve();
      inFlight -= 1;
      return item * 2;
    });

    expect(peak).toBeLessThanOrEqual(6);
    expect(peak).toBeGreaterThan(1);
  });

  it('returns results in input order however they finish', async () => {
    const gates = [deferred<string>(), deferred<string>(), deferred<string>()];
    const run = pooledMap(['a', 'b', 'c'], 3, (_item, index) => gates[index]!.promise);

    // Finish backwards.
    gates[2]!.resolve('third');
    gates[0]!.resolve('first');
    gates[1]!.resolve('second');

    await expect(run).resolves.toEqual(['first', 'second', 'third']);
  });

  it('reports each result as it lands, not all at the end', async () => {
    const gates = [deferred<number>(), deferred<number>()];
    const seen: number[] = [];
    const run = pooledMap(['a', 'b'], 2, (_item, index) => gates[index]!.promise, (_index, value) => {
      seen.push(value);
    });

    gates[1]!.resolve(20);
    await Promise.resolve();
    await Promise.resolve();
    // The second one landed first and was reported without waiting for the first.
    expect(seen).toEqual([20]);

    gates[0]!.resolve(10);
    await run;
    expect(seen).toEqual([20, 10]);
  });

  it('handles an empty list and a nonsense limit without hanging', async () => {
    await expect(pooledMap([], 6, async () => 1)).resolves.toEqual([]);
    await expect(pooledMap(['a', 'b'], 0, async (item) => item)).resolves.toEqual(['a', 'b']);
  });
});
