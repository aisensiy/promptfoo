import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TauVoiceProvider } from '../../src/providers/tauVoice';

import type { ApiProvider, ProviderResponse } from '../../src/types/index';

vi.mock('../../src/util/time', async (importOriginal) => ({
  ...(await importOriginal()),
  sleep: vi.fn().mockResolvedValue(undefined),
}));

describe('TauVoiceProvider', () => {
  let userProvider: ApiProvider;
  let ttsProvider: ApiProvider;
  let originalProvider: ApiProvider & {
    config: Record<string, any>;
  };

  beforeEach(() => {
    userProvider = {
      id: () => 'openai:chat:gpt-4.1-mini',
      callApi: vi
        .fn()
        .mockResolvedValueOnce({
          output: 'I need a direct flight to Seattle.',
          tokenUsage: { numRequests: 1 },
        })
        .mockResolvedValueOnce({
          output: '###STOP###',
          tokenUsage: { numRequests: 1 },
        }),
    };

    ttsProvider = {
      id: () => 'openai:speech:gpt-4o-mini-tts',
      callApi: vi.fn().mockImplementation(async (prompt: string) => ({
        output: prompt,
        audio: {
          data: Buffer.from(`audio:${prompt}`).toString('base64'),
          format: 'wav',
          transcript: prompt,
        },
      })),
    };

    originalProvider = {
      id: () => 'openai:realtime:gpt-realtime',
      config: {},
      cleanup: vi.fn(async () => undefined) as ApiProvider['cleanup'],
      callApi: vi.fn().mockImplementation(
        async (_prompt: string, context?: any): Promise<ProviderResponse> => ({
          output: 'I found a direct morning option.',
          audio: {
            data: Buffer.from('assistant-audio').toString('base64'),
            format: 'wav',
            transcript: 'I found a direct morning option.',
          },
          metadata: {
            outputTranscript: 'I found a direct morning option.',
            eventCounts: {
              'response.output_audio.delta': 1,
            },
            functionCalls: [
              {
                id: 'call_1',
                name: 'search_flights',
              },
            ],
            conversationId: context?.test?.metadata?.conversationId,
          },
          tokenUsage: { numRequests: 1 },
        }),
      ),
    };
  });

  it('should run a Tau-style voice loop and collect metadata', async () => {
    const provider = new TauVoiceProvider({
      config: {
        instructions: '{{instructions}}',
        maxTurns: 4,
        _resolvedUserProvider: userProvider,
        _resolvedTtsProvider: ttsProvider,
      },
    });

    const result = await provider.callApi('ignored', {
      originalProvider,
      vars: {
        instructions: 'You are a traveler who wants the cheapest direct morning flight to Seattle.',
      },
      prompt: {
        raw: 'You are an airline booking agent.',
        display: 'You are an airline booking agent.',
        label: 'agent',
      },
      test: {
        metadata: {},
      },
    });

    expect(result.output).toContain('User: I need a direct flight to Seattle.');
    expect(result.output).toContain('Assistant: I found a direct morning option.');
    expect(result.metadata?.stopReason).toBe('simulated_user_stop');
    expect(result.metadata?.voiceTurns).toHaveLength(1);
    expect(result.metadata?.messages).toEqual([
      { role: 'user', content: 'I need a direct flight to Seattle.' },
      { role: 'assistant', content: 'I found a direct morning option.' },
    ]);

    expect(ttsProvider.callApi).toHaveBeenCalledWith(
      'I need a direct flight to Seattle.',
      expect.anything(),
      undefined,
    );

    const [audioPrompt, targetContext] = vi.mocked(originalProvider.callApi).mock.calls[0];
    const parsedAudioPrompt = JSON.parse(audioPrompt as string);
    expect(parsedAudioPrompt).toEqual({
      type: 'audio_input',
      audio: {
        data: Buffer.from('audio:I need a direct flight to Seattle.').toString('base64'),
        format: 'wav',
      },
      transcript: 'I need a direct flight to Seattle.',
    });
    expect(targetContext?.prompt?.config?.instructions).toBe('You are an airline booking agent.');

    expect(result.metadata?.voiceTurns[0]).toEqual(
      expect.objectContaining({
        turn: 1,
        user: expect.objectContaining({
          text: 'I need a direct flight to Seattle.',
          providerId: 'openai:chat:gpt-4.1-mini',
          ttsProviderId: 'openai:speech:gpt-4o-mini-tts',
        }),
        assistant: expect.objectContaining({
          text: 'I found a direct morning option.',
          providerId: 'openai:realtime:gpt-realtime',
          eventCounts: {
            'response.output_audio.delta': 1,
          },
        }),
      }),
    );
  });

  it('should reuse one conversation id across turns and clean up the target provider', async () => {
    userProvider = {
      id: () => 'openai:chat:gpt-4.1-mini',
      callApi: vi
        .fn()
        .mockResolvedValueOnce({ output: 'First user turn' })
        .mockResolvedValueOnce({ output: 'Second user turn' })
        .mockResolvedValueOnce({ output: '###STOP###' }),
    };

    originalProvider.callApi = vi
      .fn()
      .mockResolvedValueOnce({
        output: 'First assistant turn',
        audio: {
          data: Buffer.from('assistant-audio-1').toString('base64'),
          format: 'wav',
          transcript: 'First assistant turn',
        },
      })
      .mockResolvedValueOnce({
        output: 'Second assistant turn',
        audio: {
          data: Buffer.from('assistant-audio-2').toString('base64'),
          format: 'wav',
          transcript: 'Second assistant turn',
        },
      });

    originalProvider.config.instructions = 'Follow airline policy.';

    const provider = new TauVoiceProvider({
      config: {
        maxTurns: 5,
        _resolvedUserProvider: userProvider,
        _resolvedTtsProvider: ttsProvider,
      },
    });

    await provider.callApi('ignored', {
      originalProvider,
      vars: { instructions: 'Handle a two-turn travel inquiry.' },
      prompt: {
        raw: 'You are a voice airline assistant.',
        display: 'You are a voice airline assistant.',
        label: 'agent',
      },
      test: {
        metadata: {},
      },
    });

    const callContexts = vi
      .mocked(originalProvider.callApi)
      .mock.calls.map(([, context]) => context?.test?.metadata?.conversationId);
    expect(callContexts[0]).toBeDefined();
    expect(callContexts[0]).toBe(callContexts[1]);
    const callInstructions = vi
      .mocked(originalProvider.callApi)
      .mock.calls.map(([, context]) => context?.prompt?.config?.instructions);
    expect(callInstructions[0]).toBe(
      'Follow airline policy.\n\nYou are a voice airline assistant.',
    );
    expect(callInstructions[1]).toBe(
      'Follow airline policy.\n\nYou are a voice airline assistant.',
    );
    expect(originalProvider.cleanup).toHaveBeenCalledTimes(1);
    expect(originalProvider.config.instructions).toBe('Follow airline policy.');
  });

  it('should seed initial messages before generating the first user turn', async () => {
    userProvider = {
      id: () => 'openai:chat:gpt-4.1-mini',
      callApi: vi
        .fn()
        .mockResolvedValueOnce({ output: 'My traveler ID is mia_li_3668.' })
        .mockResolvedValueOnce({ output: '###STOP###' }),
    };

    const provider = new TauVoiceProvider({
      config: {
        maxTurns: 2,
        initialMessages: [
          {
            role: 'assistant',
            content: 'Welcome to Promptfoo Air. What trip can I help with today?',
          },
        ],
        _resolvedUserProvider: userProvider,
        _resolvedTtsProvider: ttsProvider,
      },
    });

    const result = await provider.callApi('ignored', {
      originalProvider,
      vars: { instructions: 'Share your traveler ID first.' },
      prompt: {
        raw: 'You are a voice airline assistant.',
        display: 'You are a voice airline assistant.',
        label: 'agent',
      },
      test: {
        metadata: {},
      },
    });

    const seededMessages = JSON.parse(vi.mocked(userProvider.callApi).mock.calls[0][0] as string);
    expect(seededMessages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'assistant',
          content: 'Welcome to Promptfoo Air. What trip can I help with today?',
        }),
      ]),
    );
    expect(result.output).toContain(
      'Assistant: Welcome to Promptfoo Air. What trip can I help with today?',
    );
    expect(result.output).toContain('User: My traveler ID is mia_li_3668.');
  });
});
