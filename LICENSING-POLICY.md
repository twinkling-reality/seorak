# Licensing policy

What licence code carries into and out of Seorak's public core, and what has to
be settled before that can change.

Decided by [ADR 005](docs/adr/005-open-core-repository-and-free-ui-packaging.md)
decision 4 (licensing) and decision 7 (governance). This file states the policy;
the ADR carries the argument for it and is not restated here.

---

## Outbound: Apache-2.0

Everything in the public core is licensed **Apache-2.0**.

**Why Apache-2.0 and not MIT.** Apache section 3 grants an express, irrevocable
patent licence from every contributor, with defensive termination. MIT has no
patent grant at all. Once outside contributions land in code Seorak also operates
commercially, that is the single largest practical difference between the two.
ADR 005 decision 4 has the full comparison.

**Why not AGPL-3.0.** ADR 005 decision 4 rejects it on two grounds and marks one
of them as weaker than it looks. Google's public policy states AGPL code must not
be used at Google, and `@seorak/types` is meant to be depended on. Section 13
bites only on modification, so it would not reach a competitor running an
unmodified core as a service. The second ground is secondary today because the
core contains no bindable service that AGPL would reach in the way the argument
assumes, and the ADR says to re-examine it rather than treat it as settled. The
question is genuinely live for the deferred reference server and is not
foreclosed here.

**Why not source-available.** BUSL, the Elastic License, SSPL, and FSL are not
OSI-approved and are not open source. Seorak's argument is that the developer's
record is genuinely theirs, and a licence that forbids competing use is a licence
that lets Seorak decide who may run the user's own software.

### Where the grant actually lives today

This is the part that is true of this repository rather than of open-core
repositories in general.

There are **two** Apache-2.0 grants in this tree, and they are file-scoped:

| File | Covers |
|---|---|
| `packages/collector/LICENSE` | `@seorak/collector` |
| `packages/types/LICENSE` | `@seorak/types` |

**There is no `LICENSE` at this repository's root, and one must not be added
here.** ADR 005 decision 7 is explicit about why: this repository becomes the
private `seorak-internal` repository after the split, so a root Apache grant here
would purport to licence the private tree, including binaries whose EULA this
repository cannot evidence. The public repository gets its root `LICENSE` when it
is created, in phase C. `npm run governance:check` fails if a root `LICENSE`
appears before then, because an instruction a reader can forget is better
enforced than restated.

The dashboard is the third public-core component and does **not** carry its own
grant yet, because it is not yet a package. That lands with `@seorak/dashboard`
in stage B6.

Per-component licensing inside one public repository stays available and is not
foreclosed. Apache-2.0 for `types`, `collector`, and `dashboard` because adoption
is the point.

---

## Inbound: the same licence, certified by sign-off

**Contributions are accepted under Apache-2.0, the same licence they go out
under.** Inbound equals outbound. There is no separate grant, no assignment, and
no additional right reserved to the maintainer.

The mechanism is the **Developer Certificate of Origin, version 1.1**, not a
Contributor Licence Agreement. You certify a contribution by signing off the
commit:

```bash
git commit -s
```

That appends a `Signed-off-by: Your Name <your@email>` line, which is you
certifying the DCO's four clauses. The full text is at
[developercertificate.org](https://developercertificate.org/).

**Why DCO and not a CLA.** A CLA is a grant, and the operative extra right it
carries is *sublicense*, which is what makes later relicensing or proprietary
redistribution of contributed code possible. Seorak's model says the core stays
open and the money is in operations, so that right has no use here. A CLA also
costs a contributor an out-of-band identity step before their first merge and
measurably deters drive-by contributions; the DCO costs one flag.

---

## The consequence, stated plainly

Apache-2.0 plus DCO carries **no sublicense right**, and it cannot be applied
retroactively. Once a commit from someone other than the owner merges, its
licence is fixed, and nobody can change it without that contributor's agreement.

So: **any change to the outbound licence of any public-core component, in either
direction, must be settled before the first non-owner commit merges.** That
includes moving toward proprietary terms, toward stronger copyleft such as
AGPL-3.0 for the deferred reference server, and toward an `ee/`-style mixed
repository.

If that is ever revisited, it is revisited here, in this file, before the merge
that would make it expensive.

---

## Enforcement status

ADR 005 decision 7 states the gate in one sentence: the DCO status check does not
pass until this file exists and has been reviewed. So this file is the input to
`npm run governance:check` (`scripts/check-governance.mjs`), which fails outright
when it is missing or does not declare the two values below.

**Inbound licence:** Apache-2.0. **Certification:** DCO 1.1.

**Sign-off enforcement, per commit**, is governed by one declared value:

<!-- governance:dco-enforce-from -->
Sign-off required from: `unpublished`

While that value is `unpublished`, no commit range is in scope. That is the
honest state: this repository is private, it has accepted no outside
contribution, and a DCO certification cannot be made retroactively on commits
that predate the policy. Enforcing sign-off on the owner's own past commits
would be a certification nobody made.

Replacing `unpublished` with a commit SHA turns per-commit enforcement on from
that commit forward. That is a one-line edit and it belongs to phase C, when the
public repository exists and can run the check as a required status check on pull
requests.

The machinery is not theoretical for being inactive.
`scripts/check-governance.test.mjs` builds a real repository, commits into it
signed and unsigned, and asserts both outcomes through the same code path the
gate runs. `npm run governance:check -- --dco-range=<ref>` runs it against any
range on demand.

---

## Related

| File | What it holds |
|---|---|
| [CONTRIBUTING.md](CONTRIBUTING.md) | how to build and what a change has to pass |
| [NOTICE](NOTICE) | the Apache section 4(d) attribution notice |
| [TRADEMARK.md](TRADEMARK.md) | the name, which no licence here grants (draft) |
| [packages/web/THIRD_PARTY_NOTICES.md](packages/web/THIRD_PARTY_NOTICES.md) | third-party assets the web tree vendors |
