import { createHmac, randomBytes } from 'node:crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { getEnvString } from '../../envars';
import { getDirectory, resolvePackageEntryPoint } from '../../esm';
import logger from '../../logger';
import { OpenAICodexSDKProvider } from './codex-sdk';

import type { EnvOverrides } from '../../types/env';
import type { DefaultProviders } from '../../types/index';
import type { OpenAICodexSDKConfig } from './codex-sdk';

const CODEX_AUTH_FILENAME = 'auth.json';
const CODEX_DEFAULT_PROVIDERS_CACHE_MAX_ENTRIES = 32;
const CODEX_DEFAULT_PROVIDERS_CACHE_HMAC_CONTEXT = 'promptfoo:codex-default-provider-cache-key';
const CODEX_DEFAULT_PROVIDERS_CACHE_HMAC_KEY = randomBytes(32);
const CODEX_SDK_PACKAGE_NAME = '@openai/codex-sdk';

let codexDefaultWorkingDir: string | undefined;

const CODEX_GRADING_OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    pass: {
      type: 'boolean',
    },
    score: {
      type: 'number',
    },
    reason: {
      type: 'string',
    },
  },
  required: ['pass', 'score', 'reason'],
  additionalProperties: false,
} as const;

type CodexDefaultProviders = Pick<
  DefaultProviders,
  | 'gradingJsonProvider'
  | 'gradingProvider'
  | 'llmRubricProvider'
  | 'suggestionsProvider'
  | 'synthesizeProvider'
  | 'webSearchProvider'
>;

type CodexDefaultProviderBundle = {
  gradingJsonProvider: OpenAICodexSDKProvider;
  gradingProvider: OpenAICodexSDKProvider;
  llmRubricProvider: OpenAICodexSDKProvider;
  suggestionsProvider: OpenAICodexSDKProvider;
  synthesizeProvider: OpenAICodexSDKProvider;
  webSearchProvider: OpenAICodexSDKProvider;
};

const codexDefaultProvidersByCacheKey = new Map<string, CodexDefaultProviderBundle>();

const codexSdkAvailabilityByBaseDir = new Map<string, boolean>();

function getCodexEnvString(env: EnvOverrides | undefined, key: string): string | undefined {
  return env?.[key] || getEnvString(key);
}

function getCodexHome(env?: EnvOverrides): string {
  const homeDir = os.homedir?.();
  const defaultHome =
    typeof homeDir === 'string' && homeDir ? path.join(homeDir, '.codex') : undefined;
  const codexHome = getCodexEnvString(env, 'CODEX_HOME') || defaultHome || '.codex';
  return path.resolve(codexHome);
}

function getTempDirectory(): string {
  const tempDir = os.tmpdir?.();
  return typeof tempDir === 'string' && tempDir ? tempDir : process.cwd();
}

function getCodexDefaultWorkingDir(): string {
  if (!codexDefaultWorkingDir) {
    codexDefaultWorkingDir = fs.mkdtempSync(
      path.join(getTempDirectory(), 'promptfoo-codex-default-'),
    );
  }

  return codexDefaultWorkingDir;
}

function hasCodexAuthFile(env?: EnvOverrides): boolean {
  try {
    const stats = fs.statSync(path.join(getCodexHome(env), CODEX_AUTH_FILENAME));
    return stats.isFile() && stats.size > 0;
  } catch {
    return false;
  }
}

function hasCodexSdkPackage(baseDir: string): boolean {
  const cached = codexSdkAvailabilityByBaseDir.get(baseDir);
  if (cached !== undefined) {
    return cached;
  }

  const hasPackage = resolvePackageEntryPoint(CODEX_SDK_PACKAGE_NAME, baseDir) !== null;
  codexSdkAvailabilityByBaseDir.set(baseDir, hasPackage);
  return hasPackage;
}

function canLoadCodexSdkPackage(): boolean {
  return [process.cwd(), getDirectory()].some((baseDir) => hasCodexSdkPackage(baseDir));
}

export function hasCodexDefaultCredentials(env?: EnvOverrides): boolean {
  const hasCodexApiKey = Boolean(getCodexEnvString(env, 'CODEX_API_KEY'));
  return (hasCodexApiKey || hasCodexAuthFile(env)) && canLoadCodexSdkPackage();
}

