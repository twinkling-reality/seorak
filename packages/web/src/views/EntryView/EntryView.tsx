import {
  useState,
  useEffect,
  useRef,
  type MouseEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import { LegalFooter } from '../../components/LegalFooter/LegalFooter.js';
import { authActions } from '../../lib/stores/auth.js';
import { configuredControlPlaneUrl } from '../../lib/controlPlane.js';
import { getErrorMessage } from '../../lib/errorHelpers.js';
import { BrandMark, useBrand } from '../../brand/brand.js';
import SplitSquircleForward from '../../components/SplitSquircleForward/SplitSquircleForward.js';
import styles from './EntryView.module.css';

interface Props {
  error?: string | null;
  notice?: string | null;
}

function AppleIcon(): ReactNode {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M17.05 12.54c-.03-3.02 2.47-4.49 2.58-4.56a5.54 5.54 0 0 0-4.36-2.36c-1.83-.19-3.61 1.1-4.54 1.1-.95 0-2.38-1.08-3.92-1.05a5.77 5.77 0 0 0-4.85 2.96c-2.11 3.65-.54 9.02 1.48 11.97 1.01 1.45 2.18 3.07 3.72 3.01 1.51-.06 2.08-.97 3.91-.97 1.81 0 2.35.97 3.92.94 1.62-.03 2.64-1.45 3.61-2.91a11.9 11.9 0 0 0 1.65-3.36 5.21 5.21 0 0 1-3.2-4.77ZM14.08 3.68A5.3 5.3 0 0 0 15.29 0a5.38 5.38 0 0 0-3.48 1.75 5.05 5.05 0 0 0-1.24 3.54 4.44 4.44 0 0 0 3.51-1.61Z" />
    </svg>
  );
}

function GitHubIcon(): ReactNode {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path
        d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"
      />
    </svg>
  );
}

function GoogleIcon(): ReactNode {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M21.6 12.23c0-.71-.06-1.4-.18-2.07H12v3.92h5.38a4.6 4.6 0 0 1-2 3.02v2.54h3.24c1.9-1.75 2.98-4.33 2.98-7.41Z"
      />
      <path
        fill="#34A853"
        d="M12 22c2.7 0 4.98-.9 6.64-2.43l-3.24-2.54c-.9.6-2.05.96-3.4.96-2.61 0-4.82-1.76-5.61-4.13H3.04v2.62A10 10 0 0 0 12 22Z"
      />
      <path
        fill="#FBBC05"
        d="M6.39 13.86A6 6 0 0 1 6.08 12c0-.65.11-1.28.31-1.86V7.52H3.04A10 10 0 0 0 2 12c0 1.61.38 3.14 1.04 4.48l3.35-2.62Z"
      />
      <path
        fill="#EA4335"
        d="M12 6.01c1.47 0 2.79.51 3.83 1.5l2.88-2.88A9.65 9.65 0 0 0 12 2a10 10 0 0 0-8.96 5.52l3.35 2.62C7.18 7.77 9.39 6.01 12 6.01Z"
      />
    </svg>
  );
}

function KeyIcon(): ReactNode {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="9" cy="12" r="4" />
      <path d="M13 12h8" />
      <path d="M17 10v4" />
    </svg>
  );
}

function friendlyError(msg: string | null | undefined): string {
  const m = (msg || '').toLowerCase();
  if (m.includes('unauthorized'))
    return 'That token is invalid or expired. Check the access token for your worker.';
  if (m.includes('timed out') || m.includes('timeout'))
    return 'Could not reach the server. Check your connection and try again.';
  if (m.includes('500') || m.includes('server error'))
    return 'Something went wrong on our end. Try again in a moment.';
  if (m.includes('fetch') || m.includes('network') || m.includes('econnrefused'))
    return 'Could not reach the server. Check your connection and try again.';
  return msg || 'Something went wrong. Try again.';
}

function leaveToHome(event?: MouseEvent<HTMLAnchorElement>): void {
  if (
    event &&
    (event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      event.button !== 0)
  ) {
    return;
  }
  if (event) event.preventDefault();
  // Marketing ↔ dashboard is a full document load (different lazy chunks + theme boot).
  window.location.assign('/');
}

