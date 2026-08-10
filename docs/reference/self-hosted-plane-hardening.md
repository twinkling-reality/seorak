# The self-hosted plane: what replaces positional hardening

The collector's data plane binds `127.0.0.1` and requires no operator
credential. That is not an omission, it is an argument, and it is written into
[`local-plane.ts`](../../packages/collector/src/local-plane.ts): the plane is
hardened by **position** rather than by a secret, so a credential would only gate
the user away from their own disk.

A non-loopback bind mode destroys every premise of that argument at once. This
document is the replacement argument. It is written before the listener changed,
because a credential bolted onto a positional design is how a remote plane ends
up looking safe and not being safe.

Decided by [ADR 003](../adr/003-one-primary-ui-over-a-modular-data-plane.md)
(three legal planes, one route contract) and
[ADR 005](../adr/005-open-core-repository-and-free-ui-packaging.md) §5 (the
reference self-hosted service is the collector's own plane, not an extraction
from `packages/worker`).

---

## 1. What position actually buys

Not "it is local, therefore it is safe". Six separable properties, and a remote
mode owes an answer to each one individually.

| # | Property | Why loopback has it |
|---|---|---|
| P1 | **Unreachability.** No packet from off-machine can arrive at all. | The kernel will not route to `127.0.0.1` from outside. |
| P2 | **Caller identity.** The caller is a process on the machine that owns the history. | There is no other way to open the socket. |
| P3 | **Transport confidentiality and integrity.** Nothing can read or alter a request in flight. | The bytes never leave the kernel. |
| P4 | **No browser-mediated confusion.** A page on the web cannot reach the port under a name it controls, nor read a response. | `Host` must name loopback, a cross-origin `Origin` is refused, and no CORS header is ever sent. |
| P5 | **A minimal, closed write surface.** | Ordinary reads plus `PUT /settings`; exact owner integration issue/revoke and MCP POST live in closed route families. |
| P6 | **No ambient owner secret to steal.** Loopback ownership requires no operator credential. | Optional scoped integration credentials are separate, mandatory-expiry grants and never owner authority. |

P6 is the one that is easy to miss and the one that makes this stage
uncomfortable. Loopback is not merely *as strong as* a credential; on that axis
it is strictly stronger, because a property you do not have cannot be lost.

---

## 2. The replacement, property by property

| # | Replacement | Where |
|---|---|---|
| P1 | **Not replaced. Deliberately given up, and only on an explicit, complete opt-in.** Remote mode is off unless four settings are all present, and a partial configuration refuses to bind at all rather than binding something lesser. | `resolveSelfHostedBinding` |
| P2 | A 256-bit operator credential, stored mode-0600 and compared as a SHA-256 digest with `timingSafeEqual`, for ordinary and management routes. Exact API and MCP routes accept only their distinct exact-audience `srkx_` principal. | `admitOperatorRequest`; integration authority |
| P3 | **TLS terminated by the plane itself**, `minVersion` TLSv1.2, from an operator-supplied certificate and key. There is no plaintext remote mode and no flag that produces one. | `selfHostedTlsOptions` |
| P4 | The operator declares the **exact public origin**. Canonical `Host` and `Origin` are checked before target classification, credentials, or history; no CORS header is sent. | `admitRequestPosition` |
| P5 | The same exact ordinary, management, API, MCP, and discovery classification serves both bindings. Unknown children and aliases never fall through or select integration authority. | `classifyLocalPlaneRequestTarget` |
| P6 | **Not replaced.** A secret now exists and can be stolen. Mitigated (minted not chosen, 0600 enforced, never logged, rotatable in one command) and never claimed to be eliminated. | `mintSelfHostedCredential` |

### The two honest gaps

**P1 and P6 are not replaced, and no credential model can replace them.** The
moment a routable socket exists, an attacker can send it packets and a secret
exists to be lost. Any document claiming otherwise would be selling something.

What makes this shippable is not that the gaps are closed but that they are
**opt-in, complete, and off by default**:

