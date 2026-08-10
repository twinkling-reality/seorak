import { useEffect, useState } from 'react';
import {
  INTEGRATION_API_VERSION,
  INTEGRATION_SCOPES,
  type IntegrationCredentialIssueResult,
  type IntegrationCredentialSummary,
  type IntegrationProjectOption,
  type IntegrationScope,
} from '@seorak/types';
import type { DataPlaneOperator } from '@seorak/types/data-plane';
import { DetailSection } from '../../components/DetailView/index.js';
import OutlineActionButton from '../../components/controls/OutlineActionButton.js';
import {
  codexPrivateMcpSetup,
  integrationApi,
  privateApiAudience,
  privateMcpAudience,
} from '../../lib/integrationApi.js';
import { isDemoActive } from '../../lib/demoMode.js';
import styles from './PrivateIntegrationsSection.module.css';

const SCOPE_LABELS: Record<IntegrationScope, string> = {
  'period:read': 'Period summaries',
  'sessions:read': 'Sessions and outcomes',
  'replay:read': 'Replay lenses',
};

type CredentialTarget = 'api' | 'mcp';

const TARGET_LABELS: Record<CredentialTarget, string> = {
  api: 'Private HTTP API',
  mcp: 'Private MCP',
};

function date(value: string | null): string {
  if (!value) return 'Never';
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toLocaleDateString() : value;
}

