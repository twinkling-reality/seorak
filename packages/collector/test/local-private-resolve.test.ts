/**
 * local-private-resolve.test.ts: resolving a session by its agent's own identity
 * (ADR 007), and the launcher label on session summaries.
 *
 * The contract a caller relies on:
 *
 *   - a caller that already holds a native id gets the same summary, and the same
 *     opaque sessionRef, that `list_sessions` shows for that session;
 *   - both halves of the identity must match, so a Codex thread id never resolves
 *     to a Claude Code session with the same string;
 *   - a miss is `unavailable: not-captured` with a null session, never a guess;
 *   - the credential's project and date restrictions refuse exactly as they do for
 *     a sessionRef read;
 *   - the native id is never echoed: not in the response, not in the audit;
 *   - `launcher` carries the recorded label, and null where none was declared.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IntegrationScope, SessionEvent } from "@seorak/types";
import { afterEach, describe, expect, it } from "vitest";
import {
  authorizeLocalIntegrationCredential,
  createLocalIntegrationCredential,
  type LocalIntegrationPrincipal,
} from "../src/local-integration-store.ts";
import {
  queryLocalPrivateOutcome,
  queryLocalPrivateResolveSession,
  queryLocalPrivateSessions,
} from "../src/local-private-queries.ts";
import {
  appendLocalEvent,
  openLocalHistory,
  recordLocalSessionLauncher,
} from "../src/local-store.ts";
import { REPO_A, REPO_B } from "./support/local-history-fixture.ts";

const NOW = Date.parse("2026-08-09T12:00:00.000Z");
const API_AUDIENCE = "http://127.0.0.1:4318/api/v1";
const CLAUDE_ID = "0f7c1a52-3b9e-4d1a-9f2e-6c0b8d4e1a27";
const CODEX_ID = "019a2b3c-4d5e-7f60-8a9b-0c1d2e3f4a5b";
const temporary: string[] = [];

afterEach(() => {
  for (const path of temporary.splice(0)) {
    rmSync(path, { recursive: true, force: true });
  }
});

function directory(): string {
  const path = mkdtempSync(join(tmpdir(), "seorak-local-resolve-"));
  temporary.push(path);
  return path;
}

function issue(
  dir: string,
  restrictions: { repoId?: string; dataNotBefore?: string; dataNotAfter?: string } = {},
  scope: IntegrationScope = "sessions:read",
): LocalIntegrationPrincipal {
  const created = createLocalIntegrationCredential({
    directory: dir,
    audience: API_AUDIENCE,
    scopes: ["period:read", "sessions:read", "replay:read"],
    expiresAt: new Date(NOW + 24 * 60 * 60_000).toISOString(),
    nowMs: NOW,
    ...restrictions,
  });
  const authorized = authorizeLocalIntegrationCredential(`Bearer ${created.token}`, {
    directory: dir,
    audience: API_AUDIENCE,
    scope,
    routeClass: "read",
    nowMs: NOW,
  });
  if (!authorized.ok) throw new Error(`authorization failed: ${authorized.reason}`);
  return authorized.principal;
}

function session(
  dir: string,
  sessionId: string,
  options: { agent?: "claude-code" | "codex"; repoId?: string; startedAt?: string; endedAt?: string } = {},
): void {
  const agent = options.agent ?? "claude-code";
  const startedAt = options.startedAt ?? "2026-08-09T10:00:00.000Z";
  const events: SessionEvent[] = [
    {
      kind: "session.start",
      eventId: `${sessionId}-start`,
      sessionId,
      at: startedAt,
      repoId: options.repoId ?? REPO_A,
      repoLabel: "private-project-label",
      agent,
      agentVersion: "1.0.0",
      capabilities: {
        hasTokens: true,
        hasCacheTokens: true,
        cost: "estimated",
        toolResult: "both",
        endReason: true,
        duration: "measured",
        verification: "both",
        costScope: agent === "codex" ? "session" : "call",
        usageWindow: "count",
      },
    },
    {
      kind: "tool.call",
      eventId: `${sessionId}-call`,
      sessionId,
      at: new Date(Date.parse(startedAt) + 60_000).toISOString(),
      toolName: "Read",
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costUsd: 0,
    },
  ];
  if (options.endedAt !== undefined) {
    events.push({
      kind: "session.end",
      eventId: `${sessionId}-end`,
      sessionId,
      at: options.endedAt,
      reason: "clear",
    } as SessionEvent);
  }
  for (const event of events) appendLocalEvent(event, dir);
}

const now = new Date(NOW);

describe("resolve_session (collector)", () => {
  it("resolves a known native id to the same summary and ref a session page shows", () => {
    const dir = directory();
    session(dir, CLAUDE_ID, { endedAt: "2026-08-09T11:00:00.000Z" });
    session(dir, CODEX_ID, { agent: "codex", startedAt: "2026-08-09T09:00:00.000Z" });
    recordLocalSessionLauncher(CLAUDE_ID, "agent-host", dir, NOW);
    const actor = issue(dir);

    const resolved = queryLocalPrivateResolveSession(
      actor,
      { agent: "claude-code", nativeSessionId: CLAUDE_ID },
      { directory: dir, now },
    );
    expect(resolved.availability).toEqual({ state: "available", reason: null });
    expect(resolved.coverage.matchedSessionCount).toBe(1);
    expect(resolved.session).not.toBeNull();
    expect(resolved.session!.sessionRef).toMatch(/^ses_[0-9a-f]{32}$/);
    expect(resolved.session!.projectRef).toMatch(/^prj_[0-9a-f]{32}$/);
    expect(resolved.session!.agent).toBe("claude-code");
    expect(resolved.session!.status).toBe("ended");
    expect(resolved.session!.launcher).toBe("agent-host");

    const page = queryLocalPrivateSessions(actor, {
      directory: dir,
      now,
      limit: 10,
      cursor: null,
    });
    const listed = page.items.find((item) => item.sessionRef === resolved.session!.sessionRef);
    expect(listed).toEqual(resolved.session);
    const codexListed = page.items.find((item) => item.agent === "codex");
    expect(codexListed?.launcher).toBeNull();

    // Resolving again is idempotent: the same ref, not a second one.
    const again = queryLocalPrivateResolveSession(
      actor,
      { agent: "claude-code", nativeSessionId: CLAUDE_ID },
      { directory: dir, now },
    );
    expect(again.session!.sessionRef).toBe(resolved.session!.sessionRef);

    // The ref is a working handle for every other sessionRef read.
    const outcome = queryLocalPrivateOutcome(actor, resolved.session!.sessionRef, {
      directory: dir,
      now,
    });
    expect(outcome.sessionRef).toBe(resolved.session!.sessionRef);
    expect(outcome.availability.state).not.toBe("unavailable");
  });

  it("resolves a session nobody has listed yet, minting its ref on read", () => {
    const dir = directory();
    session(dir, CODEX_ID, { agent: "codex" });
    const actor = issue(dir);

    const resolved = queryLocalPrivateResolveSession(
      actor,
      { agent: "codex", nativeSessionId: CODEX_ID },
      { directory: dir, now },
    );
    expect(resolved.session?.agent).toBe("codex");
    expect(resolved.session?.launcher).toBeNull();
  });

  it("requires both halves of the identity to match", () => {
    const dir = directory();
    session(dir, CLAUDE_ID);
    const actor = issue(dir);

    const wrongAgent = queryLocalPrivateResolveSession(
      actor,
      { agent: "codex", nativeSessionId: CLAUDE_ID },
      { directory: dir, now },
    );
    expect(wrongAgent.session).toBeNull();
    expect(wrongAgent.availability).toEqual({ state: "unavailable", reason: "not-captured" });
  });

  it("answers a miss as not-captured, with a null session and nothing invented", () => {
    const dir = directory();
    session(dir, CLAUDE_ID);
    const actor = issue(dir);

    const miss = queryLocalPrivateResolveSession(
      actor,
      { agent: "claude-code", nativeSessionId: "9f9f9f9f-0000-4000-8000-000000000000" },
      { directory: dir, now },
    );
    expect(miss.session).toBeNull();
    expect(miss.availability).toEqual({ state: "unavailable", reason: "not-captured" });
    expect(miss.coverage.matchedSessionCount).toBe(0);
    expect(miss.coverage.includedSessionCount).toBe(0);
    expect(miss.coverage.complete).toBe(false);
    expect(miss.freshness.generatedAt).toBe(now.toISOString());
  });

  it("refuses a session outside the credential's project, as a sessionRef read does", () => {
    const dir = directory();
    session(dir, CLAUDE_ID, { repoId: REPO_B });
    const actor = issue(dir, { repoId: REPO_A });

    const refused = queryLocalPrivateResolveSession(
      actor,
      { agent: "claude-code", nativeSessionId: CLAUDE_ID },
      { directory: dir, now },
    );
    expect(refused.session).toBeNull();
    expect(refused.availability).toEqual({
      state: "unavailable",
      reason: "outside-credential-restriction",
    });
  });

  it("refuses a session that straddles the credential's date window", () => {
    const dir = directory();
    session(dir, CLAUDE_ID, {
      startedAt: "2026-08-01T10:00:00.000Z",
      endedAt: "2026-08-09T11:00:00.000Z",
    });
    const actor = issue(dir, {
      dataNotBefore: "2026-08-05T00:00:00.000Z",
      dataNotAfter: "2026-08-10T00:00:00.000Z",
    });

    const refused = queryLocalPrivateResolveSession(
      actor,
      { agent: "claude-code", nativeSessionId: CLAUDE_ID },
      { directory: dir, now },
    );
    expect(refused.session).toBeNull();
    expect(refused.availability.reason).toBe("outside-credential-restriction");
  });

  it("never echoes or stores the native id it was asked about", () => {
    const dir = directory();
    session(dir, CLAUDE_ID);
    const actor = issue(dir);

    const hit = queryLocalPrivateResolveSession(
      actor,
      { agent: "claude-code", nativeSessionId: CLAUDE_ID },
      { directory: dir, now },
    );
    const missId = "7e7e7e7e-1111-4111-8111-111111111111";
    const miss = queryLocalPrivateResolveSession(
      actor,
      { agent: "claude-code", nativeSessionId: missId },
      { directory: dir, now },
    );
    expect(JSON.stringify(hit)).not.toContain(CLAUDE_ID);
    expect(JSON.stringify(miss)).not.toContain(missId);

    // The only table that may hold the native id is the one it came from.
    const database = openLocalHistory(dir);
    try {
      const tables = (
        database
          .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'local_integration_%'")
          .all() as Array<{ name: string }>
      ).map((row) => row.name);
      for (const table of tables) {
        if (table === "local_integration_session_ref") continue;
        const dump = JSON.stringify(database.prepare(`SELECT * FROM ${table}`).all());
        expect(dump, table).not.toContain(missId);
        expect(dump, table).not.toContain(CLAUDE_ID);
      }
    } finally {
      database.close();
    }
  });
});
