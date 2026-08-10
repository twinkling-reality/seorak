import type { WidgetDef } from './types.js';

// Tools & Models widgets. Multi-tool agent compare lives on /dashboard/agents
// (sidebar); agent-edit-share is the overview entry that navigates there.
// The live tiles:
//   - tool-mix: per-tool call split (tools.byTool)
//   - model-mix: per-model spend split → Agents Models tab
//   - agent-edit-share: edit-line share by agent → Agents Compare
//   - tool-call-errors: error rate from the collector's which-hook `errored` flag
//   - verification: test/build/typecheck/lint checks by kind, and which failed
// All read the retained event log and are honest-empty until in-window rows accrue.
export const TOOLS_WIDGETS: WidgetDef[] = [
  {
    id: 'tool-mix',
    name: 'tool mix',
    description:
      "Breakdown of your agent's tool calls, such as Read, Edit, and Bash. Fills in as calls accrue.",
    category: 'tools',
    // Per-repo: the worker projects byTool onto each ProjectRollup and
    // scopeToProject maps it in, so this renders THIS repo (DA-06 real fix).
    scope: 'both',
    viz: 'proportional-bar',
    w: 6,
    h: 3,
    minW: 4,
    minH: 2,
    maxH: 3,
    fitContent: true,
    dataKeys: ['dashboard'],
    drillTarget: { view: 'tools', tab: 'tools', q: 'volume' },
  },
  {
    id: 'model-mix',
    name: 'model mix',
    description:
      'How token spend splits across the AI models your agent uses. Unpriced models show token share instead of a fake cost.',
    category: 'tools',
    // Per-repo: byModel projected onto ProjectRollup + mapped by scopeToProject (DA-06).
    scope: 'both',
    viz: 'proportional-bar',
    w: 4,
    h: 3,
    minW: 3,
    minH: 2,
    maxH: 3,
    fitContent: true,
    dataKeys: ['model_outcomes', 'token_usage'],
    drillTarget: { route: 'agents', section: 'models' },
    requiresCapture: 'tokenUsage',
  },
  {
    id: 'agent-edit-share',
    name: 'agent edit share',
    description:
      'Edit-line volume split across agents (Claude Code, Codex, …). The fairest cross-tool compare. Fills in once a second tool records edits.',
    category: 'tools',
    // Overview-only: Project scope already narrows byAgent to one repo; the
    // cross-tool headline belongs on the merged board + Agents page.
    scope: 'overview',
    viz: 'proportional-bar',
    w: 12,
    h: 3,
    minW: 6,
    minH: 2,
    maxH: 3,
    fitContent: true,
    dataKeys: ['dashboard'],
    drillTarget: { route: 'agents', section: 'matrix' },
  },
  {
    id: 'tool-call-errors',
    name: 'tool call error rate',
    description:
      "How often your agent's tool calls fail this period. Fills in as calls succeed or fail.",
    category: 'tools',
    scope: 'both',
    viz: 'stat',
    w: 3,
    h: 2,
    minW: 2,
    minH: 2,
    dataKeys: ['tool_call_stats'],
    drillTarget: { view: 'tools', tab: 'errors', q: 'top' },
    ownsClick: true,
    requiresCapture: 'toolCallLogs',
  },
  {
    id: 'verification',
    name: 'verification checks',
    description:
      'Test, build, typecheck, and lint checks this period, by kind and failures. Counts checks and failures, not a pass rate.',
    category: 'tools',
    scope: 'both',
    viz: 'proportional-bar',
    w: 6,
    h: 3,
    minW: 4,
    minH: 2,
    maxH: 4,
    fitContent: true,
    dataKeys: ['tool_call_stats'],
    drillTarget: { view: 'tools', tab: 'errors', q: 'verification' },
  },
];
