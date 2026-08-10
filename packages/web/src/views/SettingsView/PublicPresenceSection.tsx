import {
  useEffect,
  useMemo,
  useState,
  type ChangeEvent,
} from 'react';
import type {
  OwnerPublicationActivitySelection,
  OwnerPublicationManifest,
  OwnerPublicationProjectSelection,
  PublicationActivityRangeDays,
  PublicationEvidenceRangeDays,
  PublicationSurface,
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
} from '@seorak/types';
import OutlineActionButton from '../../components/controls/OutlineActionButton.js';
import {
  publicationApi,
  type PublicPresenceApi,
  type PublicPresenceDocument,
  type PublicPresenceProjectOption,
  type PublicPublicationStatus,
} from '../../lib/publicationApi.js';
import styles from './PublicPresenceSection.module.css';

const SURFACES: readonly PublicationSurface[] = ['web', 'search', 'api', 'mcp'];
const EVIDENCE_FIELDS: readonly PublicProjectEvidenceField[] = [
  'sessionCount',
  'toolCallCount',
  'shippedChangeRate',
  'lineSurvivalRate',
];
const ACTIVITY_FIELDS: readonly PublicActivityField[] = ['calendar', 'streak'];

const SURFACE_COPY: Record<PublicationSurface, { label: string; detail: string }> = {
  web: { label: 'Public web page', detail: 'Show this presence to signed-out visitors.' },
  search: { label: 'Directory search', detail: 'Include public text in directory results.' },
  api: { label: 'Public API', detail: 'Allow unauthenticated structured reads.' },
  mcp: { label: 'Public MCP', detail: 'Allow public tool discovery of this projection.' },
};

const EVIDENCE_LABELS: Record<PublicProjectEvidenceField, string> = {
  sessionCount: 'Distinct sessions',
  toolCallCount: 'Tool calls',
  shippedChangeRate: 'Shipped-change rate',
  lineSurvivalRate: 'Line-survival rate',
};

function disabledProfileGrant(): PublicProfileSurfaceGrant {
  return { enabled: false, fields: [] };
}

function disabledProjectGrant(): PublicProjectSurfaceGrant {
  return { enabled: false, fields: [], evidence: [] };
}

function disabledActivityGrant() {
  return { enabled: false, fields: [] } as const;
}

