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

export function createPassingGradingResult(overrides: Partial<GradingResult> = {}): GradingResult {
  return createGradingResult({ pass: true, score: 1, ...overrides });
}

export function createFailingGradingResult(overrides: Partial<GradingResult> = {}): GradingResult {
  return createGradingResult({
    pass: false,
    score: 0,
    reason: 'Grading failed reason',
    ...overrides,
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
