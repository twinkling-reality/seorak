import clsx from 'clsx';
import { useChat } from './ChatProvider.js';
import glass from '../components/surface/glass.module.css';
import glassTrigger from '../components/controls/glassTrigger.module.css';
import kbdChip from '../components/controls/kbdChip.module.css';

function isMacLike(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Mac|iPhone|iPad/.test(navigator.platform ?? '');
}

export default function ChatTrigger() {
  const chat = useChat();
  if (!chat) return null;
  return (
    <button
      type="button"
      className={clsx(
        glassTrigger.glassTrigger,
        glass.sheet,
        glass.rim,
        chat.open && glassTrigger.glassTriggerActive,
      )}
      onClick={chat.toggleChat}
      aria-pressed={chat.open}
    >
      Ask
      <kbd className={kbdChip.kbdSm}>{isMacLike() ? '⌘K' : 'Ctrl K'}</kbd>
    </button>
  );
}
