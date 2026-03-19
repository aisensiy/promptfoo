import logger from '../logger';
import { type GenAISpanContext, type GenAISpanResult, withGenAISpan } from '../tracing/genaiTracer';
import { maybeLoadConfigFromExternalFile } from '../util/file';
import invariant from '../util/invariant';
import { safeJsonStringify } from '../util/json';
import { getNunjucksEngine } from '../util/templates';
import { sleep } from '../util/time';
import { accumulateResponseTokenUsage, createEmptyTokenUsage } from '../util/tokenUsageUtils';
import { type AudioOutput, type AudioProviderResponse, createUnifiedAudioProvider } from './audio';
import { OpenAiSpeechProvider } from './openai/speech';
import { buildTauUserMessages, formatTauConversation, type TauMessage } from './tauShared';

import type {
  ApiProvider,
  CallApiContextParams,
  CallApiOptionsParams,
  ProviderOptions,
  ProviderResponse,
  TokenUsage,
} from '../types/index';

export interface TauVoiceTurn {
  turn: number;
  user: {
    text: string;
    transcript?: string;
    providerId: string;
    ttsProviderId?: string;
    audio?: AudioOutput;
  };
  assistant: {
    text: string;
    transcript?: string;
    providerId: string;
    audio?: AudioOutput;
    eventCounts?: Record<string, number>;
    functionCalls?: Array<Record<string, any>>;
    sessionId?: string;
  };
  userLatencyMs?: number;
  ttsLatencyMs?: number;
  targetLatencyMs?: number;
}

type TauVoiceConfig = {
  userProvider?: string | ProviderOptions | ApiProvider;
  ttsProvider?: string | ProviderOptions | ApiProvider;
  instructions?: string;
  maxTurns?: number;
  initialMessages?: TauMessage[] | string;
  voice?: OpenAiSpeechProvider['config']['voice'];
  ttsFormat?: 'wav' | 'pcm' | 'mp3' | 'opus' | 'aac' | 'flac';
  _resolvedUserProvider?: ApiProvider;
  _resolvedTtsProvider?: ApiProvider;
};

type TauVoiceProviderOptions = ProviderOptions & {
  config?: TauVoiceConfig;
};

export class TauVoiceProvider implements ApiProvider {
  private readonly identifier: string;
  private readonly maxTurns: number;
  private readonly rawInstructions: string;
  private readonly resolvedUserProvider?: ApiProvider;
  private readonly resolvedTtsProvider?: ApiProvider;
  private readonly configInitialMessages?: TauMessage[] | string;
  private readonly defaultVoice?: TauVoiceConfig['voice'];
  private readonly defaultTtsFormat?: TauVoiceConfig['ttsFormat'];

  constructor({ id, label, config = {} }: TauVoiceProviderOptions) {
    this.identifier = id ?? label ?? 'promptfoo:tau-voice';
    this.maxTurns = config.maxTurns ?? 10;
    this.rawInstructions = config.instructions || '{{instructions}}';
    this.resolvedUserProvider = config._resolvedUserProvider;
    this.resolvedTtsProvider = config._resolvedTtsProvider;
    this.configInitialMessages = config.initialMessages;
    this.defaultVoice = config.voice;
    this.defaultTtsFormat = config.ttsFormat;
  }

  id(): string {
    return this.identifier;
  }

  private buildDefaultTtsProvider(): ApiProvider {
    return new OpenAiSpeechProvider('gpt-4o-mini-tts', {
      config: {
        voice: this.defaultVoice || 'alloy',
        format: this.defaultTtsFormat || 'pcm',
      },
    });
  }

  private extractText(output: unknown): string {
    if (typeof output === 'string') {
      return output;
    }
    return safeJsonStringify(output) || '';
  }

  private extractAudio(
    response: AudioProviderResponse | ProviderResponse,
  ): AudioOutput | undefined {
    const audio = response.audio || response.metadata?.audio;
    if (!audio?.data) {
      return undefined;
    }

    return {
      data: audio.data,
      format: audio.format || 'wav',
      transcript: audio.transcript || (typeof response.output === 'string' ? response.output : ''),
      sampleRate: audio.sampleRate,
      duration: audio.duration,
    };
  }

  private isValidMessage(message: unknown): message is TauMessage {
    return (
      !!message &&
      typeof message === 'object' &&
      typeof (message as TauMessage).content === 'string' &&
      ((message as TauMessage).role === 'user' ||
        (message as TauMessage).role === 'assistant' ||
        (message as TauMessage).role === 'system')
    );
  }

