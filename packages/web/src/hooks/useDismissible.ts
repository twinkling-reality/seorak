import { useCallback, useSyncExternalStore } from 'react';

const DEFAULT_ID = '__default__';

const snapshots = new Map<string, Set<string>>();
const listeners = new Map<string, Set<() => void>>();

function loadSet(key: string): Set<string> {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return new Set();
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return new Set(parsed.filter((x): x is string => typeof x === 'string'));
      }
      return new Set();
    } catch {
      return new Set();
    }
  } catch {
    return new Set();
  }
}

function saveSet(key: string, set: Set<string>) {
  try {
    if (set.size === 0) {
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, JSON.stringify([...set]));
    }
  } catch {
    // ignore quota
  }
}

function getSnapshot(key: string): Set<string> {
  let s = snapshots.get(key);
  if (!s) {
    s = loadSet(key);
    snapshots.set(key, s);
  }
  return s;
}

function setSnapshot(key: string, next: Set<string>) {
  snapshots.set(key, next);
  saveSet(key, next);
  listeners.get(key)?.forEach((fn) => fn());
}

function subscribe(key: string, fn: () => void): () => void {
  let set = listeners.get(key);
  if (!set) {
    set = new Set();
    listeners.set(key, set);
  }
  set.add(fn);
  return () => {
    const s = listeners.get(key);
    if (!s) return;
    s.delete(fn);
    if (s.size === 0) listeners.delete(key);
  };
}

/**
 * One-shot dismissible state backed by localStorage.
 *
 * Two usage modes:
 * - Boolean - omit `id`. One dismissal per storage key.
 *     const { isDismissed, dismiss } = useDismissible('seorak:hint:foo');
 *     isDismissed(); dismiss();
 * - Per-id - pass an id to track dismissals per subject under one key.
 *     const { isDismissed, dismiss } = useDismissible('seorak:hint:bar');
 *     isDismissed(projectId); dismiss(projectId);
 *
 * All instances using the same key stay in sync via a module-level store,
 * so dismissing in one place re-renders every other consumer.
 *
 * To force-reshow a hint after a meaningful change, bump the key suffix
 * (e.g. `-v2` → `-v3`).
 */
export function useDismissible(storageKey: string) {
  const subscribeToKey = useCallback(
    (onChange: () => void) => subscribe(storageKey, onChange),
    [storageKey],
  );
  const getKeySnapshot = useCallback(() => getSnapshot(storageKey), [storageKey]);

  const dismissedIds = useSyncExternalStore(subscribeToKey, getKeySnapshot, getKeySnapshot);

  const isDismissed = useCallback(
    (id?: string) => dismissedIds.has(id ?? DEFAULT_ID),
    [dismissedIds],
  );

  const dismiss = useCallback(
    (id?: string) => {
      const current = getSnapshot(storageKey);
      const target = id ?? DEFAULT_ID;
      if (current.has(target)) return;
      const next = new Set(current);
      next.add(target);
      setSnapshot(storageKey, next);
    },
    [storageKey],
  );

  const reset = useCallback(
    (id?: string) => {
      if (id === undefined) {
        if (getSnapshot(storageKey).size === 0) return;
        setSnapshot(storageKey, new Set());
        return;
      }
      const current = getSnapshot(storageKey);
      if (!current.has(id)) return;
      const next = new Set(current);
      next.delete(id);
      setSnapshot(storageKey, next);
    },
    [storageKey],
  );

  return { isDismissed, dismiss, reset, dismissedIds };
}
