import logger from '../../logger';
import {
  type GenAISpanContext,
  type GenAISpanResult,
  withGenAISpan,
} from '../../tracing/genaiTracer';
import { fetchWithProxy } from '../../util/fetch/index';
import { getPcm16DurationSeconds, parseWavToPcm16 } from '../audio/wav';
import { REQUEST_TIMEOUT_MS } from '../shared';
import { OpenAiGenericProvider } from './';
import { calculateOpenAICost } from './util';

import type { EnvOverrides } from '../../types/env';
import type {
  CallApiContextParams,
  CallApiOptionsParams,
  ProviderResponse,
} from '../../types/index';
import type { OpenAiSharedOptions } from './types';

export interface OpenAiSpeechOptions extends OpenAiSharedOptions {
  voice?:
    | 'alloy'
    | 'ash'
    | 'ballad'
    | 'coral'
    | 'echo'
    | 'fable'
    | 'nova'
    | 'onyx'
    | 'sage'
    | 'shimmer'
    | 'verse'
    | 'cedar'
    | 'marin';
  format?: 'mp3' | 'opus' | 'aac' | 'flac' | 'wav' | 'pcm';
  speed?: number;
  instructions?: string;
}

const KNOWN_OPENAI_SPEECH_MODELS = [
  'gpt-4o-mini-tts',
  'gpt-4o-mini-tts-2025-12-15',
  'gpt-4o-mini-tts-2025-03-20',
  'tts-1',
  'tts-1-hd',
];
const DEFAULT_AUDIO_SAMPLE_RATE = 24000;
const ESTIMATED_AUDIO_OUTPUT_TOKENS_PER_SECOND: Record<string, number> = {
  // OpenAI pricing lists gpt-4o-mini-tts at roughly $0.015/minute, which is about 20.83
  // audio output tokens per second at the published $12 / 1M audio-token rate.
  'gpt-4o-mini-tts': 20.8333333333,
  'gpt-4o-mini-tts-2025-12-15': 20.8333333333,
  'gpt-4o-mini-tts-2025-03-20': 20.8333333333,
};

function normalizeAudioFormat(
  format?: OpenAiSpeechOptions['format'],
): NonNullable<ProviderResponse['audio']>['format'] {
  return format === 'pcm' ? 'pcm16' : (format ?? 'wav');
}

function estimateTokenCount(text: string): number {
  if (!text.trim()) {
    return 0;
  }

  return Math.ceil(
    text
      .trim()
      .split(/\s+/)
      .filter((word) => word.length > 0).length * 1.3,
  );
}

function getAudioDurationSeconds(audioBuffer: Buffer, format?: string): number | undefined {
  try {
    if (format === 'pcm16') {
      return getPcm16DurationSeconds(audioBuffer, DEFAULT_AUDIO_SAMPLE_RATE);
    }

    if (format === 'wav') {
      return parseWavToPcm16(audioBuffer).durationSeconds;
    }
  } catch (error) {
    logger.debug('[OpenAI Speech] Failed to inspect audio duration', { error, format });
  }

  return undefined;
}

function estimateSpeechUsageAndCost(
  modelName: string,
  config: OpenAiSpeechOptions,
  prompt: string,
  audioBuffer: Buffer,
  resolvedFormat?: string,
) {
  const promptTokens = estimateTokenCount(prompt);
  const durationSeconds = getAudioDurationSeconds(audioBuffer, resolvedFormat);
  const estimatedAudioTokensPerSecond = ESTIMATED_AUDIO_OUTPUT_TOKENS_PER_SECOND[modelName];
  const estimatedAudioOutputTokens =
    durationSeconds !== undefined && estimatedAudioTokensPerSecond !== undefined
      ? Math.max(1, Math.round(durationSeconds * estimatedAudioTokensPerSecond))
      : undefined;

  const cost =
    typeof estimatedAudioOutputTokens === 'number'
      ? calculateOpenAICost(modelName, config, promptTokens, 0, 0, estimatedAudioOutputTokens)
      : undefined;

  return {
    cost,
    durationSeconds,
    usage:
      durationSeconds !== undefined || promptTokens > 0
        ? {
            type: 'estimated_tokens',
            input_tokens: promptTokens,
            input_token_details: {
              text_tokens: promptTokens,
            },
            output_tokens: 0,
            output_token_details:
              typeof estimatedAudioOutputTokens === 'number'
                ? {
                    text_tokens: 0,
                    audio_tokens: estimatedAudioOutputTokens,
                  }
                : {
                    text_tokens: 0,
                  },
          }
        : undefined,
  };
}

export class OpenAiSpeechProvider extends OpenAiGenericProvider {
  static OPENAI_SPEECH_MODEL_NAMES = KNOWN_OPENAI_SPEECH_MODELS;

