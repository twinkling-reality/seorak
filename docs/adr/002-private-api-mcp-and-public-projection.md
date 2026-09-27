# ADR 002: Private integration queries and public publication are separate systems

- **Status:** accepted; implemented in the collector's loopback/self-hosted
  planes and in the owner cell; hosted private OAuth rollout pending. Section 3's
  catalog is amended by
  [ADR 007](./007-native-session-resolve-and-launcher-labels.md), which adds a
  fifth tool and one HTTP read without changing section 1's identifier rule
- **Date:** 2026-08-02
- **Decision owners:** product and backend

## Context

Seorak has useful typed HTTP responses and strong owner-cell isolation, but it
does not yet have an external integration boundary. The current installed-client
`read` credential reaches nearly every product read route. The current response
types also carry internal session and salted repository identifiers. They are
content-minimized and safe to ship between first-party surfaces; that does not
make them safe as a stable third-party or anonymous-public contract.

The identity control plane selects one exact Personal or Shared owner cell and
has no binding to owner event data. That boundary is valuable and remains. A
global gallery cannot query isolated cells through the control plane, so public
discovery needs a new public-only projection/index.

Replay already demonstrates the desired compute seam: content-free evidence is
derived from retained rows, while pure lens results are serializable. Today the
lens orchestration still depends on web-only input types, so the backend seam
must be made explicit rather than exposing the web implementation as-is.

## Decision

### 1. One canonical query service per storage authority, two data contracts

Each storage authority owns one canonical private query service: the worker for
owner-cell D1 and the collector for `history.sqlite`. In either plane, versioned
HTTP and MCP adapters call that service. They do not call one another and do not
recompute facts independently. A cross-authority parity gate drives both from a
nonuniform fixture and compares every DTO while preserving package boundaries.

The private integration DTO family is new and allowlisted. It never returns a
first-party `OverviewSnapshot`, `SessionSummary`, `SessionOutcome`, or
`ReplaySession` verbatim. Internal session and repository identifiers are
replaced by random external references. Cursors are opaque server records, not
base64 encodings of internal keys.

The public DTO family is separate again. Public reads can return only a stored
publication projection. They cannot invoke a private query at request time.

### 2. A distinct integration principal

Integrations do not reuse root, browser, collector, mobile, installed-client
`read`, or provider credentials. An integration grant has:

- exactly the issued subset of `period:read`, `sessions:read`, and
  `replay:read`;
- an exact audience, mandatory expiry, hashed opaque bearer and independent
  revocation;
- optional repository and time bounds that are intersected with every query;
- a per-credential request budget plus the plane's route-class backstop; and
- content-free audit rows containing operation, result class, and counts only.

"Intersected with every query" is a statement about CONTENT, not only about row
selection. A time bound therefore selects a session by CONTAINMENT: a session
whose span is not entirely inside the bound is refused, not clipped. Almost
everything the surface reports about a session is an aggregate over the whole of
it — `commitsLanded`, `lineSurvival`, `errorCount`, `toolCallCount`, `costUsd`,
and the replay keyframes — so recomputing those over a partial window and
returning them under the same names would understate a real measurement
invisibly, which the honesty rule forbids. The cost is deliberate: a session
straddling the edge of a credential's window is invisible to it, not partly
visible.

Owner-issued `srkx_` credentials support the optional project/date intersection
for both collector HTTP and collector MCP. Collector MCP is a preconfigured,
out-of-band static bearer with a distinct exact `/mcp/private` audience and
mandatory expiry, never OAuth. Managed owner-cell MCP instead uses short-lived,
exact-resource, scope-limited `srmcp_` OAuth access tokens. Project/date hosted
OAuth consent is deferred because the central authorization server deliberately
has no private project catalog.

`model:read` and `live:read` are not issued until a deliberately designed tool
exists for each. No query input accepts an owner, member, workspace, or tenant
selector. The isolated cell and verified principal supply authority.

