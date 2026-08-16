/**
 * The resource server this build reads, in one place, from configuration.
 *
 * There is deliberately NO built-in production origin. This file ships in the
 * open core, and the operated directory is a private service, so a build that
 * has not been told which directory it reads must address none rather than
 * quietly address Seorak's. An unconfigured build is a build with no directory,
 * and every reader says so instead of resolving somewhere else.
 *
 * `VITE_PUBLIC_DIRECTORY_URL` is the single source of that value, read here
 * from whichever environment is present: `import.meta.env` under Vite, and the
 * process environment under the node script that writes the OpenAPI document,
 * llms.txt, and the generated markdown. One NAME rather than one constant is
 * what keeps them together, because a second copy of this value is how a
 * published spec ends up pointing somewhere the API is not.
 *
 * WHY IT LIVES IN `lib` RATHER THAN BESIDE THE CLIENT THAT USES IT MOST.
 * `src/public/**` is private and `src/**` is public, so the dashboard's own
 * Settings view may not import the directory client to learn this. The value
 * itself is a build-time environment string rather than anything private, so
 * the public half holds it and the private client reads it from here. Private
 * may read public; the reverse is what ADR 005 forbids.
 */
function configuredDirectoryOrigin(): string {
  const fromBuild = import.meta.env?.VITE_PUBLIC_DIRECTORY_URL;
  const fromProcess = (
    globalThis as { process?: { env?: Record<string, string | undefined> } }
  ).process?.env?.VITE_PUBLIC_DIRECTORY_URL;
  return (fromBuild ?? fromProcess ?? '').trim().replace(/\/$/, '');
}

export const HOSTED_PUBLIC_DIRECTORY_ORIGIN = configuredDirectoryOrigin();

export function publicDirectoryOrigin(): string {
  if (HOSTED_PUBLIC_DIRECTORY_ORIGIN) return HOSTED_PUBLIC_DIRECTORY_ORIGIN;
  // A dev server has the local directory on 8792 to talk to. A build that was
  // never told has nothing, and returns nothing rather than a guess.
  return import.meta.env?.DEV ? 'http://127.0.0.1:8792' : '';
}

function route(path: string, parameters: Record<string, string>): string {
  return Object.entries(parameters).reduce(
    (value, [name, parameter]) => value.replace(`:${name}`, encodeURIComponent(parameter)),
    path,
  );
}

export interface TokenUsageSvgEmbedOptions {
  days: PublicationTokenUsageRangeDays;
  tools?: 'all' | 'claude-code' | 'codex';
  theme?: 'light' | 'dark';
}

export function profileTokenUsageSvgUrl(
  profileSlug: string,
  options: TokenUsageSvgEmbedOptions,
): string | null {
  const origin = publicDirectoryOrigin();
  if (!origin || !profileSlug) return null;
  const url = new URL(
    route(PUBLIC_WEB_TOKEN_USAGE_SVG_PATH, { profileSlug }),
    `${origin}/`,
  );
  url.searchParams.set('days', String(options.days));
  url.searchParams.set('tools', options.tools ?? 'all');
  url.searchParams.set('theme', options.theme ?? 'light');
  return url.toString();
}

export function projectTokenUsageSvgUrl(
  profileSlug: string,
  projectSlug: string,
  options: TokenUsageSvgEmbedOptions,
): string | null {
  const origin = publicDirectoryOrigin();
  if (!origin || !profileSlug || !projectSlug) return null;
  const url = new URL(
    route(PUBLIC_WEB_PROJECT_TOKEN_USAGE_SVG_PATH, { profileSlug, projectSlug }),
    `${origin}/`,
  );
  url.searchParams.set('days', String(options.days));
  url.searchParams.set('tools', options.tools ?? 'all');
  url.searchParams.set('theme', options.theme ?? 'light');
  return url.toString();
}

export function tokenUsageReadmeSnippet(svgUrl: string): string {
  return `![Seorak token usage](${svgUrl})`;
}

export function tokenUsageHtmlSnippet(svgUrl: string): string {
  return `<img src="${svgUrl}" alt="Seorak token usage">`;
}
import type { PublicationTokenUsageRangeDays } from '@seorak/types';
import {
  PUBLIC_WEB_PROJECT_TOKEN_USAGE_SVG_PATH,
  PUBLIC_WEB_TOKEN_USAGE_SVG_PATH,
} from '@seorak/types';