- the Free product still opens with no account, operator key, or sign-in. Its
  loopback admission is deliberately stricter: Host carries the actual socket
  port and a present Origin must be the exact same loopback alias and port;
- remote mode cannot be half-enabled. A bind address without TLS, TLS without a
  credential, or a credential file with group-readable permissions each refuse
  to bind. There is no degraded remote plane to arrive at by accident;
- the residual risk is the operator's own, on infrastructure the operator chose
  to expose, which is exactly the trade a self-hoster is making on purpose.

The stop condition for this stage was "stop if the credential model cannot be
made as strong as the positional one it replaces". Read literally, on P1 and P6
it cannot, and pretending otherwise is the failure mode the condition exists to
catch. Read as it was meant, the question is whether the *reachable* plane is
protected as well as the unreachable one was, and whether enabling it can weaken
anything that exists today. Sections 3 and 4 are the answer: one positional
gate, one closed authority decision, and fail-closed binding.

---

## 3. One positional gate, then one closed authority decision

The property that makes positional hardening trustworthy is not any individual
check. `admitRequestPosition` runs **once for every request before the raw
target, Authorization, cookies, or SQLite are inspected**. Only after it admits
does `classifyLocalPlaneRequestTarget` choose an exact authority family:

```
position -> exact Host plus exact Origin or deliberate no-Origin native mode
ordinary/management -> loopback ownership or self-hosted operator bearer
/api/v1 exact reads -> exact <trusted-origin>/api/v1 srkx_ bearer
/mcp/private POST   -> exact <trusted-origin>/mcp/private srkx_ bearer
reserved/unknown    -> refusal without selecting integration authority
```

Consequences that are deliberate, not oversights:

- **`/health` and `/data-plane` require operator authority on self-hosted.** An
  operator's monitor sends the operator credential.
- **Credentials cannot cross families.** The operator bearer fails API/MCP;
  API and MCP grants fail each other; every `srkx_` bearer fails ordinary and
  management routes, including on loopback.
- **Unknown paths never choose integration authentication.** Whole integration
  and local discovery namespaces are reserved before generic routing. Local
  OAuth, authorization-server, and OpenID discovery answer honest 404s.
- **The descriptor is not readable without the credential.** That is the point:
  `ManagedSyncCoverage` carries activity instants, and an open descriptor would
  leak when the operator last worked to anyone who can reach the port.

### The credential is never ambient

The loopback plane deliberately does not verify `x-seorak-csrf`, because a
cross-site `PUT` would need a CORS preflight the plane never answers. That
argument survives the move to remote **only if the credential cannot ride along
automatically**.

So: **the plane never reads a `Cookie` header, and never sets one.** The
credential is accepted in exactly one place, `Authorization: Bearer`, which a
cross-site page cannot set without a preflight the plane never answers. CSRF is
therefore structurally impossible in remote mode for the same reason it is on
loopback, rather than by a token check. A test pins it by presenting the correct
credential in a cookie and requiring `401`.

---

## 4. Fail closed at bind time

Four settings, all required together. Any one missing and the plane does not
bind a routable socket:

| Setting | Requirement |
|---|---|
| `SEORAK_SELF_HOSTED_ORIGIN` | exact public origin, scheme must be `https:`, no path |
| `SEORAK_SELF_HOSTED_BIND` | interface address to listen on |
| `SEORAK_SELF_HOSTED_TLS_CERT` | absolute path to a PEM certificate chain |
| `SEORAK_SELF_HOSTED_TLS_KEY` | absolute path to the PEM private key |

Plus the credential file at `<SEORAK_DIR>/self-hosted-credential`, which the
plane will not create for itself. `seorak remote credential` mints it. An
operator who has not run that command has not enabled remote access, and the
daemon says so instead of quietly binding.

The listen port is the origin's port. There is no separate port setting, because
a bind port that differs from the declared origin means something is rewriting
`Host` in between, and this plane terminates its own TLS precisely so that
nothing is.

Refusals at startup, each an exception rather than a warning:

