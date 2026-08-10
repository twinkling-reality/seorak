/**
 * ChatProvider — conversation + open/closed state for the chat surface,
 * mounted once at DashboardApp level so chat is reachable from every
 * authenticated view. The provider owns the engine (the v1 local stub over the
 * polling store); swapping in the worker POST /chat backend is one change in
 * the engine construction below, invisible to the shell.
 *
 * `useChat()` returns null outside the provider, so ChatTrigger/ChatPanel
 * render nothing in isolation (tests, storybook-style mounts) instead of
 * throwing.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { ChatMessage, ChatRequest, ChatWindowDays } from '@seorak/types';
import { pollingActions } from '../lib/stores/polling.js';
import { parseLocation } from '../lib/router.js';
import { createStubChatEngine, type ChatEngine } from './engine.js';

export interface ChatContextValue {
  open: boolean;
  openChat: () => void;
  closeChat: () => void;
  toggleChat: () => void;
  messages: ChatMessage[];
  pending: boolean;
  send: (text: string) => void;
}

const ChatContext = createContext<ChatContextValue | null>(null);

export function useChat(): ChatContextValue | null {
  return useContext(ChatContext);
}

function currentRangeDays(): ChatWindowDays | undefined {
  const days = pollingActions.getState().overviewData?.rangeDays;
  return days === 7 || days === 30 || days === 90 ? days : undefined;
}

export function ChatProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [pending, setPending] = useState(false);
  const conversationIdRef = useRef<string | undefined>(undefined);
  const seqRef = useRef(0);

  const engineRef = useRef<ChatEngine | null>(null);
  if (!engineRef.current) {
    engineRef.current = createStubChatEngine(() => {
      const s = pollingActions.getState();
      return {
        overview: s.overviewData,
        liveSessions: s.liveSessions,
        interventions: s.interventions,
      };
    });
  }

  const openChat = useCallback(() => setOpen(true), []);
  const closeChat = useCallback(() => setOpen(false), []);
  const toggleChat = useCallback(() => setOpen((p) => !p), []);

  const send = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const userMessage: ChatMessage = {
      id: `user-${++seqRef.current}`,
      role: 'user',
      content: trimmed,
      createdAt: new Date().toISOString(),
    };
    setMessages((m) => [...m, userMessage]);
    setPending(true);
    const request: ChatRequest = {
      message: trimmed,
      conversationId: conversationIdRef.current,
      context: {
        surface: 'web',
        rangeDays: currentRangeDays(),
        route: parseLocation().view,
      },
    };
    engineRef.current!.send(request).then(
      (response) => {
        conversationIdRef.current = response.conversationId;
        setMessages((m) => [...m, response.message]);
        setPending(false);
      },
      () => {
        setMessages((m) => [
          ...m,
          {
            id: `error-${++seqRef.current}`,
            role: 'assistant',
            content: 'Something went wrong answering that. Ask again in a moment.',
            createdAt: new Date().toISOString(),
          },
        ]);
        setPending(false);
      },
    );
  }, []);

  // Cmd/Ctrl+K toggles chat from anywhere in the dashboard. A modifier chord,
  // so it needs no input-field or drill gating (the plain-letter vocabulary
  // like `c` stays owned by the views, gated on their own anyOpen state).
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
      if (e.key !== 'k' && e.key !== 'K') return;
      e.preventDefault();
      setOpen((p) => !p);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  return (
    <ChatContext.Provider
      value={{ open, openChat, closeChat, toggleChat, messages, pending, send }}
    >
      {children}
    </ChatContext.Provider>
  );
}
