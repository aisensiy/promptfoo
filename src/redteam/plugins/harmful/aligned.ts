import invariant from '../../../util/invariant';
import { HARM_PLUGINS } from '../../constants';
import { extractMaterializedVariablesFromJsonWithMetadata, getShortPluginId } from '../../util';
import { RedteamPluginBase } from '../base';
import { getHarmfulAssertions } from './common';
import { REDTEAM_MODEL_CATEGORIES } from './constants';

import type { ApiProvider, Assertion, PluginConfig, TestCase } from '../../../types/index';
import type { HarmfulCategory } from './constants';

export class AlignedHarmfulPlugin extends RedteamPluginBase {
  private harmCategory: keyof typeof HARM_PLUGINS;

  get id(): string {
    return `promptfoo:redteam:${this.harmCategory}`;
  }

  constructor(
    provider: ApiProvider,
    purpose: string,
    injectVar: string,
    harmCategory: keyof typeof HARM_PLUGINS,
    config: PluginConfig = {},
  ) {
    super(provider, purpose, injectVar, config);
    this.harmCategory = harmCategory;
  }

  protected async getTemplate(): Promise<string> {
    const categoryConfig: HarmfulCategory | undefined = REDTEAM_MODEL_CATEGORIES.find(
      (c) => c.key === this.harmCategory,
    );
    invariant(categoryConfig, `Harmful category ${this.harmCategory} not found`);
    return categoryConfig.prompt;
  }

  protected getAssertions(_prompt: string): Assertion[] {
    return getHarmfulAssertions(this.harmCategory);
  }

  protected async promptsToTestCases(prompts: { __prompt: string }[]): Promise<TestCase[]> {
    const hasMultipleInputs = this.config.inputs && Object.keys(this.config.inputs).length > 0;
    const harmCategoryLabel = HARM_PLUGINS[this.harmCategory] || this.harmCategory;
    const pluginId = getShortPluginId(this.harmCategory);

    return Promise.all(
      prompts.map(async ({ __prompt }) => {
        // Base vars with the primary injectVar
        const vars: Record<string, string> = {
          [this.injectVar]: __prompt,
        };
        let inputMaterialization: Awaited<
          ReturnType<typeof extractMaterializedVariablesFromJsonWithMetadata>
        >['metadata'];

        // If inputs is defined, extract individual keys from the JSON into vars
        if (hasMultipleInputs) {
          try {
            const parsed = JSON.parse(__prompt);
            const materializedVars = await extractMaterializedVariablesFromJsonWithMetadata(
              parsed,
              this.config.inputs!,
              {
                pluginId,
                provider: this.provider,
                purpose: this.purpose,
              },
            );
            Object.assign(vars, materializedVars.vars);
            inputMaterialization = materializedVars.metadata;
          } catch {
            // If parsing fails, just use the raw prompt
          }
        }

        return {
          vars,
          metadata: {
            harmCategory: harmCategoryLabel,
            pluginId,
            pluginConfig: this.config,
            ...(inputMaterialization ? { inputMaterialization } : {}),
          },
          assert: getHarmfulAssertions(this.harmCategory),
        };
      }),
    );
  }
}
