# Trademark policy

> ## DRAFT. NOT IN FORCE.
>
> **This is a draft for the owner to decide and for qualified legal counsel to
> review. It is not a settled policy, it is not legal advice, and nobody should
> rely on it as a permission or as a restriction.**
>
> [ADR 005](docs/adr/005-open-core-repository-and-free-ui-packaging.md) decision 7
> lists "trademark policy" as required, and the wave-2 plan's table of gates
> outside engineering control lists **"trademark policy wording: owner, with
> legal review"** as blocking stage B7. That gate is open. This file exists so
> the review has something concrete to mark up rather than a blank page, which
> is the whole of its purpose.
>
> **Open questions this draft does not answer**, listed so the review does not
> have to find them:
>
> 1. Whether "Seorak" is registered as a trademark in any jurisdiction, and if
>    not, whether it should be before the repository is public.
> 2. Whether the permitted-use list below is too broad, too narrow, or
>    unenforceable as written.
> 3. What the policy says about the npm `@seorak` scope specifically, which is a
>    namespace as well as a name.
> 4. Whether a separate logo-usage guide is needed, or whether one file is
>    enough.
> 5. Whether this file should live beside the code at all, or on the website
>    where a non-contributor would look for it.

---

## Why a licence is not enough

Seorak's public core is licensed **Apache-2.0**, and that licence is deliberately
broad: an irrevocable copyright grant and an express patent grant, to anyone, for
any purpose.

**Apache-2.0 section 6 grants no trademark rights.** Its text is explicit that
the licence does not grant permission to use the licensor's trade names,
trademarks, service marks, or product names, except as required for describing
the origin of the work.

That exclusion is not an oversight in the licence and it is not a gap this policy
patches. It is the design. The code is free to copy, modify, and run; the **name**
is what tells a user whether the thing in front of them is Seorak. Once the code
can be forked by anyone, the name is the only control over who may present a fork
as Seorak, which is precisely why it is treated separately.

## What the marks are

- The word **Seorak**, as the name of this software and of the service operated
  under it.
- The **Seorak mark**, the logo rendered by
  `packages/web/src/components/SeorakMark/SeorakMark.tsx` and the brand SVGs
  under `packages/web/public/assets`.
- **Twinkling Reality**, the name of the maintainer.

The mark ships inside the public core rather than being withheld from it. ADR 005
says why: the component is the single source for the logo and is rendered from
four places in the dashboard, so withholding the SVG twins would have bought
nothing while breaking the build. Stage B4 makes the mark and the legal footer
replaceable through a brand slot with a neutral default, so **a fork has an
obvious non-infringing path rather than only a prohibition.** A policy that says
only "do not" and gives a fork no way to comply is a policy that gets ignored.

---

## What you may do without asking

*Draft. Everything in this section is proposed, not granted.*

- **Use, modify, and redistribute the code** under Apache-2.0. That is the
  licence, and nothing here narrows it.
- **Say true things.** "Works with Seorak", "compatible with Seorak", "a Seorak
  plugin", "imports Seorak data", "a fork of Seorak", "based on Seorak". Accurate
  reference to what a thing is or does is what section 6's own carve-out is for.
- **Redistribute the published packages unmodified under their own names**
  (`@seorak/collector`, `@seorak/types`). Packaging Seorak for a distribution is
  a use the project wants.
- **Write about it**, review it, criticise it, teach it, screenshot it.
- **Run it yourself**, for yourself or inside your organisation, with no
  permission and no notice to anyone.

## What needs permission

*Draft. This is the list most likely to change in review.*

- **Naming your own product, service, company, domain, or package "Seorak"**, or
  a name close enough to be confused with it.
- **Offering a hosted or commercial service under the Seorak name.** Running the
  code as a service is permitted by the licence; calling that service Seorak is
  what this asks about.
- **Using the Seorak mark as the identity of your project**, in an app icon, a
  favicon, a logo, or a package's branding.
- **Implying endorsement, affiliation, partnership, or certification** where none
  exists.
- **Modifying the mark** and continuing to present it as the Seorak mark.

## Forks

You may fork. That is what the licence is for.

**A modified version should not be distributed under the Seorak name**, because a
user who installs something called Seorak should get Seorak. Rename it, use the
brand slot's neutral default, and say plainly what it is derived from. "A fork of
Seorak" is accurate, welcome, and needs no permission; "Seorak" is the thing this
policy asks you not to call it.

---

## If you are not sure

Ask, at `hello@twinklingreality.com`. A short description of what you want to do gets a
real answer from a person. The answer to a good-faith question about the name has
never been the problem this policy exists for.

---

*Draft raised 2026-08-04 by stage B7. It carries no effective date because it has
none until the owner adopts it and counsel has reviewed it.*
