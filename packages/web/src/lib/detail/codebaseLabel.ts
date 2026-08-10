/** Basename when the fileLabels opt-in shipped one; short id otherwise. */
export function codebaseFileLabel(label: string | null, fileId: string): string {
  return label ?? `${fileId.slice(0, 10)}…`;
}
