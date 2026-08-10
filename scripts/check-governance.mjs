#!/usr/bin/env node

/**
 * The governance gate: do the public core's governance files still state facts
 * that are true?
 *
 * Governance files rot faster than code because nothing tests them. A contact
 * address goes stale, a copyright year drifts out of step with the licence it
 * is supposed to match, a response window gets tightened to something nobody
 * can hold, and none of it fails anything. This gate makes the checkable half
 * checkable. It deliberately checks only claims that HAVE a mechanical truth
 * value; a promise like "we will respond fairly" is kept small in the document
 * rather than pretended to be testable here.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT CHECKS
 * ---------------------------------------------------------------------------
 *
 * PRESENCE. The six governance files ADR 005 decision 7 requires must exist.
 *
 * THE ROOT LICENCE RULE POINTS BOTH WAYS, AND THE GATE ASKS WHICH TREE IT IS IN.
 * ADR 005 decision 7 gives the PUBLIC repository a root `LICENSE`, Apache-2.0,
 * and forbids one at the PRIVATE repository's root, because the private tree
 * carries files whose licence this repository cannot evidence and a root grant
 * would purport to licence them.
 *
 * This file ships public, so a rule that only knows the private half is wrong in
 * the tree it is running in: it would fail the public repository the day
 * somebody does the exactly correct thing and adds the Apache grant decision 7
 * requires. Worse, its failure message would tell that reader "this repository
 * becomes the private repository", which is false where they are standing.
 *
 * So the gate asks the ownership map which half it holds, through
 * `holdsPrivateHalf()` in `scripts/open-core-ownership.mjs`, the same question
 * three other gates ask. A tree holding a file the map does not send public is
 * the repository that owns both halves; a tree that holds only public files is
 * the public one. In the private half a root licence is a failure. In the public
 * half its ABSENCE is the failure, and `LICENSE` at the root is required. That
 * is deliberately a property of the tree rather than a flag, because a flag is
 * something CI can forget to pass and a stranger cannot know to.
 *
 * THE COPYRIGHT LINE IS ONE LINE. `NOTICE` carries an Apache section 4(d)
 * attribution, and every package `LICENSE` file carries the same line in its
 * appendix. Copies of one fact drift; this makes them fail instead.
 *
 * ONE CONTACT. Every email address in the governance set must be the SAME
 * address, and it must not be a placeholder. "Name a reporting channel
 * concretely" is not satisfied by naming three different ones, and a policy
 * whose contact has gone stale in two files out of three is worse than one with
 * no contact at all, because it looks answered.
 *
 * A WINDOW THAT CAN BE HELD. `SECURITY.md` commits to an acknowledgement window,
 * and this gate refuses a window shorter than a week. Seorak is maintained by
 * one person; a 24-hour acknowledgement promise is a lie with a deadline
 * attached, and the first missed one is a public trust failure in the exact
 * place trust is this product's argument. The floor is the point of the check.
 *
 * THE TRADEMARK POLICY IS STILL MARKED DRAFT. ADR 005 lists trademark wording as
 * an owner decision with legal review. Until that returns, the file must say so.
 * Removing the draft marker is allowed only by replacing it with an explicit
 * adoption line, so the marker cannot be dropped silently.
 *
 * DCO. ADR 005 decision 7: "the DCO status check does not pass until a
 * `LICENSING-POLICY.md` exists and has been reviewed". So the policy file is a
 * precondition of this check rather than a document beside it, and the check
 * fails outright when the policy is missing or does not declare its inbound
 * licence, its certification version, and its enforcement point.
 *
 * ---------------------------------------------------------------------------
 * WHAT SIGN-OFF ENFORCEMENT ACTUALLY DOES TODAY, STATED PLAINLY
 * ---------------------------------------------------------------------------
 *
 * `LICENSING-POLICY.md` declares one value, `Sign-off required from:`. While it
 * reads `unpublished`, NO COMMIT RANGE IS IN SCOPE and this gate says so in one
 * line rather than pretending to have verified something.
 *
 * That is the honest state and not a stub. This repository is private, has
 * accepted no outside contribution, and a DCO certification cannot be made
 * retroactively: signing off the owner's existing history would be a
 * certification nobody made. Enforcement turns on by replacing that value with a
 * commit SHA, which is phase C's edit, at which point every commit after it must
 * carry a well-formed `Signed-off-by` trailer.
 *
 * The machinery is not theoretical for being inactive. `verifySignOff` is a pure
 * function over commit records and `check-governance.test.mjs` runs it against
 * real git ranges in a real temporary repository, with signed and unsigned
 * commits, and asserts both outcomes.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { gitSync } from "./isolated-git.mjs";
import { holdsPrivateHalf, loadOwnership } from "./open-core-ownership.mjs";

export const REPO_ROOT = resolve(import.meta.dirname, "..");

/** ADR 005 decision 7's artifact list, plus the trademark policy it requires. */
export const REQUIRED_FILES = [
  "NOTICE",
  "LICENSING-POLICY.md",
  "SECURITY.md",
  "CONTRIBUTING.md",
  "CODE_OF_CONDUCT.md",
  "TRADEMARK.md",
];

