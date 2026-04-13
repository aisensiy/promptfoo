import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchWithCache } from '../src/cache';
import logger from '../src/logger';
import { doRemoteGrading } from '../src/remoteGrading';

vi.mock('../src/cache', () => ({
  fetchWithCache: vi.fn(),
}));

vi.mock('../src/globalConfig/accounts', () => ({
  getUserEmail: vi.fn(() => 'sensitive-user@example.com'),
}));

vi.mock('../src/logger', () => ({
  default: {
    debug: vi.fn(),
  },
}));

vi.mock('../src/redteam/remoteGeneration', () => ({
  getRemoteGenerationUrl: vi.fn(() => 'https://remote-grading.example.com'),
}));

describe('doRemoteGrading', () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  beforeEach(() => {
    vi.mocked(fetchWithCache).mockResolvedValue({
      data: {
        result: {
          pass: true,
          score: 1,
          reason: 'SECRET_RESPONSE_REASON',
        },
      },
      status: 200,
      statusText: 'OK',
      cached: false,
    });
  });

  it('does not log grading payload or response content', async () => {
    await doRemoteGrading({
      task: 'llm-rubric',
      prompt: 'SECRET_PROMPT_TEXT',
      vars: { input: 'SECRET_INPUT_TEXT' },
    });

    const debugLogs = vi
      .mocked(logger.debug)
      .mock.calls.map((call) => call.join(' '))
      .join('\n');
    const serializedDebugLogs = JSON.stringify(vi.mocked(logger.debug).mock.calls);

    expect(serializedDebugLogs).toContain('"task":"llm-rubric"');
    expect(serializedDebugLogs).toContain('"hasResult":true');
    expect(debugLogs).not.toContain('SECRET_PROMPT_TEXT');
    expect(debugLogs).not.toContain('SECRET_INPUT_TEXT');
    expect(debugLogs).not.toContain('sensitive-user@example.com');
    expect(serializedDebugLogs).not.toContain('SECRET_RESPONSE_REASON');
    expect(fetchWithCache).toHaveBeenCalledWith(
      'https://remote-grading.example.com',
      expect.objectContaining({
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          'x-promptfoo-silent': 'true',
        }),
        body: expect.any(String),
      }),
      expect.any(Number),
      'json',
      true,
    );
    expect(logger.debug).toHaveBeenCalledWith('Performing remote grading', {
      task: 'llm-rubric',
    });
  });

  it('does not expose response content in non-200 errors or logs', async () => {
    vi.mocked(fetchWithCache).mockResolvedValue({
      data: {
        error: 'SECRET_REMOTE_ERROR',
      },
      status: 500,
      statusText: 'SECRET_STATUS_TEXT',
      cached: false,
    });

    await expect(
      doRemoteGrading({
        task: 'llm-rubric',
        prompt: 'SECRET_PROMPT_TEXT',
      }),
    ).rejects.toThrow('Remote grading failed with status 500');

    const allOutput = JSON.stringify(vi.mocked(logger.debug).mock.calls);
    expect(allOutput).not.toContain('SECRET_REMOTE_ERROR');
    expect(allOutput).not.toContain('SECRET_STATUS_TEXT');
  });

  it('does not expose invalid response data in thrown errors', async () => {
    vi.mocked(fetchWithCache).mockResolvedValue({
      data: {
        result: {
          reason: 'SECRET_INVALID_RESPONSE_REASON',
        },
      },
      status: 200,
      statusText: 'OK',
      cached: false,
    });

    await expect(
      doRemoteGrading({
        task: 'llm-rubric',
        prompt: 'SECRET_PROMPT_TEXT',
      }),
    ).rejects.toThrow('Remote grading failed. Response data is invalid');

    const allOutput = JSON.stringify(vi.mocked(logger.debug).mock.calls);
    expect(allOutput).not.toContain('SECRET_INVALID_RESPONSE_REASON');
  });

  it.each([
    'true',
    1,
    null,
  ])('rejects invalid pass values without exposing response data (%s)', async (pass) => {
    vi.mocked(fetchWithCache).mockResolvedValue({
      data: {
        result: {
          pass,
          reason: 'SECRET_NON_BOOLEAN_PASS_REASON',
        },
      },
      status: 200,
      statusText: 'OK',
      cached: false,
    });

    await expect(
      doRemoteGrading({
        task: 'llm-rubric',
        prompt: 'SECRET_PROMPT_TEXT',
      }),
    ).rejects.toThrow('Remote grading failed. Response data is invalid');

    const allOutput = JSON.stringify(vi.mocked(logger.debug).mock.calls);
    expect(allOutput).not.toContain('SECRET_NON_BOOLEAN_PASS_REASON');
  });

  it.each([
    null,
    'SECRET_STRING_RESPONSE',
    ['SECRET_ARRAY_RESPONSE'],
  ])('returns the safe invalid response error for non-object JSON payloads', async (data) => {
    vi.mocked(fetchWithCache).mockResolvedValue({
      data,
      status: 200,
      statusText: 'OK',
      cached: false,
    });

    await expect(
      doRemoteGrading({
        task: 'llm-rubric',
        prompt: 'SECRET_PROMPT_TEXT',
      }),
    ).rejects.toThrow('Remote grading failed. Response data is invalid');

    const allOutput = JSON.stringify(vi.mocked(logger.debug).mock.calls);
    expect(allOutput).not.toContain('SECRET_STRING_RESPONSE');
    expect(allOutput).not.toContain('SECRET_ARRAY_RESPONSE');
  });

  it('does not expose transport error messages in thrown errors', async () => {
    vi.mocked(fetchWithCache).mockRejectedValue(new Error('SECRET_TRANSPORT_ERROR'));

    let thrown: unknown;
    try {
      await doRemoteGrading({
        task: 'llm-rubric',
        prompt: 'SECRET_PROMPT_TEXT',
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toBe('Remote grading request failed');
    expect((thrown as Error).message).not.toContain('SECRET_TRANSPORT_ERROR');
  });

  it('does not trust prefixed transport error messages as safe status errors', async () => {
    vi.mocked(fetchWithCache).mockRejectedValue(
      new Error('Remote grading failed with status 500 SECRET_STATUS_SUFFIX'),
    );

    await expect(
      doRemoteGrading({
        task: 'llm-rubric',
        prompt: 'SECRET_PROMPT_TEXT',
      }),
    ).rejects.toThrow('Remote grading request failed');
  });
});