- a non-`https:` origin, an origin with a path, or an unparseable one;
- a missing or unreadable certificate or key;
- a credential file that is absent, or whose mode grants any group or other
  permission, or whose contents are not the minted shape;
- a remote port equal to the loopback plane's port.

### Why the credential is minted, not chosen

An operator-supplied secret is only as good as the operator's imagination, and
the failure is silent. The plane generates 32 bytes from `randomBytes` and
encodes them base64url, which is 43 characters. The loader requires exactly that
alphabet and at least that length, so a hand-edited weak secret is refused rather
than accepted.

It is not read from the environment. Environment variables surface in process
listings, crash dumps, and service definitions; a mode-0600 file in the state
directory is rotatable in one command without editing the service, and its
permissions are checkable, which is what section 3's "fail closed" needs.

**Asymmetry worth naming:** the plane enforces mode on the credential file and
does *not* on the TLS private key. It mints the credential, so it owns that
file's permissions; the TLS key is provisioned by the operator's own CA tooling,
where a group-readable key owned by a certificate group is a normal and
deliberate arrangement. Refusing it would be Seorak dictating someone else's
key management.

---

## 4b. Work the credential buys, and the one route that bounds it

Written after stage A4, which closed `sessionOutcome`, `developerModel`, and
`interventions` on the plane, was reconciled onto this one.

A credential answers "may this caller read?". It does not answer "how much work
may this caller cause?", and on a routable socket those stop being the same
question. Every read here has a bounded response: the outcome read returns a
fixed handful of counts and enums no matter how large the session behind it is.
What is not bounded is the scan.

**`GET /sessions/:id/outcome` carries a row budget on the routable binding and
none on loopback.** A4 waived the hosted route's refusal with a sentence this
stage falsified: "this reads the local file the user already owns, so there is
nothing to protect and a refusal would only withhold their own history." Every
word of it depends on the caller being the person at the keyboard. Loopback
proves that positionally; a credential proves only possession of a secret, and
the cost of the scan lands on the machine that owns every session.

So the budget follows the BINDING, not the plane:

| Binding | Budget | Why |
|---|---|---|
| loopback | none | A4's argument holds in full; a refusal would withhold the user's own history on their own machine |
| self-hosted | `SESSION_OUTCOME_MAX_ROWS` | cheap request, unbounded work, fixed-size answer, and the hosted route already refuses exactly this shape |

The refusal is the shared `SessionOutcomeRefusal` (`413`,
`code: "session_outcome_limit"`), the same one the hosted worker emits, so no
client learns a second dialect. The preflight is a bounded `COUNT` stopped at
`budget + 1` on the `(session_id, local_seq)` index, so asking the question never
costs the scan it avoids, and it runs after the displayability gate so a refusal
cannot reveal that a hidden session exists.

`SESSION_OUTCOME_MAX_ROWS` moved into `@seorak/types` for this. It is a public
wire field on a refusal two independent implementations now emit, and two
literals that must agree is the drift that file exists to prevent.

**This is not a general answer to work amplification, and should not be read as
one.** It is the one route where a comment claimed a guard was unnecessary for a
reason this stage removed. Whether other reads want budgets on a routable binding
is a real question and an unanswered one; nothing here has audited it.

### The desktop notifier is not reachable from a request

A4 also added local delivery: the daemon sweeps, records what crossed a
threshold, and posts an `osascript` banner on the host. A routable plane must not
turn a network request into a notification on somebody's screen, and it does not
— structurally, not carefully.

`sweepLocalInterventions` and `deliverLocalInterventions` have exactly one caller
each, and it is a daemon TIMER. The plane's `/interventions` route calls
`listLocalInterventions`, which reads the recorded ledger and evaluates nothing.
`local-plane.ts` imports neither the sweep nor the notifier, and a test asserts
that import boundary rather than a runtime behaviour, because that is where it
can actually be broken.

**The honest limit of that claim:** `PUT /settings` is a declared write surface
on both bindings, and the sweep reads the notification family it writes. A
credential holder cannot cause a banner now, but can change which watches a later
daemon tick evaluates. That is the same authority the loopback dashboard has over
the same file, and it is the authority the credential is meant to carry rather
than a hole in it.