The private surface is **not** behind the hosted entitlement gate, and that is a
decision rather than an oversight. `managedProductAccess.ts` gates the dashboard
through `remoteVisibility`; `/api/v1/*`, `/mcp/private`, and `/integrations` are
deliberately absent from it, so they answer on Free and keep answering when a
plan lapses. The collector serves the same complete boundary on account-free
loopback and operator-run self-hosted bindings. Integrations are part of the
complete local-first free product: a
cell whose owner cannot reach their own data through their own API is not
complete, and the surface runs entirely inside the cell, so gating it would sell
back something no hosted service is providing. `managed-lifecycle.test.ts` pins
the absence, because a missing rule and a forgotten rule look identical.

`integrations` is one atomic `DataPlaneSurface`. The collector declares it only
because owner management, every HTTP read, and the official MCP resource are
mounted on both loopback and self-hosted bindings. The dashboard shows static
API/MCP credential targets only on those planes; a managed plane never offers a
static MCP token. Repository completeness and activation gates hold the
declaration, mounted families, both bindings, UI, and documentation together.

Managed owner cells refuse integration issuance and publication in Shared
cells. Existing workspace consent proves that members may read a shared board;
it does not prove that one member may publish jointly attributed evidence. The
collector's append-only local history is the machine owner's Personal record,
not a Shared-cell union; a provenance invariant refuses issuance and every
query if a future schema introduces member or inbound multi-member authority.

### 3. Authenticated remote Streamable HTTP MCP first

The first MCP transport is the current MCP `2026-07-28` Streamable HTTP binding,
served by the official TypeScript SDK v2. It is stateless at the protocol layer:
one POST carries one self-contained request and no sticky MCP session is needed.
The endpoint supports the modern protocol and the SDK's stateless legacy
`2025-11-25` compatibility behavior. Deprecated HTTP+SSE and local stdio are not
implemented.

The v1 target is native/server clients such as Claude and Codex. Browser public
clients are deliberately unsupported until the authorization and resource
servers can enforce one complete exact-origin CORS policy; a resource-only
hostname allowlist would advertise a flow the token endpoint cannot complete.

The private catalog is limited to question-shaped, read-only tools, four at
first and five since ADR 007:

1. `period_summary`
2. `list_sessions`
3. `get_session_outcome`
4. `replay_lens`
5. `resolve_session`, added by
   [ADR 007](./007-native-session-resolve-and-launcher-labels.md): a caller that
   already holds a session's native identity gets its opaque summary. Native ids
   are an input only and are never listed or returned.

They return the same versioned DTO objects as HTTP in `structuredContent` and a
JSON text block for older clients. Resources and prompts are omitted initially:
these are parameterized model-invoked questions, not URI-addressed documents to
enumerate or inject automatically.

Collector MCP uses its owner-issued static `srkx_` bearer and publishes no RFC
9728 protected-resource, authorization-server, or OpenID discovery. Setup is an
exact resource URL plus an Authorization bearer supplied from an environment
variable. It does not call the static grant OAuth, and it never puts the secret
in a URL or suggested checked-in config.

For a conformant hosted release, the control plane is the OAuth authorization
server and the owner cell is the resource server. The owner cell publishes RFC
9728 protected-resource metadata. Authorization code + PKCE S256 binds each
token to the exact canonical MCP resource through RFC 8707 `resource`; the cell
validates that audience on every request. Browser, root, API, provider, and
installed-client tokens are rejected at the MCP endpoint and are never passed
through. Authorization-server revocation is committed before the owner-cell
call and queued in a durable retry outbox, so a cell outage cannot lose the
grant-wide revoke. Known clients are pre-registered; Client ID Metadata Documents may be
added behind a bounded SSRF-safe fetcher. Deprecated dynamic client registration
is not added without a verified client-compatibility need.

### 4. Versioned frozen publications with explicit updates

