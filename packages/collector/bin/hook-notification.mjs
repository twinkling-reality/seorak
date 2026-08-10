#!/usr/bin/env node
import { parseClaudeCodeHook } from "../src/adapters/claude-code.ts";
import {
  acquireHookInvocationLease,
  createHookEventAppender,
} from "../src/hook-append.ts";
import { readRawHookInput, toSessionNotification } from "../src/hooks.ts";

const releaseHookLease = await acquireHookInvocationLease();
if (!releaseHookLease) process.exit(0);
process.once("exit", releaseHookLease);

// The Notification hook is the live-ambient "needs you" signal: we emit the
// notification kind enum only, never the message text.
const appendHookEvent = createHookEventAppender();
const input = parseClaudeCodeHook(readRawHookInput());
if (input?.phase !== "notification") process.exit(0);
const event = toSessionNotification(input);
if (event) await appendHookEvent(event);
