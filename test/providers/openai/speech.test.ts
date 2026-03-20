import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OpenAiSpeechProvider } from '../../../src/providers/openai/speech';
import { fetchWithProxy } from '../../../src/util/fetch/index';

vi.mock('../../../src/logger', () => ({
  default: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));
vi.mock('../../../src/util/fetch/index', async (importOriginal) => ({
  ...(await importOriginal()),
  fetchWithProxy: vi.fn(),
}));

describe('OpenAiSpeechProvider', () => {
  const originalOpenAiApiKey = process.env.OPENAI_API_KEY;

  beforeEach(() => {
    vi.resetAllMocks();
    process.env.OPENAI_API_KEY = 'test-api-key';
  });

  afterEach(() => {
    if (originalOpenAiApiKey) {
      process.env.OPENAI_API_KEY = originalOpenAiApiKey;
    } else {
      delete process.env.OPENAI_API_KEY;
    }
  });

  it('should call the OpenAI speech endpoint and return normalized audio', async () => {
    vi.mocked(fetchWithProxy).mockResolvedValue(
      new Response(Uint8Array.from([1, 2, 3, 4]), {
        status: 200,
        headers: {
          'content-type': 'audio/wav',
          'x-request-id': 'req_speech_1',
        },
      }),
    );

    const provider = new OpenAiSpeechProvider('gpt-4o-mini-tts', {
      config: {
        voice: 'alloy',
        format: 'wav',
        instructions: 'Speak like a calm airline customer.',
      },
    });

    const result = await provider.callApi('I need help changing my flight.');

    expect(fetchWithProxy).toHaveBeenCalledWith(
      'https://api.openai.com/v1/audio/speech',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer test-api-key',
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({
          model: 'gpt-4o-mini-tts',
          input: 'I need help changing my flight.',
          voice: 'alloy',
          response_format: 'wav',
          instructions: 'Speak like a calm airline customer.',
        }),
      }),
    );

    expect(result.output).toBe('I need help changing my flight.');
    expect(result.audio).toEqual({
      data: Buffer.from([1, 2, 3, 4]).toString('base64'),
      format: 'wav',
      transcript: 'I need help changing my flight.',
      sampleRate: 24000,
      channels: 1,
    });
    expect(result.metadata?.audio).toEqual(result.audio);
    expect(result.metadata?.usage).toEqual({
      type: 'estimated_tokens',
      input_tokens: 8,
      input_token_details: {
        text_tokens: 8,
      },
      output_tokens: 0,
      output_token_details: {
        text_tokens: 0,
      },
    });
    expect(result.tokenUsage).toEqual({
      prompt: 8,
      completion: 0,
      total: 8,
      numRequests: 1,
    });
  });

  it('should normalize pcm output to pcm16 metadata and estimate duration-based cost', async () => {
    vi.mocked(fetchWithProxy).mockResolvedValue(
      new Response(Uint8Array.from([5, 6, 7, 8]), {
        status: 200,
      }),
    );

    const provider = new OpenAiSpeechProvider('gpt-4o-mini-tts', {
      config: {
        format: 'pcm',
      },
    });

    const result = await provider.callApi('Short utterance');

    expect(result.audio?.format).toBe('pcm16');
    expect(result.audio?.sampleRate).toBe(24000);
    expect(result.audio?.channels).toBe(1);
    expect(result.audio?.duration).toBeCloseTo(2 / 24000, 10);
    expect(result.cost).toBeCloseTo(0.0000138, 10);
    expect(result.metadata?.costEstimated).toBe(true);
    expect(result.metadata?.usage).toEqual({
      type: 'estimated_tokens',
      input_tokens: 3,
      input_token_details: {
        text_tokens: 3,
      },
      output_tokens: 0,
      output_token_details: {
        text_tokens: 0,
        audio_tokens: 1,
      },
    });
  });

  it('should surface API errors with HTTP metadata', async () => {
    vi.mocked(fetchWithProxy).mockResolvedValue(
      new Response(JSON.stringify({ error: { message: 'bad request' } }), {
        status: 400,
        statusText: 'Bad Request',
        headers: {
          'content-type': 'application/json',
        },
      }),
    );

    const provider = new OpenAiSpeechProvider('gpt-4o-mini-tts');
    const result = await provider.callApi('Bad request example');

    expect(result.error).toContain('API error: 400 Bad Request');
    expect(result.metadata?.http).toEqual({
      status: 400,
      statusText: 'Bad Request',
      headers: {
        'content-type': 'application/json',
      },
    });
  });

  it('should accept current gpt-4o-mini-tts snapshot aliases', () => {
    const provider = new OpenAiSpeechProvider('gpt-4o-mini-tts-2025-12-15');

    expect(provider.id()).toBe('openai:speech:gpt-4o-mini-tts-2025-12-15');
  });

  it('should estimate cost for current gpt-4o-mini-tts snapshot aliases', async () => {
    vi.mocked(fetchWithProxy).mockResolvedValue(
      new Response(Uint8Array.from([5, 6, 7, 8]), {
        status: 200,
      }),
    );

    const provider = new OpenAiSpeechProvider('gpt-4o-mini-tts-2025-12-15', {
      config: {
        format: 'pcm',
      },
    });

    const result = await provider.callApi('Short utterance');

    expect(result.cost).toBeCloseTo(0.0000138, 10);
    expect(result.metadata?.costEstimated).toBe(true);
  });
});