A publication is a versioned hybrid: evidence is a frozen, reproducible snapshot
for one published version, while the owner can explicitly publish a new version.
There is no silent live refresh. Each evidence value records its measurement
window, generated time, availability/freshness state, and coverage. Missing or
unavailable measurements remain null/stateful and never become zero.

The owner cell builds an allowlisted publication projection from the canonical
query service, writes a durable delivery intent, and sends only that projection
to a separate public-directory service. The directory has its own D1 and no
owner-data binding. It stores immutable versions plus a current read/search
projection. A publish, update, or revoke atomically changes the current version,
directory/search membership, and revocation high-water. Public responses remain
`no-store` in the first release, so there is no stale first-party response cache
to invalidate; publication versions leave room for explicit ETags later.

Public handles, profile slugs, and project slugs are validated public
identifiers. They never encode cell, owner, member, repository, session, device,
or tenant identifiers.

Publication grants are independent:

- web visibility;
- inclusion in search;
- public HTTP API discovery; and
- public MCP discovery.

Disabling a channel removes the record from that channel even if another channel
stays enabled. Public MCP uses the same Streamable HTTP transport but a separate,
anonymous endpoint and four public-projection-only tools.

### 5. Contact is a public HTTPS link first, not a relay

The initial optional contact path is one owner-chosen HTTPS URL included in the
published profile only when contact is enabled. Email addresses and message
bodies are not collected. This makes enumeration explicit, leaves blocking and
abuse handling with the chosen destination, and gives Seorak no message-retention
or delivery promise. Disabling contact or revoking the profile removes the link
from the current projection and invalidates caches.

A Seorak relay is deferred until sender throttling, challenge/verification,
blocking, moderation, delivery guarantees, abuse appeals, and retention/deletion
policy are specified and operated.

## Consequences

- Current first-party reads remain compatible while integrations get a narrower
  external contract.
- Private API and MCP parity can be tested at the canonical service boundary.
- A global directory becomes possible without central access to private cells.
- Publication delivery and hosted OAuth require control-plane/provisioning work;
  an endpoint must not be described as generally available before those flows
  and real target-client compatibility are proven.
- Revocation is understandable: private grants revoke credentials; public
  revocation removes the current public projection. Neither operation depends on
  deleting the developer's private Seorak record.

## Protocol references

The transport and authorization decisions above are pinned to current primary
sources, not an older MCP blog post or a deprecated SDK surface:

- [MCP 2026-07-28 Streamable HTTP transport](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http)
- [MCP 2026-07-28 authorization](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization)
- [MCP authorization-server discovery](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/authorization-server-discovery)
- [MCP client registration](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/client-registration)
- [MCP authorization security considerations](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/security-considerations)
- [MCP tools contract](https://modelcontextprotocol.io/specification/2026-07-28/server/tools)
- [Official TypeScript SDK Hono serving guidance](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/serving/hono.md)
- [Official TypeScript SDK authorization guidance](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/serving/authorization.md)

## Rejected alternatives

- **Reuse installed-client `read`:** authority is much broader than the tool
  catalog and has no query scopes, mandatory expiry, or audience.
- **Expose current DTOs:** internal identifiers and first-party-only fields would
  become an irreversible external contract.
- **Anonymous reads from owner cells:** creates a private/public authorization
  ambiguity and cannot provide a global index.
- **Put public discovery in the identity D1:** couples public query traffic and
  owner-auth lifecycle to one failure and abuse domain. The control plane should
  coordinate identity, not serve the gallery.
- **Live public evidence:** consent and reproducibility become time-dependent;
  the viewer cannot tell which measurement the owner approved.
- **stdio first:** it adds a second secret-bearing local process and transport
  beside the already mounted, bounded HTTP resource; it also cannot implement
  the hosted OAuth resource/audience contract.
- **Contact relay first:** spam, retention, blocking, and delivery policy are not
  yet an operated boundary.
