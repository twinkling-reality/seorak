/**
 * Pure draft helpers for the Public presence settings section.
 *
 * Grant refresh, normalize, and validate live here so the React section only
 * owns load/mutate/save UI. Wire shapes stay in `@seorak/types`; this module is
 * Settings UX draft math only.
 */

import type {
  OwnerPublicationManifest,
  OwnerPublicationProjectSelection,
  OwnerPublicationTokenUsageSelection,
  PublicationEvidenceRangeDays,
  PublicationSurface,
  PublicationTokenUsageRangeDays,
  PublicActivityField,
  PublicActivityPublicationGrants,
  PublicProfileField,
  PublicProfilePublicationGrants,
  PublicProfileSurfaceGrant,
  PublicProfileValues,
  PublicProjectEvidenceField,
  PublicProjectPublicationGrants,
  PublicProjectSurfaceGrant,
  PublicProjectValues,
  PublicTokenUsageField,
  PublicTokenUsagePublicationGrants,
} from '@seorak/types';
import type {
  PublicPresenceProjectOption,
  PublicPublicationStatus,
} from '../../lib/publicationApi.js';

export const SURFACES: readonly PublicationSurface[] = ['web', 'search', 'api', 'mcp'];
export const EVIDENCE_FIELDS: readonly PublicProjectEvidenceField[] = [
  'sessionCount',
  'toolCallCount',
  'shippedChangeRate',
  'lineSurvivalRate',
];
export const ACTIVITY_FIELDS: readonly PublicActivityField[] = ['calendar', 'streak'];
export const TOKEN_USAGE_FIELDS: readonly PublicTokenUsageField[] = ['series', 'totals'];

export const SURFACE_COPY: Record<PublicationSurface, { label: string; detail: string }> = {
  web: { label: 'Public web page', detail: 'Show this presence to signed-out visitors.' },
  search: { label: 'Directory search', detail: 'Include public text in directory results.' },
  api: { label: 'Public API', detail: 'Allow unauthenticated structured reads.' },
  mcp: { label: 'Public MCP', detail: 'Allow public tool discovery of this projection.' },
};

export const EVIDENCE_LABELS: Record<PublicProjectEvidenceField, string> = {
  sessionCount: 'Distinct sessions',
  toolCallCount: 'Tool calls',
  shippedChangeRate: 'Shipped-change rate',
  lineSurvivalRate: 'Line-survival rate',
};

export const TOKEN_USAGE_FIELD_LABELS: Record<PublicTokenUsageField, string> = {
  series: 'Daily series',
  totals: 'Period totals',
};

function disabledProfileGrant(): PublicProfileSurfaceGrant {
  return { enabled: false, fields: [] };
}

function disabledProjectGrant(): PublicProjectSurfaceGrant {
  return { enabled: false, fields: [], evidence: [] };
}

export function disabledActivityGrant() {
  return { enabled: false, fields: [] } as const;
}

export function disabledTokenUsageGrant() {
  return { enabled: false, fields: [] } as const;
}

