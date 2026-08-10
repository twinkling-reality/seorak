#!/usr/bin/env node
/**
 * Vendors stack badge SVGs from Simple Icons into public/assets/stack/.
 * Run from repo root: node packages/web/scripts/sync-stack-icons.mjs
 */
import { mkdir, writeFile, copyFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const VERSION = '15.0.0';
const BASE = `https://raw.githubusercontent.com/simple-icons/simple-icons/${VERSION}/icons`;
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../public/assets/stack');

/** @type {Record<string, Array<{ file: string, slug: string, copyFrom?: string }>>} */
const MANIFEST = {
  languages: [
    { file: 'typescript', slug: 'typescript' },
    { file: 'javascript', slug: 'javascript' },
    { file: 'python', slug: 'python' },
    { file: 'rust', slug: 'rust' },
    { file: 'go', slug: 'go' },
    { file: 'java', slug: 'openjdk' },
    { file: 'kotlin', slug: 'kotlin' },
    { file: 'swift', slug: 'swift' },
    { file: 'c', slug: 'c' },
    { file: 'cpp', slug: 'cplusplus' },
    { file: 'csharp', slug: 'dotnet' },
    { file: 'ruby', slug: 'ruby' },
    { file: 'php', slug: 'php' },
    { file: 'shell', slug: 'gnubash' },
    { file: 'lua', slug: 'lua' },
    { file: 'html', slug: 'html5' },
    { file: 'css', slug: 'css' },
    { file: 'sql', slug: 'postgresql' },
    { file: 'markdown', slug: 'markdown' },
    { file: 'json', slug: 'json' },
    { file: 'yaml', slug: 'yaml' },
    { file: 'toml', slug: 'toml' },
    { file: 'vue', slug: 'vuedotjs' },
    { file: 'svelte', slug: 'svelte' },
  ],
  frameworks: [
    { file: 'next', slug: 'nextdotjs' },
    { file: 'nuxt', slug: 'nuxt' },
    { file: 'remix', slug: 'remix' },
    { file: 'sveltekit', slug: 'svelte' },
    { file: 'astro', slug: 'astro' },
    { file: 'react', slug: 'react' },
    { file: 'vue', slug: 'vuedotjs' },
    { file: 'svelte', slug: 'svelte' },
    { file: 'angular', slug: 'angular' },
    { file: 'solid', slug: 'solid' },
    { file: 'expo', slug: 'expo' },
    { file: 'react-native', slug: 'react' },
    { file: 'electron', slug: 'electron' },
    { file: 'express', slug: 'express' },
    { file: 'fastify', slug: 'fastify' },
    { file: 'nest', slug: 'nestjs' },
    { file: 'django', slug: 'django' },
    { file: 'flask', slug: 'flask' },
    { file: 'fastapi', slug: 'fastapi' },
    { file: 'rails', slug: 'rubyonrails' },
    { file: 'laravel', slug: 'laravel' },
    { file: 'spring', slug: 'spring' },
  ],
  'package-managers': [
    { file: 'npm', slug: 'npm' },
    { file: 'pnpm', slug: 'pnpm' },
    { file: 'yarn', slug: 'yarn' },
    { file: 'bun', slug: 'bun' },
    { file: 'pip', slug: 'pypi' },
    { file: 'poetry', slug: 'poetry' },
    { file: 'uv', slug: 'uv' },
    { file: 'pipenv', slug: 'python' },
    { file: 'cargo', slug: 'rust' },
    { file: 'gomod', slug: 'go' },
    { file: 'bundler', slug: 'rubygems' },
    { file: 'composer', slug: 'composer' },
    { file: 'maven', slug: 'apachemaven' },
    { file: 'gradle', slug: 'gradle' },
  ],
  categories: [
    { file: 'source', slug: 'codesandbox' },
    { file: 'test', slug: 'vitest' },
    { file: 'config', slug: 'editorconfig' },
    { file: 'styles', slug: 'sass' },
    { file: 'docs', slug: 'readthedocs' },
    { file: 'data', slug: 'sqlite' },
    { file: 'other', slug: 'dotenv' },
  ],
  'branch-work': [
    { file: 'feature', slug: 'gitlab' },
    { file: 'fix', slug: 'sentry' },
    { file: 'refactor', slug: 'biome' },
    { file: 'chore', slug: 'dependabot' },
    { file: 'other', slug: 'git' },
  ],
};

async function fetchSvg(slug) {
  const res = await fetch(`${BASE}/${slug}.svg`);
  if (!res.ok) throw new Error(`Missing slug: ${slug} (${res.status})`);
  return res.text();
}

async function syncDir(dir, entries) {
  const outDir = join(ROOT, dir);
  await mkdir(outDir, { recursive: true });
  const written = new Set();

  for (const { file, slug } of entries) {
    const dest = join(outDir, `${file}.svg`);
    const svg = await fetchSvg(slug);
    await writeFile(dest, svg);
    written.add(dest);
    console.log(`  ${dir}/${file}.svg ← ${slug}`);
  }

  return written;
}

async function main() {
  console.log(`Syncing stack icons from Simple Icons ${VERSION}…`);
  for (const [dir, entries] of Object.entries(MANIFEST)) {
    await syncDir(dir, entries);
  }
  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