/**
 * Root licence file names, in preference order. In the private half any of them
 * is the thing ADR 005 decision 7 forbids; in the public half the first one is
 * what decision 7 requires.
 */
export const ROOT_LICENCE_NAMES = ["LICENSE", "LICENSE.md", "LICENSE.txt", "COPYING"];

/**
 * Which half is this, and what does a root licence mean here? Split out so the
 * test can drive both answers without building two repositories, and so the
 * reason is data rather than a branch buried in a 150-line function.
 *
 * ENFORCEMENT IS THE DEFAULT WHEN THE ANSWER IS UNKNOWN. A map that does not
 * load answers `true` in `holdsPrivateHalf`, which keeps the stricter rule.
 */
export function rootLicencePolicy(repositoryRoot = REPO_ROOT) {
  const { manifest } = loadOwnership(repositoryRoot);
  return holdsPrivateHalf(manifest, repositoryRoot) ? "forbidden" : "required";
}

/**
 * Judge the root licence files present against the policy for this half. Pure
 * over the file names so the test can plant either shape, and returns both the
 * problems and what to say when there is nothing wrong.
 *
 * WHY THE PUBLIC HALF GETS A NOTE AND NOT A REQUIREMENT. Decision 7 gives the
 * public repository a root Apache-2.0 grant, and placing it is a C3 step. This
 * gate cannot tell a tree assembled from the map before publication, which is
 * every public-shaped tree that exists today, from the published repository
 * afterwards: both hold only public files. Failing on the absence would fail
 * every assembly run for a file that has nowhere to be committed yet, since a
 * root grant in the private repository is the exact thing decision 7 forbids and
 * the `open-core/` overlay only divides files the map already places `split`. So
 * the absence is REPORTED with the step that owes it rather than either enforced
 * or dropped, and the presence is accepted, which is the half of this that was
 * broken: the public repository would have gone red the day somebody added the
 * licence decision 7 requires.
 */
export function checkRootLicence(policy, present) {
  if (policy === "forbidden") {
    return {
      problems: present.map(
        (path) =>
          `${path} exists at the repository root. This tree holds the private half of the ADR 005 split, and decision 7 forbids a root grant here because it would purport to licence files whose licence this repository cannot evidence. The root Apache-2.0 LICENSE belongs to the PUBLIC repository`,
      ),
      note: "Root LICENSE: forbidden. This tree holds files the ownership map does not send public, so it is the private half.",
    };
  }
  return {
    problems: [],
    note:
      present.length > 0
        ? `Root LICENSE: present (${present.join(", ")}), which is what ADR 005 decision 7 gives the public repository.`
        : `Root LICENSE: absent. This tree holds only public files, so decision 7's root Apache-2.0 grant belongs here; placing it is phase C's step and this gate accepts it rather than forbidding it.`,
  };
}

