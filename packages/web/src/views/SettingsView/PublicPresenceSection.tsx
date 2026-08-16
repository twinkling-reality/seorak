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
  OwnerPublicationTokenUsageSelection,
  PublicationActivityRangeDays,
  PublicationEvidenceRangeDays,
  PublicationSurface,
  PublicationTokenUsageRangeDays,
  PublicActivityField,
  PublicProfileField,
  PublicProfileValues,
  PublicProjectEvidenceField,
  PublicProjectSurfaceGrant,
  PublicProjectValues,
  PublicTokenUsageField,
} from '@seorak/types';
import OutlineActionButton from '../../components/controls/OutlineActionButton.js';
import {
  publicationApi,
  type PublicPresenceApi,
  type PublicPresenceDocument,
  type PublicPresenceProjectOption,
} from '../../lib/publicationApi.js';
import {
  profileTokenUsageSvgUrl,
  projectTokenUsageSvgUrl,
  publicDirectoryOrigin,
  tokenUsageHtmlSnippet,
  tokenUsageReadmeSnippet,
} from '../../lib/publicDirectoryOrigin.js';
import {
  ACTIVITY_FIELDS,
  EVIDENCE_FIELDS,
  EVIDENCE_LABELS,
  SURFACES,
  SURFACE_COPY,
  TOKEN_USAGE_FIELD_LABELS,
  TOKEN_USAGE_FIELDS,
  activityGrants,
  commandId,
  contactEnabled,
  defaultTokenUsageSelection,
  disabledActivityGrant,
  disabledTokenUsageGrant,
  emptyManifest,
  normalizeManifest,
  presentProfileFields,
  presentProjectFields,
  profileGrant,
  projectGrant,
  publicPresenceStatusMessage,
  selectedProject,
  slugFor,
  validateDraft,
} from './publicPresenceDraft.js';
import styles from './PublicPresenceSection.module.css';