---

## 5. What the self-hosted plane says about itself

```
descriptor = { authority: "remote", operator: "self-hosted",
               credentialRequired: true, surfaces: [...] }
lifecycle  = null      (structurally, always)
rebaseline = null      (structurally, always)
coverage   = measured
```

`parseDataPlaneStatus` refuses a `ManagedLifecycleWindow` or a
`RebaselineDirective` on a `self-hosted` operator. That refusal is what keeps
"Seorak never meters a service you run" true by construction, so the self-hosted
status builder does not relay the lifecycle window the *local* status builder
correctly does relay. Same machine, same history, different plane, and only one
of the two may describe a billing window.

**Coverage is measured, not asserted.** This binding serves the same
`history.sqlite` the loopback binding serves, so the "remote copy" the UI is
reading is the local record itself:

- `state: "current"` — there is no upload queue between the UI and the rows;
- `backlog: {0, 0, 0}` — zero local records are absent from what this plane
  serves, by construction;
- `synchronizedThrough` — `MAX(at)` over `local_event`, a real query, clamped so
  it can never be reported after the instant of observation;
- `pendingFrom: null`, `lastAcceptedAt: null`, `lastAttemptAt: null` — nothing
  was ever uploaded, and inventing an acknowledgement ledger for a plane that
  reads in place would be the fabrication this contract exists to prevent;
- `managedCopyComplete` follows from the above through the shared parser's own
  invariant, so on an empty install it is `false`, because there is no
  acknowledged instant and nothing to be complete about.

This is the one claim in the design that would become a lie under a future
change: if a self-hosted plane ever served a *copy* rather than the same
database, every line above would need re-deriving from the copy. That is why it
is spelled out here and in the code rather than left to read as boilerplate.

### Why the shared parser does not require `credentialRequired` on a remote plane

It would be symmetric with the local rule, and it is deliberately not added.
`packages/types` describes what a plane claims; it does not get to dictate an
operator's network architecture. A plane behind mutual TLS or on a private
network legitimately requires no credential of its own, and refusing that
descriptor in a publish-safe parser would refuse a correct deployment.

The constraint that matters is enforced where it can be: the plane that binds the
socket will not bind a routable one without a credential. The contract describes;
the implementation refuses.

---

## 6. Deliberately not done

- **No rate limiting on the operator credential check.** Against 256 bits of
  entropy it is theatre. Integration grants are different: each has a
  persistent 60/min token bucket plus a plane route-class backstop, and outcome
  and replay retain row budgets.
- **No session cookie, no CSRF token check.** Section 3 explains why both would
  be weaker than what is already there.
- **No `--insecure` or plaintext remote escape hatch.** Every one of these ends
  up in somebody's production.
- **No second operator tier.** The operator credential remains whole-plane
  ownership. Integration scopes are a distinct external principal and cannot
  widen into operator authority.
- **The `Host` check is not relaxed for reverse proxies.** The plane terminates
  its own TLS. An operator who puts a proxy in front and rewrites `Host` must
  make it pass through the declared origin.

---

## 7. What a reviewer should check

1. `admitRequestPosition` is called exactly once before target classification,
   credentials, or database work, and no handler is reachable around it.
2. The classifier selects ordinary, management, API, MCP, or refusal exactly
   once; no child, alias, or discovery path falls through.
3. `resolveSelfHostedBinding` throws rather than returning a partial binding, and
   the daemon does not bind on a throw.
4. The credential is compared only through a fixed-length digest and
   `timingSafeEqual`, and the raw value is not retained after startup.
5. Loopback Host carries the trusted socket port; present Origin is canonical,
   exact, and same-alias; its descriptor still reports `credentialRequired: false`.
6. Nothing in the remote path can produce a `ManagedLifecycleWindow`.
7. Every surface the descriptor declares actually answers on the routable
   binding, and the two it does not are absent from it. `integrations` means all
   of management, HTTP API, and MCP together.
8. No request handler can reach the intervention sweep or the desktop notifier.
