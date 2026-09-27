# Intervention

User-set attention boundaries during a live session. Intervention is the
actionable layer of Seorak's performance record. Local delivery helps at the
computer, while remote delivery serves **away oversight**. Parent:
[VISION.md](../VISION.md).

---

## Meaning

Reach the developer *while the session is still changeable* when a measured
condition crosses a boundary the developer chose. The nudge may be local or
remote. It is not a post-mortem, gamification to code more, or enforcement that
stops an agent. Enforcement is out of scope: Seorak observes and never controls
an agent ([ADR 008](../adr/008-seorak-observes-and-does-not-control-agents.md)).

| | Intervention (nudge) | Developer model |
|---|---------------------|-----------------|
| When | During session | Over weeks |
| Goal | Change course now | Learn your patterns |

Introspection may help a developer decide which existing settings to revisit,
but that decision remains theirs. Seorak does not convert an observed pattern
into a rule, change a threshold, or modify future agent behavior automatically.

---

## Flow

```
collector → worker → evaluate thresholds → D1 fire ledger → D1 outbox → push → APNs
```

API: `GET/PUT /settings`, `GET /interventions`, `GET /delivery-health`.

Code: `packages/worker/src/intervention.ts`,
`packages/worker/src/deliveryHealth.ts`,
`packages/types/src/notification-catalog.ts`,
`packages/types/src/delivery-health.ts`, web/mobile Alerts settings.

---

## Shipped: 8 stats

| Stat | Default | Use |
|------|---------|-----|
| `cost_spike` | $5 / session | Runaway spend |
| `high_burn_rate` | $0.50 / min | Accelerating cost |
| `long_session` | 60 min | Time box |
| `stuck_loop` | 3 errors / 5 repeats | Agent spinning |
| `went_cold` | 10 min silence | Forgotten session |
| `daily_cost_cap` | $20 / day | Budget (off by default) |
| `session_ended` | event | Optional summary |
| `first_error` | event | Early failure |

Each: enable/disable, numeric thresholds, optional `alwaysNotify` (break quiet hours).

**Customization:** global settings (web + mobile); per-project mute; per-project threshold overrides (mobile only). Quiet hours + timezone. Precedence: stored settings → env `SEORAK_*` → defaults.

**Honesty:** fire only on real measured crossings. A fire and an accepted delivery are different facts. Failed or malformed dispatcher responses never advance delivery truth. `[]` from `/interventions` means “nothing tripped” only after a successful validated read.

Delivery health is ledger history over 30 days by APNs environment — unobserved vs measured zero stay distinct. APNs acceptance is not device receipt.

Live Activity (ambient state) is separate — `live-activity-settings.ts`.

---

## Gaps (not a commitment schedule)

| Shape | Today |
|-------|--------|
| Time boxes | Partial: `long_session`, quiet hours |
| Budget | Partial: `daily_cost_cap` (USD, cross-project) |
| Project % / token thresholds | Not built |
| Automatic pattern-informed rules | Not planned; the developer changes settings after reviewing their own evidence |
| Sub-minute firing | Cron floor ~10 min |
| Act for you (auto-stop, remote approve) | Out of scope ([ADR 008](../adr/008-seorak-observes-and-does-not-control-agents.md)); the program that hosts a session controls it |