export { publicPresenceStatusMessage } from './publicPresenceDraft.js';

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
  const [copyNote, setCopyNote] = useState<string | null>(null);
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

  function toggleTokenUsage(enabled: boolean): void {
    mutate((current) => enabled
      ? { ...current, tokenUsage: defaultTokenUsageSelection(current) }
      : { ...current, tokenUsage: null }
    );
  }

  function updateTokenUsage(
    patch: Partial<Omit<OwnerPublicationTokenUsageSelection, 'grants'>>,
  ): void {
    mutate((current) => current.tokenUsage
      ? { ...current, tokenUsage: { ...current.tokenUsage, ...patch } }
      : current
    );
  }

  function setTokenUsageSurface(
    surface: Exclude<PublicationSurface, 'search'>,
    enabled: boolean,
  ): void {
    mutate((current) => {
      if (!current.tokenUsage) return current;
      return {
        ...current,
        tokenUsage: {
          ...current.tokenUsage,
          grants: {
            ...current.tokenUsage.grants,
            [surface]: enabled
              ? { enabled: true, fields: [...TOKEN_USAGE_FIELDS] }
              : disabledTokenUsageGrant(),
          },
        },
      };
    });
  }

  function setTokenUsageField(
    surface: Exclude<PublicationSurface, 'search'>,
    field: PublicTokenUsageField,
    enabled: boolean,
  ): void {
    mutate((current) => {
      if (!current.tokenUsage || !current.tokenUsage.grants[surface].enabled) return current;
      const fields = new Set(current.tokenUsage.grants[surface].fields);
      if (enabled) fields.add(field);
      else fields.delete(field);
      return {
        ...current,
        tokenUsage: {
          ...current.tokenUsage,
          grants: {
            ...current.tokenUsage.grants,
            [surface]: { enabled: true, fields: [...fields] },
          },
        },
      };
    });
  }

  function toggleProjectTokenUsage(
    sourceProjectId: string,
    enabled: boolean,
  ): void {
    mutate((current) => ({
      ...current,
      projects: current.projects.map((selection) => {
        if (selection.sourceProjectId !== sourceProjectId) return selection;
        if (!enabled) return { ...selection, tokenUsage: null };
        return {
          ...selection,
          tokenUsage: defaultTokenUsageSelection(
            current,
            current.tokenUsage?.rangeDays ?? 30,
          ),
        };
      }),
    }));
  }

  function updateProjectTokenUsage(
    sourceProjectId: string,
    patch: Partial<Omit<OwnerPublicationTokenUsageSelection, 'grants'>>,
  ): void {
    updateProject(sourceProjectId, (selection) => selection.tokenUsage
      ? { ...selection, tokenUsage: { ...selection.tokenUsage, ...patch } }
      : selection
    );
  }

  function setProjectTokenUsageSurface(
    sourceProjectId: string,
    surface: Exclude<PublicationSurface, 'search'>,
    enabled: boolean,
  ): void {
    updateProject(sourceProjectId, (selection) => {
      if (!selection.tokenUsage) return selection;
      return {
        ...selection,
        tokenUsage: {
          ...selection.tokenUsage,
          grants: {
            ...selection.tokenUsage.grants,
            [surface]: enabled
              ? { enabled: true, fields: [...TOKEN_USAGE_FIELDS] }
              : disabledTokenUsageGrant(),
          },
        },
      };
    });
  }

  function setProjectTokenUsageField(
    sourceProjectId: string,
    surface: Exclude<PublicationSurface, 'search'>,
    field: PublicTokenUsageField,
    enabled: boolean,
  ): void {
    updateProject(sourceProjectId, (selection) => {
      if (!selection.tokenUsage || !selection.tokenUsage.grants[surface].enabled) {
        return selection;
      }
      const fields = new Set(selection.tokenUsage.grants[surface].fields);
      if (enabled) fields.add(field);
      else fields.delete(field);
      return {
        ...selection,
        tokenUsage: {
          ...selection.tokenUsage,
          grants: {
            ...selection.tokenUsage.grants,
            [surface]: { enabled: true, fields: [...fields] },
          },
        },
      };
    });
  }

  async function copyText(label: string, value: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
      setCopyNote(`${label} copied.`);
    } catch {
      setCopyNote(`Clipboard access was unavailable. Select and copy the ${label.toLowerCase()} manually.`);
    }
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
  const appliedPublicly = document.status.appliedVersion > 0 && statusState !== 'revoked';
  const directoryOrigin = publicDirectoryOrigin();
  const profileEmbedUrl = draft.tokenUsage?.grants.web.enabled
    ? profileTokenUsageSvgUrl(draft.profileSlug, { days: draft.tokenUsage.rangeDays })
    : null;
  return (
    <section className={styles.section} aria-labelledby="public-presence-title">
      <div className={styles.heading}>
        <div>
          <p className={styles.eyebrow}>Owner controlled</p>
          <h2 id="public-presence-title">Public presence</h2>
          <p className={styles.intro}>
            Private by default. You choose authored text, projects, measured evidence,
            activity, token usage, and each public channel independently.
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
        <legend>Token usage</legend>
        <label className={styles.choice}>
          <input
            name="token-usage-enabled"
            type="checkbox"
            checked={draft.tokenUsage !== null}
            onChange={(event) => toggleTokenUsage(event.target.checked)}
          />
          <span>
            <strong>Publish token usage</strong>
            <small>
              Frozen input and output tokens for a chosen window. Portable for README embeds.
              Never a productivity score.
            </small>
          </span>
        </label>
        {draft.tokenUsage ? (
          <div className={styles.subpanel}>
            <div className={styles.gridTwo}>
              <label>
                <span>Usage window</span>
                <select
                  name="token-usage-range"
                  value={draft.tokenUsage.rangeDays}
                  onChange={(event: ChangeEvent<HTMLSelectElement>) => updateTokenUsage({
                    rangeDays: Number(event.target.value) as PublicationTokenUsageRangeDays,
                  })}
                >
                  <option value={30}>30 days</option>
                  <option value={90}>90 days</option>
                </select>
              </label>
              <label>
                <span>Incomplete coverage</span>
                <select
                  name="token-usage-unavailable"
                  value={draft.tokenUsage.unavailable}
                  onChange={(event) => updateTokenUsage({
                    unavailable: event.target.value as OwnerPublicationTokenUsageSelection['unavailable'],
                  })}
                >
                  <option value="publish-unavailable">Show it as unavailable</option>
                  <option value="refuse">Stop publication</option>
                </select>
              </label>
            </div>
            <div className={styles.choiceList}>
              {(['web', 'api', 'mcp'] as const).map((surface) => {
                const grant = draft.tokenUsage!.grants[surface];
                return (
                  <div className={styles.subpanel} key={surface}>
                    <label className={styles.choice}>
                      <input
                        type="checkbox"
                        checked={grant.enabled}
                        disabled={!draft.grants[surface].enabled}
                        onChange={(event) => setTokenUsageSurface(surface, event.target.checked)}
                      />
                      <span><strong>{SURFACE_COPY[surface].label}</strong></span>
                    </label>
                    {grant.enabled ? (
                      <div className={styles.inlineChoices}>
                        {TOKEN_USAGE_FIELDS.map((field) => (
                          <label key={field}>
                            <input
                              type="checkbox"
                              checked={grant.fields.includes(field)}
                              onChange={(event) => setTokenUsageField(
                                surface,
                                field,
                                event.target.checked,
                              )}
                            />
                            {TOKEN_USAGE_FIELD_LABELS[field]}
                          </label>
                        ))}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
            {appliedPublicly && profileEmbedUrl ? (
              <div className={styles.embedPanel}>
                <p className={styles.help}>
                  Profile embed URL after the applied public version.
                </p>
                <code className={styles.embedUrl}>{profileEmbedUrl}</code>
                <div className={styles.embedActions}>
                  <OutlineActionButton
                    size="sm"
                    onClick={() => void copyText('README snippet', tokenUsageReadmeSnippet(profileEmbedUrl))}
                  >
                    Copy README snippet
                  </OutlineActionButton>
                  <OutlineActionButton
                    size="sm"
                    onClick={() => void copyText('HTML snippet', tokenUsageHtmlSnippet(profileEmbedUrl))}
                  >
                    Copy HTML
                  </OutlineActionButton>
                </div>
                <img
                  className={styles.embedPreview}
                  src={profileEmbedUrl}
                  alt="Seorak token usage"
                />
              </div>
            ) : draft.tokenUsage.grants.web.enabled ? (
              <p className={styles.help}>
                {directoryOrigin
                  ? 'Preview and embed URLs appear after this version is publicly applied.'
                  : 'Preview and embed URLs need a configured public directory origin after publish.'}
              </p>
            ) : null}
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
              <div className={styles.subpanel}>
                <label className={styles.choice}>
                  <input
                    name={`project-token-usage-${slugFor(projectLabels.get(selection.sourceProjectId) ?? 'selected')}`}
                    type="checkbox"
                    checked={selection.tokenUsage !== null}
                    onChange={(event) => toggleProjectTokenUsage(
                      selection.sourceProjectId,
                      event.target.checked,
                    )}
                  />
                  <span>
                    <strong>Publish this project&apos;s token usage</strong>
                    <small>
                      Uses its own window. Search stays off. Enable web for README embeds.
                    </small>
                  </span>
                </label>
                {selection.tokenUsage ? (
                  <>
                    <div className={styles.gridTwo}>
                      <label>
                        <span>Usage window</span>
                        <select
                          name={`project-token-usage-range-${slugFor(selection.projectSlug)}`}
                          value={selection.tokenUsage.rangeDays}
                          onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                            updateProjectTokenUsage(selection.sourceProjectId, {
                              rangeDays: Number(event.target.value) as PublicationTokenUsageRangeDays,
                            })
                          }
                        >
                          <option value={30}>30 days</option>
                          <option value={90}>90 days</option>
                        </select>
                      </label>
                      <label>
                        <span>Incomplete coverage</span>
                        <select
                          value={selection.tokenUsage.unavailable}
                          onChange={(event) => updateProjectTokenUsage(
                            selection.sourceProjectId,
                            {
                              unavailable: event.target.value as
                                OwnerPublicationTokenUsageSelection['unavailable'],
                            },
                          )}
                        >
                          <option value="publish-unavailable">Show it as unavailable</option>
                          <option value="refuse">Stop publication</option>
                        </select>
                      </label>
                    </div>
                    <div className={styles.choiceList}>
                      {(['web', 'api', 'mcp'] as const).map((surface) => {
                        const grant = selection.tokenUsage!.grants[surface];
                        return (
                          <div className={styles.subpanel} key={surface}>
                            <label className={styles.choice}>
                              <input
                                type="checkbox"
                                checked={grant.enabled}
                                disabled={!draft.grants[surface].enabled}
                                onChange={(event) => setProjectTokenUsageSurface(
                                  selection.sourceProjectId,
                                  surface,
                                  event.target.checked,
                                )}
                              />
                              <span><strong>{SURFACE_COPY[surface].label}</strong></span>
                            </label>
                            {grant.enabled ? (
                              <div className={styles.inlineChoices}>
                                {TOKEN_USAGE_FIELDS.map((field) => (
                                  <label key={field}>
                                    <input
                                      type="checkbox"
                                      checked={grant.fields.includes(field)}
                                      onChange={(event) => setProjectTokenUsageField(
                                        selection.sourceProjectId,
                                        surface,
                                        field,
                                        event.target.checked,
                                      )}
                                    />
                                    {TOKEN_USAGE_FIELD_LABELS[field]}
                                  </label>
                                ))}
                              </div>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                    {(() => {
                      const projectEmbedUrl = selection.tokenUsage.grants.web.enabled
                        ? projectTokenUsageSvgUrl(
                          draft.profileSlug,
                          selection.projectSlug,
                          { days: selection.tokenUsage.rangeDays },
                        )
                        : null;
                      if (appliedPublicly && projectEmbedUrl) {
                        return (
                          <div className={styles.embedPanel}>
                            <p className={styles.help}>Project embed URL after the applied public version.</p>
                            <code className={styles.embedUrl}>{projectEmbedUrl}</code>
                            <div className={styles.embedActions}>
                              <OutlineActionButton
                                size="sm"
                                onClick={() => void copyText(
                                  'README snippet',
                                  tokenUsageReadmeSnippet(projectEmbedUrl),
                                )}
                              >
                                Copy README snippet
                              </OutlineActionButton>
                              <OutlineActionButton
                                size="sm"
                                onClick={() => void copyText(
                                  'HTML snippet',
                                  tokenUsageHtmlSnippet(projectEmbedUrl),
                                )}
                              >
                                Copy HTML
                              </OutlineActionButton>
                            </div>
                            <img
                              className={styles.embedPreview}
                              src={projectEmbedUrl}
                              alt="Seorak token usage"
                            />
                          </div>
                        );
                      }
                      if (selection.tokenUsage.grants.web.enabled) {
                        return (
                          <p className={styles.help}>
                            Preview and embed URLs appear after this version is publicly applied.
                          </p>
                        );
                      }
                      return null;
                    })()}
                  </>
                ) : null}
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
      {copyNote ? <p className={styles.feedback} role="status">{copyNote}</p> : null}
    </section>
  );
}
