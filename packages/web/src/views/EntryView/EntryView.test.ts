import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./EntryView.tsx', import.meta.url), 'utf8');

describe('managed sign-in choices', () => {
  it('offers Apple as a first-class provider beside GitHub and Google', () => {
    expect(source).toContain('/oauth/start/apple');
    expect(source).toContain('Sign in with Apple');
    expect(source).toContain('/oauth/start/github');
    expect(source).toContain('/oauth/start/google');
    expect(source.indexOf('/oauth/start/apple')).toBeLessThan(
      source.indexOf('/oauth/start/github'),
    );
  });
});
