import { fetchWithCache } from './cache';
import { getUserEmail } from './globalConfig/accounts';
import logger from './logger';
import { REQUEST_TIMEOUT_MS } from './providers/shared';
import { getRemoteGenerationUrl } from './redteam/remoteGeneration';

import type { GradingResult } from './types/index';

type RemoteGradingPayload = {
  task: string;
  [key: string]: unknown;
};

function getRemoteGradingResponseMetadata(data: unknown) {
  const result = (data as { result?: unknown } | null | undefined)?.result;
  return {
    hasResult: Boolean(result),
    resultType: typeof result,
  };
}

function formatRemoteGradingError(error: unknown): string {
  if (
    error instanceof Error &&
    (error.message.startsWith('Remote grading failed with status ') ||
      error.message === 'Remote grading failed. Response data is invalid')
  ) {
    return `Could not perform remote grading: ${error.message}`;
  }

  return 'Could not perform remote grading';
}

export async function doRemoteGrading(
  payload: RemoteGradingPayload,
): Promise<Omit<GradingResult, 'assertion'>> {
  try {
    payload.email = getUserEmail();
    const body = JSON.stringify(payload);
    logger.debug(`Performing remote grading: task=${payload.task}`);
    const { data, status } = await fetchWithCache(
      getRemoteGenerationUrl(),
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body,
      },
      REQUEST_TIMEOUT_MS,
    );

    logger.debug('Remote grading result', {
      status,
      ...getRemoteGradingResponseMetadata(data),
    });

    if (status !== 200) {
      throw new Error(`Remote grading failed with status ${status}`);
    }
    const { result } = data as { result: GradingResult };

    if (!result || result.pass === undefined) {
      throw new Error('Remote grading failed. Response data is invalid');
    }

    return {
      pass: result.pass,
      score: result.score,
      reason: result.reason,
      tokensUsed: result.tokensUsed,
    };
  } catch (error) {
    throw new Error(formatRemoteGradingError(error));
  }
}
