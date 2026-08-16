import { useEffect, useMemo, useState, type KeyboardEvent, type CSSProperties } from 'react';
import clsx from 'clsx';
import {
  DEFAULT_CAPTURE_SETTINGS,
  DEFAULT_NOTIFICATION_SETTINGS,
  SIGNAL_IDS,
  resolveNotificationAvailability,
  type CaptureSettings,
  type NotificationSettings,
} from '@seorak/types';
import { fetchCaptureSettings, fetchNotificationSettings } from '../../lib/api.js';
import { useAuthStore, authActions } from '../../lib/stores/auth.js';
import { stopPolling, usePollingStore } from '../../lib/stores/polling.js';
import { COLOR_PALETTE, getColorHex } from '../../lib/utils.js';
import { useTheme } from '../../lib/useTheme.js';
import { isDemoActive } from '../../lib/demoMode.js';
import { currentDataPlane, currentPlaneServes } from '../../lib/dataPlane.js';
import {
  continueControlPlaneAccountDeletion,
  continueControlPlaneLogout,
  hasConfiguredControlPlane,
} from '../../lib/controlPlane.js';
import { useTabs } from '../../hooks/useTabs.js';
import ViewHeader from '../../components/ViewHeader/ViewHeader.jsx';
import { DetailSection } from '../../components/DetailView/index.js';
import StatTabs from '../../components/StatTabs/StatTabs.js';
import RangePills from '../../components/RangePills/RangePills.js';
import OutlineActionButton from '../../components/controls/OutlineActionButton.js';
import CaptureSection from './CaptureSection.js';
import NotificationsSection from './NotificationsSection.js';
import DeliveryHealthSection from './DeliveryHealthSection.js';
import ManagedPlanSection from './ManagedPlanSection.js';
import PrivateIntegrationsSection from './PrivateIntegrationsSection.js';
import PublicPresenceSection from './PublicPresenceSection.js';
import ProjectsSection from './ProjectsSection.js';
import {
  CAPTURE_TOGGLE_KEYS,
  SETTINGS_SECTION_TABS,
  countCaptureOn,
  formatToggleCount,
} from './settingsTabSummaries.js';
import styles from './SettingsView.module.css';
import { DIRECTORY_EXPERIENCE_ENABLED } from '../../lib/directoryExperience.js';

// Settings is the solo, local-user surface. Panel blocks use DetailSection —
// the same label / answer / content hierarchy as Usage and Outcomes detail
// views (sans 16px section titles, not mono uppercase eyebrows).

const HANDLE_PATTERN = /^[A-Za-z0-9_]{3,20}$/;

const THEME_OPTIONS = ['system', 'light', 'dark'] as const;
type ThemePreference = (typeof THEME_OPTIONS)[number];

const THEME_LABELS: Record<ThemePreference, string> = {
  system: 'System',
  light: 'Light',
  dark: 'Dark',
};

const SECTION_IDS = ['profile', 'public', 'capture', 'alerts', 'projects'] as const;
type SectionId = (typeof SECTION_IDS)[number];

/**
 * What this plane can actually answer. Two things in Settings are conditional,
 * and both for one reason: rendering a control whose every call fails is the
 * "measured emptiness" the data-plane contract exists to refuse, so the honest
 * move is to withhold the control rather than show a broken one.
 *
 * PUBLIC PRESENCE, a whole tab. Every `/public-presence/*` route belongs to an
 * operated directory, so a local plane serves none of them and a self-hosted
 * deployment without a directory origin and publisher credential serves none
 * either.
 *
 * PRIVATE INTEGRATION ACCESS, one panel on Profile. The panel is shown only
 * when the descriptor declares the complete management + API + MCP surface.
 * An older or partial plane stays honest by withholding the controls rather
 * than presenting owner actions whose routes are unavailable.
 *
 * `currentPlaneServes` answers true when no descriptor was probed at all, which
 * keeps every deployment predating the contract exactly as it was.
 */
function servedSectionIds(): readonly SectionId[] {
  return DIRECTORY_EXPERIENCE_ENABLED && currentPlaneServes('publication')
    ? SECTION_IDS
    : SECTION_IDS.filter((id) => id !== 'public');
}

function parseSectionFromUrl(sections: readonly SectionId[]): SectionId {
  const param = new URLSearchParams(window.location.search).get('section');
  if (param && sections.includes(param as SectionId)) {
    return param as SectionId;
  }
  return 'profile';
}

