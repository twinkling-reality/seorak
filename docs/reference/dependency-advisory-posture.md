# Dependency advisory posture

Which advisories this repository's dependency graph carries, and what must stay
true for the answer to keep being none.

Measured 2026-08-08 with `npm audit` at the workspace root:
0 critical, 0 high, 0 moderate, 0 low.

That is the whole finding list, and an empty baseline is the strongest state
this document can record: there is no accepted advisory, no reachability
argument holding one open, and no expiry to come back to. Every entry below
describes why the graph is small rather than why a finding is tolerable.

## The empty baseline is the policy, not a note about today

`npm run advisories:check` normalizes package edges, installed paths, GHSA
identities, severities, ranges, and directness, then requires an exact match with
`dependency-advisory-baseline.json`. Against an empty baseline that means **the
first advisory to appear fails the build**, whatever its severity and wherever in
the graph it lands.

Two fields npm reports are deliberately outside that comparison: `fixAvailable`
and `effects`, which record npm's remediation *attribution* rather than the
advisory claim. They are kept in the baseline under an `informational` key and
printed on every run, but they are not hashed, because npm answers them
non-deterministically on graphs where one remediation cascade is reachable
through peer ranges on two packages. It does not arise on this tree, whose
baseline is empty; the gate is shared with the repository where it does, and it
behaves the same way in both. Everything outside `informational` is asserted, so
a field npm grows tomorrow is compared without anyone remembering to add it.

This is wired into `npm test`, so it runs wherever the suites run. It was
deliberately wired while the count was zero. A repository anyone can read is the
worst place to learn about a dependency finding from the outside: without the
gate the first signal is a public alert on a public repository, and nobody here
has seen it first. "Zero today" is a measurement with no expiry condition, and
an unwired gate cannot notice the day it stops being true.

The audit arguments are asserted by the gate's own suite, and they include
`--include=dev`, `--include=optional`, and `--include=peer`. The reviewed graph
is the whole install closure, not the production subset: a development
dependency still runs on a contributor's machine.

## Why the graph is this small

**No Cloudflare toolchain.** `wrangler`, `miniflare`, and the `undici` they
carry are development dependencies of the worker, control plane, and public
directory, none of which are in this repository. Those three carried every
advisory the wider Seorak tree accepted until 2026-08-07, when the undici pin
they were waiting on shipped and all three were remediated rather than renewed.

What the wider tree accepts today is one bundler dependency, `image-size`, whose
only install edge is metro's and which therefore reaches nothing this repository
holds either. It is named here rather than left implicit because "no Cloudflare
toolchain" was the whole answer for two measurements running, and is no longer.

**No mobile toolchain, and this one took a decision.** `@seorak/types` used to
develop its `./push` subpath against `@mobile-surfaces/tokens`, which depends on
`@mobile-surfaces/live-activity`, which declares `expo` and `react-native` as
**non-optional** peer dependencies. npm installs peers automatically and
resolves whole packages rather than subpaths, so that one import pulled a
complete Expo and React Native toolchain into this repository: 430 of 697
lockfile entries, 76 of them carrying an Expo, React Native, or Xcode name and
the rest reachable only through those, for an application that is not here and
cannot be built from here. Every advisory this repository used to report came
from that graph. The lockfile now resolves 267 packages, and nothing was added
to reach that number.

What the import actually needed was eight fields of zod. `@seorak/types` now
owns that contract in `packages/types/src/push.ts` and depends on no mobile
package to build it, so the toolchain is not suppressed or filtered here, it is
simply not required.

**Where the copy is checked, stated plainly, because it is not checked here.**
A duplicated contract needs something holding the halves together, and that
something needs both halves. This repository has only one of them: the mobile
application that consumes the published schema is not part of the open core. So
the parity suite lives with the application, in the repository that holds both,
and compares the schema above against `@mobile-surfaces/tokens/wire` field by
field and payload by payload. A reader here can verify what this contract *is*,
and can see it validated by this repository's own tests; what a reader here
cannot do is confirm it still matches the vendor's published shape.

This tree therefore needs no install-policy flag. An earlier version of this
document described an `.npmrc` carrying `legacy-peer-deps=true`, which suppressed
the peer installation instead of removing the reason for it. That worked and was
deleted anyway: it was a repository-wide change to how every dependency resolves,
adopted for one vendor's packaging decision, and it would have outlived the
problem without a gate to end it.

## What would change the answer

Re-measure, and re-triage rather than accept, if any of these becomes true:

- `npm run advisories:check` fails. The baseline is empty, so any failure is a
  new finding, and the response is to fix or upgrade rather than to record an
  acceptance. An acceptance is a claim about a call path, and it belongs in this
  document with the command that falsifies it.
- A workspace imports a package whose own dependencies declare non-optional
  peers for a platform this repository does not build. That is how the mobile
  toolchain got in, and it is worth checking against the lockfile rather than
  the manifest, because the peers arrive transitively and are never written
  down anywhere a reader would look.
- `@mobile-surfaces/live-activity` makes its `expo` and `react-native` peers
  optional. The wire contract in `packages/types/src/push.ts` could then be
  imported again instead of owned, and the parity suite retired with it.
  Nothing breaks if this is never done; it would just trade a checked duplicate
  for an import, which is the better shape when it costs nothing.
- A published package gains a production dependency. `@seorak/collector`
  declares `@seorak/types` and `@seorak/dashboard`; `@seorak/types` declares
  `zod` plus optional mobile token peers a core consumer does not install.
  Install closure, not import reachability, governs what a published artifact
  puts on a user's machine.

## How to re-derive this

```bash
npm audit --include=prod --include=dev --include=optional --include=peer
npm explain <package>             # every install edge that pulls it in
npm ls <package> --all            # the installed versions and paths

node scripts/check-dependency-advisories.mjs --print-baseline   # inspect first
node scripts/check-dependency-advisories.mjs --write-baseline   # then accept
```

A baseline refresh is an assertion that the new graph was reviewed. Write one
only with the reasoning in this document updated in the same change: the gate
compares a hash, and a hash nobody read is a hash nobody checked.
