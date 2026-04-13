import { afterEach, beforeEach, vi } from 'vitest';
import { mockProcessEnv } from '../../../util/utils';

vi.mock('../../../../src/cache', async (importOriginal) => {
  return {
    ...(await importOriginal()),
    fetchWithCache: vi.fn(),
  };
});

vi.mock('../../../../src/logger', () => ({
  __esModule: true,
  default: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../../../../src/python/pythonUtils', async (importOriginal) => {
  return {
    ...(await importOriginal()),
    runPython: vi.fn(),
  };
});

const ENV_KEYS_TO_CLEAR = [
  'OPENAI_TEMPERATURE',
  'OPENAI_MAX_TOKENS',
  'OPENAI_MAX_COMPLETION_TOKENS',
  'OPENAI_API_BASE_URL',
  'OPENAI_BASE_URL',
  'OPENAI_API_HOST',
] as const;

type OpenAiEnvKey = (typeof ENV_KEYS_TO_CLEAR)[number];

let restoreOpenAiEnv = () => {};

function resetOpenAiEnv(overrides: Partial<Record<OpenAiEnvKey, string | undefined>> = {}) {
  restoreOpenAiEnv();
  restoreOpenAiEnv = mockProcessEnv({
    ...Object.fromEntries(ENV_KEYS_TO_CLEAR.map((key) => [key, undefined])),
    ...overrides,
  });
}

export function setOpenAiEnv(overrides: Partial<Record<OpenAiEnvKey, string | undefined>>) {
  resetOpenAiEnv(overrides);
}

beforeEach(() => {
  vi.clearAllMocks();
  resetOpenAiEnv();
});

afterEach(() => {
  vi.resetAllMocks();
  restoreOpenAiEnv();
  restoreOpenAiEnv = () => {};
});