  config: OpenAiSpeechOptions;

  constructor(
    modelName: string,
    options: { config?: OpenAiSpeechOptions; id?: string; env?: EnvOverrides } = {},
  ) {
    if (!OpenAiSpeechProvider.OPENAI_SPEECH_MODEL_NAMES.includes(modelName)) {
      logger.debug(`Using unknown speech model: ${modelName}`);
    }
    super(modelName, options);
    this.config = options.config || {};
  }

  id(): string {
    return `openai:speech:${this.modelName}`;
  }

  toString(): string {
    return `[OpenAI Speech Provider ${this.modelName}]`;
  }

  async callApi(
    prompt: string,
    context?: CallApiContextParams,
    _callApiOptions?: CallApiOptionsParams,
  ): Promise<ProviderResponse> {
    const config = {
      ...this.config,
      ...context?.prompt?.config,
    } as OpenAiSpeechOptions;

    const spanContext: GenAISpanContext = {
      system: 'openai',
      operationName: 'completion',
      model: this.modelName,
      providerId: this.id(),
      evalId: context?.evaluationId || context?.test?.metadata?.evaluationId,
      testIndex: context?.test?.vars?.__testIdx as number | undefined,
      promptLabel: context?.prompt?.label,
      traceparent: context?.traceparent,
      requestBody: prompt,
    };

    const resultExtractor = (response: ProviderResponse): GenAISpanResult => ({
      responseBody: typeof response.output === 'string' ? response.output : undefined,
      additionalAttributes: {
        'promptfoo.audio.voice': config.voice || 'alloy',
        ...(response.audio?.format ? { 'promptfoo.audio.format': response.audio.format } : {}),
      },
    });

    return withGenAISpan(spanContext, () => this.callApiInternal(prompt, config), resultExtractor);
  }

  private async callApiInternal(
    prompt: string,
    config: OpenAiSpeechOptions,
  ): Promise<ProviderResponse> {
    if (!this.getApiKey()) {
      throw new Error(
        'OpenAI API key is not set. Set the OPENAI_API_KEY environment variable or add `apiKey` to the provider config.',
      );
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const body = {
        model: this.modelName,
        input: prompt,
        voice: config.voice || 'alloy',
        response_format: config.format || 'wav',
        ...(config.speed === undefined ? {} : { speed: config.speed }),
        ...(config.instructions ? { instructions: config.instructions } : {}),
      };

      const response = await fetchWithProxy(`${this.getApiUrl()}/audio/speech`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.getApiKey()}`,
          ...(this.getOrganization() ? { 'OpenAI-Organization': this.getOrganization() } : {}),
          ...config.headers,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      const headers = Object.fromEntries(response.headers.entries());

      if (!response.ok) {
        const errorBody = await response.text();
        return {
          error: `API error: ${response.status} ${response.statusText}\n${errorBody}`,
          metadata: {
            http: {
              status: response.status,
              statusText: response.statusText,
              headers,
            },
          },
        };
      }

      const audioBuffer = Buffer.from(await response.arrayBuffer());
      const resolvedFormat = normalizeAudioFormat(config.format);
      const { cost, durationSeconds, usage } = estimateSpeechUsageAndCost(
        this.modelName,
        config,
        prompt,
        audioBuffer,
        resolvedFormat,
      );

      return {
        output: prompt,
        cost,
        tokenUsage:
          usage && typeof usage.input_tokens === 'number'
            ? {
                prompt: usage.input_tokens,
                completion: 0,
                total: usage.input_tokens,
                numRequests: 1,
              }
            : undefined,
        audio: {
          data: audioBuffer.toString('base64'),
          format: resolvedFormat,
          transcript: prompt,
          sampleRate: DEFAULT_AUDIO_SAMPLE_RATE,
          channels: 1,
          ...(durationSeconds === undefined ? {} : { duration: durationSeconds }),
        },
        metadata: {
          model: this.modelName,
          voice: config.voice || 'alloy',
          ...(usage ? { usage } : {}),
          ...(durationSeconds === undefined ? {} : { duration: durationSeconds }),
          ...(cost === undefined ? {} : { costEstimated: true }),
          audio: {
            data: audioBuffer.toString('base64'),
            format: resolvedFormat,
            transcript: prompt,
            sampleRate: DEFAULT_AUDIO_SAMPLE_RATE,
            channels: 1,
            ...(durationSeconds === undefined ? {} : { duration: durationSeconds }),
          },
          http: {
            status: response.status,
            statusText: response.statusText,
            headers,
          },
        },
      };
    } catch (error) {
      logger.error('[OpenAI Speech] Request failed', { error });
      return {
        error: `Speech generation error: ${String(error)}`,
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}
