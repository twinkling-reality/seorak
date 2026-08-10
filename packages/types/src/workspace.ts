/** Publish-safe context for the isolated cell currently serving a surface. */
export interface WorkspaceMember {
  memberId: string;
  displayName: string;
}

export interface WorkspaceContext {
  mode: "personal" | "workspace";
  /** Present only in shared workspace mode. */
  workspaceId?: string;
  workspaceName?: string;
  controlPlaneUrl?: string;
  currentMember?: WorkspaceMember;
  members: WorkspaceMember[];
}

export interface WorkspaceProjectClaim {
  canonicalRepoId: string;
  joiningRepoId: string;
}