function commandId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return `cmd_${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

function emptyManifest(): OwnerPublicationManifest {
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
    projects: [],
  };
}

function presentProfileFields(profile: PublicProfileValues): PublicProfileField[] {
  const fields: PublicProfileField[] = [];
  for (const field of [
    'displayName', 'headline', 'bio', 'location', 'avatarUrl', 'contactUrl',
  ] as const) {
    const value = profile[field];
    if (typeof value === 'string' && value.trim() !== '') fields.push(field);
  }
  return fields;
}

function presentProjectFields(project: PublicProjectValues) {
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

function profileGrant(
  enabled: boolean,
  fields: readonly PublicProfileField[],
): PublicProfileSurfaceGrant {
  return enabled ? { enabled: true, fields: [...fields] } : disabledProfileGrant();
}

function projectGrant(
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

function contactEnabled(
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

function activityGrants(
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

function normalizeManifest(manifest: OwnerPublicationManifest): OwnerPublicationManifest {
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
    projects: manifest.projects.map((selection) => ({
      ...selection,
      grants: refreshProjectGrants(selection),
    })),
  };
}

function slugFor(label: string): string {
  const slug = label.toLowerCase().normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 63)
    .replace(/-$/, '');
  return slug || 'project';
}

function selectedProject(
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

function validateDraft(manifest: OwnerPublicationManifest): string | null {
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

export interface PublicPresenceSectionProps {
  api?: PublicPresenceApi;
  pollIntervalMs?: number;
}

export default function PublicPresenceSection({
  api = publicationApi,
  pollIntervalMs = 2_500,
}: PublicPresenceSectionProps) {
  const [document, setDocument] = useState<PublicPresenceDocument | null>(null);
  const [draft, setDraft] = useState<OwnerPublicationManifest | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<'save' | 'publish' | 'revoke' | 'retry' | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void api.load({ signal: controller.signal }).then((loaded) => {
      if (controller.signal.aborted) return;
      setDocument(loaded);
      setDraft(normalizeManifest(loaded.manifest ?? emptyManifest()));
      setUnavailable(false);
    }).catch(() => {
      if (!controller.signal.aborted) setUnavailable(true);
    });
    return () => controller.abort();
  }, [api]);

  useEffect(() => {
    const state = document?.status.state;
    if (state !== 'queued' && state !== 'delivering' && state !== 'retrying') return;
    const timer = window.setTimeout(() => {
      void api.load().then((loaded) => {
        setDocument(loaded);
        if (!dirty && loaded.manifest) setDraft(normalizeManifest(loaded.manifest));
      }).catch(() => {});
    }, pollIntervalMs);
    return () => window.clearTimeout(timer);
  }, [api, dirty, document?.status.state, pollIntervalMs]);

  const projectLabels = useMemo(() => new Map(
    document?.availableProjects.map((project) => [project.sourceProjectId, project.label]) ?? [],
  ), [document?.availableProjects]);

  function mutate(update: (current: OwnerPublicationManifest) => OwnerPublicationManifest): void {
    setDraft((current) => current ? normalizeManifest(update(current)) : current);
    setDirty(true);
    setFeedback(null);
  }

  function updateProfile(field: keyof PublicProfileValues, value: string): void {
    mutate((current) => {
      const profile = { ...current.profile } as Record<string, unknown>;
      if (value === '') delete profile[field];
      else profile[field] = value;
      return { ...current, profile: profile as PublicProfileValues };
    });
  }

  function setSurface(surface: PublicationSurface, enabled: boolean): void {
    mutate((current) => {
      const available = presentProfileFields(current.profile).filter((field) =>
        field !== 'contactUrl' || (surface !== 'search' &&
          current.grants[surface].enabled && current.grants[surface].fields.includes('contactUrl'))
      );
      return {
        ...current,
        grants: {
          ...current.grants,
          [surface]: profileGrant(enabled, available),
        },
      };
    });
  }

  function setProfileField(
    surface: PublicationSurface,
    field: Exclude<PublicProfileField, 'contactUrl'>,
    enabled: boolean,
  ): void {
    mutate((current) => {
      const grant = current.grants[surface];
      if (!grant.enabled || !Object.hasOwn(current.profile, field)) return current;
      const fields = new Set(grant.fields);
      if (enabled) fields.add(field);
      else fields.delete(field);
      return {
        ...current,
        grants: {
          ...current.grants,
          [surface]: profileGrant(true, [...fields]),
        },
      };
    });
  }

  function setContactSurface(
    surface: Exclude<PublicationSurface, 'search'>,
    enabled: boolean,
  ): void {
    mutate((current) => {
      const grant = current.grants[surface];
      if (!grant.enabled) return current;
      const fields: PublicProfileField[] = grant.fields.filter(
        (field) => field !== 'contactUrl',
      );
      if (enabled && current.profile.contactUrl) fields.push('contactUrl');
      return {
        ...current,
        grants: {
          ...current.grants,
          [surface]: profileGrant(true, fields),
        },
      };
    });
  }

  function toggleActivity(enabled: boolean): void {
    mutate((current) => {
      if (!enabled) return { ...current, activity: null };
      const surfaceEnabled = (surface: PublicationSurface) =>
        current.grants[surface].enabled;
      return {
        ...current,
        activity: {
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
          rangeDays: 90,
          grants: activityGrants(null, surfaceEnabled),
          unavailable: 'publish-unavailable',
        },
      };
    });
  }

  function updateActivity(
    patch: Partial<Omit<OwnerPublicationActivitySelection, 'grants'>>,
  ): void {
    mutate((current) => current.activity
      ? { ...current, activity: { ...current.activity, ...patch } }
      : current
    );
  }

  function setActivitySurface(surface: Exclude<PublicationSurface, 'search'>, enabled: boolean): void {
    mutate((current) => {
      if (!current.activity) return current;
      return {
        ...current,
        activity: {
          ...current.activity,
          grants: {
            ...current.activity.grants,
            [surface]: enabled
              ? { enabled: true, fields: [...ACTIVITY_FIELDS] }
              : disabledActivityGrant(),
          },
        },
      };
    });
  }

  function setActivityField(
    surface: Exclude<PublicationSurface, 'search'>,
    field: PublicActivityField,
    enabled: boolean,
  ): void {
    mutate((current) => {
      if (!current.activity || !current.activity.grants[surface].enabled) return current;
      const fields = new Set(current.activity.grants[surface].fields);
      if (enabled) fields.add(field);
      else fields.delete(field);
      return {
        ...current,
        activity: {
          ...current.activity,
          grants: {
            ...current.activity.grants,
            [surface]: { enabled: true, fields: [...fields] },
          },
        },
      };
    });
  }

  function toggleProject(option: PublicPresenceProjectOption, enabled: boolean): void {
    mutate((current) => ({
      ...current,
      projects: enabled
        ? [...current.projects, selectedProject(option, current)]
        : current.projects.filter((project) =>
            project.sourceProjectId !== option.sourceProjectId
          ),
    }));
  }

  function updateProject(
    sourceProjectId: string,
    update: (selection: OwnerPublicationProjectSelection) => OwnerPublicationProjectSelection,
  ): void {
    mutate((current) => ({
      ...current,
      projects: current.projects.map((project) =>
        project.sourceProjectId === sourceProjectId ? update(project) : project
      ),
    }));
  }

  function updateProjectValue(
    sourceProjectId: string,
    field: keyof PublicProjectValues,
    value: string,
  ): void {
    updateProject(sourceProjectId, (selection) => {
      const project = { ...selection.project } as Record<string, unknown>;
      if (value === '') delete project[field];
      else project[field] = value;
      return { ...selection, project: project as PublicProjectValues };
    });
  }

  function updateProjectTechnologies(sourceProjectId: string, value: string): void {
    updateProject(sourceProjectId, (selection) => {
      const technologies = value.split(',').map((item) => item.trim()).filter(Boolean);
      const project = { ...selection.project };
      if (technologies.length === 0) delete project.technologies;
      else project.technologies = [...new Set(technologies)].slice(0, 20);
      return { ...selection, project };
    });
  }

  function updateProjectGrant(
    sourceProjectId: string,
    surface: PublicationSurface,
    update: (grant: PublicProjectSurfaceGrant) => PublicProjectSurfaceGrant,
  ): void {
    updateProject(sourceProjectId, (selection) => {
      const grants = { ...selection.grants, [surface]: update(selection.grants[surface]) };
      const evidence = EVIDENCE_FIELDS.filter((field) =>
        SURFACES.some((candidate) => grants[candidate].enabled &&
          grants[candidate].evidence.includes(field))
      );
      return {
        ...selection,
        grants,
        evidence: { ...selection.evidence, fields: evidence },
      };
    });
  }

  function setProjectSurface(
    selection: OwnerPublicationProjectSelection,
    surface: PublicationSurface,
    enabled: boolean,
  ): void {
    updateProjectGrant(selection.sourceProjectId, surface, () =>
      projectGrant(
        enabled,
        presentProjectFields(selection.project),
        selection.evidence.fields.length > 0
          ? selection.evidence.fields
          : ['sessionCount'],
      )
    );
  }

  function setProjectField(
    selection: OwnerPublicationProjectSelection,
    surface: PublicationSurface,
    field: keyof PublicProjectValues,
    enabled: boolean,
  ): void {
    updateProjectGrant(selection.sourceProjectId, surface, (grant) => {
      if (!grant.enabled) return grant;
      const fields = new Set(grant.fields);
      if (enabled) fields.add(field);
      else fields.delete(field);
      return projectGrant(true, [...fields], grant.evidence);
    });
  }

  function setProjectEvidence(
    selection: OwnerPublicationProjectSelection,
    surface: PublicationSurface,
    field: PublicProjectEvidenceField,
    enabled: boolean,
  ): void {
    updateProjectGrant(selection.sourceProjectId, surface, (grant) => {
      if (!grant.enabled) return grant;
      const evidence = new Set(grant.evidence);
      if (enabled) evidence.add(field);
      else evidence.delete(field);
      return projectGrant(true, grant.fields, [...evidence]);
    });
  }

  function applyLoaded(loaded: PublicPresenceDocument, fallback: OwnerPublicationManifest): void {
    setDocument(loaded);
    setDraft(normalizeManifest(loaded.manifest ?? fallback));
    setDirty(false);
    setUnavailable(false);
  }

  async function saveCurrent(): Promise<PublicPresenceDocument | null> {
    if (!draft || !document) return null;
    const validation = validateDraft(draft);
    if (validation) {
      setFeedback(validation);
      return null;
    }
    const toSave: OwnerPublicationManifest = {
      ...normalizeManifest(draft),
      commandId: commandId(),
      expectedRevision: document.status.savedRevision,
    };
    setBusy('save');
    setFeedback(null);
    try {
      const loaded = await api.save(toSave);
      applyLoaded(loaded, toSave);
      setFeedback('Saved privately. Publish when this selection is ready.');
      return loaded;
    } catch {
      setFeedback('Could not save these private publication choices. Try again.');
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function publish(): Promise<void> {
    if (!draft || !document) return;
    let current = document;
    if (dirty || current.status.savedRevision === 0) {
      const saved = await saveCurrent();
      if (!saved) return;
      current = saved;
    }
    setBusy('publish');
    setFeedback(null);
    try {
      const loaded = await api.publish(current.status.savedRevision);
      applyLoaded(loaded, loaded.manifest ?? draft);
      setFeedback('Publication requested. Saved and publicly applied are tracked separately.');
    } catch {
      setFeedback('Could not queue this publication. Your saved choices are still private.');
    } finally {
      setBusy(null);
    }
  }

  async function revoke(): Promise<void> {
    if (!document || document.status.generatedVersion === 0) return;
    setBusy('revoke');
    setFeedback(null);
    try {
      const loaded = await api.revoke({
        commandId: commandId(),
        expectedGeneration: document.status.generatedVersion,
      });
      setDocument(loaded);
      if (loaded.manifest && !dirty) setDraft(normalizeManifest(loaded.manifest));
      setFeedback('Revocation requested. The status remains visible until it is applied.');
    } catch {
      setFeedback('Could not queue revocation. The current public version may still be visible.');
    } finally {
      setBusy(null);
    }
  }

  async function retry(): Promise<void> {
    const blockingGeneration = document?.status.blockingGeneration;
    if (!document || blockingGeneration === null || blockingGeneration === undefined) return;
    setBusy('retry');
    setFeedback(null);
    try {
      const loaded = await api.retry(blockingGeneration);
      setDocument(loaded);
      setFeedback('Retry queued. The last applied public version remains unchanged meanwhile.');
    } catch {
      setFeedback('Could not retry publication. Try again after checking the connection.');
    } finally {
      setBusy(null);
    }
  }

  if (unavailable) {
    return (
      <section className={styles.section} aria-labelledby="public-presence-title">
        <h2 id="public-presence-title">Public presence</h2>
        <p role="alert">Public-presence controls are unavailable. Nothing was made public.</p>
      </section>
    );
  }
  if (!document || !draft) {
    return (
      <section className={styles.section} aria-labelledby="public-presence-title">
        <h2 id="public-presence-title">Public presence</h2>
        <p>Loading private publication choices…</p>
      </section>
    );
  }

  const statusState = document.status.state;
  const contactAvailable = Boolean(draft.profile.contactUrl);
  return (
    <section className={styles.section} aria-labelledby="public-presence-title">
      <div className={styles.heading}>
        <div>
          <p className={styles.eyebrow}>Owner controlled</p>
          <h2 id="public-presence-title">Public presence</h2>
          <p className={styles.intro}>
            Private by default. You choose authored text, projects, measured evidence,
            activity, and each public channel independently.
          </p>
        </div>
        <output
          className={styles.status}
          data-publication-state={statusState}
          aria-live="polite"
        >
          <span className={styles.statusLabel}>{statusState}</span>
          <span>{publicPresenceStatusMessage(document.status)}</span>
          <span className={styles.versionLine}>
            Saved revision {document.status.savedRevision}, generated version{' '}
            {document.status.generatedVersion}, applied version {document.status.appliedVersion}
          </span>
          {document.status.blockingGeneration !== null ? (
            <span className={styles.versionLine}>
              Blocking delivery version {document.status.blockingGeneration}
            </span>
          ) : null}
        </output>
      </div>

      <fieldset className={styles.card}>
        <legend>Authored profile</legend>
        <p className={styles.help}>These are your claims. Seorak does not verify this text.</p>
        <div className={styles.gridTwo}>
          <label>
            <span>Public handle</span>
            <input
              name="profileSlug"
              value={draft.profileSlug}
              onChange={(event) => mutate((current) => ({
                ...current,
                profileSlug: event.target.value.toLowerCase(),
              }))}
              placeholder="ada-lovelace"
              maxLength={63}
            />
          </label>
          <label>
            <span>Display name</span>
            <input
              name="displayName"
              value={draft.profile.displayName ?? ''}
              onChange={(event) => updateProfile('displayName', event.target.value)}
              maxLength={80}
            />
          </label>
          <label className={styles.spanTwo}>
            <span>Headline</span>
            <input
              name="headline"
              value={draft.profile.headline ?? ''}
              onChange={(event) => updateProfile('headline', event.target.value)}
              maxLength={160}
            />
          </label>
          <label className={styles.spanTwo}>
            <span>Bio</span>
            <textarea
              name="bio"
              value={draft.profile.bio ?? ''}
              onChange={(event) => updateProfile('bio', event.target.value)}
              maxLength={2_000}
              rows={4}
            />
          </label>
          <label>
            <span>Location</span>
            <input
              name="location"
              value={draft.profile.location ?? ''}
              onChange={(event) => updateProfile('location', event.target.value)}
              maxLength={120}
            />
          </label>
          <label>
            <span>Avatar URL</span>
            <input
              name="avatarUrl"
              type="url"
              value={draft.profile.avatarUrl ?? ''}
              onChange={(event) => updateProfile('avatarUrl', event.target.value)}
              placeholder="https://…"
            />
          </label>
        </div>
      </fieldset>

      <fieldset className={styles.card}>
        <legend>Public surfaces</legend>
        <p className={styles.help}>
          Turning one channel on never enables another. Choose profile fields separately for each.
        </p>
        <div className={styles.choiceList}>
          {SURFACES.map((surface) => {
            const grant = draft.grants[surface];
            return (
              <div className={styles.subpanel} key={surface}>
                <label className={styles.choice}>
                  <input
                    name={`surface-${surface}`}
                    type="checkbox"
                    checked={grant.enabled}
                    onChange={(event) => setSurface(surface, event.target.checked)}
                  />
                  <span>
                    <strong>{SURFACE_COPY[surface].label}</strong>
                    <small>{SURFACE_COPY[surface].detail}</small>
                  </span>
                </label>
                {grant.enabled ? (
                  <div className={styles.inlineChoices} aria-label={`${SURFACE_COPY[surface].label} profile fields`}>
                    {presentProfileFields(draft.profile)
                      .filter((field) => field !== 'contactUrl')
                      .map((field) => (
                        <label key={field}>
                          <input
                            type="checkbox"
                            checked={grant.fields.includes(field)}
                            onChange={(event) => setProfileField(surface, field, event.target.checked)}
                          />
                          {field}
                        </label>
                      ))}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </fieldset>

      <fieldset className={styles.card}>
        <legend>Contact</legend>
        <p className={styles.help}>Optional HTTPS link. It is never included in search text.</p>
        <label>
          <span>Contact URL</span>
          <input
            name="contactUrl"
            type="url"
            value={draft.profile.contactUrl ?? ''}
            onChange={(event) => updateProfile('contactUrl', event.target.value)}
            placeholder="https://example.com/contact"
          />
        </label>
        <div className={styles.inlineChoices}>
          {(['web', 'api', 'mcp'] as const).map((surface) => (
            <label key={surface}>
              <input
                name={`contact-${surface}`}
                type="checkbox"
                checked={contactEnabled(draft.grants, surface)}
                disabled={!contactAvailable || !draft.grants[surface].enabled}
                onChange={(event) => setContactSurface(surface, event.target.checked)}
              />
              {SURFACE_COPY[surface].label}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className={styles.card}>
        <legend>Activity calendar</legend>
        <label className={styles.choice}>
          <input
            name="activity-enabled"
            type="checkbox"
            checked={draft.activity !== null}
            onChange={(event) => toggleActivity(event.target.checked)}
          />
          <span>
            <strong>Publish frozen activity</strong>
            <small>Distinct active sessions only—never tokens, cost, or output volume.</small>
          </span>
        </label>
        {draft.activity ? (
          <div className={styles.subpanel}>
            <div className={styles.gridTwo}>
              <label>
                <span>Timezone</span>
                <input
                  name="activity-timezone"
                  value={draft.activity.timeZone}
                  onChange={(event) => updateActivity({ timeZone: event.target.value })}
                />
              </label>
              <label>
                <span>Calendar window</span>
                <select
                  name="activity-range"
                  value={draft.activity.rangeDays}
                  onChange={(event: ChangeEvent<HTMLSelectElement>) => updateActivity({
                    rangeDays: Number(event.target.value) as PublicationActivityRangeDays,
                  })}
                >
                  <option value={30}>30 days</option>
                  <option value={90}>90 days</option>
                  <option value={365}>365 days</option>
                </select>
              </label>
              <label>
                <span>Incomplete coverage</span>
                <select
                  name="activity-unavailable"
                  value={draft.activity.unavailable}
                  onChange={(event) => updateActivity({
                    unavailable: event.target.value as OwnerPublicationActivitySelection['unavailable'],
                  })}
                >
                  <option value="publish-unavailable">Show it as unavailable</option>
                  <option value="refuse">Stop publication</option>
                </select>
              </label>
            </div>
            <div className={styles.choiceList}>
              {(['web', 'api', 'mcp'] as const).map((surface) => {
                const grant = draft.activity!.grants[surface];
                return (
                  <div className={styles.subpanel} key={surface}>
                    <label className={styles.choice}>
                      <input
                        type="checkbox"
                        checked={grant.enabled}
                        disabled={!draft.grants[surface].enabled}
                        onChange={(event) => setActivitySurface(surface, event.target.checked)}
                      />
                      <span><strong>{SURFACE_COPY[surface].label}</strong></span>
                    </label>
                    {grant.enabled ? (
                      <div className={styles.inlineChoices}>
                        {ACTIVITY_FIELDS.map((field) => (
                          <label key={field}>
                            <input
                              type="checkbox"
                              checked={grant.fields.includes(field)}
                              onChange={(event) => setActivityField(
                                surface,
                                field,
                                event.target.checked,
                              )}
                            />
                            {field === 'calendar' ? 'Calendar' : 'Current streak'}
                          </label>
                        ))}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}
      </fieldset>

      <fieldset className={styles.card}>
        <legend>Projects and evidence</legend>
        <p className={styles.help}>
          Internal project IDs stay private. Visitors see only the public slug and fields below.
        </p>
        {document.availableProjects.length === 0 ? (
          <p className={styles.empty}>No captured projects are available to select.</p>
        ) : (
          <div className={styles.choiceList}>
            {document.availableProjects.map((option) => {
              const checked = draft.projects.some((project) =>
                project.sourceProjectId === option.sourceProjectId
              );
              return (
                <label className={styles.choice} key={option.sourceProjectId}>
                  <input
                    name={`project-${slugFor(option.label)}`}
                    type="checkbox"
                    checked={checked}
                    onChange={(event) => toggleProject(option, event.target.checked)}
                  />
                  <span><strong>{option.label}</strong></span>
                </label>
              );
            })}
          </div>
        )}
        <div className={styles.projectList}>
          {draft.projects.map((selection) => (
            <fieldset className={styles.projectCard} key={selection.sourceProjectId}>
              <legend>{projectLabels.get(selection.sourceProjectId) ?? 'Selected project'}</legend>
              <div className={styles.gridTwo}>
                <label>
                  <span>Public project slug</span>
                  <input
                    name={`project-slug-${slugFor(projectLabels.get(selection.sourceProjectId) ?? 'selected')}`}
                    value={selection.projectSlug}
                    onChange={(event) => updateProject(
                      selection.sourceProjectId,
                      (current) => ({ ...current, projectSlug: event.target.value.toLowerCase() }),
                    )}
                  />
                </label>
                <label>
                  <span>Public name</span>
                  <input
                    value={selection.project.name ?? ''}
                    onChange={(event) => updateProjectValue(
                      selection.sourceProjectId,
                      'name',
                      event.target.value,
                    )}
                  />
                </label>
                <label className={styles.spanTwo}>
                  <span>Public summary</span>
                  <textarea
                    value={selection.project.summary ?? ''}
                    onChange={(event) => updateProjectValue(
                      selection.sourceProjectId,
                      'summary',
                      event.target.value,
                    )}
                    rows={3}
                  />
                </label>
                <label>
                  <span>Role</span>
                  <input
                    value={selection.project.role ?? ''}
                    onChange={(event) => updateProjectValue(
                      selection.sourceProjectId,
                      'role',
                      event.target.value,
                    )}
                  />
                </label>
                <label>
                  <span>Technologies (comma separated)</span>
                  <input
                    value={selection.project.technologies?.join(', ') ?? ''}
                    onChange={(event) => updateProjectTechnologies(
                      selection.sourceProjectId,
                      event.target.value,
                    )}
                  />
                </label>
                <label>
                  <span>Started</span>
                  <input
                    type="date"
                    value={selection.project.startedOn ?? ''}
                    onChange={(event) => updateProjectValue(
                      selection.sourceProjectId,
                      'startedOn',
                      event.target.value,
                    )}
                  />
                </label>
                <label>
                  <span>Ended</span>
                  <input
                    type="date"
                    value={selection.project.endedOn ?? ''}
                    onChange={(event) => updateProjectValue(
                      selection.sourceProjectId,
                      'endedOn',
                      event.target.value,
                    )}
                  />
                </label>
                <label>
                  <span>Project URL</span>
                  <input
                    type="url"
                    value={selection.project.projectUrl ?? ''}
                    onChange={(event) => updateProjectValue(
                      selection.sourceProjectId,
                      'projectUrl',
                      event.target.value,
                    )}
                  />
                </label>
                <label>
                  <span>Source URL</span>
                  <input
                    type="url"
                    value={selection.project.sourceUrl ?? ''}
                    onChange={(event) => updateProjectValue(
                      selection.sourceProjectId,
                      'sourceUrl',
                      event.target.value,
                    )}
                  />
                </label>
                <label>
                  <span>Evidence window</span>
                  <select
                    value={selection.evidence.rangeDays}
                    onChange={(event) => updateProject(
                      selection.sourceProjectId,
                      (current) => ({
                        ...current,
                        evidence: {
                          ...current.evidence,
                          rangeDays: Number(event.target.value) as PublicationEvidenceRangeDays,
                        },
                      }),
                    )}
                  >
                    <option value={7}>7 days</option>
                    <option value={30}>30 days</option>
                    <option value={90}>90 days</option>
                  </select>
                </label>
                <label>
                  <span>Unavailable evidence</span>
                  <select
                    value={selection.evidence.unavailable}
                    onChange={(event) => updateProject(
                      selection.sourceProjectId,
                      (current) => ({
                        ...current,
                        evidence: {
                          ...current.evidence,
                          unavailable: event.target.value as typeof current.evidence.unavailable,
                        },
                      }),
                    )}
                  >
                    <option value="publish-unavailable">Show it as unavailable</option>
                    <option value="refuse">Stop publication</option>
                  </select>
                </label>
              </div>
              <div className={styles.choiceList}>
                {SURFACES.map((surface) => {
                  const grant = selection.grants[surface];
                  return (
                    <div className={styles.subpanel} key={surface}>
                      <label className={styles.choice}>
                        <input
                          type="checkbox"
                          checked={grant.enabled}
                          disabled={!draft.grants[surface].enabled}
                          onChange={(event) => setProjectSurface(
                            selection,
                            surface,
                            event.target.checked,
                          )}
                        />
                        <span><strong>{SURFACE_COPY[surface].label}</strong></span>
                      </label>
                      {grant.enabled ? (
                        <>
                          <div className={styles.inlineChoices} aria-label={`${surface} project fields`}>
                            {presentProjectFields(selection.project).map((field) => (
                              <label key={field}>
                                <input
                                  type="checkbox"
                                  checked={grant.fields.includes(field)}
                                  onChange={(event) => setProjectField(
                                    selection,
                                    surface,
                                    field,
                                    event.target.checked,
                                  )}
                                />
                                {field}
                              </label>
                            ))}
                          </div>
                          <div className={styles.evidenceChoices} aria-label={`${surface} project evidence`}>
                            {EVIDENCE_FIELDS.map((field) => (
                              <label key={field}>
                                <input
                                  type="checkbox"
                                  checked={grant.evidence.includes(field)}
                                  onChange={(event) => setProjectEvidence(
                                    selection,
                                    surface,
                                    field,
                                    event.target.checked,
                                  )}
                                />
                                {EVIDENCE_LABELS[field]}
                              </label>
                            ))}
                          </div>
                        </>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </fieldset>
          ))}
        </div>
      </fieldset>

      <div className={styles.actions}>
        <OutlineActionButton
          onClick={() => void saveCurrent()}
          disabled={busy !== null || !dirty}
        >
          {busy === 'save' ? 'Saving…' : 'Save privately'}
        </OutlineActionButton>
        <button
          type="button"
          className={styles.primaryButton}
          onClick={() => void publish()}
          disabled={busy !== null}
        >
          {busy === 'publish' ? 'Publishing…' : 'Publish frozen version'}
        </button>
        {statusState === 'failed' && document.status.blockingGeneration !== null ? (
          <OutlineActionButton
            onClick={() => void retry()}
            disabled={busy !== null}
          >
            {busy === 'retry' ? 'Retrying…' : 'Retry publication'}
          </OutlineActionButton>
        ) : null}
        {document.status.generatedVersion > 0 && statusState !== 'revoked' ? (
          <OutlineActionButton
            tone="danger"
            onClick={() => void revoke()}
            disabled={busy !== null}
          >
            {busy === 'revoke' ? 'Revoking…' : 'Revoke public presence'}
          </OutlineActionButton>
        ) : null}
      </div>
      {dirty ? <p className={styles.unsaved}>Unsaved private changes.</p> : null}
      {feedback ? <p className={styles.feedback} role="status">{feedback}</p> : null}
    </section>
  );
}