export function commandId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return `cmd_${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

export function emptyManifest(): OwnerPublicationManifest {
  return {
    apiVersion: 'v1',
    commandId: commandId(),
    expectedRevision: 0,
    profileSlug: '',
    profile: {},
    grants: {
      web: disabledProfileGrant(),
      search: disabledProfileGrant(),
      api: disabledProfileGrant(),
      mcp: disabledProfileGrant(),
    },
    activity: null,
    tokenUsage: null,
    projects: [],
  };
}

export function presentProfileFields(profile: PublicProfileValues): PublicProfileField[] {
  const fields: PublicProfileField[] = [];
  for (const field of [
    'displayName', 'headline', 'bio', 'location', 'avatarUrl', 'contactUrl',
  ] as const) {
    const value = profile[field];
    if (typeof value === 'string' && value.trim() !== '') fields.push(field);
  }
  return fields;
}

export function presentProjectFields(project: PublicProjectValues) {
  const fields: Array<keyof PublicProjectValues> = [];
  for (const field of [
    'name', 'summary', 'role', 'startedOn', 'endedOn',
    'projectUrl', 'sourceUrl', 'technologies',
  ] as const) {
    const value = project[field];
    if (Array.isArray(value) ? value.length > 0 : value !== undefined && value !== null && value !== '') {
      fields.push(field);
    }
  }
  return fields;
}

export function profileGrant(
  enabled: boolean,
  fields: readonly PublicProfileField[],
): PublicProfileSurfaceGrant {
  return enabled ? { enabled: true, fields: [...fields] } : disabledProfileGrant();
}

export function projectGrant(
  enabled: boolean,
  fields: readonly (keyof PublicProjectValues)[],
  evidence: readonly PublicProjectEvidenceField[],
): PublicProjectSurfaceGrant {
  return enabled
    ? {
        enabled: true,
        fields: [...fields],
        evidence: [...evidence],
      }
    : disabledProjectGrant();
}

export function contactEnabled(
  grants: PublicProfilePublicationGrants,
  surface: Exclude<PublicationSurface, 'search'>,
): boolean {
  const grant = grants[surface];
  return grant.enabled && grant.fields.includes('contactUrl');
}

function refreshProfileGrants(
  profile: PublicProfileValues,
  grants: PublicProfilePublicationGrants,
): PublicProfilePublicationGrants {
  const available = new Set(presentProfileFields(profile));
  return Object.fromEntries(SURFACES.map((surface) => {
    const current = grants[surface];
    if (!current.enabled) return [surface, disabledProfileGrant()];
    return [surface, profileGrant(true, current.fields.filter((field) =>
      available.has(field) && (surface !== 'search' || field !== 'contactUrl')
    ))];
  })) as unknown as PublicProfilePublicationGrants;
}

function refreshProjectGrants(
  selection: OwnerPublicationProjectSelection,
): PublicProjectPublicationGrants {
  const fields = new Set(presentProjectFields(selection.project));
  const evidence = new Set(selection.evidence.fields);
  return Object.fromEntries(SURFACES.map((surface) => {
    const current = selection.grants[surface];
    return [surface, projectGrant(
      current.enabled,
      current.fields.filter((field) => fields.has(field)),
      current.evidence.filter((field) => evidence.has(field)),
    )];
  })) as unknown as PublicProjectPublicationGrants;
}

export function activityGrants(
  source: PublicActivityPublicationGrants | null,
  surfaceEnabled: (surface: PublicationSurface) => boolean,
  fields: readonly PublicActivityField[] = ACTIVITY_FIELDS,
): PublicActivityPublicationGrants {
  const currentFields = source
    ? ACTIVITY_FIELDS.filter((field) =>
        (['web', 'api', 'mcp'] as const).some((surface) => {
          const grant = source[surface];
          return grant.enabled && grant.fields.includes(field);
        })
      )
    : [...fields];
  const selected = currentFields.length > 0 ? currentFields : [...fields];
  return {
    web: surfaceEnabled('web')
      ? { enabled: true, fields: selected }
      : disabledActivityGrant(),
    search: disabledActivityGrant(),
    api: surfaceEnabled('api')
      ? { enabled: true, fields: selected }
      : disabledActivityGrant(),
    mcp: surfaceEnabled('mcp')
      ? { enabled: true, fields: selected }
      : disabledActivityGrant(),
  };
}

export function tokenUsageGrants(
  source: PublicTokenUsagePublicationGrants | null,
  surfaceEnabled: (surface: PublicationSurface) => boolean,
  fields: readonly PublicTokenUsageField[] = TOKEN_USAGE_FIELDS,
): PublicTokenUsagePublicationGrants {
  const currentFields = source
    ? TOKEN_USAGE_FIELDS.filter((field) =>
        (['web', 'api', 'mcp'] as const).some((surface) => {
          const grant = source[surface];
          return grant.enabled && grant.fields.includes(field);
        })
      )
    : [...fields];
  const selected = currentFields.length > 0 ? currentFields : [...fields];
  return {
    web: surfaceEnabled('web')
      ? { enabled: true, fields: selected }
      : disabledTokenUsageGrant(),
    search: disabledTokenUsageGrant(),
    api: surfaceEnabled('api')
      ? { enabled: true, fields: selected }
      : disabledTokenUsageGrant(),
    mcp: surfaceEnabled('mcp')
      ? { enabled: true, fields: selected }
      : disabledTokenUsageGrant(),
  };
}

function normalizeTokenUsageSelection(
  selection: OwnerPublicationTokenUsageSelection,
): OwnerPublicationTokenUsageSelection {
  return {
    ...selection,
    grants: {
      ...selection.grants,
      search: disabledTokenUsageGrant(),
    },
  };
}

export function defaultTokenUsageSelection(
  manifest: OwnerPublicationManifest,
  rangeDays: PublicationTokenUsageRangeDays = 30,
): OwnerPublicationTokenUsageSelection {
  const surfaceEnabled = (surface: PublicationSurface) =>
    manifest.grants[surface].enabled;
  return {
    rangeDays,
    grants: tokenUsageGrants(null, surfaceEnabled),
    unavailable: 'publish-unavailable',
  };
}

export function normalizeManifest(manifest: OwnerPublicationManifest): OwnerPublicationManifest {
  const grants = refreshProfileGrants(manifest.profile, manifest.grants);
  return {
    ...manifest,
    grants,
    activity: manifest.activity
      ? {
          ...manifest.activity,
          grants: {
            ...manifest.activity.grants,
            search: disabledActivityGrant(),
          },
        }
      : null,
    tokenUsage: manifest.tokenUsage
      ? normalizeTokenUsageSelection(manifest.tokenUsage)
      : null,
    projects: manifest.projects.map((selection) => ({
      ...selection,
      grants: refreshProjectGrants(selection),
      tokenUsage: selection.tokenUsage
        ? normalizeTokenUsageSelection(selection.tokenUsage)
        : null,
    })),
  };
}

export function slugFor(label: string): string {
  const slug = label.toLowerCase().normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 63)
    .replace(/-$/, '');
  return slug || 'project';
}

export function selectedProject(
  option: PublicPresenceProjectOption,
  manifest: OwnerPublicationManifest,
): OwnerPublicationProjectSelection {
  const existingSlugs = new Set(manifest.projects.map((project) => project.projectSlug));
  const base = slugFor(option.label);
  let projectSlug = base;
  for (let suffix = 2; existingSlugs.has(projectSlug); suffix += 1) {
    projectSlug = `${base.slice(0, Math.max(1, 62 - String(suffix).length))}-${suffix}`;
  }
  const evidence = {
    fields: ['sessionCount'] as readonly PublicProjectEvidenceField[],
    rangeDays: 30 as PublicationEvidenceRangeDays,
    unavailable: 'publish-unavailable' as const,
  };
  const project = { name: option.label };
  const provisional: OwnerPublicationProjectSelection = {
    sourceProjectId: option.sourceProjectId,
    projectSlug,
    project,
    grants: {
      web: disabledProjectGrant(),
      search: disabledProjectGrant(),
      api: disabledProjectGrant(),
      mcp: disabledProjectGrant(),
    },
    evidence,
    tokenUsage: null,
  };
  return {
    ...provisional,
    grants: Object.fromEntries(SURFACES.map((surface) => [
      surface,
      projectGrant(
        manifest.grants[surface].enabled,
        presentProjectFields(project),
        evidence.fields,
      ),
    ])) as unknown as PublicProjectPublicationGrants,
  };
}

export function validateDraft(manifest: OwnerPublicationManifest): string | null {
  if (!/^(?=.{1,63}$)[a-z0-9]+(?:-[a-z0-9]+)*$/.test(manifest.profileSlug)) {
    return 'Choose a lowercase public handle using letters, numbers, and hyphens.';
  }
  if (!SURFACES.some((surface) => manifest.grants[surface].enabled)) {
    return 'Enable at least one public surface before saving.';
  }
  if (manifest.profile.contactUrl) {
    try {
      const contact = new URL(manifest.profile.contactUrl);
      if (contact.protocol !== 'https:' || contact.username || contact.password) {
        return 'The contact link must be a credential-free HTTPS URL.';
      }
    } catch {
      return 'The contact link must be a credential-free HTTPS URL.';
    }
  }
  const slugs = new Set<string>();
  for (const project of manifest.projects) {
    if (!/^(?=.{1,63}$)[a-z0-9]+(?:-[a-z0-9]+)*$/.test(project.projectSlug)) {
      return 'Every selected project needs a lowercase public slug.';
    }
    if (slugs.has(project.projectSlug)) return 'Project public slugs must be unique.';
    slugs.add(project.projectSlug);
    if (project.evidence.fields.length === 0) {
      return 'Every selected project needs at least one evidence field.';
    }
  }
  if (manifest.activity) {
    const activityFields = new Set(
      (['web', 'api', 'mcp'] as const).flatMap((surface) => {
        const grant = manifest.activity!.grants[surface];
        return grant.enabled ? [...grant.fields] : [];
      }),
    );
    if (activityFields.size === 0) return 'Choose calendar or streak for activity.';
  }
  if (manifest.tokenUsage) {
    const tokenUsageFields = new Set(
      (['web', 'api', 'mcp'] as const).flatMap((surface) => {
        const grant = manifest.tokenUsage!.grants[surface];
        return grant.enabled ? [...grant.fields] : [];
      }),
    );
    if (tokenUsageFields.size === 0) {
      return 'Choose daily series or period totals for token usage.';
    }
  }
  for (const project of manifest.projects) {
    if (!project.tokenUsage) continue;
    const tokenUsageFields = new Set(
      (['web', 'api', 'mcp'] as const).flatMap((surface) => {
        const grant = project.tokenUsage!.grants[surface];
        return grant.enabled ? [...grant.fields] : [];
      }),
    );
    if (tokenUsageFields.size === 0) {
      return 'Choose daily series or period totals for each project token usage.';
    }
  }
  return null;
}

export function publicPresenceStatusMessage(status: PublicPublicationStatus): string {
  switch (status.state) {
    case 'saved':
      return 'Saved privately. Nothing changed publicly yet.';
    case 'queued':
      return status.operation === 'revoke'
        ? 'Revocation queued. Your public presence may remain visible until it is applied.'
        : 'Queued for publication. Your saved version is not public yet.';
    case 'delivering':
      return status.operation === 'revoke'
        ? 'Delivering revocation to the public directory.'
        : 'Delivering this frozen version to the public directory.';
    case 'retrying':
      return status.operation === 'revoke'
        ? 'Revocation is retrying. Your public presence may still be visible.'
        : 'Publication is retrying. The last applied public version remains unchanged.';
    case 'applied':
      return `Publicly applied as version ${status.appliedVersion}.`;
    case 'failed':
      return status.operation === 'revoke'
        ? 'Revocation failed. Your public presence may still be visible; retry the blocking delivery.'
        : 'Publication failed. Your last applied public version remains unchanged.';
    case 'revoked':
      return 'Revoked. No current public presence is available.';
  }
}
