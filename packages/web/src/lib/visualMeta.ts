// Closed-enum visual registry for Compare context rows (languages, frameworks,
// package managers, file categories, branch work). Mirrors toolMeta.ts: label +
// brand color + SVG; unknown ids get a deterministic color + abbrev fallback.
//
// Icons vendored from Simple Icons — see packages/web/scripts/sync-stack-icons.mjs.

export type VisualKind =
  | 'language'
  | 'framework'
  | 'packageManager'
  | 'fileCategory'
  | 'branchWork';

export interface VisualMetaEntry {
  label: string;
  abbrev: string;
  icon: string | null;
  color: string;
}

export interface ResolvedVisualMeta extends VisualMetaEntry {
  kind: VisualKind;
  id: string;
}

function deriveColor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = ((hash << 5) - hash + seed.charCodeAt(i)) | 0;
  }
  const hue = ((hash % 360) + 360) % 360;
  return `hsl(${hue}, 52%, 46%)`;
}

function titleCase(id: string): string {
  return id
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

const lang = (file: string) => `/assets/stack/languages/${file}.svg`;
const fw = (file: string) => `/assets/stack/frameworks/${file}.svg`;
const pm = (file: string) => `/assets/stack/package-managers/${file}.svg`;
const cat = (file: string) => `/assets/stack/categories/${file}.svg`;
const branch = (file: string) => `/assets/stack/branch-work/${file}.svg`;

const LANGUAGE_META: Record<string, VisualMetaEntry> = {
  typescript: { label: 'TypeScript', abbrev: 'TS', icon: lang('typescript'), color: '#3178c6' },
  javascript: { label: 'JavaScript', abbrev: 'JS', icon: lang('javascript'), color: '#f7df1e' },
  python: { label: 'Python', abbrev: 'Py', icon: lang('python'), color: '#3776ab' },
  rust: { label: 'Rust', abbrev: 'Rs', icon: lang('rust'), color: '#dea584' },
  go: { label: 'Go', abbrev: 'Go', icon: lang('go'), color: '#00add8' },
  java: { label: 'Java', abbrev: 'Jv', icon: lang('java'), color: '#b07219' },
  kotlin: { label: 'Kotlin', abbrev: 'Kt', icon: lang('kotlin'), color: '#7f52ff' },
  swift: { label: 'Swift', abbrev: 'Sw', icon: lang('swift'), color: '#f05138' },
  c: { label: 'C', abbrev: 'C', icon: lang('c'), color: '#555555' },
  cpp: { label: 'C++', abbrev: 'C++', icon: lang('cpp'), color: '#00599c' },
  csharp: { label: 'C#', abbrev: 'C#', icon: lang('csharp'), color: '#512bd4' },
  ruby: { label: 'Ruby', abbrev: 'Rb', icon: lang('ruby'), color: '#cc342d' },
  php: { label: 'PHP', abbrev: 'PHP', icon: lang('php'), color: '#777bb4' },
  shell: { label: 'Shell', abbrev: 'Sh', icon: lang('shell'), color: '#4eaa25' },
  lua: { label: 'Lua', abbrev: 'Lu', icon: lang('lua'), color: '#000080' },
  html: { label: 'HTML', abbrev: 'Ht', icon: lang('html'), color: '#e34f26' },
  css: { label: 'CSS', abbrev: 'Cs', icon: lang('css'), color: '#1572b6' },
  sql: { label: 'SQL', abbrev: 'Sq', icon: lang('sql'), color: '#336791' },
  markdown: { label: 'Markdown', abbrev: 'Md', icon: lang('markdown'), color: '#083fa1' },
  json: { label: 'JSON', abbrev: 'Jn', icon: lang('json'), color: '#292929' },
  yaml: { label: 'YAML', abbrev: 'Ym', icon: lang('yaml'), color: '#cb171e' },
  toml: { label: 'TOML', abbrev: 'Tm', icon: lang('toml'), color: '#9c4221' },
  vue: { label: 'Vue', abbrev: 'Vu', icon: lang('vue'), color: '#42b883' },
  svelte: { label: 'Svelte', abbrev: 'Sv', icon: lang('svelte'), color: '#ff3e00' },
};

const FRAMEWORK_META: Record<string, VisualMetaEntry> = {
  next: { label: 'Next.js', abbrev: 'Nx', icon: fw('next'), color: '#111111' },
  nuxt: { label: 'Nuxt', abbrev: 'Nu', icon: fw('nuxt'), color: '#00dc82' },
  remix: { label: 'Remix', abbrev: 'Rx', icon: fw('remix'), color: '#121212' },
  sveltekit: { label: 'SvelteKit', abbrev: 'SK', icon: fw('sveltekit'), color: '#ff3e00' },
  astro: { label: 'Astro', abbrev: 'As', icon: fw('astro'), color: '#bc52ee' },
  react: { label: 'React', abbrev: 'Re', icon: fw('react'), color: '#61dafb' },
  vue: { label: 'Vue', abbrev: 'Vu', icon: fw('vue'), color: '#42b883' },
  svelte: { label: 'Svelte', abbrev: 'Sv', icon: fw('svelte'), color: '#ff3e00' },
  angular: { label: 'Angular', abbrev: 'Ng', icon: fw('angular'), color: '#dd0031' },
  solid: { label: 'Solid', abbrev: 'So', icon: fw('solid'), color: '#2c4f7c' },
  expo: { label: 'Expo', abbrev: 'Ex', icon: fw('expo'), color: '#000020' },
  'react-native': { label: 'React Native', abbrev: 'RN', icon: fw('react-native'), color: '#61dafb' },
  electron: { label: 'Electron', abbrev: 'El', icon: fw('electron'), color: '#47848f' },
  express: { label: 'Express', abbrev: 'Ex', icon: fw('express'), color: '#111111' },
  fastify: { label: 'Fastify', abbrev: 'Fa', icon: fw('fastify'), color: '#111111' },
  nest: { label: 'NestJS', abbrev: 'Ne', icon: fw('nest'), color: '#e0234e' },
  django: { label: 'Django', abbrev: 'Dj', icon: fw('django'), color: '#092e20' },
  flask: { label: 'Flask', abbrev: 'Fl', icon: fw('flask'), color: '#111111' },
  fastapi: { label: 'FastAPI', abbrev: 'FA', icon: fw('fastapi'), color: '#009688' },
  rails: { label: 'Rails', abbrev: 'Ra', icon: fw('rails'), color: '#cc0000' },
  laravel: { label: 'Laravel', abbrev: 'La', icon: fw('laravel'), color: '#ff2d20' },
  spring: { label: 'Spring', abbrev: 'Sp', icon: fw('spring'), color: '#6db33f' },
};

const PACKAGE_MANAGER_META: Record<string, VisualMetaEntry> = {
  npm: { label: 'npm', abbrev: 'nm', icon: pm('npm'), color: '#cb3837' },
  pnpm: { label: 'pnpm', abbrev: 'pn', icon: pm('pnpm'), color: '#f69220' },
  yarn: { label: 'Yarn', abbrev: 'Ya', icon: pm('yarn'), color: '#2c8ebb' },
  bun: { label: 'Bun', abbrev: 'Bu', icon: pm('bun'), color: '#fbf0df' },
  pip: { label: 'pip', abbrev: 'pi', icon: pm('pip'), color: '#3776ab' },
  poetry: { label: 'Poetry', abbrev: 'Po', icon: pm('poetry'), color: '#60a5fa' },
  uv: { label: 'uv', abbrev: 'uv', icon: pm('uv'), color: '#de5fe9' },
  pipenv: { label: 'Pipenv', abbrev: 'Pe', icon: pm('pipenv'), color: '#82c0c0' },
  cargo: { label: 'Cargo', abbrev: 'Cg', icon: pm('cargo'), color: '#dea584' },
  gomod: { label: 'Go modules', abbrev: 'Go', icon: pm('gomod'), color: '#00add8' },
  bundler: { label: 'Bundler', abbrev: 'Bd', icon: pm('bundler'), color: '#cc342d' },
  composer: { label: 'Composer', abbrev: 'Co', icon: pm('composer'), color: '#885630' },
  maven: { label: 'Maven', abbrev: 'Mv', icon: pm('maven'), color: '#c71a36' },
  gradle: { label: 'Gradle', abbrev: 'Gr', icon: pm('gradle'), color: '#02303a' },
};

const FILE_CATEGORY_META: Record<string, VisualMetaEntry> = {
  source: { label: 'Source', abbrev: 'Sr', icon: cat('source'), color: '#3b82f6' },
  test: { label: 'Tests', abbrev: 'Te', icon: cat('test'), color: '#22c55e' },
  config: { label: 'Config', abbrev: 'Cf', icon: cat('config'), color: '#a855f7' },
  styles: { label: 'Styles', abbrev: 'St', icon: cat('styles'), color: '#ec4899' },
  docs: { label: 'Docs', abbrev: 'Dc', icon: cat('docs'), color: '#64748b' },
  data: { label: 'Data', abbrev: 'Da', icon: cat('data'), color: '#f59e0b' },
  other: { label: 'Other', abbrev: 'Ot', icon: cat('other'), color: '#94a3b8' },
};

const BRANCH_WORK_META: Record<string, VisualMetaEntry> = {
  feature: { label: 'Feature work', abbrev: 'Ft', icon: branch('feature'), color: '#3b82f6' },
  fix: { label: 'Fixes', abbrev: 'Fx', icon: branch('fix'), color: '#ef4444' },
  refactor: { label: 'Refactor', abbrev: 'Rf', icon: branch('refactor'), color: '#8b5cf6' },
  chore: { label: 'Chore', abbrev: 'Ch', icon: branch('chore'), color: '#64748b' },
  other: { label: 'Other', abbrev: 'Ot', icon: branch('other'), color: '#94a3b8' },
};

const REGISTRIES: Record<VisualKind, Record<string, VisualMetaEntry>> = {
  language: LANGUAGE_META,
  framework: FRAMEWORK_META,
  packageManager: PACKAGE_MANAGER_META,
  fileCategory: FILE_CATEGORY_META,
  branchWork: BRANCH_WORK_META,
};

export function normalizeVisualId(id: string | null | undefined): string {
  return String(id || '')
    .trim()
    .toLowerCase();
}

export function getVisualMeta(kind: VisualKind, id: string | null | undefined): ResolvedVisualMeta {
  const normalized = normalizeVisualId(id);
  const table = REGISTRIES[kind];
  const hit = table[normalized];
  if (hit) {
    return { kind, id: normalized, ...hit };
  }
  const label = titleCase(normalized || 'unknown');
  const abbrev = label.slice(0, 2);
  return {
    kind,
    id: normalized || 'unknown',
    label,
    abbrev,
    icon: null,
    color: deriveColor(`${kind}:${normalized}`),
  };
}

/** Which Compare metrics should render a visual badge beside the face value. */
export const COMPARE_VISUAL_BY_METRIC: Partial<
  Record<string, { kind: VisualKind; idFromValue?: boolean }>
> = {
  stack: { kind: 'language', idFromValue: true },
  'file-category': { kind: 'fileCategory', idFromValue: true },
  framework: { kind: 'framework', idFromValue: true },
  'package-manager': { kind: 'packageManager', idFromValue: true },
  'branch-mix': { kind: 'branchWork', idFromValue: true },
};
