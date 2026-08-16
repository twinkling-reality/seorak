import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import * as modelPresentation from './views/ModelView/modelPresentationTypes.js';
import * as replaySummary from './views/ReplayView/replayScopeSummary.js';
import * as shareStripRamp from './widgets/bodies/atoms/shareStripRamp.js';
import * as systemComponents from './components/system/index.js';
import * as toolMeta from './lib/toolMeta.js';

// Each negative import makes typecheck fail if a removed export
// is reintroduced: the @ts-expect-error would become unused.
// @ts-expect-error vizRampColor was removed; use vizSeqColor.
import type { vizRampColor } from './widgets/bodies/atoms/shareStripRamp.js';
// @ts-expect-error inkRampColor was removed; use vizSeqColor.
import type { inkRampColor } from './widgets/bodies/atoms/shareStripRamp.js';
// @ts-expect-error accentRampColor was removed; use vizSeqColor.
import type { accentRampColor } from './widgets/bodies/atoms/shareStripRamp.js';
// @ts-expect-error scopeHasActivityDetail was removed; use scopeHasMoreDetail.
import type { scopeHasActivityDetail } from './views/ReplayView/replayScopeSummary.js';
// @ts-expect-error scopeActivityPlainText was removed; use scopeMoreDetailPlainText.
import type { scopeActivityPlainText } from './views/ReplayView/replayScopeSummary.js';
// @ts-expect-error the flat Replay summary prose was removed; use compileReplayClarity.
import type { scopeSummaryPlainText } from './views/ReplayView/replayScopeSummary.js';
// @ts-expect-error the flat Replay summary prose was removed; use compileReplayClarity.
import type { scopeOrientationPlainText } from './views/ReplayView/replayScopeSummary.js';
// @ts-expect-error the flat Replay summary prose was removed; use compileReplayClarity.
import type { scopeMoreDetailPlainText } from './views/ReplayView/replayScopeSummary.js';
// @ts-expect-error the flat Replay summary prose was removed; use compileReplayClarity.
import type { scopeHasMoreDetail } from './views/ReplayView/replayScopeSummary.js';
// @ts-expect-error ReplayScopeBody was removed; Replay Summary is PeriodClarityReveal.
import type { ReplayScopeBody } from './views/ReplayView/replayScopeSummary.js';
// @ts-expect-error ModelTopic was removed; use ModelInsight.
import type { ModelTopic } from './views/ModelView/modelPresentationTypes.js';
// @ts-expect-error modelTopicById was removed; use modelInsightById.
import type { modelTopicById } from './views/ModelView/modelPresentationTypes.js';
// @ts-expect-error duration formatters live in lib/utils, not the voice date module.
import type { formatDuration } from './lib/voice/time.js';
// @ts-expect-error use TOOL_ALIASES from @seorak/types.
import type { ALIASES } from './lib/toolMeta.js';
// @ts-expect-error use TOOL_PARTIAL_MATCHES from @seorak/types.
import type { PARTIAL_MATCHES } from './lib/toolMeta.js';

