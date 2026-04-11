import { beforeEach, describe, expect, it, vi } from 'vitest';
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
  beforeEach(() => {
    vi.clearAllMocks();
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

    expect(debugLogs).toContain('task=llm-rubric');
    expect(debugLogs).toContain('hasResult=true');
    expect(debugLogs).not.toContain('SECRET_PROMPT_TEXT');
    expect(debugLogs).not.toContain('SECRET_INPUT_TEXT');
    expect(debugLogs).not.toContain('sensitive-user@example.com');
    expect(debugLogs).not.toContain('SECRET_RESPONSE_REASON');
  });
});
