import { describe, expect, it } from 'vitest';

import {
  applyIdentityLead,
  hasPersonalDisplayName,
  identityGreeting,
  identityLeadSegment,
} from '../modelIdentityLead.js';
import type { ModelNarrativeSegment } from '../modelPresentationTypes.js';

describe('hasPersonalDisplayName', () => {
  it('rejects default You', () => {
    expect(hasPersonalDisplayName('You')).toBe(false);
    expect(hasPersonalDisplayName(' you ')).toBe(false);
  });

  it('accepts a real handle', () => {
    expect(hasPersonalDisplayName('Glendon')).toBe(true);
  });
});

describe('identityGreeting', () => {
  it('uses a friendly default when no handle is set', () => {
    expect(identityGreeting('You')).toBe('Hey, ');
  });

  it('uses the handle with a comma when set', () => {
    expect(identityGreeting('Glendon')).toBe('Glendon, ');
  });
});

describe('applyIdentityLead', () => {
  it('prepends squircle lead and lowercases the following opener for a real handle', () => {
    const prose = applyIdentityLead(
      [{ type: 'text', text: 'Run your first agent sessions and this read starts filling in: ' }],
      'Glendon',
    );
    expect(prose[0]).toEqual({
      type: 'identityLead',
      displayName: 'Glendon',
      greeting: 'Glendon, ',
    });
    expect(prose[1]).toEqual({
      type: 'text',
      text: 'run your first agent sessions and this read starts filling in: ',
    });
  });

  it('prepends a friendly default greeting when handle is unset', () => {
    const original: ModelNarrativeSegment[] = [
      { type: 'text', text: 'Run your first agent sessions and this read starts filling in: ' },
    ];
    const prose = applyIdentityLead(original, 'You');
    expect(prose[0]).toEqual({
      type: 'identityLead',
      displayName: null,
      greeting: 'Hey, ',
    });
    expect(prose[1]).toEqual({
      type: 'text',
      text: 'run your first agent sessions and this read starts filling in: ',
    });
  });
});

describe('identityLeadSegment', () => {
  it('always includes greeting text', () => {
    expect(identityLeadSegment('You')).toEqual({
      type: 'identityLead',
      displayName: null,
      greeting: 'Hey, ',
    });
  });
});
