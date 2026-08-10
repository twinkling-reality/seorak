import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import type { WorkspaceContext } from '@seorak/types';
import { fetchWorkspaceContext } from './api.js';

const WorkspaceContextValue = createContext<WorkspaceContext | null>(null);

export function WorkspaceContextProvider({
  children,
}: {
  children: ReactNode;
}): ReactNode {
  const [value, setValue] = useState<WorkspaceContext | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetchWorkspaceContext({ signal: controller.signal })
      .then(setValue)
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          console.warn('[seorak] workspace context unavailable', error);
        }
      });
    return () => controller.abort();
  }, []);

  return (
    <WorkspaceContextValue.Provider value={value}>
      {children}
    </WorkspaceContextValue.Provider>
  );
}

export function useWorkspaceContext(): WorkspaceContext | null {
  return useContext(WorkspaceContextValue);
}
