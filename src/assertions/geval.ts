import { matchesGEval } from '../matchers/llmGrading';
import invariant from '../util/invariant';

import type { AssertionParams, GradingResult } from '../types/index';

export const handleGEval = async ({
  assertion,
  inverse,
  renderedValue,
  prompt,
  outputString,
  test,
  providerCallContext,
}: AssertionParams): Promise<GradingResult> => {
  invariant(
    typeof renderedValue === 'string' || Array.isArray(renderedValue),
    'G-Eval assertion type must have a string or array of strings value',
  );

  const threshold = assertion.threshold ?? 0.7;

  if (Array.isArray(renderedValue)) {
    if (renderedValue.length === 0) {
      return {
        assertion,
        pass: false,
        score: 0,
        reason: 'G-Eval assertion requires at least one criterion string in the value array.',
      };
    }

    const scores: number[] = [];
    const reasons: string[] = [];
    for (const value of renderedValue) {
      const resp = await matchesGEval(
        value,
        prompt || '',
        outputString,
        threshold,
        test.options,
        providerCallContext,
      );

      scores.push(resp.score);
      reasons.push(resp.reason);
    }

    const averageScore = scores.reduce((a, b) => a + b, 0) / scores.length;
    const passed = averageScore >= threshold !== !!inverse;

    return {
      assertion,
      pass: passed,
      score: inverse ? 1 - averageScore : averageScore,
      reason: reasons.join('\n\n'),
    };
  }

  const resp = await matchesGEval(
    renderedValue,
    prompt || '',
    outputString,
    threshold,
    test.options,
    providerCallContext,
  );

  const passed = resp.score >= threshold !== !!inverse;

  return {
    assertion,
    ...resp,
    pass: passed,
    score: inverse ? 1 - resp.score : resp.score,
  };
};
