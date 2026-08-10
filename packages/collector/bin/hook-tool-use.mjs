#!/usr/bin/env node
import { parseClaudeCodeHook } from "../src/adapters/claude-code.ts";
import {
  acquireHookInvocationLease,
  createHookEventAppender,
} from "../src/hook-append.ts";
import { readRawHookInput, toToolCall } from "../src/hooks.ts";

const releaseHookLease = await acquireHookInvocationLease();
if (!releaseHookLease) process.exit(0);
process.once("exit", releaseHookLease);

const appendHookEvent = createHookEventAppender();
const input = parseClaudeCodeHook(readRawHookInput());
if (
  input?.phase !== "toolUse" &&
  input?.phase !== "toolUseFailure"
) {
  process.exit(0);
}
const event = toToolCall(input);
if (event) await appendHookEvent(event);