/** The Apache grants that DO exist, and that NOTICE's copyright line must match. */
export const PACKAGE_LICENCES = [
  "packages/collector/LICENSE",
  "packages/dashboard/LICENSE",
  "packages/types/LICENSE",
];

/**
 * The shortest acknowledgement window a solo maintainer may promise. Seven days
 * is the floor rather than the target: the window has to survive a bad week, and
 * a bad week is exactly seven days long.
 */
export const MINIMUM_ACK_WINDOW_DAYS = 7;

/** A window nobody would ever hold to is as broken as one that is too short. */
export const MAXIMUM_ACK_WINDOW_DAYS = 90;

/** The declared value that means "no commit range is in scope yet". */
export const DCO_INACTIVE = "unpublished";

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/** Addresses that look like a contact and are not one. */
const PLACEHOLDER_CONTACT =
  /(^|@)(example|test|localhost|invalid|changeme|todo|insert|your)\b|@example\./i;

/**
 * The acknowledgement row's LABEL is the contract, not its position in the file.
 * A rewrite that drops the label fails closed and says what it looked for, which
 * is the right direction for a gate over a promise.
 */
const ACK_WINDOW = /\|\s*Acknowledgement[^|]*\|\s*\*\*(\d+)\s*days?\*\*\s*\|/i;

