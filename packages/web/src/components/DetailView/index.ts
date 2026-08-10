export { default as DetailView } from './DetailView.js';
export type { DetailTabDef, TabControl } from './DetailView.js';

export { default as DetailSection } from './DetailSection.js';

export { default as FocusedDetailView } from './FocusedDetailView.js';
export type { FocusedQuestion } from './FocusedDetailView.js';

export { default as Metric } from './Metric.js';
export type { MetricTone } from './Metric.js';

export { default as VizNote } from './VizNote.js';

export { default as AnswerNote } from './AnswerNote.js';

export {
  volumeQuestion,
  rateQuestion,
  deltaQuestion,
  distributionQuestion,
  treemapQuestion,
  compositionQuestion,
  trendQuestion,
  dayBarsQuestion,
  benchmarkBarsQuestion,
  churnQuestion,
  stackedTimelineQuestion,
  rhythmQuestion,
  listQuestion,
} from './questions.js';
