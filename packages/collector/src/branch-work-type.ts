/**
 * branch-work-type.ts — classify a git branch name into a coarse work-type enum
 * (DEVELOPER-MODEL ADR-DM6, the sanctioned classify-then-discard move). The branch
 * name is read locally and DISCARDED here; only the closed `BranchWorkType` enum
 * ships. A work-intent conditioner (outcome | work-type), never a grade.
 */
import type { BranchWorkType } from "@seorak/types";

/** Branch-name PREFIX → work-type. Conventional-branch prefixes map to the four
 *  real buckets; a trunk branch (main/master/develop), a bare name, or an
 *  unrecognized prefix reads as "other" (a real bucket, never a guess). */
export function classifyBranchWorkType(branch: string | null | undefined): BranchWorkType {
  if (!branch) return "other";
  // The prefix is the segment before the first "/" (or the whole name), lowercased.
  const slash = branch.indexOf("/");
  const prefix = (slash >= 0 ? branch.slice(0, slash) : branch).toLowerCase();
  switch (prefix) {
    case "feat":
    case "feature":
    case "feet": // common typo, harmless to map
      return "feature";
    case "fix":
    case "bugfix":
    case "hotfix":
    case "bug":
      return "fix";
    case "refactor":
    case "refac":
    case "cleanup":
      return "refactor";
    case "chore":
    case "ci":
    case "docs":
    case "doc":
    case "build":
    case "test":
    case "tests":
    case "style":
    case "perf":
    case "deps":
    case "release":
      return "chore";
    default:
      return "other";
  }
}
