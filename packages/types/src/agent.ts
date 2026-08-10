/**
 * Which agent produced a session. This leaf module exists so event payloads can
 * depend on capabilities without capabilities importing the event graph back.
 */
export type AgentId = "claude-code" | "codex" | (string & {});
