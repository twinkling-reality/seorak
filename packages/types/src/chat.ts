/**
 * chat.ts — publish-safe contracts for the grounded stat chat.
 *
 * Chat answers questions about the user's OWN Seorak record (stats, sessions,
 * outcomes, replay, interventions). It is deliberately NOT a general chatbot:
 * every answer is grounded in the same OPEN read endpoints the dashboards poll
 * (/overview, /live, /sessions, /interventions), and a number the record cannot
 * support is never fabricated — a missing measurement is an explicit null
 * citation, which surfaces render as "--" or plain "not measured yet" copy.
 *
 * These shapes are the SHARED seam between every chat surface (web glass panel,
 * terminal free-text input, mobile later) and whatever backend answers them
 * (today a local stub over the polling snapshot; later a worker POST /chat
 * orchestrating the same GET reads). Message/citation/request/response only —
 * no orchestration logic, no LLM configuration, no secrets (collector boundary:
 * this module travels with `@seorak/types`).
 */

import type { IsoTimestamp, SessionId } from "./events.ts";

/** The surface a chat turn originates from (carried for per-surface tuning
 *  server-side; never changes the grounding rules). */
export type ChatSurface = "web" | "terminal" | "mobile";

export type ChatRole = "user" | "assistant" | "system";

/** The aggregate windows chat can ground against — the same 7/30/90 set as the
 *  dashboard date picker and `GET /overview?days=`. */
export type ChatWindowDays = 7 | 30 | 90;

/**
 * StatCitation — one stat an answer is grounded in. `signalId` keys into
 * `SEORAK_SIGNALS` (the cross-surface catalog in widgets.ts) so a surface can
 * link the citation to its own rendering of that stat (the web maps it to a
 * widget drill route; the terminal to a board stat). `value` is the FORMATTED
 * display string; `null` is the honest unknown — the record has no measurement
 * yet — and must render as an explicit empty ("--"), never a zero-fill.
 */
export interface StatCitation {
  /** SEORAK_SIGNALS id (e.g. "cost", "ship-rate", "live-sessions"). */
  signalId: string;
  /** Human stat name, matching the catalog `name`. */
  label: string;
  /** Formatted display value; null = honest unknown, render "--". */
  value: string | null;
  /** The aggregate window the value covers, when window-scoped. */
  windowDays?: ChatWindowDays;
  /** Set when the citation is about one session (drill anchor). */
  sessionId?: SessionId;
}

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  /** The stats this message is grounded in. An assistant message with no
   *  citations made no numeric claim. */
  citations?: StatCitation[];
  createdAt: IsoTimestamp;
}

/** Per-request grounding context a surface sends alongside the question. */
export interface ChatContext {
  /** The window the surface is currently showing (the dashboard range pills);
   *  the default window for window-scoped answers. */
  rangeDays?: ChatWindowDays;
  surface: ChatSurface;
  /** Surface-local route/screen for context (e.g. "overview"), never a path
   *  from the user's machine. */
  route?: string;
}

export interface ChatRequest {
  message: string;
  /** Continue an existing thread; omitted on the first turn. */
  conversationId?: string;
  context?: ChatContext;
}

export interface ChatResponse {
  message: ChatMessage;
  conversationId: string;
}
