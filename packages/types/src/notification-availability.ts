/**
 * Content-free watch availability derived from installed-agent capability facts.
 * No event bodies, paths, prompts, or source content cross this boundary: only an
 * agent id, its resolved reporting contract, and the catalog watch ids.
 */
import type { ResolvedSessionCapabilities } from "./capabilities.ts";
import type { AgentId } from "./events.ts";
import type { SignalId } from "./intervention.ts";
import {
  SIGNAL_CATALOG,
  SIGNAL_IDS,
  type SignalEvidenceRequirement,
} from "./notification-catalog.ts";

export type NotificationAvailabilityState = "available" | "unavailable" | "unknown";

export interface NotificationSignalAvailability {
  state: NotificationAvailabilityState;
  /** Installed agents whose resolved contract satisfies every evidence requirement. */
  supportedBy: AgentId[];
}

export interface NotificationAvailability {
  /** Agents the worker has authoritative resident-session evidence for. */
  agents: AgentId[];
  signals: Record<SignalId, NotificationSignalAvailability>;
}

export interface NotificationAgentEvidence {
  agent: AgentId;
  capabilities: ResolvedSessionCapabilities;
}

function canObserveFailure(capabilities: ResolvedSessionCapabilities): boolean {
  return capabilities.toolResult === "both" || capabilities.toolResult === "failures-only";
}

function canMeasureCost(capabilities: ResolvedSessionCapabilities): boolean {
  return capabilities.cost === "billed" ||
    (capabilities.cost === "estimated" && capabilities.hasTokens);
}

export function agentSatisfiesSignalEvidence(
  evidence: NotificationAgentEvidence,
  requirement: SignalEvidenceRequirement,
): boolean {
  switch (requirement) {
    case "session-timing":
      // A resident session proves the worker has both timestamps needed by the
      // long-session and silence evaluators, even for a new agent family.
      return true;
    case "session-end":
      return evidence.capabilities.duration === "measured";
    case "per-call-cost":
      return canMeasureCost(evidence.capabilities) && evidence.capabilities.costScope === "call";
    case "daily-cost":
      return canMeasureCost(evidence.capabilities);
    case "retry-evidence":
      // Claude's evaluator has a deliberately agent-gated cadence fallback for
      // retained pre-result rows. Every other agent needs a real failure leg.
      return evidence.agent === "claude-code" || canObserveFailure(evidence.capabilities);
    case "tool-failure":
      return canObserveFailure(evidence.capabilities);
  }
}

/** Whether one resolved agent contract satisfies every requirement for a watch. */
export function agentCanFireSignal(
  evidence: NotificationAgentEvidence,
  id: SignalId,
): boolean {
  return SIGNAL_CATALOG[id].evidenceRequirements.every((requirement) =>
    agentSatisfiesSignalEvidence(evidence, requirement),
  );
}

export function deriveNotificationAvailability(
  evidence: readonly NotificationAgentEvidence[],
): NotificationAvailability {
  const agents = [...new Set(evidence.map((entry) => entry.agent))].sort();
  const signals = Object.fromEntries(
    SIGNAL_IDS.map((id) => {
      const supportedBy = evidence
        .filter((entry) => agentCanFireSignal(entry, id))
        .map((entry) => entry.agent)
        .filter((agent, index, all) => all.indexOf(agent) === index)
        .sort();
      return [
        id,
        {
          state: agents.length === 0
            ? "unknown"
            : supportedBy.length > 0
              ? "available"
              : "unavailable",
          supportedBy,
        },
      ];
    }),
  ) as Record<SignalId, NotificationSignalAvailability>;
  return { agents, signals };
}

export const UNKNOWN_NOTIFICATION_AVAILABILITY: NotificationAvailability =
  deriveNotificationAvailability([]);

/** Prefer the worker's all-resident-session contract, with a rolling-deploy
 * fallback to the selected-window agent ledger emitted by older workers. */
export function resolveNotificationAvailability(
  availability: NotificationAvailability | undefined,
  fallbackEvidence: readonly NotificationAgentEvidence[] = [],
): NotificationAvailability {
  return availability ?? deriveNotificationAvailability(fallbackEvidence);
}

const UNAVAILABLE_COPY: Record<SignalEvidenceRequirement, string> = {
  "session-timing":
    "This worker has not seen an agent session it can time, so this watch cannot fire.",
  "session-end":
    "None of the agents this worker has seen reports when a session ends, so this watch cannot fire.",
  "per-call-cost":
    "None of the agents this worker has seen measures cost for each tool call, so this watch cannot fire.",
  "daily-cost":
    "None of the agents this worker has seen can measure cost, so this watch cannot fire.",
  "retry-evidence":
    "None of the agents this worker has seen can report failed retries safely, so this watch cannot fire.",
  "tool-failure":
    "None of the agents this worker has seen reports tool failures, so this watch cannot fire.",
};

export function notificationAvailabilityExplanation(
  id: SignalId,
  state: NotificationAvailabilityState,
): string | null {
  if (state === "available") return null;
  if (state === "unknown") {
    return "Watch availability appears after Seorak captures an agent session.";
  }
  const firstRequirement = SIGNAL_CATALOG[id].evidenceRequirements[0];
  return firstRequirement
    ? UNAVAILABLE_COPY[firstRequirement]
    : "This watch has no verified evidence path on the agents this worker has seen.";
}
