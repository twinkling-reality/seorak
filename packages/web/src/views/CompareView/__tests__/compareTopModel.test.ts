import { describe, expect, it } from 'vitest';

import { COMPARE_METRICS, type RepoData } from '../compareMetrics.js';

/**
 * The `top-model` compare cell is a dense label, so it names the model without
 * the vendor ("Opus 4.8"), and stays honest-empty when a repo has no model
 * usage. Guards the formatModel wiring at this render site.
 */
const topModel = COMPARE_METRICS.find((m) => m.id === 'top-model')!;

const repo = (byModel: RepoData['rollup']['byModel']): RepoData =>
  ({ project: 'seorak', repoId: 'r1', rollup: { byModel }, momentum: null, temperature: null }) as RepoData;

describe('compare > top-model', () => {
  it('exists in the registry', () => {
    expect(topModel).toBeDefined();
  });

  it('names the model compactly, with spend as the sub', () => {
    const cell = topModel.read(
      repo([{ model: 'claude-opus-4-8', calls: 9, tokensTotal: 8000, costUsd: 4.2 }]),
    );
    expect(cell.value).toBe('Opus 4.8');
    expect(cell.value).not.toContain('claude-');
    expect(cell.sub).toBe('$4.20');
    expect(cell.empty).toBe(false);
  });

  it('falls back to calls when the top model is unpriced', () => {
    const cell = topModel.read(
      repo([{ model: 'claude-sonnet-4-6', calls: 12, tokensTotal: 8000, costUsd: null }]),
    );
    expect(cell.value).toBe('Sonnet 4.6');
    expect(cell.sub).toBe('12 calls');
  });

  it('passes an unrecognized id through rather than inventing a name', () => {
    const cell = topModel.read(
      repo([{ model: 'gpt-5-codex', calls: 4, tokensTotal: 1000, costUsd: 1 }]),
    );
    expect(cell.value).toBe('gpt-5-codex');
  });

  it('is honest-empty when the repo has no model usage', () => {
    const cell = topModel.read(repo([]));
    expect(cell.empty).toBe(true);
    expect(cell.value).not.toContain('Opus');
  });
});
