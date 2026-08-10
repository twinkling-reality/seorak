import { describe, expect, it } from 'vitest';

import { getDemoData } from '../../lib/demo/index.js';
import { createEmptyDeveloperModel, validateDeveloperModel } from '../../lib/schemas/developer-model.js';
import { compileSnapshotToPresentation } from '../../views/ModelView/compileSnapshotToPresentation.js';

function demoDeveloperModelSnapshot(
  scenarioId: string,
  rangeDays: 7 | 30 | 90,
) {
  const data = getDemoData(scenarioId, rangeDays);
  return validateDeveloperModel(data.developerModel ?? createEmptyDeveloperModel(rangeDays));
}

describe('useDeveloperModel demo snapshot resolution', () => {
  it('healthy demo path validates and compiles to populated presentation', () => {
    const snapshot = demoDeveloperModelSnapshot('healthy', 30);
    const presentation = compileSnapshotToPresentation(snapshot, { displayName: 'Glendon' });

    expect(presentation.forming).toBeNull();
    expect(presentation.insights.length).toBeGreaterThan(0);
    expect(presentation.prose[0]).toEqual({
      type: 'identityLead',
      displayName: 'Glendon',
      greeting: 'Glendon, ',
    });
  });

  it('empty demo path keeps honest-empty forming read', () => {
    const snapshot = demoDeveloperModelSnapshot('empty', 30);
    const presentation = compileSnapshotToPresentation(snapshot, { displayName: 'You' });

    expect(presentation.forming).not.toBeNull();
    expect(presentation.insights.every((i) => i.id.startsWith('forming-'))).toBe(true);
  });
});
