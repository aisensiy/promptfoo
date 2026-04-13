import { matchesGEval } from '../matchers/llmGrading';
import invariant from '../util/invariant';

import type { AssertionParams, GradingResult } from '../types/index';

type MatcherResponse = Awaited<ReturnType<typeof matchesGEval>>;

const isGEvalGraderFailure = (resp: MatcherResponse): boolean => resp.metadata?.gEvalError === true;

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

    const responses: MatcherResponse[] = [];
    for (const value of renderedValue) {
      responses.push(
        await matchesGEval(
          value,
          prompt || '',
          outputString,
          threshold,
          test.options,
          providerCallContext,
        ),
      );
    }

    // If any sub-evaluation is a grader failure, propagate it verbatim without
    // inversion — a transport/parse failure is not evidence that the criterion
    // was or was not met, and must not be flipped to a pass under not-g-eval.
    const firstFailure = responses.find(isGEvalGraderFailure);
    if (firstFailure) {
      return {
        assertion,
        pass: false,
        score: 0,
        reason: firstFailure.reason,
        tokensUsed: firstFailure.tokensUsed,
      };
    }

    const averageScore = responses.reduce((acc, r) => acc + r.score, 0) / responses.length;
    const combinedReason = responses.map((r) => r.reason).join('\n\n');
    const passed = averageScore >= threshold !== !!inverse;

    return {
      assertion,
      pass: passed,
      score: inverse ? 1 - averageScore : averageScore,
      reason: combinedReason,
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

  if (isGEvalGraderFailure(resp)) {
    return {
      assertion,
      pass: false,
      score: 0,
      reason: resp.reason,
      tokensUsed: resp.tokensUsed,
    };
  }

  const passed = resp.score >= threshold !== !!inverse;

  return {
    assertion,
    ...resp,
    pass: passed,
    score: inverse ? 1 - resp.score : resp.score,
  };
};
