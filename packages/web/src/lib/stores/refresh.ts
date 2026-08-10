type RefreshHandler = () => void;

const refreshSubscribers = new Set<RefreshHandler>();

// Overview is polling-only (no WebSocket in the solo model). The flag is kept
// as a harmless toggle so a suppressed-refresh path stays expressible; it is
// never set true in the running app.
let suppressed = false;

export function addRefreshHandler(handler: RefreshHandler): () => void {
  refreshSubscribers.add(handler);
  return () => refreshSubscribers.delete(handler);
}

export function requestRefresh(): void {
  if (suppressed) return;
  for (const handler of refreshSubscribers) {
    handler();
  }
}

/** Suppress/resume HTTP refresh. No WebSocket path in the solo model; kept as
 *  a thin toggle. */
export function setWsConnected(connected: boolean): void {
  suppressed = connected;
}
