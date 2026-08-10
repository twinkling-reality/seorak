/**
 * Map over items with a ceiling on how many run at once, reporting each result
 * the moment it lands rather than all of them at the end.
 *
 * `Promise.all(items.map(fetch))` issues every request in one go. That is fine
 * for a handful and wrong for a period: a 90-day replay scope can hold hundreds
 * of sessions, and asking the worker for all of them at once is a thundering
 * herd against D1 that also leaves the stage blank until the slowest one
 * returns. A pool keeps the request count bounded and lets the caller draw what
 * has arrived — the reader watches the period fill in instead of watching
 * nothing.
 *
 * `run` is expected to absorb its own failures (return a state rather than
 * throw); a rejection here aborts the remaining work, same as `Promise.all`.
 */
export async function pooledMap<I, T>(
  items: readonly I[],
  limit: number,
  run: (item: I, index: number) => Promise<T>,
  onSettled?: (index: number, value: T) => void,
): Promise<T[]> {
  const results = new Array<T>(items.length);
  if (items.length === 0) return results;

  let cursor = 0;
  const workers = Math.max(1, Math.min(Math.floor(limit) || 1, items.length));

  await Promise.all(
    Array.from({ length: workers }, async () => {
      for (;;) {
        const index = cursor;
        cursor += 1;
        if (index >= items.length) return;
        const value = await run(items[index]!, index);
        results[index] = value;
        onSettled?.(index, value);
      }
    }),
  );

  return results;
}
