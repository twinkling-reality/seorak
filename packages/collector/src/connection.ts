import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import { connectionPath } from "./paths.ts";

export interface SavedConnection {
  schemaVersion: 1;
  workerUrl: string;
  ingestToken: string;
  readToken: string;
  home?: ConnectionHome;
}

export interface ConnectionHome {
  id: string;
  kind: "personal" | "workspace";
  name: string;
  memberId?: string;
}

interface StoredHome extends ConnectionHome {
  workerUrl: string;
  ingestToken: string;
  readToken: string;
}

interface ConnectionStore {
  schemaVersion: 2;
  activeHomeId: string;
  homes: StoredHome[];
}

function safeWorkerUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    const loopback =
      url.protocol === "http:" &&
      (url.hostname === "localhost" || url.hostname === "127.0.0.1");
    if (url.protocol !== "https:" && !loopback) return null;
    if (url.username || url.password || url.search || url.hash) return null;
    return url.origin;
  } catch {
    return null;
  }
}

function parseHome(value: unknown): ConnectionHome | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (
    typeof record.id !== "string" ||
    record.id.length < 1 ||
    record.id.length > 128 ||
    (record.kind !== "personal" && record.kind !== "workspace") ||
    typeof record.name !== "string" ||
    record.name.trim().length < 1 ||
    record.name.length > 80 ||
    (record.memberId !== undefined &&
      (typeof record.memberId !== "string" ||
        record.memberId.length < 1 ||
        record.memberId.length > 128))
  ) {
    return null;
  }
  return {
    id: record.id,
    kind: record.kind,
    name: record.name.trim(),
    ...(typeof record.memberId === "string"
      ? { memberId: record.memberId }
      : {}),
  };
}

export function parseSavedConnection(value: unknown): SavedConnection | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const home = record.home === undefined ? undefined : parseHome(record.home);
  const workerUrl =
    typeof record.workerUrl === "string"
      ? safeWorkerUrl(record.workerUrl)
      : null;
  if (
    record.schemaVersion !== 1 ||
    !workerUrl ||
    typeof record.ingestToken !== "string" ||
    record.ingestToken.length < 16 ||
    typeof record.readToken !== "string" ||
    record.readToken.length < 16 ||
    (record.home !== undefined && !home)
  ) {
    return null;
  }
  return {
    schemaVersion: 1,
    workerUrl,
    ingestToken: record.ingestToken,
    readToken: record.readToken,
    ...(home ? { home } : {}),
  };
}

function parseStore(value: unknown): ConnectionStore | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (
    record.schemaVersion !== 2 ||
    typeof record.activeHomeId !== "string" ||
    !Array.isArray(record.homes) ||
    record.homes.length < 1
  ) {
    return null;
  }
  const homes: StoredHome[] = [];
  const ids = new Set<string>();
  for (const value of record.homes) {
    const connection = parseSavedConnection({
      ...(value as object),
      schemaVersion: 1,
      home: value,
    });
    if (!connection?.home || ids.has(connection.home.id)) return null;
    ids.add(connection.home.id);
    homes.push({
      ...connection.home,
      workerUrl: connection.workerUrl,
      ingestToken: connection.ingestToken,
      readToken: connection.readToken,
    });
  }
  if (!ids.has(record.activeHomeId)) return null;
  return {
    schemaVersion: 2,
    activeHomeId: record.activeHomeId,
    homes,
  };
}

function connectionFromStoredHome(home: StoredHome): SavedConnection {
  const { workerUrl, ingestToken, readToken, ...identity } = home;
  return {
    schemaVersion: 1,
    workerUrl,
    ingestToken,
    readToken,
    home: identity,
  };
}

function readConnectionValue(path: string): unknown {
  if (!existsSync(path) || lstatSync(path).isSymbolicLink()) return null;
  return JSON.parse(readFileSync(path, "utf8"));
}

