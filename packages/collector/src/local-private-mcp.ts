import {
  createMcpHandler,
  fromJsonSchema,
  McpServer,
  type JsonSchemaType,
  type JSONObject,
  type McpHttpHandler,
  type McpRequestContext,
} from "@modelcontextprotocol/server";
import {
  PRIVATE_MCP_JSON_OBJECT_OUTPUT_SCHEMA,
  PRIVATE_MCP_TOOL_CATALOG,
  type PrivateMcpListSessionsInput,
  type PrivateMcpPeriodSummaryInput,
  type PrivateMcpReplayLensInput,
  type PrivateMcpSessionOutcomeInput,
  type PrivateMcpToolName,
} from "@seorak/types";
import {
  InvalidLocalIntegrationCursorError,
  LocalIntegrationAuthorityChangedError,
  LocalIntegrationCursorCapacityError,
  LocalIntegrationPageChangedError,
  type LocalIntegrationPrincipal,
} from "./local-integration-store.ts";
import {
  queryLocalPrivateOutcome,
  queryLocalPrivatePeriod,
  queryLocalPrivateReplayLens,
  queryLocalPrivateSessions,
} from "./local-private-queries.ts";
import {
  LocalReplayTooLargeError,
  LocalSessionOutcomeTooLargeError,
} from "./local-projection.ts";

export const LOCAL_PRIVATE_MCP_LEGACY_POLICY = "stateless" as const;

export interface LocalPrivateMcpToolHandlers {
  period_summary(input: PrivateMcpPeriodSummaryInput): JSONObject | Promise<JSONObject>;
  list_sessions(input: PrivateMcpListSessionsInput): JSONObject | Promise<JSONObject>;
  get_session_outcome(
    input: PrivateMcpSessionOutcomeInput,
  ): JSONObject | Promise<JSONObject>;
  replay_lens(input: PrivateMcpReplayLensInput): JSONObject | Promise<JSONObject>;
}

export type LocalPrivateMcpToolHandlerFactory = (
  context: McpRequestContext,
) => LocalPrivateMcpToolHandlers;

export interface LocalPrivateMcpQueryOptions {
  directory?: string;
  now?: () => Date;
}

export function isLocalPrivateMcpQueryRefusal(error: unknown): boolean {
  return error instanceof InvalidLocalIntegrationCursorError ||
    error instanceof LocalIntegrationAuthorityChangedError ||
    error instanceof LocalIntegrationCursorCapacityError ||
    error instanceof LocalIntegrationPageChangedError ||
    error instanceof LocalReplayTooLargeError ||
    error instanceof LocalSessionOutcomeTooLargeError;
}

export function signalLocalPrivateMcpQueryRefusals(
  handlers: LocalPrivateMcpToolHandlers,
  refused: () => void,
): LocalPrivateMcpToolHandlers {
  const run = async (operation: () => JSONObject | Promise<JSONObject>) => {
    try {
      return await operation();
    } catch (error) {
      if (isLocalPrivateMcpQueryRefusal(error)) refused();
      throw error;
    }
  };
  return {
    period_summary: (input) => run(() => handlers.period_summary(input)),
    list_sessions: (input) => run(() => handlers.list_sessions(input)),
    get_session_outcome: (input) =>
      run(() => handlers.get_session_outcome(input)),
    replay_lens: (input) => run(() => handlers.replay_lens(input)),
  };
}

function queryOptions(options: LocalPrivateMcpQueryOptions) {
  return {
    ...(options.directory === undefined ? {} : { directory: options.directory }),
    ...(options.now === undefined ? {} : { now: options.now() }),
  };
}

function jsonObject(value: object): JSONObject {
  return value as JSONObject;
}

/** Bind the closed MCP tool catalog directly to the collector's canonical DTO queries. */
export function createLocalPrivateMcpQueryHandlers(
  principal: LocalIntegrationPrincipal,
  options: LocalPrivateMcpQueryOptions = {},
): LocalPrivateMcpToolHandlers {
  return {
    period_summary: (input) =>
      jsonObject(
        queryLocalPrivatePeriod(
          principal,
          input.rangeDays,
          queryOptions(options),
        ),
      ),
    list_sessions: (input) =>
      jsonObject(
        queryLocalPrivateSessions(principal, {
          ...queryOptions(options),
          cursor: input.cursor ?? null,
          limit: input.limit ?? 50,
        }),
      ),
    get_session_outcome: (input) =>
      jsonObject(
        queryLocalPrivateOutcome(
          principal,
          input.sessionRef,
          queryOptions(options),
        ),
      ),
    replay_lens: (input) =>
      jsonObject(
        queryLocalPrivateReplayLens(
          principal,
          input.sessionRef,
          input.lens,
          queryOptions(options),
        ),
      ),
  };
}

