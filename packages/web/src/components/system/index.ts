/**
 * System screens: the diagnostic family for loading, not-found, fault, and
 * inline-error states.
 */

export { SystemLoader, SystemMiniLoader } from './SystemLoader.js';
export { SystemPreview } from './SystemPreview.js';
export { SystemNotFound } from './SystemNotFound.js';
export { SystemFault } from './SystemFault.js';
export { SystemError } from './SystemError.js';
export {
  SegmentedRing,
  ShimmerWord,
  SystemScreen,
  GeometricBackground,
  DriftingReadouts,
  useIsNarrow,
  useReducedMotion,
} from './SystemDiagnostic.js';
