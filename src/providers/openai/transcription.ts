import fs from 'fs';
import path from 'path';

import { fetchWithCache } from '../../cache';
import logger from '../../logger';
import { REQUEST_TIMEOUT_MS } from '../shared';
import { OpenAiGenericProvider } from './';
import {
  calculateOpenAICostFromUsage,
  extractOpenAIUsageBreakdown,
  OPENAI_TRANSCRIPTION_MODELS,
} from './util';

import type { EnvOverrides } from '../../types/env';
import type {
  CallApiContextParams,
  CallApiOptionsParams,
  ProviderResponse,
} from '../../types/index';
import type { OpenAiSharedOptions } from './types';

export interface OpenAiTranscriptionOptions extends OpenAiSharedOptions {
  language?: string;
  prompt?: string;
  temperature?: number;
  timestamp_granularities?: ('word' | 'segment')[];
  chunking_strategy?: string | Record<string, any>;
  // Diarization options (for gpt-4o-transcribe-diarize)
  num_speakers?: number;
  speaker_labels?: string[];
}

function mapSpeakerLabel(
  speaker: string | undefined,
  speakerLabels: string[] | undefined,
): string | undefined {
  if (!speaker || !speakerLabels || speakerLabels.length === 0) {
    return speaker;
  }

  const normalizedSpeaker = speaker.trim();
  if (speakerLabels.includes(normalizedSpeaker)) {
    return normalizedSpeaker;
  }

  const indexedMatch = normalizedSpeaker.match(/(?:speaker\s*)?(\d+)/i);
  if (indexedMatch) {
    const label = speakerLabels[Number(indexedMatch[1]) - 1];
    if (label) {
      return label;
    }
  }

  const compactSpeaker = normalizedSpeaker.toUpperCase();
  if (/^[A-Z]$/.test(compactSpeaker)) {
    const label = speakerLabels[compactSpeaker.charCodeAt(0) - 65];
    if (label) {
      return label;
    }
  }

  return normalizedSpeaker;
}

export class OpenAiTranscriptionProvider extends OpenAiGenericProvider {
  static OPENAI_TRANSCRIPTION_MODEL_NAMES = OPENAI_TRANSCRIPTION_MODELS.map((model) => model.id);

  config: OpenAiTranscriptionOptions;

  constructor(
    modelName: string,
    options: { config?: OpenAiTranscriptionOptions; id?: string; env?: EnvOverrides } = {},
  ) {
    if (!OpenAiTranscriptionProvider.OPENAI_TRANSCRIPTION_MODEL_NAMES.includes(modelName)) {
      logger.debug(`Using unknown transcription model: ${modelName}`);
    }
    super(modelName, options);
    this.config = options.config || {};
  }

  id(): string {
    return `openai:transcription:${this.modelName}`;
  }

  toString(): string {
    return `[OpenAI Transcription Provider ${this.modelName}]`;
  }

