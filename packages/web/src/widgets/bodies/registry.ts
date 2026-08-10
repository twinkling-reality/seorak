import type { WidgetRegistry } from './types.js';
import { liveWidgets } from './LiveWidgets.js';
import { usageWidgets } from './UsageWidgets.js';
import { momentumWidgets } from './MomentumWidgets.js';
import { outcomeWidgets } from './OutcomeWidgets.js';
import { activityWidgets } from './ActivityWidgets.js';
import { codebaseWidgets } from './CodebaseWidgets.js';
import { toolWidgets } from './ToolWidgets.js';

// trend / conversation / memory / team bodies are stripped (out of scope for
// the solo model; TrendWidgets also read a completion trend Seorak cannot
// feed). Only the surviving category bodies register here.
export const widgetBodies: WidgetRegistry = {
  ...liveWidgets,
  ...usageWidgets,
  ...momentumWidgets,
  ...outcomeWidgets,
  ...activityWidgets,
  ...codebaseWidgets,
  ...toolWidgets,
};
