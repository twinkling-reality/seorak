/**
 * ChatPanel — the right-anchored liquid-glass chat layer.
 *
 * Deliberately NOT a solid drawer: a fixed full-height glass region whose left
 * edge dissolves into the page (a mask on the backdrop-filter layer), so the
 * dashboard stays visible through and beside it. Glass at this size is the
 * one sanctioned exception to the dashboard's solid instrumental surfaces:
 * chat is ambient conversation, not a data table (DESIGN_LANGUAGE glass rules
 * still hold for everything inside it — the rimmed squircles are the small
 * controls: input row, citation chips, suggestions).
 *
 * Overlay semantics follow WidgetCatalog: portal to body, Esc closes, focus is
 * trapped while open and returned on close. z-index 205 sits above tooltips
 * (200) and the catalog family (201..203).
 */

import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import { useChat, type ChatContextValue } from './ChatProvider.js';
import ChatMessages from './ChatMessages.js';
import ChatInput from './ChatInput.js';
import styles from './ChatPanel.module.css';
import glass from '../components/surface/glass.module.css';

const FOCUSABLE = 'button, [href], input, textarea, select, [tabindex]:not([tabindex="-1"])';

function ChatPanelInner({ chat }: { chat: ChatContextValue }) {
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus the input on open; hand focus back to wherever it was on close.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    inputRef.current?.focus();
    return () => previous?.focus();
  }, []);

  const handleKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      // Stop the window-level Escape listeners (widget catalog, detail drills)
      // from also firing — one Esc closes one layer.
      e.stopPropagation();
      chat.closeChat();
      return;
    }
    if (e.key !== 'Tab') return;
    const panel = panelRef.current;
    if (!panel) return;
    const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
      (el) => !el.hasAttribute('disabled'),
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <div
      ref={panelRef}
      className={styles.root}
      role="dialog"
      aria-modal="true"
      aria-label="Ask Seorak about your stats"
      onKeyDown={handleKeyDown}
    >
      <div className={clsx(styles.glass, glass.sheet)} aria-hidden="true" />
      <div className={styles.column}>
        <button
          type="button"
          className={clsx(styles.close, glass.rim)}
          onClick={chat.closeChat}
          aria-label="Close chat"
        >
          <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <path d="M2.5 2.5 L9.5 9.5 M9.5 2.5 L2.5 9.5" />
          </svg>
        </button>
        <ChatMessages
          messages={chat.messages}
          pending={chat.pending}
          onAsk={chat.send}
          onNavigate={chat.closeChat}
        />
        <ChatInput onSend={chat.send} pending={chat.pending} inputRef={inputRef} />
      </div>
    </div>
  );
}

export default function ChatPanel() {
  const chat = useChat();
  if (!chat || !chat.open) return null;
  return createPortal(<ChatPanelInner chat={chat} />, document.body);
}
