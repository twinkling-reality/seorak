# Event ingest compatibility

This is the release contract between an independently installed collector and a
worker. It governs schema changes before the collector is published as well as
after publication. The current event envelope schema is **1**, and the current
worker has exactly one real parser, for schema 1.

## Wire contract

`@seorak/types/event-protocol` owns the publish-safe leaf contract:

- the schema emitted by the current collector build;
- the exact schema parsers owned by the current worker build;
- the closed `POST /events` rejection codes;
- strict parsers for compatibility and rejection responses.

It imports neither event validators nor event payload types. A compatibility
check therefore cannot pull the Zod validation graph into a surface bundle.
`@seorak/types/event-validation` re-exports the same schema constant so envelope
serialization and validation cannot drift.

A ready worker answers the open `GET /health` route with:

```json
{
  "ok": true,
  "eventIngest": {
    "currentSchemaVersion": 1,
    "acceptedSchemaVersions": [1]
  }
}
```

The response is `Cache-Control: no-store`. The accepted list is nonempty,
unique, limited to two positive integer versions, and must include the current
version. A missing, empty, duplicate, excessive, inconsistent, or otherwise
malformed shape is not compatibility evidence.

When `POST /events` rejects an envelope version, it returns the closed
`unsupported_schema_version` code and its accepted versions when the worker
supports this contract. An older worker may return the code without an accepted
list. No rejected event value, schema path, parser message, or arbitrary response
field enters collector logs or local shipping status.

## Collector behavior

The delivery loop owns one compatibility gate for its normalized worker URL and
emitted schema version. It checks compatibility before reading a queue chunk.
The health response is limited to 4,096 bytes, has a three-second deadline, and
is cached for five monotonic minutes. Concurrent checks share one request.

A proven empty intersection blocks delivery without calling the queue reader,
posting an event, or moving the durable offset. The local status records the
emitted schema and the worker's advertised accepted versions. New events stay in
the same durable queue.

Old `{ "ok": true }` health responses, unavailable workers, timeouts, oversized
bodies, and malformed metadata are **unknown**, not incompatible. Unknown health
permits `POST /events`, preserving compatibility with older workers.
`POST /events` remains the final authority:

- a 2xx advances exactly one queue prefix;
- a bounded closed rejection keeps the prefix pinned and records only its code;
- an unsupported-schema response invalidates the cached health verdict;
- a legacy unsupported response states that the worker did not advertise
  accepted versions rather than inventing them.

The existing permanent-failure circuit performs a recovery probe at its
15-minute ceiling. A worker expansion therefore self-heals without a new local
event and without creating a rejection hot loop. Successful recovery replaces
the blocked shipping status with `caught-up`.

## Protocol release policy

Schema changes use expand, release, then contract:

1. Implement real worker parsers for schemas N-1 and N. Add equality tests that
   prove both normalize to the same internal event semantics. Advertise both
   versions.
2. Deploy and verify that expanded worker before releasing a collector that
   emits N. The collector emits only the one schema for which it has a real
   serializer; health metadata never selects an automatic downgrade.
3. Once any collector N exists, do not roll the worker back behind the expand
   release. If the protocol rollout must be reversed, roll the collector back
   first.
4. Make N the documented minimum supported collector schema and announce that
   N-1 collectors will become permanently blocked.
5. Remove the N-1 worker parser only after the deprecation has lasted at least
   one stable collector release and 90 days, and the release and status
   documentation names the resulting block and remedy.

Do not add a speculative N-1 parser or serializer before a real transition
exists. A list of accepted numbers is a compatibility claim only when the worker
can actually parse each version.

Collector publication remains deferred, as recorded in
[STATUS](../STATUS.md). Until publication happens, the same sequence is still a
release gate: it prevents the first external install from inheriting an
undocumented hard stop.