function getCodexDefaultProviderConfig(
  env: EnvOverrides | undefined,
  config?: OpenAICodexSDKConfig,
  defaultWorkingDir: string = getCodexDefaultWorkingDir(),
): OpenAICodexSDKConfig {
  const codexHome = getCodexEnvString(env, 'CODEX_HOME');
  const workingDir = config?.working_dir || defaultWorkingDir;
  fs.mkdirSync(workingDir, { recursive: true });
  const cliEnv = {
    ...(codexHome ? { CODEX_HOME: path.resolve(codexHome) } : {}),
    ...config?.cli_env,
  };

  return {
    approval_policy: 'never',
    sandbox_mode: 'read-only',
    skip_git_repo_check: true,
    working_dir: workingDir,
    ...config,
    ...(Object.keys(cliEnv).length > 0 ? { cli_env: cliEnv } : {}),
  };
}

function getSecretCacheFingerprint(value: string | undefined): string | undefined {
  return value
    ? createHmac('sha256', CODEX_DEFAULT_PROVIDERS_CACHE_HMAC_KEY)
        .update(CODEX_DEFAULT_PROVIDERS_CACHE_HMAC_CONTEXT)
        .update('\0')
        .update(value)
        .digest('hex')
    : undefined;
}

function getCodexDefaultProvidersCacheKey(env?: EnvOverrides): string {
  const codexApiKey = getCodexEnvString(env, 'CODEX_API_KEY');
  const openAiApiKey = getCodexEnvString(env, 'OPENAI_API_KEY');

  return JSON.stringify({
    CODEX_HOME: getCodexEnvString(env, 'CODEX_HOME'),
    codexApiKeyFingerprint: getSecretCacheFingerprint(codexApiKey),
    hasCodexApiKey: Boolean(codexApiKey),
    hasOpenAiApiKey: Boolean(openAiApiKey),
    openAiApiKeyFingerprint: getSecretCacheFingerprint(openAiApiKey),
  });
}

function shutdownCodexDefaultProviderBundle(providers: CodexDefaultProviderBundle): void {
  for (const provider of new Set([
    providers.gradingJsonProvider,
    providers.gradingProvider,
    providers.llmRubricProvider,
    providers.suggestionsProvider,
    providers.synthesizeProvider,
    providers.webSearchProvider,
  ])) {
    void provider.shutdown().catch((error) => {
      logger.warn('[CodexDefaults] Error shutting down evicted provider', { error });
    });
  }
}

function cacheCodexDefaultProviders(
  cacheKey: string,
  providers: CodexDefaultProviderBundle,
): CodexDefaultProviderBundle {
  codexDefaultProvidersByCacheKey.set(cacheKey, providers);

  while (codexDefaultProvidersByCacheKey.size > CODEX_DEFAULT_PROVIDERS_CACHE_MAX_ENTRIES) {
    const oldestEntry = codexDefaultProvidersByCacheKey.entries().next().value;
    if (!oldestEntry) {
      break;
    }
    const [oldestCacheKey, oldestProviders] = oldestEntry;
    codexDefaultProvidersByCacheKey.delete(oldestCacheKey);
    shutdownCodexDefaultProviderBundle(oldestProviders);
  }

  return providers;
}

export function getCodexDefaultProviders(env?: EnvOverrides): CodexDefaultProviders {
  const cacheKey = getCodexDefaultProvidersCacheKey(env);
  const cachedProviders = codexDefaultProvidersByCacheKey.get(cacheKey);
  if (cachedProviders) {
    codexDefaultProvidersByCacheKey.delete(cacheKey);
    codexDefaultProvidersByCacheKey.set(cacheKey, cachedProviders);
    return cachedProviders;
  }

  const defaultWorkingDir = getCodexDefaultWorkingDir();

  const gradingProvider = new OpenAICodexSDKProvider({
    config: getCodexDefaultProviderConfig(env, undefined, defaultWorkingDir),
    env,
  });
  const gradingJsonProvider = new OpenAICodexSDKProvider({
    config: getCodexDefaultProviderConfig(
      env,
      {
        output_schema: CODEX_GRADING_OUTPUT_SCHEMA,
      },
      defaultWorkingDir,
    ),
    env,
  });
  const webSearchProvider = new OpenAICodexSDKProvider({
    config: getCodexDefaultProviderConfig(
      env,
      {
        network_access_enabled: true,
        output_schema: CODEX_GRADING_OUTPUT_SCHEMA,
        web_search_mode: 'live',
      },
      defaultWorkingDir,
    ),
    env,
  });

  const providers: CodexDefaultProviderBundle = {
    gradingJsonProvider,
    gradingProvider,
    llmRubricProvider: gradingJsonProvider,
    suggestionsProvider: gradingProvider,
    synthesizeProvider: gradingProvider,
    webSearchProvider,
  };
  return cacheCodexDefaultProviders(cacheKey, providers);
}

export function clearCodexDefaultProvidersForTesting(): void {
  codexDefaultProvidersByCacheKey.clear();
  codexSdkAvailabilityByBaseDir.clear();
  codexDefaultWorkingDir = undefined;
}
