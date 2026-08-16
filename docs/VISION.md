# Product vision

Seorak gives an individual developer an **honest, holistic view of performance
across coding-agent work**. It helps them understand what agents did, choose
when work needs attention, and learn when and under which measured conditions
work tends to hold up.

**Buyer:** the developer. Not a manager. Not HR.

---

## The problem

Agentic coding spreads attention: many repos, more than one agent (Claude Code, Codex, …), cost and thrash that are easy to miss, and little honest feedback on whether a day or week of AI-assisted work actually landed.

Vendor usage pages answer “how many tokens.” They do not answer “how did development go,” “which projects and agents paid off,” or “do I need to look right now.”

Seorak does not maximize keyboard hours. It measures the **performance of the work**, never grades the person. Honest-empty beats invented trends.

---

## Core product loop

Seorak turns a private record of agentic development into a human-directed
feedback loop:

1. **Insight:** see agent activity, cost, failures, and outcomes across projects
   and tools.
2. **Intervention:** set the boundaries that determine when a live run needs
   attention.
3. **Introspection:** review when, where, and with which tools work tended to
   hold up, then decide what to change.

The developer closes this loop. Seorak supplies measured evidence and
user-chosen boundaries. It does not infer an unmeasured causal explanation,
grade the person, prescribe a personal playbook, change intervention settings,
or modify future agent behavior automatically.

---

## Three jobs

| Job | Question | Cadence |
|-----|----------|---------|
| **Period clarity** | How did this day / week / month go across projects and agents? | Session → weeks |
| **Developer model** | Who have I been lately as a developer, and when does my work tend to last? | Weeks → months |
| **Away oversight** | When an agent needs me (or is wasting a session), can I see it and act without sitting at the laptop? | Live |

Everything in the product should serve one of these. Supporting machinery (capture, replay, live surfaces, intervention nudges) is how the jobs get done, not a fourth peer mission.

| Support | Serves |
|---------|--------|
| Session stat (terminal, web, mobile) | Clarity + away oversight |
| Web Overview (customizable widget board) | Period clarity evidence and drill |
| Web Compare (same scope, adjacent equal windows) | Period clarity change over time |
| Terminal narrative | Period clarity in prose |
| Intervention (local or remote nudge when user-set thresholds cross) | Away oversight + in-session course correction |
| Replay (keyframes worth reviewing) | Period clarity |
| Developer model (`GET /developer-model`) | Developer model |

Surface jobs: [specs/surfaces.md](./specs/surfaces.md). Ship state: [STATUS.md](./STATUS.md).

---

## Build focus and long-term roadmap

**Build for value you feel without a paid story:**

1. **Period clarity** — make the window answerable. Terminal speaks in prose; web Overview keeps the customizable board and offers an opt-in **Summary** glass chip (same chrome and one-word label pattern as Customize / Ask; before the range pills → bottom fade with the read).
2. **Developer model** — period-scoped identity and payoff from measured data; self-baselines and Claude-vs-Codex on *your* work only. No peer norms, no person grades.

**Long-term roadmap (sequenced, not current build focus):**

1. **Versioned read-only API/query contract** — turn Seorak's typed query contracts into a stable external foundation for grounded period, session, outcome, and Replay evidence without exposing raw captured content.
2. **Private MCP** — expose a least-privilege MCP surface over the versioned query contract so a developer can authorize an agent to read the same grounded results the developer can inspect in Seorak.
3. **Public developer profile + project gallery** — an opt-in,
   evidence-backed showcase built from the same private record, with a
   GitHub-style agentic-development activity history and selected projects.
   Nothing is public by default. The developer chooses and can revoke which
   profile fields, projects, stats, and evidence are public; separately chooses
   web, API, and MCP discoverability; and may enable a contact path so potential
   collaborators or recruiters can reach out.

   **Current availability:** hidden. The implementation and publication
   foundations remain in the repository, but navigation, public routes,
   publication controls, public reads, metadata, and discovery documents are
   default-off until a separate launch review approves restoring them.

One use of the gallery is a project-scoped build record. A developer can attach
selected, bounded evidence to public work so a hackathon judge, collaborator,
maintainer, client, or other reviewer can understand more than a short demo or
project description reveals. The project remains the object being evaluated.
Its published Seorak evidence adds context about the observed development
process, not a verdict about quality, authorship, productivity, or developer
ability.

Public API/MCP discovery reads only the explicitly published projection. It never widens a private Seorak credential or turns private history into public data. The API/query contract comes first, private MCP follows it, and the public profile and project gallery build on that boundary.

These are extensions of the core product, not a separate mission. Private API
and MCP access let authorized tools use the developer's measured record. The
public profile and project gallery let the developer selectively showcase that
record alongside the projects it describes.

**Parked (do not build to invent a tier):**

| Bet | Why parked |
|-----|------------|
| **Away control plane** | Approve/deny, multi-session phone cockpit, richer next actions, Live Activity as an actionable card. Commodity if it is approve-only; interesting only as Seorak’s multi-project/multi-agent context beside the decision. |
| **Paid Pro** | Planned at $12/month or $120/year for Seorak-operated sync, remote continuity, and intervention delivery. The same capabilities are reachable on Free through a compatible service the developer operates, so Pro sells operation, not features. Billing is not live. |

Intervention **nudges** (tell you) stay in scope. Intervention **enforcement**
(act for you) stays parked with the away control plane. Automatic adaptation of
intervention settings or future agent behavior is not part of the product loop.

---

## Monetization (honest)

There is **no sold Pro tier yet**. Free and Pro contain the **same product
capabilities**, and Pro adds no exclusive feature. Free is the complete local
product with no account and no artificial limit on history, events, projects,
reports, replay, or export, and it performs no Seorak-managed product-data
upload. Remote access, cross-device use, and alerts are available on Free
through a compatible service the developer operates, and on Pro through
infrastructure Seorak operates. History windows are not a meter. Purchase
claims remain prohibited until managed operations and an approved payment path
are proven.

---

## Not Seorak

Team coordination, manager/HR productivity, IDE features, cross-vendor memory products, sentiment classification, general chatbot, peer leaderboards of “developer productivity.”

Full list and copy rules: [reference/voice-and-scope.md](./reference/voice-and-scope.md).

Capture today: **Claude Code** and **Codex**. Capability honesty: [specs/multi-tool.md](./specs/multi-tool.md).