  private renderTemplate(template: unknown, vars: Record<string, any> | undefined): unknown {
    if (typeof template !== 'string') {
      return template;
    }

    try {
      return getNunjucksEngine().renderString(template, vars || {});
    } catch (error) {
      logger.warn(
        `[TauVoice] Failed to render template: ${template.substring(0, 100)}. Error: ${error instanceof Error ? error.message : error}`,
      );
      return template;
    }
  }

  private resolveInitialMessages(initialMessages: TauMessage[] | string | undefined): TauMessage[] {
    if (!initialMessages) {
      return [];
    }

    if (Array.isArray(initialMessages)) {
      return initialMessages;
    }

    if (!initialMessages.startsWith('file://')) {
      logger.warn(
        `[TauVoice] initialMessages is a string but could not be resolved: ${initialMessages.substring(0, 200)}`,
      );
      return [];
    }

    try {
      const resolved = maybeLoadConfigFromExternalFile(initialMessages);
      if (Array.isArray(resolved)) {
        return resolved;
      }
      logger.warn(
        `[TauVoice] Expected array of messages from file, got: ${typeof resolved}. Value: ${JSON.stringify(resolved).substring(0, 200)}`,
      );
    } catch (error) {
      logger.warn(
        `[TauVoice] Failed to load initialMessages from file: ${error instanceof Error ? error.message : error}`,
      );
    }

    return [];
  }

  private getRenderedInitialMessages(vars: Record<string, any> | undefined): TauMessage[] {
    return this.resolveInitialMessages(this.configInitialMessages)
      .map((message) => ({
        role: this.renderTemplate(message.role, vars),
        content: this.renderTemplate(message.content, vars),
      }))
      .filter((message): message is TauMessage => {
        if (this.isValidMessage(message)) {
          return true;
        }

        logger.warn(
          `[TauVoice] Invalid initial message, skipping: ${JSON.stringify(message).substring(0, 100)}`,
        );
        return false;
      });
  }

  private buildTargetContext(
    context: CallApiContextParams,
    conversationId: string,
    instructions: string,
  ): CallApiContextParams {
    return {
      ...context,
      originalProvider: undefined,
      prompt: {
        ...context.prompt,
        config: {
          ...(context.prompt.config || {}),
          instructions,
        },
      },
      vars: {
        ...context.vars,
        conversationId,
      },
      test: context.test
        ? {
            ...context.test,
            metadata: {
              ...(context.test.metadata || {}),
              conversationId,
            },
          }
        : undefined,
    };
  }

  private buildTtsContext(context?: CallApiContextParams): CallApiContextParams | undefined {
    if (!context) {
      return undefined;
    }

    return {
      ...context,
      originalProvider: undefined,
    };
  }

  private async generateUserMessage(
    messages: TauMessage[],
    instructions: string,
    context?: CallApiContextParams,
  ): Promise<{ message: string; tokenUsage?: TokenUsage; error?: string }> {
    invariant(this.resolvedUserProvider, 'Tau Voice requires a local userProvider');

    const localContext = context
      ? {
          ...context,
          originalProvider: undefined,
        }
      : undefined;

    const response = await this.resolvedUserProvider.callApi(
      JSON.stringify(buildTauUserMessages(instructions, messages)),
      localContext,
    );

    if (response.error) {
      return { message: '', error: response.error };
    }

    return {
      message: this.extractText(response.output),
      tokenUsage: response.tokenUsage,
    };
  }

  private buildMetadata(
    conversationId: string,
    objective: string,
    targetPrompt: string,
    messages: TauMessage[],
    voiceTurns: TauVoiceTurn[],
    stopReason: string,
    finalAssistantTranscript?: string,
  ): NonNullable<ProviderResponse['metadata']> {
    return {
      conversationId,
      objective,
      targetPrompt,
      transcript: formatTauConversation(messages),
      messages,
      voiceTurns,
      stopReason,
      ...(finalAssistantTranscript ? { finalAssistantTranscript } : {}),
    };
  }

  private buildErrorResponse(
    error: string,
    tokenUsage: TokenUsage,
    conversationId: string,
    objective: string,
    targetPrompt: string,
    messages: TauMessage[],
    voiceTurns: TauVoiceTurn[],
    stopReason: string,
  ): ProviderResponse {
    return {
      error,
      tokenUsage,
      metadata: this.buildMetadata(
        conversationId,
        objective,
        targetPrompt,
        messages,
        voiceTurns,
        stopReason,
      ),
    };
  }

