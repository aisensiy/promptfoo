import { createHmac } from 'crypto';

import Anthropic from '@anthropic-ai/sdk';
import { getEnvString } from '../../envars';

import type { EnvOverrides } from '../../types/env';
import type { ApiProvider, CallApiContextParams, ProviderResponse } from '../../types/index';

/**
 * Base options shared by all Anthropic provider implementations
 */
interface AnthropicBaseOptions {
  apiKey?: string;
  apiBaseUrl?: string;
  headers?: Record<string, string>;
  cost?: number;
}

const ANTHROPIC_CACHE_HASH_KEY = 'promptfoo:anthropic:cache-key:v1';

export function hashAnthropicCacheValue(value: unknown): string {
  const serialized = typeof value === 'string' ? value : JSON.stringify(value);
  return createHmac('sha256', ANTHROPIC_CACHE_HASH_KEY)
    .update(serialized ?? String(value))
    .digest('hex');
}

/**
 * Generic provider class for Anthropic APIs
 * Serves as a base class with shared functionality for all Anthropic providers
 */
export class AnthropicGenericProvider implements ApiProvider {
  modelName: string;
  config: AnthropicBaseOptions;
  env?: EnvOverrides;
  apiKey?: string;
  anthropic: Anthropic;

  constructor(
    modelName: string,
    options: {
      config?: AnthropicBaseOptions;
      id?: string;
      env?: EnvOverrides;
    } = {},
  ) {
    const { config, id, env } = options;
    this.env = env;
    this.modelName = modelName;
    this.config = config || {};
    this.apiKey = this.getApiKey();
    this.anthropic = new Anthropic({
      apiKey: this.apiKey,
      baseURL: this.getApiBaseUrl(),
    });
    this.id = id ? () => id : this.id;
  }

  id(): string {
    return `anthropic:${this.modelName}`;
  }

  toString(): string {
    return `[Anthropic Provider ${this.modelName}]`;
  }

  requiresApiKey(): boolean {
    return true;
  }

  getApiKey(): string | undefined {
    return this.config?.apiKey || this.env?.ANTHROPIC_API_KEY || getEnvString('ANTHROPIC_API_KEY');
  }

  getApiBaseUrl(): string | undefined {
    return (
      this.config?.apiBaseUrl || this.env?.ANTHROPIC_BASE_URL || getEnvString('ANTHROPIC_BASE_URL')
    );
  }

  protected getCacheIdentityHash(): string {
    const apiKey = this.apiKey ?? this.getApiKey();
    return hashAnthropicCacheValue({
      apiBaseUrl: this.getApiBaseUrl(),
      apiKeyFingerprint: apiKey ? hashAnthropicCacheValue(apiKey) : undefined,
    });
  }

  /**
   * Base implementation - should be overridden by specific provider implementations
   */
  async callApi(_prompt: string, _context?: CallApiContextParams): Promise<ProviderResponse> {
    throw new Error('Not implemented: callApi must be implemented by subclasses');
  }
}
