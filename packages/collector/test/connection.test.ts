import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  listSavedConnections,
  loadSavedConnection,
  parseSavedConnection,
  saveConnection,
  selectSavedConnection,
  type SavedConnection,
} from "../src/connection.ts";
import {
  DEFAULT_CONTROL_PLANE_URL,
  loginWithDeviceCode,
} from "../src/device-login.ts";

const CONNECTION: SavedConnection = {
  schemaVersion: 1,
  workerUrl: "https://cell.example/",
  ingestToken: `srki_${"1".repeat(32)}_${"2".repeat(64)}`,
  readToken: `srkr_${"3".repeat(32)}_${"4".repeat(64)}`,
};

describe("saved hosted connection", () => {
  it("writes a validated mode-0600 file and reads its canonical URL", () => {
    const root = mkdtempSync(join(tmpdir(), "seorak-connection-"));
    const path = join(root, "state", "connection.json");
    saveConnection(CONNECTION, path);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(loadSavedConnection(path)).toEqual({
      ...CONNECTION,
      workerUrl: "https://cell.example",
    });
    expect(readFileSync(path, "utf8")).not.toContain("undefined");
  });

  it("rejects plaintext, credentialed, or malformed targets", () => {
    expect(
      parseSavedConnection({ ...CONNECTION, workerUrl: "http://cell.example" }),
    ).toBeNull();
    expect(
      parseSavedConnection({
        ...CONNECTION,
        workerUrl: "https://token@cell.example",
      }),
    ).toBeNull();
    expect(
      parseSavedConnection({ ...CONNECTION, ingestToken: "" }),
    ).toBeNull();
  });

  it("keeps Personal and Shared credentials isolated and switches explicitly", () => {
    const root = mkdtempSync(join(tmpdir(), "seorak-homes-"));
    const path = join(root, "connection.json");
    const personal: SavedConnection = {
      ...CONNECTION,
      home: { id: "person-1", kind: "personal", name: "Personal" },
    };
    const shared: SavedConnection = {
      ...CONNECTION,
      workerUrl: "https://workspace.example",
      ingestToken: `srki_${"5".repeat(32)}_${"6".repeat(64)}`,
      readToken: `srkr_${"7".repeat(32)}_${"8".repeat(64)}`,
      home: {
        id: "ws_123",
        kind: "workspace",
        name: "Cedar",
        memberId: "member_123",
      },
    };
    saveConnection(personal, path);
    saveConnection(shared, path);
    expect(loadSavedConnection(path)).toEqual(shared);
    const canonicalPersonal = {
      ...personal,
      workerUrl: "https://cell.example",
    };
    expect(listSavedConnections(path)).toEqual([canonicalPersonal, shared]);

    expect(selectSavedConnection("Personal", path)).toEqual(canonicalPersonal);
    expect(loadSavedConnection(path)).toEqual(canonicalPersonal);
    expect(readFileSync(path, "utf8")).toContain('"schemaVersion": 2');
  });

  it("preserves an existing Personal login when the first Shared home is added", () => {
    const root = mkdtempSync(join(tmpdir(), "seorak-legacy-home-"));
    const path = join(root, "connection.json");
    const shared: SavedConnection = {
      ...CONNECTION,
      workerUrl: "https://workspace.example",
      ingestToken: `srki_${"5".repeat(32)}_${"6".repeat(64)}`,
      readToken: `srkr_${"7".repeat(32)}_${"8".repeat(64)}`,
      home: {
        id: "ws_123",
        kind: "workspace",
        name: "Cedar",
        memberId: "member_123",
      },
    };

    saveConnection(CONNECTION, path);
    saveConnection(shared, path);

    expect(listSavedConnections(path).map((connection) => connection.home)).toEqual([
      { id: "personal", kind: "personal", name: "Personal" },
      shared.home,
    ]);
    expect(selectSavedConnection("Personal", path)).toMatchObject({
      workerUrl: "https://cell.example",
      ingestToken: CONNECTION.ingestToken,
      readToken: CONNECTION.readToken,
    });
  });
});

describe("collector device login", () => {
  it("uses PKCE, tolerates pending, and saves credentials only after approval", async () => {
    const saved = vi.fn();
    const prompted: string[] = [];
    const responses = [
      new Response(
        JSON.stringify({
          clientKind: "collector",
          deviceCode: "d".repeat(64),
          userCode: "ABCD-EFGH",
          verificationUri: "https://control.example/device",
          verificationUriComplete:
            "https://control.example/device?user_code=ABCD-EFGH",
          expiresIn: 600,
          interval: 2,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
      new Response(JSON.stringify({ error: "authorization_pending" }), {
        status: 428,
        headers: { "content-type": "application/json" },
      }),
      new Response(
        JSON.stringify({
          clientKind: "collector",
          workerUrl: "https://cell.example",
          ingestToken: CONNECTION.ingestToken,
          readToken: CONNECTION.readToken,
          home: {
            id: "ws_123",
            kind: "workspace",
            name: "Cedar",
            memberId: "member_123",
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ];
    const fetchImpl = vi.fn(async () => responses.shift()!);
    await loginWithDeviceCode({
      noBrowser: true,
      fetchImpl,
      onPrompt: (line) => prompted.push(line),
      save: saved,
      wait: async () => undefined,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    const startBody = JSON.parse(
      String(fetchImpl.mock.calls[0]?.[1]?.body),
    ) as { codeChallenge: string; clientKind: string };
    expect(startBody.codeChallenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(startBody.clientKind).toBe("collector");
    const pollBody = JSON.parse(
      String(fetchImpl.mock.calls[1]?.[1]?.body),
    ) as { codeVerifier: string };
    expect(pollBody.codeVerifier.length).toBeGreaterThanOrEqual(43);
    // Against the default control plane, named through the constant rather
    // than spelled out again: one copy of that origin is the whole reason the
    // identifier register has an entry for it.
    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe(
      `${DEFAULT_CONTROL_PLANE_URL}/device/code`,
    );
    expect(String(fetchImpl.mock.calls[3]?.[0])).toBe(
      `${DEFAULT_CONTROL_PLANE_URL}/device/token/ack`,
    );
    expect(saved).toHaveBeenCalledWith({
      schemaVersion: 1,
      workerUrl: "https://cell.example",
      ingestToken: CONNECTION.ingestToken,
      readToken: CONNECTION.readToken,
      home: {
        id: "ws_123",
        kind: "workspace",
        name: "Cedar",
        memberId: "member_123",
      },
    });
    expect(prompted.join("\n")).toContain("ABCD-EFGH");
    expect(prompted.join("\n")).not.toContain(CONNECTION.ingestToken);
    expect(prompted.join("\n")).not.toContain(CONNECTION.readToken);
  });
});
