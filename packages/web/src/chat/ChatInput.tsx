/**
 * ChatInput — the question line. A rimmed glass squircle (the "small floating
 * control" tier of the glass system) with Enter-to-send.
 */

import { useState, type FormEvent, type RefObject } from 'react';
import clsx from 'clsx';
import styles from './ChatPanel.module.css';
import glass from '../components/surface/glass.module.css';

export default function ChatInput({
  onSend,
  pending,
  inputRef,
}: {
  onSend: (text: string) => void;
  pending: boolean;
  inputRef: RefObject<HTMLInputElement | null>;
}) {
  const [text, setText] = useState('');

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (pending || text.trim().length === 0) return;
    onSend(text);
    setText('');
  };

  return (
    <form className={clsx(styles.inputRow, glass.rim)} onSubmit={submit}>
      <input
        ref={inputRef}
        type="text"
        className={styles.input}
        placeholder="Ask about your stats"
        value={text}
        onChange={(e) => setText(e.target.value)}
        aria-label="Ask about your stats"
      />
      <button
        type="submit"
        className={styles.sendBtn}
        disabled={pending || text.trim().length === 0}
        aria-label="Send question"
      >
        <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path
            d="M3.5 8h7M8.5 4.5 12 8 8.5 11.5"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    </form>
  );
}