export function loadSavedConnection(
  path: string = connectionPath(),
): SavedConnection | null {
  try {
    const value = readConnectionValue(path);
    const store = parseStore(value);
    if (store) {
      const active = store.homes.find(
        (home) => home.id === store.activeHomeId,
      );
      return active ? connectionFromStoredHome(active) : null;
    }
    return parseSavedConnection(value);
  } catch {
    return null;
  }
}

export function listSavedConnections(
  path: string = connectionPath(),
): SavedConnection[] {
  try {
    const value = readConnectionValue(path);
    const store = parseStore(value);
    if (store) return store.homes.map(connectionFromStoredHome);
    const legacy = parseSavedConnection(value);
    return legacy ? [legacy] : [];
  } catch {
    return [];
  }
}

function writeConnectionValue(value: SavedConnection | ConnectionStore, path: string): void {
  const parent = dirname(path);
  mkdirSync(parent, { recursive: true, mode: 0o700 });
  if (existsSync(path) && lstatSync(path).isSymbolicLink()) {
    throw new Error("connection file must not be a symbolic link");
  }
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  let descriptor: number | null = null;
  try {
    descriptor = openSync(
      temporary,
      "wx",
      0o600,
    );
    writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = null;
    renameSync(temporary, path);
  } finally {
    if (descriptor !== null) closeSync(descriptor);
    rmSync(temporary, { force: true });
  }
}

export function saveConnection(
  connection: SavedConnection,
  path: string = connectionPath(),
): void {
  const parsed = parseSavedConnection(connection);
  if (!parsed || (connection.home !== undefined && parsed.home === undefined)) {
    throw new Error("hosted connection invalid");
  }
  if (!parsed.home) {
    try {
      const currentStore = parseStore(readConnectionValue(path));
      if (currentStore) {
        const homes = currentStore.homes.map((home) =>
          home.id === currentStore.activeHomeId
            ? {
                ...home,
                workerUrl: parsed.workerUrl,
                ingestToken: parsed.ingestToken,
                readToken: parsed.readToken,
              }
            : home,
        );
        writeConnectionValue({ ...currentStore, homes }, path);
        return;
      }
    } catch {
      // A malformed prior value is replaced only by the validated connection.
    }
    writeConnectionValue(parsed, path);
    return;
  }

  let homes: StoredHome[] = [];
  try {
    const current = readConnectionValue(path);
    const store = parseStore(current);
    if (store) {
      homes = store.homes;
    } else {
      const legacy = parseSavedConnection(current);
      if (legacy) {
        homes = [
          {
            id: "personal",
            kind: "personal",
            name: "Personal",
            workerUrl: legacy.workerUrl,
            ingestToken: legacy.ingestToken,
            readToken: legacy.readToken,
          },
        ];
      }
    }
  } catch {
    // The validated login is allowed to replace a malformed prior value.
  }
  const stored: StoredHome = {
    ...parsed.home,
    workerUrl: parsed.workerUrl,
    ingestToken: parsed.ingestToken,
    readToken: parsed.readToken,
  };
  const existingIndex = homes.findIndex((home) => home.id === stored.id);
  if (existingIndex === -1) homes.push(stored);
  else homes[existingIndex] = stored;
  writeConnectionValue(
    {
      schemaVersion: 2,
      activeHomeId: stored.id,
      homes,
    },
    path,
  );
}

export function selectSavedConnection(
  selector: string,
  path: string = connectionPath(),
): SavedConnection | null {
  let store: ConnectionStore | null = null;
  try {
    store = parseStore(readConnectionValue(path));
  } catch {
    return null;
  }
  if (!store) return null;
  const normalized = selector.trim().toLocaleLowerCase();
  const matches = store.homes.filter(
    (home) =>
      home.id === selector ||
      home.name.toLocaleLowerCase() === normalized,
  );
  if (matches.length !== 1) return null;
  const selected = matches[0]!;
  writeConnectionValue({ ...store, activeHomeId: selected.id }, path);
  return connectionFromStoredHome(selected);
}
