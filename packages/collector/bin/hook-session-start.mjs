#!/usr/bin/env node
import { parseClaudeCodeHook } from "../src/adapters/claude-code.ts";
import {
  acquireHookInvocationLease,
  createHookEventAppender,
} from "../src/hook-append.ts";
import {
  readRawHookInput,
  recordSessionStartGit,
  registerSessionStartRepo,
  toGitMomentum,
  toRepoToolchain,
  toSessionStart,
} from "../src/hooks.ts";

const releaseHookLease = await acquireHookInvocationLease();
if (!releaseHookLease) process.exit(0);
process.once("exit", releaseHookLease);

// This executable is installed only for Claude Code SessionStart. A malformed
// payload or a phase mismatch is a no-op, never a guessed session.
const appendHookEvent = createHookEventAppender();
const input = parseClaudeCodeHook(readRawHookInput());
if (input?.phase !== "start") process.exit(0);
const start = toSessionStart(input);
if (!start) process.exit(0);
if (!(await appendHookEvent(start))) process.exit(0);

// Register this session's repo into the LOCAL daemon registry from the raw cwd
// (which is in hand here but is NEVER emitted on the event). The daemon's timer
// sweep then covers it. No-op when SEORAK_MOMENTUM=0 or the cwd is not a repo.
registerSessionStartRepo(input);

// Repo-scoped git momentum snapshot, appended alongside session.start. undefined
// when SEORAK_MOMENTUM=0 or the cwd is not a git repo (no-repo). Bounded by the
// git timeout + trailing window; opt out via SEORAK_MOMENTUM=0.
const momentum = toGitMomentum(input);
if (momentum && !(await appendHookEvent(momentum))) process.exit(0);

// Repo toolchain identity (packageManager + framework), appended alongside
// session.start. undefined when the toolchain setting is off or nothing detected.
// Enums + salted id only; the manifest is read on-machine and discarded.
const toolchain = toRepoToolchain(input);
if (toolchain && !(await appendHookEvent(toolchain))) process.exit(0);

// Remember the start HEAD locally (no event) so session.end can compute the
// session-bounded delta. The sha never ships; only a commit COUNT does.
recordSessionStartGit(input);
