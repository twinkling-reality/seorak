import { useState, type Dispatch, type RefObject, type SetStateAction } from 'react';
import { useTabKeyboard } from '../lib/useTabKeyboard.js';

interface UseTabsResult<T extends string> {
  activeTab: T;
  setActiveTab: Dispatch<SetStateAction<T>>;
  ref: RefObject<HTMLDivElement | null>;
}

export function useTabs<T extends string>(tabIds: readonly T[], initial?: T): UseTabsResult<T> {
  const [activeTab, setActiveTab] = useState<T>(
    initial && tabIds.includes(initial) ? initial : tabIds[0],
  );
  const ref = useTabKeyboard(
    [...tabIds] as string[],
    setActiveTab as Dispatch<SetStateAction<string>>,
  );
  return { activeTab, setActiveTab, ref };
}
