# Voice and scope

Copy rules and boundaries. Product narrative: [VISION.md](../VISION.md).

---

## Voice

Warm, plain, direct. Not enterprise-dashboard. Not HR coaching.

- User-facing: **stat** (catalog symbol: `SEORAK_SIGNALS`)
- Push: direct — *"Your agent has been retrying the same fix for 25 minutes"*
- Avoid: performance management, on-call/pager language, marketing speak, patronizing nudges
- **No middot (`·`) in product copy** — use commas, **and**, or separate sentences. `npm run copy:check` scans production surfaces. See [agent-standards.md](./agent-standards.md).
- Marketing: calibrated candor; mark example data; no fabricated stats

Design system: `packages/web/DESIGN_LANGUAGE.md`.

### Empty, quiet, and not-yet states

An honest-empty state is a sentence spoken TO the person:

1. **Says what's true now** — never bare `N/A` / `No data` / `—`.
2. **Names the one thing that fills it next** — absence as “where your work shows up,” not a dead cell.

Keep the reader's vocabulary. No plumbing jargon, no fake activity, no unmeasured promise.

- Cold: *"Nothing is running right now."* → Warm: *"Nothing is running right now. Your next session shows up here live."*

**Heroes never render blank.** Measured standouts stay honest-empty when unmeasured; the hero still speaks for its rung (loading → offline → first-run → collecting → ready). Mobile Home always keeps a live card (`apps/mobile/src/lib/homeDeck.ts`).

**A card in a rotating deck must be checkable.** Nothing enters the deck that is not a measurement from the owner's work.

---

## Public evidence

The public profile and project gallery are a selective projection of the
developer's private record. They are not a scorecard.

- Separate user-authored descriptions from Seorak-measured evidence.
- Call the calendar **agentic-development activity**, not productivity,
  performance, output, or impact.
- A streak means consecutive measured active days only. It does not prove
  improvement, quality, consistency of outcomes, or developer ability.
- Call the portable embed **token usage** (with window and tool lines). Never
  call it productivity, skill, grades, impact, or a peer comparison. Tokens
  never feed calendar intensity.
- Put the measurement window, coverage, and unavailable state beside any public
  stat that needs them to be interpreted honestly.
- Never say "verified developer," "proven productivity," "proof of
  improvement," or "better developer" based on Seorak activity.
- Never imply that publishing a profile exposes prompts, code, commands, raw
  event content, or unselected private history.

---

## Out of scope

- Team coordination (locks, presence)
- Manager / HR / enterprise productivity (not DX)
- Peer leaderboards of developer productivity
- Cross-vendor memory products
- Conversation sentiment or topic classification
- IDE features
- General chatbot
- Automatic improvement loops, personal agent playbooks, or adaptive rules that
  change future agents from observed patterns
- Invented paid tiers or meters without a clear refusal-to-lose habit

**In scope (human, stubbed):** grounded stat chat over the owner's own snapshot — not a general assistant.

**Out of scope:** acting on an agent, meaning approving, denying, stopping, or
steering it. Seorak observes; the program that hosts a session controls it
([ADR 008](../adr/008-seorak-observes-and-does-not-control-agents.md)).

**Parked (see VISION):** a read-only multi-session phone cockpit. The API/MCP and public
profile roadmap now has a backend foundation, but no UI or hosted availability
claim until its remaining trust and deployment boundaries are operated.

Capture today: Claude Code and Codex ([specs/multi-tool.md](../specs/multi-tool.md)).

---

## Open tensions

| Tension | Lean |
|---------|------|
| Volume vs effectiveness | Effectiveness = outcome \| dimension, never volume \| dimension |
| “Performance” framing | Work outcomes only; no person-grades |
| Surface allocation | Validate with users; mobile bet is live + interrupts |
| Intervention expressiveness | User-set catalog + numbers; no automatic adaptation from observed patterns |
| Pro / monetization | $12 managed infrastructure only; validate demand without inventing feature fences |
| Committed vs `.port/` | `docs/` is truth; promote from `.port/` when decisions land |

---

## Competitive (one line each)

- **Agentlytics:** free retrospective dashboards — Seorak adds live multi-surface + attention nudges
- **DX:** enterprise, manager-bought — Seorak is solo, user-bought
- **Git AI / Agent Trace:** attribution-only — Seorak is session + live + nudge + replay
- **Vendor remote control:** approve/deny for one tool — Seorak’s parked bet is multi-project context beside the decision, not a skin on Remote Control
- **Memory tools:** different problem

---

## OSS extraction

The public core is Apache-2.0 `@seorak/types`, the collector CLI (published as
the unscoped `seorak`), and `@seorak/dashboard`, the last being the built primary
UI the collector's loopback plane serves. The private cloud keeps identity, billing, provisioning, managed
cells, APNs, the operated directory, and Seorak's website. Decision, ownership
matrix, and migration sequence:
[ADR 005](../adr/005-open-core-repository-and-free-ui-packaging.md).

The earlier collector-only note is superseded. Nothing has been extracted or
published yet, so do not write copy in the present tense.

**Copy rule.** Say **open source** only of code that is genuinely Apache-2.0 and
whose complete source is published. Source-available licences (BUSL, Elastic,
SSPL, FSL) are not open source and Seorak does not use one. Never describe
community self-hosting as Seorak-managed infrastructure.