export default function PrivateIntegrationsSection({
  operator,
}: {
  operator: DataPlaneOperator | null;
}) {
  const staticMcpAvailable = operator === 'local-machine' || operator === 'self-hosted';
  const [target, setTarget] = useState<CredentialTarget>('api');
  const [credentials, setCredentials] = useState<readonly IntegrationCredentialSummary[]>([]);
  const [selected, setSelected] = useState<IntegrationScope[]>(['period:read']);
  const [projects, setProjects] = useState<readonly IntegrationProjectOption[]>([]);
  const [projectRef, setProjectRef] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateThrough, setDateThrough] = useState('');
  const [lifetimeDays, setLifetimeDays] = useState(30);
  const [issued, setIssued] = useState<IntegrationCredentialIssueResult | null>(null);
  const [pending, setPending] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function reload(signal?: AbortSignal): Promise<void> {
    const [result, catalog] = await Promise.all([
      integrationApi.list(signal),
      integrationApi.projects(signal),
    ]);
    setCredentials(result.credentials);
    setProjects(catalog.projects);
    setUnavailable(false);
  }

  useEffect(() => {
    if (isDemoActive()) {
      setUnavailable(true);
      return;
    }
    const controller = new AbortController();
    void reload(controller.signal).catch(() => {
      if (!controller.signal.aborted) setUnavailable(true);
    });
    return () => controller.abort();
  }, []);

  function toggleScope(scope: IntegrationScope): void {
    setSelected((current) => current.includes(scope)
      ? current.filter((value) => value !== scope)
      : [...current, scope]);
  }

  async function create(): Promise<void> {
    const incompleteDateRange = (dateFrom === '') !== (dateThrough === '');
    if (pending || selected.length === 0 || incompleteDateRange ||
        (dateFrom !== '' && dateFrom > dateThrough)) return;
    setPending(true);
    setError(null);
    setIssued(null);
    try {
      const result = await integrationApi.issue({
        apiVersion: INTEGRATION_API_VERSION,
        audience: target === 'mcp'
          ? privateMcpAudience(operator as 'local-machine' | 'self-hosted')
          : privateApiAudience(operator),
        scopes: INTEGRATION_SCOPES.filter((scope) => selected.includes(scope)),
        expiresAt: new Date(Date.now() + lifetimeDays * 24 * 60 * 60 * 1_000).toISOString(),
        ...(projectRef === '' && dateFrom === ''
          ? {}
          : {
              restrictions: {
                ...(projectRef === '' ? {} : { projectRefs: [projectRef] }),
                ...(dateFrom === ''
                  ? {}
                  : { dateRange: { from: dateFrom, through: dateThrough } }),
              },
            }),
        rateLimit: { requestsPerMinute: 60, burst: 60 },
      });
      setIssued(result);
      await reload();
    } catch {
      setError('Could not create private integration access. Check your connection and try again.');
    } finally {
      setPending(false);
    }
  }

  async function revoke(credentialRef: string): Promise<void> {
    if (pending) return;
    setPending(true);
    setError(null);
    setIssued(null);
    try {
      await integrationApi.revoke(credentialRef);
      await reload();
    } catch {
      setError('Could not revoke private integration access. Try again.');
    } finally {
      setPending(false);
    }
  }

  async function copySecret(): Promise<void> {
    if (!issued) return;
    try {
      await navigator.clipboard.writeText(issued.secret);
    } catch {
      setError('Clipboard access was unavailable. Select and copy the secret manually.');
    }
  }

  function setupText(kind: 'codex' | 'claude'): string {
    if (!issued || !issued.audience.endsWith('/mcp/private')) return '';
    if (kind === 'codex') {
      return codexPrivateMcpSetup(issued.audience);
    }
    return JSON.stringify({
      mcpServers: {
        seorak: {
          type: 'http',
          url: issued.audience,
          headers: { Authorization: 'Bearer ${SEORAK_MCP_TOKEN}' },
        },
      },
    }, null, 2);
  }

  async function copySetup(kind: 'codex' | 'claude'): Promise<void> {
    try {
      await navigator.clipboard.writeText(setupText(kind));
    } catch {
      setError('Clipboard access was unavailable. Select and copy the setup text manually.');
    }
  }

  function credentialTarget(credential: IntegrationCredentialSummary): CredentialTarget {
    return credential.audience.endsWith('/mcp/private') ? 'mcp' : 'api';
  }

  return (
    <DetailSection label="Private integration access">
      <div className={styles.section}>
        <p className={styles.copy}>
          Create a separate, expiring read-only credential for scripts or an MCP client.
          It cannot publish, collect events, or access raw captured content.
        </p>

        {unavailable ? (
          <p className={styles.copy}>Private integration management is unavailable in this environment.</p>
        ) : (
          <>
            <div className={styles.form}>
              {staticMcpAvailable ? (
                <label>
                  Credential target{' '}
                  <select
                    className={styles.select}
                    value={target}
                    onChange={(event) => {
                      setTarget(event.target.value as CredentialTarget);
                      setIssued(null);
                    }}
                  >
                    <option value="api">{TARGET_LABELS.api}</option>
                    <option value="mcp">{TARGET_LABELS.mcp} static bearer</option>
                  </select>
                </label>
              ) : null}
              <div className={styles.scopeRow} aria-label="Private integration scopes">
                {INTEGRATION_SCOPES.map((scope) => (
                  <label className={styles.scope} key={scope}>
                    <input
                      type="checkbox"
                      checked={selected.includes(scope)}
                      onChange={() => toggleScope(scope)}
                    />
                    {SCOPE_LABELS[scope]}
                  </label>
                ))}
              </div>
              <fieldset className={styles.restrictions}>
                <legend>Optional least-privilege limits</legend>
                <label>
                  Project{' '}
                  <select
                    className={styles.select}
                    value={projectRef}
                    onChange={(event) => setProjectRef(event.target.value)}
                  >
                    <option value="">All available projects</option>
                    {projects.map((project) => (
                      <option value={project.projectRef} key={project.projectRef}>
                        {project.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  From{' '}
                  <input
                    className={styles.select}
                    type="date"
                    value={dateFrom}
                    onChange={(event) => setDateFrom(event.target.value)}
                  />
                </label>
                <label>
                  Through{' '}
                  <input
                    className={styles.select}
                    type="date"
                    value={dateThrough}
                    onChange={(event) => setDateThrough(event.target.value)}
                  />
                </label>
              </fieldset>
              <div className={styles.actions}>
                <label>
                  Expires in{' '}
                  <select
                    className={styles.select}
                    value={lifetimeDays}
                    onChange={(event) => setLifetimeDays(Number(event.target.value))}
                  >
                    <option value={30}>30 days</option>
                    <option value={90}>90 days</option>
                    <option value={365}>365 days</option>
                  </select>
                </label>
                <OutlineActionButton
                  size="sm"
                  onClick={() => void create()}
                  disabled={pending || selected.length === 0 ||
                    ((dateFrom === '') !== (dateThrough === '')) ||
                    (dateFrom !== '' && dateFrom > dateThrough)}
                >
                  {pending ? 'Working…' : 'Create credential'}
                </OutlineActionButton>
              </div>
            </div>

            {issued ? (
              <div className={styles.secretPanel} role="status">
                <strong>Copy this secret now. It will not be shown again.</strong>
                <code className={styles.secret}>{issued.secret}</code>
                <OutlineActionButton size="sm" onClick={() => void copySecret()}>
                  Copy secret
                </OutlineActionButton>
                <span className={styles.meta}>
                  Resource URL: <code>{issued.audience}</code>
                </span>
                {issued.audience.endsWith('/mcp/private') ? (
                  <div className={styles.form}>
                    <strong>This is a static bearer credential, not OAuth.</strong>
                    <p className={styles.copy}>
                      Put the secret in <code>SEORAK_MCP_TOKEN</code> in the client environment.
                      The setup below never embeds it in a URL, command, or checked-in config.
                    </p>
                    <span className={styles.meta}>Codex</span>
                    <code className={styles.secret}>{setupText('codex')}</code>
                    <OutlineActionButton size="sm" onClick={() => void copySetup('codex')}>
                      Copy Codex setup
                    </OutlineActionButton>
                    <span className={styles.meta}>Claude <code>.mcp.json</code></span>
                    <pre className={styles.secret}>{setupText('claude')}</pre>
                    <OutlineActionButton size="sm" onClick={() => void copySetup('claude')}>
                      Copy Claude setup
                    </OutlineActionButton>
                  </div>
                ) : null}
              </div>
            ) : null}

            {error ? <p className={styles.error} role="alert">{error}</p> : null}

            <ul className={styles.list} aria-label="Private integration credentials">
              {credentials.length === 0 ? (
                <li className={styles.copy}>No private integration credentials have been created.</li>
              ) : credentials.map((credential) => {
                const active = credential.revokedAt === null &&
                  Date.parse(credential.expiresAt) > Date.now();
                return (
                  <li className={styles.credential} key={credential.credentialRef}>
                    <code>{credential.credentialRef}</code>
                    <span className={styles.meta}>
                      {TARGET_LABELS[credentialTarget(credential)]}
                    </span>
                    <span className={styles.meta}>
                      {credential.scopes.map((scope) => SCOPE_LABELS[scope]).join(', ')}
                    </span>
                    {credential.restrictions ? (
                      <span className={styles.meta}>
                        Limited to{' '}
                        {credential.restrictions.projectRefs?.map((ref) =>
                          projects.find((project) => project.projectRef === ref)?.label ?? ref,
                        ).join(', ') ?? 'all projects'}
                        {credential.restrictions.dateRange
                          ? `, ${credential.restrictions.dateRange.from} through ${credential.restrictions.dateRange.through}`
                          : ''}
                      </span>
                    ) : null}
                    <span className={styles.status}>
                      {credential.revokedAt
                        ? `Revoked ${date(credential.revokedAt)}`
                        : active
                          ? `Expires ${date(credential.expiresAt)}, last used ${date(credential.lastUsedAt)}`
                          : `Expired ${date(credential.expiresAt)}`}
                    </span>
                    {active ? (
                      <OutlineActionButton
                        size="sm"
                        tone="danger"
                        disabled={pending}
                        onClick={() => void revoke(credential.credentialRef)}
                      >
                        Revoke
                      </OutlineActionButton>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>
    </DetailSection>
  );
}
