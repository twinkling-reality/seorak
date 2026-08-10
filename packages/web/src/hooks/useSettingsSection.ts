import { useCallback, useEffect, useRef, useState } from 'react';
import { isDemoActive } from '../lib/demoMode.js';

/**
 * The load + optimistic-write state machine every `/settings` panel runs.
 *
 * Capture, Notifications, and Projects each held their own copy of the same
 * shape: an abortable mount load, a demo branch that never touches the worker,
 * an optimistic write, a 401 that flips the panel read-only, and a rollback on
 * failure. Only the family (fetch/update pair, defaults, copy) actually differed,
 * so the machine lives here once and the panels supply the family.
 *
 * Two invariants are load-bearing and covered by `__tests__/useSettingsSection`:
 *
 *   1. A superseded load never lands. The abort guard sits on the SUCCESS path
 *      too, not just the catch — `controller.abort()` cannot un-queue a `.then`
 *      whose response already arrived, so without it a panel the reader has
 *      navigated away from still pushes its stale settings to `onChange`.
 *   2. A rollback is announced. `onChange` fires on every data transition
 *      including the revert, so a caller that mirrors the settings (the tab
 *      summary counts in SettingsView) cannot keep showing an optimistic value
 *      the worker rejected.
 */
export type SettingsSectionState<T> =
  | { kind: 'loading' }
  | { kind: 'unavailable'; reason: string }
  | { kind: 'ready'; data: T; readOnly: boolean; note: string | null };

export interface SettingsSectionConfig<T> {
  /** The family's GET. Must honour the abort signal. */
  load: (options: { signal: AbortSignal }) => Promise<T>;
  /** In-memory defaults demo mode edits locally instead of round-tripping. */
  demoData: T;
  /** Shown when the worker cannot be reached on the initial load. */
  unavailableReason: string;
  /** Shown when a write comes back 401 and the panel goes read-only. */
  readOnlyNote: string;
  /** Family name for the console diagnostic on a failed load. */
  logLabel: string;
  /** Notified on every data transition: load, optimistic, confirmed, reverted. */
  onChange?: (data: T) => void;
}

export interface SettingsSectionChange<T> {
  /** The value to show immediately, before the worker confirms it. */
  optimistic: T;
  /** The family's PUT for just this change. */
  write: () => Promise<T>;
  /**
   * Undo this change against the LATEST data, not a snapshot, so a panel that
   * allows a second edit while the first is in flight can revert one field
   * without discarding the other.
   */
  rollback: (latest: T) => T;
  /** Shown once the worker confirms. */
  savedNote: string;
  /** Shown while the write is in flight. */
  pendingNote?: string | null;
  /** Shown in demo mode, where there is no worker to confirm. Default: nothing. */
  demoNote?: string | null;
}

const WRITE_FAILED_NOTE = 'Save failed — worker unreachable. Try again.';

export interface SettingsSection<T> {
  state: SettingsSectionState<T>;
  applyChange: (change: SettingsSectionChange<T>) => Promise<void>;
}

export function useSettingsSection<T>(config: SettingsSectionConfig<T>): SettingsSection<T> {
  const [state, setState] = useState<SettingsSectionState<T>>({ kind: 'loading' });

  // The committed state, readable synchronously. `applyChange` resumes after an
  // await and needs the current value to guard on and to roll back against;
  // reading it from a ref keeps the parent notification OUT of the state updater
  // (React may invoke an updater more than once, a callback must fire once).
  const stateRef = useRef<SettingsSectionState<T>>(state);

  // The config is read through a ref so a caller passing a fresh closure each
  // render cannot re-trigger the mount load and abort a healthy request.
  const configRef = useRef(config);
  configRef.current = config;

  const commit = useCallback((next: SettingsSectionState<T>): void => {
    stateRef.current = next;
    setState(next);
  }, []);

  const commitReady = useCallback(
    (data: T, readOnly: boolean, note: string | null): void => {
      commit({ kind: 'ready', data, readOnly, note });
      configRef.current.onChange?.(data);
    },
    [commit],
  );

  useEffect(() => {
    const { load, demoData, unavailableReason, logLabel } = configRef.current;
    if (isDemoActive()) {
      commitReady(demoData, false, null);
      return;
    }
    const controller = new AbortController();
    load({ signal: controller.signal })
      .then((data) => {
        if (controller.signal.aborted) return;
        commitReady(data, false, null);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        console.error(`[seorak] ${logLabel} fetch failed`, error);
        commit({ kind: 'unavailable', reason: unavailableReason });
      });
    return () => controller.abort();
  }, [commit, commitReady]);

  const applyChange = useCallback(
    async (change: SettingsSectionChange<T>): Promise<void> => {
      const current = stateRef.current;
      if (current.kind !== 'ready' || current.readOnly) return;

      const { optimistic, write, rollback, savedNote, pendingNote, demoNote } = change;
      commitReady(optimistic, false, pendingNote ?? null);

      if (isDemoActive()) {
        if (demoNote != null) commitReady(optimistic, false, demoNote);
        return;
      }

      try {
        const confirmed = await write();
        // A load that failed while this write was in flight owns the panel now.
        if (stateRef.current.kind !== 'ready') return;
        commitReady(confirmed, false, savedNote);
      } catch (error) {
        if (stateRef.current.kind !== 'ready') return;
        const status = (error as { status?: number }).status;
        commitReady(
          rollback(stateRef.current.data),
          status === 401,
          status === 401 ? configRef.current.readOnlyNote : WRITE_FAILED_NOTE,
        );
      }
    },
    [commitReady],
  );

  return { state, applyChange };
}
