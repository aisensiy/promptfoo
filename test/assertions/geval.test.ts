import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleGEval } from '../../src/assertions/geval';
import { matchesGEval } from '../../src/matchers/llmGrading';

vi.mock('../../src/matchers/llmGrading');

describe('handleGEval', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('should handle string renderedValue', async () => {
    const mockMatchesGEval = vi.mocked(matchesGEval);
    mockMatchesGEval.mockResolvedValue({
      pass: true,
      score: 0.8,
      reason: 'test reason',
    });

    const result = await handleGEval({
      assertion: {
        type: 'g-eval',
        value: 'test criteria',
        threshold: 0.7,
      },
      renderedValue: 'test criteria',
      prompt: 'test prompt',
      outputString: 'test output',
      test: {
        vars: {},
        assert: [],
        options: {},
      },
      baseType: 'g-eval',
      assertionValueContext: {
        prompt: 'test prompt',
        vars: {},
        test: {
          vars: {},
          assert: [],
          options: {},
        },
        logProbs: undefined,
        provider: {
          id: () => 'test-provider',
          callApi: async () => ({ output: 'test' }),
        },
        providerResponse: {
          output: 'test output',
          error: undefined,
        },
      },
      inverse: false,
      output: 'test output',
      providerResponse: {
        output: 'test output',
        error: undefined,
      },
    });

    expect(result).toEqual({
      assertion: {
        type: 'g-eval',
        value: 'test criteria',
        threshold: 0.7,
      },
      pass: true,
      score: 0.8,
      reason: 'test reason',
    });

    expect(mockMatchesGEval).toHaveBeenCalledWith(
      'test criteria',
      'test prompt',
      'test output',
      0.7,
      {},
      undefined,
    );
  });

  it('should handle array renderedValue', async () => {
    const mockMatchesGEval = vi.mocked(matchesGEval);
    mockMatchesGEval.mockResolvedValueOnce({
      pass: true,
      score: 0.8,
      reason: 'test reason 1',
    });
    mockMatchesGEval.mockResolvedValueOnce({
      pass: false,
      score: 0.6,
      reason: 'test reason 2',
    });

    const result = await handleGEval({
      assertion: {
        type: 'g-eval',
        value: ['criteria1', 'criteria2'],
        threshold: 0.7,
      },
      renderedValue: ['criteria1', 'criteria2'],
      prompt: 'test prompt',
      outputString: 'test output',
      test: {
        vars: {},
        assert: [],
        options: {},
      },
      baseType: 'g-eval',
      assertionValueContext: {
        prompt: 'test prompt',
        vars: {},
        test: {
          vars: {},
          assert: [],
          options: {},
        },
        logProbs: undefined,
        provider: {
          id: () => 'test-provider',
          callApi: async () => ({ output: 'test' }),
        },
        providerResponse: {
          output: 'test output',
          error: undefined,
        },
      },
      inverse: false,
      output: 'test output',
      providerResponse: {
        output: 'test output',
        error: undefined,
      },
    });

    expect(result).toEqual({
      assertion: {
        type: 'g-eval',
        value: ['criteria1', 'criteria2'],
        threshold: 0.7,
      },
      pass: true,
      score: 0.7,
      reason: 'test reason 1\n\ntest reason 2',
    });
  });

  it('should fail with a clear reason when array renderedValue is empty', async () => {
    const mockMatchesGEval = vi.mocked(matchesGEval);

    const result = await handleGEval({
      assertion: {
        type: 'g-eval',
        value: [],
        threshold: 0.7,
      },
      renderedValue: [],
      prompt: 'test prompt',
      outputString: 'test output',
      test: {
        vars: {},
        assert: [],
        options: {},
      },
      baseType: 'g-eval',
      assertionValueContext: {
        prompt: 'test prompt',
        vars: {},
        test: {
          vars: {},
          assert: [],
          options: {},
        },
        logProbs: undefined,
        provider: {
          id: () => 'test-provider',
          callApi: async () => ({ output: 'test' }),
        },
        providerResponse: {
          output: 'test output',
          error: undefined,
        },
      },
      inverse: false,
      output: 'test output',
      providerResponse: {
        output: 'test output',
        error: undefined,
      },
    });

    expect(result).toEqual({
      assertion: {
        type: 'g-eval',
        value: [],
        threshold: 0.7,
      },
      pass: false,
      score: 0,
      reason: 'G-Eval assertion requires at least one criterion string in the value array.',
    });
    expect(mockMatchesGEval).not.toHaveBeenCalled();
  });

  it('should use default threshold if not provided', async () => {
    const mockMatchesGEval = vi.mocked(matchesGEval);
    mockMatchesGEval.mockResolvedValue({
      pass: true,
      score: 0.8,
      reason: 'test reason',
    });

    await handleGEval({
      assertion: {
        type: 'g-eval',
        value: 'test criteria',
      },
      renderedValue: 'test criteria',
      prompt: 'test prompt',
      outputString: 'test output',
      test: {
        vars: {},
        assert: [],
        options: {},
      },
      baseType: 'g-eval',
      assertionValueContext: {
        prompt: 'test prompt',
        vars: {},
        test: {
          vars: {},
          assert: [],
          options: {},
        },
        logProbs: undefined,
        provider: {
          id: () => 'test-provider',
          callApi: async () => ({ output: 'test' }),
        },
        providerResponse: {
          output: 'test output',
          error: undefined,
        },
      },
      inverse: false,
      output: 'test output',
      providerResponse: {
        output: 'test output',
        error: undefined,
      },
    });

    expect(mockMatchesGEval).toHaveBeenCalledWith(
      'test criteria',
      'test prompt',
      'test output',
      0.7,
      {},
      undefined,
    );
  });

  it('should throw error for invalid renderedValue type', async () => {
    await expect(
      handleGEval({
        assertion: {
          type: 'g-eval',
          value: 'test',
        },
        renderedValue: undefined,
        prompt: 'test',
        outputString: 'test',
        test: {
          vars: {},
          assert: [],
          options: {},
        },
        baseType: 'g-eval',
        assertionValueContext: {
          prompt: 'test prompt',
          vars: {},
          test: {
            vars: {},
            assert: [],
            options: {},
          },
          logProbs: undefined,
          provider: {
            id: () => 'test-provider',
            callApi: async () => ({ output: 'test' }),
          },
          providerResponse: {
            output: 'test output',
            error: undefined,
          },
        },
        inverse: false,
        output: 'test',
        providerResponse: {
          output: 'test',
          error: undefined,
        },
      }),
    ).rejects.toThrow('G-Eval assertion type must have a string or array of strings value');
  });

  it('should handle string renderedValue with undefined prompt', async () => {
    const mockMatchesGEval = vi.mocked(matchesGEval);
    mockMatchesGEval.mockResolvedValue({
      pass: true,
      score: 0.8,
      reason: 'test reason',
    });

    const result = await handleGEval({
      assertion: {
        type: 'g-eval',
        value: 'test criteria',
        threshold: 0.7,
      },
      renderedValue: 'test criteria',
      prompt: undefined,
      outputString: 'test output',
      test: {
        vars: {},
        assert: [],
        options: {},
      },
      baseType: 'g-eval',
      assertionValueContext: {
        prompt: undefined,
        vars: {},
        test: {
          vars: {},
          assert: [],
          options: {},
        },
        logProbs: undefined,
        provider: {
          id: () => 'test-provider',
          callApi: async () => ({ output: 'test' }),
        },
        providerResponse: {
          output: 'test output',
          error: undefined,
        },
      },
      inverse: false,
      output: 'test output',
      providerResponse: {
        output: 'test output',
        error: undefined,
      },
    });

    expect(result).toEqual({
      assertion: {
        type: 'g-eval',
        value: 'test criteria',
        threshold: 0.7,
      },
      pass: true,
      score: 0.8,
      reason: 'test reason',
    });

    expect(mockMatchesGEval).toHaveBeenCalledWith(
      'test criteria',
      '',
      'test output',
      0.7,
      {},
      undefined,
    );
  });

  it('should handle array renderedValue with undefined prompt', async () => {
    const mockMatchesGEval = vi.mocked(matchesGEval);
    mockMatchesGEval.mockResolvedValueOnce({
      pass: true,
      score: 0.8,
      reason: 'test reason 1',
    });
    mockMatchesGEval.mockResolvedValueOnce({
      pass: false,
      score: 0.6,
      reason: 'test reason 2',
    });

    const result = await handleGEval({
      assertion: {
        type: 'g-eval',
        value: ['criteria1', 'criteria2'],
        threshold: 0.7,
      },
      renderedValue: ['criteria1', 'criteria2'],
      prompt: undefined,
      outputString: 'test output',
      test: {
        vars: {},
        assert: [],
        options: {},
      },
      baseType: 'g-eval',
      assertionValueContext: {
        prompt: undefined,
        vars: {},
        test: {
          vars: {},
          assert: [],
          options: {},
        },
        logProbs: undefined,
        provider: {
          id: () => 'test-provider',
          callApi: async () => ({ output: 'test' }),
        },
        providerResponse: {
          output: 'test output',
          error: undefined,
        },
      },
      inverse: false,
      output: 'test output',
      providerResponse: {
        output: 'test output',
        error: undefined,
      },
    });

    expect(result).toEqual({
      assertion: {
        type: 'g-eval',
        value: ['criteria1', 'criteria2'],
        threshold: 0.7,
      },
      pass: true,
      score: 0.7,
      reason: 'test reason 1\n\ntest reason 2',
    });

    expect(mockMatchesGEval).toHaveBeenCalledWith(
      'criteria1',
      '',
      'test output',
      0.7,
      {},
      undefined,
    );
    expect(mockMatchesGEval).toHaveBeenCalledWith(
      'criteria2',
      '',
      'test output',
      0.7,
      {},
      undefined,
    );
  });

  describe('inverse (not-g-eval)', () => {
    const baseParams = {
      prompt: 'test prompt',
      outputString: 'test output',
      test: {
        vars: {},
        assert: [],
        options: {},
      },
      baseType: 'g-eval' as const,
      assertionValueContext: {
        prompt: 'test prompt',
        vars: {},
        test: {
          vars: {},
          assert: [],
          options: {},
        },
        logProbs: undefined,
        provider: {
          id: () => 'test-provider',
          callApi: async () => ({ output: 'test' }),
        },
        providerResponse: {
          output: 'test output',
          error: undefined,
        },
      },
      output: 'test output',
      providerResponse: {
        output: 'test output',
        error: undefined,
      },
    };

    it('fails a passing string criterion when inverse is true', async () => {
      const mockMatchesGEval = vi.mocked(matchesGEval);
      mockMatchesGEval.mockResolvedValue({
        pass: true,
        score: 0.8,
        reason: 'matches the criterion',
      });

      const result = await handleGEval({
        ...baseParams,
        assertion: {
          type: 'not-g-eval',
          value: 'test criteria',
          threshold: 0.7,
        },
        renderedValue: 'test criteria',
        inverse: true,
      });

      expect(result).toEqual({
        assertion: {
          type: 'not-g-eval',
          value: 'test criteria',
          threshold: 0.7,
        },
        pass: false,
        score: expect.closeTo(0.2, 5),
        reason: 'matches the criterion',
      });
    });

    it('passes a failing string criterion when inverse is true', async () => {
      const mockMatchesGEval = vi.mocked(matchesGEval);
      mockMatchesGEval.mockResolvedValue({
        pass: false,
        score: 0.3,
        reason: 'does not match the criterion',
      });

      const result = await handleGEval({
        ...baseParams,
        assertion: {
          type: 'not-g-eval',
          value: 'test criteria',
          threshold: 0.7,
        },
        renderedValue: 'test criteria',
        inverse: true,
      });

      expect(result).toEqual({
        assertion: {
          type: 'not-g-eval',
          value: 'test criteria',
          threshold: 0.7,
        },
        pass: true,
        score: expect.closeTo(0.7, 5),
        reason: 'does not match the criterion',
      });
    });

    it('inverts an averaged passing array result when inverse is true', async () => {
      const mockMatchesGEval = vi.mocked(matchesGEval);
      mockMatchesGEval.mockResolvedValueOnce({
        pass: true,
        score: 0.8,
        reason: 'test reason 1',
      });
      mockMatchesGEval.mockResolvedValueOnce({
        pass: false,
        score: 0.6,
        reason: 'test reason 2',
      });

      const result = await handleGEval({
        ...baseParams,
        assertion: {
          type: 'not-g-eval',
          value: ['criteria1', 'criteria2'],
          threshold: 0.7,
        },
        renderedValue: ['criteria1', 'criteria2'],
        inverse: true,
      });

      expect(result).toEqual({
        assertion: {
          type: 'not-g-eval',
          value: ['criteria1', 'criteria2'],
          threshold: 0.7,
        },
        pass: false,
        score: expect.closeTo(0.3, 5),
        reason: 'test reason 1\n\ntest reason 2',
      });
    });

    it('inverts an averaged failing array result when inverse is true', async () => {
      const mockMatchesGEval = vi.mocked(matchesGEval);
      mockMatchesGEval.mockResolvedValueOnce({
        pass: false,
        score: 0.4,
        reason: 'test reason 1',
      });
      mockMatchesGEval.mockResolvedValueOnce({
        pass: false,
        score: 0.2,
        reason: 'test reason 2',
      });

      const result = await handleGEval({
        ...baseParams,
        assertion: {
          type: 'not-g-eval',
          value: ['criteria1', 'criteria2'],
          threshold: 0.7,
        },
        renderedValue: ['criteria1', 'criteria2'],
        inverse: true,
      });

      expect(result).toEqual({
        assertion: {
          type: 'not-g-eval',
          value: ['criteria1', 'criteria2'],
          threshold: 0.7,
        },
        pass: true,
        score: expect.closeTo(0.7, 5),
        reason: 'test reason 1\n\ntest reason 2',
      });
    });

    it('still fails on empty array regardless of inverse (misconfiguration)', async () => {
      const mockMatchesGEval = vi.mocked(matchesGEval);

      const result = await handleGEval({
        ...baseParams,
        assertion: {
          type: 'not-g-eval',
          value: [],
          threshold: 0.7,
        },
        renderedValue: [],
        inverse: true,
      });

      expect(result).toEqual({
        assertion: {
          type: 'not-g-eval',
          value: [],
          threshold: 0.7,
        },
        pass: false,
        score: 0,
        reason: 'G-Eval assertion requires at least one criterion string in the value array.',
      });
      expect(mockMatchesGEval).not.toHaveBeenCalled();
    });
  });
});
