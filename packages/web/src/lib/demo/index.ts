// Public demo module API. Components import from here, not from the internal
// scenario / baseline files directly. Every scenario produces ONLY an
// OverviewSnapshot — no global/rank/team/memory/conversation/reports fixtures.

export {
  DEMO_SCENARIOS,
  DEMO_SCENARIO_IDS,
  DEMO_CATEGORY_ORDER,
  DEMO_CATEGORY_LABELS,
  DEMO_DIMENSION_LABELS,
  DEMO_VIEW_LABELS,
  DEFAULT_SCENARIO,
  getDemoData,
  isDemoScenarioId,
  type DemoData,
  type DemoScenario,
  type DemoScenarioId,
  type DemoCategory,
  type DemoDimension,
  type DemoView,
} from './scenarios.js';

export { createBaselineOverview, DEFAULT_PERIOD_DAYS } from './baseline.js';
export { createBaselineDeveloperModel } from './developerModel.js';
export { createEmptyOverviewDemo } from './empty.js';
export { buildDemoReplay } from './replay.js';
