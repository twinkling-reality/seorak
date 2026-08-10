/**
 * ChatMessages — the scroll region: conversation turns, citation chips, and
 * the empty-state suggestions. Citation chips reuse the widget catalog's
 * `drillTarget` (same signal ids via SEORAK_SIGNALS), so a cited stat links to
 * the exact detail view its widget opens; clicking one closes the chat so the
 * drill isn't half-covered by the panel it was asked from. A citation whose
 * signal has no drill target renders as a plain (non-clickable) chip.
 * Honesty: a `value: null` citation renders "--", the same empty mark the
 * widgets use.
 */

import { useEffect, useRef } from 'react';
import clsx from 'clsx';
import type { ChatMessage, StatCitation } from '@seorak/types';
import { getWidget } from '../widgets/catalog/index.js';
import { navigate, navigateToAgents, navigateToDetail, parseLocation } from '../lib/router.js';
import { ChatAssistantMessage } from './ChatAssistantMessage.js';
import { ChatThinking } from './ChatThinking.js';
import { CHAT_DEV_SLOW_SUGGESTION } from './engine.js';
import styles from './chatMessages.module.css';
import motion from './chatMotion.module.css';
import glass from '../components/surface/glass.module.css';

const SUGGESTIONS = [
  'What did I spend this week?',
  'Is anything running right now?',
  'How often do my sessions ship?',
  'Am I getting stuck in retry loops?',
];

function CitationChip({ citation, onNavigate }: { citation: StatCitation; onNavigate: () => void }) {
  const drill = getWidget(citation.signalId)?.drillTarget;
  const body = (
    <>
      <span className={styles.citationLabel}>{citation.label}</span>
      <span className={clsx(styles.citationValue, citation.value === null && styles.citationEmpty)}>
        {citation.value ?? '--'}
      </span>
    </>
  );
  if (!drill) return <span className={clsx(styles.citation, glass.rim)}>{body}</span>;
  return (
    <button
      type="button"
      className={clsx(styles.citation, styles.citationLink, glass.rim)}
      onClick={() => {
        // Drill views mount inside Overview; hop there first from any other view.
        // Agents is its own route — navigate there instead of a detail drill.
        if ('route' in drill && drill.route === 'agents') {
          navigateToAgents(drill.section);
          onNavigate();
          return;
        }
        if (parseLocation().view !== 'overview') navigate('overview');
        if ('view' in drill && drill.view) {
          navigateToDetail(drill.view, drill.tab, drill.q);
        }
        onNavigate();
      }}
    >
      {body}
    </button>
  );
}

export default function ChatMessages({
  messages,
  pending,
  onAsk,
  onNavigate,
}: {
  messages: ChatMessage[];
  pending: boolean;
  onAsk: (text: string) => void;
  onNavigate: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, pending]);

  if (messages.length === 0) {
    return (
      <div className={styles.messages} ref={scrollRef}>
        <div className={styles.empty}>
          <p className={styles.emptyTitle}>Ask about your own record.</p>
          <p className={styles.emptyHint}>
            Early version. It answers direct stat questions from the same numbers the dashboard
            shows, and says so plainly when something is not measured yet.
          </p>
          <div className={styles.suggestions}>
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                type="button"
                className={clsx(styles.suggestion, glass.rim)}
                onClick={() => onAsk(s)}
              >
                <span className={styles.suggestionText}>{s}</span>
                {import.meta.env.DEV && s === CHAT_DEV_SLOW_SUGGESTION ? (
                  <span className={styles.suggestionDevNote}>slow demo</span>
                ) : null}
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.messages} ref={scrollRef}>
      {messages.map((m) =>
        m.role === 'user' ? (
          <div key={m.id} className={clsx(styles.msgUser, motion.textReveal)}>
            {m.content}
          </div>
        ) : (
          <ChatAssistantMessage
            key={m.id}
            body={m.content}
            citations={
              m.citations && m.citations.length > 0 ? (
                <>
                  {m.citations.map((c, i) => (
                    <CitationChip key={`${m.id}-${c.signalId}-${i}`} citation={c} onNavigate={onNavigate} />
                  ))}
                </>
              ) : undefined
            }
          />
        ),
      )}
      {pending ? <ChatThinking /> : null}
    </div>
  );
}
