import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cloudConfig } from '../../src/globalConfig/cloud';
import logger from '../../src/logger';
import { PromptfooModelProvider } from '../../src/providers/promptfooModel';
import type { Mock } from 'vitest';

describe('PromptfooModelProvider', () => {
  let mockFetch: Mock;
  let mockCloudConfig: ReturnType<typeof vi.spyOn>;
  const mockLogger = vi.spyOn(logger, 'debug').mockImplementation(function () {});
  const mockErrorLogger = vi.spyOn(logger, 'error').mockImplementation(function () {});

  beforeEach(() => {
    mockFetch = vi.fn();
    global.fetch = mockFetch;
    mockCloudConfig = vi.spyOn(cloudConfig, 'getApiKey').mockReturnValue('test-token');
    mockLogger.mockClear();
    mockLogger.mockImplementation(function () {});
    mockErrorLogger.mockClear();
    mockErrorLogger.mockImplementation(function () {});
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('should initialize with model name', () => {
    const provider = new PromptfooModelProvider('test-model');
    expect(provider.id()).toBe('promptfoo:model:test-model');
  });

  it('should throw error if model name is not provided', () => {
    expect(() => new PromptfooModelProvider('')).toThrow('Model name is required');
  });

  it('should call API with string prompt', async () => {
    const provider = new PromptfooModelProvider('test-model');
    const mockResponse = {
      ok: true,
      json: () =>
        Promise.resolve({
          result: {
            choices: [{ message: { content: 'test response' } }],
            usage: {
              total_tokens: 10,
              prompt_tokens: 5,
              completion_tokens: 5,
            },
          },
        }),
    };
    mockFetch.mockResolvedValue(mockResponse);

    const result = await provider.callApi('test prompt');

    expect(result).toEqual({
      output: 'test response',
      tokenUsage: {
        total: 10,
        prompt: 5,
        completion: 5,
        numRequests: 1,
      },
    });
  });

  it('should not log prompt, config, or response content', async () => {
    const provider = new PromptfooModelProvider('secret-configured-model-sentinel', {
      model: 'secret-configured-model-sentinel',
      config: { 'secret-config-key-sentinel': 'secret-config-sentinel' },
    });
    const mockResponse = {
      ok: true,
      json: () =>
        Promise.resolve({
          result: {
            model: 'test-model',
            provider: 'promptfoo',
            choices: [
              {
                message: { content: 'secret-response-sentinel' },
                finish_reason: 'stop',
              },
            ],
            usage: {
              total_tokens: 10,
              prompt_tokens: 5,
              completion_tokens: 5,
            },
          },
        }),
    };
    mockFetch.mockResolvedValue(mockResponse);

    await provider.callApi('secret-prompt-sentinel');

    const debugLogs = JSON.stringify(mockLogger.mock.calls);
    expect(debugLogs).toContain('[PromptfooModel] Sending request');
    expect(debugLogs).toContain('[PromptfooModel] Received response');
    expect(debugLogs).toContain('configuredModelLength');
    expect(debugLogs).toContain('messageCount');
    expect(debugLogs).toContain('tokenUsage');
    expect(debugLogs).not.toContain('secret-configured-model-sentinel');
    expect(debugLogs).not.toContain('secret-prompt-sentinel');
    expect(debugLogs).not.toContain('secret-config-key-sentinel');
    expect(debugLogs).not.toContain('secret-config-sentinel');
    expect(debugLogs).not.toContain('secret-response-sentinel');
  });

  it('should sanitize sensitive API host URL details in request logs', async () => {
    vi.spyOn(cloudConfig, 'getApiHost').mockReturnValue(
      'https://user:secret-url-password@api.promptfoo.example/secret-url-path?tenant=secret-url-tenant',
    );
    const provider = new PromptfooModelProvider('test-model');
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          result: {
            choices: [{ message: { content: 'test response' } }],
            usage: {
              total_tokens: 10,
              prompt_tokens: 5,
              completion_tokens: 5,
            },
          },
        }),
    });

    await provider.callApi('test prompt');

    const debugLogs = JSON.stringify(mockLogger.mock.calls);
    expect(debugLogs).toContain('[PromptfooModel] Sending request');
    expect(debugLogs).not.toContain('secret-url-password');
    expect(debugLogs).not.toContain('secret-url-path');
    expect(debugLogs).not.toContain('secret-url-tenant');
    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({ 'x-promptfoo-silent': 'true' }),
      }),
    );
  });

  it('should not log remote-controlled response metadata', async () => {
    const provider = new PromptfooModelProvider('test-model');
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          result: {
            model: 'secret-response-model-sentinel',
            provider: 'secret-provider-sentinel',
            choices: [
              {
                message: { content: 'test response' },
                finish_reason: 'secret-finish-sentinel',
              },
            ],
            usage: {
              total_tokens: 'secret-total-token-sentinel',
              prompt_tokens: 'secret-prompt-token-sentinel',
              completion_tokens: 'secret-completion-token-sentinel',
            },
          },
        }),
    });

    await provider.callApi('test prompt');

    const debugLogs = JSON.stringify(mockLogger.mock.calls);
    expect(debugLogs).toContain('[PromptfooModel] Received response');
    expect(debugLogs).toContain('"finishReason":"custom"');
    expect(debugLogs).not.toContain('secret-response-model-sentinel');
    expect(debugLogs).not.toContain('secret-provider-sentinel');
    expect(debugLogs).not.toContain('secret-finish-sentinel');
    expect(debugLogs).not.toContain('secret-total-token-sentinel');
    expect(debugLogs).not.toContain('secret-prompt-token-sentinel');
    expect(debugLogs).not.toContain('secret-completion-token-sentinel');
  });

  it('should handle JSON array messages', async () => {
    const provider = new PromptfooModelProvider('test-model');
    const messages = JSON.stringify([
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi' },
    ]);

    const mockResponse = {
      ok: true,
      json: () =>
        Promise.resolve({
          result: {
            choices: [{ message: { content: 'test response' } }],
            usage: { total_tokens: 10, prompt_tokens: 5, completion_tokens: 5 },
          },
        }),
    };
    mockFetch.mockResolvedValue(mockResponse);

    await provider.callApi(messages);

    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        body: expect.stringContaining(
          '"messages":[{"role":"user","content":"Hello"},{"role":"assistant","content":"Hi"}]',
        ),
      }),
    );
  });

  it('should throw error if no auth token', async () => {
    mockCloudConfig.mockReturnValue(undefined);
    const provider = new PromptfooModelProvider('test-model');

    await expect(provider.callApi('test')).rejects.toThrow('No Promptfoo auth token available');
  });

  it('should handle API errors', async () => {
    const provider = new PromptfooModelProvider('test-model');
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      text: () => Promise.resolve('secret-error-body-sentinel'),
    });

    await expect(provider.callApi('test')).rejects.toThrow('PromptfooModel task API error: 500');

    const logs = JSON.stringify([...mockLogger.mock.calls, ...mockErrorLogger.mock.calls]);
    expect(logs).toContain('responseBodyLength');
    expect(logs).not.toContain('secret-error-body-sentinel');
  });

  it('should not log raw fetch error names or messages', async () => {
    const provider = new PromptfooModelProvider('test-model');
    const error = new Error('secret-fetch-error-message-sentinel');
    error.name = 'secret-fetch-error-name-sentinel';
    mockFetch.mockRejectedValue(error);

    await expect(provider.callApi('test')).rejects.toThrow('secret-fetch-error-message-sentinel');

    const errorLogs = JSON.stringify(mockErrorLogger.mock.calls);
    expect(errorLogs).toContain('errorMessageLength');
    expect(errorLogs).not.toContain('secret-fetch-error-message-sentinel');
    expect(errorLogs).not.toContain('secret-fetch-error-name-sentinel');
  });

  it('should handle invalid API responses', async () => {
    const provider = new PromptfooModelProvider('test-model');
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    });

    await expect(provider.callApi('test')).rejects.toThrow(
      'Invalid response from PromptfooModel task API',
    );
  });

  it('should use config from options', async () => {
    const config = { temperature: 0.7 };
    const provider = new PromptfooModelProvider('test-model', { model: 'test-model', config });

    const mockResponse = {
      ok: true,
      json: () =>
        Promise.resolve({
          result: {
            choices: [{ message: { content: 'test' } }],
            usage: { total_tokens: 10, prompt_tokens: 5, completion_tokens: 5 },
          },
        }),
    };
    mockFetch.mockResolvedValue(mockResponse);

    await provider.callApi('test');

    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        body: expect.stringContaining('"config":{"temperature":0.7}'),
      }),
    );
  });
});
