# Security policy

Seorak is maintained by one person. This policy states a window one person can
actually hold, and says what to do when it is missed, because a promise with a
deadline attached is worse than no promise if the deadline is fiction.

---

## Reporting a vulnerability

**Email `hello@twinklingreality.com` with `Seorak security` at the start of the subject
line.**

That is a real, monitored address; it is the same contact the product's privacy
and terms pages publish, and it reaches the maintainer directly. There is no
security team, no ticketing system, and no shared inbox behind it.

Include whatever you have. What helps most, in order:

1. What an attacker gets, in one sentence.
2. The affected component and version (`seorak --version`, or the commit).
3. Steps to reproduce, or a proof of concept.
4. Whether you have told anyone else, and whether you have a disclosure date in
   mind.

**Do not open a public issue for a vulnerability.** Once the public repository
exists, GitHub private vulnerability reporting will be enabled on it and will
become the preferred channel; until then, email is the only private channel and
this file will be updated when that changes.

Please do not run availability tests, brute-force attempts, or automated scans
against infrastructure Seorak operates. There is nothing to gain from it and it
is not covered by anything below.

---

## What you can expect, and when

| Commitment | Window |
|---|---|
| Acknowledgement that a human read your report | **14 days** |
| An assessment: severity, whether it is a real issue, and what happens next | **30 days** |
| A fix, or a written explanation of why there is not one | **90 days** |

**Why 14 days and not 24 hours.** A solo maintainer travels, gets ill, and takes
weeks off. A 24-hour acknowledgement is a promise that breaks the first time life
happens, and the first missed one is a public trust failure in exactly the place
this product's argument lives. Fourteen days is a window that survives a bad
week with a week to spare, so it is a window that gets kept. Most reports get a
reply far sooner than that; the number is the floor, not the target.

**If 14 days pass and you have heard nothing**, assume your message did not reach
a person rather than that it was ignored. Resend it, and say in the subject that
it is a resend. If another 14 days pass with no reply, treat the private channel
as failed: **you are free to disclose publicly, and doing so is not a violation
of this policy.** There is no embargo you are bound by here and no escalation
path being withheld from you. This paragraph is the escalation path.

**At 90 days from your first report you may disclose publicly whether or not
there is a fix**, and you do not need permission. If a fix is close and you are
willing to wait, that is a favour, not an obligation, and it will be asked for
rather than assumed.

---

## What this policy does not offer

Stating these plainly is part of the policy, not a disclaimer under it.

- **No bounty and no payment.** There is no budget for one.
- **No service level agreement.** ADR 005 decision 10 makes this the standing
  posture: security fixes are published like any other change, and community
  self-hosting is never described as Seorak-managed infrastructure.
- **No CVE assignment or coordinated-disclosure brokering** by the maintainer.
  You are welcome to request a CVE yourself and it will be cooperated with.
- **No guarantee of a backport.** Only the most recent published version of each
  package receives fixes. There is no long-term-support line.
- **No credit unless you want it.** If you would like acknowledgement in the
  release notes, say so and give the name you want used. Silence is treated as
  a preference for no credit.

---

## Scope

**In scope: everything in the public core.**

| Component | What a report should look like |
|---|---|
| the collector CLI (`seorak`) | anything that sends captured data off the machine, writes outside its own state directory, or executes content from a captured session |
| the local data plane | anything a non-loopback caller can reach without the credential the self-hosted binding requires, or any way to bypass the loopback `Host` and `Origin` checks |
| the local store | anything that lets one project's history be read as another's, or that corrupts the SQLite authority |
| `@seorak/types` | anything in the parsers a hostile payload can exploit |
| the dashboard | cross-site scripting, content-security-policy bypass, or any request the dashboard makes that the user did not ask for |

The Free product is local-first and holds a detailed record of how someone works.
The highest-severity class is therefore anything that moves that record off the
machine, or lets something other than the user read it. **Seorak sends no
telemetry and makes no phone-home call**; a report showing that it does is
treated as a security issue, not a bug.

**Also in scope, reported the same way:** the services Seorak operates. Their
source is not public, which does not make a report about them less welcome.

**Out of scope**

- Vulnerabilities in dependencies with no exploitable path through Seorak. The
  repository's advisory posture is a separate gate (`npm run advisories:check`).
  Report the dependency upstream; tell us if Seorak's use makes it reachable.
- Anything requiring an attacker who already has your user account on your own
  machine. The local plane binds loopback and holds no credential by design, and
  that argument is written down in
  `docs/reference/self-hosted-plane-hardening.md` rather than assumed.
- Missing hardening headers on a page that carries no data.
- Reports generated by a scanner with no analysis attached.

---

## Supported versions

The most recent published version of each package. Nothing older is patched.
Seorak has no release train and no LTS line; compatibility is the wire
protocol's version, not a supported-release matrix.