describe('removed web contracts', () => {
  it('keeps the retired runtime aliases absent', () => {
    expect(shareStripRamp).not.toHaveProperty('vizRampColor');
    expect(shareStripRamp).not.toHaveProperty('inkRampColor');
    expect(shareStripRamp).not.toHaveProperty('accentRampColor');
    expect(replaySummary).not.toHaveProperty('scopeHasActivityDetail');
    expect(replaySummary).not.toHaveProperty('scopeActivityPlainText');
    expect(replaySummary).not.toHaveProperty('scopeSummaryPlainText');
    expect(replaySummary).not.toHaveProperty('scopeOrientationPlainText');
    expect(replaySummary).not.toHaveProperty('ReplayScopeBody');
    expect(modelPresentation).not.toHaveProperty('modelTopicById');
    expect(systemComponents).not.toHaveProperty('useBootProgress');
    expect(toolMeta).not.toHaveProperty('ALIASES');
    expect(toolMeta).not.toHaveProperty('PARTIAL_MATCHES');
  });

  it('keeps ToolWidgets on vizSeqColor without a local ramp alias', () => {
    const source = readFileSync(
      new URL('./widgets/bodies/ToolWidgets.tsx', import.meta.url),
      'utf8',
    );
    expect(source).not.toMatch(/\brampColor\b/);
    expect(source).toMatch(/\bvizSeqColor\b/);
  });

  it('keeps the retired live-agents registry key out of production', () => {
    const source = readFileSync(
      new URL('./widgets/bodies/LiveWidgets.tsx', import.meta.url),
      'utf8',
    );
    expect(source).not.toContain("'live-agents'");
  });

  it('keeps the retired widget-catalog compatibility barrel deleted', () => {
    expect(
      existsSync(new URL('./widgets/widget-catalog.ts', import.meta.url)),
    ).toBe(false);
  });

  it('keeps detail formatter facades deleted', () => {
    for (const relativePath of [
      './views/OverviewView/UsageDetailView/format.ts',
      './views/OverviewView/CodebaseDetailView/format.ts',
      './views/OverviewView/ToolsDetailView/format.ts',
    ]) {
      expect(existsSync(new URL(relativePath, import.meta.url)), relativePath).toBe(false);
    }
  });

  it('keeps Agents navigation on canonical hashes', () => {
    const router = readFileSync(new URL('./lib/router.ts', import.meta.url), 'utf8');
    const agentsView = readFileSync(
      new URL('./views/AgentsView/AgentsView.tsx', import.meta.url),
      'utf8',
    );
    expect(router).not.toMatch(/navigateToAgents\s*\(\s*tab/);
    expect(router).not.toContain("params.set('tab'");
    expect(router).not.toContain("params.set('q'");
    expect(agentsView).not.toContain("useQueryParam('tab')");
    expect(agentsView).not.toContain("useQueryParam('q')");
  });

  it('keeps retired Settings section aliases out of production', () => {
    const source = readFileSync(
      new URL('./views/SettingsView/SettingsView.tsx', import.meta.url),
      'utf8',
    );
    expect(source).not.toContain('LEGACY_SECTION_IDS');
    expect(source).not.toMatch(/\bnotifications:\s*['"]alerts['"]/);
  });

  it('keeps version-skew defaults and section-zero catches out of current API readers', () => {
    const overviewSchema = readFileSync(
      new URL('./lib/schemas/overview/agents.ts', import.meta.url),
      'utf8',
    );
    const replaySchema = readFileSync(
      new URL('./lib/schemas/replay.ts', import.meta.url),
      'utf8',
    );
    const agentsCoverage = readFileSync(
      new URL('./views/AgentsView/verdict/coverage.ts', import.meta.url),
      'utf8',
    );
    expect(overviewSchema).not.toMatch(/older worker|old worker/i);
    expect(overviewSchema).not.toContain('rendering honest-empty usage');
    expect(overviewSchema).not.toContain('rendering honest-empty outcomes');
    expect(overviewSchema).not.toContain('rendering honest-empty activity');
    expect(overviewSchema).not.toContain('rendering honest-empty tools');
    expect(overviewSchema).toContain('capabilities: sessionCapabilitiesSchema,');
    expect(overviewSchema).not.toMatch(
      /capabilities:\s*sessionCapabilitiesSchema\.(?:optional|catch)/,
    );
    expect(agentsCoverage).not.toContain('requireCurrentCapabilities');
    expect(agentsCoverage).toContain('pick(a.capabilities, a)');
    expect(replaySchema).not.toContain('.default(');
  });

  it('keeps deleted live-board adapters and unused modules out of source', () => {
    for (const relativePath of [
      './lib/overviewAdapter.ts',
      './widgets/types.ts',
      './components/InlineHint/InlineHint.tsx',
      './components/InlineHint/InlineHint.module.css',
      './components/StatCard/StatCard.tsx',
      './components/StatCard/StatCard.module.css',
      './hooks/useSessionTimeline.ts',
      './lib/agentGradient.ts',
      './lib/summarize.ts',
      './styles/dashboardAlignment.ts',
    ]) {
      expect(existsSync(new URL(relativePath, import.meta.url)), relativePath).toBe(false);
    }
  });

  it('keeps the live board on SessionSummary field names', () => {
    const sources = [
      './components/LiveSessionsTable/LiveSessionsTable.tsx',
      './widgets/bodies/LiveWidgets.tsx',
      './widgets/bodies/types.ts',
      './views/OverviewView/LiveNowView.tsx',
      './views/ProjectView/useProjectData.ts',
    ].map((relativePath) => readFileSync(new URL(relativePath, import.meta.url), 'utf8'));
    const source = sources.join('\n');

    expect(source).not.toContain('overviewAdapter');
    expect(source).not.toContain('hostTool');
    expect(source).not.toMatch(/Member\s*(?:→|->)\s*LiveSession/);
    expect(source).toContain('session.sessionId');
    expect(source).toContain('session.agent');
    expect(source).toContain('session.tokens.total');
  });

  it('keeps API response validation strict and fallback-free', () => {
    const validator = readFileSync(new URL('./lib/schemas/index.ts', import.meta.url), 'utf8');
    const polling = readFileSync(new URL('./lib/stores/polling.ts', import.meta.url), 'utf8');
    const schemas = readFileSync(
      new URL('./lib/schemas/overview/interventions.ts', import.meta.url),
      'utf8',
    );

    expect(validator).not.toContain('ValidateOptions');
    expect(validator).not.toContain('throwOnError');
    expect(validator).not.toMatch(/\bfallback\s*[?:]/);
    expect(polling).not.toMatch(/validateResponse\([^)]*\{[^}]*fallback:/s);
    expect(schemas).toContain(
      'export const interventionsArraySchema: z.ZodType<Intervention[]> = z.array(interventionSchema);',
    );
  });

  it('keeps unknown dashboard routes on the not-found surface', () => {
    const router = readFileSync(new URL('./lib/router.ts', import.meta.url), 'utf8');
    const dashboard = readFileSync(new URL('./DashboardApp.tsx', import.meta.url), 'utf8');

    expect(router).toContain("return { view: 'not-found', projectId: null };");
    expect(dashboard).toContain("activeView === 'not-found'");
    expect(dashboard).toContain('<SystemNotFound />');
  });
});
