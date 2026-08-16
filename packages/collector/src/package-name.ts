/**
 * package-name.ts — the published npm package name, in one place.
 *
 * It appears in three kinds of place that must never disagree: the manifest
 * check that locates the package root, the registry spec setup installs when it
 * stages a durable runtime, and every command string the product prints. A
 * rename that missed any one of them would leave setup unable to find itself,
 * or telling the reader to run something that does not exist.
 *
 * The CLI is the product's entry point on a developer's machine, so it carries
 * the product's name rather than an internal component's: `npx seorak setup`,
 * not a scoped path through the architecture. The libraries stay scoped —
 * `@seorak/types` and `@seorak/dashboard` are dependencies, not on-ramps.
 */
export const COLLECTOR_PACKAGE = "seorak";
