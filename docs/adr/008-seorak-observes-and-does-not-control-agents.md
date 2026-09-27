# ADR 008: Seorak observes agents; it does not control them

- **Status:** accepted. Decided 2026-09-26 by the owner.
- **Date:** 2026-09-26
- **Supersedes:** the parked agent-control design in
  `docs/reference/agent-control-feasibility.md` (verified 2026-07-30, never built).

## Context

Seorak's third job is away oversight. Nudges and notifications shipped. Acting on
a running session was parked: a design existed to approve, deny, and stop
sessions through blocking `PreToolUse` and `PermissionRequest` hooks, and it
concluded all three were feasible. Nothing of it was built.

Two facts settle it now.

1. **Blocking hooks are global.** Seorak installs its hooks once, in the
   developer's own agent configuration, so they fire for every session on the
   machine, including sessions nobody asked Seorak to control. A control hook
   there reaches work the developer started in a terminal, work another program
   started, and work that program is already controlling.
2. **Control has a better owner.** A program that launches and hosts a session
   already holds that runtime's own control surface: an SDK permission callback,
   an app-server approval request, an interrupt. It can approve, deny, and stop
   exactly the sessions it hosts, with no hook and no change to the developer's
   configuration. If Seorak also answered prompts through hooks, two products
   would race to answer the same prompt, and one of them would need a rule for
   which wins. The feasibility study already judged remote approval a commodity
   that the agent vendors ship themselves.

## Decision

- **Seorak stays observational.** It measures, reports, and nudges. It never
  installs a blocking hook, never answers a permission prompt, and never stops,
  steers, or approves an agent's work. Its hooks exit without a decision.
- **Control belongs to whatever hosts the session**, through that runtime's own
  API, and only for the sessions it hosts. Seorak does not coordinate with,
  arbitrate between, or depend on such a program. What Seorak offers it is the
  same read-only, versioned Integration API every consumer gets, including the
  resolve read and launcher labels in
  [ADR 007](./007-native-session-resolve-and-launcher-labels.md), with no feature
  specific to any one consumer.
- **Nudges and notifications stay in scope.** Telling the developer that an agent
  has been retrying the same fix for twenty-five minutes is observation. Acting on
  it is the developer's call, made in whatever tool hosts the session.
- **The optional glasses companion (`Glasses/`) stays a read-only glance.** It
  shows measured state and freshness. It gains no approve, deny, or stop action;
  interactive control on a wearable belongs to the program that hosts the session.

## Consequences

- `docs/reference/agent-control-feasibility.md` is superseded. It stays as a
  dated record of what was verified, and it must not be read as a plan.
- The "act for you" row leaves the parked list and becomes out of scope, in
  [VISION](../VISION.md), [STATUS](../STATUS.md), the
  [intervention spec](../specs/intervention.md), and
  [voice and scope](../reference/voice-and-scope.md).
- Seorak's value to a session host is measurement it cannot produce itself:
  estimated cost, errors, commits landed, line survival, and the verification
  lens, joined to the session it launched.
- Revisit only if a runtime ships a documented, shared control channel that
  several clients can use safely at once. Even then, the question is whether
  Seorak should control anything, not how.

## Rejected alternatives

- **Build the parked design.** Global blocking hooks reach sessions nobody asked
  Seorak to control, and they collide with any program that hosts sessions and
  answers the same prompts through the runtime's own API.
- **A shared control service** used by Seorak and session hosts alike. It would
  couple independent products to one component for a need only a session host
  has.
- **Keep it parked.** A parked design keeps inviting work. Writing the decision
  down is what stops the next reader from rebuilding the feasibility study.