function syncSectionToUrl(section: SectionId): void {
  const url = new URL(window.location.href);
  if (section === 'profile') url.searchParams.delete('section');
  else url.searchParams.set('section', section);
  window.history.replaceState(null, '', url);
}

function validateHandleInput(value: string): string | null {
  if (!value) return 'Username is required.';
  if (value.length < 3 || value.length > 20) return 'Username must be 3–20 characters.';
  if (!HANDLE_PATTERN.test(value)) {
    return 'Usernames may use letters, numbers, and underscores only.';
  }
  return null;
}

function hasHandle(handle: string | null | undefined): boolean {
  return Boolean(handle?.trim());
}

interface HandleFormState {
  editing: boolean;
  value: string;
  error: string | null;
}

interface ColorFormState {
  error: string | null;
  hovered: string | null;
}

export default function SettingsView() {
  const user = useAuthStore((s) => s.user);
  const managedAccount = hasConfiguredControlPlane();
  const sectionIds = useMemo(servedSectionIds, []);
  // Read once, like the tab list above, so the panel cannot appear and vanish
  // mid-session on a re-render that happens to land between probes.
  const servesIntegrations = useMemo(() => currentPlaneServes('integrations'), []);
  const integrationOperator = useMemo(
    () => currentDataPlane()?.descriptor.operator ?? null,
    [],
  );
  const tabControl = useTabs(sectionIds, parseSectionFromUrl(sectionIds));
  const { activeTab, setActiveTab } = tabControl;

  const [handleForm, setHandleForm] = useState<HandleFormState>({
    editing: false,
    value: '',
    error: null,
  });
  const [colorForm, setColorForm] = useState<ColorFormState>({
    error: null,
    hovered: null,
  });
  const [logoutState, setLogoutState] = useState<{
    pending: boolean;
    error: string | null;
  }>({ pending: false, error: null });
  const { theme, setTheme } = useTheme();
  const [captureSettings, setCaptureSettings] =
    useState<CaptureSettings>(DEFAULT_CAPTURE_SETTINGS);
  const [notificationSettings, setNotificationSettings] = useState<NotificationSettings>(
    DEFAULT_NOTIFICATION_SETTINGS,
  );
  const overview = usePollingStore((s) => s.overviewData);
  const notificationAvailability = useMemo(
    () => resolveNotificationAvailability(
      overview?.notificationAvailability,
      overview?.tools.byAgent ?? [],
    ),
    [overview],
  );

  const previewColorName = colorForm.hovered || user?.color || 'white';
  const previewColor = getColorHex(previewColorName) || '#98989d';

  const sectionTabs = useMemo(
    () =>
      SETTINGS_SECTION_TABS.filter((tab) => sectionIds.includes(tab.id)).map((tab) => {
        if (tab.id === 'capture') {
          return {
            ...tab,
            delta: {
              text: formatToggleCount(
                countCaptureOn(captureSettings),
                CAPTURE_TOGGLE_KEYS.length,
              ),
            },
          };
        }
        if (tab.id === 'alerts') {
          const known = SIGNAL_IDS.some(
            (id) => notificationAvailability.signals[id].state !== 'unknown',
          );
          if (!known) {
            return {
              ...tab,
              delta: { text: 'Availability unknown' },
            };
          }
          const availableIds = SIGNAL_IDS.filter(
            (id) => notificationAvailability.signals[id].state === 'available',
          );
          return {
            ...tab,
            delta: {
              text: formatToggleCount(
                availableIds.filter((id) => notificationSettings.signals[id]?.enabled).length,
                availableIds.length,
              ),
            },
          };
        }
        return tab;
      }),
    [captureSettings, notificationAvailability, notificationSettings, sectionIds],
  );

  useEffect(() => {
    if (isDemoActive()) return;
    const controller = new AbortController();
    fetchCaptureSettings({ signal: controller.signal })
      .then(setCaptureSettings)
      .catch(() => {});
    fetchNotificationSettings({ signal: controller.signal })
      .then(setNotificationSettings)
      .catch(() => {});
    return () => controller.abort();
  }, []);

  useEffect(() => {
    syncSectionToUrl(activeTab);
  }, [activeTab]);

  useEffect(() => {
    function onPopState() {
      setActiveTab(parseSectionFromUrl(sectionIds));
    }
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [sectionIds, setActiveTab]);

  function startEditHandle(): void {
    setHandleForm({ editing: true, value: user?.handle || '', error: null });
  }

  function saveHandle(): void {
    const val = handleForm.value.trim();
    if (!val || val === user?.handle) {
      setHandleForm((prev) => ({ ...prev, editing: false }));
      return;
    }
    const validationError = validateHandleInput(val);
    if (validationError) {
      setHandleForm((prev) => ({ ...prev, error: validationError }));
      return;
    }
    authActions.updateUser({ handle: val });
    setHandleForm((prev) => ({ ...prev, editing: false }));
  }

  function handleHandleKeyDown(e: KeyboardEvent<HTMLInputElement>): void {
    if (e.key === 'Enter') saveHandle();
    if (e.key === 'Escape') setHandleForm((prev) => ({ ...prev, editing: false }));
  }

  function selectColor(colorName: string): void {
    if (colorName === user?.color) return;
    authActions.updateUser({ color: colorName });
  }

  async function handleLogout(): Promise<void> {
    if (logoutState.pending) return;
    setLogoutState({ pending: true, error: null });
    try {
      await authActions.logout();
      stopPolling();
      continueControlPlaneLogout();
    } catch {
      setLogoutState({
        pending: false,
        error: 'Could not sign out. Check your connection and try again.',
      });
    }
  }

  return (
    <div className={styles.page} style={{ '--preview-color': previewColor } as CSSProperties}>
      <ViewHeader eyebrow="Configure" title="Settings" demo={isDemoActive()} />

      <div className={styles.shell}>
        <StatTabs
          tabs={sectionTabs}
          tabControl={tabControl}
          tablistLabel="Settings sections"
          idPrefix="settings"
        />

        <div className={styles.panel} role="tabpanel" id={`settings-panel-${activeTab}`}>
          {activeTab === 'profile' ? (
            <div className={styles.profilePanel}>
              <div className={styles.profileRow}>
                <DetailSection label="Username" className={styles.profileRowSection}>
                  <div
                    className={styles.profileControlSlot}
                    data-testid="profile-control-slot"
                    data-editing={handleForm.editing ? 'true' : undefined}
                  >
                    <div
                      key={handleForm.editing ? 'edit' : 'view'}
                      className={styles.profileControlInner}
                    >
                      {handleForm.editing ? (
                        <div className={styles.handleEditor}>
                          <div className={styles.handleEditorRow}>
                            <div
                              className={clsx(
                                styles.handleInputWrap,
                                handleForm.error && styles.handleInputWrapError,
                              )}
                            >
                              <input
                                className={styles.handleInput}
                                value={handleForm.value}
                                onChange={(e) =>
                                  setHandleForm((prev) => ({
                                    ...prev,
                                    value: e.target.value,
                                    error: null,
                                  }))
                                }
                                onKeyDown={handleHandleKeyDown}
                                maxLength={20}
                                autoFocus
                                placeholder="3–20 characters"
                                style={{ color: previewColor }}
                                aria-invalid={handleForm.error ? true : undefined}
                                aria-describedby={
                                  handleForm.error ? 'username-error' : 'username-hint'
                                }
                              />
                            </div>
                            <div className={styles.editorActions}>
                              <OutlineActionButton size="sm" onClick={saveHandle}>
                                Save
                              </OutlineActionButton>
                              <OutlineActionButton
                                size="sm"
                                onClick={() =>
                                  setHandleForm((prev) => ({ ...prev, editing: false }))
                                }
                              >
                                Cancel
                              </OutlineActionButton>
                            </div>
                          </div>
                          {handleForm.error ? (
                            <span className={styles.feedbackSlot} id="username-error">
                              {handleForm.error}
                            </span>
                          ) : (
                            <span className={styles.srOnly} id="username-hint">
                              Letters, numbers, and underscores only.
                            </span>
                          )}
                        </div>
                      ) : hasHandle(user?.handle) ? (
                        <div className={styles.profileValueLine}>
                          <span
                            className={styles.profileValue}
                            style={{ color: previewColor }}
                            data-testid="profile-username-value"
                          >
                            {user!.handle.trim()}
                          </span>
                          <OutlineActionButton
                            size="sm"
                            onClick={startEditHandle}
                            aria-label="Edit username"
                          >
                            Edit
                          </OutlineActionButton>
                        </div>
                      ) : (
                        <OutlineActionButton onClick={startEditHandle} aria-label="Set username">
                          Set username
                        </OutlineActionButton>
                      )}
                    </div>
                  </div>
                </DetailSection>
              </div>

              <div className={clsx(styles.profileRow, styles.profileRowAlignStart)}>
                <DetailSection label="Color" className={styles.profileRowSection}>
                  <div className={styles.colorPicker}>
                    {COLOR_PALETTE.map((color) => {
                      const isCurrent = user?.color === color.name;
                      const isPreview = previewColorName === color.name;
                      return (
                        <button
                          key={color.name}
                          className={clsx(
                            styles.colorDot,
                            isCurrent && styles.colorDotCurrent,
                            isPreview && styles.colorDotPreview,
                          )}
                          style={{ '--dot-color': color.hex } as CSSProperties}
                          onClick={() => selectColor(color.name)}
                          onMouseEnter={() =>
                            setColorForm((prev) => ({ ...prev, hovered: color.name }))
                          }
                          onMouseLeave={() => setColorForm((prev) => ({ ...prev, hovered: null }))}
                          onFocus={() => setColorForm((prev) => ({ ...prev, hovered: color.name }))}
                          onBlur={() => setColorForm((prev) => ({ ...prev, hovered: null }))}
                          title={color.name}
                          aria-label={`Select ${color.name}`}
                          aria-pressed={isCurrent}
                        />
                      );
                    })}
                  </div>
                  {colorForm.error ? (
                    <span className={styles.feedback}>{colorForm.error}</span>
                  ) : null}
                </DetailSection>
              </div>

              <div className={styles.profileRow}>
                <DetailSection label="Appearance" className={styles.profileRowSection}>
                  <div className={styles.profileControlFit}>
                    <RangePills
                      value={theme}
                      onChange={setTheme}
                      options={THEME_OPTIONS}
                      formatLabel={(id) => THEME_LABELS[id]}
                      ariaLabel="Theme"
                    />
                  </div>
                </DetailSection>
              </div>

              <div className={styles.profileRow}>
                <ManagedPlanSection className={styles.profileRowSection} />
              </div>

              {servesIntegrations ? (
                <div className={clsx(styles.profileRow, styles.profileRowAlignStart)}>
                  <PrivateIntegrationsSection operator={integrationOperator} />
                </div>
              ) : null}

              <div className={clsx(styles.profileRow, styles.settingsAction)}>
                <DetailSection label="Sign out" className={styles.profileRowSection}>
                  <div className={styles.profileControlFit}>
                    <OutlineActionButton
                      size="sm"
                      tone="danger"
                      onClick={() => void handleLogout()}
                      aria-label="Sign out"
                      disabled={logoutState.pending}
                    >
                      {logoutState.pending ? 'Signing out…' : 'Sign out'}
                    </OutlineActionButton>
                    {logoutState.error ? (
                      <span className={styles.feedback} role="alert">
                        {logoutState.error}
                      </span>
                    ) : null}
                  </div>
                </DetailSection>
              </div>

              {managedAccount ? (
                <div className={clsx(styles.profileRow, styles.settingsAction)}>
                  <DetailSection label="Delete account" className={styles.profileRowSection}>
                    <div className={styles.accountDeletionControl}>
                      <p className={styles.accountDeletionCopy}>
                        Permanently delete your Personal history and your data in Shared
                        workspaces. You will verify your sign-in before confirming.
                      </p>
                      <OutlineActionButton
                        size="sm"
                        tone="danger"
                        onClick={continueControlPlaneAccountDeletion}
                        aria-label="Delete Seorak account"
                      >
                        Delete Seorak account
                      </OutlineActionButton>
                    </div>
                  </DetailSection>
                </div>
              ) : null}
            </div>
          ) : null}

          {activeTab === 'capture' ? (
            <CaptureSection onSettingsChange={setCaptureSettings} />
          ) : null}

          {activeTab === 'public' ? <PublicPresenceSection /> : null}

          {activeTab === 'alerts' ? (
            <>
              <DeliveryHealthSection />
              <NotificationsSection onSettingsChange={setNotificationSettings} />
            </>
          ) : null}

          {activeTab === 'projects' ? <ProjectsSection /> : null}
        </div>
      </div>
    </div>
  );
}
