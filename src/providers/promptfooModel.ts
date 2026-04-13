import { cloudConfig } from '../globalConfig/cloud';
import logger from '../logger';
import { fetchWithProxy } from '../util/fetch/index';

import type {
  ApiProvider,
  CallApiContextParams,
  CallApiOptionsParams,
  ProviderOptions,
  ProviderResponse,
} from '../types/providers';

// Define types for the expected model API response structure
interface ModelMessage {
  role: string;
  content: string;
  refusal?: string | null;
}

interface ModelChoice {
  index: number;
  message: ModelMessage;
  finish_reason: string;
  native_finish_reason?: string;
  logprobs?: any | null;
}

interface ModelUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  prompt_tokens_details?: {
    cached_tokens?: number;
  };
  completion_tokens_details?: {
    reasoning_tokens?: number;
  };
}

interface ModelApiResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  provider?: string;
  choices: ModelChoice[];
  usage: ModelUsage;
  system_fingerprint?: string;
}

interface PromptfooModelOptions extends ProviderOptions {
  model: string;
  config?: Record<string, any>;
}

const SAFE_FINISH_REASONS = new Set([
  'stop',
  'length',
  'tool_calls',
  'content_filter',
  'function_call',
]);

function getErrorLogMetadata(error: unknown) {
  if (error instanceof Error) {
    return {
      errorType: error.constructor.name,
      errorMessageLength: error.message.length,
    };
  }

  return { errorType: typeof error };
}

function getUrlLogMetadata(url: string) {
  try {
    const parsedUrl = new URL(url);
    return {
      urlParseable: true,
      urlProtocol: parsedUrl.protocol,
      urlHost: parsedUrl.host,
      urlPathLength: parsedUrl.pathname.length,
      urlHasQuery: parsedUrl.search.length > 0,
    };
  } catch {
    return { urlParseable: false };
  }
}

function getSafeFinishReason(finishReason: unknown) {
  if (typeof finishReason !== 'string') {
    return undefined;
  }
  return SAFE_FINISH_REASONS.has(finishReason) ? finishReason : 'custom';
}

function getSafeTokenCount(tokenCount: unknown) {
  return typeof tokenCount === 'number' && Number.isFinite(tokenCount) ? tokenCount : 0;
}

/**
 * Provider that connects to the PromptfooModel task of the server.
 */
export class PromptfooModelProvider implements ApiProvider {
  private readonly model: string;
  readonly config: Record<string, any>;

  constructor(model: string, options: PromptfooModelOptions = { model: '' }) {
    this.model = model || options.model;
    if (!this.model) {
      throw new Error('Model name is required for PromptfooModelProvider');
    }
    this.config = options.config || {};
    logger.debug(`[PromptfooModel] Initialized with model: ${this.model}`);
  }

  id() {
    return `promptfoo:model:${this.model}`;
  }

  async callApi(
    prompt: string,
    _context?: CallApiContextParams,
    _options?: CallApiOptionsParams,
  ): Promise<ProviderResponse> {
    logger.debug(`[PromptfooModel] Calling API with model: ${this.model}`);

    try {
      // Parse the prompt as chat messages if it's a JSON string
      let messages;
      try {
        messages = JSON.parse(prompt);
        if (!Array.isArray(messages)) {
          messages = [{ role: 'user', content: prompt }];
        }
      } catch {
        // If parsing fails, assume it's a single user message
        logger.debug(`[PromptfooModel] Assuming prompt is a single user message`);
        messages = [{ role: 'user', content: prompt }];
      }

      const payload = {
        task: 'promptfoo:model',
        model: this.model,
        messages,
        config: this.config,
      };

      const baseUrl = cloudConfig.getApiHost();
      const url = `${baseUrl}/api/v1/task`; // Use the standard task endpoint (auth is handled conditionally on the server)

      const token = cloudConfig.getApiKey();
      if (!token) {
        throw new Error(
          'No Promptfoo auth token available. Please log in with `promptfoo auth login`',
        );
      }

      const body = JSON.stringify(payload);
      logger.debug('[PromptfooModel] Sending request', {
        ...getUrlLogMetadata(url),
        model: this.model,
        messageCount: messages.length,
        configKeyCount: Object.keys(this.config).length,
      });
      const response = await fetchWithProxy(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'x-promptfoo-silent': 'true',
        },
        body,
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.debug('[PromptfooModel] Received error response', {
          status: response.status,
          responseBodyLength: errorText.length,
        });
        throw new Error(`PromptfooModel task API error: ${response.status}`);
      }

      const data = await response.json();
      if (!data || !data.result) {
        throw new Error('Invalid response from PromptfooModel task API');
      }

      const modelResponse = data.result as ModelApiResponse;
      const choices = Array.isArray(modelResponse.choices) ? modelResponse.choices : [];
      const usage = modelResponse.usage || {};
      logger.debug('[PromptfooModel] Received response', {
        configuredModel: this.model,
        hasResponseModel: typeof modelResponse.model === 'string' && modelResponse.model.length > 0,
        responseModelLength:
          typeof modelResponse.model === 'string' ? modelResponse.model.length : undefined,
        hasProvider:
          typeof modelResponse.provider === 'string' && modelResponse.provider.length > 0,
        providerLength:
          typeof modelResponse.provider === 'string' ? modelResponse.provider.length : undefined,
        choiceCount: choices.length,
        finishReason: getSafeFinishReason(choices[0]?.finish_reason),
        tokenUsage: {
          total: getSafeTokenCount(usage.total_tokens),
          prompt: getSafeTokenCount(usage.prompt_tokens),
          completion: getSafeTokenCount(usage.completion_tokens),
        },
      });

      // Extract the completion from the choices
      const completionContent = choices[0]?.message?.content || '';

      // Return in the expected format for a provider
      return {
        output: completionContent,
        tokenUsage: {
          total: getSafeTokenCount(usage.total_tokens),
          prompt: getSafeTokenCount(usage.prompt_tokens),
          completion: getSafeTokenCount(usage.completion_tokens),
          numRequests: 1,
        },
      };
    } catch (error) {
      logger.error('[PromptfooModel] Error', getErrorLogMetadata(error));
      throw error;
    }
  }
}
