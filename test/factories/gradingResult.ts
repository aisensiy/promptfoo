import { createProviderResponse } from './provider';

import type { GradingResult, ProviderResponse } from '../../src/types/index';

export function createGradingResult(overrides: Partial<GradingResult> = {}): GradingResult {
  return {
    pass: true,
    score: 1,
    reason: 'Test grading output',
    ...overrides,
  };
}

// pass/score are locked after overrides so callers cannot accidentally flip
// a passing fixture to a failure (or vice versa). reason remains overridable.
export function createPassingGradingResult(overrides: Partial<GradingResult> = {}): GradingResult {
  return createGradingResult({ ...overrides, pass: true, score: 1 });
}

export function createFailingGradingResult(overrides: Partial<GradingResult> = {}): GradingResult {
  return createGradingResult({
    reason: 'Grading failed reason',
    ...overrides,
    pass: false,
    score: 0,
  });
}

export function createGradingProviderResponse(
  gradingResult: GradingResult = createPassingGradingResult(),
  overrides: Partial<ProviderResponse> = {},
): ProviderResponse {
  return createProviderResponse({
    output: JSON.stringify(gradingResult),
    ...overrides,
  });
}
