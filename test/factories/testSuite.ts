import { createMockProvider } from './provider';

import type { AtomicTestCase, Prompt, TestCase, TestSuite } from '../../src/types/index';

export function createPrompt(raw = 'Test prompt', overrides: Partial<Prompt> = {}): Prompt {
  return {
    raw,
    label: raw,
    ...overrides,
  };
}

export function createTestCase(overrides: Partial<TestCase> = {}): TestCase {
  return {
    vars: {},
    ...overrides,
  };
}

export function createAtomicTestCase(overrides: Partial<AtomicTestCase> = {}): AtomicTestCase {
  return {
    vars: {},
    ...overrides,
  };
}

export function createTestSuite(overrides: Partial<TestSuite> = {}): TestSuite {
  return {
    providers: [createMockProvider()],
    prompts: [createPrompt()],
    tests: [createTestCase()],
    ...overrides,
  };
}
