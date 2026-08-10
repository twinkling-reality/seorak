import { randomBytes, createHash } from "node:crypto";
import { platform } from "node:os";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import {
  saveConnection,
  type ConnectionHome,
  type SavedConnection,
} from "./connection.ts";

export const DEFAULT_CONTROL_PLANE_URL = "https://seorak.app";

interface DeviceCodeResponse {
  clientKind: "collector";
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string;
  expiresIn: number;
  interval: number;
}

function controlPlaneUrl(raw: string): string {
  const url = new URL(raw);
  const loopback =
    url.protocol === "http:" &&
    (url.hostname === "localhost" || url.hostname === "127.0.0.1");
  if (url.protocol !== "https:" && !loopback) {
    throw new Error("control-plane URL must be HTTPS or exact loopback");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("control-plane URL is invalid");
  }
  return url.origin;
}

function parseDeviceCode(value: unknown): DeviceCodeResponse {
  if (!value || typeof value !== "object") {
    throw new Error("device authorization response invalid");
  }
  const record = value as Record<string, unknown>;
  if (
    record.clientKind !== "collector" ||
    typeof record.deviceCode !== "string" ||
    typeof record.userCode !== "string" ||
    typeof record.verificationUri !== "string" ||
    typeof record.verificationUriComplete !== "string" ||
    typeof record.expiresIn !== "number" ||
    typeof record.interval !== "number"
  ) {
    throw new Error("device authorization response invalid");
  }
  return record as unknown as DeviceCodeResponse;
}

function openBrowser(url: string): void {
  let command: string;
  let args: string[];
  if (platform() === "darwin") {
    command = "open";
    args = [url];
  } else if (platform() === "win32") {
    command = "cmd";
    args = ["/c", "start", "", url];
  } else {
    command = "xdg-open";
    args = [url];
  }
  const child = spawn(command, args, {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
}

export async function loginWithDeviceCode(options: {
  controlPlaneUrl?: string;
  noBrowser?: boolean;
  fetchImpl?: typeof fetch;
  onPrompt?: (line: string) => void;
  save?: typeof saveConnection;
  wait?: (milliseconds: number) => Promise<unknown>;
} = {}): Promise<SavedConnection> {
  const base = controlPlaneUrl(
    options.controlPlaneUrl ??
      process.env.SEORAK_CONTROL_PLANE_URL ??
      DEFAULT_CONTROL_PLANE_URL,
  );
  const fetchImpl = options.fetchImpl ?? fetch;
  const write = options.onPrompt ?? console.log;
  const save = options.save ?? saveConnection;
  const wait = options.wait ?? delay;
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256")
    .update(verifier)
    .digest("base64url");

  const started = await fetchImpl(`${base}/device/code`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ codeChallenge: challenge, clientKind: "collector" }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!started.ok) {
    throw new Error(`device authorization failed (${started.status})`);
  }
  const device = parseDeviceCode(await started.json());
  write(`Open ${device.verificationUri}`);
  write(`Enter code ${device.userCode}`);
  if (!options.noBrowser) {
    try {
      openBrowser(device.verificationUriComplete);
    } catch {
      // The printed URL is the durable fallback.
    }
  }

  const deadline = Date.now() + device.expiresIn * 1000;
  while (Date.now() < deadline) {
    await wait(Math.max(1, device.interval) * 1000);
    const response = await fetchImpl(`${base}/device/token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        deviceCode: device.deviceCode,
        codeVerifier: verifier,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (response.status === 428 || response.status === 429) continue;
    if (!response.ok) {
      throw new Error(`device login failed (${response.status})`);
    }
    const body: unknown = await response.json();
    if (!body || typeof body !== "object") {
      throw new Error("device login response invalid");
    }
    const record = body as Record<string, unknown>;
    if (
      record.clientKind !== "collector" ||
      typeof record.workerUrl !== "string" ||
      typeof record.ingestToken !== "string" ||
      typeof record.readToken !== "string"
    ) {
      throw new Error("device login response invalid");
    }
    const rawHome = record.home;
    let home: ConnectionHome | undefined;
    if (rawHome !== undefined) {
      if (!rawHome || typeof rawHome !== "object") {
        throw new Error("device login response invalid");
      }
      const homeRecord = rawHome as Record<string, unknown>;
      if (
        typeof homeRecord.id !== "string" ||
        (homeRecord.kind !== "personal" &&
          homeRecord.kind !== "workspace") ||
        typeof homeRecord.name !== "string" ||
        (homeRecord.memberId !== undefined &&
          typeof homeRecord.memberId !== "string")
      ) {
        throw new Error("device login response invalid");
      }
      home = {
        id: homeRecord.id,
        kind: homeRecord.kind,
        name: homeRecord.name,
        ...(typeof homeRecord.memberId === "string"
          ? { memberId: homeRecord.memberId }
          : {}),
      };
    }
    const connection: SavedConnection = {
      schemaVersion: 1,
      workerUrl: record.workerUrl,
      ingestToken: record.ingestToken,
      readToken: record.readToken,
      ...(home ? { home } : {}),
    };
    save(connection);
    await fetchImpl(`${base}/device/token/ack`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        deviceCode: device.deviceCode,
        codeVerifier: verifier,
      }),
      signal: AbortSignal.timeout(15_000),
    }).catch(() => undefined);
    return connection;
  }
  throw new Error("device login expired");
}
