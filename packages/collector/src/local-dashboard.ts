/**
 * local-dashboard.ts — the local REPORT and EXPORT contract (data-lifecycle.md).
 *
 * This module used to also serve a bespoke simplified HTML page on loopback.
 * That page was a second, worse product with its own honesty rules, and it is
 * gone: the primary dashboard now reads the real route contract from
 * `local-plane.ts`. What remains here is the part that was never a parallel UI —
 * the terminal report and the user-owned export.
 */
import { openSync, closeSync, fsyncSync, writeFileSync } from "node:fs";
import { isAbsolute } from "node:path";
import type { SessionEvent } from "@seorak/types";
import {
  listLocalSessions,
  localHistoryCounts,
  openLocalHistory,
  type LocalHistoryCounts,
  type LocalSessionRow,
} from "./local-store.ts";

export interface LocalReport {
  generatedAt: string;
  completeness: "complete-local-history";
  counts: LocalHistoryCounts;
  totals: {
    sessions: number;
    completedSessions: number;
    events: number;
    toolCalls: number;
    erroredToolCalls: number;
    prompts: number;
    tokens: number;
    costUsd: number | null;
  };
  recentSessions: LocalSessionRow[];
}

export function buildLocalReport(directory?: string): LocalReport {
  const counts = localHistoryCounts(directory);
  const sessions = listLocalSessions({
    limit: 25,
    ...(directory === undefined ? {} : { directory }),
  });
  const database = openLocalHistory(directory);
  let aggregate: Record<string, unknown>;
  try {
    aggregate = database
      .prepare(`
        SELECT COALESCE(SUM(tool_call_count), 0) AS tool_calls,
               COALESCE(SUM(errored_tool_call_count), 0) AS errored_tool_calls,
               COALESCE(SUM(prompt_count), 0) AS prompts,
               COALESCE(SUM(input_tokens + output_tokens +
                            cache_read_tokens + cache_write_tokens), 0) AS tokens,
               COALESCE(SUM(cost_usd), 0) AS cost_usd,
               COALESCE(MIN(cost_known), 1) AS all_cost_known
          FROM local_session
      `)
      .get() as Record<string, unknown>;
  } finally {
    database.close();
  }
  return {
    generatedAt: new Date().toISOString(),
    completeness: "complete-local-history",
    counts,
    totals: {
      sessions: counts.sessions,
      completedSessions: counts.completedSessions,
      events: counts.events,
      toolCalls: Number(aggregate.tool_calls),
      erroredToolCalls: Number(aggregate.errored_tool_calls),
      prompts: Number(aggregate.prompts),
      tokens: Number(aggregate.tokens),
      costUsd:
        Number(aggregate.all_cost_known) === 1
          ? Number(aggregate.cost_usd)
          : null,
    },
    recentSessions: sessions,
  };
}

interface LocalExport {
  schemaVersion: 1;
  exportedAt: string;
  completeness: "complete-local-history";
  report: LocalReport;
  events: SessionEvent[];
}

export function exportLocalHistory(
  outputPath: string,
  directory?: string,
): { path: string; events: number } {
  if (!isAbsolute(outputPath)) {
    throw new Error("local export path must be absolute");
  }
  const database = openLocalHistory(directory);
  let events: SessionEvent[];
  try {
    events = database
      .prepare("SELECT payload_json FROM local_event ORDER BY local_seq")
      .all()
      .map((row) =>
        JSON.parse(String((row as { payload_json?: unknown }).payload_json)) as SessionEvent,
      );
  } finally {
    database.close();
  }
  const value: LocalExport = {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    completeness: "complete-local-history",
    report: buildLocalReport(directory),
    events,
  };
  const fd = openSync(outputPath, "wx", 0o600);
  try {
    writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  return { path: outputPath, events: events.length };
}
