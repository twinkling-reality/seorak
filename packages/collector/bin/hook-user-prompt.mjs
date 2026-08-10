#!/usr/bin/env node
import { parseClaudeCodeHook } from "../src/adapters/claude-code.ts";
import {
  acquireHookInvocationLease,
  createHookEventAppender,
} from "../src/hook-append.ts";
import { readRawHookInput, toSessionPrompt } from "../src/hooks.ts";

const releaseHookLease = await acquireHookInvocationLease();
if (!releaseHookLease) process.exit(0);
process.once("exit", releaseHookLease);

// The UserPromptSubmit payload carries the prompt TEXT; it is NEVER read. The
// builder mints an ENVELOPE-ONLY session.prompt (count + timestamp), the honest
// basis for turns-per-session / steering cadence (CAPTURE-FOUNDATION ADR-CF8).
const appendHookEvent = createHookEventAppender();
const input = parseClaudeCodeHook(readRawHookInput());
if (input?.phase !== "userPrompt") process.exit(0);
const event = toSessionPrompt(input);
if (event) await appendHookEvent(event);
