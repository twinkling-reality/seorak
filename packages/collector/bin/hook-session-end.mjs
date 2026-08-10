#!/usr/bin/env node
import { parseClaudeCodeHook } from "../src/adapters/claude-code.ts";
import {
  acquireHookInvocationLease,
  createHookEventAppender,
} from "../src/hook-append.ts";
import { readRawHookInput, toSessionDelta, toSessionEnd } from "../src/hooks.ts";

const releaseHookLease = await acquireHookInvocationLease();
if (!releaseHookLease) process.exit(0);
process.once("exit", releaseHookLease);

const appendHookEvent = createHookEventAppender();
const input = parseClaudeCodeHook(readRawHookInput());
if (input?.phase !== "end") process.exit(0);
const end = toSessionEnd(input);
if (!end) process.exit(0);
if (!(await appendHookEvent(end))) process.exit(0);

// NOTE: line-survival used to be SEEDED here, from the session's start-HEAD → end-HEAD
// commit range. It is not any more. That seed credited a session with every commit landed
// inside its window — including the human's files and the other agent's — which is only
// correct while exactly one agent exists, and it required a session END, which Codex does
// not have. The daemon's commit watcher now attributes each (commit × file) to whichever
// agent actually edited it, so the clock starts when work LANDS rather than when a chat
// ends (HEAD-TO-HEAD ADR-H3). Nothing is owed to this hook.

// Session-bounded git delta (did this session ship or thrash?). undefined when
// SEORAK_MOMENTUM=0 or the cwd is not a git repo. Reads + clears the start cursor.
const delta = toSessionDelta(input);
if (delta) await appendHookEvent(delta);
