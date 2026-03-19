import logger from '../../logger';
import {
  type GenAISpanContext,
  type GenAISpanResult,
  withGenAISpan,
} from '../../tracing/genaiTracer';
import { fetchWithProxy } from '../../util/fetch/index';
import { REQUEST_TIMEOUT_MS } from '../shared';
import { OpenAiGenericProvider } from './';

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

const KNOWN_OPENAI_SPEECH_MODELS = ['gpt-4o-mini-tts', 'tts-1', 'tts-1-hd'];

function normalizeAudioFormat(
  format?: OpenAiSpeechOptions['format'],
): NonNullable<ProviderResponse['audio']>['format'] {
  return format === 'pcm' ? 'pcm16' : (format ?? 'wav');
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

      return {
        output: prompt,
        audio: {
          data: audioBuffer.toString('base64'),
          format: resolvedFormat,
          transcript: prompt,
        },
        metadata: {
          model: this.modelName,
          voice: config.voice || 'alloy',
          audio: {
            data: audioBuffer.toString('base64'),
            format: resolvedFormat,
            transcript: prompt,
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