function toolDefinition(name: PrivateMcpToolName) {
  const definition = PRIVATE_MCP_TOOL_CATALOG.find(
    (candidate) => candidate.name === name,
  );
  if (!definition) {
    throw new Error(`missing private MCP tool catalog entry: ${name}`);
  }
  return definition;
}

function encodedResult(output: JSONObject) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(output) }],
    structuredContent: output,
  };
}

function buildLocalPrivateMcpServer(
  handlers: LocalPrivateMcpToolHandlers,
): McpServer {
  const server = new McpServer({
    name: "seorak-local-private",
    version: "1.0.0",
  });
  const outputSchema = fromJsonSchema<JSONObject>(
    PRIVATE_MCP_JSON_OBJECT_OUTPUT_SCHEMA as JsonSchemaType,
  );
  const periodSummary = toolDefinition("period_summary");
  const listSessions = toolDefinition("list_sessions");
  const sessionOutcome = toolDefinition("get_session_outcome");
  const replayLens = toolDefinition("replay_lens");

  server.registerTool(
    periodSummary.name,
    {
      description: periodSummary.description,
      inputSchema: fromJsonSchema<PrivateMcpPeriodSummaryInput>(
        periodSummary.inputSchema as JsonSchemaType,
      ),
      outputSchema,
      annotations: periodSummary.annotations,
    },
    async (input) => encodedResult(await handlers.period_summary(input)),
  );
  server.registerTool(
    listSessions.name,
    {
      description: listSessions.description,
      inputSchema: fromJsonSchema<PrivateMcpListSessionsInput>(
        listSessions.inputSchema as JsonSchemaType,
      ),
      outputSchema,
      annotations: listSessions.annotations,
    },
    async (input) => encodedResult(await handlers.list_sessions(input)),
  );
  server.registerTool(
    sessionOutcome.name,
    {
      description: sessionOutcome.description,
      inputSchema: fromJsonSchema<PrivateMcpSessionOutcomeInput>(
        sessionOutcome.inputSchema as JsonSchemaType,
      ),
      outputSchema,
      annotations: sessionOutcome.annotations,
    },
    async (input) => encodedResult(await handlers.get_session_outcome(input)),
  );
  server.registerTool(
    replayLens.name,
    {
      description: replayLens.description,
      inputSchema: fromJsonSchema<PrivateMcpReplayLensInput>(
        replayLens.inputSchema as JsonSchemaType,
      ),
      outputSchema,
      annotations: replayLens.annotations,
    },
    async (input) => encodedResult(await handlers.replay_lens(input)),
  );

  return server;
}

/**
 * Official SDK v2 stateless Streamable HTTP seam. It performs no bearer
 * verification itself. The mounted resource layer supplies a validated
 * principal before this inner tool handler is invoked.
 */
export function createLocalPrivateMcpHandler(
  handlers: LocalPrivateMcpToolHandlerFactory,
): McpHttpHandler {
  return createMcpHandler(
    (context) => buildLocalPrivateMcpServer(handlers(context)),
    {
      legacy: LOCAL_PRIVATE_MCP_LEGACY_POLICY,
      responseMode: "json",
    },
  );
}

/**
 * Official modern-envelope preflight with the same four schemas but no query
 * execution. A resource server uses this before body-derived authorization
 * classification so malformed headers cannot select or spend a route class.
 */
export function createLocalPrivateMcpValidationHandler(): McpHttpHandler {
  const empty = async () => jsonObject({});
  return createMcpHandler(
    () =>
      buildLocalPrivateMcpServer({
        period_summary: empty,
        list_sessions: empty,
        get_session_outcome: empty,
        replay_lens: empty,
      }),
    { legacy: "reject", responseMode: "json" },
  );
}
