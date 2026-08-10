/**
 * Public contract for installed-client authorization.
 *
 * Every installed surface uses the control plane's OAuth device flow with PKCE,
 * but the owner cell mints a capability pair for the concrete client. The
 * browser deliberately does not participate: it receives an HttpOnly session
 * through a one-time handoff instead of bearer credentials.
 */
export const SEORAK_CLIENT_KINDS = ["collector", "mobile"] as const;
export type SeorakClientKind = (typeof SEORAK_CLIENT_KINDS)[number];

export function isSeorakClientKind(value: unknown): value is SeorakClientKind {
  return (SEORAK_CLIENT_KINDS as readonly unknown[]).includes(value);
}

export interface ClientAuthorizationHome {
  kind: "personal" | "workspace";
  id: string;
  name: string;
  memberId?: string;
}

export interface CollectorClientCredentials {
  clientKind: "collector";
  workerUrl: string;
  ingestToken: string;
  readToken: string;
  home: ClientAuthorizationHome;
}

export interface MobileClientCredentials {
  clientKind: "mobile";
  workerUrl: string;
  mobileToken: string;
  readToken: string;
  /** Control-plane bearer used only to mint a one-time, identity-bound
   * account-deletion reauthentication intent. It is not a cell capability. */
  accountManagementToken: string;
  home: ClientAuthorizationHome;
}

export type InstalledClientCredentials =
  | CollectorClientCredentials
  | MobileClientCredentials;
