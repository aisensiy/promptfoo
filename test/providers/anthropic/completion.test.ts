import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearCache, disableCache, enableCache, getCache } from '../../../src/cache';
import { AnthropicCompletionProvider } from '../../../src/providers/anthropic/completion';

vi.mock('proxy-agent', async (importOriginal) => {
  return {
    ...(await importOriginal()),

    ProxyAgent: vi.fn().mockImplementation(function () {
      return {};
    }),
  };
});

const originalEnv = process.env;
const TEST_API_KEY = 'test-api-key';

describe('AnthropicCompletionProvider', () => {
  beforeEach(() => {
    process.env = { ...originalEnv, ANTHROPIC_API_KEY: TEST_API_KEY };
  });

  afterEach(async () => {
    vi.clearAllMocks();
    await clearCache();
    enableCache();
    process.env = originalEnv;
  });

  describe('callApi', () => {
    it('should return output for default behavior', async () => {
      const provider = new AnthropicCompletionProvider('claude-1');
      vi.spyOn(provider.anthropic.completions, 'create').mockResolvedValue({
        id: 'test-id',
        model: 'claude-1',
        stop_reason: 'stop_sequence',
        type: 'completion',
        completion: 'Test output',
      });
      const result = await provider.callApi('Test prompt');

      expect(provider.anthropic.completions.create).toHaveBeenCalledTimes(1);
      expect(result).toMatchObject({
        output: 'Test output',
        tokenUsage: {},
      });
    });

    it('should return cached output with caching enabled', async () => {
      const provider = new AnthropicCompletionProvider('claude-1');
      vi.spyOn(provider.anthropic.completions, 'create').mockResolvedValue({
        id: 'test-id',
        model: 'claude-1',
        stop_reason: 'stop_sequence',
        type: 'completion',
        completion: 'Test output',
      });
      const result = await provider.callApi('Test prompt');

      expect(provider.anthropic.completions.create).toHaveBeenCalledTimes(1);
      expect(result).toMatchObject({
        output: 'Test output',
        tokenUsage: {},
      });

      vi.mocked(provider.anthropic.completions.create).mockClear();
      const cachedResult = await provider.callApi('Test prompt');

      expect(provider.anthropic.completions.create).toHaveBeenCalledTimes(0);
      expect(cachedResult.cached).toBe(true);
      expect(cachedResult).toMatchObject({
        output: 'Test output',
        tokenUsage: {},
      });
    });

    it('should hash request params in cache keys', async () => {
      const provider = new AnthropicCompletionProvider('claude-1');
      const cache = await getCache();
      const getSpy = vi.spyOn(cache, 'get');
      const setSpy = vi.spyOn(cache, 'set');
      vi.spyOn(provider.anthropic.completions, 'create').mockResolvedValue({
        id: 'test-id',
        model: 'claude-1',
        stop_reason: 'stop_sequence',
        type: 'completion',
        completion: 'Test output',
      });

      await provider.callApi('Sensitive prompt sk-ant-secret');

      const cacheKey = getSpy.mock.calls[0]?.[0] as string;
      expect(cacheKey).toMatch(/^anthropic:completion:claude-1:[a-f0-9]{64}:[a-f0-9]{64}$/);
      expect(cacheKey).not.toContain('Sensitive prompt');
      expect(cacheKey).not.toContain('sk-ant-secret');
      expect(setSpy).toHaveBeenCalledWith(cacheKey, JSON.stringify('Test output'));
    });

    it('should return fresh output with caching disabled', async () => {
      const provider = new AnthropicCompletionProvider('claude-1');
      vi.spyOn(provider.anthropic.completions, 'create').mockResolvedValue({
        id: 'test-id',
        model: 'claude-1',
        stop_reason: 'stop_sequence',
        type: 'completion',
        completion: 'Test output',
      });
      const result = await provider.callApi('Test prompt');

      expect(provider.anthropic.completions.create).toHaveBeenCalledTimes(1);
      expect(result).toMatchObject({
        output: 'Test output',
        tokenUsage: {},
      });

      vi.mocked(provider.anthropic.completions.create).mockClear();

      disableCache();

      const freshResult = await provider.callApi('Test prompt');

      expect(provider.anthropic.completions.create).toHaveBeenCalledTimes(1);
      expect(freshResult).toMatchObject({
        output: 'Test output',
        tokenUsage: {},
      });
    });

    it('should handle API call error', async () => {
      const provider = new AnthropicCompletionProvider('claude-1');
      vi.spyOn(provider.anthropic.completions, 'create').mockRejectedValue(
        new Error('API call failed'),
      );

      const result = await provider.callApi('Test prompt');
      expect(result).toMatchObject({
        error: 'API call error: Error: API call failed',
      });
    });

    it('should preserve an explicit max_tokens_to_sample value of 0', async () => {
      process.env.ANTHROPIC_MAX_TOKENS = '1024';

      const provider = new AnthropicCompletionProvider('claude-2.1', {
        config: { max_tokens_to_sample: 0 },
      });
      vi.spyOn(provider.anthropic.completions, 'create').mockResolvedValue({
        id: 'test-id',
        model: 'claude-2.1',
        stop_reason: 'stop_sequence',
        type: 'completion',
        completion: 'Test output',
      });

      await provider.callApi('Test prompt');

      expect(provider.anthropic.completions.create).toHaveBeenCalledWith(
        expect.objectContaining({ max_tokens_to_sample: 0 }),
      );
    });
  });
});
