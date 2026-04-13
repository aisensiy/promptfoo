import { vi } from 'vitest';

import type { ApiProvider, Prompt } from '../../src/types/index';

const mockApiProvider: ApiProvider = {
  id: vi.fn().mockReturnValue('test-provider'),
  callApi: vi.fn().mockResolvedValue({
    output: 'Test output',
    tokenUsage: { total: 10, prompt: 5, completion: 5, cached: 0, numRequests: 1 },
  }),
};

const mockApiProvider2: ApiProvider = {
  id: vi.fn().mockReturnValue('test-provider-2'),
  callApi: vi.fn().mockResolvedValue({
    output: 'Test output',
    tokenUsage: { total: 10, prompt: 5, completion: 5, cached: 0, numRequests: 1 },
  }),
};

const mockReasoningApiProvider: ApiProvider = {
  id: vi.fn().mockReturnValue('test-reasoning-provider'),
  callApi: vi.fn().mockResolvedValue({
    output: 'Test output',
    tokenUsage: {
      total: 21,
      prompt: 9,
      completion: 12,
      cached: 0,
      numRequests: 1,
      completionDetails: { reasoning: 11, acceptedPrediction: 12, rejectedPrediction: 13 },
    },
  }),
};

const mockGradingApiProviderPasses: ApiProvider = {
  id: vi.fn().mockReturnValue('test-grading-provider'),
  callApi: vi.fn().mockResolvedValue({
    output: JSON.stringify({ pass: true, reason: 'Test grading output' }),
    tokenUsage: { total: 10, prompt: 5, completion: 5, cached: 0, numRequests: 1 },
  }),
};

const mockGradingApiProviderFails: ApiProvider = {
  id: vi.fn().mockReturnValue('test-grading-provider'),
  callApi: vi.fn().mockResolvedValue({
    output: JSON.stringify({ pass: false, reason: 'Grading failed reason' }),
    tokenUsage: { total: 10, prompt: 5, completion: 5, cached: 0, numRequests: 1 },
  }),
};

function toPrompt(text: string): Prompt {
  return { raw: text, label: text };
}

export {
  mockApiProvider,
  mockApiProvider2,
  mockGradingApiProviderFails,
  mockGradingApiProviderPasses,
  mockReasoningApiProvider,
  toPrompt,
};