export default function EntryView({ error: initialError = null, notice = null }: Props) {
  const { name: brandName } = useBrand();
  const mainRef = useRef<HTMLElement>(null);
  const clusterRef = useRef<HTMLDivElement>(null);
  const [tokenInput, setTokenInput] = useState<string>('');
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState<boolean>(false);
  const [showTokenForm, setShowTokenForm] = useState<boolean>(false);
  const [pinnedTop, setPinnedTop] = useState<number | null>(null);
  const controlPlaneUrl = configuredControlPlaneUrl();

  useEffect(() => {
    if (initialError) {
      setTokenError(friendlyError(initialError));
      openTokenForm();
    }
  }, [initialError]);

  useEffect(() => {
    if (!showTokenForm) return;
    const input = document.getElementById('entry-api-token');
    input?.focus();
  }, [showTokenForm]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent): void {
      if (e.key !== 'Escape') return;
      if (showTokenForm) {
        e.preventDefault();
        closeTokenForm();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [showTokenForm]);

  async function handleConnect(): Promise<void> {
    const t = tokenInput.trim();
    if (!t) {
      setTokenError('Paste a token first.');
      return;
    }

    setConnecting(true);
    setTokenError(null);

    try {
      await authActions.signInWithToken(t);
    } catch (err: unknown) {
      setTokenError(friendlyError(getErrorMessage(err)));
    } finally {
      setConnecting(false);
    }
  }

  function handleKeydown(e: ReactKeyboardEvent<HTMLInputElement>): void {
    if (e.key === 'Enter') handleConnect();
  }

  async function continueWithoutSignIn(): Promise<void> {
    await authActions.authenticate('local');
  }

  function openTokenForm(): void {
    const main = mainRef.current;
    const cluster = clusterRef.current;
    if (main && cluster) {
      const mainTop = main.getBoundingClientRect().top;
      const clusterTop = cluster.getBoundingClientRect().top;
      setPinnedTop(clusterTop - mainTop);
    }
    setShowTokenForm(true);
  }

  function closeTokenForm(): void {
    setShowTokenForm(false);
    setPinnedTop(null);
    setTokenError(null);
  }

  return (
    <div className={styles.entryScreen}>
      <div className={styles.edgeField} aria-hidden="true" />

      <a
        href="/"
        className={styles.exitLink}
        aria-label="Close and return to home"
        onClick={leaveToHome}
      >
        Close
      </a>

      <main
        ref={mainRef}
        className={pinnedTop !== null ? styles.entryMainPinned : styles.entryMain}
        style={pinnedTop !== null ? { paddingTop: pinnedTop } : undefined}
      >
        <div ref={clusterRef} className={styles.contentCluster}>
          <section className={styles.brandPane}>
            <a
              className={styles.brandLink}
              href="/"
              aria-label={`${brandName} home`}
              onClick={leaveToHome}
            >
              <BrandMark size={48} />
            </a>
            <p className={styles.brandTagline}>The performance layer for agentic development.</p>
          </section>

          <section className={styles.authPane}>
            <div className={styles.formShell}>
              <h1 className={styles.formTitle}>Welcome back</h1>

              {notice && (
                <p className={styles.sessionNotice} role="status">
                  {notice}
                </p>
              )}

              <div className={styles.authActions}>
                <a
                  className={styles.socialButton}
                  href={
                    controlPlaneUrl
                      ? `${controlPlaneUrl}/oauth/start/apple`
                      : undefined
                  }
                  aria-disabled={!controlPlaneUrl}
                >
                  <span className={styles.socialIcon}>
                    <AppleIcon />
                  </span>
                  <span className={styles.socialLabel}>Sign in with Apple</span>
                </a>

                <a
                  className={styles.socialButton}
                  href={
                    controlPlaneUrl
                      ? `${controlPlaneUrl}/oauth/start/github`
                      : undefined
                  }
                  aria-disabled={!controlPlaneUrl}
                >
                  <span className={styles.socialIcon}>
                    <GitHubIcon />
                  </span>
                  <span className={styles.socialLabel}>Sign in with GitHub</span>
                </a>

                <a
                  className={styles.socialButton}
                  href={
                    controlPlaneUrl
                      ? `${controlPlaneUrl}/oauth/start/google`
                      : undefined
                  }
                  aria-disabled={!controlPlaneUrl}
                >
                  <span className={styles.socialIcon}>
                    <GoogleIcon />
                  </span>
                  <span className={styles.socialLabel}>Sign in with Google</span>
                </a>

                <div className={styles.dividerRow}>
                  <span className={styles.dividerLine} />
                  <span className={styles.dividerLabel}>or use an operator token</span>
                  <span className={styles.dividerLine} />
                </div>

                {!showTokenForm ? (
                  <button
                    type="button"
                    className={styles.socialButton}
                    onClick={openTokenForm}
                  >
                    <span className={styles.socialIcon}>
                      <KeyIcon />
                    </span>
                    <span className={styles.socialLabel}>Use a token</span>
                  </button>
                ) : null}

                <div
                  className={
                    showTokenForm ? styles.tokenPanelOpen : styles.tokenPanel
                  }
                  aria-hidden={!showTokenForm}
                >
                  <div className={styles.tokenPanelInner}>
                    <div className={styles.tokenBlock}>
                      <div className={styles.tokenLabelRow}>
                        <label className={styles.tokenLabel} htmlFor="entry-api-token">
                          Access token
                        </label>
                        <button
                          type="button"
                          className={styles.inlineBack}
                          onClick={closeTokenForm}
                          tabIndex={showTokenForm ? 0 : -1}
                        >
                          Back
                        </button>
                      </div>
                      <input
                        id="entry-api-token"
                        type="password"
                        className={styles.tokenInput}
                        placeholder="Paste your access token"
                        value={tokenInput}
                        onChange={(e) => setTokenInput(e.target.value)}
                        onKeyDown={handleKeydown}
                        autoComplete="off"
                        spellCheck={false}
                        tabIndex={showTokenForm ? 0 : -1}
                      />
                      {tokenError && <p className={styles.tokenError}>{tokenError}</p>}
                      <SplitSquircleForward
                        label={connecting ? 'Connecting…' : 'Sign in'}
                        onClick={handleConnect}
                        disabled={connecting || !tokenInput.trim()}
                        size="md"
                        block
                      />
                    </div>
                  </div>
                </div>
              </div>

              {import.meta.env.DEV && (
                <div className={styles.devBar}>
                  <span className={styles.devLabel}>Dev</span>
                  <button type="button" className={styles.devLink} onClick={continueWithoutSignIn}>
                    Continue without signing in
                  </button>
                </div>
              )}
            </div>
          </section>
        </div>
      </main>

      <footer className={styles.entryFooter}>
        <LegalFooter className={styles.footerMuted} />
      </footer>
    </div>
  );
}