  private async executeVoiceTurn({
    context,
    conversationId,
    objective,
    targetPrompt,
    messages,
    voiceTurns,
    tokenUsage,
    userProvider,
    userText,
    userLatencyMs,
    ttsProvider,
    ttsAudioProvider,
    targetProvider,
    targetAudioProvider,
    targetInstructions,
    turn,
  }: {
    context: CallApiContextParams;
    conversationId: string;
    objective: string;
    targetPrompt: string;
    messages: TauMessage[];
    voiceTurns: TauVoiceTurn[];
    tokenUsage: TokenUsage;
    userProvider: ApiProvider;
    userText: string;
    userLatencyMs: number;
    ttsProvider: ApiProvider;
    ttsAudioProvider: ReturnType<typeof createUnifiedAudioProvider>;
    targetProvider: ApiProvider;
    targetAudioProvider: ReturnType<typeof createUnifiedAudioProvider>;
    targetInstructions: string;
    turn: number;
  }): Promise<
    | {
        ttsResponse: AudioProviderResponse;
        targetResponse: AudioProviderResponse;
        assistantText: string;
        voiceTurn: TauVoiceTurn;
      }
    | { errorResponse: ProviderResponse }
  > {
    const ttsStart = Date.now();
    const ttsResponse = await ttsAudioProvider.callTextToAudioApi(
      userText,
      this.buildTtsContext(context),
    );
    const ttsLatencyMs = Date.now() - ttsStart;

    if (ttsResponse.error) {
      return {
        errorResponse: this.buildErrorResponse(
          ttsResponse.error,
          tokenUsage,
          conversationId,
          objective,
          targetPrompt,
          messages,
          voiceTurns,
          'tts_error',
        ),
      };
    }

    const userAudio = this.extractAudio(ttsResponse);
    if (!userAudio?.data) {
      return {
        errorResponse: this.buildErrorResponse(
          'Tau Voice TTS provider did not return audio output',
          tokenUsage,
          conversationId,
          objective,
          targetPrompt,
          messages,
          voiceTurns,
          'tts_missing_audio',
        ),
      };
    }

    const targetContext = this.buildTargetContext(context, conversationId, targetInstructions);
    const targetStart = Date.now();
    const targetResponse = await targetAudioProvider.callAudioApi(
      {
        data: userAudio.data,
        format: userAudio.format,
        transcript: userText,
      },
      targetContext,
    );
    const targetLatencyMs = Date.now() - targetStart;

    if (targetResponse.error) {
      return {
        errorResponse: this.buildErrorResponse(
          targetResponse.error,
          tokenUsage,
          conversationId,
          objective,
          targetPrompt,
          messages,
          voiceTurns,
          'target_error',
        ),
      };
    }

    const assistantAudio = this.extractAudio(targetResponse);
    const assistantText =
      assistantAudio?.transcript ||
      (typeof targetResponse.output === 'string' ? targetResponse.output : '') ||
      targetResponse.metadata?.outputTranscript ||
      '';

    return {
      ttsResponse,
      targetResponse,
      assistantText,
      voiceTurn: {
        turn,
        user: {
          text: userText,
          transcript: userAudio.transcript || userText,
          providerId: userProvider.id(),
          ttsProviderId: ttsProvider.id(),
          audio: userAudio,
        },
        assistant: {
          text: assistantText,
          transcript: assistantAudio?.transcript || assistantText,
          providerId: targetProvider.id(),
          audio: assistantAudio,
          eventCounts: targetResponse.metadata?.eventCounts,
          functionCalls: targetResponse.metadata?.functionCalls,
          sessionId: targetResponse.sessionId || targetResponse.metadata?.sessionId,
        },
        userLatencyMs,
        ttsLatencyMs,
        targetLatencyMs,
      },
    };
  }