  private calculateLegacyTranscriptionCost(durationSeconds: number): number | undefined {
    const model = OPENAI_TRANSCRIPTION_MODELS.find((m) => m.id === this.modelName);
    if (!model || !('perMinute' in (model.cost || {}))) {
      return undefined;
    }
    const durationMinutes = durationSeconds / 60;
    return durationMinutes * (model.cost as { perMinute: number }).perMinute;
  }

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: transcription request assembly is parameter-driven and intentionally linear
  async callApi(
    prompt: string,
    context?: CallApiContextParams,
    _callApiOptions?: CallApiOptionsParams,
  ): Promise<ProviderResponse> {
    if (!this.getApiKey()) {
      throw new Error(
        'OpenAI API key is not set. Set the OPENAI_API_KEY environment variable or add `apiKey` to the provider config.',
      );
    }

    const config = {
      ...this.config,
      ...context?.prompt?.config,
    } as OpenAiTranscriptionOptions;

    // The prompt should be a file path to an audio file
    const audioFilePath = prompt.trim();

    if (!fs.existsSync(audioFilePath)) {
      return {
        error: `Audio file not found: ${audioFilePath}`,
      };
    }

    try {
      // Read the audio file and create a File object for native FormData
      const fileBuffer = fs.readFileSync(audioFilePath);
      const fileName = path.basename(audioFilePath);
      const file = new File([fileBuffer], fileName);

      const formData = new FormData();
      formData.append('file', file);
      formData.append('model', this.modelName);

      // Add optional parameters
      if (config.language) {
        formData.append('language', config.language);
      }
      if (config.prompt) {
        formData.append('prompt', config.prompt);
      }
      if (config.temperature !== undefined) {
        formData.append('temperature', config.temperature.toString());
      }
      if (config.timestamp_granularities && config.timestamp_granularities.length > 0) {
        formData.append('timestamp_granularities', JSON.stringify(config.timestamp_granularities));
      }

      // Diarization-specific options (for gpt-4o-transcribe-diarize)
      if (this.modelName.includes('diarize')) {
        formData.append('response_format', 'diarized_json');
        formData.append(
          'chunking_strategy',
          typeof config.chunking_strategy === 'string'
            ? config.chunking_strategy
            : config.chunking_strategy
              ? JSON.stringify(config.chunking_strategy)
              : 'auto',
        );

        if (config.num_speakers !== undefined) {
          formData.append('num_speakers', config.num_speakers.toString());
        }
        if (config.speaker_labels && config.speaker_labels.length > 0) {
          formData.append('speaker_labels', JSON.stringify(config.speaker_labels));
        }
      } else {
        // Use json for gpt-4o models (verbose_json not supported), verbose_json for others
        const responseFormat = this.modelName.startsWith('gpt-4o-') ? 'json' : 'verbose_json';
        formData.append('response_format', responseFormat);
      }

      const headers = {
        Authorization: `Bearer ${this.getApiKey()}`,
        ...(this.getOrganization() ? { 'OpenAI-Organization': this.getOrganization() } : {}),
      };

      let data: any, status: number, statusText: string;
      let cached = false;

      try {
        ({ data, cached, status, statusText } = await fetchWithCache(
          `${this.getApiUrl()}/audio/transcriptions`,
          {
            method: 'POST',
            headers,
            body: formData,
          },
          REQUEST_TIMEOUT_MS,
          'json',
          context?.bustCache ?? context?.debug,
        ));

        if (status < 200 || status >= 300) {
          return {
            error: `API error: ${status} ${statusText}\n${typeof data === 'string' ? data : JSON.stringify(data)}`,
          };
        }
      } catch (err) {
        logger.error('API call error', { error: err });
        return {
          error: `API call error: ${String(err)}`,
        };
      }

      if (data.error) {
        return {
          error: typeof data.error === 'string' ? data.error : JSON.stringify(data.error),
        };
      }

      const durationSeconds = data.duration || 0;
      const usageBreakdown = extractOpenAIUsageBreakdown(data.usage);
      const cost = cached
        ? 0
        : (calculateOpenAICostFromUsage(this.modelName, config, data.usage) ??
          this.calculateLegacyTranscriptionCost(durationSeconds));

      // Calculate average quality metrics from segments
      const segments = data.segments || [];
      let avgLogprob: number | undefined;
      let avgCompressionRatio: number | undefined;
      let avgNoSpeechProb: number | undefined;

      if (segments.length > 0) {
        const validSegments = segments.filter(
          (s: any) =>
            s.avg_logprob !== undefined ||
            s.compression_ratio !== undefined ||
            s.no_speech_prob !== undefined,
        );

        if (validSegments.length > 0) {
          const sumLogprob = validSegments.reduce(
            (sum: number, s: any) => sum + (s.avg_logprob || 0),
            0,
          );
          const sumCompressionRatio = validSegments.reduce(
            (sum: number, s: any) => sum + (s.compression_ratio || 0),
            0,
          );
          const sumNoSpeechProb = validSegments.reduce(
            (sum: number, s: any) => sum + (s.no_speech_prob || 0),
            0,
          );

          avgLogprob = validSegments.some((s: any) => s.avg_logprob !== undefined)
            ? sumLogprob / validSegments.length
            : undefined;
          avgCompressionRatio = validSegments.some((s: any) => s.compression_ratio !== undefined)
            ? sumCompressionRatio / validSegments.length
            : undefined;
          avgNoSpeechProb = validSegments.some((s: any) => s.no_speech_prob !== undefined)
            ? sumNoSpeechProb / validSegments.length
            : undefined;
        }
      }

      // Format output based on response format
      let output: string;
      if (this.modelName.includes('diarize') && data.segments) {
        // Format diarized output with speaker labels
        output = data.segments
          .map((segment: any) => {
            const speaker = mapSpeakerLabel(segment.speaker, config.speaker_labels) || 'Unknown';
            const text = segment.text || '';
            const start = segment.start?.toFixed(2) || '0.00';
            const end = segment.end?.toFixed(2) || '0.00';
            return `[${start}s - ${end}s] ${speaker}: ${text}`;
          })
          .join('\n');
      } else if (data.text) {
        // Standard transcription
        output = data.text;
      } else {
        return {
          error: 'No transcription returned from API',
        };
      }

      return {
        output,
        cached,
        cost,
        tokenUsage: data.usage
          ? {
              prompt: data.usage.input_tokens || data.usage.prompt_tokens || 0,
              completion: data.usage.output_tokens || data.usage.completion_tokens || 0,
              total: data.usage.total_tokens || 0,
              numRequests: 1,
            }
          : undefined,
        metadata: {
          task: data.task,
          duration: durationSeconds,
          language: data.language,
          segments: data.segments?.length || 0,
          ...(data.usage ? { usage: data.usage } : {}),
          ...(usageBreakdown ? { usageBreakdown } : {}),
          ...(avgLogprob === undefined ? {} : { avgLogprob }),
          ...(avgCompressionRatio === undefined ? {} : { avgCompressionRatio }),
          ...(avgNoSpeechProb === undefined ? {} : { avgNoSpeechProb }),
          ...(this.modelName.includes('diarize') && data.speakers
            ? {
                speakers: data.speakers.map(
                  (speaker: string) => mapSpeakerLabel(speaker, config.speaker_labels) || speaker,
                ),
              }
            : {}),
        },
      };
    } catch (err) {
      logger.error('Transcription error', { error: err });
      return {
        error: `Transcription error: ${String(err)}`,
      };
    }
  }
}