const DCO_MARKER = "<!-- governance:dco-enforce-from -->";
const DCO_VALUE = /Sign-off required from:\s*`([^`]+)`/;
const INBOUND_LICENCE = /\*\*Inbound licence:\*\*\s*Apache-2\.0/;
const CERTIFICATION = /\*\*Certification:\*\*\s*DCO 1\.1/;
const DRAFT_MARKER = /DRAFT\.\s*NOT IN FORCE\./;
const ADOPTION = /^Adopted:\s*\d{4}-\d{2}-\d{2}\b/m;
const SIGNED_OFF = /^Signed-off-by:\s*.+\s<[^<>@\s]+@[^<>@\s]+>\s*$/m;
const COPYRIGHT = /^Copyright \d{4} .+$/m;

/**
 * Every `Signed-off-by` claim in a range, judged. Pure over commit records so
 * the test can drive it from a real git range and from planted ones alike.
 */
export function verifySignOff(commits) {
  return commits
    .filter((commit) => !SIGNED_OFF.test(commit.message))
    .map((commit) => ({
      sha: commit.sha,
      subject: commit.message.split("\n")[0],
    }));
}

/**
 * Commit records in `ref..HEAD`, oldest first.
 *
 * A commit message is free text and may contain blank lines, so the fields and
 * the records are separated by ASCII unit and record separators rather than by
 * anything a message could itself contain. The separators are written as escape
 * sequences: a literal control byte in a source file is what
 * `check-source-bytes.mjs` exists to refuse.
 */
const UNIT = "\u001f";
const RECORD = "\u001e";

export function readCommits(repositoryRoot, fromRef) {
  const output = gitSync(
    ["log", "--reverse", "--format=%H%x1f%B%x1e", `${fromRef}..HEAD`],
    { cwd: repositoryRoot, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
  );
  return output
    .split(RECORD)
    .map((record) => record.replace(/^\s+/, ""))
    .filter((record) => record.length > 0)
    .map((record) => {
      const [sha, message] = record.split(UNIT);
      return { sha, message: message ?? "" };
    });
}

export function refExists(repositoryRoot, ref) {
  try {
    gitSync(["rev-parse", "--verify", `${ref}^{commit}`], {
      cwd: repositoryRoot,
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

function readIfPresent(repositoryRoot, path) {
  const absolute = resolve(repositoryRoot, path);
  return existsSync(absolute) ? readFileSync(absolute, "utf8") : undefined;
}

/**
 * The whole check as data, so the executable is only exit-code plumbing and the
 * test drives the same function the gate does.
 */
export function checkGovernance(repositoryRoot = REPO_ROOT, options = {}) {
  const problems = [];
  const notes = [];
  const sources = new Map();
  for (const path of REQUIRED_FILES) {
    const body = readIfPresent(repositoryRoot, path);
    if (body === undefined) {
      problems.push(`${path} is required by ADR 005 decision 7 and is missing`);
      continue;
    }
    sources.set(path, body);
  }

  // THE ROOT LICENCE, judged against the half this tree actually holds.
  const licencePolicy = options.rootLicencePolicy ?? rootLicencePolicy(repositoryRoot);
  const presentLicences = ROOT_LICENCE_NAMES.filter((path) =>
    existsSync(resolve(repositoryRoot, path)),
  );
  const rootLicence = checkRootLicence(licencePolicy, presentLicences);
  problems.push(...rootLicence.problems);
  notes.push(rootLicence.note);

  // THE COPYRIGHT LINE IS ONE LINE.
  const notice = sources.get("NOTICE");
  let noticeCopyright;
  if (notice !== undefined) {
    noticeCopyright = COPYRIGHT.exec(notice)?.[0];
    if (noticeCopyright === undefined) {
      problems.push("NOTICE carries no `Copyright <year> <holder>` line");
    }
  }
  for (const path of PACKAGE_LICENCES) {
    const body = readIfPresent(repositoryRoot, path);
    if (body === undefined) {
      problems.push(
        `${path} is missing; it is one of the ${PACKAGE_LICENCES.length} Apache-2.0 grants that do exist`,
      );
      continue;
    }
    if (!body.includes("Apache License")) {
      problems.push(`${path} does not carry the Apache License text`);
    }
    if (noticeCopyright !== undefined && !body.includes(noticeCopyright)) {
      problems.push(
        `${path} does not carry NOTICE's copyright line (${noticeCopyright}); three copies of one fact must not drift`,
      );
    }
  }

  // ONE CONTACT.
  const contacts = new Map();
  for (const [path, body] of sources) {
    for (const address of body.match(EMAIL) ?? []) {
      if (!contacts.has(address)) contacts.set(address, new Set());
      contacts.get(address).add(path);
    }
  }
  for (const address of contacts.keys()) {
    if (PLACEHOLDER_CONTACT.test(address)) {
      problems.push(
        `${address} is a placeholder, not a reporting channel; a policy that says "contact us" is not a policy`,
      );
    }
  }
  const realContacts = [...contacts.keys()].filter((address) => !PLACEHOLDER_CONTACT.test(address));
  if (realContacts.length === 0) {
    if (sources.size > 0) problems.push("no governance file names a contact address");
  } else if (realContacts.length > 1) {
    problems.push(
      `the governance files name ${realContacts.length} different contact addresses (${realContacts.join(", ")}); there is one maintainer, so there is one address`,
    );
  } else {
    notes.push(`Contact: ${realContacts[0]}, named in ${[...contacts.get(realContacts[0])].sort().join(", ")}.`);
  }

  // A WINDOW THAT CAN BE HELD.
  const security = sources.get("SECURITY.md");
  if (security !== undefined) {
    const match = ACK_WINDOW.exec(security);
    if (match === null) {
      problems.push(
        "SECURITY.md states no acknowledgement window; the gate looks for a table row whose first cell begins `Acknowledgement` and whose window cell reads `**N days**`",
      );
    } else {
      const days = Number(match[1]);
      if (days < MINIMUM_ACK_WINDOW_DAYS) {
        problems.push(
          `SECURITY.md promises acknowledgement in ${days} days. One maintainer cannot hold a window shorter than ${MINIMUM_ACK_WINDOW_DAYS} days through a bad week, and a missed promise is worse than a longer one kept`,
        );
      } else if (days > MAXIMUM_ACK_WINDOW_DAYS) {
        problems.push(
          `SECURITY.md promises acknowledgement in ${days} days, which is long enough to be no commitment at all`,
        );
      } else {
        notes.push(`Security acknowledgement window: ${days} days.`);
      }
    }
  }

  // THE TRADEMARK POLICY IS STILL MARKED DRAFT.
  const trademark = sources.get("TRADEMARK.md");
  if (trademark !== undefined && !DRAFT_MARKER.test(trademark) && !ADOPTION.test(trademark)) {
    problems.push(
      "TRADEMARK.md is neither marked `DRAFT. NOT IN FORCE.` nor carries an `Adopted: YYYY-MM-DD` line. ADR 005 makes the wording an owner decision with legal review, so it is one or the other and never neither",
    );
  }

  // DCO.
  const policy = sources.get("LICENSING-POLICY.md");
  let enforceFrom;
  if (policy === undefined) {
    problems.push(
      "the DCO check cannot pass without LICENSING-POLICY.md; ADR 005 decision 7 makes its existence the gate",
    );
  } else {
    if (!INBOUND_LICENCE.test(policy)) {
      problems.push("LICENSING-POLICY.md does not declare `**Inbound licence:** Apache-2.0`");
    }
    if (!CERTIFICATION.test(policy)) {
      problems.push("LICENSING-POLICY.md does not declare `**Certification:** DCO 1.1`");
    }
    if (!policy.includes(DCO_MARKER)) {
      problems.push(`LICENSING-POLICY.md carries no ${DCO_MARKER} marker`);
    }
    const declared = DCO_VALUE.exec(policy)?.[1];
    if (declared === undefined) {
      problems.push("LICENSING-POLICY.md declares no `Sign-off required from:` value");
    } else {
      enforceFrom = declared;
    }
  }

  const range = options.dcoRange ?? enforceFrom;
  if (range === undefined) {
    // Already reported above.
  } else if (range === DCO_INACTIVE) {
    notes.push(
      "DCO sign-off: no commit range in scope. LICENSING-POLICY.md declares `unpublished`, which is the honest state for a repository that has accepted no outside contribution.",
    );
  } else if (!refExists(repositoryRoot, range)) {
    problems.push(
      `LICENSING-POLICY.md requires sign-off from \`${range}\`, which is not a commit in this repository`,
    );
  } else {
    const commits = readCommits(repositoryRoot, range);
    const unsigned = verifySignOff(commits);
    for (const commit of unsigned) {
      problems.push(
        `${commit.sha.slice(0, 8)} has no Signed-off-by trailer: ${commit.subject}. Certify it with \`git commit -s\` (see LICENSING-POLICY.md)`,
      );
    }
    notes.push(
      `DCO sign-off: ${commits.length - unsigned.length} of ${commits.length} commits since ${range} are signed off.`,
    );
  }

  return { problems, notes };
}

export function formatReport({ problems, notes }) {
  const lines = ["Governance check. Policy: LICENSING-POLICY.md, ADR 005 decision 7."];
  for (const note of notes) lines.push(`  ${note}`);
  if (problems.length === 0) {
    lines.push("", "No problems.");
    return lines.join("\n");
  }
  lines.push("", `Problems (${problems.length}):`);
  for (const problem of problems) lines.push(`  ! ${problem}`);
  return lines.join("\n");
}

function isMain() {
  return (
    process.argv[1] !== undefined &&
    pathToFileURL(resolve(process.argv[1])).href === import.meta.url
  );
}

if (isMain()) {
  const rootArgument = process.argv.find((argument) => argument.startsWith("--root="));
  const rangeArgument = process.argv.find((argument) => argument.startsWith("--dco-range="));
  const repositoryRoot = rootArgument ? resolve(rootArgument.slice("--root=".length)) : REPO_ROOT;
  const result = checkGovernance(repositoryRoot, {
    dcoRange: rangeArgument?.slice("--dco-range=".length),
  });
  console.log(formatReport(result));
  process.exitCode = result.problems.length > 0 ? 1 : 0;
}