  async callApi(
    _prompt: string,
    context?: CallApiContextParams,
    _callApiOptions?: CallApiOptionsParams,
  ): Promise<ProviderResponse> {
    invariant(context?.originalProvider, 'Expected originalProvider to be set');
    invariant(context?.prompt?.raw, 'Expected context.prompt.raw to be set');
    invariant(this.resolvedUserProvider, 'Tau Voice requires a local userProvider');

    const spanContext: GenAISpanContext = {
      system: 'promptfoo',
      operationName: 'chat',
      model: 'tau-voice',
      providerId: this.id(),
      evalId: context.evaluationId || context.test?.metadata?.evaluationId,
      testIndex: context.test?.vars?.__testIdx as number | undefined,
      promptLabel: context.prompt.label,
      traceparent: context.traceparent,
      requestBody:
        safeJsonStringify({
          instructions: context.vars?.instructions,
          targetPrompt: context.prompt.raw,
        }) || undefined,
    };

    const resultExtractor = (response: ProviderResponse): GenAISpanResult => ({
      tokenUsage: response.tokenUsage,
      responseBody: typeof response.output === 'string' ? response.output : undefined,
      additionalAttributes: {
        ...(response.metadata?.conversationId
          ? { 'promptfoo.tau_voice.conversation_id': response.metadata.conversationId }
          : {}),
        ...(response.metadata?.stopReason
          ? { 'promptfoo.tau_voice.stop_reason': response.metadata.stopReason }
          : {}),
        ...(Array.isArray(response.metadata?.voiceTurns)
          ? { 'promptfoo.tau_voice.turn_count': response.metadata.voiceTurns.length }
          : {}),
      },
    });

    return withGenAISpan(
      spanContext,
      async () => {
        const targetProvider = context.originalProvider!;
        const userProvider = this.resolvedUserProvider!;
        const targetAudioProvider = createUnifiedAudioProvider(targetProvider);
        const ttsProvider = this.resolvedTtsProvider || this.buildDefaultTtsProvider();
        const ttsAudioProvider = createUnifiedAudioProvider(ttsProvider);
        const conversationId = `tau-voice-${crypto.randomUUID()}`;
        const instructions = getNunjucksEngine().renderString(this.rawInstructions, context.vars);
        const messages = this.getRenderedInitialMessages(context.vars);
        const voiceTurns: TauVoiceTurn[] = [];
        const tokenUsage = createEmptyTokenUsage();
        const renderedTargetPrompt = getNunjucksEngine().renderString(
          context.prompt.raw,
          context.vars,
        );
        const targetInstructions = [targetProvider.config?.instructions, renderedTargetPrompt]
          .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
          .join('\n\n');

        let stopReason = 'max_turns_reached';
        let finalTargetResponse: ProviderResponse | undefined;

        try {
          for (let turn = 0; turn < this.maxTurns; turn++) {
            logger.debug('[TauVoice] Starting turn', {
              turn: turn + 1,
              conversationId,
            });

            const userStart = Date.now();
            const userResult = await this.generateUserMessage(messages, instructions, context);
            const userLatencyMs = Date.now() - userStart;
            if (userResult.error) {
              return this.buildErrorResponse(
                userResult.error,
                tokenUsage,
                conversationId,
                instructions,
                renderedTargetPrompt,
                messages,
                voiceTurns,
                'user_provider_error',
              );
            }

            accumulateResponseTokenUsage(tokenUsage, { tokenUsage: userResult.tokenUsage });
            const userText = userResult.message;

            if (userText.includes('###STOP###')) {
              stopReason = 'simulated_user_stop';
              break;
            }

            messages.push({ role: 'user', content: userText });
            const turnResult = await this.executeVoiceTurn({
              context,
              conversationId,
              objective: instructions,
              targetPrompt: renderedTargetPrompt,
              messages,
              voiceTurns,
              tokenUsage,
              userProvider,
              userText,
              userLatencyMs,
              ttsProvider,
              ttsAudioProvider,
              targetProvider,
              targetAudioProvider,
              targetInstructions,
              turn: turn + 1,
            });
            if ('errorResponse' in turnResult) {
              return turnResult.errorResponse;
            }

            accumulateResponseTokenUsage(tokenUsage, turnResult.ttsResponse);
            accumulateResponseTokenUsage(tokenUsage, turnResult.targetResponse);
            finalTargetResponse = turnResult.targetResponse;
            messages.push({ role: 'assistant', content: turnResult.assistantText });
            voiceTurns.push(turnResult.voiceTurn);

            if (targetProvider.delay) {
              await sleep(targetProvider.delay);
            }

            if (turnResult.targetResponse.conversationEnded) {
              stopReason =
                turnResult.targetResponse.conversationEndReason || 'target_conversation_ended';
              break;
            }
          }

          const transcript = formatTauConversation(messages);
          const finalAssistantMessage = [...messages]
            .reverse()
            .find((message) => message.role === 'assistant');
          return {
            output: transcript,
            tokenUsage,
            metadata: this.buildMetadata(
              conversationId,
              instructions,
              renderedTargetPrompt,
              messages,
              voiceTurns,
              stopReason,
              finalAssistantMessage?.content,
            ),
            guardrails: finalTargetResponse?.guardrails,
            audio: finalTargetResponse?.audio,
          };
        } finally {
          await targetProvider.cleanup?.();
        }
      },
      resultExtractor,
    );
  }
}
