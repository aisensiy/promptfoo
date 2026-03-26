import { useCallback, useMemo } from 'react';

import { type Plugin, type Strategy } from '@promptfoo/redteam/constants';
import {
  type PluginConfig,
  type RedteamStrategyObject,
  type StrategyConfig,
} from '@promptfoo/redteam/types';
import { useRedTeamConfig } from '../../hooks/useRedTeamConfig';
import { useTestCaseGeneration } from '../TestCaseGenerationProvider';

interface UseStrategyTestGenerationOptions {
  strategyId: Strategy;
}

interface UseStrategyTestGenerationResult {
  strategyConfig: StrategyConfig;
  testGenerationPlugin: { id: Plugin; config: PluginConfig; isStatic: boolean };
  handleTestCaseGeneration: () => Promise<void>;
  isGenerating: boolean;
  isCurrentStrategy: boolean;
}

const DEFAULT_TEST_GENERATION_PLUGIN: Plugin = 'harmful:hate';

/**
 * Shared hook for strategy test case generation logic.
 * Used by both StrategyItem and HeroStrategyCard components.
 */
export function useStrategyTestGeneration({
  strategyId,
}: UseStrategyTestGenerationOptions): UseStrategyTestGenerationResult {
  const { config } = useRedTeamConfig();
  const { generateTestCase, isGenerating, strategy: currentStrategy } = useTestCaseGeneration();

  const strategyConfig = useMemo(() => {
    const found = config.strategies.find(
      (s) => typeof s === 'object' && 'id' in s && s.id === strategyId,
    ) as RedteamStrategyObject | undefined;
    return (found?.config ?? {}) as StrategyConfig;
  }, [config.strategies, strategyId]);

  const previewPlugins = useMemo(() => {
    const plugins = config.plugins.map((configuredPlugin) =>
      typeof configuredPlugin === 'string'
        ? { id: configuredPlugin as Plugin, config: {}, isStatic: true }
        : {
            id: configuredPlugin.id as Plugin,
            config: configuredPlugin.config ?? {},
            isStatic: true,
          },
    );

    return plugins.length > 0
      ? plugins
      : [{ id: DEFAULT_TEST_GENERATION_PLUGIN, config: {}, isStatic: true }];
  }, [config.plugins]);

  // Select a random plugin from the user's configured plugins, or fall back to default
  const testGenerationPlugin = useMemo(() => {
    return previewPlugins[Math.floor(Math.random() * previewPlugins.length)];
  }, [previewPlugins]);

  const handleTestCaseGeneration = useCallback(async () => {
    await generateTestCase(testGenerationPlugin, {
      id: strategyId,
      config: strategyConfig,
      isStatic: false,
    });
  }, [strategyConfig, generateTestCase, strategyId, testGenerationPlugin]);

  return {
    strategyConfig,
    testGenerationPlugin,
    handleTestCaseGeneration,
    isGenerating,
    isCurrentStrategy: currentStrategy === strategyId,
  };
}
